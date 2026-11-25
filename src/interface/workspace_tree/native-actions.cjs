const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile,spawn}=require('node:child_process'),{promisify}=require('node:util');
const {allowedRoot,windowsName,windowsPath}=require('./windows-paths.cjs');
const execute=promisify(execFile);
const shellHelper=path.join(__dirname,'windows-shell.py');
const actions=new Set(['preview','open','locate','folder']);
const documents=new Set(('txt md markdown rst log csv tsv json jsonc yml yaml toml ini xml sql css scss less '+
  'c h cpp hpp cs java go rs swift kt vue svelte '+
  'pdf docx xlsx pptx odt ods odp rtf png jpg jpeg gif bmp ico webp heic avif tiff tif '+
  'mp3 wav flac ogg mp4 mov webm mkv').split(' ').map(ext=>'.'+ext));
// Peek can show source as text. Never ask the Windows shell to execute it.
const peekSource=new Set('js mjs cjs ts tsx jsx py ps1 psm1 sh bash zsh bat cmd html htm svg reg vbs lua pl rb php'.split(' ').map(ext=>'.'+ext));
const peekNames=new Set(['.gitignore','.gitattributes','dockerfile','makefile','readme','license']);

function peekCandidates(){
  return [process.env.LOCALAPPDATA,process.env.ProgramW6432,process.env.ProgramFiles]
    .map(windowsPath).filter(base=>base?.length>3)
    .map(base=>path.win32.join(base,'PowerToys','WinUI3Apps','PowerToys.Peek.UI.exe'));
}
async function findPeek(candidates){
  for(const candidate of new Set(candidates)){
    try{if((await fs.lstat(candidate)).isFile())return candidate;}catch{}
  }
  return null;
}
function startPeek(file,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:path.dirname(file),detached:true,stdio:'ignore'});
    child.once('error',reject);
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
function createWorkspaceActions({codexHome,python,home=os.homedir()},
  {candidates=peekCandidates(),peek=startPeek,shell,desktopPid=()=>null}={}){
  const shellAction=shell??((verb,file)=>{
    const pid=verb==='folder'?desktopPid():null;
    const args=['-I','-B',shellHelper,verb,file];
    if(Number.isInteger(pid)&&pid>0&&pid<=0xffffffff)args.push(String(pid));
    return execute(python,args,{cwd:os.tmpdir(),windowsHide:true,timeout:6000});
  });
  return async function perform(request,stillCurrent){
    const {kind,root,relative}=request??{};
    const base=allowedRoot(root,{home,codexHome}),folder=kind==='folder';
    if(!actions.has(kind)||!base||typeof relative!=='string'||relative.length>32767||
        (folder?relative!=='':!relative.split('/').every(windowsName)))return 'actionFailed';
    try{
      const target=folder?base:base+'\\'+relative.replaceAll('/','\\');
      if(target.length>32767)return 'actionFailed';
      const [realRoot,realFile,rootInfo,fileInfo]=await Promise.all([
        fs.realpath(base),fs.realpath(target),fs.lstat(base),fs.lstat(target)
      ]);
      // Reject reparse redirects and protect the boundary after Windows resolves aliases.
      if(!rootInfo.isDirectory()||!allowedRoot(realRoot,{home,codexHome})||
          realRoot.toLowerCase()!==base.toLowerCase()||realFile.toLowerCase()!==target.toLowerCase()||
          (folder?realFile!==realRoot:!realFile.startsWith(realRoot+'\\')||!fileInfo.isFile()))return 'actionFailed';
      if(folder&&request.nativeFolder===true)return await stillCurrent()?'openNativeFolder':null;
      const extension=path.win32.extname(realFile).toLowerCase();
      const document=documents.has(extension);
      const previewable=document||peekSource.has(extension)||peekNames.has(path.win32.basename(realFile).toLowerCase());
      const preview=kind==='preview'&&previewable;
      const locateOnly=(kind==='open'&&!document)||(kind==='preview'&&!previewable);
      const executable=preview?await findPeek(candidates):null;
      if(!await stillCurrent())return null;
      if(preview){
        if(!executable)return 'peekUnavailable';
        await peek(executable,[realFile]);
      }else{
        try{await shellAction(locateOnly?'locate':kind,realFile);}
        catch(error){
          if(folder&&error.code===3)return 'folderBackground';
          if(kind!=='open'||locateOnly||error.code!==2)throw error;
          if(!await stillCurrent())return null;
          await shellAction('locate',realFile);
          return 'locateOnly';
        }
      }
      return locateOnly?'locateOnly':null;
    }catch{return 'actionFailed';}
  };
}

module.exports={createWorkspaceActions};
