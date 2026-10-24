// Synthetic composer contract + metadata regressions; not desktop acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {formatMetrics}=require('../../src/interface/statistics/metrics-view.cjs');
const {resolveChat}=require('../../src/interface/statistics/chat-binding.cjs');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||require('node:path').resolve(__dirname,'../../.runtime/token-hud/node/node_modules/playwright'));
const evidence=path.resolve(process.argv[2]),scratch=path.resolve(process.argv[3]);
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const source=fs.readFileSync(path.join(__dirname,'../../src/interface/statistics/composer-strip.js'),'utf8');
const i18nSource=require('../../src/platform/i18n/i18n.js').pageSource('zh-CN');
const readingSource=fs.readFileSync(path.join(__dirname,'../../src/interface/reading/reading-width.js'),'utf8');
const html=`<!doctype html><html lang="zh-CN"><style>
#model[data-state="open"]{color:#777}
:root{--color-text:#eee;--color-text-tertiary:#aaa;--color-surface:#292929;--thread-content-max-width:48rem;font-family:'Segoe UI',sans-serif}body{margin:0;background:#181818;color:var(--color-text)}
aside{position:absolute;width:1px;height:1px}#composer{position:absolute;left:96px;right:61px;top:78px;height:146px;padding:18px;box-sizing:border-box;background:#3f3f3f;border:1px solid #494949;border-radius:32px}
[contenteditable]{height:62px;font-size:20px;outline:none}footer{position:absolute;left:18px;right:12px;bottom:12px;display:flex;justify-content:space-between;height:40px}footer>div{display:flex;align-items:center;gap:16px}button{background:none;border:0;color:inherit;font:18px 'Segoe UI';height:40px;padding:0 4px}#access{color:#ff8c4a}#send{background:#fff;color:#111;border-radius:50%;width:40px}
</style><div class="thread-scroll-container" style="height:40px"><div class="max-w-(--thread-body-max-width)" style="width:100%;max-width:var(--thread-body-max-width);--thread-body-max-width:var(--thread-content-max-width)">Layout fixture</div></div><aside data-app-action-sidebar-thread-active="true" data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-host-id="local" data-app-action-sidebar-thread-id="local:${id}"></aside>
<div id="composer" data-codex-composer-root><div contenteditable="true" role="textbox">输入内容</div><footer><div><button id="add">＋</button><button id="access">♧ 完全访问</button></div><div><button id="model">GPT-6 Astra 高⌄</button><button id="mic">♩</button><button id="send">↑</button></div></footer></div>`;
const results=[];
function check(name,condition){assert.ok(condition,name);results.push({name,passed:true});}
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 const context=await chromium.launchPersistentContext(scratch,{headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1261,height:253}});
 try{
  const page=context.pages()[0];
  const reset=async()=>{await page.evaluate(()=>{window.__codexReadingWidth?.remove();window.__codexComposerHud?.remove();});await page.setContent(html);await page.evaluate(i18nSource);await page.evaluate(source);return page.evaluate(()=>window.__codexComposerHud.snapshot());};
  let snapshot=await reset();check('unique-local-chat-and-composer: '+snapshot.compatibility.reason,snapshot.id===id&&snapshot.visible);
  check('chinese-speed-tooltip-explains-average',await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#metrics span').title.includes('不是模型实时解码速度')));
  await page.evaluate(()=>{document.documentElement.lang='en-US';Object.defineProperty(navigator,'language',{value:'en-US',configurable:true});});
  check('codex-language-overrides-computer',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).locale==='en');
  check('english-speed-tooltip-explains-average',await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#metrics span').title.includes('Not live model decoding speed')));
  await page.evaluate(()=>document.documentElement.removeAttribute('lang'));
  check('missing-codex-language-uses-computer-not-browser',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).locale==='zh-CN');
  await page.evaluate(()=>document.documentElement.lang='zh-CN');
  const nativeBefore=await page.locator('#composer').innerHTML();
  check('render-current-generation',await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'53 tok/s',cache:'98%',age:'31秒前'}),snapshot));
  const text=await page.locator('#codex-composer-hud section').innerText();
  check('only-speed-cache-age',text.includes('53 tok/s')&&text.includes('98%')&&text.includes('31秒前')&&!/模型|速率|缓存|更新|gpt|最近响应|周额度/.test(text));
  const geometry=await page.evaluate(()=>{const c=document.querySelector('#composer').getBoundingClientRect(),h=document.querySelector('#codex-composer-hud').getBoundingClientRect();return {centerError:Math.abs((h.left+h.right-c.left-c.right)/2),inside:h.bottom<=c.bottom&&h.top>=c.top,pointerEvents:getComputedStyle(document.querySelector('#codex-composer-hud')).pointerEvents};});
  check('bottom-center-and-pass-through',geometry.centerError<1&&geometry.inside&&geometry.pointerEvents==='none'&&await page.locator('#metrics').evaluate(e=>getComputedStyle(e).pointerEvents)==='auto');
  check('native-composer-untouched',nativeBefore===await page.locator('#composer').innerHTML());
  check('composer-style-move-follows-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    const root=document.querySelector('#composer');root.style.left='136px';
    requestAnimationFrame(()=>{const c=root.getBoundingClientRect(),h=document.querySelector('#codex-composer-hud').getBoundingClientRect();resolve(Math.abs((h.left+h.right-c.left-c.right)/2)<1);});
  })));
  await page.evaluate(()=>document.querySelector('#composer').style.removeProperty('left'));
  check('ancestor-class-move-follows-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    const root=document.querySelector('#composer'),main=document.createElement('div'),style=document.createElement('style');
    main.id='main-area';main.setAttribute('data-app-shell-focus-area','main');main.style.cssText='position:relative;width:100%;height:253px';
    style.textContent='#main-area.split #composer{left:196px}';document.head.append(style);root.before(main);main.append(root);
    main.classList.add('split');
    requestAnimationFrame(()=>{const c=root.getBoundingClientRect(),h=document.querySelector('#codex-composer-hud').getBoundingClientRect();resolve(Math.abs((h.left+h.right-c.left-c.right)/2)<1);});
  })));
  check('resize-without-dom-mutation-follows-main-area',await page.evaluate(()=>new Promise(resolve=>{
    const main=document.querySelector('#main-area');main.classList.remove('split');
    // CSS animation changes used geometry without emitting per-frame mutations.
    const animation=main.animate([{width:'100%'},{width:'85%'}],{duration:100,fill:'forwards'});
    animation.finished.then(()=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
      const c=document.querySelector('#composer').getBoundingClientRect(),h=document.querySelector('#codex-composer-hud').getBoundingClientRect();
      animation.cancel();resolve(Math.abs((h.left+h.right-c.left-c.right)/2)<1);
    })));
  })));
  await page.evaluate(()=>{const main=document.querySelector('#main-area');main.before(document.querySelector('#composer'));main.remove();});
  check('native-footer-typography-matched',await page.evaluate(()=>{
    const reference=getComputedStyle(document.querySelector('#model'));
    return [...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('span,i')].every(e=>{
      const actual=getComputedStyle(e);return ['fontFamily','fontSize','fontWeight'].every(k=>actual[k]===reference[k])&&actual.opacity==='1';
    });
  }));
  check('default-metrics-muted-gray',await page.locator('#metrics').evaluate(e=>getComputedStyle(e).color)==='rgb(170, 170, 170)');
  await page.evaluate(()=>document.querySelector('#model').setAttribute('data-state','open'));
  await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('model-state-does-not-change-gray',await page.locator('#metrics').evaluate(e=>getComputedStyle(e).color)==='rgb(170, 170, 170)');
  await page.evaluate(()=>document.querySelector('#model').removeAttribute('data-state'));
  await page.evaluate(readingSource);
  await page.evaluate(()=>window.__codexComposerHud.readingState(window.__codexReadingWidth.update('wide')));
  const metrics=page.locator('#metrics'),panel=page.locator('#width-panel'),range=page.locator('#width-range');
  check('width-panel-font-size-follows-metrics',await panel.evaluate(e=>{
    const size=getComputedStyle(e.getRootNode().querySelector('#metrics')).fontSize;
    return [...e.querySelectorAll('label,output')].every(n=>getComputedStyle(n).fontSize===size);
  }));
  await page.locator('#model').evaluate(e=>e.style.fontSize='20px');
  await page.waitForFunction(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot;
    return ['#metrics','label','output'].every(selector=>getComputedStyle(root.querySelector(selector)).fontSize==='20px');
  },null,{polling:50,timeout:1500});
  check('both-rows-follow-native-footer-size-without-manual-refresh',await metrics.evaluate(e=>getComputedStyle(e).fontSize)==='20px');
  await page.locator('#model').evaluate(e=>e.removeAttribute('style'));
  await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('width-panel-initially-hidden',!await panel.isVisible());
  await metrics.click();
  check('hud-click-opens-upward',await panel.isVisible()&&await page.evaluate(()=>{
    const h=document.querySelector('#codex-composer-hud'),p=h.shadowRoot.querySelector('#width-panel').getBoundingClientRect();return p.bottom<h.getBoundingClientRect().top&&p.left>=12&&p.right<=innerWidth-12;
  }));
  const rangeBox=await range.boundingBox();
  await page.mouse.move(rangeBox.x+rangeBox.width/2,rangeBox.y+rangeBox.height/2);await page.mouse.down();await page.mouse.move(rangeBox.x+rangeBox.width*.65,rangeBox.y+rangeBox.height/2,{steps:5});await page.mouse.up();
  check('drag-previews-width',Number(await range.inputValue())!==1152&&await page.evaluate(()=>window.__codexComposerHud.readingRequest()?.value===Number(document.querySelector('#codex-composer-hud').shadowRoot.querySelector('input').value)));
  await range.press('Home');for(let i=0;i<16;i++)await range.press('ArrowRight');
  check('keyboard-adjusts-and-old-settings-cannot-flicker',await range.inputValue()==='1024'&&await page.evaluate(()=>window.__codexReadingWidth.update('wide').width===1024));
  const oldRequest=await page.evaluate(()=>window.__codexComposerHud.readingRequest());await range.press('ArrowRight');
  check('late-save-ack-keeps-newer-choice',await page.evaluate(value=>{window.__codexComposerHud.readingAck(value);return window.__codexComposerHud.readingRequest()?.value===1040;},oldRequest));
  await page.evaluate(()=>{const request=window.__codexComposerHud.readingRequest();window.__codexComposerHud.readingAck(request);window.__codexComposerHud.readingState(window.__codexReadingWidth.update(request.value));});
  check('ack-clears-save-request',await page.evaluate(()=>window.__codexComposerHud.readingRequest()===null));
  await page.evaluate(()=>document.documentElement.lang='en-US');
  check('english-width-labels',await metrics.getAttribute('title')==='Adjust reading width'&&await panel.getAttribute('aria-label')==='Reading width'&&await range.getAttribute('aria-valuetext')==='1040 pixels');
  check('language-change-preserves-panel-and-width',await panel.isVisible()&&await range.inputValue()==='1040');
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('codex-language-used-after-live-switch',snapshot.locale==='en');
  check('late-language-render-rejected',!await page.evaluate(s=>window.__codexComposerHud.render({...s,locale:'zh-CN',speed:'53 tok/s',cache:'98%',age:'刚刚'}),snapshot));
  check('english-metrics-render',await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'53 tok/s',cache:'98%',age:'31s ago'}),snapshot)&&await metrics.isVisible());
  await range.press('Home');
  check('english-default-width',await page.locator('output').innerText()==='Default'&&await range.getAttribute('aria-valuetext')==='Default width');
  await page.evaluate(()=>document.documentElement.lang='fr-FR');
  check('unsupported-page-language-falls-back-to-english',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).locale==='en');
  await page.evaluate(()=>document.documentElement.lang='zh-Hans');
  check('chinese-live-switch',await metrics.getAttribute('title')==='调整正文宽度'&&await page.locator('output').innerText()==='默认'&&await range.getAttribute('aria-valuetext')==='默认宽度');
  check('slider-leaves-native-composer-untouched',nativeBefore===await page.locator('#composer').innerHTML());
  await page.screenshot({path:path.join(evidence,'composer-dark.png')});
  await page.locator('#add').click();check('outside-click-closes-panel',!await panel.isVisible());
  await metrics.click();await range.press('Escape');check('escape-closes-panel',!await panel.isVisible()&&await metrics.evaluate(e=>e===e.getRootNode().activeElement));
  await metrics.click();await metrics.click();check('hud-click-toggles-closed',!await panel.isVisible());
  await page.evaluate(()=>{document.documentElement.style.setProperty('--color-text','#333');document.documentElement.style.setProperty('--color-text-tertiary','#777');document.documentElement.style.setProperty('--color-surface','#fff');document.body.style.background='#fff';document.querySelector('#composer').style.background='#f2f2f2';});
  await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('muted-color-follows-theme',await page.locator('#codex-composer-hud').evaluate(e=>getComputedStyle(e).color)==='rgb(119, 119, 119)');
  await metrics.click();await page.screenshot({path:path.join(evidence,'composer-light.png')});
  await page.evaluate(value=>document.querySelector('aside').setAttribute('data-app-action-sidebar-thread-id','local:'+value),other);
  await page.evaluate(()=>window.__codexComposerHud.snapshot());check('chat-switch-closes-panel',!await panel.isVisible());
  check('late-previous-chat-rejected',!await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'old',cache:'old',age:'old'}),snapshot));
  check('switch-clears-old-metrics',!(await page.locator('#codex-composer-hud section').innerText()).includes('53 tok/s'));
  await reset();
  const temporary='local:client-new-thread:'+other;
  await page.evaluate(raw=>{const row=document.querySelector('aside');row.setAttribute('data-app-action-sidebar-thread-id',raw);row.setAttribute('data-app-action-sidebar-thread-title','Fixture');},temporary);
  check('temporary-unresolved-hidden',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  const request=await page.evaluate(()=>window.__codexComposerHud.bindingRequest());
  const index=JSON.stringify({id,thread_name:'Fixture'});
  check('unique-exact-title-resolves',resolveChat(request,index)===id);
  check('duplicate-title-refused',resolveChat(request,index+'\n'+JSON.stringify({id:other,thread_name:'Fixture'}))===null);
  check('missing-title-refused',resolveChat({...request,title:'Other'},index)===null);
  check('persistent-id-never-title-fallback',resolveChat({...request,raw:'local:'+other},index)===null);
  check('malformed-index-refused',resolveChat(request,index+'\n{')===null);
  check('latest-index-name-wins',resolveChat(request,index+'\n'+JSON.stringify({id,thread_name:'Renamed'}))===null);
  check('repeated-index-entry-not-duplicate',resolveChat(request,index+'\n'+index)===id);
  await page.evaluate(value=>window.__codexComposerHud.bind(value),{...request,id:resolveChat(request,index)});
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('temporary-chat-now-visible',snapshot.id===id&&snapshot.visible);
  await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'53 tok/s',cache:'98%',age:'刚刚'}),snapshot);
  await page.evaluate(()=>document.querySelector('aside').setAttribute('data-app-action-sidebar-thread-title','Renamed'));
  check('rename-invalidates-old-binding',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  check('late-resolution-rejected',!await page.evaluate(value=>window.__codexComposerHud.bind(value),{...request,id}));
  const renamed=await page.evaluate(()=>window.__codexComposerHud.bindingRequest());
  await page.evaluate(value=>window.__codexComposerHud.bind(value),{...renamed,id});
  await page.waitForTimeout(1700);
  check('unrefreshed-binding-expires',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await reset();
  await page.evaluate(value=>{const marker=document.createElement('div');marker.setAttribute('data-above-composer-conversation-id',value);document.querySelector('#composer').append(marker);},id);
  await page.evaluate(()=>document.querySelector('aside').style.display='none');
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('collapsed-project-keeps-composer-binding',snapshot.visible&&snapshot.id===id);
  await page.evaluate(()=>document.querySelector('aside').remove());
  check('unmounted-sidebar-keeps-binding',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).id===id);
  check('direct-composer-id-needs-no-title-resolution',await page.evaluate(()=>window.__codexComposerHud.bindingRequest())===null);
  await page.evaluate(value=>{const old=document.querySelector('#composer').cloneNode(true);old.style.display='none';old.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',value);document.body.append(old);},other);
  check('hidden-chat-composer-ignored',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).id===id);
  await page.evaluate(value=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',value),other);
  check('collapsed-sidebar-chat-switch-follows-id',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).id===other);
  check('collapsed-sidebar-late-metrics-rejected',!await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'old',cache:'old',age:'old'}),snapshot));
  await page.evaluate(()=>document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id','invalid'));
  check('invalid-composer-id-hidden',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(value=>{const marker=document.querySelector('[data-above-composer-conversation-id]');marker.setAttribute('data-above-composer-conversation-id',value);marker.parentElement.append(marker.cloneNode());},id);
  check('duplicate-markers-with-same-id-accepted',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).id===id);
  await page.evaluate(value=>document.querySelectorAll('[data-above-composer-conversation-id]')[1].setAttribute('data-above-composer-conversation-id',value),other);
  check('ambiguous-composer-id-hidden',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await reset();
  await page.evaluate(({id,other})=>{
    const root=document.querySelector('#composer'),main=document.createElement('div'),side=document.createElement('div');
    main.setAttribute('data-app-shell-focus-area','main');side.setAttribute('data-app-shell-focus-area','auxiliary');
    const marker=document.createElement('div');marker.setAttribute('data-above-composer-conversation-id',id);root.append(marker);
    root.before(main);main.append(root);
    const agent=root.cloneNode(true);agent.id='agent-composer';agent.style.cssText='position:absolute;left:0;top:0;width:300px;height:100px';
    agent.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',other);
    side.append(agent);document.body.append(side);
  },{id,other});
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('main-hud-survives-side-agent-composer',snapshot.visible&&snapshot.id===id);
  check('side-agent-metrics-cannot-replace-main',!await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'other',cache:'other',age:'other'}),{...snapshot,id:other}));
  await page.evaluate(()=>document.querySelector('#composer [data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id','invalid'));
  check('invalid-main-never-borrows-side-agent',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(()=>document.querySelector('#composer').remove());
  check('side-agent-alone-does-not-get-main-hud',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await reset();
  await page.evaluate(()=>{
    const root=document.querySelector('#composer'),body=document.createElement('div');body.setAttribute('data-composer-body','');body.style.cssText='position:absolute;inset:18px';
    const editor=root.querySelector('[contenteditable]');editor.setAttribute('data-codex-composer','true');
    body.append(editor,root.querySelector('footer'));root.append(body);
    const question=document.createElement('div');question.contentEditable='true';question.style.cssText='position:absolute;left:10px;top:0;width:120px;height:20px';root.prepend(question);
  });
  check('question-editor-outside-main-body-does-not-hide-hud',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  const beforeQuestion=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  await page.locator('#metrics').click();
  check('question-card-hides-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    const question=document.querySelector('#composer > [contenteditable]');question.id='question-card';
    question.setAttribute('data-codex-composer-request-navigation','true');
    requestAnimationFrame(()=>resolve(document.querySelector('#codex-composer-hud').hidden));
  })));
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('question-card-hides-even-with-multiline-editor',!snapshot.visible&&snapshot.id===null&&snapshot.compatibility.reason==='question-card-hidden');
  check('question-card-closes-width-panel',await page.locator('#width-panel').evaluate(e=>e.hidden));
  check('question-card-rejects-late-statistics',!await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'99 tok/s',cache:'99%',age:'now'}),beforeQuestion));
  await page.evaluate(()=>document.querySelector('#question-card').hidden=true);
  check('hidden-question-card-does-not-suppress-normal-chat',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(()=>{const q=document.querySelector('#question-card');q.hidden=false;q.setAttribute('aria-hidden','true');});
  check('aria-hidden-question-card-ignored',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(()=>{const q=document.querySelector('#question-card');q.removeAttribute('aria-hidden');q.inert=true;});
  check('inactive-question-card-ignored',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(()=>document.querySelector('#question-card').inert=false);
  check('question-card-reactivation-hides',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  check('question-removal-restores-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    document.querySelector('#question-card').remove();
    requestAnimationFrame(()=>resolve(!document.querySelector('#codex-composer-hud').hidden));
  })));
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('question-return-binds-same-chat-with-fresh-generation',snapshot.id===id&&snapshot.generation>beforeQuestion.generation);
  check('question-return-does-not-reuse-old-values',!await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'99 tok/s',cache:'99%',age:'now'}),beforeQuestion));
  check('question-return-accepts-current-statistics',await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'53 tok/s',cache:'98%',age:'now'}),snapshot));
  await page.evaluate(()=>{
    const other=document.createElement('div');other.id='other-question';other.setAttribute('data-codex-composer-request-navigation','true');other.style.cssText='width:100px;height:40px';document.body.append(other);
  });
  check('question-outside-selected-composer-does-not-hide-main-hud',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(()=>document.querySelector('#other-question').remove());
  await page.evaluate(readingSource);
  await page.evaluate(()=>window.__codexReadingWidth.update(1008));
  await page.evaluate(()=>{
    const root=document.querySelector('#composer'),overlay=document.createElement('div');overlay.id='overlay';
    root.before(overlay);overlay.append(root);
  });
  check('floating-overlay-hides-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    document.querySelector('#overlay').setAttribute('data-right-panel-composer-overlay-content','true');
    requestAnimationFrame(()=>resolve(document.querySelector('#codex-composer-hud').hidden));
  })));
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('floating-overlay-hides-multiline-editor',!snapshot.visible&&snapshot.compatibility.reason==='floating-composer-hidden');
  check('floating-overlay-does-not-reset-reading-width',await page.evaluate(()=>{const s=window.__codexReadingWidth.update(1008);return s.applied&&s.maxWidth===1008;}));
  await page.evaluate(()=>document.querySelector('#overlay').setAttribute('data-right-panel-composer-overlay-content','false'));
  check('floating-overlay-attribute-change-restores',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.evaluate(()=>document.querySelector('#overlay').setAttribute('data-right-panel-composer-overlay-content','true'));
  check('floating-overlay-reentry-hides',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  check('leaving-floating-overlay-restores-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    const overlay=document.querySelector('#overlay');overlay.before(document.querySelector('#composer'));overlay.remove();
    requestAnimationFrame(()=>resolve(!document.querySelector('#codex-composer-hud').hidden));
  })));
  check('leaving-floating-overlay-restores-binding',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).id===id);
  await page.evaluate(()=>{
    const footer=document.querySelector('#composer footer'),editor=document.querySelector('[data-codex-composer="true"]');
    footer.setAttribute('data-composer-footer-responsive','');footer.append(editor);editor.style.cssText='position:absolute;left:160px;top:0;width:300px;height:36px';
  });
  await page.setViewportSize({width:1261,height:270});
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('compact-footer-keeps-hud-below-composer',snapshot.visible&&snapshot.compatibility.placement==='below-composer');
  check('compact-hud-does-not-cover-editor',await page.evaluate(()=>{
    const h=document.querySelector('#codex-composer-hud').getBoundingClientRect(),r=document.querySelector('#composer').getBoundingClientRect();
    return h.top>=r.bottom+4&&h.bottom<=innerHeight-4;
  }));
  await page.setViewportSize({width:1261,height:253});
  const smallGap=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('compact-footer-uses-small-safe-bottom-gap: '+smallGap.compatibility.reason,smallGap.visible);
  await page.setViewportSize({width:1261,height:240});
  check('compact-footer-without-safe-space-still-hides',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.setViewportSize({width:1261,height:253});
  await reset();await page.setViewportSize({width:700,height:253});
  check('narrow-composer-hides-before-overlap',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.setViewportSize({width:1261,height:253});await reset();
  await page.evaluate(()=>document.body.append(document.querySelector('#composer').cloneNode(true)));
  check('multiple-composers-refused',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  snapshot=await reset();await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'99 tok/s',cache:'50%',age:'刚刚'}),snapshot);
  await page.waitForTimeout(3300);
  check('lost-controller-clears-values',!(await page.locator('#codex-composer-hud section').innerText()).includes('99'));
  await page.evaluate(()=>window.__codexComposerHud.remove());check('removal-cleans-view',await page.locator('#codex-composer-hud').count()===0);
  const now=1000000,data={binding:'ok',thread_id:id,updated_at_ms:now,source:{state:'ok'},metrics:{model:'fixture',stage:'idle',last:{model:'fixture',rate:52.9,cache_percent:97.5,measured_at_ms:now-31000}}};
  check('metadata-format',JSON.stringify(formatMetrics(data,id,now,'zh-CN'))===JSON.stringify({speed:'53 tok/s',cache:'98%',age:'31秒前'}));
  check('wrong-chat-rejected',formatMetrics(data,other,now).speed==='- tok/s');
  check('stale-heartbeat-rejected',formatMetrics({...data,updated_at_ms:now-6001},id,now,'zh-CN').age==='采集未连接');
  check('expired-sample-rejected',formatMetrics({...data,metrics:{...data.metrics,last:{...data.metrics.last,measured_at_ms:now-900000}}},id,now,'zh-CN').age==='数据已过期');
  check('english-relative-seconds',formatMetrics(data,id,now,'en-US').age==='31s ago');
  for(const [age,text] of [[0,'Just now'],[2000,'2s ago'],[59000,'59s ago'],[60000,'1m ago'],[899000,'14m ago'],[900000,'Stats expired']]){
    check('english-age-boundary-'+age,formatMetrics({...data,metrics:{...data.metrics,last:{...data.metrics.last,measured_at_ms:now-age}}},id,now,'en').age===text);
  }
  check('english-disconnected',formatMetrics({...data,updated_at_ms:now-6001},id,now,'en').age==='Collector offline');
  check('english-empty-and-unsupported-fallback',formatMetrics(null,id,now,'de-DE').age==='Waiting for stats');
  check('new-turn-clears-old-sample',formatMetrics({...data,metrics:{...data.metrics,stage:'generating',turn_started_at_ms:now}},id,now).speed==='- tok/s');
  check('aborted-new-turn-does-not-restore-old-sample',formatMetrics({...data,metrics:{...data.metrics,stage:'idle',turn_started_at_ms:now}},id,now).speed==='- tok/s');
  check('idle-turn-mismatch-does-not-restore-old-sample',formatMetrics({...data,metrics:{...data.metrics,turn_id:'new',last:{...data.metrics.last,turn_id:'old'}}},id,now).speed==='- tok/s');
  fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify({scope:'Synthetic Edge composer, not actual Codex renderer',results},null,2));console.log(JSON.stringify({passed:results.length}));
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
