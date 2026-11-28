const fs=require('node:fs'),path=require('node:path');
const {ROOT,layout,atomic,powerShell}=require('../../platform/paths.cjs');
const {samePath}=require('../../platform/codex/desktop.cjs');
const {checked}=require('../../platform/windows/native.cjs');
const {language,text}=require('../../platform/i18n/localization.cjs');
const APP_ID='OpenAI.Codex_2p2nqsd0c76g0!App';
const MANAGED_APP_IDS=[APP_ID,'com.openai.codex'];
const wrapperPaths=root=>{const p=layout(root);return [p.wrapper,...p.legacyWrappers];};
const pinnedDirectory=appdata=>path.join(appdata,'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar');
function links(root,appdata){
  const dir=pinnedDirectory(appdata);
  let names;
  try{names=fs.readdirSync(dir);}catch(error){if(error.code!=='ENOENT')throw error;names=[];}
  const pins=names.filter(name=>/^Codex(?: \(\d+\))?\.lnk$/i.test(name)).sort();
  return [{kind:'project',file:path.join(root,'launchers/Codex.lnk')},
    ...pins.map(name=>({kind:'taskbar',file:path.join(dir,name)})),
    {kind:'startup',file:path.join(appdata,'Microsoft/Windows/Start Menu/Programs/Startup/Codex with HUD.lnk')}];
}
function wrapperContent(root){
  return fs.readFileSync(path.join(ROOT,'src/lifecycle/installation/start-better-codex.vbs'),'utf8').replace(/\r\n/g,'\n')
    .replace('@POWERSHELL@',()=>powerShell().replaceAll('"','""'))
    .replace('@SCRIPT@',()=>path.join(root,'src/app/Start-ComposerHud.ps1').replaceAll('"','""'));
}
const wide=text=>Buffer.from('\uFEFF'+text,'utf16le');
function inspectWrapper(file,roots){
  if(!fs.existsSync(file))return true;
  if(fs.lstatSync(file).isSymbolicLink())return false;
  const value=fs.readFileSync(file,'utf16le').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  return roots.some(root=>value===wrapperContent(root));
}
const wscript=()=>path.join(process.env.WINDIR,'System32/wscript.exe');
function owned(link,roots){
  return samePath(link.target,wscript())&&MANAGED_APP_IDS.includes(link.appId)&&
    roots.flatMap(wrapperPaths).some(wrapper=>link.arguments.startsWith('"')&&link.arguments.endsWith('"')&&
      !link.arguments.slice(1,-1).includes('"')&&samePath(link.arguments.slice(1,-1),wrapper));
}
const inspect=async(file,native=checked)=>(await native('shortcut-inspect',['--path',file])).shortcut;
function sameDirectory(a,b){
  try{return samePath(fs.realpathSync.native(a),fs.realpathSync.native(b));}catch{return false;}
}
async function selection({root=ROOT,previousRoot=root,appdata=process.env.APPDATA,native=checked}={}){
  const selected=[],skipped=[];
  // A different fold of the same path or the verified rename junction is safe.
  // If the previous root exists as its own copy, its entries never belong here.
  const roots=[root];
  if(!samePath(root,previousRoot)&&(!fs.existsSync(previousRoot)||sameDirectory(root,previousRoot)))roots.push(previousRoot);
  for(const item of links(root,appdata)){
    const project=item.kind==='project';
    if(!fs.existsSync(item.file)){if(project)selected.push({...item,link:null});continue;}
    let link;
    try{link=await inspect(item.file,native);}catch(error){if(project)throw error;}
    if(link&&owned(link,roots))selected.push({...item,link});
    else if(project)throw Error('shortcut-ownership-conflict');
    else skipped.push(item.file);
  }
  return {selected,skipped,roots};
}
async function install({root=ROOT,previousRoot=root,appdata=process.env.APPDATA,native=checked}={}){
  const p=layout(root),{selected,skipped,roots}=await selection({root,previousRoot,appdata,native});
  if(!inspectWrapper(p.wrapper,roots))throw Error('wrapper-ownership-conflict');
  const recovery=path.join(p.launchers,'taskbar-recovery'),icon=path.join(p.launchers,'codex.ico');
  const iconBytes=fs.readFileSync(path.join(ROOT,'src/native/codex.ico'));
  fs.mkdirSync(recovery,{recursive:true});
  atomic(p.wrapper,wide(wrapperContent(root)));
  atomic(icon,iconBytes);
  const updated=[];
  for(const {kind,file,link} of selected){
    // Recheck ownership at the last possible point. Preserve any other copy.
    if(fs.existsSync(file)){
      const latest=await inspect(file,native);
      if(!owned(latest,roots))throw Error('shortcut-ownership-conflict');
    }else if(link)throw Error('shortcut-removed');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const backup=path.join(recovery,kind==='taskbar'&&path.basename(file).toLowerCase()!=='codex.lnk'?
      'taskbar-'+path.basename(file):kind+'.lnk');
    if(link&&!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
    const {shortcut:verified}=await native('shortcut-install',['--input-stdin'],{input:{
      path:file,target:wscript(),arguments:'"'+p.wrapper+'"',appId:APP_ID,icon,workingDirectory:root,description:text('shortcut.description')}});
    if(!owned(verified,[root])||!samePath(verified.arguments.slice(1,-1),p.wrapper)||
      !samePath(verified.icon,icon)||!samePath(verified.workingDirectory,root)||verified.iconIndex!==0||verified.appId!==APP_ID)
      throw Error('shortcut-verification-failed');
    if(!fs.existsSync(backup))fs.copyFileSync(file,backup,fs.constants.COPYFILE_EXCL);
    updated.push({kind,file});
  }
  return {locale:language(),message:text('shortcut.updated'),updatedShortcuts:updated.map(x=>x.file),
    pinnedShortcutUpdated:updated.some(x=>x.kind==='taskbar'),skippedUnmanagedShortcuts:skipped,appId:APP_ID,
    appIdPreserved:selected.every(x=>!x.link||x.link.appId===APP_ID),recovery};
}
if(require.main===module)install().then(result=>console.log(JSON.stringify(result))).catch(()=>{
  console.error(text('shortcut.identity'));process.exitCode=1;
});
module.exports={install,links,owned,inspect,selection,wrapperPaths,wrapperContent,inspectWrapper,sameDirectory,APP_ID};
