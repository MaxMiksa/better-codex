// Reuse the initialized AppHost. A second AppHost port registers a new AppView
// for this window and can disrupt the original renderer.
async function bcFindNativeFolderOpen(){
  const services=new Set();
  for(const script of document.scripts){
    if(script.type!=='module'||!script.src)continue;
    const url=new URL(script.src);
    if(url.origin!==location.origin||!/^\/assets\/[^/]+\.js$/.test(url.pathname))continue;
    try{
      // These entry scripts have already been loaded by this document. Never
      // load a private chunk or instantiate an app module by its build ID.
      const loader=(await import(url.href)).__webpack_require__;
      for(const module of Object.values(loader?.c??{})){
        const api=module?.exports;
        if(api&&Object.hasOwn(api,'appServices')&&Object.hasOwn(api,'setAppServices')&&
            Object.hasOwn(api,'setAppHost')&&typeof api.appServices?.openIn?.open==='function')services.add(api);
      }
    }catch{/* The existing Windows route covers unsupported app builds. */}
  }
  if(services.size!==1)return null;
  const [api]=services;
  return path=>api.appServices.openIn.open({cwd:null,hostId:'local',path,target:'fileManager'});
}

// Only real gestures on the current local tree can enqueue a native action.
const bcWorkspaceActions=({contextIsCurrent,fileIsCurrent,notice})=>{
  let request=null,latest=null,nativeFolderOpen=null;
  const belongs=action=>contextIsCurrent(action.context)&&
    (!action.view||fileIsCurrent(action.view,action.relative));
  const canStart=action=>action&&Date.now()<action.expires&&document.hasFocus()&&belongs(action);
  async function start(event,kind,context,view=null,relative=''){
    if(!event.isTrusted||!context?.root)return;
    const action={id:crypto.randomUUID(),kind,context,view,relative,expires:Date.now()+3000,pulled:false};
    if(!canStart(action))return;
    request=action;latest=action.id;
    if(kind==='folder'){
      action.nativeOpen=nativeFolderOpen??=await bcFindNativeFolderOpen();
      if(request!==action||!canStart(action))return;
    }
    try{window.__betterCodexWorkspaceAction(action.id);}
    catch{result(action.id,'actionFailed');}
  }
  function pull(id){
    if(request?.id!==id||request.pulled||!canStart(request))return null;
    request.pulled=true;
    return {kind:request.kind,root:request.context.root,relative:request.relative,
      nativeFolder:typeof request.nativeOpen==='function'};
  }
  function result(id,status){
    if(request?.id!==id)return;
    const last=request;request=null;
    if(status==='openNativeFolder'&&last.kind==='folder'&&last.pulled&&last.nativeOpen&&canStart(last)){
      void (async()=>{
        try{if((await last.nativeOpen(last.context.root))?.success===true)return;}catch{}
        // A lost acknowledgement can still mean the window opened: don't launch twice.
        if(latest===id&&belongs(last))notice('actionFailed');
      })();
      return;
    }
    if(['peekUnavailable','locateOnly','actionFailed','folderBackground'].includes(status)&&belongs(last))notice(status);
  }
  return {start,pull,result,confirm:id=>request?.id===id&&request.pulled&&canStart(request)};
};
