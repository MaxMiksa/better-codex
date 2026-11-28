// Read-only response measurements; see LICENSE and VERSION.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestampMs=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:\d\d)?)?$/.test(value))return null;
  const y=+value.slice(0,4),m=+value.slice(5,7),d=+value.slice(8,10),calendar=new Date(0);
  calendar.setUTCFullYear(y,m-1,d);
  if(y<1||calendar.getUTCMonth()!==m-1||calendar.getUTCDate()!==d||+value.slice(11,13)>23)return null;
  const at=Date.parse(value.replace(',','.'));
  if(!Number.isFinite(at))return null;
  const fraction=/[.,](\d+)/.exec(value)?.[1];
  return at+(fraction?Number(fraction.slice(3,6).padEnd(3,'0'))/1000:0);
};
function integer(value){
  if(typeof value==='string'&&!/^[+-]?\d+$/.test(value.trim()))return 0;
  if(!['string','number','boolean'].includes(typeof value))return 0;
  const number=Number(value);
  return Number.isFinite(number)?Math.max(0,Math.trunc(number)):0;
}
function cachePercent(usage){
  if(usage.input_tokens==null||usage.cached_input_tokens==null)return null;
  const total=integer(usage.input_tokens),cached=integer(usage.cached_input_tokens);
  return total&&cached<=total?100*cached/total:null;
}
function requestRate({basis,source,duration_ms,output_tokens}){
  return basis==='request'&&source==='response'&&typeof duration_ms==='number'&&duration_ms>=50&&output_tokens?
    output_tokens*1000/duration_ms:null;
}
class Measurements{
  constructor(model=null,calculateSpeed=true){
    Object.assign(this,{model,calculateSpeed,turnId:null,last:null,turnClosed:false,stage:'idle',
      outputTotal:0,reasoningTotal:0,turnOutput:0,turnGenerationMs:0,sampleCount:0,
      recentResponseIds:new Set(),legacyTotal:null,canonicalUsageSeen:false,lastUsageAt:0,eventAt:0,
      turnStartedAt:null,turnFirstResponseId:null,turnFirstResponseSeen:false,pendingCalls:new Set()});
    this.resetTiming();
  }
  resetTiming(){
    this.requestBoundary=this.responseBoundary=null;
    this.responseOpen=this.responseToolsReturned=false;
    this.pendingCalls.clear();
  }
  beginResponse(){
    if(!this.responseOpen){
      this.responseBoundary=this.pendingCalls.size?null:this.requestBoundary;
      this.responseOpen=true;
    }
  }
  feed({type:kind,timestamp,payload:p={}}){
    if(!record(p))return;
    const at=timestampMs(timestamp),type=p.type;
    if(at!==null)this.eventAt=Math.max(this.eventAt,at);
    if(kind==='session_meta'){
      this.resetTiming();
      Object.assign(this,{turnId:null,turnStartedAt:null,turnFirstResponseId:null,turnFirstResponseSeen:false,
        turnClosed:false,stage:'idle',legacyTotal:null,canonicalUsageSeen:false});
    }else if(kind==='turn_context')this.model=p.model||this.model;
    else if(kind==='event_msg'&&['task_started','turn_started'].includes(type)){
      this.resetTiming();
      Object.assign(this,{turnId:p.turn_id??null,turnStartedAt:at,turnFirstResponseId:null,turnFirstResponseSeen:false,
        requestBoundary:at,turnClosed:false,stage:'generating',turnOutput:0,turnGenerationMs:0,sampleCount:0});
    }else if(kind==='event_msg'&&['task_complete','task_completed','turn_complete','turn_aborted'].includes(type)){
      this.stage='idle';this.turnClosed=true;this.resetTiming();
    }else if(kind==='compacted'){
      this.resetTiming();this.requestBoundary=at;
    }else if(kind==='response_item'){
      if(['function_call','custom_tool_call'].includes(type)&&p.call_id){
        this.beginResponse();this.pendingCalls.add(p.call_id);this.stage='tools';
      }else if(['function_call_output','custom_tool_call_output'].includes(type)){
        if(this.pendingCalls.delete(p.call_id)&&!this.pendingCalls.size&&!this.turnClosed){
          // Delayed usage still belongs to the preceding response.
          if(this.responseOpen)this.responseToolsReturned=true;
          else this.requestBoundary=at;
          this.stage='generating';
        }
      }else if(type==='message'&&p.role==='user'&&this.stage==='idle'){
        Object.assign(this,{requestBoundary:at,turnId:null,turnStartedAt:at,turnFirstResponseId:null,
          turnFirstResponseSeen:false,turnClosed:false,stage:'generating'});
      }else if(type==='reasoning'||type==='message'&&p.role==='assistant')this.beginResponse();
    }else if(kind==='token_usage_record'){
      if(!record(p.usage)||at===null||this.turnClosed||this.turnId&&p.turn_id&&this.turnId!==p.turn_id)return;
      const id=p.response_id??null;
      if(id){
        if(this.recentResponseIds.has(id))return;
        this.recentResponseIds.add(id);
        if(this.recentResponseIds.size>256)this.recentResponseIds.delete(this.recentResponseIds.values().next().value);
      }
      this.canonicalUsageSeen=true;this.turnId=p.turn_id||this.turnId;
      if(!this.turnFirstResponseSeen&&this.turnStartedAt!==null)this.turnFirstResponseId=id;
      this.sample(p.usage,at,'response',p.thread_token_usage,p.turn_token_usage);
      this.last.response_id=id;
    }else if(kind==='event_msg'&&type==='token_count'){
      const usage=p.info?.last_token_usage,total=p.info?.total_token_usage;
      if(record(usage)&&at!==null){
        const cumulative=record(total)&&Object.keys(total).length?integer(total.output_tokens):null;
        const previous=this.legacyTotal,output=integer(usage.output_tokens);
        this.legacyTotal=cumulative;
        if(!this.canonicalUsageSeen&&!this.turnClosed&&previous!==null&&cumulative!==null&&output>0&&cumulative-previous===output)
          this.sample(usage,at,'legacy',total);
      }
    }
  }
  sample(usage,at,source,total,turn){
    // Legacy usage never consumes the first canonical response slot.
    if(source==='response')this.turnFirstResponseSeen=true;
    const start=this.responseOpen?this.responseBoundary:this.requestBoundary;
    const basis=start!==null&&source==='response'&&!this.responseToolsReturned?'request':'unknown';
    const duration=start===null?null:at-start,output=integer(usage.output_tokens);
    const rate=this.calculateSpeed?requestRate({basis,source,duration_ms:duration,output_tokens:output}):null;
    this.last={rate,duration_ms:duration>0?duration:null,basis,input_tokens:integer(usage.input_tokens),
      cached_input_tokens:integer(usage.cached_input_tokens),output_tokens:output,
      reasoning_output_tokens:integer(usage.reasoning_output_tokens),cache_percent:cachePercent(usage),
      measured_at_ms:at,model:this.model,source,turn_id:this.turnId};
    if(record(total)){
      this.outputTotal=integer(total.output_tokens);this.reasoningTotal=integer(total.reasoning_output_tokens);
    }else this.outputTotal+=output;
    this.turnOutput=record(turn)?integer(turn.output_tokens):this.turnOutput+output;
    if(rate!==null){this.turnGenerationMs+=duration;this.sampleCount++;}
    this.lastUsageAt=at;
    this.requestBoundary=!this.pendingCalls.size&&!this.responseToolsReturned?at:null;
    this.responseBoundary=null;this.responseOpen=this.responseToolsReturned=false;
  }
  snapshot(){
    return {model:this.model,stage:this.stage,last:this.last,timing_method:'response-request-average-v2',
      turn_id:this.turnId,turn_output_tokens:this.turnOutput,sample_count:this.sampleCount,output_total:this.outputTotal,
      turn_started_at_ms:this.turnStartedAt,turn_first_response_id:this.turnFirstResponseId,last_event_at_ms:this.eventAt};
  }
}
const MiB=1024*1024;
async function readAt(file,length,position){
  const buffer=Buffer.allocUnsafe(length);
  const {bytesRead}=await file.read(buffer,0,length,position);
  return buffer.subarray(0,bytesRead);
}
function decode(line){
  try{const result=JSON.parse(line);return record(result)?result:null;}catch{return null;}
}
class SessionTail{
  constructor(file,model=null,historyBytes=8*MiB,calculateSpeed=true){
    this.path=file;this.historyBytes=historyBytes;
    this.measurements=new Measurements(model,calculateSpeed);
    this.identity=null;this.mtimeNs=null;this.fileSize=0;this.modifiedAt=null;this.state='waiting';this.reset();
  }
  reset(){
    this.measurements=new Measurements(this.measurements.model,this.measurements.calculateSpeed);
    this.offset=0;this.partial=this.anchor=Buffer.alloc(0);this.initialized=false;this.discard=false;
  }
  async update(){
    let file;
    try{
      file=await fs.open(this.path,'r');
      const stat=await file.stat({bigint:true}),size=Number(stat.size),identity=stat.dev+':'+stat.ino;
      if(size<this.offset||this.identity!==null&&this.identity!==identity)this.reset();
      this.identity=identity;this.fileSize=size;this.modifiedAt=Number(stat.mtimeNs)/1e6;this.state='ok';
      const unchanged=this.mtimeNs===stat.mtimeNs;this.mtimeNs=stat.mtimeNs;
      if(this.initialized&&size===this.offset&&unchanged)return;
      if(this.initialized&&(size===this.offset||size-this.offset>16*MiB))this.reset();
      if(this.initialized&&this.anchor.length&&
        !(await readAt(file,this.anchor.length,this.offset-this.anchor.length)).equals(this.anchor))this.reset();
      if(!this.initialized){this.offset=Math.max(0,size-this.historyBytes);this.discard=this.offset>0;this.initialized=true;}
      const data=await readAt(file,Math.min(16*MiB,Math.max(0,size-this.offset)),this.offset);
      this.offset+=data.length;
      this.anchor=await readAt(file,Math.min(64,this.offset),Math.max(0,this.offset-64));
      this.state=this.offset>=size?'ok':'catching_up';
      if(!data.length)return;
      const bytes=this.partial.length?Buffer.concat([this.partial,data]):data;
      let start=0,end;
      while((end=bytes.indexOf(10,start))!==-1){
        if(!this.discard){const event=decode(bytes.toString('utf8',start,end));if(event)this.measurements.feed(event);}
        this.discard=false;start=end+1;
      }
      this.partial=this.discard?Buffer.alloc(0):Buffer.from(bytes.subarray(start));
      if(this.partial.length>16*MiB){this.partial=Buffer.alloc(0);this.discard=true;}
    }catch(error){
      if(!error.code)throw error;
      this.state='unavailable';
    }finally{await file?.close();}
  }
  source(){return {path:this.path,state:this.state,size:this.fileSize,offset:this.offset,modified_at_ms:this.modifiedAt};}
}
function touch(map,key,value,maximum){
  map.delete(key);map.set(key,value);
  while(map.size>maximum)map.delete(map.keys().next().value);
  return value;
}
class TailCache{
  constructor(maximum=8,calculateSpeed=true){this.tails=new Map();this.maximum=maximum;this.calculateSpeed=calculateSpeed;}
  async update(row,force=false){
    if(!row.rollout_path)return null;
    const old=this.tails.get(row.id);
    const normalize=file=>process.platform==='win32'?path.normalize(file).toLowerCase():path.normalize(file);
    const tail=!force&&old&&normalize(old.path)===normalize(row.rollout_path)?old:
      new SessionTail(row.rollout_path,row.model,undefined,this.calculateSpeed);
    touch(this.tails,row.id,tail,this.maximum);
    await tail.update();
    return tail;
  }
}
const resolveHome=value=>path.resolve(value?.replace(/^~(?=$|[\\/])/,os.homedir())||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
class ThreadRepository{
  constructor(home){this.home=resolveHome(home);this.database=null;this.state='missing';this.columns=new Set();this.rows=new Map();}
  query(file,callback){
    const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(file,{readOnly:true,timeout:25});
    try{return callback(db);}finally{db.close();}
  }
  get titleColumn(){return this.columns.has('name')?"COALESCE(NULLIF(name, ''), title)":"title";}
  get select(){
    const optional=['model','updated_at','archived'].map(key=>this.columns.has(key)?key:'NULL AS '+key);
    return 'SELECT id, '+this.titleColumn+' AS title, rollout_path, '+optional.join(', ')+' FROM threads';
  }
  async refresh(){
    const candidates=(await fs.readdir(this.home).catch(()=>[])).filter(name=>/^state_\d+\.sqlite$/.test(name))
      .sort((a,b)=>{const n=BigInt(b.slice(6,-7))-BigInt(a.slice(6,-7));return n>0n?1:n<0n?-1:0;});
    this.database=null;this.columns=new Set();this.rows=new Map();
    this.state=candidates.length?'unsupported':'missing';
    if(!candidates.length)return;
    const file=path.join(this.home,candidates[0]);
    try{
      this.query(file,db=>{
        const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(row=>row.name));
        if(!['id','title','rollout_path'].every(key=>columns.has(key)))return;
        this.columns=columns;this.database=file;
        this.rows=new Map(db.prepare(this.select+' ORDER BY updated_at DESC LIMIT 512').all().map(row=>[row.id,row]));
        this.state='ok';
      });
    }catch{this.state='unavailable';}
  }
  titleMatches(title){
    try{
      if(this.database)return this.query(this.database,db=>db.prepare(this.select+' WHERE '+this.titleColumn+' = ? ORDER BY updated_at DESC').all(title));
    }catch{}
    return [...this.rows.values()].filter(row=>row.title===title);
  }
}
module.exports={timestampMs,integer,cachePercent,requestRate,Measurements,SessionTail,TailCache,ThreadRepository,
  resolveHome,readAt,record,decode,touch};
