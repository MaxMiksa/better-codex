const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {formatMetrics}=require('./metrics-view.cjs');
const {createWriter}=require('./runtime-writer.cjs');
const {readBinding}=require('./chat-binding.cjs');
const [settingsPath,runtime]=process.argv.slice(2),settings=JSON.parse(fs.readFileSync(settingsPath,'utf8').replace(/^\uFEFF/,''));
const {chromium}=require(settings.playwright),stop=path.join(runtime,'stop');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
const writer=createWriter(),write=writer.write;
async function main(){
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${settings.port}`,{timeout:5000});
  let page,session,collector;
  try{
    const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()==='app://-/index.html');
    if(pages.length!==1)throw Error('ambiguous-page');
    page=pages[0];session=await page.context().newCDPSession(page);
    collector=spawn(settings.python,['-I','-X','utf8',path.join(settings.collectorDir,'metrics.py'),'--runtime',runtime,'--codex-home',settings.codexHome,'--parent-pid',String(process.pid)],{windowsHide:true,stdio:'ignore'});
    let collectorFailed=false;collector.on('error',()=>{collectorFailed=true;});
    const i18nSource=require('./i18n.js').pageSource();
    const source=fs.readFileSync(path.join(__dirname,'composer-strip.js'),'utf8');
    const readingSource=fs.readFileSync(path.join(__dirname,'reading-width.js'),'utf8');
    const filesSource=fs.readFileSync(path.join(__dirname,'file-changes.js'),'utf8');
    let previous;
    while(browser.isConnected()&&!page.isClosed()&&!fs.existsSync(stop)){
      if(collectorFailed || collector.exitCode!==null)throw Error('collector-exited');
      const pagesNow=browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url()==='app://-/index.html');
      if(pagesNow.length!==1)throw Error('ambiguous-page');
      if(!await page.evaluate(()=>Boolean(window.__codexHudI18n)))await session.send('Runtime.evaluate',{expression:i18nSource});
      if(!await page.evaluate(()=>Boolean(window.__codexComposerHud)))await session.send('Runtime.evaluate',{expression:source});
      // Reading layout is optional; failure must not stop metrics or the app.
      let readingWidth;
      try{
        if(!await page.evaluate(()=>Boolean(window.__codexReadingWidth)))await session.send('Runtime.evaluate',{expression:readingSource});
        const preference=await page.evaluate(()=>window.__codexComposerHud.readingRequest());
        if(preference && Number.isInteger(preference.value) && preference.value>=768 && preference.value<=1600){
          const latest=read(settingsPath);
          if(latest && write(settingsPath,{...latest,readingWidth:preference.value}))await page.evaluate(value=>window.__codexComposerHud.readingAck(value),preference);
        }
        readingWidth=await page.evaluate(mode=>window.__codexReadingWidth.update(mode),read(settingsPath)?.readingWidth);
        await page.evaluate(value=>window.__codexComposerHud.readingState(value),readingWidth);
      }catch{readingWidth={applied:false,reason:'layout-unavailable'};}
      let fileChanges;
      try{
        if(!await page.evaluate(()=>Boolean(window.__codexFileChanges)))await session.send('Runtime.evaluate',{expression:filesSource});
        fileChanges=await page.evaluate(()=>window.__codexFileChanges.snapshot());
      }catch{fileChanges={reason:'layout-unavailable'};}
      const request=await page.evaluate(()=>window.__codexComposerHud.bindingRequest());
      if(request)await page.evaluate(value=>window.__codexComposerHud.bind(value),{...request,id:readBinding(request,path.join(settings.codexHome,'session_index.jsonl'))});
      const observation=await page.evaluate(()=>window.__codexComposerHud.snapshot());
      if(observation.id!==previous){
        if(write(path.join(runtime,'selection.json'),{thread_id:observation.id,title:'',binding_mode:'manual'}))previous=observation.id;
      }
      const data=read(path.join(runtime,'metrics.json'));
      let rendered=false;
      if(observation.id)rendered=await page.evaluate(value=>window.__codexComposerHud?.render(value),{id:observation.id,generation:observation.generation,locale:observation.locale,...formatMetrics(data,observation.id,Date.now(),observation.locale)});
      write(path.join(runtime,'view-status.json'),{...observation,rendered,readingWidth,fileChanges,collectorBound:data?.thread_id===observation.id&&data?.binding==='ok',writes:writer.diagnostics(),checkedAt:Date.now()});
      await sleep(350);
    }
  }finally{
    if(page)await page.evaluate(()=>window.__codexFileChanges?.remove()).catch(()=>{});
    if(page)await page.evaluate(()=>window.__codexReadingWidth?.remove()).catch(()=>{});
    if(page)await page.evaluate(()=>window.__codexComposerHud?.remove()).catch(()=>{});
    if(page)await page.evaluate(()=>{delete window.__codexHudI18n;delete window.__codexHudLanguage;}).catch(()=>{});
    if(session)await session.detach().catch(()=>{});
    if(collector && collector.exitCode===null)collector.kill();
    // Never invoke Browser.close on the user's app. Process exit disconnects CDP.
  }
}
main().then(()=>process.exit(0),error=>{
  write(path.join(runtime,'controller-error.json'),{errorType:error.name,code:error.code||null,checkedAt:Date.now()});
  process.exit(1);
});
