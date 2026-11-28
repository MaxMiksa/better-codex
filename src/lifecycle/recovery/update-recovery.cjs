// Observe a Store upgrade and delegate once to the existing startup check.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),{parseArgs}=require('node:util');
const {createDesktopPlatform}=require('../../platform/codex/desktop.cjs');
const {readSettings}=require('../../platform/codex/settings.cjs');
const {correlation,recorder}=require('../runtime_events.cjs');

function version(value){
  if(typeof value!=='string'||!/^\d+(?:\.\d+){3}$/.test(value)||/\s/.test(value))throw RangeError('Invalid package version');
  return value.split('.').map(BigInt);
}
function newer(current,previous){
  const a=version(current),b=version(previous),change=a.findIndex((part,i)=>part!==b[i]);
  return change!==-1&&a[change]>b[change];
}
function saveState(file,state){
  // The PowerShell initializer and supervisor may briefly overlap.
  const next=file+'.'+process.pid+'.next';
  try{fs.writeFileSync(next,JSON.stringify(state));fs.renameSync(next,file);}
  finally{try{fs.unlinkSync(next);}catch{}}
}
function initialState(current,now=Date.now()){
  version(current.packageVersion);
  return {observedVersion:current.packageVersion,pendingVersion:null,attemptedVersion:null,phase:'baseline',checkedAt:now/1000};
}
function delegate(settingsPath){
  const executable=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script=path.resolve(__dirname,'../diagnostics/Show-StartupCheck.ps1');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,['-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden','-ExecutionPolicy','Bypass',
      '-File',script,'-AfterUpdate','-SettingsPath',settingsPath],{detached:true,windowsHide:true,stdio:'ignore'});
    child.once('error',reject);
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
class UpdateRecovery{
  constructor(settingsPath,runtime,{platform=createDesktopPlatform(),launch=delegate,now=Date.now,
    clock=()=>performance.now(),recordEvents=recorder}={}){
    Object.assign(this,{settingsPath,runtime,platform,launch,now,clock,recordEvents,
      path:path.join(runtime,'update-recovery.json'),state:null,nextCheck:0,status:{phase:'disabled'}});
  }
  record(phase,patch){
    const state={...this.state,...patch,phase,checkedAt:this.now()/1000};
    saveState(this.path,state);this.state=state;this.status={...state};
    if(patch.previousVersion&&patch.observedVersion!==patch.previousVersion){
      this.recordEvents(this.settingsPath,'update-monitor',state.correlation_id).emit('version-change-observed','observed',{
        previous_version:patch.previousVersion,package_version:patch.observedVersion,phase});
    }
  }
  async tick(){
    try{
      if(readSettings(this.settingsPath).recoverAfterUpdate!==true){
        this.state=null;this.nextCheck=0;return this.status={phase:'disabled'};
      }
      if(this.clock()<this.nextCheck)return this.status;
      this.nextCheck=this.clock()+15000;
      const current=await this.platform.discover();
      if(readSettings(this.settingsPath).recoverAfterUpdate!==true){
        this.state=null;this.nextCheck=0;return this.status={phase:'disabled'};
      }
      // An opt-out/opt-in can establish a new baseline between polls. Do not
      // reuse an older in-memory pending version over that durable decision.
      const stored=fs.existsSync(this.path);
      const state=stored?readSettings(this.path):initialState(current,this.now());
      version(state.observedVersion);
      if(!stored)saveState(this.path,state);
      this.state=state;this.status={...state};
      const available=current.packageVersion,previous=this.state.observedVersion;
      if(available!==previous){
        const pending=newer(available,previous)?available:null;
        this.record(pending?'waiting-updated-desktop':'baseline',{observedVersion:available,previousVersion:previous,
          pendingVersion:pending,correlation_id:correlation()});
      }
      if(this.state.pendingVersion!==available)return this.status;
      if(this.state.attemptedVersion===available){this.record('already-delegated',{pendingVersion:null});return this.status;}
      const mains=(await this.platform.desktops(current)).filter(p=>p.main);
      if(mains.length!==1||!Number.isFinite(mains[0].started)||this.now()/1000-mains[0].started<15||
        fs.existsSync(path.join(this.runtime,'stop'))||readSettings(this.settingsPath).recoverAfterUpdate!==true)return this.status;
      if(JSON.stringify(readSettings(this.path))!==JSON.stringify(this.state))return this.status;
      // Persist before spawning: a declined/failed prompt cannot replay after restart.
      this.record('startup-check-delegated',{pendingVersion:null,attemptedVersion:available});
      if(!fs.existsSync(path.join(this.runtime,'stop'))&&readSettings(this.settingsPath).recoverAfterUpdate===true)
        await this.launch(this.settingsPath);
    }catch(error){this.status={phase:'recovery-check-unavailable',errorType:error.name};}
    return this.status;
  }
}
async function initialize(settings,runtime,platform=createDesktopPlatform()){
  fs.mkdirSync(runtime,{recursive:true});
  const file=path.join(runtime,'update-recovery.json');
  if(readSettings(settings).recoverAfterUpdate!==true||!fs.existsSync(file))saveState(file,initialState(await platform.discover()));
}
if(require.main===module)(async()=>{
  const {values}=parseArgs({options:{initialize:{type:'boolean'},settings:{type:'string'},runtime:{type:'string'}}});
  if(!values.initialize||!values.settings||!values.runtime)throw Error();
  await initialize(values.settings,values.runtime);
  console.log(JSON.stringify({initialized:true}));
})().catch(()=>{console.log(JSON.stringify({initialized:false}));process.exitCode=1;});
module.exports={UpdateRecovery,newer,version,initialState,initialize,saveState};
