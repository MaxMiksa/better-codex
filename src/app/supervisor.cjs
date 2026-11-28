// Own one enhancement supervisor per canonical runtime directory.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),{createHash}=require('node:crypto');
const {parseArgs}=require('node:util'),{setTimeout:sleep}=require('node:timers/promises');
const {DisplayConnection}=require('../runtime/connection.cjs');
const {UpdateRecovery}=require('../lifecycle/recovery/update-recovery.cjs');
const lifecycle=require('../lifecycle/runtime_events.cjs'),{observe}=require('../runtime/runtime_events.cjs');
const {Recorder}=require('../platform/observability/store.cjs'),{validId}=require('../platform/observability/events.cjs');
const {readSettings}=require('../platform/codex/settings.cjs');

function observationCorrelation(runtime,recovery,fallback,now=Date.now()){
  const id=recovery.correlation_id,valid=validId(id);
  try{
    const launch=readSettings(path.join(runtime,'launch-request.json')),checked=Date.parse(launch.checkedAtUtc);
    if(validId(launch.correlation_id)&&Number.isFinite(checked)){
      if(valid&&recovery.checkedAt>checked/1000)return id;
      const age=now-checked;
      return age>=-2000&&age<120000?launch.correlation_id:fallback;
    }
  }catch{}
  return valid?id:fallback;
}
function publishStatus(status,receipt,diagnostics){
  const temp=status.replace(/\.json$/,'.next');
  try{fs.writeFileSync(temp,JSON.stringify(receipt));fs.renameSync(temp,status);return true;}
  catch(error){
    if(diagnostics){diagnostics.failures++;diagnostics.lastError={errno:error.errno??null,winerror:null};}
    return false;
  }
}
async function claim(runtime){
  const real=fs.realpathSync.native(runtime);
  const key=createHash('sha256').update(process.platform==='win32'?real.toLowerCase():real).digest('hex').slice(0,32);
  const endpoint=process.platform==='win32'?'\\\\.\\pipe\\BetterCodex.Supervisor.'+key:path.join(real,'supervisor.sock');
  const server=net.createServer(socket=>socket.destroy());
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(endpoint,resolve);
    });
    return ()=>new Promise(resolve=>server.close(resolve));
  }catch(error){if(error.code==='EADDRINUSE'||error.code==='EACCES')return null;throw error;}
}
async function run(settingsPath,runtime,{connect=(settings)=>new DisplayConnection(settings,settingsPath,runtime),
  monitor=()=>new UpdateRecovery(settingsPath,runtime),pause=()=>sleep(3000),now=Date.now,signal}={}){
  const settings=readSettings(settingsPath);
  fs.mkdirSync(runtime,{recursive:true});
  const release=await claim(runtime);
  if(!release)return false;
  const stop=path.join(runtime,'stop'),status=path.join(runtime,'supervisor.json');
  const writes={failures:0,lastError:null};
  let display,events;
  try{
    display=connect(settings);
    const recovery=monitor();
    events=new Recorder(runtime,'supervisor',lifecycle.correlation());
    events.emit('backend-started','started');
    while(!fs.existsSync(stop)&&!signal?.aborted){
      let receipt;
      try{receipt=await display.tick();}catch{receipt={phase:'connection-check-unavailable'};}
      receipt.checkedAt=now()/1000;
      receipt.updateRecovery=await recovery.tick();
      try{
        events.flush();
        lifecycle.update(events,receipt.updateRecovery);
        events.correlation_id=observationCorrelation(runtime,receipt.updateRecovery,events.correlation_id,now());
        observe(events,receipt,runtime,display.owner,now());
      }catch{} // History failure must not change enhancement or update behavior.
      receipt.writes=writes;
      publishStatus(status,receipt,writes);
      if(!fs.existsSync(stop)&&!signal?.aborted)await pause();
    }
  }finally{
    try{
      try{fs.closeSync(fs.openSync(stop,'a'));}catch{}
      await display?.stop();
      events?.emit('backend-stopped','stopped');
      publishStatus(status,{phase:'stopped',checkedAt:now()/1000,writes},writes);
    }finally{await release();}
  }
  return true;
}
if(require.main===module)(async()=>{
  const [major,minor,patch]=process.versions.node.split('.').map(Number);
  if(major!==24||minor<11||minor===11&&patch<1)throw Error('Node 24.11.1+ required');
  const {values}=parseArgs({options:{settings:{type:'string'},runtime:{type:'string'}}});
  if(!values.settings||!values.runtime)throw Error();
  const abort=new AbortController();
  process.once('SIGINT',()=>abort.abort());process.once('SIGTERM',()=>abort.abort());
  await run(path.resolve(values.settings),path.resolve(values.runtime),{signal:abort.signal});
})().catch(()=>{process.exitCode=1;});
module.exports={run,claim,observationCorrelation,publishStatus};
