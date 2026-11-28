const fs=require('node:fs'),path=require('node:path');
function observe(rec,receipt,runtime,owner,now=Date.now()){
  const phase=receipt.phase??'unknown',identity=owner?[owner.pid,owner.started]:null;
  const previous=rec.states.get('desktop');
  if((previous??null)!==JSON.stringify(owner??null)){
    if(previous&&previous!=='null'){
      const prior=JSON.parse(previous);
      const confirmed=receipt.desktopGone?.[0]===prior.pid&&receipt.desktopGone[1]===prior.started;
      rec.emit(confirmed?'desktop-exit-observed':'desktop-observation-ended',confirmed?'observed':'unknown',{pid:prior.pid});
    }
    if(owner)rec.emit('desktop-start-observed','observed',{pid:owner.pid},undefined,owner.started);
    rec.states.set('desktop',JSON.stringify(owner??null));
  }
  rec.change('connection',[phase,receipt.controllerPid??null],'connection-state',
    phase==='controller-running'?'success':'waiting',{phase});
  let state='waiting',count=0;
  if(phase==='controller-running'){
    try{
      const snapshot=JSON.parse(fs.readFileSync(path.join(runtime,'view-status.json'),'utf8'));
      const fresh=at=>Number.isFinite(at)&&now-at>=-2000&&now-at<8000;
      if(snapshot.controllerPid!==receipt.controllerPid||!fresh(snapshot.checkedAt))state='unavailable';
      else{
        const windows=snapshot.windows??[];
        count=windows.length;
        const ready=windows.every(window=>fresh(window.checkedAt)&&Number.isInteger(window.fileChanges?.cards)&&
          !(window.readingWidth?.reason??'').startsWith('layout-or-settings'));
        const applicable=windows.some(window=>window.visible&&window.readingWidth?.applied);
        state=!ready?'unavailable':applicable?'loaded':'waiting';
      }
    }catch{state='unavailable';}
  }
  rec.change('enhancement',[identity,state,count],'enhancement-state',state,{window_count:count,loaded:state==='loaded'});
}
module.exports={observe};
