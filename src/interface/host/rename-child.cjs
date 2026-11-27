// Own only the directly spawned naming subprocess, never a PID found by name.
function trackRenameChild(child){
  let closed=false,stopping=false,reap;
  const done=new Promise(resolve=>child.once('close',code=>{
    closed=true;
    clearTimeout(reap);
    resolve(code);
  }));
  function kill(){
    if(!closed&&!stopping){
      stopping=true;
      clearTimeout(reap);
      if(child.pid&&child.exitCode===null&&child.signalCode===null)child.kill();
      child.stdin.destroy();
      child.stdout.destroy();
    }
    return done;
  }
  function end(){
    if(!closed&&!stopping&&!reap){
      // Give an idle App Server time to exit on EOF before stopping our child.
      reap=setTimeout(kill,1000);
      child.stdin.end();
    }
    return done;
  }
  return {done,kill,end};
}
module.exports={trackRenameChild};
