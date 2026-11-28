const fs=require('node:fs/promises'),path=require('node:path');
const {TailCache,record}=require('../features/statistics/host/collector/metrics.cjs');
const {SessionCatalog}=require('../features/statistics/host/collector/history.cjs');
const {MagpieMeasurements}=require('../features/statistics/host/collector/magpie.cjs');
const {createWriter}=require('./runtime-writer.cjs');
async function read(file){
  try{const value=JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));return record(value)?value:{};}
  catch{return {};}
}
function createSampler({settings,runtime,catalog=new SessionCatalog(settings.codexHome),magpie=new MagpieMeasurements()}){
  const tails=new TailCache(8,false);
  let lastKey,lastRefresh,matchedAt=-Infinity,matches=[],refresh=null;
  return async function sample(selection,once=false){
    const {title='',thread_id:id,refresh_id:refreshId,binding_mode:mode='auto'}=selection;
    const force=refreshId!==lastRefresh,key=JSON.stringify([title,id,mode]);
    await catalog.refresh(force||once);
    if(key!==lastKey||force||once||performance.now()-matchedAt>=500){
      matches=title?catalog.titleMatches(title):[];lastKey=key;matchedAt=performance.now();
    }
    let candidates=matches,selected=candidates.find(row=>row.id===id),label=title;
    if(mode==='activity'){
      const rows=[...catalog.rows.values()];
      candidates=rows.filter(row=>row.updated_at_ms===rows[0]?.updated_at_ms);
      selected=candidates.length===1?candidates[0]:null;label=selected?.title??'';
    }else if(mode==='manual'&&id)selected=catalog.rows.get(id);
    if(!selected&&candidates.length===1&&mode!=='manual')selected=candidates[0];
    const binding=selected?'ok':candidates.length>1?'ambiguous':'unbound';
    const tail=selected?await tails.update(selected,force):null;
    let metrics=tail?.measurements.snapshot()??null,source=tail?.source()??null;
    if(selected)[metrics,source]=await magpie.select(selected.id,metrics,source,force);
    if(force)refresh={request_id:refreshId??null,completed_at_ms:Date.now(),
      state:source?.state==='ok'?'ok':tail?'unavailable':binding,sample_at_ms:metrics?.last?.measured_at_ms??null};
    lastRefresh=refreshId;
    const saved=await read(path.join(runtime,'range-result.json'));
    return {schema_version:2,collector_pid:process.pid,repository_state:catalog.repository.state,binding,
      binding_mode:mode,thread_id:selected?.id??null,title:label,metrics,source,refresh,
      range:selected&&saved.thread_id===selected.id?saved:null,
      matches:candidates.map(({id,title,model,updated_at})=>({id,title,model:model??null,updated_at:updated_at??null})),
      threads:[...catalog.rows.values()].slice(0,80).map(({id,title,model})=>({id,title,model}))};
  };
}
function createCollector({settings,runtime,makeSampler=()=>createSampler({settings,runtime}),clock=Date.now}){
  const writer=createWriter(),attempts=[];
  let sample=null,pending=null,nextStart=0,nextPoll=0,lastExit=null,closed=false,current=null,lastPayload=null;
  function tick(now=clock()){
    while(attempts.length&&now-attempts[0]>=60000)attempts.shift();
    if(!closed&&!sample&&!pending&&now>=nextStart&&attempts.length<3){
      attempts.push(now);
      try{sample=makeSampler();}catch{lastExit=1;nextStart=now+1000;}
    }
    if(!closed&&sample&&!pending&&now>=nextPoll){
      pending=Promise.resolve().then(async()=>{
        const data=await sample(await read(path.join(runtime,'selection.json')));
        if(closed)return;
        const body=JSON.stringify(data),at=clock(),publish=body!==lastPayload||at-(current?.updated_at_ms??0)>=1000;
        if(publish){
          current={...data,updated_at_ms:at};lastPayload=body;
          writer.write(path.join(runtime,'metrics.json'),current);
        }
      }).catch(()=>{
        sample=null;current=null;lastPayload=null;lastExit=1;nextStart=clock()+1000;
      }).finally(()=>{pending=null;nextPoll=clock()+100;});
    }
    return {phase:sample&&!closed?'running':'backoff',attemptsInMinute:attempts.length,lastExit};
  }
  return {tick,snapshot:()=>current,async stop(){closed=true;current=null;await pending;}};
}
module.exports={createCollector,createSampler};
