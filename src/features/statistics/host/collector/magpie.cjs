// Only completed measurements from a bounded, unauthenticated loopback GET.
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {timestampMs,requestRate,record,touch}=require('./metrics.cjs');
const counter=(row,key)=>Number.isInteger(row[key])&&row[key]>=0?row[key]:null;
const basis='magpie-native-speed-v1',maxBytes=2*1024*1024;
const unrelated=['source','computer','via','subagent','parent_agent','kind','handed_on','rejected','err','err_type'];
function gatewaySample(row,id,native,now,maxAge=900000){
  const last=native.last??{};
  if(!last.response_id||row.response_id!==last.response_id||(row.native_session||row.session)!==id||
    row.agent!=='codex'||row.status!==200||unrelated.some(key=>row[key]))return null;
  const start=timestampMs(row.t),duration=counter(row,'ms'),output=counter(row,'out');
  if(start===null||duration===null||duration<50||!output)return null;
  const end=start+duration;
  if(!Number.isFinite(end)||end>now||maxAge!==null&&now-end>=maxAge||
    native.turn_started_at_ms!=null&&start<native.turn_started_at_ms||native.turn_id&&last.turn_id!==native.turn_id)return null;
  const [inputs,cached,written]=['in','cache_read','cache_write'].map(key=>counter(row,key));
  if([inputs,cached,written].includes(null))return null;
  const total=inputs+cached+written,ttft=counter(row,'ttft_ms'),rate=row.native_speed;
  const unknown=row.cache_unknown||['kiro','kiro-plugin'].includes(row.provider)&&!cached&&!written;
  return {...last,rate:Number.isFinite(rate)&&rate>0?rate:null,rate_basis:basis,ttft_ms:ttft>0&&ttft<=duration?ttft:null,
    duration_ms:duration,basis:'request',input_tokens:total,cached_input_tokens:cached,output_tokens:output,
    reasoning_output_tokens:counter(row,'reasoning')??0,cache_percent:total&&!unknown?100*cached/total:null,
    measured_at_ms:end,source:'magpie'};
}
class HttpStatus extends Error{}
class TransportError extends Error{}
function get(port,query){
  return new Promise((resolve,reject)=>{
    const req=http.get({hostname:'127.0.0.1',port,path:'/v1/magpie/usage/requests?'+query,agent:false},res=>{
      if(res.statusCode!==200){reject(new HttpStatus());res.destroy();return;}
      const chunks=[];let size=0;
      res.on('error',()=>reject(new TransportError()));
      res.on('data',chunk=>{
        size+=chunk.length;
        if(size>maxBytes){reject(new TypeError('Gateway response too large'));res.destroy();}
        else chunks.push(chunk);
      });
      res.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    });
    const deadline=setTimeout(()=>req.destroy(new TransportError()),750);
    req.on('close',()=>clearTimeout(deadline));
    req.on('error',()=>reject(new TransportError()));
  });
}
const fields=['route_id','response_id','native_session','session','agent',...unrelated.filter(k=>!k.startsWith('err')),
  'status','t','ms','out','in','cache_read','cache_write','cache_unknown','provider','reasoning','ttft_ms'];
