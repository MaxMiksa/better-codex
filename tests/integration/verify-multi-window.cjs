// Production controller + in-process collectors in isolated Edge pages, using synthetic logs only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn,execFile}=require('node:child_process'),{promisify}=require('node:util');
const execute=promisify(execFile),{createSettingsStore}=require('../../src/platform/settings/settings-store.cjs');
const {isMainPageUrl}=require('../../src/runtime/page-contract.cjs');
const {connectToBrowser}=require('../../src/runtime/local-cdp.cjs');
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

async function checkDiscovery(){
  let reply,requests=0;
  const http=require('node:http'),server=http.createServer((req,res)=>{
    requests++;
    if(reply===null){res.writeHead(302,{Location:'/unexpected'});res.end();return;}
    res.end(JSON.stringify({webSocketDebuggerUrl:reply}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{
    for(const endpoint of [
      'ws://localhost:'+port+'/devtools/browser/fixture',
      'ws://127.0.0.1:'+(port===65535?port-1:port+1)+'/devtools/browser/fixture',
      'ws://127.0.0.1:'+port+'/devtools/page/fixture',
      'ws://127.0.0.1:'+port+'/devtools/browser/fixture?extra=1'
    ]){
      reply=endpoint;await assert.rejects(connectToBrowser(port),/Invalid local CDP endpoint/);
    }
    reply=null;await assert.rejects(connectToBrowser(port),/CDP discovery failed/);
    check('discovery-rejects-nonlocal-or-unexpected-endpoints-and-redirects',requests===5);
  }finally{await new Promise(resolve=>server.close(resolve));}
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
    const root=document.querySelector('#codex-composer-hud')?.shadowRoot;
    const value=key=>root?.querySelector('[data-metric-key="'+key+'"]')?.textContent;
    const preferences=window.__codexComposerHud?.snapshot().preferences;
    return {id:document.querySelector('[data-above-composer-conversation-id]')?.getAttribute('data-above-composer-conversation-id'),
      ttft:value('ttft'),speed:value('speed'),cache:value('cache'),
      tableEnabled:preferences?.tableEnabled,tableCentered:preferences?.tableCentered,tableSortMode:preferences?.tableSortMode,
      accent:Boolean(window.__codexCustomAccent),accentStyle:Boolean(document.getElementById('codex-hud-custom-accent')),
      width:Math.round(document.querySelector('[class~="max-w-(--thread-body-max-width)"]')?.getBoundingClientRect().width||0),
      modules:['__codexComposerHud','__codexReadingWidth','__codexTableSort','__codexFileChanges'].every(key=>Boolean(window[key]))};
  });
}
async function finish(child){
  if(!child||child.exitCode!==null||child.signalCode!==null)return;
  if(child.stdin?.writable)child.stdin.end();
  await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
}
(async()=>{
  assert.ok(scratch.startsWith(path.join(root,'.validation-runtime')+path.sep),'scratch must be in validation directory');
  assert.ok(!fs.existsSync(scratch),'use a fresh test directory');
  fs.mkdirSync(scratch,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
  const home=path.join(scratch,'synthetic-home'),runtime=path.join(scratch,'runtime');
  const sandbox=path.join(scratch,'settings sandbox 中文');
  const settingsPath=path.join(sandbox,'.runtime/settings.json');
  fs.mkdirSync(path.join(home,'sessions'),{recursive:true});fs.mkdirSync(runtime,{recursive:true});
  fs.mkdirSync(path.join(home,'prompts'));fs.writeFileSync(path.join(home,'prompts','First frame.md'),'Fixture only');
  fs.mkdirSync(path.dirname(settingsPath),{recursive:true});
  fs.cpSync(path.join(root,'src'),path.join(sandbox,'src'),{recursive:true,filter:source=>!source.includes('__pycache__')});
  fs.copyFileSync(path.join(root,'package.json'),path.join(sandbox,'package.json'));
  logs(home,A,110,13);logs(home,B,370,83);
  fs.writeFileSync(path.join(home,'config.toml'),'[desktop.appearanceDarkChromeTheme]\naccentSource="custom"\naccent="#39c4f7"\nsurface="#111111"\n');
  // Substitute only the document contract in the copied controller. The native
  // CDP client, window worker and bindings are identical to the shipped files.
  const host=path.join(sandbox,'src/runtime');
  const guard='location.origin==='+JSON.stringify(new URL(fixtureUrl).origin)+'&&location.pathname==="/index.html"';
  fs.writeFileSync(path.join(host,'page-contract.cjs'),'module.exports={isMainPageUrl(value){try{const u=new URL(value);return u.origin==='+
    JSON.stringify(new URL(fixtureUrl).origin)+'&&u.pathname==="/index.html";}catch{return false;}},pageGuard:'+JSON.stringify(guard)+'};');
  const preload=path.join(scratch,'collector-guard.cjs'),launches=path.join(scratch,'unexpected-subprocess');
  fs.writeFileSync(preload,[
    "const fs=require('node:fs'),path=require('node:path');",
    "const children=require('node:child_process'),spawn=children.ChildProcess.prototype.spawn;",
    "children.ChildProcess.prototype.spawn=function(options){",
    "const name=path.basename(options.file).toLowerCase();",
    "const settings=name==='bettercodexnative.exe'&&options.args[1]==='settings-lock';",
    "const prompts=name==='cmd.exe'&&options.args[5]?.startsWith('dir /b /a:-d-h ');",
    "if(settings||prompts)return spawn.call(this,options);",
    "fs.appendFileSync("+JSON.stringify(launches)+",'attempt\\n');throw Error('Unexpected controller subprocess');};",
    "const collectors=require("+JSON.stringify(path.join(host,'collector-session.cjs'))+");",
    "const original=collectors.createCollector;",
    "collectors.createCollector=options=>original({...options,makeSampler:()=>{const sample=collectors.createSampler(options);",
    "return async selection=>{const mark=path.join(options.runtime,'fixture-sampler-failure');",
    "if(fs.existsSync(mark)){fs.unlinkSync(mark);throw Error('Isolated one-window sampler fault');}return sample(selection);};}});"
  ].join('\n'));
  const isolatedEnv={...process.env,XDG_CONFIG_HOME:path.join(scratch,'xdg')};
  // Invalid fixture port preserves the cache-only measurements without reading the real gateway config.
  fs.mkdirSync(path.join(isolatedEnv.XDG_CONFIG_HOME,'magpie'),{recursive:true});
  fs.writeFileSync(path.join(isolatedEnv.XDG_CONFIG_HOME,'magpie/settings.json'),'{"port":0}');
  const startController=stdio=>spawn(dependencies.node,
    ['--no-warnings=ExperimentalWarning','--require',preload,path.join(host,'controller.cjs'),settingsPath,runtime],
    {env:isolatedEnv,windowsHide:true,stdio});
  let context,controller,lock;
  let output='';
  try{
    await checkDiscovery();
    context=await playwright.chromium.launchPersistentContext(path.join(scratch,'browser'),{
      headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      viewport:{width:1261,height:600},args:['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0']});
    const port=Number((await until(()=>{try{return fs.readFileSync(path.join(scratch,'browser/DevToolsActivePort'),'utf8');}catch{return null;}},'isolated CDP port')).split('\n')[0]);
    assert.ok(port>0&&port!==19163,'never connect to the user desktop port');
    await context.route(fixtureUrl+'*',route=>route.fulfill({contentType:'text/html',body:html(A)}));
    let p1=await context.newPage(),p2=await context.newPage();
    await Promise.all([p1.goto(fixtureUrl),p2.goto(fixtureUrl+'?initialRoute=fixture')]);
    await p2.evaluate(id=>{document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id);},B);
    const settings={node:dependencies.node,port,codexHome:home,readingWidth:1232,customAccent:true,sentinel:'保留中文设置'};
    fs.writeFileSync(settingsPath,JSON.stringify(settings));
    const store=createSettingsStore(settingsPath,settings);
    controller=startController(['ignore','pipe','pipe']);
    controller.stdout.on('data',chunk=>{output+=chunk;});controller.stderr.on('data',chunk=>{output+=chunk;});
    const view=()=>read(path.join(runtime,'view-status.json'));
    const track=()=>{for(const entry of view()?.windows||[]){const data=read(path.join(runtime,'windows',entry.windowId,'metrics.json'));if(data?.collector_pid)collectors.add(data.collector_pid);}};
    const matching=async(page,id,speed,cache)=>{const s=await snapshot(page);return s.id===id&&s.speed===speed&&s.cache===cache;};
    await until(async()=>await matching(p1,A,'- tok/s','13%')&&await matching(p2,B,'- tok/s','83%'),'two independent rendered statistics');
    track();check('native-fallback-preserves-distinct-chat-caches-in-one-node-process',
      view().windows.length===2&&collectors.size===1&&collectors.has(controller.pid));
    check('native-fallback-keeps-ttft-missing-in-both-windows',(await snapshot(p1)).ttft==='-s'&&(await snapshot(p2)).ttft==='-s');
    check('route-parameter-window-supported-without-accepting-other-documents',isMainPageUrl('app://-/index.html?initialRoute=fixture')&&!isMainPageUrl('app://-/detached-window.html?initialRoute=fixture')&&!isMainPageUrl('https://example.invalid/index.html'));
    check('all-enhancements-coexist-in-both-pages',(await snapshot(p1)).modules&&(await snapshot(p2)).modules&&(await snapshot(p1)).accentStyle&&(await snapshot(p2)).accentStyle&&(await snapshot(p1)).width===1232&&(await snapshot(p2)).width===1232);
    const replySize=page=>page.locator('#fixture-reply p').evaluate(e=>getComputedStyle(e).fontSize);
    await p1.locator('#metrics').click();
    await Promise.all([p1,p2].map(page=>page.evaluate(()=>{
      const pane=document.createElement('div');
      pane.id='fixture-title-pane';pane.dataset.appShellActivePage='true';
      pane.style.cssText='position:absolute;left:200px;top:0;width:700px;pointer-events:none';
      pane.innerHTML='<header data-app-shell-main-titlebar><div data-app-shell-header-toolbar style="display:flex"><div style="flex:1"><div class="w-fit" style="width:fit-content"><span class="text-conversation-title">Fixture chat</span></div></div><div style="width:100px">Tools</div></div></header><div data-app-shell-main-surface><div class="thread-scroll-container" style="height:20px"></div></div>';
      document.body.append(pane);
    })));
    const titleSwitch=p1.getByRole('switch',{name:'聊天标题居中',exact:true});
    const bothTitles=async centered=>(await Promise.all([p1,p2].map(page=>page.evaluate(centered=>{
      const group=document.querySelector('#fixture-title-pane .w-fit'),pane=document.querySelector('#fixture-title-pane .thread-scroll-container');
      const a=group.getBoundingClientRect(),b=pane.getBoundingClientRect();
      return centered?Math.abs((a.left+a.right-b.left-b.right)/2)<1:Math.abs(a.left-b.left)<1;
    },centered)))).every(Boolean);
    await until(()=>bothTitles(true),'both titles default to centered');
    await titleSwitch.click();
    await until(async()=>read(settingsPath).chatTitleCentered===false&&await bothTitles(false),'titles save and resync as native left alignment');
    await p1.locator('#undo').click();
    await until(async()=>read(settingsPath).chatTitleCentered===true&&await bothTitles(true),'undo re-centers both titles');
    check('chat-title-default-toggle-persistence-undo-and-multi-window-layout',await titleSwitch.isChecked());
    const treeSwitch=p1.getByRole('switch',{name:'工作区文件树',exact:true});
    const bothTreePrefs=async enabled=>(await Promise.all([p1,p2].map(page=>page.evaluate(
      expected=>window.__codexComposerHud.snapshot().preferences.workspaceTreeEnabled===expected,enabled)))).every(Boolean);
    check('workspace-tree-setting-defaults-on',await treeSwitch.isChecked()&&await bothTreePrefs(true));
    await treeSwitch.click();
    await until(async()=>read(settingsPath).workspaceTreeEnabled===false&&await bothTreePrefs(false),'workspace tree setting disabled in both windows');
    await p1.locator('#undo').click();
    await until(async()=>read(settingsPath).workspaceTreeEnabled===true&&await bothTreePrefs(true),'workspace tree setting restored in both windows');
    check('workspace-tree-setting-persists-and-undo-syncs',await treeSwitch.isChecked());
    await Promise.all([p1,p2].map(page=>page.locator('#fixture-title-pane').evaluate(node=>node.remove())));
    const fontInput=p1.locator('#assistant-font-size');
    await fontInput.fill('23');await fontInput.press('Enter');
    await until(async()=>read(settingsPath).assistantFontSize===23&&await replySize(p1)==='23px'&&await replySize(p2)==='23px','font saved and synchronized');
    await fontInput.fill('');await fontInput.press('Enter');
    await until(async()=>read(settingsPath).assistantFontSize===null&&await replySize(p1)==='16px'&&await replySize(p2)==='16px','native font saved and synchronized');
    const [fontField,widthField]=await Promise.all([fontInput,p1.locator('#width-number')].map(input=>input.evaluate(e=>{
      const {x,y,width}=e.parentElement.getBoundingClientRect();return {x,y,width};
    })));
    check('font-row-is-first-and-number-fields-are-equally-wide',fontField.y<widthField.y&&fontField.x===widthField.x&&fontField.width===widthField.width);
    const foldToggle=p1.getByRole('button',{name:'隐藏输入框',exact:true});
    const foldMaster=p1.getByRole('switch',{name:'隐藏输入框',exact:true});
    const foldControl=p1.getByRole('radiogroup',{name:'隐藏样式'});
    check('input-hide-settings-start-collapsed',await foldToggle.getAttribute('aria-expanded')==='false'&&await foldControl.count()===0);
    const bothFold=async(value,style=value)=>read(settingsPath).composerAutoHide===value&&read(settingsPath).composerHideStyle===style&&(await Promise.all([p1,p2].map(page=>page.evaluate(({value,style})=>{
      const prefs=window.__codexComposerHud.snapshot().preferences;
      return window.__codexComposerFold&&prefs.composerAutoHide===value&&prefs.composerHideStyle===style;
    },{value,style})))).every(Boolean);
    await foldMaster.click();
    await until(()=>bothFold('minimize'),'header switch saves and syncs the default minimize style');
    check('input-hide-master-toggles-without-expanding',await foldMaster.isChecked()&&await foldToggle.getAttribute('aria-expanded')==='false');
    await foldToggle.press('Enter');
    const minimize=foldControl.getByRole('radio',{name:'最小化'});
    const hide=foldControl.getByRole('radio',{name:'完全隐藏'});
    await minimize.press('ArrowRight');
    await until(()=>bothFold('hide'),'segmented control saves and syncs hide');
    check('fold-style-has-only-two-keyboard-selectable-choices',await foldControl.getByRole('radio').count()===2&&await foldControl.getByRole('radio',{checked:true}).count()===1&&await hide.isChecked());
    await p1.locator('#undo').click();await until(()=>bothFold('minimize'),'undo restores minimize');
    await p1.locator('#redo').click();await until(()=>bothFold('hide'),'redo restores hide');
    const sendFold=p1.getByRole('switch',{name:'发送后自动隐藏'});
    const bothSendFold=async value=>read(settingsPath).composerHideAfterSend===value&&(await Promise.all([p1,p2].map(page=>page.evaluate(value=>window.__codexComposerHud.snapshot().preferences.composerHideAfterSend===value,value)))).every(Boolean);
    await sendFold.click();await until(()=>bothSendFold(true),'send option saves and syncs');
    await foldMaster.press('Space');await until(()=>bothFold('off','hide'),'master switch preserves the selected style in both windows');
    check('input-hide-sub-options-disable-without-losing-their-values',await minimize.isDisabled()&&await hide.isDisabled()&&await hide.isChecked()&&await sendFold.isDisabled()&&await bothSendFold(true));
    check('fold-preference-saves-and-syncs-with-undo-and-redo',true);
    await foldToggle.click();
    check('input-hide-settings-collapse-without-changing-preferences',await foldToggle.getAttribute('aria-expanded')==='false'&&await foldControl.count()===0&&await bothSendFold(true)&&await bothFold('off','hide'));
    await foldMaster.click();await until(()=>bothFold('hide'),'re-enabling restores the remembered style');
    await foldMaster.click();await until(()=>bothFold('off','hide'),'restore fixture to off');
    check('input-hide-master-restores-last-selected-style',true);
    await p1.locator('#metrics').click();
    check('reply-font-and-native-reset-save-and-sync-across-windows',true);
    async function firstPromptFrame(page,stall=null){
      return page.evaluate(stall=>new Promise(resolve=>{
        const binding=window.__betterCodexRequestPrompts;let request;
        if(stall)window.__betterCodexRequestPrompts=value=>{request=value;};
        const shell=document.createElement('div'),menu=document.createElement('div'),row=document.createElement('button');
        menu.dataset.mentionListScrollArea='';row.dataset.listNavigationItem='true';row.textContent='New';
        row.__reactFiber$fixture={memoizedProps:{children:{props:{item:{id:'new',title:'New'}}}}};
        menu.__reactFiber$fixture={memoizedProps:{autocomplete:{ui:{active:true,trigger:'/'}}}};
        menu.append(row);shell.append(menu);document.body.append(shell);
        const deadline=performance.now()+1200;
        const frame=()=>{
          if(getComputedStyle(shell).visibility==='hidden'&&performance.now()<deadline){requestAnimationFrame(frame);return;}
          const shown=()=>menu.querySelector('[data-bc-prompt-row] button')?.textContent??null;
          const first=shown();let result=first;
          if(stall){
            window.__betterCodexRequestPrompts=binding;
            window.__codexCommandMenu.promptState({requests:[request],entries:[{name:'Late response',body:'Fixture only'}]});
            result=stall==='cold'?Boolean(request)&&first===null&&shown()==='Late response':Boolean(request)&&first===shown()?first:null;
          }
          shell.remove();resolve(result);
        };
        requestAnimationFrame(frame);
      }),stall);
    }
    check('native-prompt-is-present-in-the-first-visible-frame',await firstPromptFrame(p1)==='First frame');
    fs.renameSync(path.join(home,'prompts','First frame.md'),path.join(home,'prompts','Next opening.md'));
    check('next-opening-loads-file-changes-without-a-background-refresh',await firstPromptFrame(p1)==='Next opening');
    check('slow-prompt-uses-the-last-snapshot-and-does-not-patch-the-open-menu',await firstPromptFrame(p1,'warm')==='Next opening');
    check('cold-window-accepts-its-own-prompt-reply-after-the-deadline',await firstPromptFrame(p2,'cold')===true);
    await p2.locator('#composer [contenteditable="true"]').fill('/');
    check('standalone-prompt-loads-through-the-same-on-demand-binding',await p2.locator('[data-bc-standalone-root]:not([hidden]) [data-bc-prompt-row] button').textContent({timeout:1500})==='Next opening');
    await p2.keyboard.press('Escape');
    await store.patch({commandVisible:{side:false,reasoning:true},commandGroupOrder:['project','chat','context','other'],commandItemOrder:{chat:['rename','new','archive']}});
    await until(async()=>Promise.all([p1,p2].map(page=>page.evaluate(()=>{const value=window.__codexComposerHud.snapshot().preferences.commandVisible;return value.side===false&&value.reasoning===true&&value.new===true;}))).then(values=>values.every(Boolean)),'command preferences in both windows');
    check('command-preferences-persist-and-sync-across-windows',read(settingsPath).commandVisible.side===false);
    await until(async()=>Promise.all([p1,p2].map(page=>page.evaluate(()=>{const value=window.__codexComposerHud.snapshot().preferences;return value.commandGroupOrder[0]==='project'&&value.commandItemOrder.chat.join('|')==='rename|ai-rename|new|archive';}))).then(values=>values.every(Boolean)),'command order in both windows');
    check('command-orders-persist-and-sync-across-windows',read(settingsPath).commandGroupOrder[0]==='project'&&read(settingsPath).commandItemOrder.chat[0]==='rename');
    await p1.locator('#metrics').click();
    await p1.locator('#slash-toggle').click();
    await p1.locator('#skill-toggle').click();
    await p1.locator('[data-skill-id="health"]').click();
    await until(async()=>p2.evaluate(()=>window.__codexComposerHud.snapshot().preferences.skillVisible.health===true),'skill preference in second window');
    check('skill-visibility-persists-and-syncs-across-windows',read(settingsPath).skillVisible.health===true&&read(settingsPath).skillVisible.visualize===false);
    await p1.locator('[data-command-drag="section"][data-command-drag-id="skills"]').press('ArrowUp');
    await until(()=>p2.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandSectionOrder[0]==='skills'),'accordion order in second window');
    check('slash-settings-accordion-order-persists-and-syncs',read(settingsPath).commandSectionOrder.join('|')==='skills|commands');
    await p1.locator('#metrics').click();
    await p1.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#command-enabled').click());
    await until(async()=>Promise.all([p1,p2].map(page=>page.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandMenuEnabled===false))).then(values=>values.every(Boolean)),'command master disabled in both windows');
    check('command-master-persists-and-syncs-without-reloading',read(settingsPath).commandMenuEnabled===false&&read(settingsPath).commandVisible.side===false);
    await p2.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#command-enabled').click());
    await until(async()=>Promise.all([p1,p2].map(page=>page.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandMenuEnabled===true))).then(values=>values.every(Boolean)),'command master enabled in both windows');
    check('command-master-reenables-from-other-window',read(settingsPath).commandMenuEnabled===true);

    await store.patch({tableEnabled:false,tableCentered:false,tableSortMode:'ascending'});
    await until(async()=>{const [one,two]=await Promise.all([snapshot(p1),snapshot(p2)]);return one.tableEnabled===false&&two.tableEnabled===false&&one.tableCentered===false&&two.tableCentered===false&&one.tableSortMode==='ascending'&&two.tableSortMode==='ascending';},'table preferences in both windows');
    check('table-preferences-apply-to-both-window-modules',await p1.evaluate(()=>{const settings=window.__codexComposerHud.snapshot().preferences;const reading=window.__codexReadingWidth.update(settings.readingWidth),sorting=window.__codexTableSort.snapshot();return reading.tableEnabled===false&&reading.tableCentered===false&&sorting.enabled===false&&sorting.defaultMode==='ascending';})&&await p2.evaluate(()=>{const settings=window.__codexComposerHud.snapshot().preferences;const reading=window.__codexReadingWidth.update(settings.readingWidth),sorting=window.__codexTableSort.snapshot();return reading.tableEnabled===false&&reading.tableCentered===false&&sorting.enabled===false&&sorting.defaultMode==='ascending';}));
    await store.patch({tableEnabled:true,tableCentered:true,tableSortMode:'smart'});
    await until(async()=>{const [one,two]=await Promise.all([snapshot(p1),snapshot(p2)]);return one.tableEnabled===true&&two.tableEnabled===true&&one.tableCentered===true&&two.tableCentered===true&&one.tableSortMode==='smart'&&two.tableSortMode==='smart';},'restore table preferences');
    check('table-preferences-restore-without-window-reload',await p1.evaluate(()=>window.__codexReadingWidth.update(1152).tableEnabled===true&&window.__codexTableSort.snapshot().enabled===true&&window.__codexTableSort.snapshot().defaultMode==='smart')&&await p2.evaluate(()=>window.__codexReadingWidth.update(1152).tableEnabled===true&&window.__codexTableSort.snapshot().enabled===true&&window.__codexTableSort.snapshot().defaultMode==='smart'));
    await p1.route('https://hud-fixture.invalid/ignored.html',route=>route.fulfill({body:'Ignored'}));
    await p1.goto('https://hud-fixture.invalid/ignored.html');
    await until(()=>view()?.windows.length===1,'leave eligible document');
    check('off-contract-document-stays-unmodified',await p1.evaluate(()=>!window.__codexComposerHud)&&await matching(p2,B,'- tok/s','83%'));
    await p1.goto(fixtureUrl);
    await until(async()=>view()?.windows.length===2&&await matching(p1,A,'- tok/s','13%'),'return to eligible document');
    track();
    const first=view().windows.find(w=>w.id===A),second=view().windows.find(w=>w.id===B);
    check('selection-and-metrics-directories-are-disjoint',first.windowId!==second.windowId&&read(path.join(runtime,'windows',first.windowId,'selection.json')).thread_id===A&&read(path.join(runtime,'windows',second.windowId,'selection.json')).thread_id===B&&!fs.existsSync(path.join(runtime,'metrics.json')));
    for(let i=0;i<4;i++){
      await p1.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),i%2?A:B);
      await until(async()=>await matching(p1,i%2?A:B,'- tok/s',i%2?'13%':'83%'),'chat switch');
      const sample=await snapshot(p2);assert.equal(sample.speed,'- tok/s');assert.equal(sample.cache,'83%');
    }
    check('repeated-chat-switches-do-not-change-the-other-window',true);
    const old=await p1.evaluate(()=>window.__codexComposerHud.snapshot());
    await p1.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),B);
    check('late-old-chat-render-is-rejected',!await p1.evaluate(value=>window.__codexComposerHud.render({...value,speed:'999 tok/s',cache:'99%',age:'old'}),old));
    await p1.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),A);
    await until(async()=>await matching(p1,A,'- tok/s','13%'),'restore A');
    const shells=[path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe'),'C:/Program Files/PowerShell/7/pwsh.exe'];
    for(const shell of shells)for(let i=0;i<2;i++){
      await store.patch({readingWidth:1024,customAccent:true});
      await Promise.all([store.patch({readingWidth:1232}),execute(shell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(sandbox,'src/features/appearance/host/Set-CustomAccent.ps1'),'-Mode','Disable'],{windowsHide:true,timeout:15000})]);
      const saved=read(settingsPath);assert.equal(saved.readingWidth,1232);assert.equal(saved.customAccent,false);assert.equal(saved.sentinel,'保留中文设置');
    }
    check('concurrent-node-and-powershell-5-and-7-writes-preserve-both-preferences',true);
    const numbersPath=path.join(sandbox,'untouched-numbers.json');
    fs.writeFileSync(numbersPath,'{"unrelated":{"id":9007199254740993,"negativeZero":-0}}');
    await createSettingsStore(numbersPath,{}).patch({readingWidth:1232});
    check('settings-patch-preserves-unknown-numeric-values-exactly',
      /"id": 9007199254740993\b/.test(fs.readFileSync(numbersPath,'utf8'))&&Object.is(read(numbersPath).unrelated.negativeZero,-0));
    await execute(shells[0],['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(sandbox,'src/features/reading/host/Set-ReadingWidth.ps1'),'-Mode','Wide'],{windowsHide:true,timeout:15000});
    check('reading-width-script-uses-the-shared-writer',read(settingsPath).readingWidth==='wide'&&read(settingsPath).customAccent===false);
    await store.patch({readingWidth:1232});
    await until(async()=>!(await snapshot(p1)).accentStyle&&!(await snapshot(p2)).accentStyle,'disable accent in both pages');
    check('disable-accent-keeps-other-enhancements-in-both-windows',(await snapshot(p1)).modules&&(await snapshot(p2)).modules);
    lock=spawn(shells[0],['-NoProfile','-NonInteractive','-Command',
      '$held=[IO.File]::Open($env:BC_FIXTURE_FILE,\'Open\',\'Read\',\'Read\'); try { [Console]::WriteLine(\'ready\'); [Console]::Read() | Out-Null } finally { $held.Dispose() }'],
      {env:{...process.env,BC_FIXTURE_FILE:settingsPath},windowsHide:true,stdio:['pipe','pipe','pipe']});
    await new Promise((resolve,reject)=>{lock.stdout.once('data',resolve);lock.once('exit',code=>reject(Error('lock helper exited '+code)));lock.once('error',reject);});
    await sleep(1000);
    check('exclusive-file-lock-does-not-reenable-accent',!(await snapshot(p1)).accentStyle&&!(await snapshot(p2)).accentStyle&&store.read().customAccent===false);
    await assert.rejects(store.patch({readingWidth:1408}));
    check('unreadable-settings-save-fails-without-replacing-the-file',true);
    await new Promise(resolve=>{lock.once('exit',resolve);lock.stdin.end();});lock=null;
    check('preferences-survive-the-lock',read(settingsPath).readingWidth===1232&&read(settingsPath).customAccent===false);
    const valid=fs.readFileSync(settingsPath,'utf8');fs.writeFileSync(settingsPath,'{broken');
    await sleep(700);await assert.rejects(store.patch({readingWidth:1408}));
    check('malformed-settings-keep-disabled-cache-and-are-not-overwritten',fs.readFileSync(settingsPath,'utf8')==='{broken'&&!(await snapshot(p1)).accentStyle&&!(await snapshot(p2)).accentStyle);
    fs.writeFileSync(settingsPath,valid);await store.patch({customAccent:true});
    await until(async()=>(await snapshot(p1)).accentStyle&&(await snapshot(p2)).accentStyle,'recover accent after read errors');
    check('settings-recover-and-reenable-without-controller-restart',controller.exitCode===null);
    const victim=view().windows.find(w=>w.id===A),victimRuntime=path.join(runtime,'windows',victim.windowId),victimData=read(path.join(victimRuntime,'metrics.json'));
    const originalHud=await p1.locator('#codex-composer-hud').elementHandle();
    fs.writeFileSync(path.join(victimRuntime,'fixture-sampler-failure'),'');
    await until(()=>view()?.windows.some(w=>w.id===A&&w.collector?.phase==='backoff'),'single collector backoff');
    await until(async()=>view()?.windows.some(w=>w.id===A&&w.windowId===victim.windowId&&w.collector?.attemptsInMinute===2)&&
      read(path.join(victimRuntime,'metrics.json'))?.updated_at_ms>victimData.updated_at_ms&&
      await matching(p1,A,'- tok/s','13%'),'single collector recovery');
    check('collector-recovery-keeps-the-original-hud-and-width',await originalHud.evaluate(node=>node.isConnected)&&(await snapshot(p1)).width===1232);
    track();check('one-collector-failure-recovers-without-replacing-the-other-window',view().windows.find(w=>w.id===B).windowId===second.windowId&&await matching(p2,B,'- tok/s','83%'));
    await p1.close();await until(()=>view()?.windows.length===1,'close first page');
    check('closing-one-window-preserves-the-other',await matching(p2,B,'- tok/s','83%'));
    p1=await context.newPage();await p1.goto(fixtureUrl);
    await until(async()=>view()?.windows.length===2&&await matching(p1,A,'- tok/s','13%'),'add new window');
    track();check('new-window-attaches-without-controller-restart',controller.exitCode===null);
    await p2.reload();await p2.evaluate(id=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',id),B);
    try{await until(async()=>await matching(p2,B,'- tok/s','83%'),'reload B');}
    catch(error){
      const pageState=await p2.evaluate(()=>({url:location.href,hud:Boolean(window.__codexComposerHud),modules:Object.fromEntries(['__codexComposerHud','__codexReadingWidth','__codexFileChanges','__codexCustomAccent'].map(key=>[key,Boolean(window[key])])),snapshot:window.__codexComposerHud?.snapshot?.(),metrics:[...(document.querySelector('#codex-composer-hud')?.shadowRoot?.querySelectorAll('[data-metric-key]')||[])].map(node=>({key:node.dataset.metricKey,text:node.textContent}))})).catch(value=>({error:String(value)}));
      fs.writeFileSync(path.join(evidence,'reload-debug.json'),JSON.stringify({pageState,snapshot:await snapshot(p2).catch(value=>({error:String(value)})),view:view()},null,2));
      throw error;
    }
    check('page-reload-rebuilds-enhancements-and-keeps-statistics-local',await matching(p1,A,'- tok/s','13%'));
    check('command-choices-survive-page-reload',await p1.evaluate(()=>{const value=window.__codexComposerHud.snapshot().preferences;return value.commandVisible.side===false&&value.commandVisible.reasoning===true&&value.commandGroupOrder[0]==='project'&&value.commandItemOrder.chat[0]==='rename';}));
    await p1.evaluate(()=>{
      document.documentElement.lang='zh-CN';
      window.__codexComposerHud?.remove();
      window.__codexReadingWidth?.remove();
      window.__codexTableSort?.remove();
      window.__codexHudI18n={locale:()=>'zh-CN',t:key=>key};
    });
    await until(async()=>await p1.evaluate(()=>{
      const root=document.querySelector('#codex-composer-hud')?.shadowRoot;
      return root?.querySelector('#table-label')?.textContent==='table'&&
        [...root.querySelectorAll('[data-table-sort-mode]')].map(button=>button.textContent).join('|')==='tableSortSmart|tableSortAscendingDefault|tableSortDescendingDefault';
    }),'stale language pack installed');
    check('stale-language-pack-exposes-raw-table-keys',await p1.evaluate(()=>{
      const root=document.querySelector('#codex-composer-hud')?.shadowRoot;
      return root.querySelector('#table-centered-label').textContent==='tableCentered'&&
        root.querySelector('#table-sort-label').textContent==='tableSort';
    }));
    await p1.evaluate(()=>{
      window.__codexComposerHud?.remove();
      window.__codexReadingWidth?.remove();
      window.__codexTableSort?.remove();
      delete window.__codexHudI18n;
    });
    await until(async()=>await p1.evaluate(()=>{
      const root=document.querySelector('#codex-composer-hud')?.shadowRoot;
      return root?.querySelector('#table-label')?.textContent==='表格优化'&&
        root.querySelector('#table-centered-label')?.textContent==='表格整体居中'&&
        [...root.querySelectorAll('[data-table-sort-mode]')].map(button=>button.textContent).join('|')==='智能|默认升序|默认降序'&&
        typeof window.__codexReadingWidth?.setTablesEnabled==='function'&&
        typeof window.__codexTableSort?.setEnabled==='function';
    }),'coordinated language and table refresh');
    await until(()=>matching(p1,A,'- tok/s','13%'),'metrics restored after interface modules refresh');
    check('language-pack-and-table-modules-refresh-together',controller.exitCode===null);
    fs.writeFileSync(path.join(runtime,'stop'),'');
    await until(()=>controller.exitCode!==null,'controller shutdown');
    const cleaned=await Promise.all([p1,p2].map(page=>page.evaluate(()=>!window.__codexComposerHud&&!window.__codexCustomAccent&&!window.__codexReadingWidth&&!window.__codexTableSort&&!window.__codexFileChanges&&!window.__codexCommandMenu)));
    check('stop-cleans-both-pages',cleaned.every(Boolean)&&controller.exitCode===0);
    check('stop-cleans-own-runtime-directories',fs.readdirSync(path.join(runtime,'windows')).length===0);
    check('all-first-controller-collectors-shared-its-lifetime',collectors.size===1&&collectors.has(controller.pid));
    fs.unlinkSync(path.join(runtime,'stop'));
    // A browser-side disconnect must end the client promptly so the verified
    // supervisor can relaunch it. The browser used here is a disposable fixture.
    const bundles=path.join(sandbox,'src/generated/ui');
    fs.unlinkSync(path.join(bundles,'custom-accent.js'));
    fs.writeFileSync(path.join(bundles,'composer-fold.js'),
      'window.__codexComposerFold={remove(){window.__fixtureFoldRemoved=true;}};throw Error("fixture init failure");');
    controller=startController('ignore');
    await until(async()=>await matching(p1,A,'- tok/s','13%'),'fresh controller after stop');
    check('missing-feature-bundle-does-not-block-other-enhancements',!(await snapshot(p1)).accentStyle);
    check('feature-initialization-error-does-not-block-other-enhancements',await p1.evaluate(()=>
      window.__fixtureFoldRemoved&&!window.__codexComposerFold&&Boolean(window.__codexComposerHud&&window.__codexReadingWidth)));
    await context.close();context=null;
    await until(()=>controller.exitCode!==null,'browser-side disconnect');
    check('browser-disconnect-exits-and-cleans-window-workers',controller.exitCode===0&&fs.readdirSync(path.join(runtime,'windows')).length===0);
    check('zero-collector-subprocess-launch-attempts-through-both-controller-lifetimes',!fs.existsSync(launches));
    fs.writeFileSync(path.join(evidence,'integration.json'),JSON.stringify({scope:'isolated Edge + production controller and collectors; app URL adapter; synthetic logs; no Codex desktop connection',passed:results.length,results},null,2));
    console.log(JSON.stringify({passed:results.length}));
  }catch(error){fs.writeFileSync(path.join(evidence,'failure.json'),JSON.stringify({passed:results,error:String(error),controllerOutput:output},null,2));throw error;}
  finally{
    await finish(lock);
    if(controller&&controller.exitCode===null){fs.writeFileSync(path.join(runtime,'stop'),'');try{await until(()=>controller.exitCode!==null,'cleanup controller',7000);}catch{await finish(controller);}}
    if(context)await context.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
