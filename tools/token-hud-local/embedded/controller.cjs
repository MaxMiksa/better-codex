const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createWriter}=require('./runtime-writer.cjs');
const {createThemeReader}=require('./chrome-theme.cjs');
const {createSettingsStore}=require('../shared/settings-store.cjs');
const {runWindow}=require('./window-controller.cjs');
const {isMainPageUrl}=require('./page-contract.cjs');
const [settingsPath,runtime]=process.argv.slice(2),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8').replace(/^\uFEFF/,''));
const {chromium}=require(settings.playwright),stop=path.join(runtime,'stop');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const writer=createWriter(),write=writer.write;
async function main(){
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+settings.port,{timeout:5000});
  const windows=new Map(),store=createSettingsStore(settingsPath,settings);
  const sources={i18n:require('./i18n.js').pageSource()};
  const readThemes=createThemeReader(path.join(settings.codexHome,'config.toml'));
  try{
    for(const [key,file] of Object.entries({hud:'composer-strip.js',reading:'reading-width.js',files:'file-changes.js',accent:'custom-accent.js'})){
      sources[key]=fs.readFileSync(path.join(__dirname,file),'utf8');
    }
    while(browser.isConnected()&&!fs.existsSync(stop)){
      const pages=new Set(browser.contexts().flatMap(context=>context.pages()).filter(page=>!page.isClosed()&&isMainPageUrl(page.url())));
      for(const [page,state] of windows){
        if(!pages.has(page))state.stopped=true;
        if(state.done&&(!pages.has(page)||Date.now()>=state.retryAt))windows.delete(page);
      }
      for(const page of pages){
        if(windows.has(page))continue;
        const id=randomUUID(),state={id,stopped:false,done:false,retryAt:0,status:{visible:false,rendered:false,reason:'connecting'}};
        windows.set(page,state);
        state.task=runWindow({page,state,settings,store,sources,readThemes,
          runtime:path.join(runtime,'windows',id),stopping:()=>!browser.isConnected()||fs.existsSync(stop)})
          .catch(error=>{state.retryAt=Date.now()+3000;state.status={visible:false,rendered:false,reason:'window-unavailable',errorType:error.name,code:error.code||null,checkedAt:Date.now()};})
          .finally(()=>{state.done=true;});
      }
      // Window workers poll independently: a slow or reloading page cannot block its peers.
      write(path.join(runtime,'view-status.json'),{schemaVersion:2,windows:[...windows.values()]
        .filter(state=>!state.stopped).map(state=>({windowId:state.id,...state.status})),writes:writer.diagnostics(),checkedAt:Date.now()});
      await sleep(350);
    }
  }finally{
    for(const state of windows.values())state.stopped=true;
    await Promise.allSettled([...windows.values()].map(state=>state.task));
    write(path.join(runtime,'view-status.json'),{schemaVersion:2,windows:[],reason:'disconnected',writes:writer.diagnostics(),checkedAt:Date.now()});
    // Never invoke Browser.close on the user's app. Process exit disconnects CDP.
  }
}
main().then(()=>process.exit(0),error=>{
  write(path.join(runtime,'controller-error.json'),{errorType:error.name,code:error.code||null,checkedAt:Date.now()});
  process.exit(1);
});
