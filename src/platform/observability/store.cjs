// The existing history database is shared with 3A's Python compatibility callers.
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url'),{DatabaseSync}=require('node:sqlite');
const {SCHEMA_VERSION,RETENTION_SECONDS,event,identity,hash,timestamp,validate}=require('./events.cjs');
const retention=RETENTION_SECONDS*1000,busy=120,backoff=15000;
const timeKeys=['started_at','last_success_at','gap_started_at','gap_ended_at','last_failure_at'];
const categories=new Set(['busy','corrupt','unwritable','invalid','schema']);
class SchemaError extends Error{}
function category(error){
  if(error instanceof SchemaError)return 'schema';
  const code=(error.errcode??0)&255;
  if([5,6].includes(code))return 'busy';
  if([11,26].includes(code))return 'corrupt';
  if([8,10,13,14].includes(code)||error.code?.startsWith('E')&&!error.code.startsWith('ERR_'))return 'unwritable';
  return 'invalid';
}
const cutoff=(now=Date.now())=>timestamp(new Date(now-retention));
function transaction(db,operation,immediate=false){
  db.exec(immediate?'BEGIN IMMEDIATE':'BEGIN');
  try{
    const result=operation();
    db.exec('COMMIT');return result;
  }catch(error){
    try{db.exec('ROLLBACK');}catch{}
    throw error;
  }
}
class Store{
  constructor(runtime,{now=Date.now,clock=()=>performance.now()}={}){
    Object.assign(this,{runtime,path:path.join(runtime,'runtime-history.db'),statusPath:path.join(runtime,'observability-status.json'),
      now,clock,retryAt:-Infinity,lastPrune:-Infinity});
  }
  health(){
    try{
      const value=JSON.parse(fs.readFileSync(this.statusPath,'utf8'));
      const result={state:['healthy','degraded'].includes(value.state)?value.state:'unknown'};
      for(const key of timeKeys)if(value[key])result[key]=timestamp(value[key]);
      if(categories.has(value.error_category))result.error_category=value.error_category;
      return result;
    }catch{return {state:'unknown'};}
  }
  status(success,error){
    const lock=path.join(this.runtime,'observability-status.lock');
    const staged=path.join(this.runtime,'observability-status.'+identity()+'.next');
    let fd;
    try{
      try{if(this.now()-fs.statSync(lock).mtimeMs>30000)fs.unlinkSync(lock);}
      catch(e){if(e.code!=='ENOENT')throw e;}
      fd=fs.openSync(lock,'wx');
      const old=this.health(),now=timestamp(new Date(this.now()));
      const result={...old,started_at:old.started_at??now};
      if(success){
        Object.assign(result,{state:'healthy',last_success_at:now});
        if(old.state==='degraded')result.gap_ended_at=now;
      }else{
        Object.assign(result,{state:'degraded',error_category:error,last_failure_at:now});
        if(old.state!=='degraded'){result.gap_started_at=now;delete result.gap_ended_at;}
      }
      fs.writeFileSync(staged,JSON.stringify(result),{flag:'wx'});
      fs.renameSync(staged,this.statusPath);
    }catch{}finally{
      if(fd!==undefined){fs.closeSync(fd);try{fs.unlinkSync(lock);}catch{}}
      try{fs.unlinkSync(staged);}catch{}
    }
  }
  connect(){
    const db=new DatabaseSync(this.path,{timeout:busy});
    try{
      const {user_version:version}=db.prepare('PRAGMA user_version').get();
      if(version!==0&&version!==SCHEMA_VERSION)throw new SchemaError();
      if(version===0){
        db.exec('PRAGMA journal_mode=WAL');
        transaction(db,()=>db.exec(
          'CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, occurred_at TEXT NOT NULL, observed_at TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL, correlation_id TEXT NOT NULL, payload TEXT NOT NULL);'+
          'CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at, event_id);'+
          'CREATE INDEX IF NOT EXISTS events_correlation ON events(correlation_id, occurred_at);'+
          'CREATE INDEX IF NOT EXISTS events_retention ON events(observed_at);PRAGMA user_version=1'),true);
      }
      return db;
    }catch(error){db.close();throw error;}
  }
  insert(db,input){
    const r=validate(input);
    return db.prepare('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?)').run(r.event_id,r.occurred_at,r.observed_at,
      r.kind,r.status,r.source,r.correlation_id,JSON.stringify(r.payload)).changes===1;
  }
  prune(db,now=this.now()){
    return db.prepare('DELETE FROM events WHERE observed_at < ?').run(cutoff(now)).changes;
  }
  append(input){
    const retreat={ok:false,inserted:false,error_category:'backoff'};
    if(this.clock()<this.retryAt)return retreat;
    let db;
    try{
      const value=validate(input);
      fs.mkdirSync(this.runtime,{recursive:true});
      const old=this.health();
      if(old.state==='degraded'&&this.now()-Date.parse(old.last_failure_at)<backoff)return retreat;
      db=this.connect();
      const due=this.clock()-this.lastPrune>=3600000;
      const inserted=transaction(db,()=>{
        const result=this.insert(db,value);
        const gap=old.gap_started_at??old.last_failure_at;
        if(old.state==='degraded'&&gap){
          const id=hash(gap);
          this.insert(db,event('recorder-gap','failed','recorder',id,gap,gap,{error_category:old.error_category??'invalid'}));
          this.insert(db,event('recorder-recovered','success','recorder',id,gap));
        }
        if(due)this.prune(db);
        return result;
      });
      if(due)this.lastPrune=this.clock();
      this.status(true);
      return {ok:true,inserted};
    }catch(error){
      const reason=category(error);this.retryAt=this.clock()+backoff;this.status(false,reason);
      return {ok:false,inserted:false,error_category:reason};
    }finally{db?.close();}
  }
  query({since,until,kind,source,correlation_id,limit=100}={}){
    if(!Number.isInteger(limit)||limit<1||limit>1000)throw new RangeError('invalid_limit');
    since=since?timestamp(since):cutoff(this.now());until=until?timestamp(until):timestamp(new Date(this.now()));
    if(since>until)throw new RangeError('invalid_range');
    const health=this.health(),coverage={retention_days:5,since,until,continuous:false,note:'observations_only_unrecorded_intervals_unknown'};
    const result={schema_version:SCHEMA_VERSION,ok:true,events:[],health,coverage,truncated:false};
    if(!fs.existsSync(this.path)){health.state='unknown';coverage.note='database_missing';return result;}
    let db;
    try{
      const wal=fs.existsSync(this.path+'-wal');
      if(wal&&!fs.existsSync(this.path+'-shm'))throw new Error('incomplete_snapshot');
      // Use a URI string, not a URL object (which converts to a filename and drops the options).
      const uri=pathToFileURL(this.path).href+'?mode=ro'+(wal?'':'&immutable=1');
      db=new DatabaseSync(uri,{readOnly:true,timeout:busy});
      db.exec('PRAGMA query_only=ON');
      if(db.prepare('PRAGMA user_version').get().user_version!==SCHEMA_VERSION)throw new SchemaError();
      const clauses=['occurred_at >= ?','occurred_at <= ?','observed_at >= ?'];
      const values=[since,until,cutoff(this.now())];
      for(const [key,value] of Object.entries({kind,source,correlation_id}))if(value){clauses.push(key+' = ?');values.push(value);}
      const rows=db.prepare('SELECT * FROM events WHERE '+clauses.join(' AND ')+' ORDER BY occurred_at DESC, event_id DESC LIMIT ?')
        .all(...values,limit+1);
      result.events=rows.slice(0,limit).map(row=>validate({...row,payload:JSON.parse(row.payload)}));
      result.truncated=rows.length>limit;
    }catch(error){
      const reason=error instanceof SyntaxError||error instanceof TypeError||error instanceof RangeError?'schema':category(error);
      Object.assign(result,{ok:false,error_category:reason});
      Object.assign(health,{state:'unknown',error_category:reason});
      coverage.note='query_unavailable';
    }finally{db?.close();}
    return result;
  }
}
class Recorder{
  constructor(runtime,source,correlation_id,store=new Store(runtime)){
    Object.assign(this,{store,source,correlation_id:correlation_id||identity(),instance:identity(),
      states:new Map(),sequence:0,pending:new Map()});
  }
  emit(kind,status,context,instance,occurred_at,correlation_id){
    try{
      const r=event(kind,status,this.source,correlation_id||this.correlation_id,instance,occurred_at,context);
      const result=this.store.append(r);
      if(!result.ok){
        this.pending.set(r.event_id,r);
        if(this.pending.size>32)this.pending.delete(this.pending.keys().next().value);
      }
      return result;
    }catch{return {ok:false,inserted:false,error_category:'invalid'};}
  }
  flush(){
    for(const [id,record] of this.pending){
      if(!this.store.append(record).ok)break;
      this.pending.delete(id);
    }
  }
  change(key,value,kind,status,context,correlation_id,occurred_at){
    const signature=JSON.stringify(value);
    if(this.states.get(key)===signature)return;
    this.states.set(key,signature);
    return this.emit(kind,status,context,this.instance+':'+(++this.sequence),occurred_at,correlation_id);
  }
}
module.exports={Store,Recorder};
