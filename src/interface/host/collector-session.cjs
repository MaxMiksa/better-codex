const {spawn}=require('node:child_process'),path=require('node:path');

function createCollector({settings,runtime,launch=spawn}){
  let child=null,failed=false,nextStart=0,startedAt=0,lastExit=null;
  const attempts=[];
  function tick(now=Date.now()){
    if(child&&(failed||child.exitCode!==null||child.signalCode!==null)){
      lastExit=child.exitCode;child=null;failed=false;nextStart=now+1000;
    }
    while(attempts.length&&now-attempts[0]>=60000)attempts.shift();
    if(!child&&now>=nextStart&&attempts.length<3){
      attempts.push(now);startedAt=now;
      try{
        child=launch(settings.python,['-I','-X','utf8',path.join(settings.collectorDir,'metrics.py'),
          '--runtime',runtime,'--codex-home',settings.codexHome,'--parent-pid',String(process.pid)],{windowsHide:true,stdio:'ignore'});
        const started=child;
        child.on('error',()=>{if(child===started)failed=true;});
      }catch{child=null;failed=false;nextStart=now+1000;}
    }
    return {phase:child&&!failed?'running':'backoff',attemptsInMinute:attempts.length,lastExit};
  }
  function accepts(data){return Boolean(child&&!failed&&child.exitCode===null&&child.signalCode===null&&data?.collector_pid===child.pid&&data.updated_at_ms>=startedAt);}
  async function stop(){
    if(child&&child.exitCode===null&&child.signalCode===null){
      await new Promise(resolve=>{child.once('exit',resolve);child.once('error',resolve);if(!child.kill())resolve();});
    }
    child=null;
  }
  return {tick,accepts,stop};
}
module.exports={createCollector};
