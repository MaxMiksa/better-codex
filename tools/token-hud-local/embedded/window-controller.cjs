const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {formatMetrics}=require('./metrics-view.cjs');
const {createWriter}=require('./runtime-writer.cjs');
const {readBinding}=require('./chat-binding.cjs');
const {isMainPageUrl,pageGuard}=require('./page-contract.cjs');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};

async function runWindow({page,state,settings,store,sources,readThemes,runtime,stopping}){
  const writer=createWriter(),write=writer.write;
  const active=()=>!state.stopped&&!stopping()&&!page.isClosed()&&isMainPageUrl(page.url());
  let session,collector,collectorFailed=false,previous;
  async function install(name,source){
    if(!await page.evaluate(name=>Boolean(window[name]),name)){
      await session.send('Runtime.evaluate',{expression:'if('+pageGuard+'){'+source+'\n}'});
    }
  }
  try{
    fs.mkdirSync(runtime,{recursive:true});
    session=await page.context().newCDPSession(page);
    collector=spawn(settings.python,['-I','-X','utf8',path.join(settings.collectorDir,'metrics.py'),
      '--runtime',runtime,'--codex-home',settings.codexHome,'--parent-pid',String(process.pid)],{windowsHide:true,stdio:'ignore'});
    collector.on('error',()=>{collectorFailed=true;});
    while(active()){
      if(collectorFailed||collector.exitCode!==null||collector.signalCode!==null)throw Error('collector-exited');
      try{
        await install('__codexHudI18n',sources.i18n);
        await install('__codexComposerHud',sources.hud);
        let readingWidth;
        try{
          await install('__codexReadingWidth',sources.reading);
          const preference=await page.evaluate(()=>window.__codexComposerHud.readingRequest());
          if(preference&&Number.isInteger(preference.value)&&preference.value>=768&&preference.value<=1600){
            await store.patch({readingWidth:preference.value});
            await page.evaluate(value=>window.__codexComposerHud.readingAck(value),preference);
          }
          readingWidth=await page.evaluate(mode=>window.__codexReadingWidth.update(mode),store.read().readingWidth);
          await page.evaluate(value=>window.__codexComposerHud.readingState(value),readingWidth);
        }catch{readingWidth={applied:false,reason:'layout-or-settings-unavailable'};}
        let fileChanges;
        try{
          await install('__codexFileChanges',sources.files);
          fileChanges=await page.evaluate(()=>window.__codexFileChanges.snapshot());
        }catch{fileChanges={reason:'layout-unavailable'};}
        let customAccent;
        try{
          if(store.read().customAccent===false){
            await page.evaluate(()=>window.__codexCustomAccent?.remove());
            customAccent={applied:false,reason:'disabled'};
          }else{
            await install('__codexCustomAccent',sources.accent);
            const themes=readThemes();
            customAccent=await page.evaluate(value=>window.__codexCustomAccent.update(value),themes);
            if(themes===null)customAccent.reason='config-unavailable';
          }
        }catch{customAccent={applied:false,reason:'theme-unavailable'};}
        const request=await page.evaluate(()=>window.__codexComposerHud.bindingRequest());
        if(request)await page.evaluate(value=>window.__codexComposerHud.bind(value),{...request,id:readBinding(request,path.join(settings.codexHome,'session_index.jsonl'))});
        const observation=await page.evaluate(()=>window.__codexComposerHud.snapshot());
        if(observation.id!==previous){
          if(write(path.join(runtime,'selection.json'),{thread_id:observation.id,title:'',binding_mode:'manual'}))previous=observation.id;
        }
        // Both the directory and the thread/generation checks belong to this page only.
        const data=read(path.join(runtime,'metrics.json'));
        let rendered=false;
        if(observation.id&&active())rendered=await page.evaluate(value=>window.__codexComposerHud?.render(value),{
          id:observation.id,generation:observation.generation,locale:observation.locale,
          ...formatMetrics(data,observation.id,Date.now(),observation.locale)});
        state.status={...observation,rendered,readingWidth,fileChanges,customAccent,
          collectorBound:data?.thread_id===observation.id&&data?.binding==='ok',writes:writer.diagnostics(),checkedAt:Date.now()};
        write(path.join(runtime,'view-status.json'),state.status);
      }catch(error){
        // Navigation can destroy an execution context; retry this page without dropping other windows.
        state.status={visible:false,rendered:false,reason:'page-unavailable',errorType:error.name,code:error.code||null,checkedAt:Date.now()};
      }
      await sleep(350);
    }
  }finally{
    // Each worker owns only its page, CDP session, collector and runtime directory.
    if(collector&&collector.exitCode===null&&collector.signalCode===null){
      await new Promise(resolve=>{
        collector.once('exit',resolve);
        collector.once('error',resolve);
        if(!collector.kill())resolve();
      });
    }
    if(!page.isClosed())await page.evaluate(()=>{
      for(const name of ['__codexCustomAccent','__codexFileChanges','__codexReadingWidth','__codexComposerHud']){
        try{window[name]?.remove();}catch{}
      }
      delete window.__codexHudI18n;delete window.__codexHudLanguage;
    }).catch(()=>{});
    if(session)await session.detach().catch(()=>{});
    // Async removal retries transient Windows locks without blocking other windows.
    try{await fs.promises.rm(runtime,{recursive:true,force:true,maxRetries:4,retryDelay:50});}catch{}
  }
}
module.exports={runWindow};
