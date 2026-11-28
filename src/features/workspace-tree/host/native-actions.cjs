const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {allowedRoot,windowsName,windowsPath}=require('./windows-paths.cjs');
const {createNativePreview}=require('./preview-bridge.cjs');
const nativeShell=require('./windows-shell.cjs');
const actions=new Set(['preview','dismissPreview','open','locate','folder']);
const previewId=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const documents=new Set(('txt text md markdown rst adoc org log csv tsv json jsonc yml yaml toml ini xml sql css scss less '+
  'c h cpp hpp cs java go rs swift kt vue svelte '+
  'pdf docx xlsx pptx odt ods odp rtf png jpg jpeg gif bmp ico webp heic avif tiff tif '+
  'mp3 wav flac ogg mp4 mov webm mkv').split(' ').map(ext=>'.'+ext));
function startPreview(file,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd:path.dirname(file),detached:true,stdio:'ignore'});
    child.once('error',reject);
    child.once('spawn',()=>{child.unref();resolve();});
  });
}
function createWorkspaceActions({codexHome,home=os.homedir(),language,workspaceTreePreviewPath},
  {nativePreview,shell,desktopPid=()=>null,inspectPreview=nativeShell.inspectPreview}={}){
  const native=windowsPath(workspaceTreePreviewPath);
  const previewPath=path.win32.basename(native??'').toLowerCase()==='bettercodexpreview.exe'?native:null;
  const dispatchPreview=previewPath&&(nativePreview??createNativePreview({
    language:language??process.env.BETTER_CODEX_LANGUAGE??Intl.DateTimeFormat().resolvedOptions().locale,start:startPreview,
    replace:nativeShell.replacePreview
  }));
  const shellAction=shell??((verb,file)=>nativeShell.shellAction(verb,file,verb==='folder'?desktopPid():null));
  return async function perform(request,stillCurrent,stillPreview=stillCurrent,previewSession={}){
    const {kind,root,relative}=request??{};
    const base=allowedRoot(root,{home,codexHome}),folder=kind==='folder',preview=kind==='preview';
    if(!actions.has(kind)||!base||typeof relative!=='string'||relative.length>32767||
        (folder?relative!=='':!relative.split('/').every(windowsName)))return 'actionFailed';
    try{
      const target=folder?base:base+'\\'+relative.replaceAll('/','\\');
      if(target.length>32767)return 'actionFailed';
      if((preview||kind==='dismissPreview')&&!await stillCurrent())return null;
      // Get metadata before resolving the leaf: opening a recall-on-open file can hydrate it.
      // The helper rejects redirects; for known cloud placeholders resolve only the parent.
      const info=(preview||kind==='dismissPreview')?await inspectPreview(target):null;
      if((preview||kind==='dismissPreview')&&typeof info?.cloudOnly!=='boolean')return 'actionFailed';
      const cloud=info?.cloudOnly===true;
      if(cloud&&(!Number.isSafeInteger(info.size)||info.size<0))return 'actionFailed';
      const parent=path.win32.dirname(target);
      const [realRoot,realFile,rootInfo,fileInfo]=await Promise.all([
        fs.realpath(base),cloud?fs.realpath(parent).then(dir=>dir+'\\'+path.win32.basename(target)):fs.realpath(target),
        fs.lstat(base),cloud?null:fs.lstat(target)
      ]);
      // Reject reparse redirects and protect the boundary after Windows resolves aliases.
      if(!rootInfo.isDirectory()||!allowedRoot(realRoot,{home,codexHome})||
          realRoot.toLowerCase()!==base.toLowerCase()||realFile.toLowerCase()!==target.toLowerCase()||
          (folder?realFile!==realRoot:!realFile.startsWith(realRoot+'\\')||(!cloud&&!fileInfo.isFile())))return 'actionFailed';
      if(folder&&request.nativeFolder===true)return await stillCurrent()?'openNativeFolder':null;
      const extension=path.win32.extname(realFile).toLowerCase();
      const document=documents.has(extension);
      const locateOnly=kind==='open'&&!document;
      if((preview||kind==='dismissPreview')&&typeof request.dismiss==='string'&&previewId.test(request.dismiss)&&
          dispatchPreview?.dismiss&&await stillCurrent()&&
          await dispatchPreview.dismiss(previewPath,realFile,request.dismiss,previewSession.scope,preview))return 'nativePreviewDismissed';
      if(kind==='dismissPreview')return null;
      if(preview){
        if(!previewPath||!(await fs.lstat(previewPath).catch(()=>null))?.isFile())return 'previewUnavailable';
        if(!await stillCurrent())return null;
        const shown=await dispatchPreview(previewPath,realFile,{
          openable:document,stillCurrent,session:previewSession,cloudSize:cloud?info.size:undefined,
          open:()=>perform({...request,kind:document?'open':'locate'},stillPreview),
          authorizeSave:async()=>{
            if(!await stillPreview()||(await inspectPreview(target).catch(()=>null))?.cloudOnly!==false)return false;
            const [rootNow,fileNow,rootStat,fileStat]=await Promise.all([
              fs.realpath(base),fs.realpath(target),fs.lstat(base),fs.lstat(target)
            ]);
            return rootNow.toLowerCase()===base.toLowerCase()&&fileNow.toLowerCase()===realFile.toLowerCase()&&
              rootStat.isDirectory()&&fileStat.isFile()&&fileStat.nlink===1;
          }
        });
        if(shown==='blocked')return 'nativePreviewBlocked';
        if(shown==='dismissible')return 'nativePreviewDismissible';
        return shown?'nativePreviewReady':await stillCurrent()?'actionFailed':null;
      }
      if(!await stillCurrent())return null;
      try{await shellAction(locateOnly?'locate':kind,realFile);}
      catch(error){
        if(folder&&error.code===3)return 'folderBackground';
        if(kind!=='open'||locateOnly||error.code!==2)throw error;
        if(!await stillCurrent())return null;
        await shellAction('locate',realFile);
        return 'locateOnly';
      }
      return locateOnly?'locateOnly':null;
    }catch{return 'actionFailed';}
  };
}

module.exports={createWorkspaceActions};
