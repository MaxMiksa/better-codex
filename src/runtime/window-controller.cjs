const fs=require('node:fs'),path=require('node:path');
const {createCollector}=require('./collector-session.cjs');
const {createWriter}=require('./runtime-writer.cjs');
const {isMainPageUrl,pageGuard}=require('./page-contract.cjs');
const {pageModules,pageGlobals}=require('./feature-registry.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const promptBinding='__betterCodexRequestPrompts';
const renameBinding='__betterCodexRequestAiRename';
const workspaceBinding='__betterCodexWorkspaceAction';
const commandPreferences={
  commandVisible:'normalize',skillVisible:'normalizeSkillVisible',commandSectionOrder:'normalizeSectionOrder',
  commandGroupOrder:'normalizeGroupOrder',commandItemOrder:'normalizeItemOrder'
};
const METRIC_KEYS=['ttft','speed','cache','age'];
const DEFAULT_PREFERENCES={readingWidth:1152,fileChangesDefaultCollapsed:true,customAccent:true,tableEnabled:true,tableCentered:true,tableSortMode:'smart',
  metricOrder:[...METRIC_KEYS],metricVisible:Object.fromEntries(METRIC_KEYS.map(key=>[key,true]))};
const COMPOSER_FOLD_STYLES=['minimize','hide'];
const COMPOSER_FOLD_MODES=['off',...COMPOSER_FOLD_STYLES];
const isAssistantFontSize=value=>value===null||(Number.isInteger(value)&&value>=10&&value<=40);
const clampWidth=value=>Math.max(768,Math.min(1600,Math.round(Number(value))));
function metricOrder(value){
  const seen=new Set(),order=[];
  for(const key of Array.isArray(value)?value:[]){
    if(METRIC_KEYS.includes(key)&&!seen.has(key)){seen.add(key);order.push(key);}
  }
  for(const key of METRIC_KEYS)if(!seen.has(key))order.push(key);
  return order;
}
function metricVisible(value){
  const visible=Object.fromEntries(METRIC_KEYS.map(key=>[key,value?.[key]!==false]));
  if(!METRIC_KEYS.some(key=>visible[key]))visible.ttft=true;
  return visible;
}
function preferences(value={},catalog){
  const composerAutoHide=COMPOSER_FOLD_MODES.includes(value.composerAutoHide)?value.composerAutoHide:'off';
  return {
    readingWidth:Number.isInteger(value.readingWidth)&&value.readingWidth>=768&&value.readingWidth<=1600?clampWidth(value.readingWidth):DEFAULT_PREFERENCES.readingWidth,
    composerAutoHide,
    composerHideStyle:composerAutoHide!=='off'?composerAutoHide:COMPOSER_FOLD_STYLES.includes(value.composerHideStyle)?value.composerHideStyle:'minimize',
    composerHideAfterSend:value.composerHideAfterSend===true,
    assistantFontSize:isAssistantFontSize(value.assistantFontSize)?value.assistantFontSize:null,
    chatTitleCentered:value.chatTitleCentered!==false,
    workspaceTreeEnabled:value.workspaceTreeEnabled!==false,
    fileChangesDefaultCollapsed:typeof value.fileChangesDefaultCollapsed==='boolean'?value.fileChangesDefaultCollapsed:DEFAULT_PREFERENCES.fileChangesDefaultCollapsed,
    customAccent:typeof value.customAccent==='boolean'?value.customAccent:DEFAULT_PREFERENCES.customAccent,
    tableEnabled:typeof value.tableEnabled==='boolean'?value.tableEnabled:typeof value.tableOptimization==='boolean'?value.tableOptimization:DEFAULT_PREFERENCES.tableEnabled,
    tableCentered:typeof value.tableCentered==='boolean'?value.tableCentered:DEFAULT_PREFERENCES.tableCentered,
    tableSortMode:['smart','ascending','descending'].includes(value.tableSortMode)?value.tableSortMode:DEFAULT_PREFERENCES.tableSortMode,
    commandMenuEnabled:typeof value.commandMenuEnabled==='boolean'?value.commandMenuEnabled:true,
    ...Object.fromEntries(Object.entries(commandPreferences).map(([key,normalize])=>[key,catalog?catalog[normalize](value[key]):value[key]])),
    metricOrder:metricOrder(value.metricOrder),
    metricVisible:metricVisible(value.metricVisible)
  };
}
function patch(value={},catalog){
  const result={};
  if(Number.isInteger(value.readingWidth)&&value.readingWidth>=768&&value.readingWidth<=1600)result.readingWidth=clampWidth(value.readingWidth);
  if(COMPOSER_FOLD_MODES.includes(value.composerAutoHide))result.composerAutoHide=value.composerAutoHide;
  if(COMPOSER_FOLD_STYLES.includes(value.composerHideStyle))result.composerHideStyle=value.composerHideStyle;
  if(typeof value.composerHideAfterSend==='boolean')result.composerHideAfterSend=value.composerHideAfterSend;
  if(isAssistantFontSize(value.assistantFontSize))result.assistantFontSize=value.assistantFontSize;
  if(typeof value.chatTitleCentered==='boolean')result.chatTitleCentered=value.chatTitleCentered;
  if(typeof value.workspaceTreeEnabled==='boolean')result.workspaceTreeEnabled=value.workspaceTreeEnabled;
  if(typeof value.fileChangesDefaultCollapsed==='boolean')result.fileChangesDefaultCollapsed=value.fileChangesDefaultCollapsed;
  if(typeof value.customAccent==='boolean')result.customAccent=value.customAccent;
  if(typeof value.tableEnabled==='boolean')result.tableEnabled=value.tableEnabled;
  if(typeof value.tableCentered==='boolean')result.tableCentered=value.tableCentered;
  if(['smart','ascending','descending'].includes(value.tableSortMode))result.tableSortMode=value.tableSortMode;
  if(typeof value.commandMenuEnabled==='boolean')result.commandMenuEnabled=value.commandMenuEnabled;
  if(catalog){
    if(value.commandVisible&&typeof value.commandVisible==='object'&&!Array.isArray(value.commandVisible))result.commandVisible=catalog.normalize(value.commandVisible);
    if(value.skillVisible&&typeof value.skillVisible==='object'&&!Array.isArray(value.skillVisible))result.skillVisible=catalog.normalizeSkillVisible(value.skillVisible);
    if(Array.isArray(value.commandSectionOrder))result.commandSectionOrder=catalog.normalizeSectionOrder(value.commandSectionOrder);
    if(Array.isArray(value.commandGroupOrder))result.commandGroupOrder=catalog.normalizeGroupOrder(value.commandGroupOrder);
    if(value.commandItemOrder&&typeof value.commandItemOrder==='object'&&!Array.isArray(value.commandItemOrder))result.commandItemOrder=catalog.normalizeItemOrder(value.commandItemOrder);
  }
  if(Array.isArray(value.metricOrder))result.metricOrder=metricOrder(value.metricOrder);
  if(value.metricVisible&&typeof value.metricVisible==='object'&&!Array.isArray(value.metricVisible))result.metricVisible=metricVisible(value.metricVisible);
  return result;
}

async function runWindow({page,state,settings,store,sources,hosts,runtime,stopping}){
  const {readPrompts,catalog}=hosts.commands??{};
  const {manager:aiRename,listDesktopRenameTargets,setDesktopThreadTitle}=hosts.aiRename??{};
  const {readBinding,formatMetrics}=hosts.hud??{};
  const {accent:readThemes,workspaceTree:workspaceAction}=hosts;
  const writer=createWriter(),write=writer.write;
  const active=()=>!state.stopped&&!stopping()&&!page.isClosed()&&session?.isConnected()&&isMainPageUrl(page.url());
  let session,previous,settingsSaveError=null;
  const collector=sources.hud?createCollector({settings,runtime}):null;
  let renameStatus={phase:'idle',reason:null,updatedAt:0};
  async function install(name,source,feature=false){
    if(!source)return false;
    if(!await page.evaluate(name=>Boolean(window[name]),name)){
      const {exceptionDetails}=await session.send('Runtime.evaluate',{expression:'if('+pageGuard+'){'+source+'\n}'});
      if(exceptionDetails){
        if(feature)await page.evaluate(({name,id})=>{
          if(window.__betterCodexRuntime!==id)return;
          try{window[name]?.remove?.();}catch{}
          delete window[name];
        },{name,id:state.id}).catch(()=>{});
        throw Error('Page module initialization failed');
      }
    }
    return true;
  }
  function installFeature(key){
    return install(pageGlobals[key],sources[key],true).catch(()=>false);
  }
  async function ensureRuntime(){
    if(await page.evaluate(()=>window.__betterCodexRuntime)===state.id)return;
    await page.evaluate(modules=>{
      for(const name of modules){
        try{window[name]?.remove();}catch{}
        delete window[name];
      }
      delete window.__codexHudI18n;delete window.__codexHudLanguage;
    },pageModules);
    await page.evaluate(id=>{window.__betterCodexRuntime=id;},state.id);
  }
  async function onPromptRequest({name,payload}){
    if(name!==promptBinding||typeof payload!=='string'||payload.length>80||!active())return;
    try{
      const requested=await page.evaluate(({runtime,request})=>window.__betterCodexRuntime===runtime&&window.__codexCommandMenu?.promptRequests?.().includes(request),{runtime:state.id,request:payload});
      if(!requested||!active())return;
      const entries=await readPrompts();
      if(active())await page.evaluate(({runtime,requests,entries})=>{
        if(window.__betterCodexRuntime===runtime)window.__codexCommandMenu?.promptState?.({requests,entries});
      },{runtime:state.id,requests:[payload],entries});
    }catch{} // Navigation or a disconnected reader must not interrupt ordinary window updates.
  }
  async function acceptRename(requestId){
    if(!active())return;
    const request=await page.evaluate(({runtime,requestId})=>
      window.__betterCodexRuntime===runtime?window.__codexAiRename?.pull?.(requestId):null,
    {runtime:state.id,requestId});
    if(!request)return;
    const onState=(status,value)=>{
      renameStatus=status;
      if(value.running&&!value.batch||!active())return;
      page.evaluate(({runtime,value})=>{
        if(window.__betterCodexRuntime===runtime)window.__codexAiRename?.state?.(value);
      },{runtime:state.id,value}).catch(()=>{});
    };
    if(request.kind==='project')aiRename.startProject(request,onState,{
      listTargets:(ids,signal)=>listDesktopRenameTargets(page,ids,signal),
      saveTitle:async options=>{
        if(!await setDesktopThreadTitle(page,options))throw Error('title-api-unavailable');
      }
    });
    else aiRename.start(request,onState);
  }
  function onRenameRequest({name,payload}){
    if(name===renameBinding&&typeof payload==='string'&&payload.length<=80)acceptRename(payload).catch(()=>{});
  }
  async function onWorkspaceRequest({name,payload}){
    if(name!==workspaceBinding||typeof payload!=='string'||!(/^[a-f0-9-]{36}$/.test(payload))||!active())return;
    const id={runtime:state.id,request:payload};
    try{
      const request=await page.evaluate(({runtime,request})=>
        window.__betterCodexRuntime===runtime?window.__codexWorkspaceTree?.pullAction?.(request):null,id);
      if(!request||!active())return;
      const confirm=method=>async()=>active()&&await page.evaluate(({runtime,request,method})=>
        window.__betterCodexRuntime===runtime&&window.__codexWorkspaceTree?.[method]?.(request),{...id,method});
      const report=async status=>{if(active())await page.evaluate(({runtime,request,status})=>{
        if(window.__betterCodexRuntime===runtime)window.__codexWorkspaceTree?.actionResult?.(request,status);
      },{...id,status});};
      const status=await workspaceAction(request,confirm('confirmAction'),confirm('confirmPreview'),{
        id:payload,scope:state.id,onClose:()=>{void report('nativePreviewClosed').catch(()=>{});}
      });
      await report(status);
    }catch{} // Closed windows and navigation must not block other windows.
  }
  try{
    fs.mkdirSync(runtime,{recursive:true});
    session=await page.attach();
    if(sources.aiRename){
      session.on('Runtime.bindingCalled',onRenameRequest);
      await session.send('Runtime.addBinding',{name:renameBinding}).catch(()=>{});
    }
    if(readPrompts){
      session.on('Runtime.bindingCalled',onPromptRequest);
      await session.send('Runtime.addBinding',{name:promptBinding}).catch(()=>{});
    }
    if(sources.workspaceTree&&workspaceAction){
      session.on('Runtime.bindingCalled',onWorkspaceRequest);
      await session.send('Runtime.addBinding',{name:workspaceBinding}).catch(()=>{});
    }
    while(active()){
      const collectorStatus=collector?.tick();
      try{
        await ensureRuntime();
        await install('__codexHudI18n',sources.i18n);
        for(const key of ['commands','aiRename','fold','workspaceTree'])await installFeature(key);
        const hudReady=await installFeature('hud');
        let currentPreferences=preferences(store.read(),catalog);
        if(hudReady)try{
          const request=await page.evaluate(()=>window.__codexComposerHud.settingsRequest());
          const saved=patch(request?.value,catalog);
          if(Object.keys(saved).length){
            await store.patch(saved);
            await page.evaluate(value=>window.__codexComposerHud.settingsAck(value),request);
            currentPreferences=preferences(store.read(),catalog);
            settingsSaveError=null;
          }
        }catch{settingsSaveError='save-failed';}
        let readingWidth={applied:false,reason:'layout-or-settings-unavailable'};
        try{
          if(await installFeature('reading'))readingWidth=await page.evaluate(value=>{
            const reading=window.__codexReadingWidth;
            reading.setChatTitleCentered?.((value.hudReady?window.__codexComposerHud?.settingsRequest()?.value.chatTitleCentered:undefined)??value.chatTitleCentered);
            reading.setTablesEnabled?.(value.tableEnabled);reading.setTableCentered?.(value.tableCentered);
            return reading.update(value.readingWidth);
          },{hudReady,readingWidth:store.read().readingWidth,tableEnabled:currentPreferences.tableEnabled,tableCentered:currentPreferences.tableCentered,chatTitleCentered:currentPreferences.chatTitleCentered});
        }catch{/* Keep the unavailable status for this feature. */}
        let tableSort;
        try{
          if(await installFeature('sorting')){
            tableSort=await page.evaluate(value=>{window.__codexTableSort.setEnabled?.(value.enabled);window.__codexTableSort.setDefaultMode?.(value.mode);return window.__codexTableSort.snapshot?.();},{enabled:currentPreferences.tableEnabled,mode:currentPreferences.tableSortMode});
          }
        }catch{tableSort={reason:'sort-unavailable'};}
        let fileChanges={reason:'layout-unavailable'};
        try{
          if(await installFeature('files'))fileChanges=await page.evaluate(value=>{
            window.__codexFileChanges.setDefaultCollapsed?.(value);
            return window.__codexFileChanges.snapshot();
          },currentPreferences.fileChangesDefaultCollapsed);
        }catch{/* Keep the unavailable status for this feature. */}
        let customAccent={applied:false,reason:'theme-unavailable'};
        try{
          if(currentPreferences.customAccent===false){
            await page.evaluate(()=>window.__codexCustomAccent?.remove());
            customAccent={applied:false,reason:'disabled'};
          }else if(await installFeature('accent')){
            const themes=readThemes();
            customAccent=await page.evaluate(value=>window.__codexCustomAccent.update(value),themes);
            if(themes===null)customAccent.reason='config-unavailable';
          }
        }catch{customAccent={applied:false,reason:'theme-unavailable'};}
        let observation={visible:false,reason:'statistics-unavailable'};
        if(hudReady)try{
          await page.evaluate(value=>window.__codexComposerHud.settingsState(value),{
            ...currentPreferences,
            readingWidth:Number.isInteger(readingWidth?.maxWidth)?readingWidth.maxWidth:currentPreferences.readingWidth
          });
          const request=await page.evaluate(()=>window.__codexComposerHud.bindingRequest());
          if(request)await page.evaluate(value=>window.__codexComposerHud.bind(value),{...request,id:readBinding(request,path.join(settings.codexHome,'session_index.jsonl'))});
          observation=await page.evaluate(()=>window.__codexComposerHud.snapshot());
        }catch{/* Other feature updates can succeed without the statistics panel. */}
        if(sources.aiRename)await acceptRename().catch(()=>{}); // fallback if a fast-path binding is unavailable
        if(Object.hasOwn(observation,'id')&&observation.id!==previous){
          if(write(path.join(runtime,'selection.json'),{thread_id:observation.id,title:'',binding_mode:'manual'}))previous=observation.id;
        }
        // Both the directory and the thread/generation checks belong to this page only.
        const data=collector?.snapshot();
        let rendered=false;
        if(observation.id&&active())rendered=await page.evaluate(value=>window.__codexComposerHud?.render(value),{
          id:observation.id,generation:observation.generation,locale:observation.locale,
          speedMode:data?.metrics?.speed_mode,
          ...formatMetrics(data,observation.id,Date.now(),observation.locale)});
        state.status={...observation,rendered,readingWidth,tableSort,fileChanges,customAccent,preferences:currentPreferences,
          settingsSaveError,collector:collectorStatus,
          collectorBound:Boolean(data&&data.thread_id===observation.id&&data.binding==='ok'),aiRename:renameStatus,
          writes:writer.diagnostics(),checkedAt:Date.now()};
        write(path.join(runtime,'view-status.json'),state.status);
      }catch(error){
        // Navigation can destroy an execution context; retry this page without dropping other windows.
        state.status={visible:false,rendered:false,reason:'page-unavailable',errorType:error.name,code:error.code||null,checkedAt:Date.now()};
      }
      await sleep(350);
    }
  }finally{
    // Each worker owns only its page, CDP session, collector and runtime directory.
    await collector?.stop();
    if(!page.isClosed())await page.evaluate(({modules,id})=>{
      if(window.__betterCodexRuntime!==id)return;
      for(const name of modules){
        try{window[name]?.remove();}catch{}
      }
      delete window.__codexHudI18n;delete window.__codexHudLanguage;
      delete window.__betterCodexRuntime;
    },{modules:pageModules,id:state.id}).catch(()=>{});
    if(session){
      if(sources.aiRename){session.off('Runtime.bindingCalled',onRenameRequest);await session.send('Runtime.removeBinding',{name:renameBinding}).catch(()=>{});}
      if(readPrompts){session.off('Runtime.bindingCalled',onPromptRequest);await session.send('Runtime.removeBinding',{name:promptBinding}).catch(()=>{});}
      if(sources.workspaceTree&&workspaceAction){session.off('Runtime.bindingCalled',onWorkspaceRequest);await session.send('Runtime.removeBinding',{name:workspaceBinding}).catch(()=>{});}
      await session.detach().catch(()=>{});
    }
    // Async removal retries transient Windows locks without blocking other windows.
    try{await fs.promises.rm(runtime,{recursive:true,force:true,maxRetries:4,retryDelay:50});}catch{}
  }
}
module.exports={runWindow};

