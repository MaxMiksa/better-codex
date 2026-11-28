const path=require('node:path'),fs=require('node:fs');
const {ROOT,read,powerShell}=require('../../platform/paths.cjs');
const {run,info,nodeReady}=require('../../platform/process.cjs'),{executable}=require('../../platform/windows/native.cjs');
const {partsRow,t}=require('./results.cjs');
const part=(code,state='pass')=>({code,state});
async function shellProbe(relative,settings){
  const {stdout}=await run(powerShell(),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',
    path.join(ROOT,relative),'-SettingsPath',settings]);
  return stdout.replace(/^\uFEFF/,'').trim();
}
function startedAt(receipt){
  // PowerShell emits up to seven digits. Preserve exact Windows FILETIME.
  const m=/^(.+T\d\d:\d\d:\d\d)(?:\.(\d{1,7}))?(Z|\+00:00)$/.exec(receipt.startedAt);
  if(!m)throw Error('Invalid process start time');
  return (BigInt(Date.parse(m[1]+'Z'))*10000n+116444736000000000n+BigInt((m[2]??'').padEnd(7,'0'))).toString();
}
async function supervisor(settings,runtime,identify=info,now=Date.now){
  const launcher=read(path.join(runtime,'launcher.json'));
  const process=await identify(launcher.supervisorPid,{executable:settings.node,argument:path.join(ROOT,'src/app/supervisor.cjs')});
  if(!process.matches||process.created!==startedAt(launcher))throw Error('Supervisor identity unavailable');
  const status=read(path.join(runtime,'supervisor.json')),age=now()/1000-status.checkedAt;
  if(!(age>=-2&&age<15)||status.phase==='stopped')throw Error('Supervisor heartbeat unavailable');
  return {launcher,status};
}
async function entries(settings,probe=shellProbe){
  try{
    const parts=JSON.parse(await probe('src/lifecycle/diagnostics/Read-StartupEntries.ps1',settings));
    if(!Array.isArray(parts)||!parts.length||!parts.every(p=>/^entry[A-Z]\w*$/.test(p.code)&&['pass','warning','unknown','notApplicable'].includes(p.state)))throw Error();
    return partsRow('entries',parts);
  }catch{return partsRow('entries',[part('entryUnavailable','unknown')]);}
}
async function updates(settings,runtime,readSupervisor=supervisor){
  if(settings.recoverAfterUpdate!==true)return partsRow('updates',[part('updatesDisabled','notApplicable')]);
  try{
    const {status}=await readSupervisor(settings,runtime),observation=status.updateRecovery;
    const phase=observation.phase;
    if(['recovery-check-unavailable','disabled'].includes(phase))throw Error();
    const parts=[part('updatesReady')];
    if(phase==='waiting-updated-desktop')parts.push(part('updatesWaiting','notApplicable'));
    else if(['startup-check-delegated','already-delegated'].includes(phase))parts.push(part('updatesDelegated','notApplicable'));
    else if(phase!=='baseline')parts.push(part('updatesUnavailable','unknown'));
    const file=path.join(runtime,'startup-relaunch.json');
    if(fs.existsSync(file)&&read(file).attempted.includes('update:'+observation.observedVersion))
      parts.push(part('updatesHandled','notApplicable'));
    return partsRow('updates',parts);
  }catch{return partsRow('updates',[part('updatesUnavailable','unknown')]);}
}
function applyPlan(result,plan){
  if(plan.reason!=='updated')return result;
  const message=t(plan.cancelledForActivity?'updatesCancelled':plan.automatic?'updatesPending':'updatesHandled');
  return {...result,detail:result.detail+'\n'+message,summary:message};
}
async function runtime(checks,{readSupervisor=supervisor,probe=shellProbe,ready=nodeReady}={}){
  const parts=[];
  if(checks.settingsError)return partsRow('runtime',[part('runtimeSettingsInvalid','warning')]);
  if(checks.configError)parts.push(part('runtimeConfigInvalid','warning'));
  const {settings}=checks;
  try{
    if(!Number.isInteger(settings.port)||settings.port<1024||settings.port>65535||
      ![settings.node,executable].every(file=>fs.statSync(file).isFile())||!await ready(settings.node))throw Error();
    parts.push(part('runtimeDependenciesReady'));
  }catch{parts.push(part('runtimeDependenciesMissing','warning'));}
  try{
    const {launcher}=await readSupervisor(settings,checks.runtime);
    const stamp=await probe('src/platform/settings/runtime_stamp.ps1',checks.settingsPath);
    parts.push(stamp===launcher.stamp?part('runtimeBackendReady'):part('runtimeOldBackend','warning'));
  }catch{parts.push(part('runtimeUnavailable','unknown'));}
  return partsRow('runtime',parts);
}
module.exports={part,shellProbe,startedAt,supervisor,entries,updates,applyPlan,runtime};
