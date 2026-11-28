// Independent from the diagnostic form and the enhancement supervisor.
const fs=require('node:fs'),path=require('node:path'),{isDeepStrictEqual,parseArgs}=require('node:util');
const {setTimeout:sleep}=require('node:timers/promises');
const {read,atomic,stateFor,removeFile}=require('../../platform/paths.cjs');
const {withSettingsLock}=require('../../platform/windows/native.cjs');
const restart=require('./desktop-restart.cjs'),{assess}=require('./session-activity.cjs');
const events=require('../runtime_events.cjs'),{newer}=require('./update-recovery.cjs');
const versionPattern=/^\d+(?:\.\d+){3}$/;
const keyPattern=/^(?:plugins|update):\d+(?:\.\d+){3}$/;
const noncePattern=/^[a-f0-9]{32}$/;
const json=(file,value)=>atomic(file,JSON.stringify(value));
const fileFor=settings=>path.join(stateFor(settings),'startup-relaunch.json');
function load(settings){
  const file=fileFor(settings);
  return fs.existsSync(file)?read(file):{attempted:[]};
}
const save=(settings,state)=>json(fileFor(settings),state);
const raised=(a,b)=>versionPattern.test(b??'')&&newer(a,b);
function remember(state,...keys){state.attempted=[...new Set([...state.attempted,...keys])].slice(-32);}
function rejectUpdate(state,key){
  remember(state,key);
  if(!key.startsWith('update:'))return;
  const version=key.slice(7);
  if(state.pendingUpdate===version)delete state.pendingUpdate;
  if(!state.observedVersion||raised(version,state.observedVersion))state.observedVersion=version;
}
class Busy extends Error{}
function createRecovery({platform=restart.createDesktopPlatform(),preflight=restart.preflight,start=restart.start,
  close=restart.close,verified=restart.verified,activity=assess,lock=withSettingsLock,delay=sleep,
  clock=Date.now,emit=events.recovery}={}){
  async function locked(settings,callback,action=false){
    // Planning/cancellation is short. The separate action lock serializes close
    // and normal activation without preventing concurrent durable cancellation.
    let entered=false;
    try{return await lock(fileFor(settings)+(action?'.action':''),()=>{entered=true;return callback();});}
    catch(error){if(!entered)throw new Busy();throw error;}
  }
  const publish=(...args)=>{try{emit(...args);}catch{}};
  async function prepare(file,pkg,enhancement,afterUpdate=false){
    const settings=read(file);
    await preflight(settings);
    const running=await platform.desktops(pkg),mains=running.filter(p=>p.main);
    if(mains.length>1||running.length&&!mains.length)return {allowed:false};
    const target=mains[0]??null,observed=await activity(settings,target);
    return locked(file,()=>{
      const state=load(file),version=pkg.packageVersion,update='update:'+version,fault='plugins:'+version;
      if(afterUpdate||raised(version,state.observedVersion))state.pendingUpdate=version;
      state.observedVersion=version;
      if(enhancement.state==='pass')state.attempted=state.attempted.filter(key=>key!==fault);
      if(state.pendingUpdate===version&&state.attempted.includes(update))delete state.pendingUpdate;
      const updated=state.pendingUpdate===version,key=updated?update:fault;
      const pluginFailure=enhancement.restartRecommended===true,needed=updated||pluginFailure;
      const automatic=needed&&!state.attempted.includes(key);
      const cancelledForActivity=automatic&&observed.state!=='idle';
      if(cancelledForActivity){rejectUpdate(state,key);if(pluginFailure)remember(state,fault);}
      save(file,state);
      return {allowed:observed.state==='idle',needed,automatic:automatic&&!cancelledForActivity,cancelledForActivity,
        pluginFailure,activity:observed,key,reason:updated?'updated':'plugins',packageVersion:version,packageHash:pkg.sha256,target};
    });
  }
  async function cancel(file,key,{pluginFailure=false,id,activityBlock=false}={}){
    if(!keyPattern.test(key))throw Error('Invalid recovery key');
    await locked(file,()=>{
      const state=load(file);rejectUpdate(state,key);
      if(pluginFailure)remember(state,'plugins:'+key.split(':')[1]);
      save(file,state);
    });
    publish(file,activityBlock?'recovery-blocked':'recovery-cancelled',activityBlock?'blocked':'cancelled',
      {correlation_id:id,packageVersion:key.split(':')[1]},activityBlock?'sessionProtection':'userCancelled');
  }
  async function cancelCheck(file,version,afterUpdate,id){
    version ||= (await platform.discover()).packageVersion;
    if(!versionPattern.test(version))throw Error('Invalid package version');
    await locked(file,()=>{
      const state=load(file);
      if(afterUpdate||raised(version,state.observedVersion)||state.pendingUpdate===version){rejectUpdate(state,'update:'+version);save(file,state);}
    });
    publish(file,'recovery-cancelled','cancelled',{correlation_id:id,packageVersion:version},'checkCancelled');
  }
  async function perform(file,plan,nonce){
    return locked(file,async()=>{
      if(!keyPattern.test(plan.key)||plan.key.split(':')[1]!==plan.packageVersion)throw Error('Invalid recovery plan');
      const consumed=await locked(file,()=>{
        const state=load(file);
        if(nonce&&state.consumedRequests?.includes(nonce))return false;
        if(nonce){state.consumedRequests=[...(state.consumedRequests??[]),nonce].slice(-16);save(file,state);}
        return true;
      });
      if(!consumed)return null;
      const {target,packageVersion:version}=plan;
      const mark=()=>locked(file,()=>{
        const state=load(file);
        if(plan.automatic&&state.attempted.includes(plan.key))return false;
        remember(state,plan.key,'plugins:'+version,'update:'+version);delete state.pendingUpdate;save(file,state);return true;
      });
      let pkg,settings;
      const matches=async()=>{
        const current=await platform.discover({digest:true});
        if(!plan.allowed||!isDeepStrictEqual(pkg,current))return false;
        const running=await platform.desktops(current),mains=running.filter(p=>p.main);
        return target?mains.length===1&&mains[0].pid===target.pid&&mains[0].created===target.created:
          running.length===0;
      };
      try{
        settings=read(file);await preflight(settings);pkg=await platform.discover({digest:true});
        if(pkg.packageVersion!==version||pkg.sha256!==plan.packageHash||!await matches()){
          await mark();return {success:false,reason:'instanceChanged'};
        }
      }catch(error){await mark();throw error;}
      const observed=await activity(settings,target);
      if(observed.state!=='idle'){
        if(plan.automatic)await cancel(file,plan.key,{pluginFailure:plan.pluginFailure,id:plan.correlation_id,activityBlock:true});
        return {success:false,reason:observed.state==='busy'?'sessionBusy':'sessionUnknown',activity:observed};
      }
      if(!await mark())return {success:false,reason:'actionInProgress'};
      if(!await matches())return {success:false,reason:'instanceChanged'};
      if(target){
        publish(file,'desktop-exit-requested','observed',plan,undefined,nonce);
        const closed=await close(target),deadline=clock()+20000;
        const failed=()=>{publish(file,'desktop-exit-result','failed',plan,'closeFailed',nonce);return {success:false,reason:'closeFailed'};};
        while((await platform.desktops(pkg)).length){
          if(!closed.ok||clock()>=deadline)return failed();
          await delay(250);
        }
        publish(file,'desktop-exit-result','success',plan,undefined,nonce);
      }
      const child=await start(plan.correlation_id),deadline=clock()+45000;
      while(clock()<deadline){
        const current=await platform.discover();
        if(await verified(platform,read(file),current))return {success:true,reason:'relaunchComplete'};
        if(child.exitCode!==null&&child.exitCode!==undefined&&child.exitCode!==0)break;
        await delay(500);
      }
      return {success:false,reason:'relaunchFailed'};
    },true);
  }
  async function execute(file,plan,nonce){
    plan={...plan,correlation_id:events.correlation(plan?.correlation_id)};
    publish(file,'recovery-execution','started',plan,undefined,nonce);
    try{
      const result=await perform(file,plan,nonce);
      if(result)publish(file,'recovery-result',result.success?'success':
        ['sessionBusy','sessionUnknown','instanceChanged','actionInProgress'].includes(result.reason)?'blocked':'failed',plan,result.reason,nonce);
      return result;
    }catch(error){
      publish(file,error instanceof Busy?'recovery-blocked':'recovery-result',error instanceof Busy?'blocked':'failed',
        plan,error instanceof Busy?'actionInProgress':'executionUnavailable',nonce);throw error;
    }
  }
  async function executeRequest(file,nonce){
    const runtime=stateFor(file);
    if(nonce&&!noncePattern.test(nonce))throw Error('Invalid recovery request');
    const requestPath=nonce?path.join(runtime,'startup-check',nonce,'request.json'):path.join(runtime,'startup-relaunch-request.json');
    const request=read(requestPath),age=clock()/1000-request.createdAt;
    if(!noncePattern.test(request.nonce)||(nonce&&request.nonce!==nonce)||!(age>=0&&age<120))throw Error('Expired recovery request');
    let result;
    try{result=await execute(file,request.plan,request.nonce);}
    catch(error){if(error instanceof Busy&&!nonce)return;result={success:false,reason:'relaunchFailed'};}
    if(nonce)removeFile(requestPath);
    if(result)json(path.join(runtime,'startup-check',request.nonce,'action.json'),result);
  }
  return {prepare,cancel,cancelCheck,execute,executeRequest};
}
if(require.main===module)(async()=>{
  const options=Object.fromEntries('settings cancel output target-pid target-started target-created version correlation-id request'.split(' ').map(k=>[k,{type:'string'}]));
  for(const k of ['execute','activity','cancel-check','after-update','plugin-failure','activity-block'])options[k]={type:'boolean'};
  const {values:v}=parseArgs({options}),file=v.settings,worker=createRecovery();
  if(!file||[v.execute,v.activity,v.cancel,v['cancel-check']].filter(Boolean).length!==1)throw Error();
  if(v.execute)await worker.executeRequest(file,v.request);
  else if(v.activity)json(v.output,await assess(read(file),v['target-pid']?{pid:Number(v['target-pid']),started:Number(v['target-started']),created:v['target-created']}:null));
  else if(v.cancel)await worker.cancel(file,v.cancel,{pluginFailure:v['plugin-failure'],id:v['correlation-id'],activityBlock:v['activity-block']});
  else await worker.cancelCheck(file,v.version,v['after-update'],v['correlation-id']);
})().catch(()=>{process.exitCode=1;});
module.exports={createRecovery,Busy,fileFor};