class MagpieMeasurements{
  constructor(settings=path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'magpie','settings.json'),
    {clock=()=>performance.now(),now=Date.now}={}){
    Object.assign(this,{settings,clock,now,key:null,nextPoll:0,rows:[],available:null,connectionFailures:0,
      turnTtfts:new Map(),routeSpeeds:new Map(),turnSpeeds:new Map(),speedRetry:[null,0]});
  }
  async fetch(id,limit=20,route){
    let raw;
    try{raw=await fs.readFile(this.settings,'utf8');}catch{throw new TransportError();}
    const settings=JSON.parse(raw.replace(/^\uFEFF/,''));
    if(!record(settings))throw new TypeError('Invalid gateway settings');
    const port=Object.hasOwn(settings,'port')?settings.port:3425;
    if(!Number.isInteger(port)||port<1||port>65535)throw new TypeError('Invalid local gateway port');
    const params=new URLSearchParams({agent:'codex',via:'through',period:'all',q:id,limit});
    if(route!==undefined)params.set('route',route);
    const result=JSON.parse(await get(port,params));
    if(!record(result)||!Array.isArray(result.rows))throw new TypeError('Unsupported gateway measurements');
    return result;
  }
  async read(id,limit){
    const {rows}=await this.fetch(id,limit);
    return rows.filter(record).map(row=>({...Object.fromEntries(fields.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])),
      err:Boolean(row.err||row.err_type)}));
  }
  async nativeSpeed(id,row){
    const route=counter(row,'route_id');
    if(!route||!row.response_id)return null;
    const key=JSON.stringify([id,route,row.response_id]);
    if(this.routeSpeeds.has(key))return touch(this.routeSpeeds,key,this.routeSpeeds.get(key),16);
    if(this.speedRetry[0]===key&&this.clock()<this.speedRetry[1])return null;
    let result;
    try{result=await this.fetch(id,20,route);}
    catch{this.speedRetry=[key,this.clock()+2000];return null;}
    const r=result.rows[0],output=counter(result,'decode_out'),duration=counter(result,'decode_ms');
    const rate=result.rows.length===1&&record(r)&&r.response_id===row.response_id&&counter(r,'route_id')===route&&
      (r.native_session||r.session)===id&&counter(result,'calls')===1&&counter(result,'decode_n')===1&&output&&duration?
      output*1000/duration:null;
    return touch(this.routeSpeeds,key,rate,16);
  }
  scope(map,parts,initial){
    const key=JSON.stringify(parts),fresh=!map.has(key);
    if(fresh)for(const old of map.keys())if(JSON.parse(old)[0]===parts[0])map.delete(old);
    return [key,fresh,touch(map,key,fresh?initial:map.get(key),8)];
  }
  async select(id,native,source,force=false){
    const clock=this.clock();
    if(id!==this.key)this.rows=[];
    const backoff=this.available===false&&clock<this.nextPoll;
    if(!backoff&&(id!==this.key||force||clock>=this.nextPoll)){
      this.key=id;this.nextPoll=clock+2000;
      try{this.rows=await this.read(id);this.available=true;this.connectionFailures=0;}
      catch(error){
        this.rows=[];
        if(error instanceof TransportError){if(++this.connectionFailures>=3)this.available=false;}
        else{this.available=error instanceof HttpStatus?true:null;this.connectionFailures=0;}
      }
      if(this.available===false)this.nextPoll=clock+30000;
    }
    if(!native)return [native,source];
    const start=native.turn_started_at_ms;
    const state=start==null?null:this.scope(this.turnSpeeds,[id,native.turn_id,start],
      {mode:this.available===false?'local':'magpie',sample:null})[2];
    const mode=state?.mode??'magpie';
    let result=native;
    if(mode==='local'){
      if(native.last)result={...native,last:{...native.last,rate:requestRate(native.last),rate_basis:'response-request-average-v2'}};
    }else [result,source]=await this.selectSample(id,native,source);
    if(state){
      const s=result.last??{};
      if(mode==='local')state.sample=null;
      if(Number.isFinite(s.rate)&&s.rate>0&&s.measured_at_ms>=start&&(!native.turn_id||s.turn_id===native.turn_id)&&
        (mode==='local'||s.source==='magpie'&&s.rate_basis===basis)&&(!state.sample||s.measured_at_ms>=state.sample.measured_at_ms)){
        state.sample={...Object.fromEntries(['rate','rate_basis','source','response_id','model','turn_id','measured_at_ms']
          .map(key=>[key,s[key]??null])),turn_started_at_ms:start};
      }
    }
    return [{...result,speed_mode:mode,turn_speed:state?.sample?{...state.sample}:null},source];
  }
  async selectSample(id,native,source){
    if(!native.last)return [native,source];
    const first=native.turn_first_response_id,start=native.turn_started_at_ms;
    if(first&&start!=null){
      const [key,fresh,cached]=this.scope(this.turnTtfts,[id,native.turn_id,start,first],null);
      let ttft=cached;
      if(ttft===null){
        if(fresh&&this.rows.length&&!this.rows.some(row=>row.response_id===first)){
          try{this.rows=await this.read(id,500);}catch{} // Retain latest sample on lookup failure.
        }
        const view={...native,last:{...native.last,response_id:first,turn_id:native.turn_id}};
        const firstSamples=this.rows.map(row=>gatewaySample(row,id,view,this.now(),null)).filter(Boolean);
        if(firstSamples.length===1){ttft=firstSamples[0].ttft_ms;this.turnTtfts.set(key,ttft);}
      }
      if(ttft!==null)native={...native,turn_ttft_ms:ttft};
    }
    const samples=this.rows.map(row=>[row,gatewaySample(row,id,native,this.now())]).filter(([,sample])=>sample);
    if(samples.length!==1)return [native,source]; // Ambiguous response identities fail closed.
    const [row,sample]=samples[0];
    sample.rate=await this.nativeSpeed(id,row);
    return [{...native,last:sample},{state:'ok',provider:'magpie'}];
  }
}
module.exports={gatewaySample,MagpieMeasurements,TransportError,HttpStatus};
