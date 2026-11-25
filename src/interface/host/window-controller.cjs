const fs=require('node:fs'),path=require('node:path');
const {createCollector}=require('./collector-session.cjs');
const {formatMetrics}=require('../statistics/metrics-view.cjs');
const {createWriter}=require('./runtime-writer.cjs');
const {readBinding}=require('../statistics/chat-binding.cjs');
const {isMainPageUrl,pageGuard}=require('./page-contract.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const promptBinding='__betterCodexRequestPrompts';
const renameBinding='__betterCodexRequestAiRename';
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
const {normalize:commandVisible,normalizeSkillVisible,normalizeSectionOrder,normalizeGroupOrder,normalizeItemOrder}=require('../appearance/command-menu.js');
const METRIC_KEYS=['ttft','speed','cache','age'];
const DEFAULT_PREFERENCES={readingWidth:1152,fileChangesDefaultCollapsed:true,customAccent:true,tableEnabled:true,tableCentered:true,tableSortMode:'smart',
  metricOrder:[...METRIC_KEYS],metricVisible:Object.fromEntries(METRIC_KEYS.map(key=>[key,true]))};
const COMPOSER_FOLD_MODES=['off','minimize','hide'];
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
function preferences(value={}){
  return {
    readingWidth:Number.isInteger(value.readingWidth)&&value.readingWidth>=768&&value.readingWidth<=1600?clampWidth(value.readingWidth):DEFAULT_PREFERENCES.readingWidth,
    composerAutoHide:COMPOSER_FOLD_MODES.includes(value.composerAutoHide)?value.composerAutoHide:'off',
    composerHideAfterSend:value.composerHideAfterSend===true,
    assistantFontSize:isAssistantFontSize(value.assistantFontSize)?value.assistantFontSize:null,
    chatTitleCentered:value.chatTitleCentered!==false,
    fileChangesDefaultCollapsed:typeof value.fileChangesDefaultCollapsed==='boolean'?value.fileChangesDefaultCollapsed:DEFAULT_PREFERENCES.fileChangesDefaultCollapsed,
    customAccent:typeof value.customAccent==='boolean'?value.customAccent:DEFAULT_PREFERENCES.customAccent,
    tableEnabled:typeof value.tableEnabled==='boolean'?value.tableEnabled:typeof value.tableOptimization==='boolean'?value.tableOptimization:DEFAULT_PREFERENCES.tableEnabled,
    tableCentered:typeof value.tableCentered==='boolean'?value.tableCentered:DEFAULT_PREFERENCES.tableCentered,
    tableSortMode:['smart','ascending','descending'].includes(value.tableSortMode)?value.tableSortMode:DEFAULT_PREFERENCES.tableSortMode,
    commandMenuEnabled:typeof value.commandMenuEnabled==='boolean'?value.commandMenuEnabled:true,
    commandVisible:commandVisible(value.commandVisible),
    skillVisible:normalizeSkillVisible(value.skillVisible),
    commandSectionOrder:normalizeSectionOrder(value.commandSectionOrder),
    commandGroupOrder:normalizeGroupOrder(value.commandGroupOrder),
    commandItemOrder:normalizeItemOrder(value.commandItemOrder),
    metricOrder:metricOrder(value.metricOrder),
    metricVisible:metricVisible(value.metricVisible)
  };
}
function patch(value={}){
  const result={};
  if(Number.isInteger(value.readingWidth)&&value.readingWidth>=768&&value.readingWidth<=1600)result.readingWidth=clampWidth(value.readingWidth);
  if(COMPOSER_FOLD_MODES.includes(value.composerAutoHide))result.composerAutoHide=value.composerAutoHide;
  if(typeof value.composerHideAfterSend==='boolean')result.composerHideAfterSend=value.composerHideAfterSend;
  if(isAssistantFontSize(value.assistantFontSize))result.assistantFontSize=value.assistantFontSize;
  if(typeof value.chatTitleCentered==='boolean')result.chatTitleCentered=value.chatTitleCentered;
  if(typeof value.fileChangesDefaultCollapsed==='boolean')result.fileChangesDefaultCollapsed=value.fileChangesDefaultCollapsed;
  if(typeof value.customAccent==='boolean')result.customAccent=value.customAccent;
  if(typeof value.tableEnabled==='boolean')result.tableEnabled=value.tableEnabled;
  if(typeof value.tableCentered==='boolean')result.tableCentered=value.tableCentered;
  if(['smart','ascending','descending'].includes(value.tableSortMode))result.tableSortMode=value.tableSortMode;
  if(typeof value.commandMenuEnabled==='boolean')result.commandMenuEnabled=value.commandMenuEnabled;
  if(value.commandVisible&&typeof value.commandVisible==='object'&&!Array.isArray(value.commandVisible))result.commandVisible=commandVisible(value.commandVisible);
  if(value.skillVisible&&typeof value.skillVisible==='object'&&!Array.isArray(value.skillVisible))result.skillVisible=normalizeSkillVisible(value.skillVisible);
  if(Array.isArray(value.commandSectionOrder))result.commandSectionOrder=normalizeSectionOrder(value.commandSectionOrder);
  if(Array.isArray(value.commandGroupOrder))result.commandGroupOrder=normalizeGroupOrder(value.commandGroupOrder);
  if(value.commandItemOrder&&typeof value.commandItemOrder==='object'&&!Array.isArray(value.commandItemOrder))result.commandItemOrder=normalizeItemOrder(value.commandItemOrder);
  if(Array.isArray(value.metricOrder))result.metricOrder=metricOrder(value.metricOrder);
  if(value.metricVisible&&typeof value.metricVisible==='object'&&!Array.isArray(value.metricVisible))result.metricVisible=metricVisible(value.metricVisible);
  return result;
}

async function runWindow({page,state,settings,store,sources,readThemes,readPrompts,aiRename,runtime,stopping}){
  const writer=createWriter(),write=writer.write;
  const active=()=>!state.stopped&&!stopping()&&!page.isClosed()&&isMainPageUrl(page.url());
  let session,previous,settingsSaveError=null;
  const collector=createCollector({settings,runtime});
  let renameStatus={phase:'idle',reason:null,updatedAt:0};
  async function install(name,source){
    if(!await page.evaluate(name=>Boolean(window[name]),name)){
      await session.send('Runtime.evaluate',{expression:'if('+pageGuard+'){'+source+'\n}'});
    }
  }
  async function ensureRuntime(){
    if(await page.evaluate(()=>window.__betterCodexRuntime)===state.id)return;
    await page.evaluate(()=>{
      for(const name of ['__codexTableSort','__codexCustomAccent','__codexFileChanges','__codexReadingWidth','__codexComposerHud','__codexComposerFold','__codexAiRename','__codexCommandMenu']){
        try{window[name]?.remove();}catch{}
        delete window[name];
      }
      delete window.__codexHudI18n;delete window.__codexHudLanguage;
    });
    await page.evaluate(id=>{window.__betterCodexRuntime=id;},state.id);
  }
  async function onPromptRequest({name,payload}){
    if(name!==promptBinding||typeof payload!=='string'||payload.length>80||!active())return;
    try{
      const requested=await page.evaluate(({runtime,request})=>window.__betterCodexRuntime===runtime&&window.__codexCommandMenu?.promptRequests?.().includes(request),{runtime:state.id,request:payload});
      if(!requested||!active())return;
      const entries=await readPrompts();
      if(active())await page.evaluate(({runtime,requests,entries})=>{
        if(location.protocol==='app:'&&location.host==='-'&&location.pathname==='/index.html'&&window.__betterCodexRuntime===runtime)window.__codexCommandMenu?.promptState?.({requests,entries});
      },{runtime:state.id,requests:[payload],entries});
    }catch{} // Navigation or a disconnected reader must not interrupt ordinary window updates.
  }
  async function acceptRename(requestId){
    if(!active())return;
    const request=await page.evaluate(({runtime,requestId})=>
      window.__betterCodexRuntime===runtime?window.__codexAiRename?.pull?.(requestId):null,
    {runtime:state.id,requestId});
    if(!request)return;
    aiRename.start(request,(status,value)=>{
      renameStatus=status;
      if(value.running||!active())return;
      page.evaluate(({runtime,value})=>{
        if(window.__betterCodexRuntime===runtime)window.__codexAiRename?.state?.(value);
      },{runtime:state.id,value}).catch(()=>{});
    });
  }
  function onRenameRequest({name,payload}){
    if(name===renameBinding&&typeof payload==='string'&&payload.length<=80)acceptRename(payload).catch(()=>{});
  }
  try{
    fs.mkdirSync(runtime,{recursive:true});
    session=await page.context().newCDPSession(page);
    if(sources.aiRename){
      session.on('Runtime.bindingCalled',onRenameRequest);
      await session.send('Runtime.addBinding',{name:renameBinding}).catch(()=>{});
    }
    if(readPrompts){
      session.on('Runtime.bindingCalled',onPromptRequest);
      await session.send('Runtime.addBinding',{name:promptBinding}).catch(()=>{});
    }
    while(active()){
      const collectorStatus=collector.tick();
      try{
        await ensureRuntime();
        await install('__codexHudI18n',sources.i18n);
        if(sources.commands)await install('__codexCommandMenu',sources.commands);
        if(sources.aiRename)await install('__codexAiRename',sources.aiRename);
        if(sources.fold)await install('__codexComposerFold',sources.fold);
        await install('__codexComposerHud',sources.hud);
        let currentPreferences=preferences(store.read());
        try{
          const request=await page.evaluate(()=>window.__codexComposerHud.settingsRequest());
          const saved=patch(request?.value);
          if(Object.keys(saved).length){
            await store.patch(saved);
            await page.evaluate(value=>window.__codexComposerHud.settingsAck(value),request);
            currentPreferences=preferences(store.read());
            settingsSaveError=null;
          }
        }catch{settingsSaveError='save-failed';}
        let readingWidth;
        try{
          await install('__codexReadingWidth',sources.reading);
          readingWidth=await page.evaluate(value=>{
            const reading=window.__codexReadingWidth;
            reading.setChatTitleCentered?.(window.__codexComposerHud.settingsRequest()?.value.chatTitleCentered??value.chatTitleCentered);
            reading.setTablesEnabled?.(value.tableEnabled);reading.setTableCentered?.(value.tableCentered);
            return reading.update(value.readingWidth);
          },{readingWidth:store.read().readingWidth,tableEnabled:currentPreferences.tableEnabled,tableCentered:currentPreferences.tableCentered,chatTitleCentered:currentPreferences.chatTitleCentered});
        }catch{readingWidth={applied:false,reason:'layout-or-settings-unavailable'};}
        let tableSort;
        try{
          if(sources.sorting){
            await install('__codexTableSort',sources.sorting);
            tableSort=await page.evaluate(value=>{window.__codexTableSort.setEnabled?.(value.enabled);window.__codexTableSort.setDefaultMode?.(value.mode);return window.__codexTableSort.snapshot?.();},{enabled:currentPreferences.tableEnabled,mode:currentPreferences.tableSortMode});
          }
        }catch{tableSort={reason:'sort-unavailable'};}
        let fileChanges;
        try{
          await install('__codexFileChanges',sources.files);
          fileChanges=await page.evaluate(value=>{
            window.__codexFileChanges.setDefaultCollapsed?.(value);
            return window.__codexFileChanges.snapshot();
          },currentPreferences.fileChangesDefaultCollapsed);
        }catch{fileChanges={reason:'layout-unavailable'};}
        let customAccent;
        try{
          if(currentPreferences.customAccent===false){
            await page.evaluate(()=>window.__codexCustomAccent?.remove());
            customAccent={applied:false,reason:'disabled'};
          }else{
            await install('__codexCustomAccent',sources.accent);
            const themes=readThemes();
            customAccent=await page.evaluate(value=>window.__codexCustomAccent.update(value),themes);
            if(themes===null)customAccent.reason='config-unavailable';
          }
        }catch{customAccent={applied:false,reason:'theme-unavailable'};}
        await page.evaluate(value=>window.__codexComposerHud.settingsState(value),{
          ...currentPreferences,
          readingWidth:Number.isInteger(readingWidth?.maxWidth)?readingWidth.maxWidth:currentPreferences.readingWidth
        });
        const request=await page.evaluate(()=>window.__codexComposerHud.bindingRequest());
        if(request)await page.evaluate(value=>window.__codexComposerHud.bind(value),{...request,id:readBinding(request,path.join(settings.codexHome,'session_index.jsonl'))});
        const observation=await page.evaluate(()=>window.__codexComposerHud.snapshot());
        if(sources.aiRename)await acceptRename(); // fallback if a fast-path binding is unavailable
        if(observation.id!==previous){
          if(write(path.join(runtime,'selection.json'),{thread_id:observation.id,title:'',binding_mode:'manual'}))previous=observation.id;
        }
        // Both the directory and the thread/generation checks belong to this page only.
        const recorded=read(path.join(runtime,'metrics.json'));
        const data=collector.accepts(recorded)?recorded:null;
        let rendered=false;
        if(observation.id&&active())rendered=await page.evaluate(value=>window.__codexComposerHud?.render(value),{
          id:observation.id,generation:observation.generation,locale:observation.locale,
          speedMode:data?.metrics?.speed_mode,
          ...formatMetrics(data,observation.id,Date.now(),observation.locale)});
        state.status={...observation,rendered,readingWidth,tableSort,fileChanges,customAccent,preferences:currentPreferences,
          settingsSaveError,collector:collectorStatus,
          collectorBound:data?.thread_id===observation.id&&data?.binding==='ok',aiRename:renameStatus,
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
    await collector.stop();
    if(!page.isClosed())await page.evaluate(()=>{
      for(const name of ['__codexTableSort','__codexCustomAccent','__codexFileChanges','__codexReadingWidth','__codexComposerHud','__codexComposerFold','__codexAiRename','__codexCommandMenu']){
        try{window[name]?.remove();}catch{}
      }
      delete window.__codexHudI18n;delete window.__codexHudLanguage;
      delete window.__betterCodexRuntime;
    }).catch(()=>{});
    if(session){
      if(sources.aiRename){session.off('Runtime.bindingCalled',onRenameRequest);await session.send('Runtime.removeBinding',{name:renameBinding}).catch(()=>{});}
      if(readPrompts){session.off('Runtime.bindingCalled',onPromptRequest);await session.send('Runtime.removeBinding',{name:promptBinding}).catch(()=>{});}
      await session.detach().catch(()=>{});
    }
    // Async removal retries transient Windows locks without blocking other windows.
    try{await fs.promises.rm(runtime,{recursive:true,force:true,maxRetries:4,retryDelay:50});}catch{}
  }
}
module.exports={runWindow};

