const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {parseArgs}=require('node:util');
const {ROOT,layout,read,atomic,powerShell}=require('../platform/paths.cjs');
const {migrate,createSettingsStore}=require('../platform/settings/settings-store.cjs');
const {createDesktopPlatform,samePath}=require('../platform/codex/desktop.cjs');
const {info,run,nodeReady,nodeVersion}=require('../platform/process.cjs');
const {startedAt}=require('../lifecycle/diagnostics/management.cjs');
const {install,sameDirectory}=require('../lifecycle/installation/install-taskbar-entry.cjs');
const {language,text}=require('../platform/i18n/localization.cjs');
const optional=file=>fs.existsSync(file)?read(file):{};
const bundled=root=>path.join(root,'runtime/node/node.exe');
async function hostAt(runtime,identify=info){
  const file=path.join(runtime,'launcher.json');
  if(!fs.existsSync(file))return false;
  const launcher=read(file);
  if(!Number.isInteger(launcher.supervisorPid)||launcher.supervisorPid<1)throw Error('Invalid launcher receipt');
  const stamp=startedAt(launcher);
  const current=await identify(launcher.supervisorPid);
  return current.matches&&current.created===stamp;
}
async function prepare({root=ROOT,node=process.execPath,port,portable=true}={}){
  const p=layout(root),location=path.join(p.state,'portable-location.json');
  const oldLocation=path.join(p.legacy,'portable-location.json');
  const recorded=(optional(location).root??optional(oldLocation).root),previous=typeof recorded==='string'&&path.isAbsolute(recorded)?recorded:root;
  if(await hostAt(p.legacyState))throw Error('Legacy enhancement host still running');
  if(await hostAt(p.state)){
    if(!samePath(previous,root))throw Error('Other copy running');
    if(portable)return read(p.settings);
  }
  await migrate(root);
  const current=optional(p.settings),patch={};
  if(port!==undefined||!Object.hasOwn(current,'port'))patch.port=port??19163;
  if(!Object.hasOwn(current,'codexHome'))patch.codexHome=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  if(!portable||!Object.hasOwn(current,'node')||samePath(current.node,bundled(previous))||
    /^.+[\\/]runtime[\\/]node[\\/]node\.exe$/i.test(current.node??'')&&!fs.existsSync(current.node))patch.node=node;
  // A recorded previous root cannot authorize edits to an independent copy.
  if(!samePath(previous,root)&&fs.existsSync(previous)&&!sameDirectory(previous,root)){
    await install({root});
  }else await install({root,previousRoot:previous});
  await createSettingsStore(p.settings).patch(patch,{create:true});
  if(portable)atomic(location,JSON.stringify({root}));
  return read(p.settings);
}
async function main(args){
  if(args.length===1&&['--help','-h'].includes(args[0])){console.log(text('portable.help'));return;}
  const {values:v}=parseArgs({args,options:{launch:{type:'boolean'},check:{type:'boolean'},'prepare-only':{type:'boolean'},
    stop:{type:'boolean'},'source-install':{type:'boolean'},'guard-legacy':{type:'boolean'},node:{type:'string'},port:{type:'string'}}});
  const modes=['launch','check','prepare-only','stop','guard-legacy'].filter(n=>v[n]);
  if(modes.length!==1)throw Error('Invalid mode');
  const [mode]=modes,p=layout();
  const print=(status,key,fields={})=>console.log(JSON.stringify({status,...fields,locale:language(),message:text(key)}));
  if(mode==='guard-legacy'){
    if(await hostAt(p.legacyState))process.exitCode=1;
    return;
  }
  if(mode==='stop'){
    atomic(path.join(p.state,'stop'),'');
    print('stop-requested','stop.requested');return;
  }
  const node=v.node??process.execPath,portable=!v['source-install'];
  if(!nodeVersion(process.version)||!await nodeReady(node)||portable&&!samePath(node,bundled(ROOT)))throw Error('Node runtime unavailable');
  const pkg=await createDesktopPlatform().discover();
  if(mode==='check'){
    print('ready',portable?'portable.ready':'install.checkReady',{
      bundledRuntimes:portable,downloads:false,node,codexVersion:pkg.packageVersion,writesPerformed:false});return;
  }
  const port=v.port===undefined?undefined:Number(v.port);
  if(port!==undefined&&(!Number.isInteger(port)||port<1024||port>65535))throw Error('Invalid port');
  await prepare({node,port,portable});
  if(mode==='prepare-only'){
    print('prepared',portable?'portable.prepared':'install.checkReady',{downloads:false});return;
  }
  const {stdout}=await run(powerShell(),['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'src/app/Start-ComposerHud.ps1')],
    {timeout:70000,env:{...process.env,BETTER_CODEX_LANGUAGE:language()}});
  const receipt=JSON.parse(stdout.replace(/^\uFEFF/,''));
  console.log(JSON.stringify({status:receipt.hudReason,activated:receipt.activationSucceeded,locale:receipt.locale,message:receipt.message}));
  process.exitCode=receipt.hudReason==='restart-required'?2:receipt.activationSucceeded?0:1;
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{
  console.log(JSON.stringify({status:'preparation-failed',errorType:error.name,locale:language(),message:text('portable.preparationFailed')}));
  process.exitCode=1;
});
module.exports={prepare,hostAt,main};
