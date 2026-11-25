const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createWriter}=require('./runtime-writer.cjs');
const {createThemeReader}=require('../appearance/chrome-theme.cjs');
const {createPromptReader}=require('./prompt-directory.cjs');
const {createAiRenameManager}=require('./ai-rename.cjs');
const {setDesktopThreadTitle,setThreadTitle}=require('./thread-title-api.cjs');
const {createSettingsStore}=require('../../platform/settings/settings-store.cjs');
const {runWindow}=require('./window-controller.cjs');
const {isMainPageUrl}=require('./page-contract.cjs');
const [settingsPath,runtime]=process.argv.slice(2),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8').replace(/^\uFEFF/,''));
const {chromium}=require(settings.playwright),stop=path.join(runtime,'stop');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const writer=createWriter(),write=writer.write;
async function main(){
  const browser=await chromium.connectOverCDP('http://127.0.0.1:'+settings.port,{timeout:5000});
  const windows=new Map(),store=createSettingsStore(settingsPath,settings);
  const sources={i18n:require('../../platform/i18n/i18n.js').pageSource()};
  const readThemes=createThemeReader(path.join(settings.codexHome,'config.toml'));
  const readPrompts=createPromptReader(settings.codexHome);
  const aiRename=createAiRenameManager({settings,applyTitle:async options=>{
    const page=[...windows.keys()].find(page=>!page.isClosed()&&isMainPageUrl(page.url()));
    if(!page||!await setDesktopThreadTitle(page,options))await setThreadTitle(options);
  }});
  try{
    for(const [key,file] of Object.entries({commands:'../appearance/command-menu.js',aiRename:'../appearance/ai-rename.js',fold:'../appearance/composer-fold.js',hud:'../statistics/composer-strip.js',reading:'../reading/reading-width.js',sorting:'../reading/table-sort.js',files:'../file_changes/file-changes.js',accent:'../appearance/custom-accent.js'})){
      sources[key]=fs.readFileSync(path.join(__dirname,file),'utf8');
    }
    sources.workspaceTree=fs.readFileSync(path.join(__dirname,'../workspace_tree/workspace-tree.js'),'utf8');
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
        state.task=runWindow({page,state,settings,store,sources,readThemes,readPrompts,aiRename,
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
    aiRename.close();
    for(const state of windows.values())state.stopped=true;
    await Promise.allSettled([...windows.values()].map(state=>state.task));
    write(path.join(runtime,'view-status.json'),{schemaVersion:2,controllerPid:process.pid,windows:[],reason:'disconnected',writes:writer.diagnostics(),checkedAt:Date.now()});
    // Never invoke Browser.close on the user's app. Process exit disconnects CDP.
  }
}
main().then(()=>process.exit(0),error=>{
  write(path.join(runtime,'controller-error.json'),{errorType:error.name,code:error.code||null,checkedAt:Date.now()});
  process.exit(1);
});
