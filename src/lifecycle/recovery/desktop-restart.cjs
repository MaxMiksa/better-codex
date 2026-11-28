const fs=require('node:fs'),path=require('node:path');
const {ROOT,powerShell}=require('../../platform/paths.cjs');
const {createDesktopPlatform}=require('../../platform/codex/desktop.cjs');
const {executable,invoke}=require('../../platform/windows/native.cjs');
const {nodeReady,detached}=require('../../platform/process.cjs');
const launcher=path.join(ROOT,'src/app/Start-ComposerHud.ps1');
async function preflight(settings){
  if(!Number.isInteger(settings.port)||settings.port<1024||settings.port>65535||
     ![settings.node,executable,launcher].every(file=>typeof file==='string'&&fs.statSync(file).isFile())||
     !await nodeReady(settings.node))throw Error('Recovery launch dependency unavailable');
}
const start=id=>detached(powerShell(),['-NoProfile','-NonInteractive','-STA','-WindowStyle','Hidden',
  '-ExecutionPolicy','Bypass','-File',launcher,'-StartupCheckStarted','-CorrelationId',id]);
const close=target=>invoke('graceful-close',['--pid',String(target.pid),'--created',target.created,'--timeout-ms','20000'],{timeout:23000});
const verified=async(platform,settings,pkg)=>Boolean(platform.verifiedListener(await platform.listeners(settings.port),pkg));
module.exports={createDesktopPlatform,preflight,start,close,verified};
