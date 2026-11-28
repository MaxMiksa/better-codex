const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {event,identity,timestamp}=require('../../src/platform/observability/events.cjs');
const {Store,Recorder}=require('../../src/platform/observability/store.cjs');
const lifecycle=require('../../src/lifecycle/runtime_events.cjs');
const {observe}=require('../../src/runtime/runtime_events.cjs');
const cli=path.resolve(__dirname,'../../src/platform/observability/cli.cjs');
let n=0;
const root=process.argv[2];
const directory=()=>{const dir=path.join(root,String(++n)+' 中文');fs.mkdirSync(dir,{recursive:true});return dir;};
const entry=(context={},id=identity(),instance='unique')=>event('demo','observed','fixture',id,instance,undefined,context);
const call=(root,args,input)=>spawnSync(process.execPath,['--no-warnings=ExperimentalWarning',cli,'--runtime',root,...args],
  {input:input===undefined?undefined:JSON.stringify(input),encoding:'utf8',windowsHide:true});
const names=dir=>fs.readdirSync(dir).sort();
test('absent DB emits an empty query and creates no files',()=>{
  const dir=directory(),store=new Store(dir);
  const result=store.query();
  assert.deepEqual(result.events,[]);assert.equal(result.coverage.note,'database_missing');
  assert.equal(result.health.state,'unknown');assert.equal(result.coverage.continuous,false);assert.deepEqual(names(dir),[]);
});
test('schema 1, idempotent occurrences, ordering, limits and exact filters',()=>{
  const store=new Store(directory()),id=identity();
  assert.deepEqual(store.append(entry({},id,'a')),{ok:true,inserted:true});
  assert.deepEqual(store.append(entry({reason:'notAnOverwrite'},id,'a')),{ok:true,inserted:false});
  assert.equal(store.append(entry({reason:'second'},id,'b')).inserted,true);
  const result=store.query({kind:'demo',source:'fixture',correlation_id:id,limit:1});
  assert.equal(result.schema_version,1);assert.equal(result.events.length,1);assert.equal(result.truncated,true);
  assert.equal(store.query({kind:'dem'}).events.length,0);
  assert.equal(store.query({kind:'demo'}).events.some(e=>e.payload.reason==='notAnOverwrite'),false);
  const rows=store.query().events;
  assert.deepEqual(rows,[...rows].sort((a,b)=>b.occurred_at.localeCompare(a.occurred_at)||b.event_id.localeCompare(a.event_id)));
  assert.equal(store.query({since:rows[0].occurred_at,until:rows[0].occurred_at}).events.length>=1,true);
});
test('redaction is preserved on writes and independently on read',()=>{
  const dir=directory(),store=new Store(dir);
  const secret='https://private.example/secret',r=entry({reason:secret,path:secret,body:secret,phase:'safe',
    checks:[{id:'app',state:'pass',codes:['known',secret],detail:secret}],package_version:'1.2.3.4',pid:123});
  r.payload.path=secret;
  assert.equal(store.append(r).ok,true);
  for(const file of names(dir))assert.equal(fs.readFileSync(path.join(dir,file)).includes(secret),false);
  let db=store.connect();
  db.prepare('UPDATE events SET payload=?').run(JSON.stringify({...r.payload,account:secret}));
  db.close();
  assert.deepEqual(store.query().events[0].payload,{phase:'safe',checks:[{id:'app',state:'pass',codes:['known']}],package_version:'1.2.3.4',pid:123});
});
test('timestamp offsets and retention at exact five-day boundary; hourly physical prune',()=>{
  assert.equal(timestamp('2026-01-02T04:05:06.987+08:00'),'2026-01-01T20:05:06.987Z');
  assert.throws(()=>timestamp('2026-01-01T00:00:00'),RangeError);
  assert.throws(()=>timestamp('2026-02-30T00:00:00Z'),RangeError);
  const dir=directory();let now=Date.now(),clock=0;
  const store=new Store(dir,{now:()=>now,clock:()=>clock});
  const aged=new Date(now-5*86400*1000).toISOString(),old=new Date(Date.parse(aged)-1).toISOString();
  const at=(id,t)=>({...entry({},identity(),id),observed_at:t,occurred_at:t});
  const first=at('at',aged),second=at('old',old);
  assert.ok(store.append(first).inserted);assert.ok(store.append(second).inserted);
  assert.deepEqual(store.query({since:'2020-01-01T00:00:00Z'}).events.map(e=>e.event_id),[first.event_id]);
  now+=3600000;clock+=3600000;
  assert.ok(store.append({...entry({},identity(),'now'),observed_at:timestamp(new Date(now))}).inserted);
  const db=store.connect();
  try{assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,1);}finally{db.close();}
});
test('closed and live WAL queries leave the DB and existing SQL files unchanged',()=>{
  const dir=directory(),store=new Store(dir);
  assert.equal(store.append(entry()).ok,true);
  const before=names(dir),bytes=fs.readFileSync(store.path);
  assert.equal(store.query().events.length,1);
  assert.deepEqual(names(dir),before);assert.deepEqual(fs.readFileSync(store.path),bytes);
  const db=store.connect();
  try{
    store.insert(db,event('wal-event','success','fixture'));
    const files=names(dir).filter(name=>!name.endsWith('-shm')),snap=files.map(file=>fs.readFileSync(path.join(dir,file)));
    assert.equal(store.query().events.length,2);
    assert.deepEqual(names(dir).filter(name=>!name.endsWith('-shm')),files);
    assert.deepEqual(files.map(file=>fs.readFileSync(path.join(dir,file))),snap);
  }finally{db.close();}
  fs.writeFileSync(store.path+'-wal','incomplete');
  const result=store.query();
  assert.equal(result.ok,false);assert.equal(result.health.state,'unknown');assert.ok(!fs.existsSync(store.path+'-shm'));
});
test('future schema/corruption never overwrite or imply healthy status',()=>{
  const dir=directory(),store=new Store(dir);
  fs.writeFileSync(store.statusPath,JSON.stringify({state:'healthy',last_success_at:timestamp(),path:'private'}));
  fs.writeFileSync(store.path,'not a database');
  const result=store.query();
  assert.equal(result.error_category,'corrupt');assert.equal(result.health.state,'unknown');assert.equal(result.health.path,undefined);
  assert.equal(store.append(entry()).ok,false);assert.equal(fs.readFileSync(store.path,'utf8'),'not a database');
  const other=new Store(directory()),db=new DatabaseSync(other.path);
  db.exec('PRAGMA user_version=7');db.close();
  assert.equal(other.query().error_category,'schema');assert.equal(other.append(entry()).error_category,'schema');
  const read=new DatabaseSync(other.path,{readOnly:true});
  try{assert.equal(read.prepare('PRAGMA user_version').get().user_version,7);}finally{read.close();}
});
test('writer lock has a bounded failure, cross-writer backoff and a recorded gap',()=>{
  let now=Date.now(),clock=0;
  const dir=directory(),store=new Store(dir,{now:()=>now,clock:()=>clock});
  assert.ok(store.append(entry()).ok);
  const locked=store.connect();locked.exec('BEGIN IMMEDIATE');
  try{assert.equal(store.append(entry({},identity(),'locked')).error_category,'busy');}
  finally{locked.exec('ROLLBACK');locked.close();}
  const peer=new Store(dir,{now:()=>now,clock:()=>clock});
  assert.equal(peer.append(entry()).error_category,'backoff');
  assert.equal(peer.query().health.state,'degraded');
  clock+=15001;now+=15001;
  assert.ok(peer.append(entry({},identity(),'recovering')).ok);
  const result=peer.query();
  assert.equal(result.health.state,'healthy');assert.ok(result.health.gap_ended_at);
  assert.ok(result.events.some(e=>e.kind==='recorder-gap'&&e.payload.error_category==='busy'));
  assert.ok(result.events.some(e=>e.kind==='recorder-recovered'));
});
test('32 pending records maximum, no duplicated transitions, retry stays in recorder',()=>{
  const backing={ok:false,append(record){return {ok:this.ok,inserted:this.ok};}};
  const rec=new Recorder('', 'fixture',undefined,backing);
  for(let i=0;i<40;i++)rec.emit('demo','observed',{},String(i));
  assert.equal(rec.pending.size,32);rec.flush();assert.equal(rec.pending.size,32);
  backing.ok=true;rec.flush();assert.equal(rec.pending.size,0);
  assert.ok(rec.change('demo',['a'],'demo','observed').ok);assert.equal(rec.change('demo',['a'],'demo','observed'),undefined);
});
test('pure subprocess JSON, no warning, invalid arguments or raw input echoes',()=>{
  const dir=directory(),id=identity();
  const write=call(dir,['append'],{kind:'from-cli',source:'test',status:'observed',correlation_id:id,context:{body:'private-secret'}});
  assert.equal(write.status,0);assert.equal(write.stderr,'');assert.equal(JSON.parse(write.stdout).inserted,true);
  const query=call(dir,['query','--limit','1','--source','test','--correlation-id',id,'--kind','from-cli']);
  assert.equal(query.status,0);assert.equal(query.stderr,'');assert.equal(JSON.parse(query.stdout).events.length,1);
  assert.ok(!query.stdout.includes('private-secret'));
  for(const flags of [['--limit','0'],['--limit','1001'],['--limit','1.5'],['--since','private-secret'],['--unknown']]){
    const bad=call(dir,['query',...flags]);
    assert.equal(bad.status,2);assert.equal(JSON.parse(bad.stdout).error_category,'invalid_arguments');
    assert.ok(!(bad.stdout+bad.stderr).includes('private-secret'));
  }
});
test('diagnostic and controller observations preserve only known codes and timings',()=>{
  const dir=directory(),id=identity(),rec=new Recorder(dir,'supervisor',id);
  const now=Date.now(),owner={pid:777,started:now/1000-30,created:'133444736000000000'};
  const receipt={phase:'controller-running',controllerPid:888};
  fs.writeFileSync(path.join(dir,'view-status.json'),JSON.stringify({controllerPid:888,checkedAt:now,windows:[{checkedAt:now,
    visible:true,readingWidth:{applied:true},fileChanges:{cards:2},id:'private-thread'}]}));
  observe(rec,receipt,dir,owner,now);
  observe(rec,receipt,dir,owner,now);
  observe(rec,{phase:'waiting-desktop-connection',desktopGone:[777,owner.started]},dir,null,now);
  lifecycle.update(rec,{phase:'baseline',observedVersion:'1.2.3.4',correlation_id:'bogus'});
  lifecycle.diagnostic(rec,{},'instance','workerTimeout');
  const rows=rec.store.query({correlation_id:id}).events;
  assert.equal(rows.filter(e=>e.kind==='desktop-start-observed').length,1);
  assert.equal(rows.filter(e=>e.kind==='desktop-exit-observed').length,1);
  assert.equal(rows.find(e=>e.kind==='enhancement-state'&&e.status==='loaded').payload.window_count,1);
  assert.deepEqual(rows.find(e=>e.kind==='update-state').payload,{phase:'baseline',package_version:'1.2.3.4'});
  assert.equal(rows.find(e=>e.kind==='diagnostic-completed').payload.checks.length,10);
  assert.ok(!JSON.stringify(rows).includes('private-thread'));
  const messages=require('../../src/platform/i18n/messages.json');
  assert.ok(lifecycle.reasons({detail:messages.en['check.workerStopped'].replace('{code}','123')}).includes('workerStopped'));
});
