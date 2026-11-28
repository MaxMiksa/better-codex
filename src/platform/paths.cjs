const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..');
function layout(root=ROOT){
  const runtime=path.join(root,'.runtime'),legacy=path.join(runtime,'token-hud','embedded');
  const launchers=path.join(runtime,'launchers');
  return {root,runtime,legacy,settings:path.join(runtime,'settings.json'),state:path.join(runtime,'state'),
    launchers,wrapper:path.join(launchers,'start-better-codex.vbs'),
    legacySettings:path.join(legacy,'settings.json'),legacyState:path.join(legacy,'runtime'),
    legacyWrappers:[path.join(legacy,'start-composer.vbs'),path.join(runtime,'hud/service/start-embedded.vbs')]};
}
function stateFor(settings){
  const dir=path.dirname(path.resolve(settings));
  return path.join(dir,path.basename(dir).toLowerCase()==='.runtime'?'state':'runtime');
}
function atomic(file,bytes){
  const next=file+'.'+randomUUID()+'.next';
  fs.mkdirSync(path.dirname(file),{recursive:true});
  try{fs.writeFileSync(next,bytes,{flag:'wx'});fs.renameSync(next,file);}
  catch(error){try{removeFile(next);}catch{}throw error;}
}
function removeFile(file){try{fs.unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const powerShell=()=>path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
module.exports={ROOT,layout,stateFor,atomic,removeFile,read,powerShell};
