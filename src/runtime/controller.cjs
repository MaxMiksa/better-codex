const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createWriter}=require('./runtime-writer.cjs');
const {loadFeatures}=require('./feature-registry.cjs');
const {createSettingsStore}=require('../platform/settings/settings-store.cjs');
const {runWindow}=require('./window-controller.cjs');
const {isMainPageUrl}=require('./page-contract.cjs');
const {connectToBrowser}=require('./local-cdp.cjs');
const [settingsPath,runtime]=process.argv.slice(2),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8').replace(/^\uFEFF/,''));
const stop=path.join(runtime,'stop');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const writer=createWriter(),write=writer.write;
async function main(){
  const browser=await connectToBrowser(settings.port);
  const windows=new Map(),store=createSettingsStore(settingsPath,settings);
  const i18n=require('../platform/i18n/i18n.js').pageSource();
  const {sources,hosts}=loadFeatures({
    settings,mainPage:()=>[...windows.keys()].find(page=>!page.isClosed()&&isMainPageUrl(page.url())),
    desktopPid:()=>{
      try{
        const status=JSON.parse(fs.readFileSync(path.join(runtime,'supervisor.json'),'utf8'));
        return status.controllerPid===process.pid?status.desktopPid:null;
      }catch{return null;}
    }
  });
  sources.i18n=i18n;
  try{
    while(browser.isConnected()&&!fs.existsSync(stop)){
      const pages=new Set([...browser.pages.values()].filter(page=>!page.isClosed()&&isMainPageUrl(page.url())));
      for(const [page,state] of windows){
        if(!pages.has(page))state.stopped=true;
        if(state.done&&(!pages.has(page)||Date.now()>=state.retryAt))windows.delete(page);
      }
      for(const page of pages){
        if(windows.has(page))continue;
        const id=randomUUID(),state={id,stopped:false,done:false,retryAt:0,status:{visible:false,rendered:false,reason:'connecting'}};
        windows.set(page,state);
        state.task=runWindow({page,state,settings,store,sources,hosts,
          runtime:path.join(runtime,'windows',id),stopping:()=>!browser.isConnected()||fs.existsSync(stop)})
          .catch(error=>{state.retryAt=Date.now()+3000;state.status={visible:false,rendered:false,reason:'window-unavailable',errorType:error.name,code:error.code||null,checkedAt:Date.now()};})
          .finally(()=>{state.done=true;});
      }
      // Window workers poll independently: a slow or reloading page cannot block its peers.
      write(path.join(runtime,'view-status.json'),{schemaVersion:2,controllerPid:process.pid,windows:[...windows.values()]
        .filter(state=>!state.stopped).map(state=>({windowId:state.id,...state.status})),writes:writer.diagnostics(),checkedAt:Date.now()});
      await sleep(350);
    }
  }finally{
    const renameCleanup=hosts.aiRename?.manager.close();
    for(const state of windows.values())state.stopped=true;
    await Promise.allSettled([renameCleanup,...Array.from(windows.values(),state=>state.task)]);
    write(path.join(runtime,'view-status.json'),{schemaVersion:2,controllerPid:process.pid,windows:[],reason:'disconnected',writes:writer.diagnostics(),checkedAt:Date.now()});
    browser.close(); // Closes only our WebSocket.
  }
}
main().then(()=>process.exit(0),error=>{
  write(path.join(runtime,'controller-error.json'),{errorType:error.name,code:error.code||null,checkedAt:Date.now()});
  process.exit(1);
});
