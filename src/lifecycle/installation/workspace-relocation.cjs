const fs=require('node:fs'),path=require('node:path'),{parseArgs}=require('node:util');
const {ROOT,layout,atomic,read,removeFile}=require('../../platform/paths.cjs');
const {samePath}=require('../../platform/codex/desktop.cjs');
const {checked,withSettingsLock}=require('../../platform/windows/native.cjs');
const {createSettingsStore,migrate}=require('../../platform/settings/settings-store.cjs');
const {language,text}=require('../../platform/i18n/localization.cjs');
const entry=require('./install-taskbar-entry.cjs');
const lexists=file=>{try{fs.lstatSync(file);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
function createRelocation({root=ROOT,appdata=process.env.APPDATA,native=checked,install=entry.install}={}){
  const p=layout(root),planFile=path.join(p.state,'workspace-rename/plan.json');
  const write=plan=>atomic(planFile,JSON.stringify(plan));
  const settingsFile=()=>fs.existsSync(p.settings)?p.settings:p.legacySettings;
  const loadPlan=()=>read(fs.existsSync(planFile)?planFile:path.join(p.legacy,'workspace-rename/plan.json'));
  function dependency(previous){
    const node=read(settingsFile()).node;
    if(typeof node!=='string'||!path.isAbsolute(node))throw Error('dependency-missing-node');
    const relative=path.relative(previous,node);
    const updated=relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative)?path.join(root,relative):node;
    if(!fs.statSync(updated,{throwIfNoEntry:false})?.isFile())throw Error('dependency-missing-node');
    return samePath(updated,node)?{}:{node:updated};
  }
  async function preflight(previous,verify=false){
    const {selected,skipped,roots}=await entry.selection({root,previousRoot:previous,appdata,native});
    if(!selected[0]?.link||skipped.length)throw Error('shortcut-ownership-conflict');
    const wrapper=fs.existsSync(p.wrapper);
    if(wrapper&&!entry.inspectWrapper(p.wrapper,roots)||!wrapper&&!p.legacyWrappers.some(file=>fs.existsSync(file)))
      throw Error('wrapper-ownership-conflict');
    if(verify){
      const icon=path.join(p.launchers,'codex.ico');
      if(!wrapper||!fs.existsSync(icon)||selected.some(({link})=>!samePath(link.arguments.slice(1,-1),p.wrapper)||
        !samePath(link.workingDirectory,root)||!samePath(link.icon,icon)||link.iconIndex!==0||link.appId!==entry.APP_ID))
        throw Error('shortcut-verification-failed');
    }
    return selected.map(x=>x.file);
  }
  async function check(plan){
    const {previousRoot:previous,destinationRoot:destination,state}=plan;
    if(!path.isAbsolute(previous)||!samePath(destination,path.join(path.dirname(previous),'Better-Codex'))||
      ![previous,destination].some(x=>samePath(x,root))||!['prepared','applied','finalized'].includes(state))
      throw Error('unexpected-workspace-location');
    if(samePath(root,previous)){
      if(state!=='prepared'||lexists(destination))throw Error('destination-already-exists');
      await preflight(previous);dependency(previous);return 'prepared';
    }
    const alias=lexists(previous);
    if(alias&&!entry.sameDirectory(previous,root))throw Error('previous-path-occupied');
    const applied=state!=='prepared';
    await preflight(applied?root:previous,applied);
    const patch=dependency(previous);
    if(applied&&(Object.keys(patch).length||alias!==(state==='applied')))throw Error('migration-verification-failed');
    return applied?state:'ready';
  }
  async function prepare(){
    const destination=path.join(path.dirname(root),'Better-Codex');
    if(samePath(destination,root)||lexists(destination))throw Error('destination-already-exists');
    if(fs.existsSync(planFile))return check(loadPlan());
    await preflight(root);dependency(root);
    write({previousRoot:root,destinationRoot:destination,state:'prepared'});return 'prepared';
  }
  async function apply(plan){
    const status=await check(plan);if(status!=='ready')return status;
    const previous=plan.previousRoot,patch=dependency(previous),current=read(settingsFile());
    const links=await preflight(previous),files=[...links,p.wrapper,path.join(p.launchers,'codex.ico')];
    const originals=new Map(files.map(file=>[file,fs.existsSync(file)?fs.readFileSync(file):null]));
    const backup=path.join(path.dirname(planFile),'before-apply'),manifest=[];
    for(const [file,bytes] of originals){
      if(!bytes)continue;
      const name=manifest.length+'-'+path.basename(file),dest=path.join(backup,name);
      if(!fs.existsSync(dest))atomic(dest,bytes);
      manifest.push({path:file,backup:name});
    }
    atomic(path.join(backup,'manifest.json'),JSON.stringify(manifest));
    if(!lexists(previous))fs.symlinkSync(root,previous,'junction');
    if(!entry.sameDirectory(previous,root))throw Error('compatibility-link-verification-failed');
    await migrate(root);
    const store=createSettingsStore(p.settings);
    try{
      await store.patch(patch);
      const result=await install({root,previousRoot:previous,appdata,native});
      if(result.skippedUnmanagedShortcuts.length)throw Error('shortcut-changed-during-migration');
      const next={...plan,state:'applied'};
      await check(next);write(next);
    }catch(error){
      await store.patch(Object.fromEntries(Object.keys(patch).map(key=>[key,current[key]])));
      for(const [file,bytes] of originals){
        if(bytes)atomic(file,bytes);else removeFile(file);
      }
      throw error;
    }
    return 'applied';
  }
  async function finalize(plan){
    const status=await check(plan);
    if(status==='finalized')return status;
    if(status!=='applied')throw Error('migration-not-applied');
    const previous=plan.previousRoot,{status:used}=await native('path-in-use',['--path',previous],{timeout:8000});
    if(used!=='unused')throw Error(used==='in-use'?'old-path-still-in-use':'process-path-check-unavailable');
    if(!fs.lstatSync(previous).isSymbolicLink()||!entry.sameDirectory(previous,root))throw Error('expected-workspace-junction');
    const next={...plan,state:'finalized'};write(next);
    try{fs.rmdirSync(previous);}catch(error){write(plan);throw error;}
    return check(next);
  }
  return async mode=>{
    const action=()=>mode==='prepare'?prepare():mode==='check'?check(loadPlan()):mode==='apply'?apply(loadPlan()):finalize(loadPlan());
    if(!['prepare','check','apply','finalize'].includes(mode))throw Error('invalid-mode');
    if(mode==='check')return action();
    return withSettingsLock(planFile,action);
  };
}
if(require.main===module)(async()=>{
  const {values}=parseArgs({options:{mode:{type:'string',default:'apply'}}});
  const status=await createRelocation()(values.mode);
  console.log(JSON.stringify({status,locale:language(),message:text('rename.'+status),codexRestarted:false,processesStopped:false}));
})().catch(error=>{
  const reason=/^[a-z]+(?:-[a-z]+)+$/.test(error.message)?error.message:error.name;
  console.log(JSON.stringify({status:'refused',locale:language(),message:text('rename.failed'),reason}));process.exitCode=1;
});
module.exports={createRelocation};
