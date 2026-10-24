// Production controller + collectors in isolated Edge pages, using synthetic logs only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),{createSettingsStore}=require('../../src/platform/settings/settings-store.cjs');
const {pageGuard,isMainPageUrl}=require('../../src/interface/host/page-contract.cjs');
const root=path.resolve(__dirname,'../..'),scratch=path.resolve(process.argv[2]),evidence=path.resolve(process.argv[3]);
const dependencies=JSON.parse(fs.readFileSync(process.argv[4],'utf8').replace(/^\uFEFF/,''));
const playwright=require(dependencies.playwright),fixtureUrl='https://hud-fixture.invalid/index.html';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const results=[],collectors=new Set();
function check(name,condition){assert.ok(condition,name);results.push(name);console.log('PASS '+name);}
async function until(fn,label,timeout=12000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await fn();if(value)return value;await sleep(100);}
  throw Error('timeout: '+label);
}

// Only adapt Electron's app:// URL to an intercepted HTTPS fixture. All controller,
// page, collector, settings and CDP behavior otherwise runs from production files.
function browserAdapter(realPath,url,guard){
  const real=require(realPath),pages=new WeakMap(),contexts=new WeakMap();
  const pageProxy=page=>{
    if(!pages.has(page))pages.set(page,new Proxy(page,{get(target,key){
      if(key==='url')return ()=>target.url()===url||target.url().startsWith(url+'?')?'app://-/index.html'+target.url().slice(url.length):target.url();
      if(key==='context')return ()=>contextProxy(target.context());
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }}));
    return pages.get(page);
  };
  const contextProxy=context=>{
    if(!contexts.has(context))contexts.set(context,new Proxy(context,{get(target,key){
      if(key==='pages')return ()=>target.pages().map(pageProxy);
      if(key==='newCDPSession')return async page=>{
        const raw=target.pages().find(candidate=>pageProxy(candidate)===page);
        const session=await target.newCDPSession(raw);
        return new Proxy(session,{get(object,property){
          if(property==='send')return (method,params)=>{
            if(method==='Runtime.evaluate')params={...params,expression:params.expression.replace(
              guard,'location.origin==='+JSON.stringify(new URL(url).origin)+'&&location.pathname==='+JSON.stringify(new URL(url).pathname))};
            return object.send(method,params);
          };
          const value=object[property];return typeof value==='function'?value.bind(object):value;
        }});
      };
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }}));
    return contexts.get(context);
  };
  return {chromium:{async connectOverCDP(endpoint,options){
    const browser=await real.chromium.connectOverCDP(endpoint,options);
    return new Proxy(browser,{get(target,key){
      if(key==='contexts')return ()=>target.contexts().map(contextProxy);
      const value=target[key];return typeof value==='function'?value.bind(target):value;
    }});
  }}};
}
function html(id){
  const source=fs.readFileSync(path.join(__dirname,'../interface/verify.cjs'),'utf8');
  return source.match(/const html=`([\s\S]*?)`;/)[1].replaceAll('${id}',id)
    .replace('<html lang="zh-CN">','<html lang="zh-CN" data-theme="dark">')
    .replace('top:78px','top:360px')
    .replace('<style>','<style>:root{--codex-base-accent:#39c4f7;--color-background-user-message:#222222;--color-text-user-message:#ffffff;--color-background-composer-primary:#ffffff;--color-text-composer-primary:#000000}#bubble{background:var(--color-background-user-message)}')
    .replace('<div contenteditable="true"','<div data-above-composer-conversation-id="'+id+'"></div><div contenteditable="true"')
    .replace('Layout fixture','<div id="bubble">Fixture</div><section><div class="group/turn-diff-header">Summary</div><div class="flex flex-col border-t [--codex-diffs-header-padding-x:var(--resource-card-row-padding-x)]"><div>Fixture one</div><div>Fixture two</div></div></section>');
}
function logs(home,id,output,cached){
  const at=Date.now()-5000,t=n=>new Date(at+n).toISOString();
  const rows=[{type:'session_meta',payload:{id,timestamp:t(0),model:'fixture',cwd:'fixture'}},
    {type:'event_msg',timestamp:t(1000),payload:{type:'task_started',turn_id:id}},
    {type:'token_usage_record',timestamp:t(2000),payload:{response_id:id,usage:{input_tokens:100,cached_input_tokens:cached,output_tokens:output}}},
    {type:'event_msg',timestamp:t(2001),payload:{type:'task_complete'}}];
  fs.writeFileSync(path.join(home,'sessions',id+'.jsonl'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
}
async function snapshot(page){
  return page.evaluate(()=>{
    const host=document.querySelector('#codex-composer-hud'),spans=host?.shadowRoot.querySelectorAll('span');
    return {id:document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id'),
      speed:spans?.[0].textContent,cache:spans?.[1].textContent,
      accent:Boolean(window.__codexCustomAccent),accentStyle:Boolean(document.getElementById('codex-hud-custom-accent')),
      width:Math.round(document.querySelector('[class~="max-w-(--thread-body-max-width)"]')?.getBoundingClientRect().width||0),
      modules:['__codexComposerHud','__codexReadingWidth','__codexFileChanges'].every(key=>Boolean(window[key]))};
  });
}
async function finish(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
}
(async()=>{
  assert.ok(scratch.startsWith(path.join(root,'.validation-runtime')+path.sep),'scratch must be in validation directory');
  assert.ok(!fs.existsSync(scratch),'use a fresh test directory');
  fs.mkdirSync(scratch,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
  const home=path.join(scratch,'synthetic-home'),runtime=path.join(scratch,'runtime');
  const sandbox=path.join(scratch,'settings sandbox 中文'),toolDir=path.join(sandbox,'tools/token-hud-local');
  const settingsPath=path.join(sandbox,'.runtime/token-hud/embedded/settings.json');
  fs.mkdirSync(path.join(home,'sessions'),{recursive:true});fs.mkdirSync(runtime,{recursive:true});
  fs.mkdirSync(path.dirname(settingsPath),{recursive:true});
  fs.cpSync(path.join(root,'tools/token-hud-local'),toolDir,{recursive:true,filter:source=>!source.includes('__pycache__')});
  fs.cpSync(path.join(root,'src'),path.join(sandbox,'src'),{recursive:true,filter:source=>!source.includes('__pycache__')});
  fs.copyFileSync(path.join(root,'VERSION'),path.join(sandbox,'VERSION'));
  logs(home,A,110,13);logs(home,B,370,83);
  fs.writeFileSync(path.join(home,'config.toml'),'[desktop.appearanceDarkChromeTheme]\naccentSource="custom"\naccent="#39c4f7"\nsurface="#111111"\n');
  const adapter=path.join(scratch,'browser-adapter.cjs');
  fs.writeFileSync(adapter,'module.exports=('+browserAdapter.toString()+')('+JSON.stringify(dependencies.playwright)+','+JSON.stringify(fixtureUrl)+','+JSON.stringify(pageGuard)+');');
  let context,controller,lock;
  let output='';
  try{
    context=await playwright.chromium.launchPersistentContext(path.join(scratch,'browser'),{
      headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      viewport:{width:1261,height:600},args:['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0']});
    const port=Number((await until(()=>{try{return fs.readFileSync(path.join(scratch,'browser/DevToolsActivePort'),'utf8');}catch{return null;}},'isolated CDP port')).split('\n')[0]);
    assert.ok(port>0&&port!==19163,'never connect to the user desktop port');
    await context.route(fixtureUrl+'*',route=>route.fulfill({contentType:'text/html',body:html(A)}));
    let p1=await context.newPage(),p2=await context.newPage();
    await Promise.all([p1.goto(fixtureUrl),p2.goto(fixtureUrl+'?initialRoute=fixture')]);
    await p2.evaluate(id=>{document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id);},B);
    const settings={...dependencies,port,playwright:adapter,codexHome:home,collectorDir:path.join(root,'tools/token-hud-local/collector'),readingWidth:1232,customAccent:true,sentinel:'保留中文设置'};
    fs.writeFileSync(settingsPath,JSON.stringify(settings));
    const store=createSettingsStore(settingsPath,settings);
    controller=spawn(dependencies.node,[path.join(__dirname,'../../src/interface/host/controller.cjs'),settingsPath,runtime],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    controller.stdout.on('data',chunk=>{output+=chunk;});controller.stderr.on('data',chunk=>{output+=chunk;});
    const view=()=>read(path.join(runtime,'view-status.json'));
    const track=()=>{for(const entry of view()?.windows||[]){const data=read(path.join(runtime,'windows',entry.windowId,'metrics.json'));if(data?.collector_pid)collectors.add(data.collector_pid);}};
    const matching=async(page,id,speed,cache)=>{const s=await snapshot(page);return s.id===id&&s.speed===speed&&s.cache===cache;};
    await until(async()=>await matching(p1,A,'110 tok/s','13%')&&await matching(p2,B,'370 tok/s','83%'),'two independent rendered statistics');
    track();check('production-controller-and-collectors-render-two-distinct-chats',view().windows.length===2&&collectors.size===2);
    check('route-parameter-window-supported-without-accepting-other-documents',isMainPageUrl('app://-/index.html?initialRoute=fixture')&&!isMainPageUrl('app://-/detached-window.html?initialRoute=fixture')&&!isMainPageUrl('https://example.invalid/index.html'));
    check('all-enhancements-coexist-in-both-pages',(await snapshot(p1)).modules&&(await snapshot(p2)).modules&&(await snapshot(p1)).accentStyle&&(await snapshot(p2)).accentStyle&&(await snapshot(p1)).width===1232&&(await snapshot(p2)).width===1232);
    const first=view().windows.find(w=>w.id===A),second=view().windows.find(w=>w.id===B);
    check('selection-and-metrics-directories-are-disjoint',first.windowId!==second.windowId&&read(path.join(runtime,'windows',first.windowId,'selection.json')).thread_id===A&&read(path.join(runtime,'windows',second.windowId,'selection.json')).thread_id===B&&!fs.existsSync(path.join(runtime,'metrics.json')));
    for(let i=0;i<4;i++){
      await p1.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),i%2?A:B);
      await until(async()=>await matching(p1,i%2?A:B,i%2?'110 tok/s':'370 tok/s',i%2?'13%':'83%'),'chat switch');
      const sample=await snapshot(p2);assert.equal(sample.speed,'370 tok/s');assert.equal(sample.cache,'83%');
    }
    check('repeated-chat-switches-do-not-change-the-other-window',true);
    const old=await p1.evaluate(()=>window.__codexComposerHud.snapshot());
    await p1.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),B);
    check('late-old-chat-render-is-rejected',!await p1.evaluate(value=>window.__codexComposerHud.render({...value,speed:'999 tok/s',cache:'99%',age:'old'}),old));
    await p1.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),A);
    await until(async()=>await matching(p1,A,'110 tok/s','13%'),'restore A');
    const shells=[path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe'),'C:/Program Files/PowerShell/7/pwsh.exe'];
    for(const shell of shells)for(let i=0;i<2;i++){
      await store.patch({readingWidth:1024,customAccent:true});
      await Promise.all([store.patch({readingWidth:1232}),execute(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(toolDir,'Set-CustomAccent.ps1'),'-Mode','Disable'],{windowsHide:true,timeout:15000})]);
      const saved=read(settingsPath);assert.equal(saved.readingWidth,1232);assert.equal(saved.customAccent,false);assert.equal(saved.sentinel,'保留中文设置');
    }
    check('concurrent-node-and-powershell-5-and-7-writes-preserve-both-preferences',true);
    await execute(shells[0],['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(toolDir,'Set-ReadingWidth.ps1'),'-Mode','Wide'],{windowsHide:true,timeout:15000});
    check('reading-width-script-uses-the-shared-writer',read(settingsPath).readingWidth==='wide'&&read(settingsPath).customAccent===false);
    await store.patch({readingWidth:1232});
    await until(async()=>!(await snapshot(p1)).accentStyle&&!(await snapshot(p2)).accentStyle,'disable accent in both pages');
    check('disable-accent-keeps-other-enhancements-in-both-windows',(await snapshot(p1)).modules&&(await snapshot(p2)).modules);
    lock=spawn(dependencies.python,['-I','-X','utf8','-c',"import ctypes,sys,time; k=ctypes.WinDLL('kernel32',use_last_error=True); k.CreateFileW.restype=ctypes.c_void_p; k.CreateFileW.argtypes=[ctypes.c_wchar_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_void_p]; h=k.CreateFileW(sys.argv[1],0x80000000,0,None,3,0,None); assert h!=ctypes.c_void_p(-1).value; print('ready',flush=True); time.sleep(30)",settingsPath],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    await new Promise((resolve,reject)=>{lock.stdout.once('data',resolve);lock.once('exit',code=>reject(Error('lock helper exited '+code)));lock.once('error',reject);});
    await sleep(1000);
    check('exclusive-file-lock-does-not-reenable-accent',!(await snapshot(p1)).accentStyle&&!(await snapshot(p2)).accentStyle&&store.read().customAccent===false);
    await assert.rejects(store.patch({readingWidth:1408}));
    check('unreadable-settings-save-fails-without-replacing-the-file',true);
    await finish(lock);lock=null;
    check('preferences-survive-the-lock',read(settingsPath).readingWidth===1232&&read(settingsPath).customAccent===false);
    const valid=fs.readFileSync(settingsPath,'utf8');fs.writeFileSync(settingsPath,'{broken');
    await sleep(700);await assert.rejects(store.patch({readingWidth:1408}));
    check('malformed-settings-keep-disabled-cache-and-are-not-overwritten',fs.readFileSync(settingsPath,'utf8')==='{broken'&&!(await snapshot(p1)).accentStyle&&!(await snapshot(p2)).accentStyle);
    fs.writeFileSync(settingsPath,valid);await store.patch({customAccent:true});
    await until(async()=>(await snapshot(p1)).accentStyle&&(await snapshot(p2)).accentStyle,'recover accent after read errors');
    check('settings-recover-and-reenable-without-controller-restart',controller.exitCode===null);
    const victim=view().windows.find(w=>w.id===A),victimRuntime=path.join(runtime,'windows',victim.windowId),victimData=read(path.join(victimRuntime,'metrics.json'));
    const originalHud=await p1.locator('#codex-composer-hud').elementHandle();
    await execute(dependencies.python,['-I','-c',"import psutil,sys; p=psutil.Process(int(sys.argv[1])); assert p.ppid()==int(sys.argv[2]); assert sys.argv[3] in p.cmdline(); p.terminate()",String(victimData.collector_pid),String(controller.pid),victimRuntime],{windowsHide:true,timeout:5000});
    await until(async()=>view()?.windows.some(w=>w.id===A&&w.windowId===victim.windowId)&&read(path.join(victimRuntime,'metrics.json'))?.collector_pid!==victimData.collector_pid&&await matching(p1,A,'110 tok/s','13%'),'single collector recovery');
    check('collector-recovery-keeps-the-original-hud-and-width',await originalHud.evaluate(node=>node.isConnected)&&(await snapshot(p1)).width===1232);
    track();check('one-collector-failure-recovers-without-replacing-the-other-window',view().windows.find(w=>w.id===B).windowId===second.windowId&&await matching(p2,B,'370 tok/s','83%'));
    await p1.close();await until(()=>view()?.windows.length===1,'close first page');
    check('closing-one-window-preserves-the-other',await matching(p2,B,'370 tok/s','83%'));
    p1=await context.newPage();await p1.goto(fixtureUrl);
    await until(async()=>view()?.windows.length===2&&await matching(p1,A,'110 tok/s','13%'),'add new window');
    track();check('new-window-attaches-without-controller-restart',controller.exitCode===null);
    await p2.reload();await p2.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),B);
    await until(async()=>await matching(p2,B,'370 tok/s','83%'),'reload B');
    check('page-reload-rebuilds-enhancements-and-keeps-statistics-local',await matching(p1,A,'110 tok/s','13%'));
    fs.writeFileSync(path.join(runtime,'stop'),'');
    await until(()=>controller.exitCode!==null,'controller shutdown');
    const cleaned=await Promise.all([p1,p2].map(page=>page.evaluate(()=>!window.__codexComposerHud&&!window.__codexCustomAccent&&!window.__codexReadingWidth&&!window.__codexFileChanges)));
    check('stop-cleans-both-pages',cleaned.every(Boolean)&&controller.exitCode===0);
    check('stop-cleans-own-runtime-directories',fs.readdirSync(path.join(runtime,'windows')).length===0);
    await execute(dependencies.python,['-I','-c',"import psutil,sys; assert all(not psutil.pid_exists(int(p)) for p in sys.argv[1:])",...Array.from(collectors,String)],{windowsHide:true,timeout:5000});
    check('all-observed-test-collectors-exit',true);
    fs.writeFileSync(path.join(evidence,'integration.json'),JSON.stringify({scope:'isolated Edge + production controller and collectors; app URL adapter; synthetic logs; no Codex desktop connection',passed:results.length,results},null,2));
    console.log(JSON.stringify({passed:results.length}));
  }catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({passed:results,error:String(error),controllerOutput:output},null,2));throw error;}
  finally{
    await finish(lock);
    if(controller&&controller.exitCode===null){fs.writeFileSync(path.join(runtime,'stop'),'');try{await until(()=>controller.exitCode!==null,'cleanup controller',7000);}catch{await finish(controller);}}
    if(context)await context.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
