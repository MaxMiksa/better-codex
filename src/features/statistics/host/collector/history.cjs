// Local rollout discovery and weighted history; see LICENSE and VERSION.
const fs=require('node:fs/promises'),path=require('node:path'),{createHash}=require('node:crypto');
const {Measurements,ThreadRepository,timestampMs,resolveHome,readAt,decode,touch}=require('./metrics.cjs');
const MiB=1024*1024;
async function* events(name){
  const {createInterface}=require('node:readline');
  const stream=require('node:fs').createReadStream(name,{encoding:'utf8'});
  // Open before readline attaches; its async iterator does not forward input errors.
  try{
    await require('node:events').once(stream,'open');
    let failure;
    stream.on('error',error=>{failure=error;lines.close();});
    const lines=createInterface({input:stream,crlfDelay:Infinity});
    for await(const line of lines){const value=decode(line);if(value)yield value;}
    if(failure)throw failure;
  }finally{stream.destroy();}
}
async function* rollouts(directory){
  let entries;
  try{entries=await fs.opendir(directory);}catch{return;}
  for await(const entry of entries){
    const name=path.join(directory,entry.name);
    if(entry.isDirectory())yield* rollouts(name);
    else if(entry.isFile()&&entry.name.endsWith('.jsonl'))yield name;
  }
}
const signature=stat=>[stat.size,stat.mtimeNs,stat.ino].join(':');
class SessionCatalog{
  constructor(home,logs=[]){
    this.home=resolveHome(home);this.logs=logs.map(resolveHome);this.repository=new ThreadRepository(this.home);
    this.files=new Map();this.rows=new Map();this.updated=-Infinity;
  }
  async inspect(name,old){
    const stat=await fs.stat(name,{bigint:true}),sig=signature(stat),size=Number(stat.size);
    if(old?.signature===sig)return old;
    const file=await fs.open(name,'r');
    try{
      const head=await readAt(file,Math.min(size,4*MiB),0);
      const end=head.indexOf(10),first=decode(end<0?head:head.subarray(0,end));
      const meta=first?.type==='session_meta'?first.payload??{}:{};
      const created=timestampMs(meta.timestamp)??0;
      const tail=await readAt(file,Math.min(65536,size),Math.max(0,size-65536));
      let recorded=null;
      for(const line of tail.toString('utf8').split('\n').reverse()){
        recorded=timestampMs(decode(line)?.timestamp);
        if(recorded!==null)break;
      }
      return {path:name,id:typeof meta.id==='string'?meta.id:null,signature:sig,
        updated_at_ms:Math.max(created,recorded??Number(stat.mtimeNs)/1e6),created_at_ms:created,
        model:meta.model??null,cwd:typeof meta.cwd==='string'?meta.cwd:'',size};
    }finally{await file.close();}
  }
  async refresh(force=false){
    if(!force&&performance.now()-this.updated<2000)return;
    await this.repository.refresh();
    const paths=new Set(this.logs);
    if(!this.logs.length){
      for(const dir of ['sessions','archived_sessions'])
        for await(const name of rollouts(path.join(this.home,dir)))paths.add(name);
      for(const row of this.repository.rows.values())if(row.rollout_path)paths.add(row.rollout_path);
    }
    const found=new Map(),titles=new Map(),grouped=new Map(),rows=[];
    for(const name of paths){
      try{
        const key=await fs.realpath(name);
        let info=await this.inspect(name,this.files.get(key));
        if(!info.id&&this.logs.includes(name))info={...info,id:'file:'+key};
        if(info.id)found.set(key,info);
      }catch(error){if(!error.code)throw error;}
    }
    try{
      for await(const entry of events(path.join(this.home,'session_index.jsonl')))
        if(entry.id&&typeof entry.thread_name==='string')titles.set(entry.id,entry.thread_name);
    }catch(error){if(!error.code)throw error;}
    for(const info of found.values()){
      const group=grouped.get(info.id)??[];
      group.push(info);grouped.set(info.id,group);
    }
    for(const [id,segments] of grouped){
      const latest=segments.reduce((a,b)=>b.updated_at_ms>a.updated_at_ms||
        b.updated_at_ms===a.updated_at_ms&&b.created_at_ms>a.created_at_ms?b:a);
      const existing=this.repository.rows.get(id);
      rows.push([id,{...existing,id,title:existing?.title||titles.get(id)||path.basename(latest.cwd)||id,
        model:existing?.model||latest.model,rollout_path:latest.path,updated_at_ms:latest.updated_at_ms,segment_count:segments.length}]);
    }
    this.files=found;this.rows=new Map(rows.sort((a,b)=>b[1].updated_at_ms-a[1].updated_at_ms));this.updated=performance.now();
  }
  segments(id){
    return [...this.files.values()].filter(file=>file.id===id)
      .sort((a,b)=>a.created_at_ms-b.created_at_ms||(a.path<b.path?-1:a.path>b.path?1:0)).map(file=>file.path);
  }
  titleMatches(title){
    const rows=new Map(this.repository.titleMatches(title).map(row=>[row.id,row]));
    for(const row of this.rows.values())if(row.title===title||rows.has(row.id))rows.set(row.id,row);
    return [...rows.values()];
  }
}
function userText(event){
  const p=event.payload;
  let text;
  if(event.type==='event_msg'&&p?.type==='user_message')text=p.message;
  else if(event.type==='response_item'&&p?.type==='message'&&p.role==='user'&&Array.isArray(p.content))
    text=p.content.flatMap(item=>typeof item?.text==='string'?[item.text]:[]).join('\n');
  if(typeof text!=='string'||!(text=text.trim()))return null;
  return /^(?:<environment_context>|<permissions instructions>|<collaboration_mode>|<user_instructions>|# AGENTS.md instructions|<turn_aborted>)/.test(text)?null:text;
}
const publicMessage=({id,at_ms,preview})=>({id,at_ms,preview});
class History{
  constructor(){this.samples=[];this.messages=[];this.warnings=[];this.last=null;}
  static async load(paths,model=null){
    const history=new History(),metrics=new Measurements(model),responses=new Set(),messages=new Set();
    const canonical=new Map(),fallback=[];
    async function* safe(file){
      try{yield* events(file);}catch(error){
        if(!error.code)throw error;
        history.warnings.push('有日志文件不可读，结果可能不完整');
      }
    }
    const streams=paths.map(file=>safe(file)),heads=[];
    try{
      for(const stream of streams)heads.push(await stream.next());
      for(;;){
        // Stable streaming merge, keeping the original event order within each rollout.
        let index=-1,earliest=Infinity;
        for(let i=0;i<heads.length;i++)if(!heads[i].done){
          const at=timestampMs(heads[i].value.timestamp)??0;
          if(at<earliest){index=i;earliest=at;}
        }
        if(index<0)break;
        const event=heads[index].value;
        heads[index]=await streams[index].next();
        const at=timestampMs(event.timestamp),text=userText(event);
        if(text&&at!==null){
          const key=JSON.stringify([at,text]);
          if(!messages.has(key)){
            messages.add(key);
            const message={at_ms:at,text};
            if(event.type==='event_msg'){
              history.messages.push(message);
              const times=canonical.get(text)??[];
              times.push(at);canonical.set(text,times);
            }else fallback.push(message);
          }
        }
        const id=event.type==='token_usage_record'&&event.payload?.response_id;
        if(id){if(responses.has(id))continue;responses.add(id);}
        const previous=metrics.last;
        metrics.feed(event);
        if(metrics.last!==previous)history.samples.push({...metrics.last});
      }
    }finally{await Promise.all(streams.map(stream=>stream.return()));}
    history.messages.push(...fallback.filter(m=>!(canonical.get(m.text)??[]).some(t=>Math.abs(t-m.at_ms)<2000)));
    history.messages.sort((a,b)=>a.at_ms-b.at_ms);
    for(const m of history.messages){
      m.id=Math.trunc(m.at_ms)+':'+createHash('sha256').update(m.text).digest('hex').slice(0,16);
      m.preview=[...m.text.replace(/\s+/g,' ')].slice(0,240).join('');
    }
    history.last=metrics.snapshot();
    return history;
  }
  findMessages(query='',limit=100){
    query=query.trim().toLowerCase();
    return this.messages.filter(m=>m.text.toLowerCase().includes(query)).slice(-limit).map(publicMessage);
  }
  calculate(selection){
    const {mode}=selection;
    let start,end,bounds;
    const exclusive=mode==='messages';
    if(exclusive){
      const first=this.messages.findIndex(m=>m.id===selection.first_id),last=this.messages.findIndex(m=>m.id===selection.last_id);
      if(first<0||last<0)throw Error('请先从搜索结果中选定首尾两条用户消息');
      if(first>last)throw Error('首条消息必须早于或等于末条消息');
      start=this.messages[first].at_ms;end=this.messages[last+1]?.at_ms??Infinity;
      bounds={first:publicMessage(this.messages[first]),last:publicMessage(this.messages[last])};
    }else if(mode==='time'){
      start=timestampMs(selection.start);end=timestampMs(selection.end);
      if(start===null||end===null||start>end)throw Error('请输入有效的起止时间，结束时间不能早于开始时间');
      bounds={start_ms:start,end_ms:end};
    }else throw Error('请选择时间段或消息范围');
    const selected=this.samples.filter(s=>s.measured_at_ms>=start&&(exclusive?s.measured_at_ms<end:s.measured_at_ms<=end));
    const timed=selected.filter(s=>s.rate!==null),cached=selected.filter(s=>s.cache_percent!==null);
    const sum=(samples,key)=>samples.reduce((total,s)=>total+s[key],0);
    const seconds=sum(timed,'duration_ms')/1000,output=sum(timed,'output_tokens');
    const inputs=sum(cached,'input_tokens'),cache=sum(cached,'cached_input_tokens'),basis={};
    for(const sample of timed)basis[sample.basis]=(basis[sample.basis]??0)+1;
    return {mode,bounds,rate:seconds?output/seconds:null,cache_percent:inputs?100*cache/inputs:null,
      output_tokens:sum(selected,'output_tokens'),timed_output_tokens:output,duration_seconds:seconds,
      input_tokens:inputs,cached_input_tokens:cache,sample_count:selected.length,timed_samples:timed.length,
      cache_samples:cached.length,timing_basis:basis,models:[...new Set(selected.map(s=>s.model).filter(Boolean))].sort(),
      warnings:this.warnings,confirmed_at_ms:Date.now()};
  }
}
class HistoryCache{
  constructor(maximum=3){this.entries=new Map();this.maximum=maximum;}
  async load(catalog,id,force=false){
    const files=catalog.segments(id);
    if(!files.length)throw Error('此对话没有可读的本地日志');
    const sig=JSON.stringify(await Promise.all(files.map(async file=>[file,await fs.stat(file,{bigint:true}).then(signature,()=>null)])));
    const old=this.entries.get(id);
    const entry=!force&&old?.signature===sig?old:{signature:sig,history:await History.load(files)};
    return touch(this.entries,id,entry,this.maximum).history;
  }
}
module.exports={events,SessionCatalog,userText,History,HistoryCache};
