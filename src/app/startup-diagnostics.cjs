const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{parseArgs}=require('node:util');
const {run,Checks}=require('../lifecycle/diagnostics/checks.cjs'),{row,t}=require('../lifecycle/diagnostics/results.cjs');
const events=require('../lifecycle/runtime_events.cjs');
const {appearance}=require('../platform/codex/settings.cjs');
const {ROOT,read,atomic,stateFor}=require('../platform/paths.cjs');
const states=['pass','warning','fail','unknown','notApplicable'];
function readProbe(target){
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(systemroot|windir|path|temp|tmp)$/i.test(key)));
  env.BETTER_CODEX_PROMPT_DIAGNOSTICS='read-only';
  const exe=/\.exe$/i.test(target);
  return new Promise(resolve=>{
    const child=spawn(exe?target:process.execPath,exe?[]:[target],{
      cwd:path.dirname(target),env,windowsHide:true,stdio:['ignore','pipe','ignore']});
    const stop=()=>{clearTimeout(timer);child.stdout.destroy();child.kill();resolve(null);};
    const timer=setTimeout(stop,2000),chunks=[];
    let total=0;
    child.stdout.on('data',chunk=>{
      total+=chunk.length;
      if(total>4096)stop();else chunks.push(chunk);
    });
    child.stdout.on('error',stop);
    child.on('error',stop);
    child.on('close',code=>{
      clearTimeout(timer);
      try{resolve(code===0?JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'')):null);}
      catch{resolve(null);}
    });
  });
}
async function promptProbe(checks){
  let state='notApplicable';
  try{
    const target=checks.settings.promptDiagnosticsCommand||checks.settings.promptDiagnosticsProbe;
    if(typeof target==='string'&&path.isAbsolute(target)&&/\.(exe|cjs|mjs|js)$/i.test(target)&&fs.statSync(target).isFile()){
      const data=await readProbe(target);
      if(states.includes(data?.state))state=data.state;
    }
  }catch{}
  return row('prompts',state,state==='notApplicable'?t('promptUnavailable'):'');
}
function saveFailure(output,error){
  const kind=['Error','TypeError','SyntaxError','RangeError','ReferenceError'].includes(error.name)?error.name:'Error';
  const frames=String(error.stack??'').split('\n').slice(1).flatMap(line=>{
    const m=/^\s+at\s+(?:([A-Za-z_$][\w.$]*) \()?([^()\r\n]*[\\/]([\w-]+\.cjs)):(\d+):\d+\)?$/.exec(line);
    if(!m||!path.isAbsolute(m[2]))return [];
    const rel=path.relative(path.join(ROOT,'src'),m[2]);
    return rel&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel)&&fs.existsSync(m[2])?
      [{file:m[3],line:Number(m[4]),function:m[1]??''}]:[];
  });
  try{atomic(path.join(path.dirname(output),'failure.json'),JSON.stringify({checkedAtUtc:new Date().toISOString(),
    workerPid:process.pid,errorType:kind,errno:Number.isInteger(error.errno)?error.errno:null,winerror:null,frames}));}catch{}
}
async function main(args){
  const options=Object.fromEntries('settings output appearance finish acknowledge-prompt correlation-id instance'.split(' ').map(k=>[k,{type:'string'}]));
  options['after-update']={type:'boolean'};
  const {values:v}=parseArgs({args,options});
  if(v.appearance){console.log(JSON.stringify(await appearance(v.appearance)));return;}
  if(v['acknowledge-prompt']!==undefined||!v.settings||!v.output)throw Error();
  const instance=v.instance||events.correlation();
  const id=v['correlation-id']||events.updateCorrelation(stateFor(v.settings),v['after-update']);
  const rec=events.recorder(v.settings,'diagnostics',id);
  if(v.finish){
    if(!['workerTimeout','workerStopped','cancelled'].includes(v.finish))throw Error();
    try{
      let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>65536)return;}
      events.diagnostic(rec,JSON.parse(raw.replace(/^\uFEFF/,'')),instance,v.finish);
    }catch{}
    return;
  }
  try{await run(v.settings,v.output,{afterUpdate:v['after-update'],checks:new Checks(v.settings,{prompts:promptProbe}),
    observe(data){
      data.correlation_id=rec.correlation_id;
      if(data.relaunch)data.relaunch.correlation_id=rec.correlation_id;
      events.diagnostic(rec,data,instance);
    }});}
  catch(error){
    saveFailure(v.output,error);
    try{let data;try{data=read(v.output);}catch{data={};}events.diagnostic(rec,data,instance,'workerStopped');}catch{}
    throw error;
  }
}
if(require.main===module)main(process.argv.slice(2)).catch(()=>{process.exitCode=1;});
module.exports={main,promptProbe,readProbe,saveFailure};
