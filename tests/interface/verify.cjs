// Synthetic composer contract + metadata regressions; not desktop acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {formatMetrics}=require('../../src/interface/statistics/metrics-view.cjs');
const {resolveChat}=require('../../src/interface/statistics/chat-binding.cjs');
const {createPromptReader}=require('../../src/interface/host/prompt-directory.cjs');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||require('node:path').resolve(__dirname,'../../.runtime/token-hud/node/node_modules/playwright'));
const evidence=path.resolve(process.argv[2]),scratch=path.resolve(process.argv[3]);
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
const source=fs.readFileSync(path.join(__dirname,'../../src/interface/statistics/composer-strip.js'),'utf8');
const commandSource=fs.readFileSync(path.join(__dirname,'../../src/interface/appearance/command-menu.js'),'utf8');
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
  const reset=async()=>{await page.evaluate(()=>{window.__codexReadingWidth?.remove();window.__codexComposerHud?.remove();window.__codexCommandMenu?.remove();});await page.setContent(html);await page.evaluate(i18nSource);await page.evaluate(commandSource);await page.evaluate(source);return page.evaluate(()=>window.__codexComposerHud.snapshot());};
  let snapshot=await reset();check('unique-local-chat-and-composer: '+snapshot.compatibility.reason,snapshot.id===id&&snapshot.visible);
  check('chinese-ttft-tooltip-explains-first-content',await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')[0].title.includes('首段内容')));
  check('chinese-speed-tooltip-explains-average',await page.evaluate(()=>{const title=document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')[1].title;return title.includes('magpie')&&title.includes('本轮')&&!title.includes('sent_ms');}));
  check('local-speed-tooltip-updates-without-changing-language',await page.evaluate(()=>{const hud=window.__codexComposerHud;hud.render({...hud.snapshot(),speedMode:'local'});return document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')[1].title.includes('本地兜底');}));
  check('magpie-speed-tooltip-restores-without-changing-language',await page.evaluate(()=>{const hud=window.__codexComposerHud;hud.render({...hud.snapshot(),speedMode:'magpie'});return document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')[1].title.includes('最近一次有效');}));
  await page.evaluate(()=>{document.documentElement.lang='en-US';Object.defineProperty(navigator,'language',{value:'en-US',configurable:true});});
  check('codex-language-overrides-computer',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).locale==='en');
  check('english-speed-tooltip-explains-average',await page.evaluate(()=>{const title=document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')[1].title;return title.includes('magpie')&&title.includes('turn')&&!title.includes('sent_ms');}));
  await page.evaluate(()=>document.documentElement.removeAttribute('lang'));
  check('missing-codex-language-uses-computer-not-browser',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).locale==='zh-CN');
  await page.evaluate(()=>document.documentElement.lang='zh-CN');
  const nativeBefore=await page.locator('#composer').innerHTML();
  check('render-current-generation',await page.evaluate(s=>window.__codexComposerHud.render({...s,ttft:'11.24s',speed:'45 tok/s',cache:'98%',age:'31s'}),snapshot));
  const text=await page.locator('#metrics').innerText();
  check('four-metrics-in-order',await page.evaluate(()=>[...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')].map(e=>e.textContent).join('|'))==='11.24s|45 tok/s|98%|31s');
  check('only-ttft-tps-cache-age',text.includes('45 tok/s')&&text.includes('98%')&&text.includes('31s')&&!/TTFT|TPS|模型|速率|缓存|更新|gpt|最近响应|周额度/.test(text));
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
    return [...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')].every(e=>{
      const actual=getComputedStyle(e);return ['fontFamily','fontSize','fontWeight'].every(k=>actual[k]===reference[k])&&actual.opacity==='1';
    });
  }));
  check('default-metrics-muted-gray',await page.locator('#metrics').evaluate(e=>getComputedStyle(e).color)==='rgb(170, 170, 170)');
  await page.evaluate(()=>document.querySelector('#model').setAttribute('data-state','open'));
  await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('model-state-does-not-change-gray',await page.locator('#metrics').evaluate(e=>getComputedStyle(e).color)==='rgb(170, 170, 170)');
  await page.evaluate(()=>document.querySelector('#model').removeAttribute('data-state'));
  await page.evaluate(readingSource);
  await page.setViewportSize({width:1261,height:900});
  await page.locator('#composer').evaluate(e=>e.style.top='620px');
  await page.evaluate(()=>window.__codexComposerHud.readingState(window.__codexReadingWidth.update('wide')));
  const metrics=page.locator('#metrics'),panel=page.locator('#settings-panel'),range=page.locator('#width-range'),widthNumber=page.locator('#width-number'),metricGroup=page.locator('#metric-group');
  check('settings-panel-initially-hidden',!await panel.isVisible());
  await metrics.click();
  check('settings-panel-opens-upward',await panel.isVisible()&&await page.evaluate(()=>{
    const h=document.querySelector('#codex-composer-hud'),p=h.shadowRoot.querySelector('#settings-panel').getBoundingClientRect();return p.bottom<h.getBoundingClientRect().top&&p.left>=12&&p.right<=innerWidth-12&&p.top>=8;
  }));
  check('shadcn-component-semantics',await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot,panel=root.querySelector('#settings-panel');
    return panel.dataset.slot==='dialog-content'&&root.querySelector('#width-range').dataset.slot==='slider'&&
      [...panel.querySelectorAll('[data-slot="switch"]')].every(e=>e.getAttribute('role')==='switch'&&e.hasAttribute('aria-checked'))&&
      root.querySelector('#metric-group').dataset.slot==='toggle-group'&&
      [...root.querySelectorAll('[data-slot="toggle-group-item"]')].every(e=>e.hasAttribute('aria-pressed'))&&
      root.querySelector('#table-sort-group').dataset.slot==='segmented-control'&&
      [...root.querySelectorAll('[data-slot="segmented-control-item"]')].every(e=>e.getAttribute('role')==='radio'&&e.hasAttribute('aria-checked'));
  }));
  check('table-settings-start-collapsed-with-master-switch',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot;return root.querySelector('#table-toggle').getAttribute('aria-expanded')==='false'&&root.querySelector('#table-options').getAttribute('aria-hidden')==='true'&&root.querySelector('#table-options').inert&&root.querySelector('#table-enabled').getAttribute('role')==='switch'&&root.querySelector('#table-enabled').getAttribute('aria-checked')==='true';}));
  await panel.screenshot({path:path.join(evidence,'table-settings-collapsed.png')});
  await panel.locator('#table-toggle').click();await page.waitForTimeout(220);
  check('table-settings-expand-as-one-accordion',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot,panel=root.querySelector('#settings-panel');return root.querySelector('#table-toggle').getAttribute('aria-expanded')==='true'&&root.querySelector('#table-options').getAttribute('aria-hidden')==='false'&&!root.querySelector('#table-options').inert&&panel.getBoundingClientRect().top>=8;}));
  check('table-child-labels-and-order',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot,buttons=[...root.querySelectorAll('[data-table-sort-mode]')];return root.querySelector('#table-centered-label').textContent==='表格整体居中'&&root.querySelector('#table-sort-label').textContent==='排序'&&buttons.map(e=>e.textContent).join('|')==='智能|默认升序|默认降序'&&buttons.every(e=>e.scrollWidth<=e.clientWidth+1&&getComputedStyle(e).whiteSpace==='nowrap');}));
  check('table-master-row-matches-file-switch-column',await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot;
    const table=root.querySelector('#table-enabled').getBoundingClientRect(),files=root.querySelector('#files-default').getBoundingClientRect(),centered=root.querySelector('#table-centered').getBoundingClientRect();
    const label=root.querySelector('#table-label'),filesLabel=root.querySelector('#files-default-label'),arrow=root.querySelector('#table-toggle .icon').getBoundingClientRect();
    return Math.abs(table.left-files.left)<1&&Math.abs(table.left-centered.left)<1&&Math.abs(arrow.right-table.left)<24&&
      getComputedStyle(label).fontSize===getComputedStyle(filesLabel).fontSize&&getComputedStyle(label).fontWeight===getComputedStyle(filesLabel).fontWeight;
  }));
  await panel.screenshot({path:path.join(evidence,'table-settings-expanded.png')});
  await panel.locator('#table-enabled').click();
  check('table-master-switch-disables-contents-and-all-table-enhancements',await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot,request=window.__codexComposerHud.settingsRequest()?.value,reading=window.__codexReadingWidth.update(1152);
    return request?.tableEnabled===false&&reading.tableEnabled===false&&root.querySelector('#table-enabled').getAttribute('aria-checked')==='false'&&root.querySelector('#table-centered').disabled&&[...root.querySelectorAll('[data-table-sort-mode]')].every(button=>button.disabled);
  }));
  await panel.locator('#table-enabled').click();
  check('table-master-switch-restores-child-controls',await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot,request=window.__codexComposerHud.settingsRequest()?.value,reading=window.__codexReadingWidth.update(1152);
    return request?.tableEnabled===true&&reading.tableEnabled===true&&!root.querySelector('#table-centered').disabled&&[...root.querySelectorAll('[data-table-sort-mode]')].every(button=>!button.disabled);
  }));
  await page.evaluate(()=>{const hud=window.__codexComposerHud,request=hud.settingsRequest();if(request)hud.settingsAck(request);});
  await panel.locator('#table-toggle').click();await page.waitForTimeout(220);
  check('table-settings-collapse-back-to-one-row',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot;return root.querySelector('#table-toggle').getAttribute('aria-expanded')==='false'&&root.querySelector('#table-options').getAttribute('aria-hidden')==='true'&&root.querySelector('#table-options').inert&&root.querySelector('#table-options').getBoundingClientRect().height<1;}));
  await panel.locator('#table-toggle').click();await page.waitForTimeout(220);
  check('settings-panel-has-no-close-control',await panel.locator('button[aria-label*="close" i],button[title*="close" i]').count()===0);
  const panelLayout=await panel.evaluate(e=>{
    const root=e.getRootNode(),slider=e.querySelector('#width-range').getBoundingClientRect(),group=e.querySelector('#metric-group').getBoundingClientRect(),content=e.querySelector('.panel-content').getBoundingClientRect(),title=root.querySelector('#settings-title').getBoundingClientRect(),label=e.querySelector('#width-label').getBoundingClientRect(),section=e.querySelector('#table-label');
    const sizes=[root.querySelector('#settings-title'),section,e.querySelector('.setting-label'),e.querySelector('.range-scale')].map(node=>getComputedStyle(node).fontSize);
    const weights=[root.querySelector('#settings-title'),section,e.querySelector('.setting-label'),e.querySelector('#metric-group [data-metric-key]')].map(node=>Number(getComputedStyle(node).fontWeight));
    return {width:e.getBoundingClientRect().width,slider,group,content,title,label,sizes,weights,border:parseFloat(getComputedStyle(e).borderTopWidth),separator:parseFloat(getComputedStyle(e.querySelector('.separator')).height),groupBorder:parseFloat(getComputedStyle(e.querySelector('#metric-group')).borderTopWidth)};
  });
  check('settings-panel-width-current '+panelLayout.width,Math.abs(panelLayout.width-360)<1);
  check('settings-panel-uses-shared-grid-width',Math.abs(panelLayout.slider.width-panelLayout.group.width)<1&&Math.abs(panelLayout.slider.left-panelLayout.group.left)<1&&Math.abs(panelLayout.title.left-panelLayout.label.left)<1);
  check('settings-panel-uses-active-font-hierarchy '+JSON.stringify(panelLayout.sizes),new Set(panelLayout.sizes).size===3);
  check('settings-panel-reduces-font-weights '+JSON.stringify(panelLayout.weights),panelLayout.weights.every(value=>value<=650)&&panelLayout.weights.filter(value=>value<=600).length>=3);
  check('settings-panel-thickens-dividers '+JSON.stringify({border:panelLayout.border,separator:panelLayout.separator,groupBorder:panelLayout.groupBorder}),panelLayout.border===2&&panelLayout.separator===2&&panelLayout.groupBorder===2);
  check('settings-panel-avoids-muted-small-copy',await panel.evaluate(e=>{
    const save=e.querySelector('#save-state'),style=getComputedStyle(e);
    return e.querySelectorAll('small').length===0&&getComputedStyle(save).color===style.color;
  }));
  check('settings-panel-font-size-follows-metrics',await panel.evaluate(e=>{
    const root=e.getRootNode(),size=getComputedStyle(root.querySelector('#metrics')).fontSize;
    return getComputedStyle(e).fontSize===size;
  }));
  check('toolbar-order-and-initial-saved-state',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot,toolbar=[...root.querySelectorAll('.panel-toolbar > *')].map(e=>e.id);return toolbar.join('|')==='save-state|undo|redo|restore-defaults'&&root.querySelector('#save-state-text').textContent==='已保存'&&Boolean(root.querySelector('#save-state .save-check'))&&getComputedStyle(root.querySelector('#restore-defaults')).color==='rgb(245, 185, 66)';}));
  await panel.locator('#table-centered').click();
  check('table-center-switch-persists-and-updates-layout',await page.evaluate(()=>window.__codexComposerHud.settingsRequest()?.value.tableCentered===false&&window.__codexReadingWidth.update(1152).tableCentered===false));
  await panel.locator('[data-table-sort-mode="ascending"]').click();
  check('table-sort-segmented-choice-is-exclusive',await page.evaluate(()=>{const buttons=[...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('[data-table-sort-mode]')];return window.__codexComposerHud.settingsRequest()?.value.tableSortMode==='ascending'&&buttons.filter(e=>e.getAttribute('aria-checked')==='true').map(e=>e.dataset.tableSortMode).join('')==='ascending';}));
  await panel.locator('[data-table-sort-mode="ascending"]').focus();await page.keyboard.press('ArrowRight');
  check('table-sort-segmented-choice-supports-arrow-keys',await page.evaluate(()=>window.__codexComposerHud.settingsRequest()?.value.tableSortMode==='descending'));
  await panel.locator('#table-centered').click();
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#restore-defaults').click());
  check('four-metric-buttons-use-saved-order',await page.evaluate(()=>[...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metric-group [data-metric-key]')].map(e=>e.dataset.metricKey).join('|'))==='ttft|speed|cache|age');
  check('restore-defaults-is-not-in-bottom-content',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot;return root.querySelector('.panel-content #restore-defaults')===null&&root.querySelector('.panel-content').lastElementChild.classList.contains('stats-section');}));
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metric-group [data-metric-key]')[2].click());
  await page.waitForTimeout(200);
  const metricBackgrounds=await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot,buttons=root.querySelectorAll('#metric-group [data-metric-key]');
    return {on:getComputedStyle(buttons[0]).backgroundColor,off:getComputedStyle(buttons[2]).backgroundColor,states:[...buttons].map(e=>e.dataset.state)};
  });
  check('metric-on-and-off-states-use-different-backgrounds '+JSON.stringify(metricBackgrounds),metricBackgrounds.on!==metricBackgrounds.off);
  const metricGeometry=await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot,group=root.querySelector('#metric-group'),button=group.querySelector('[data-metric-key="ttft"]'),label=root.querySelector('#width-label');return {height:button.getBoundingClientRect().height,fontSize:getComputedStyle(button).fontSize,compactFontSize:getComputedStyle(root.querySelector('.range-scale')).fontSize,labelWidth:label.getBoundingClientRect().width,text:getComputedStyle(button).color,thumb:getComputedStyle(root.querySelector('#files-default .ui-switch-thumb')).backgroundColor,truncated:[...group.querySelectorAll('.metric-label')].some(node=>node.scrollWidth>node.clientWidth+1)};});
  check('metric-group-height-and-body-font-retained',Math.abs(metricGeometry.height-35)<1&&metricGeometry.fontSize>metricGeometry.compactFontSize&&!metricGeometry.truncated);
  check('dark-surface-uses-black-control-details',metricGeometry.text==='rgb(0, 0, 0)'&&metricGeometry.thumb==='rgb(0, 0, 0)');
  await page.evaluate(()=>{document.documentElement.style.setProperty('--color-surface','#f5f5f5');window.__codexComposerHud.settingsState(window.__codexComposerHud.snapshot().preferences);});await page.waitForTimeout(220);
  const lightDetails=await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot,button=root.querySelector('#metric-group [data-state="on"]'),thumb=root.querySelector('#files-default .ui-switch-thumb'),probe=root.querySelector('#surface-probe');return {button:getComputedStyle(button).color,thumb:getComputedStyle(thumb).backgroundColor,probe:getComputedStyle(probe).backgroundColor,host:getComputedStyle(root.host).getPropertyValue('--ui-accent-contrast'),surface:getComputedStyle(root.host).getPropertyValue('--ui-surface')};});check('light-surface-uses-white-control-details '+JSON.stringify(lightDetails),lightDetails.button==='rgb(255, 255, 255)'&&lightDetails.thumb==='rgb(255, 255, 255)');
  await page.evaluate(()=>{document.documentElement.style.setProperty('--color-surface','#292929');window.__codexComposerHud.settingsState(window.__codexComposerHud.snapshot().preferences);});
  check('pending-save-shows-saving-state',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot;return root.querySelector('#save-state-text').textContent==='保存中'&&getComputedStyle(root.querySelector('#save-state .save-spinner')).display!=='none';}));
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metric-group [data-metric-key]')[2].click());
  await page.evaluate(()=>document.documentElement.style.setProperty('--codex-base-accent','#ff5500'));
  await page.evaluate(()=>window.__codexComposerHud.settingsState(window.__codexComposerHud.snapshot().preferences));
  await page.waitForTimeout(200);
  check('accent-sensitive-controls-follow-codex-theme',await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot,active=root.querySelector('#metric-group [data-state="on"]'),toggle=root.querySelector('#files-default'),range=root.querySelector('#width-range');
    return getComputedStyle(active).backgroundColor==='rgb(255, 85, 0)'&&getComputedStyle(toggle).backgroundColor==='rgb(255, 85, 0)'&&getComputedStyle(range).color==='rgb(255, 85, 0)';
  }));
  const rangeBox=await range.boundingBox();
  await page.mouse.move(rangeBox.x+rangeBox.width/2,rangeBox.y+rangeBox.height/2);await page.mouse.down();await page.mouse.move(rangeBox.x+rangeBox.width*.65,rangeBox.y+rangeBox.height/2,{steps:5});await page.mouse.up();
  check('drag-previews-width-and-number',Number(await range.inputValue())!==1152&&await widthNumber.inputValue()===await range.inputValue()&&await page.evaluate(()=>window.__codexComposerHud.settingsRequest()?.value.readingWidth===Number(document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#width-range').value)));
  await range.press('Home');for(let i=0;i<16;i++)await range.press('ArrowRight');
  check('keyboard-adjusts-and-old-settings-cannot-flicker',await range.inputValue()==='1024'&&await page.evaluate(()=>window.__codexReadingWidth.update('wide').width===1024));
  const oldRequest=await page.evaluate(()=>window.__codexComposerHud.settingsRequest());await range.press('ArrowRight');
  check('late-save-ack-keeps-newer-choice',await page.evaluate(value=>{window.__codexComposerHud.settingsAck(value);return window.__codexComposerHud.settingsRequest()?.value.readingWidth===1040;},oldRequest));
  await page.evaluate(()=>{const request=window.__codexComposerHud.settingsRequest();window.__codexComposerHud.settingsAck(request);window.__codexComposerHud.readingState(window.__codexReadingWidth.update(request.value.readingWidth));});
  check('settings-ack-clears-save-request',await page.evaluate(()=>window.__codexComposerHud.settingsRequest()===null&&document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#save-state-text').textContent==='已保存'));
  await metricGroup.locator('[data-metric-key="cache"]').click();
  check('metric-click-hides-current-field',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot,button=root.querySelector('#metric-group [data-metric-key="cache"]');return button.dataset.state==='off'&&button.getAttribute('aria-pressed')==='false'&&![...root.querySelectorAll('#metrics .metric')].some(e=>e.dataset.metricKey==='cache'&&!e.hidden);}));
  await metricGroup.locator('[data-metric-key="ttft"]').click();await metricGroup.locator('[data-metric-key="speed"]').click();await metricGroup.locator('[data-metric-key="age"]').click();
  check('last-visible-metric-cannot-be-disabled',await metricGroup.locator('[data-metric-key="age"]').getAttribute('aria-pressed')==='true');
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#restore-defaults').click());
  check('restore-defaults-resets-width-visibility-and-table',await range.inputValue()==='1152'&&await page.evaluate(()=>{const prefs=window.__codexComposerHud.snapshot().preferences;return Object.values(prefs.metricVisible).every(Boolean)&&prefs.tableEnabled===true&&prefs.tableCentered===true&&prefs.tableSortMode==='smart';}));
  await metricGroup.locator('[data-metric-key="ttft"]').dragTo(metricGroup.locator('[data-metric-key="cache"]'));
  const reordered=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('drag-reorders-metrics-without-toggling',reordered.metricOrder.join('|')==='speed|ttft|cache|age'&&Object.values(reordered.metricVisible).every(Boolean));
  check('drag-order-queues-save',await page.evaluate(()=>JSON.stringify(window.__codexComposerHud.settingsRequest()?.value.metricOrder))===JSON.stringify(['speed','ttft','cache','age']));
  check('drag-order-hot-loads-into-stats-strip',await page.evaluate(()=>[...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics .metric')].filter(e=>!e.hidden).map(e=>e.dataset.metricKey).join('|'))==='speed|ttft|cache|age');
  await page.evaluate(()=>{const hud=window.__codexComposerHud,request=hud.settingsRequest();hud.settingsAck(request);hud.settingsState({...hud.snapshot().preferences,...request.value});});
  check('acknowledged-order-survives-state-reload',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).metricOrder.join('|')==='speed|ttft|cache|age');
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#restore-defaults').click());
  check('default-order-returns-to-stats-strip',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).metricOrder.join('|')==='ttft|speed|cache|age');
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#undo').click());
  check('undo-restores-previous-order',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).metricOrder.join('|')==='speed|ttft|cache|age');
  await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#redo').click());
  check('redo-restores-default-order',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).metricOrder.join('|')==='ttft|speed|cache|age');
  check('file-and-accent-switches-expose-state',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot;return root.querySelector('#files-default').dataset.state==='checked'&&root.querySelector('#accent-toggle').dataset.state==='checked';}));
  await panel.locator('#files-default').click();
  check('file-default-switch-queues-setting',await page.evaluate(()=>window.__codexComposerHud.settingsRequest()?.value.fileChangesDefaultCollapsed===false));
  await panel.locator('#files-default').click();
  await page.evaluate(()=>{const hud=window.__codexComposerHud,request=hud.settingsRequest();if(request)hud.settingsAck(request);document.documentElement.lang='en-US';});
  check('english-settings-labels',await page.evaluate(()=>{const root=document.querySelector('#codex-composer-hud').shadowRoot;return root.querySelector('#settings-title').textContent==='Interface settings'&&root.querySelector('#save-state-text').textContent==='Saved'&&root.querySelector('#restore-defaults').getAttribute('aria-label')==='Restore defaults'&&root.querySelector('#undo').getAttribute('aria-label')==='Undo'&&root.querySelector('#table-label').textContent==='Table'&&[...root.querySelectorAll('[data-table-sort-mode]')].map(e=>e.textContent).join('|')==='Smart|Ascending|Descending'&&[...root.querySelectorAll('#metric-group .metric-label')].map(e=>e.textContent).join('|')==='TTFT|TPS|Cache|Time';}));
  check('english-width-value',await range.getAttribute('aria-valuetext')==='1152 pixels');
  check('language-change-preserves-settings',await panel.isVisible()&&await range.inputValue()==='1152');
  await page.evaluate(()=>document.documentElement.lang='fr-FR');
  check('unsupported-settings-language-falls-back-to-english',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).locale==='en');
  await page.evaluate(()=>document.documentElement.lang='zh-Hans');
  check('chinese-settings-live-switch',await page.evaluate(()=>document.querySelector('#codex-composer-hud').shadowRoot.querySelector('#settings-title').textContent==='界面设置'));
  const nativeAfter=await page.locator('#composer').innerHTML();
  check('settings-leaves-native-composer-untouched',nativeBefore.replaceAll(' style=""','')===nativeAfter.replaceAll(' style=""',''));
  await page.screenshot({path:path.join(evidence,'composer-dark.png')});
  await page.locator('#add').click();check('outside-click-closes-panel',!await panel.isVisible());
  await metrics.click();await range.press('Escape');check('escape-closes-panel',!await panel.isVisible()&&await metrics.evaluate(e=>e===e.getRootNode().activeElement));
  await metrics.click();await metrics.click();check('hud-click-toggles-closed',!await panel.isVisible());
  await page.setViewportSize({width:1261,height:253});
  await page.locator('#composer').evaluate(e=>e.style.removeProperty('top'));
  await page.evaluate(()=>window.__codexComposerHud.snapshot());
  await page.evaluate(()=>{document.documentElement.style.setProperty('--color-text','#333');document.documentElement.style.setProperty('--color-text-tertiary','#777');document.documentElement.style.setProperty('--color-surface','#fff');document.body.style.background='#fff';document.querySelector('#composer').style.background='#f2f2f2';});
  await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('muted-color-follows-theme',await page.locator('#codex-composer-hud').evaluate(e=>getComputedStyle(e).color)==='rgb(119, 119, 119)');
  await metrics.click();await page.screenshot({path:path.join(evidence,'composer-light.png')});
  await page.evaluate(value=>document.querySelector('aside').setAttribute('data-app-action-sidebar-thread-id','local:'+value),other);
  await page.evaluate(()=>window.__codexComposerHud.snapshot());check('chat-switch-closes-panel',!await panel.isVisible());
  check('late-previous-chat-rejected',!await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'old',cache:'old',age:'old'}),snapshot));
  check('switch-clears-old-metrics',!(await page.locator('#metrics').innerText()).includes('53 tok/s'));
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
  await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'53 tok/s',cache:'98%',age:'0s'}),snapshot);
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
  check('question-card-closes-settings-panel',await page.locator('#settings-panel').evaluate(e=>e.hidden));
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
  snapshot=await reset();
  const longFooterBefore=await page.evaluate(()=>{
    const model=document.querySelector('#model');model.textContent='DeepSeek V4.1 Flash 高⌄';
    const root=document.querySelector('#composer').getBoundingClientRect(),h=document.querySelector('#codex-composer-hud').getBoundingClientRect();
    model.style.minWidth=(model.getBoundingClientRect().right-(root.left+root.right)/2-h.width/2-14)+'px';
    return document.querySelector('#composer').innerHTML;
  });
  snapshot=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('long-model-placeholder-fits',snapshot.visible);
  const full={...snapshot,ttft:'123.45s',speed:'1234 tok/s',cache:'100%',age:'14min'};
  check('long-model-full-statistics-stay-visible',await page.evaluate(s=>window.__codexComposerHud.render(s),full));
  check('long-model-statistics-shift-without-overlapping-controls',await page.evaluate(()=>{
    const h=document.querySelector('#codex-composer-hud').getBoundingClientRect(),root=document.querySelector('#composer').getBoundingClientRect();
    return h.right<=(root.left+root.right)/2+h.width/2-1&&[...document.querySelectorAll('#composer button')].every(e=>{
      const r=e.getBoundingClientRect();return r.left>=h.right+12 || r.right<=h.left-12 || r.top>=h.bottom+4 || r.bottom<=h.top-4;
    });
  }));
  const stable=await page.evaluate(async value=>{
    const states=[];
    for(let i=0;i<8;i++){
      window.__codexComposerHud.render(value);const s=window.__codexComposerHud.snapshot();
      states.push({visible:s.visible,generation:s.generation});await new Promise(r=>setTimeout(r,100));
    }
    return states;
  },full);
  check('long-model-polling-never-flashes-or-invalidates-generation',stable.every(s=>s.visible&&s.generation===snapshot.generation));
  check('long-model-native-composer-untouched',longFooterBefore===await page.locator('#composer').innerHTML());
  await page.screenshot({path:path.join(evidence,'composer-long-model.png')});
  const modelWidth=await page.evaluate(()=>{
    const model=document.querySelector('#model'),previous=model.style.minWidth;
    const spans=document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span');
    const primaryWidth=spans[1].getBoundingClientRect().right-spans[0].getBoundingClientRect().left;
    model.style.minWidth=(model.getBoundingClientRect().right-document.querySelector('#access').getBoundingClientRect().right-primaryWidth-44)+'px';
    return previous;
  });
  const cramped=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('both-sides-constrained-keeps-chat-and-primary-statistics',cramped.visible&&cramped.id===id&&cramped.generation===snapshot.generation);
  check('both-sides-constrained-shows-only-ttft-and-tps',await page.locator('#metrics').innerText().then(s=>s.includes('123.45s')&&s.includes('1234 tok/s')&&!s.includes('100%')&&!s.includes('14min')));
  const reducedStable=await page.evaluate(value=>{
    const states=[];
    for(let i=0;i<8;i++){
      window.__codexComposerHud.render(value);const s=window.__codexComposerHud.snapshot();
      const host=document.querySelector('#codex-composer-hud');
      states.push({visible:s.visible,generation:s.generation,compactMetrics:host.shadowRoot.querySelector('#metrics').classList.contains('compact-metrics'),fields:[...host.shadowRoot.querySelectorAll('#metrics span')].map(e=>e.textContent)});
    }
    return states;
  },{...full,speed:'999 tok/s'});
  check('compact-metrics-polling-stays-visible-and-retains-all-fresh-statistics',reducedStable.every(s=>s.visible&&s.generation===snapshot.generation&&s.fields.join('|')==='123.45s|999 tok/s|100%|14min')&&new Set(reducedStable.map(s=>s.compactMetrics)).size===1);
  await page.screenshot({path:path.join(evidence,'composer-primary-only.png')});
  await page.evaluate(value=>document.querySelector('#model').style.minWidth=value,modelWidth);
  const recovered=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('space-restored-shows-all-latest-statistics-without-rebinding',recovered.visible&&recovered.generation===snapshot.generation&&await page.locator('#metrics').innerText().then(s=>s.includes('999 tok/s')&&s.includes('100%')&&s.includes('14min')));
  await page.setViewportSize({width:400,height:253});
  const blocked=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('even-primary-statistics-without-space-hide-without-losing-chat',!blocked.visible&&blocked.id===id&&blocked.generation===snapshot.generation);
  await page.setViewportSize({width:1261,height:253});
  check('hidden-primary-statistics-recover-without-rebinding',(await page.evaluate(()=>window.__codexComposerHud.snapshot())).generation===snapshot.generation);
  snapshot=await reset();
  const optionalValues={...snapshot,ttft:'5.22s',speed:'61 tok/s',cache:'-%',age:'Stats expired'};
  await page.evaluate(value=>window.__codexComposerHud.render(value),optionalValues);
  const optionalSafe=()=>{
    const host=document.querySelector('#codex-composer-hud'),h=host.getBoundingClientRect();
    const r=document.querySelector('#optional-content').getBoundingClientRect();
    return !host.hidden&&(r.left>=h.right+11.9||r.right<=h.left-11.9||r.top>=h.bottom+3.9||r.bottom<=h.top-3.9);
  };
  check('optional-ring-addition-avoided-before-first-frame',await page.evaluate(()=>new Promise(resolve=>{
    const h=document.querySelector('#codex-composer-hud').getBoundingClientRect(),footer=document.querySelector('footer');
    const wrapper=document.createElement('div');wrapper.id='optional-wrapper';wrapper.style.cssText='position:absolute;inset:0;display:block;pointer-events:none';
    wrapper.innerHTML='<span id="optional-content" style="position:absolute;top:12px;width:16px;height:16px"><span role="img" style="display:inline-flex;width:16px;height:16px"><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="none" stroke="gray"/></svg></span></span>';
    wrapper.firstElementChild.style.left=(h.right-footer.getBoundingClientRect().left-5)+'px';footer.append(wrapper);
    requestAnimationFrame(()=>{
      const host=document.querySelector('#codex-composer-hud'),r=wrapper.firstElementChild.getBoundingClientRect();
      resolve(!host.hidden&&host.getBoundingClientRect().right<=r.left-11.9);
    });
  })));
  check('optional-full-width-layout-wrapper-does-not-block-hud',await page.evaluate(optionalSafe));
  check('optional-ring-keeps-four-statistics-and-binding',await page.evaluate(s=>{const hud=window.__codexComposerHud.snapshot();return hud.visible&&hud.generation===s.generation&&[...document.querySelector('#codex-composer-hud').shadowRoot.querySelectorAll('#metrics span')].filter(e=>!e.hidden).length===4;},snapshot));
  await page.locator('#optional-content').evaluate(e=>e.hidden=true);
  check('optional-ring-hidden-restores-center',await page.evaluate(()=>{const h=document.querySelector('#codex-composer-hud').getBoundingClientRect(),c=document.querySelector('#composer').getBoundingClientRect();return Math.abs((h.left+h.right-c.left-c.right)/2)<1;}));
  await page.locator('#optional-content').evaluate(e=>{e.hidden=false;e.removeAttribute('role');e.replaceChildren();e.style.border='2px solid gray';e.style.borderRadius='50%';});
  check('optional-css-ring-without-semantics-avoided',await page.evaluate(optionalSafe));
  await page.locator('#optional-content').evaluate(e=>{e.style.width='auto';e.style.border='0';e.textContent='Quota 75%';});
  check('optional-plain-text-without-button-role-avoided',await page.evaluate(optionalSafe));
  await page.locator('#optional-content').evaluate(e=>{e.style.width='16px';e.replaceChildren();e.innerHTML='<svg width="16" height="16"><circle cx="8" cy="8" r="7"/></svg>';});
  check('optional-bare-svg-avoided',await page.evaluate(optionalSafe));
  await page.locator('#optional-content').evaluate(e=>{const svg=e.firstElementChild;svg.style.display='block';svg.style.width='16px';e.style.width='auto';const animation=svg.animate([{width:'16px'},{width:'120px'}],{duration:100,fill:'forwards'});return animation.finished;});
  await page.waitForTimeout(300);
  check('optional-content-resize-without-dom-mutation-avoided',await page.evaluate(()=>{const host=document.querySelector('#codex-composer-hud'),h=host.getBoundingClientRect(),r=document.querySelector('#optional-content svg').getBoundingClientRect();return !host.hidden&&(r.left>=h.right+11.9||r.right<=h.left-11.9);}));
  await page.locator('#optional-content').evaluate(e=>{e.firstElementChild.getAnimations().forEach(a=>a.cancel());e.firstElementChild.style.width='16px';});
  await page.locator('#optional-content').evaluate(e=>{e.style.left='0';e.style.width='100%';e.style.background='gray';e.replaceChildren();});
  const optionalBlocked=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('optional-content-no-space-hides-without-rebinding',!optionalBlocked.visible&&optionalBlocked.id===snapshot.id&&optionalBlocked.generation===snapshot.generation);
  await page.locator('#optional-wrapper').evaluate(e=>e.remove());
  const optionalRecovered=await page.evaluate(()=>window.__codexComposerHud.snapshot());
  check('optional-content-removal-restores-all-values-without-rebinding',optionalRecovered.visible&&optionalRecovered.generation===snapshot.generation&&await page.locator('#metrics').innerText().then(s=>s.includes('5.22s')&&s.includes('61 tok/s')&&s.includes('Stats expired')));
  await reset();await page.setViewportSize({width:400,height:253});
  check('narrow-composer-hides-before-overlap',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.setViewportSize({width:1261,height:253});await reset();
  await page.evaluate(()=>document.body.append(document.querySelector('#composer').cloneNode(true)));
  check('multiple-composers-refused',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  snapshot=await reset();await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'99 tok/s',cache:'50%',age:'0s'}),snapshot);
  await page.waitForTimeout(3300);
  check('lost-controller-clears-values',!(await page.locator('#metrics').innerText()).includes('99'));
  await page.evaluate(()=>window.__codexComposerHud.remove());check('removal-cleans-view',await page.locator('#codex-composer-hud').count()===0);
  await page.setViewportSize({width:1261,height:1100});await reset();
  await page.evaluate(()=>{document.querySelector('#composer').style.top='850px';window.__codexComposerHud.settingsState({});});
  await page.locator('#metrics').click();
  const commandToggle=page.locator('#command-toggle');
  check('legacy-command-orders-migrate-without-enabling-extra-features',await page.evaluate(()=>{const c=window.__codexCommandMenu.catalog,order=c.normalizeItemOrder({other:['pet','reasoning','model','pin','unknown-new-command']});return order.model.join('|')==='reasoning|model|service-tier:priority'&&order.creative.join('|')==='pet|sketch'&&order.other.join('|')==='unknown-new-command'&&Object.values(c.normalize()).filter(Boolean).length===9;}));
  check('commands-default-collapsed-and-native-switch-style',await commandToggle.getAttribute('aria-expanded')==='false'&&await page.locator('#command-options').evaluate(e=>e.inert));
  check('collapsed-accordions-are-adjacent-without-blank-child-gap',await page.evaluate(()=>{
    const root=document.querySelector('#codex-composer-hud').shadowRoot,table=root.querySelector('.table-group'),commands=root.querySelector('#command-settings'),files=root.querySelector('#files-default-label').closest('.setting-row'),a=table.getBoundingClientRect(),b=commands.getBoundingClientRect(),c=files.getBoundingClientRect();
    return table.nextElementSibling===commands&&Math.abs(a.height-root.querySelector('#table-toggle').getBoundingClientRect().height)<.1&&Math.abs(b.height-root.querySelector('#command-toggle').getBoundingClientRect().height)<.1&&Math.abs(b.top-a.bottom-12)<.1&&Math.abs(c.top-b.bottom-12)<.1;
  }));
  check('command-master-defaults-on',await page.locator('#command-enabled').getAttribute('aria-checked')==='true');
  await page.locator('#command-enabled').click();
  check('command-master-queues-save-without-clearing-choices',await page.evaluate(()=>{const h=window.__codexComposerHud;return h.settingsRequest().value.commandMenuEnabled===false&&Object.values(h.snapshot().preferences.commandVisible).filter(Boolean).length===9;}));
  await page.locator('#undo').click();
  check('command-master-undo-restores-enabled-state',await page.locator('#command-enabled').getAttribute('aria-checked')==='true');
  await page.locator('#redo').click();
  check('command-master-redo-restores-disabled-state',await page.locator('#command-enabled').getAttribute('aria-checked')==='false');
  await page.locator('#command-enabled').click();
  await commandToggle.click();
  const healthChoice=page.locator('[data-skill-id="health"]');
  check('skill-visibility-hides-the-five-presets-by-default',(await page.locator('#skill-buttons [aria-pressed="false"]').allTextContents()).join('|')==='Create Statusline|Excel Live Control|Health|Spreadsheets|Visualize');
  await healthChoice.click();
  check('skill-visibility-switch-queues-preference',await page.evaluate(()=>window.__codexComposerHud.settingsRequest().value.skillVisible.health===true));
  await page.locator('#undo').click();
  check('skill-visibility-undo-restores-preset',await healthChoice.getAttribute('aria-pressed')==='false');
  await page.locator('#redo').click();
  check('skill-visibility-redo-restores-choice',await healthChoice.getAttribute('aria-pressed')==='true');
  await page.locator('#restore-defaults').click();
  check('skill-visibility-reset-restores-preset',await healthChoice.getAttribute('aria-pressed')==='false');
  check('commands-regrouped-without-a-miscellaneous-pile',await page.locator('#command-options .command-heading').allTextContents().then(value=>value.join('|')==='聊天管理|上下文与分流|项目工作|聊天整理|模型与推理|工作模式|工具与连接|创作与伙伴|状态与帮助'));
  check('commands-default-exactly-nine-enabled',await page.locator('#command-options [data-command-id][aria-pressed="true"]').count()===9);
  check('command-settings-use-one-horizontal-button-group-per-category',await page.locator('#command-options .command-buttons').evaluateAll(groups=>groups.every(group=>{const buttons=[...group.children],top=buttons[0].getBoundingClientRect().top;return buttons.every(button=>button.getAttribute('aria-pressed')!==null&&Math.abs(button.getBoundingClientRect().top-top)<.5);})));
  await page.locator('[data-command-id="side"]').click();
  check('commands-switch-queues-persistent-preference',await page.evaluate(()=>window.__codexComposerHud.settingsRequest().value.commandVisible.side===false));
  await page.locator('#undo').click();
  check('commands-switch-undo-restores-choice',await page.locator('[data-command-id="side"]').getAttribute('aria-pressed')==='true');
  await page.locator('#redo').click();
  check('commands-switch-redo-restores-hidden-choice',await page.locator('[data-command-id="side"]').getAttribute('aria-pressed')==='false');
  await page.locator('#restore-defaults').click();
  await commandToggle.click();await commandToggle.click();
  check('commands-collapse-keeps-controls-and-nine-defaults',await page.locator('#command-options [data-command-id][aria-pressed="true"]').count()===9);
  await page.locator('[data-command-id="new"]').press('ArrowRight');
  check('command-settings-left-right-focuses-without-toggling',await page.locator('[data-command-id="rename"]').evaluate(button=>button.getRootNode().activeElement===button)&&await page.locator('#command-options [data-command-id][aria-pressed="true"]').count()===9);
  const commandGrip=(kind,id)=>page.locator('[data-command-drag="'+kind+'"][data-command-drag-id="'+id+'"]');
  await commandGrip('item','new').dragTo(commandGrip('item','archive'));
  check('command-item-drag-saves-order-without-toggling',await page.evaluate(()=>{const hud=window.__codexComposerHud;return hud.settingsRequest().value.commandItemOrder.chat.join('|')==='rename|ai-rename|archive|new'&&Object.values(hud.snapshot().preferences.commandVisible).filter(Boolean).length===9;}));
  await page.locator('#undo').click();
  check('command-order-undo-restores-default',await page.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandItemOrder.chat.join('|')==='new|rename|ai-rename|archive'));
  await page.locator('#redo').click();
  check('command-order-redo-restores-drag',await page.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandItemOrder.chat.join('|')==='rename|ai-rename|archive|new'));
  await commandGrip('item','new').dragTo(commandGrip('item','side'));
  check('command-item-drag-stays-in-own-group',await page.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandItemOrder.chat.join('|')==='rename|ai-rename|archive|new'));
  await commandGrip('group','context').dragTo(commandGrip('group','chat'));
  check('command-group-drag-saves-and-renders-order',await page.evaluate(()=>window.__codexComposerHud.settingsRequest().value.commandGroupOrder.slice(0,3).join('|')==='context|chat|project')&&(await page.locator('#command-options .command-heading').allTextContents())[0]==='上下文与分流');
  await commandGrip('group','context').press('ArrowDown');
  check('command-grips-support-keyboard-reordering',await page.evaluate(()=>window.__codexComposerHud.snapshot().preferences.commandGroupOrder[0]==='chat'));
  await page.locator('#restore-defaults').click();
  await page.evaluate(()=>window.__codexComposerHud.remove());
  await page.evaluate(()=>{
    window.menuSelections=[];window.nativeKeys=[];
    const menu=document.createElement('div');menu.id='native-menu';menu.setAttribute('data-mention-list-scroll-area','');menu.style.cssText='width:400px';
    const controller={ui:{active:true,trigger:'/'},submenuCommand:null,closeAutocomplete(){this.ui.active=false;window.__codexCommandMenu.update({});}};window.menuFixtureController=controller;
    menu.__reactFiber$fixture={memoizedProps:{autocomplete:controller}};
    const section=document.createElement('div');section.dataset.mentionSectionId='commands';const items=document.createElement('div');items.dataset.mentionSectionItems='true';section.append(items);menu.append(section);
    for(const id of ['reasoning','review-mode','archive','new','side','fork','compact','init','rename','unknown-new-command']){
      const row=document.createElement('button');row.dataset.listNavigationItem='true';row.textContent=id;
      row.__reactFiber$fixture={memoizedProps:{children:{props:{item:{id,title:id}}}}};
      row.addEventListener('click',()=>window.menuSelections.push(id));
      row.addEventListener('mousemove',()=>{for(const other of items.children)other.removeAttribute('aria-current');row.setAttribute('aria-current','true');});
      items.append(row);
    }
    window.nativeMenuKeys=e=>window.nativeKeys.push(e.key);window.addEventListener('keydown',window.nativeMenuKeys,true);document.body.append(menu);
  });
  const menuOrder=()=>page.evaluate(()=>[...document.querySelectorAll('#native-menu [data-bc-command]:not([data-bc-command-hidden])')].sort((a,b)=>Number(a.style.getPropertyValue('--bc-command-order'))-Number(b.style.getPropertyValue('--bc-command-order'))).map(row=>row.dataset.bcCommand));
  check('native-commands-keep-eight-in-approved-order',(await menuOrder()).join('|')==='new|rename|archive|side|fork|compact|init|review-mode');
  check('native-command-sources-stay-mounted-but-invisible',await page.locator('#native-menu [data-bc-command-source]').evaluateAll(rows=>rows.every(row=>{const style=getComputedStyle(row);return style.display!=='none'&&style.visibility==='hidden'&&style.pointerEvents==='none'&&row.getBoundingClientRect().width>0;})));
  check('native-command-sources-intersect-viewport-for-icon-rendering',await page.evaluate(()=>new Promise(resolve=>{
    const rows=[...document.querySelectorAll('#native-menu [data-bc-command-source]')].filter(row=>!row.hasAttribute('data-bc-command-hidden')),seen=new Set();
    const timer=setTimeout(()=>{observer.disconnect();resolve(false);},2000);
    const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)seen.add(entry.target);if(seen.size===rows.length){clearTimeout(timer);observer.disconnect();resolve(true);}});
    for(const row of rows)observer.observe(row);
  })));
  const chatButtons=page.locator('#native-menu [data-bc-command-group="chat"] [data-bc-menu-button]');
  const chatGeometry=()=>chatButtons.evaluateAll(buttons=>buttons.map(button=>{
    const rect=button.getBoundingClientRect();
    return [rect.left,rect.width,button.lastElementChild.getBoundingClientRect().left];
  }));
  const beforeIcons=await chatGeometry();
  await chatButtons.evaluateAll(buttons=>{window.fixtureChatButtons=buttons;});
  await page.waitForTimeout(60);
  check('ai-rename-synthetic-command-has-label-and-sparkle',await page.locator('#native-menu [data-bc-menu-button="ai-rename"]').evaluate(button=>
    button.textContent==='AI 重命名'&&button.title==='AI 重命名'&&button.querySelectorAll('svg').length===1&&!button.disabled));
  await page.evaluate(()=>{
    for(const id of ['new','rename','archive']){
      const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');icon.setAttribute('viewBox','0 0 16 16');
      icon.innerHTML='<path d="M2 8h12" stroke="currentColor"/>';
      document.querySelector('#native-menu [data-bc-command="'+id+'"]').prepend(icon);
    }
  });
  check('native-command-icons-loaded-after-first-render-appear',await page.locator('#native-menu [data-bc-command-group="chat"] [data-bc-menu-button] svg').count()===4);
  check('native-delayed-command-icons-do-not-move-buttons-or-labels',JSON.stringify(await chatGeometry())===JSON.stringify(beforeIcons));
  check('native-delayed-command-icons-keep-existing-buttons',await chatButtons.evaluateAll(buttons=>buttons.every((button,index)=>button===window.fixtureChatButtons[index])));
  await page.evaluate(()=>document.querySelector('#native-menu [data-bc-command="rename"] svg').replaceChildren());
  check('native-command-icon-content-refreshes-without-label-change',await page.locator('#native-menu [data-bc-menu-button="rename"] svg path').count()===0);
  check('native-commands-form-three-rows-without-dividers',await page.locator('#native-menu [data-bc-command-break]').count()===0&&await page.locator('#native-menu [data-bc-command-group]').evaluateAll(lines=>lines.map(line=>line.children.length).join('|')==='4|3|2'&&lines.every(line=>[...line.children].every(button=>Math.abs(button.getBoundingClientRect().top-line.firstElementChild.getBoundingClientRect().top)<.5))));
  check('future-command-default-hidden-and-recoverable',await page.evaluate(()=>document.querySelector('[data-bc-command="unknown-new-command"]').hasAttribute('data-bc-command-hidden')&&window.__codexCommandMenu.entries().some(item=>item.id==='unknown-new-command')));
  await page.evaluate(source);
  await page.evaluate(()=>{
    const editor=document.querySelector('#composer [contenteditable="true"]');editor.textContent='/';editor.focus();getSelection().collapse(editor.firstChild,1);
    window.aiRenameRequests=0;window.__codexAiRename={request(){window.aiRenameRequests+=1;return true;}};
  });
  await page.locator('#native-menu [data-bc-menu-button="ai-rename"]').click();
  check('ai-rename-click-requests-once-clears-trigger-and-never-submits-native-command',await page.evaluate(()=>
    window.aiRenameRequests===1&&document.querySelector('#composer [contenteditable="true"]').textContent===''&&!window.menuFixtureController.ui.active&&window.menuSelections.length===0));
  await page.evaluate(()=>{delete window.__codexAiRename;window.menuFixtureController.ui.active=true;window.__codexCommandMenu.update({});});
  await page.evaluate(()=>{const h=window.__codexComposerHud;h.settingsState({...h.snapshot().preferences,commandMenuEnabled:false});});
  check('command-master-off-immediately-restores-open-native-menu',await page.locator('#native-menu [data-bc-command],#native-menu [data-bc-command-grid]').count()===0&&await page.locator('#native-menu [data-list-navigation-item]').evaluateAll(rows=>rows.every(row=>getComputedStyle(row).display!=='none')));
  await page.locator('[contenteditable="true"]').fill('/');await page.keyboard.press('ArrowRight');
  check('command-master-off-releases-native-keyboard',await page.evaluate(()=>window.nativeKeys.includes('ArrowRight')));
  await page.evaluate(()=>{const h=window.__codexComposerHud;h.settingsState({...h.snapshot().preferences,commandMenuEnabled:true});window.nativeKeys=[];});
  check('command-master-on-rebuilds-open-menu-with-saved-choices',(await menuOrder()).join('|')==='new|rename|archive|side|fork|compact|init|review-mode');
  // A page module can be reinstalled independently after desktop updates.
  await page.evaluate(()=>window.__codexCommandMenu.remove());await page.evaluate(commandSource);
  await page.evaluate(()=>{const h=window.__codexComposerHud;h.settingsState({...h.snapshot().preferences,commandVisible:{...h.snapshot().preferences.commandVisible,side:false}});});
  check('reinstalled-command-module-receives-current-settings',!(await menuOrder()).includes('side'));
  await page.evaluate(()=>{const h=window.__codexComposerHud;h.settingsState({...h.snapshot().preferences,commandVisible:{...h.snapshot().preferences.commandVisible,side:true}});});
  await page.evaluate(()=>{window.__codexComposerHud.remove();window.removeEventListener('keydown',window.nativeMenuKeys,true);window.addEventListener('keydown',window.nativeMenuKeys,true);});

  await page.locator('[contenteditable="true"]').fill('/');
  await page.keyboard.press('ArrowRight');await page.keyboard.press('Enter');
  check('native-keyboard-selects-visible-order-and-stops-hidden-handlers',await page.evaluate(()=>window.menuSelections.join('|')==='rename'&&!window.nativeKeys.includes('Enter')&&!window.nativeKeys.includes('ArrowRight')));
  await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');
  check('native-left-right-does-not-move-editor-caret',await page.evaluate(()=>window.getSelection().anchorOffset===1&&document.querySelector('[contenteditable="true"]').textContent==='/'));
  await page.keyboard.press('ArrowDown');
  check('native-down-keeps-column-in-next-group',await page.evaluate(()=>document.querySelector('#native-menu [data-bc-menu-button][data-bc-active]').dataset.bcMenuButton==='fork'));
  await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  check('native-shorter-row-clamps-column',await page.evaluate(()=>document.querySelector('#native-menu [data-bc-menu-button][data-bc-active]').dataset.bcMenuButton==='review-mode'));
  await page.keyboard.press('ArrowUp');
  check('native-longer-row-restores-desired-column',await page.evaluate(()=>document.querySelector('#native-menu [data-bc-menu-button][data-bc-active]').dataset.bcMenuButton==='compact'));
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.evaluate(()=>{for(const row of document.querySelectorAll('#native-menu [aria-current]'))row.removeAttribute('aria-current');document.querySelector('#native-menu [data-bc-command="new"]').setAttribute('aria-current','true');});
  await page.waitForTimeout(30);
  check('late-native-highlight-does-not-reset-keyboard-selection',await page.evaluate(()=>document.querySelector('#native-menu [data-bc-menu-button][data-bc-active]')?.dataset.bcMenuButton==='rename'));
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  check('native-keyboard-end-selects-last-visible',await page.evaluate(()=>window.menuSelections.at(-1)==='review-mode'));
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {groupOrder:['project','chat','context','other'],itemOrder:{chat:['rename','new','archive']}}));
  check('native-order-hot-loads-without-reopening',(await menuOrder()).join('|')==='init|review-mode|rename|new|archive|side|fork|compact');
  const positions=await page.locator('#native-menu [data-bc-menu-button="new"],#native-menu [data-bc-menu-button="rename"]').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().x));
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');
  check('native-navigation-keeps-row-horizontal-positions',JSON.stringify(positions)===JSON.stringify(await page.locator('#native-menu [data-bc-menu-button="new"],#native-menu [data-bc-menu-button="rename"]').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().x))));
  await page.evaluate(()=>window.__codexCommandMenu.update({},{}));
  await page.evaluate(()=>window.__codexCommandMenu.update({side:false,reasoning:true}));
  check('native-switches-apply-without-reopening-menu',!(await menuOrder()).includes('side')&&(await menuOrder()).includes('reasoning'));
  await page.evaluate(()=>window.__codexCommandMenu.update({new:false,archive:false,side:false,fork:false,compact:false,reasoning:false}));
  check('native-row-count-and-buttons-follow-live-choices',await page.locator('#native-menu [data-bc-command-group]').evaluateAll(lines=>{const chat=lines.find(line=>line.dataset.bcCommandGroup==='chat'),project=lines.find(line=>line.dataset.bcCommandGroup==='project');return lines.length===2&&chat.children.length===2&&[...chat.children].map(button=>button.dataset.bcMenuButton).join('|')==='rename|ai-rename'&&project.children.length===2;}));
  await page.evaluate(()=>window.__codexCommandMenu.update({'unknown-new-command':true}));
  check('native-discovered-command-has-dynamic-fallback-group',await page.locator('#native-menu [data-bc-command-group="other"] [data-bc-menu-button]').count()===1);
  await page.evaluate(()=>window.__codexCommandMenu.update(Object.fromEntries(window.__codexCommandMenu.catalog.commands.map(item=>[item.id,false]))));
  await page.keyboard.press('Enter');
  check('native-empty-result-never-submits-a-hidden-command',await page.evaluate(()=>window.menuSelections.length===2));
  check('native-empty-command-groups-leave-no-blank-rows-or-headings',await page.locator('#native-menu [data-bc-command-group],#native-menu [data-bc-menu-heading]').count()===0);
  await page.evaluate(()=>{
    const section=document.createElement('div');section.dataset.mentionSectionId='skills';const items=document.createElement('div');section.append(items);
    for(const name of ['alpha','beta','gamma','delta','epsilon','zeta','eta']){const id='skill:'+name,title=name==='gamma'?'gamma with a very long skill name that should truncate without widening the menu':name;const row=document.createElement('button');row.dataset.listNavigationItem='true';row.textContent=title+' description personal source';row.__reactFiber$fixture={memoizedProps:{children:{props:{item:{id,title}}}}};row.addEventListener('click',()=>window.menuSelections.push(id));items.append(row);}
    document.querySelector('#native-menu').prepend(section);window.__codexCommandMenu.update({'skill:alpha':false});
  });
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {skillVisible:{alpha:false}}));
  check('native-hidden-skill-has-no-button-but-remains-in-settings',await page.locator('[data-bc-menu-button="skill:alpha"]').count()===0&&await page.evaluate(()=>window.__codexCommandMenu.skillEntries().some(item=>item.id==='alpha')));
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {skillVisible:{}}));
  check('native-skills-visible-at-bottom-and-excluded-from-command-settings',(await menuOrder()).slice(-7).join('|')==='skill:alpha|skill:epsilon|skill:zeta|skill:beta|skill:eta|skill:delta|skill:gamma'&&await page.evaluate(()=>!window.__codexCommandMenu.entries().some(item=>item.id.startsWith('skill:'))));
  check('native-skills-use-three-fixed-columns-with-incomplete-last-column',await page.locator('#native-menu [data-bc-skill-row]').evaluateAll(lines=>lines.map(line=>line.children.length).join('|')==='3|2|2'&&lines.every(line=>getComputedStyle(line).gridTemplateColumns.split(' ').length===3)));
  check('native-skills-sort-alphabetically-down-left-filled-columns',await page.locator('#native-menu [data-bc-skill-row]').evaluateAll(lines=>[0,1,2].map(column=>lines.map(line=>line.children[column]?.dataset.bcMenuButton).filter(Boolean).join('|')).join(';')==='skill:alpha|skill:beta|skill:delta;skill:epsilon|skill:eta|skill:gamma;skill:zeta'));
  check('native-skill-buttons-show-only-names-and-full-name-tooltip',await page.locator('#native-menu [data-bc-skill-row] button').evaluateAll(buttons=>buttons.every(button=>button.children.length===1&&button.firstElementChild.tagName==='SPAN'&&button.textContent===button.title&&!button.textContent.includes('personal source'))));
  check('native-skill-long-name-truncates-without-horizontal-overflow',await page.locator('#native-menu [data-bc-menu-button="skill:gamma"]').evaluate(button=>button.firstElementChild.scrollWidth>button.firstElementChild.clientWidth&&getComputedStyle(button.firstElementChild).textOverflow==='ellipsis'&&button.closest('[data-bc-command-group]').scrollWidth<=button.closest('[data-bc-command-group]').clientWidth+1));
  await page.locator('#native-menu').evaluate(menu=>menu.style.width='240px');
  check('native-skill-grid-keeps-three-columns-in-narrow-menu',await page.locator('#native-menu [data-bc-skill-row]').evaluateAll(lines=>lines.every(line=>getComputedStyle(line).gridTemplateColumns.split(' ').length===3&&line.scrollWidth<=line.clientWidth+1&&[...line.children].every(button=>button.getBoundingClientRect().right<=line.getBoundingClientRect().right+1))));
  await page.locator('#native-menu').evaluate(menu=>menu.style.width='400px');
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  check('native-skill-keyboard-down-keeps-column',await page.locator('#native-menu [data-bc-menu-button][data-bc-active]').getAttribute('data-bc-menu-button')==='skill:eta');
  await page.keyboard.press('ArrowUp');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowDown');
  check('native-skill-keyboard-shorter-row-clamps-column',await page.locator('#native-menu [data-bc-menu-button][data-bc-active]').getAttribute('data-bc-menu-button')==='skill:eta');
  await page.keyboard.press('ArrowUp');
  check('native-skill-keyboard-restores-column-after-short-row',await page.locator('#native-menu [data-bc-menu-button][data-bc-active]').getAttribute('data-bc-menu-button')==='skill:zeta');
  await page.locator('#native-menu [data-bc-menu-button="skill:alpha"]').click();
  check('native-skill-click-invokes-original-handler',await page.evaluate(()=>window.menuSelections.at(-1)==='skill:alpha'));
  await page.evaluate(()=>window.__codexCommandMenu.update({}));
  check('native-skill-grid-follows-command-groups',await page.locator('#native-menu [data-bc-command-grid]').evaluate(grid=>{const lines=[...grid.children],first=lines.findIndex(line=>line.hasAttribute('data-bc-skill-row'));return first>0&&lines.slice(first).every(line=>line.hasAttribute('data-bc-skill-row'));}));
  await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  check('native-keyboard-crosses-from-commands-into-skill-grid',await page.locator('#native-menu [data-bc-menu-button][data-bc-active]').getAttribute('data-bc-menu-button')==='skill:alpha');
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {enabled:false}));
  check('native-skill-grid-master-off-restores-original-names-and-descriptions',await page.locator('#native-menu [data-bc-skill-row]').count()===0&&await page.locator('[data-mention-section-id="skills"] button').evaluateAll(rows=>rows.every(row=>getComputedStyle(row).visibility==='visible'&&row.textContent.includes('description personal source'))));
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {enabled:true}));
  await page.keyboard.press('End');await page.keyboard.press('Enter');
  check('native-skill-invocation-keeps-original-handler',await page.evaluate(()=>window.menuSelections.at(-1)==='skill:gamma'));
  check('native-skill-columns-fill-left-first-and-sort-for-one-through-ten-results',await page.evaluate(()=>{
    const root=document.querySelector('#native-menu'),originals=[...root.querySelectorAll('[data-bc-command]')].filter(row=>row.dataset.bcCommand.startsWith('skill:')).map(row=>[row,row.parentElement]);
    for(const [row] of originals)row.remove();
    const section=document.createElement('div');section.dataset.mentionSectionId='skill-count-fixture';root.append(section);
    let valid=true;
    for(let count=1;count<=10;count++){
      section.replaceChildren();
      for(let index=count;index>0;index--){const id='skill:count-'+index,title='Skill '+index,row=document.createElement('button');row.dataset.listNavigationItem='true';row.textContent=title;row.__reactFiber$fixture={memoizedProps:{children:{props:{item:{id,title}}}}};section.append(row);}
      window.__codexCommandMenu.update({});
      const lines=[...root.querySelectorAll('[data-bc-skill-row]')],cols=[0,1,2].map(column=>lines.map(line=>line.children[column]?.title).filter(Boolean)),sizes=cols.map(col=>col.length);
      valid&&=cols.flat().join('|')===Array.from({length:count},(_,index)=>'Skill '+(index+1)).join('|')&&sizes.join('|')===[0,1,2].map(column=>Math.min(Math.ceil(count/3),Math.max(0,count-column*Math.ceil(count/3)))).join('|');
    }
    section.remove();for(const [row,parent] of originals)parent.append(row);window.__codexCommandMenu.update({});return valid;
  }));
  const promptHome=path.join(fs.mkdtempSync(path.join(path.dirname(scratch),'prompt-home-')),'合成 & %TEMP%');
  const promptDir=path.join(promptHome,'prompts'),readPrompts=createPromptReader(promptHome);
  const titleSelector='#native-menu [data-bc-menu-heading]',promptSelector='#native-menu [data-bc-prompt-row]';
  const menuPromptRequests=()=>page.evaluate(()=>window.__codexCommandMenu.promptRequests());
  const sendPrompts=(requests,entries)=>page.evaluate(value=>window.__codexCommandMenu.promptState(value),{requests,entries});
  const openPromptMenu=({draft='/',caret=draft.length,query=''}={})=>page.evaluate(({draft,caret,query})=>{
    const {menuFixtureController:controller,__codexCommandMenu:commands}=window;
    controller.ui.active=false;commands.update({});
    const editor=document.querySelector('#composer [contenteditable="true"]');
    editor.textContent=draft;editor.focus();getSelection().collapse(editor.firstChild,caret);
    controller.ui.active=true;controller.ui.query=query;commands.update({}, {groupOrder:[],itemOrder:{}});
  },{draft,caret,query});
  const standaloneSelector='[data-bc-standalone-root]';
  const openStandalone=async({draft='/',caret=draft.length}={})=>{
    await page.evaluate(({draft,caret})=>{
      const {menuFixtureController:controller,__codexCommandMenu:commands}=window;
      controller.ui.active=false;commands.update({});
      const editor=document.querySelector('#composer [contenteditable="true"]');
      editor.textContent=draft;editor.focus();getSelection().collapse(editor.firstChild||editor,caret);
      editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:draft.slice(caret-1,caret)}));
    },{draft,caret});
    await page.waitForTimeout(150);
  };
  await openPromptMenu();
  const oldRequests=await menuPromptRequests();
  await sendPrompts(oldRequests,await readPrompts());
  check('missing-prompt-directory-leaves-only-existing-skills-heading',(await page.locator(titleSelector).allTextContents()).join('|')==='Skills'&&await page.locator(promptSelector).count()===0);
  fs.mkdirSync(path.join(promptDir,'nested'),{recursive:true});
  const body='# Prompt body\n\n$ARGUMENTS and $1';
  for(const number of [11,5,10,4,1,3,2])fs.writeFileSync(path.join(promptDir,`Prompt ${number}.md`),number===1?'\uFEFF---\r\ndescription: metadata-only\r\n---\r\n'+body:'Template '+number);
  for(const [name,value] of Object.entries({'.hidden.md':'hidden','ignore.txt':'ignored','nested/ignored.md':'nested','blank.md':' \n\t','empty-frontmatter.md':'---\ndescription: only\n---\n','invalid.md':Buffer.from([0xff,0xfe]),'too-big.md':Buffer.alloc(256*1024+1,97)}))fs.writeFileSync(path.join(promptDir,name),value);
  if(process.platform==='win32'){
    const hidden=path.join(promptDir,'Windows hidden.md');fs.writeFileSync(hidden,'hidden attribute');
    require('node:child_process').execFileSync(path.join(process.env.SystemRoot,'System32','attrib.exe'),['+h',hidden],{windowsHide:true});
  }
  await openPromptMenu({draft:'left /right',caret:6});
  const entries=await readPrompts(),promptNames=entries.map(entry=>entry.name).sort();
  check('prompt-reader-uses-only-visible-valid-first-level-markdown',promptNames.join('|')==='Prompt 1|Prompt 10|Prompt 11|Prompt 2|Prompt 3|Prompt 4|Prompt 5');
  check('prompt-reader-strips-frontmatter-and-preserves-markdown-and-placeholders',entries.find(entry=>entry.name==='Prompt 1')?.body===body);
  await sendPrompts(oldRequests,entries);
  check('results-for-closed-menu-do-not-change-new-menu',await page.locator(promptSelector).count()===0);
  await sendPrompts(await menuPromptRequests(),entries);
  check('native-commands-then-skills-and-prompt-headings',await page.locator('#native-menu [data-bc-command-grid]').evaluate(grid=>[...grid.children].map(line=>line.dataset.bcMenuHeading||line.dataset.bcCommandGroup).join('|')==='chat|context|project|skills|skills|skills|skills|prompts|prompts|prompts|prompts')&&(await page.locator(titleSelector).allTextContents()).join('|')==='Skills|Prompt');
  check('skill-and-prompt-headings-are-muted-noninteractive-and-have-two-thin-lines',await page.locator(titleSelector).evaluateAll(titles=>titles.every(title=>{
    const style=getComputedStyle(title),item=getComputedStyle(title.nextElementSibling.firstElementChild);
    return title.tagName==='DIV'&&title.tabIndex===-1&&!title.hasAttribute('tabindex')&&style.cursor==='default'&&parseFloat(style.fontSize)<parseFloat(item.fontSize)&&style.color!==item.color&&['::before','::after'].every(side=>{const rule=getComputedStyle(title,side);return rule.flexGrow==='1'&&rule.borderTopWidth==='1px';});
  })));
  check('prompt-grid-reuses-natural-column-order-and-name-only-buttons',await page.locator(promptSelector).evaluateAll(lines=>{
    const layout=[0,1,2].map(column=>lines.map(line=>line.children[column]?.textContent).filter(Boolean).join('|')).join(';');
    return layout==='Prompt 1|Prompt 2|Prompt 3;Prompt 4|Prompt 5|Prompt 10;Prompt 11'
      &&lines.every(line=>getComputedStyle(line).gridTemplateColumns.split(' ').length===3&&[...line.children].every(button=>button.children.length===1&&button.textContent===button.title));
  }));
  check('prompts-excluded-from-command-settings-catalog',await page.evaluate(()=>!window.__codexCommandMenu.entries().some(item=>item.id.startsWith('prompt:'))));
  const selectedMenuItem=()=>page.locator('#native-menu [data-bc-menu-button][data-bc-active]').getAttribute('data-bc-menu-button');
  await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowRight');
  const forward=[];for(let step=0;step<5;step++){await page.keyboard.press('Control+ArrowDown');forward.push(await selectedMenuItem());}
  check('control-down-jumps-by-logical-group-with-wrap-and-expected-column',forward.join('|')==='compact|review-mode|skill:zeta|prompt:Prompt 11|ai-rename');
  const reverse=[];for(let step=0;step<4;step++){await page.keyboard.press('Control+ArrowUp');reverse.push(await selectedMenuItem());}
  check('control-up-jumps-by-logical-group-and-finds-nearest-column',reverse.join('|')==='prompt:Prompt 11|skill:zeta|review-mode|compact');
  await page.keyboard.press('Home');for(let step=0;step<6;step++)await page.keyboard.press('ArrowDown');
  check('ordinary-down-traverses-every-skill-row-then-enters-prompt',await selectedMenuItem()==='prompt:Prompt 1');
  await page.evaluate(()=>{
    const editor=document.querySelector('#composer [contenteditable="true"]');
    editor.style.whiteSpace='pre-wrap';
    window.promptInputs=[];window.promptSends=0;
    editor.addEventListener('input',event=>window.promptInputs.push([event.isTrusted,event.inputType]));
    editor.addEventListener('keydown',event=>{if(event.key==='Enter')window.promptSends++;});
    document.querySelector('#send').addEventListener('click',()=>window.promptSends++);
  });
  await page.locator('[data-bc-menu-button="prompt:Prompt 1"]').click();
  check('prompt-click-preserves-draft-and-inserts-markdown-at-caret',await page.locator('#composer [contenteditable="true"]').evaluate(editor=>{
    // Chromium uses an empty block with a placeholder BR for a blank line. Read each block once.
    const text=[...editor.childNodes].map(node=>(node.nodeName==='DIV'?'\n':'')+node.textContent).join('').replaceAll('\u00a0',' ');
    return text==='left \n# Prompt body\n\n$ARGUMENTS and $1\nright';
  }));
  check('prompt-click-edits-through-input-keeps-focus-closes-menu-and-never-sends',await page.evaluate(()=>window.promptInputs.length>0&&window.promptInputs.every(event=>event.join('|')==='true|insertText')&&window.promptSends===0&&document.activeElement.matches('#composer [contenteditable="true"]')&&getSelection().isCollapsed&&document.querySelector('#native-menu [data-bc-command-grid]')===null&&!window.menuFixtureController.ui.active));
  fs.writeFileSync(path.join(promptDir,'Prompt 2.md'),'Updated body with $1');
  fs.unlinkSync(path.join(promptDir,'Prompt 1.md'));
  fs.writeFileSync(path.join(promptDir,'Latest.MD'),'Fresh');
  await openPromptMenu({draft:'/pr',query:'pr'});
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  check('prompt-files-added-removed-and-edited-take-effect-on-reopen',await page.locator('[data-bc-menu-button="prompt:Latest"]').count()===1&&await page.locator('[data-bc-menu-button="prompt:Prompt 1"]').count()===0);
  await page.keyboard.press('Home');await page.keyboard.press('Control+ArrowUp');await page.keyboard.press('ArrowUp');
  check('keyboard-can-select-updated-prompt-by-row',await selectedMenuItem()==='prompt:Prompt 2');
  await page.keyboard.press('Enter');
  check('prompt-enter-inserts-updated-text-without-sending',await page.evaluate(()=>document.activeElement.innerText==='Updated body with $1'&&window.promptSends===0&&!window.menuFixtureController.ui.active));
  await openStandalone();
  check('standalone-prompt-menu-requests-when-new-conversation-has-no-native-menu',await page.evaluate(()=>window.__codexCommandMenu.promptRequests().length===1)&&await page.locator(`${standaloneSelector}:not([hidden])`).count()===0);
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  check('standalone-prompt-menu-opens-without-native-menu',await page.locator(`${standaloneSelector}:not([hidden]) [data-bc-prompt-row]`).count()>0&&await page.locator('#native-menu [data-bc-command-grid]').count()===0);
  check('standalone-prompt-menu-uses-three-column-name-buttons',await page.locator(`${standaloneSelector} [data-bc-prompt-row]`).evaluateAll(lines=>lines.length>0&&lines.every(line=>getComputedStyle(line).gridTemplateColumns.split(' ').length===3&&[...line.children].every(button=>button.children.length===1&&button.textContent===button.title))));
  await openStandalone({draft:'/lat'});
  check('standalone-prompt-query-filters-by-name',await page.locator(`${standaloneSelector} [data-bc-menu-button]`).evaluateAll(buttons=>buttons.length===1&&buttons[0].dataset.bcMenuButton==='prompt:Latest'));
  await page.locator(`${standaloneSelector} [data-bc-menu-button="prompt:Latest"]`).click();
  check('standalone-prompt-click-inserts-and-closes-without-sending',await page.evaluate(()=>document.activeElement.innerText==='Fresh'&&window.promptSends===0&&!document.querySelector('[data-bc-standalone-root]:not([hidden])')));
  await openStandalone();
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  const standaloneSelected=await page.locator(`${standaloneSelector} [data-bc-menu-button][data-bc-active]`).getAttribute('data-bc-menu-button');
  const standaloneBody=(await readPrompts()).find(entry=>'prompt:'+entry.name===standaloneSelected)?.body;
  await page.keyboard.press('Enter');
  check('standalone-prompt-keyboard-inserts-selected-text',await page.evaluate(value=>document.activeElement.innerText===value&&window.promptSends===0&&!document.querySelector('[data-bc-standalone-root]:not([hidden])'),standaloneBody));
  await openStandalone();
  await openPromptMenu();
  await page.waitForTimeout(30);
  check('native-menu-closes-standalone-prompt-menu',await page.locator(`${standaloneSelector}:not([hidden]),#native-menu [data-bc-command-grid]`).evaluateAll(nodes=>nodes.length===1&&nodes[0].hasAttribute('data-bc-command-grid')));
  await openPromptMenu();
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {enabled:false}));
  check('prompt-master-off-removes-both-headings-and-restores-native-menu',await page.locator(`${titleSelector},${promptSelector},#native-menu [data-bc-command-grid],#native-menu [data-bc-command],${standaloneSelector}:not([hidden])`).count()===0&&await page.locator('#native-menu [data-list-navigation-item]').evaluateAll(rows=>rows.every(row=>getComputedStyle(row).display!=='none'&&getComputedStyle(row).visibility==='visible')));
  await page.keyboard.press('Control+ArrowDown');
  check('prompt-master-off-releases-logical-group-navigation',await page.evaluate(()=>window.nativeKeys.at(-1)==='ArrowDown'&&window.__codexCommandMenu.promptRequests().length===0));
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {enabled:true}));
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  await page.evaluate(()=>{
    const unknown=document.createElement('div');unknown.id='unknown-native-row';unknown.dataset.listNavigationItem='true';document.querySelector('#native-menu').append(unknown);
  });
  check('unrecognized-native-structure-restores-entire-enhancement-including-prompts',await page.locator('#native-menu [data-bc-command-grid],#native-menu [data-bc-command]').count()===0);
  await page.evaluate(()=>document.querySelector('#unknown-native-row').remove());
  await page.evaluate(()=>{window.filteredRows=[];for(const row of document.querySelectorAll('#native-menu [data-bc-command]'))if(row.dataset.bcCommand!=='skill:alpha'){window.filteredRows.push([row,row.parentElement]);row.remove();}window.__codexCommandMenu.update({});});
  check('native-filtered-skill-result-remains-available',(await menuOrder()).join('|')==='skill:alpha');
  check('native-filtered-skill-result-keeps-three-column-layout',await page.locator('#native-menu [data-bc-skill-row]').evaluateAll(lines=>lines.length===1&&lines[0].children.length===1&&getComputedStyle(lines[0]).gridTemplateColumns.split(' ').length===3));
  await page.evaluate(()=>{for(const [row,parent] of window.filteredRows)parent.append(row);delete window.filteredRows;});
  await page.evaluate(()=>{window.menuFixtureController.submenuCommand={id:'model'};window.__codexCommandMenu.update({});});
  check('native-submenus-are-restored-and-unmodified',await page.locator('#native-menu [data-bc-command]').count()===0);
  await page.keyboard.press('ArrowDown');
  check('native-submenu-keyboard-is-not-intercepted',await page.evaluate(()=>window.nativeKeys.includes('ArrowDown')));
  await page.evaluate(()=>{window.menuFixtureController.submenuCommand=null;window.menuFixtureController.ui.trigger='@';window.__codexCommandMenu.update({});});
  check('native-mentions-are-not-filtered',await page.locator('#native-menu [data-bc-command]').count()===0);
  // The current composer keeps local skills in its scoped "$" provider/cache, not its "/" rows.
  await page.evaluate(()=>{
    document.querySelector('#native-menu [data-mention-section-id="skills"]').remove();
    const composer=document.querySelector('#composer'),editor=composer.querySelector('[contenteditable="true"]');
    const skill=(name,overrides={})=>({name,path:`C:\\fixture\\skills\\${name}\\SKILL.md`,enabled:true,description:'fixture',...overrides});
    const skills=[skill('skill-10'),skill('skill-4'),skill('skill-2'),skill('skill-3'),skill('skill-1'),skill('disabled',{enabled:false}),skill('private',{isPublic:false})];
    const scope={hostId:'local',roots:['C:\\fixture'],autocomplete:{addMention(){}},draftSkillSettings:null};
    const cache=new Map([[JSON.stringify(['skills','local',scope.roots]),{data:[{skills},{skills:[skills[0]]}]}],
      [JSON.stringify(['skills','local',['C:\\unrelated']]),{data:[{skills:[skill('unrelated')]}]}]]);
    const view={dom:editor,editable:true,get state(){
      const selection=getSelection(),text=editor.textContent;
      return {selection:{empty:selection.isCollapsed,to:selection.focusOffset+1},doc:{textBetween:(from,to)=>text.slice(from-1,to-1),resolve:from=>({parentOffset:from-1})}};
    }};
    const composerController={view,insertMention(mention,{range:{from,to}}){
      const text=editor.textContent,chip=document.createElement('span');chip.dataset.fixtureSkill=mention.name;chip.contentEditable='false';chip.textContent=mention.displayName;
      window.skillInsertions.push({mention,from,to});editor.replaceChildren(text.slice(0,from-1),chip,text.slice(to-1));
      getSelection().collapse(editor,2);window.menuFixtureController.ui.active=false;
    }};
    composer.__reactFiber$fixture={child:{memoizedProps:{composerController},sibling:{memoizedProps:{skillSuggestions:scope}}},
      return:{memoizedProps:{value:{queryClient:{getQueryData:key=>cache.get(JSON.stringify(key))}}}}};
    window.skillInsertions=[];window.skillCacheFixture={scope,cache,skills};window.menuFixtureController.ui.trigger='/';
  });
  const skillSelector='#native-menu [data-bc-skill-row]';
  await page.evaluate(()=>{
    const {skills}=window.skillCacheFixture;
    for(const [name,displayName] of [['health:health','Health'],['spreadsheets:excel-live-control','Excel Live Control'],['spreadsheets:spreadsheets','Spreadsheets'],['visualize:visualize','Visualize'],['create-statusline','Create Statusline']])skills.push({name,enabled:true,path:'fixture:'+name,interface:{displayName}});
  });
  await openPromptMenu();
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  check('cached-native-skills-show-under-commands-with-prompt-and-path-ids',await page.locator(skillSelector).evaluateAll(lines=>{
    const columns=[0,1,2].map(column=>lines.map(line=>line.children[column]?.title).filter(Boolean).join('|'));
    return columns.join(';')==='Skill 1|Skill 2;Skill 3|Skill 4;Skill 10'&&lines.every(line=>getComputedStyle(line).gridTemplateColumns.split(' ').length===3&&[...line.children].every(button=>/^skill:C:\\fixture\\skills\\[^\\]+\\SKILL\.md$/.test(button.dataset.bcMenuButton)));
  })&&(await page.locator(titleSelector).allTextContents()).join('|')==='Skills|Prompt'&&await page.evaluate(()=>!window.__codexCommandMenu.entries().some(item=>item.id.startsWith('skill:'))));
  await page.keyboard.press('Home');await page.keyboard.press('Control+ArrowUp');
  const jumpToPrompt=(await selectedMenuItem()).startsWith('prompt:');
  await page.keyboard.press('Control+ArrowUp');
  const jumpToSkills=(await selectedMenuItem()).endsWith('skill-2\\SKILL.md');
  await page.keyboard.press('Control+ArrowDown');
  check('cached-native-skills-retain-two-way-control-group-navigation',jumpToPrompt&&jumpToSkills&&(await selectedMenuItem()).startsWith('prompt:'));
  await page.evaluate(()=>{
    const root=document.querySelector('#native-menu'),commands=root.querySelector('[data-mention-section-items]');
    window.skillCacheFixture.nativeRows=[...commands.children];commands.replaceChildren();
    const empty=document.createElement('div'),search=document.createElement('div');
    empty.id='fixture-native-no-results';search.id='fixture-native-search';empty.className=search.className='px-row-x py-row-y text-sm text-tertiary';
    empty.textContent='No commands';search.append(document.createElement('input'));root.append(empty,search);
  });
  await openPromptMenu({draft:'left /10 right',caret:8,query:'10'});
  check('cached-native-skills-filter-by-name-when-native-slash-results-are-empty',await page.locator(`${skillSelector} button`).allTextContents().then(names=>names.join('|')==='Skill 10'));
  check('cached-skills-hide-only-native-empty-message-not-search-or-section',await page.evaluate(()=>{
    const root=document.querySelector('#native-menu'),style=id=>getComputedStyle(document.querySelector(id)).display;
    return root.hasAttribute('data-bc-command-empty')&&style('#fixture-native-no-results')==='none'&&style('#fixture-native-search')!=='none'&&!root.querySelector('[data-mention-section-id]').hasAttribute('data-bc-section-hidden');
  }));
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {enabled:false}));
  check('cached-skills-master-off-fully-restores-native-empty-state',await page.locator(`${skillSelector},#native-menu[data-bc-command-empty],#native-menu [data-bc-command-grid]`).count()===0&&await page.locator('#fixture-native-no-results').isVisible());
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {enabled:true}));
  await page.locator(`${skillSelector} button`).click();
  check('cached-native-skill-uses-original-mention-engine-and-replaces-just-trigger',await page.evaluate(()=>{
    const editor=document.querySelector('#composer [contenteditable="true"]'),entry=window.skillInsertions.at(-1);
    return editor.textContent==='left Skill 10 right'&&editor.querySelector('[data-fixture-skill="skill-10"]')?.contentEditable==='false'&&entry.mention.kind==='skill'&&entry.mention.path.endsWith('skill-10\\SKILL.md')&&entry.from===6&&entry.to===9&&window.promptSends===0&&!window.menuFixtureController.ui.active;
  }));
  await page.evaluate(()=>{
    document.querySelector('#native-menu [data-mention-section-items]').append(...window.skillCacheFixture.nativeRows);
    document.querySelector('#fixture-native-no-results').remove();document.querySelector('#fixture-native-search').remove();
    document.querySelector('#composer').setAttribute('data-composer-placement','home');
    window.skillCacheFixture.scope.draftSkillSettings={project:{},model:'fixture'};
  });
  await openStandalone();
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  check('standalone-combines-native-skills-and-prompt-when-scoped-cache-is-available',await page.locator(`${standaloneSelector}:not([hidden]) [data-bc-menu-heading]`).allTextContents().then(headings=>headings.join('|')==='Skills|Prompt'));
  await page.keyboard.press('Home');await page.keyboard.press('Control+ArrowDown');
  const standaloneLogicalItem=()=>page.locator(`${standaloneSelector} [data-bc-menu-button][data-bc-active]`).getAttribute('data-bc-menu-button');
  const standaloneJumpedToPrompt=(await standaloneLogicalItem()).startsWith('prompt:');
  await page.keyboard.press('Control+ArrowUp');
  check('standalone-cached-skills-and-prompt-retain-two-way-control-group-navigation',standaloneJumpedToPrompt&&(await standaloneLogicalItem()).endsWith('skill-2\\SKILL.md'));
  await openStandalone({draft:'/2'});
  check('standalone-cached-skills-filter-by-name',await page.locator(`${standaloneSelector}:not([hidden]) [data-bc-skill-row] button`).allTextContents().then(names=>names.join('|')==='Skill 2'));
  await page.keyboard.press('Enter');
  check('standalone-cached-skill-keyboard-inserts-a-mention-without-sending',await page.locator(`${standaloneSelector}:not([hidden])`).count()===0&&await page.evaluate(()=>document.activeElement.querySelector('[data-fixture-skill="skill-2"]')&&window.skillInsertions.length===2&&window.promptSends===0));
  await openStandalone({draft:'/10'});
  await page.locator(`${standaloneSelector}:not([hidden]) [data-bc-skill-row] button`).click();
  check('standalone-cached-skill-click-inserts-a-mention-without-sending',await page.locator(`${standaloneSelector}:not([hidden])`).count()===0&&await page.evaluate(()=>document.activeElement.querySelector('[data-fixture-skill="skill-10"]')&&window.skillInsertions.length===3&&window.promptSends===0));
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {skillVisible:{'skill-2':false}}));
  await openStandalone({draft:'/2'});
  await sendPrompts(await menuPromptRequests(),[]);
  check('standalone-search-does-not-reveal-hidden-skill',await page.locator(standaloneSelector+':not([hidden])').count()===0);
  await page.evaluate(()=>window.__codexCommandMenu.update({}, {skillVisible:{}}));
  check('standalone-shows-a-skill-again-without-reloading',await page.locator(standaloneSelector+':not([hidden]) [data-bc-skill-row] button').allTextContents().then(names=>names.join('|')==='Skill 2'));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{window.skillCacheFixture.scope.roots=['C:\\cold'];});
  await openStandalone();
  await sendPrompts(await menuPromptRequests(),await readPrompts());
  check('standalone-cold-skill-cache-falls-back-to-prompt-without-using-unrelated-scope',await page.locator(`${standaloneSelector}:not([hidden]) [data-bc-menu-heading]`).allTextContents().then(headings=>headings.join('|')==='Prompt'));
  await page.evaluate(()=>{document.querySelector('#composer').__reactFiber$fixture=null;delete window.skillCacheFixture;});
  await page.evaluate(()=>{window.menuFixtureController.ui.trigger='/';window.__codexCommandMenu.update({});window.__codexCommandMenu.remove();window.removeEventListener('keydown',window.nativeMenuKeys,true);});
  check('native-stop-restores-original-dom-and-order',await page.locator('#native-menu [data-bc-command],#better-codex-command-menu-style').count()===0&&await page.evaluate(()=>[...document.querySelector('#native-menu [data-mention-section-items]').children].map(row=>row.textContent).slice(0,2).join('|')==='reasoning|review-mode'));
  const now=1000000,data={binding:'ok',thread_id:id,updated_at_ms:now,source:{state:'ok'},metrics:{model:'fixture',stage:'idle',turn_ttft_ms:11244,last:{model:'fixture',source:'magpie',rate_basis:'magpie-native-speed-v1',ttft_ms:11244,rate:44.99,cache_percent:97.5,measured_at_ms:now-31000}}};
  check('metadata-format',JSON.stringify(formatMetrics(data,id,now,'zh-CN'))===JSON.stringify({ttft:'11.24s',speed:'45 tok/s',cache:'98%',age:'31s'}));
  const sample=last=>({...data,metrics:{...data.metrics,last:{...data.metrics.last,...last}}});
  check('native-fallback-preserves-known-turn-ttft-without-inventing-tps',JSON.stringify(formatMetrics(sample({source:'response',rate:900}),id,now,'zh-CN'))===JSON.stringify({ttft:'11.24s',speed:'- tok/s',cache:'98%',age:'31s'}));
  check('old-magpie-rate-is-not-new-tps',formatMetrics(sample({rate_basis:'upstream-request-average-v1'}),id,now).speed==='- tok/s');
  check('missing-ttft-keeps-tps',formatMetrics({...data,metrics:{...data.metrics,turn_ttft_ms:null}},id,now).ttft==='-s'&&formatMetrics({...data,metrics:{...data.metrics,turn_ttft_ms:null}},id,now).speed==='45 tok/s');
  check('missing-tps-keeps-ttft',formatMetrics(sample({rate:null}),id,now).ttft==='11.24s'&&formatMetrics(sample({rate:null}),id,now).speed==='- tok/s');
  check('later-request-ttft-does-not-replace-turn-ttft',formatMetrics(sample({ttft_ms:99999}),id,now).ttft==='11.24s');
  check('missing-first-ttft-never-borrows-latest-request-ttft',formatMetrics({...data,metrics:{...data.metrics,turn_ttft_ms:null}},id,now).ttft==='-s');
  check('expired-response-keeps-current-turn-first-latency',formatMetrics(sample({measured_at_ms:now-900000}),id,now).ttft==='11.24s'&&formatMetrics(sample({measured_at_ms:now-900000}),id,now).speed==='- tok/s');
  check('wrong-chat-rejected',formatMetrics(data,other,now).speed==='- tok/s');
  check('stale-heartbeat-rejected',formatMetrics({...data,updated_at_ms:now-6001},id,now,'zh-CN').age==='采集未连接');
  check('expired-sample-rejected',formatMetrics({...data,metrics:{...data.metrics,last:{...data.metrics.last,measured_at_ms:now-900000}}},id,now,'zh-CN').age==='数据已过期');
  check('english-relative-seconds',formatMetrics(data,id,now,'en-US').age==='31s');
  for(const [age,text] of [[0,'0s'],[1000,'1s'],[2000,'2s'],[59000,'59s'],[60000,'1min'],[899000,'14min'],[900000,'Stats expired']]){
    check('english-age-boundary-'+age,formatMetrics({...data,metrics:{...data.metrics,last:{...data.metrics.last,measured_at_ms:now-age}}},id,now,'en').age===text);
  }
  check('english-disconnected',formatMetrics({...data,updated_at_ms:now-6001},id,now,'en').age==='Collector offline');
  check('english-empty-and-unsupported-fallback',formatMetrics(null,id,now,'de-DE').age==='Waiting for stats');
  check('new-turn-clears-old-sample',formatMetrics({...data,metrics:{...data.metrics,stage:'generating',turn_started_at_ms:now}},id,now).speed==='- tok/s');
  check('new-turn-clears-first-latency',formatMetrics({...data,metrics:{...data.metrics,stage:'generating',turn_started_at_ms:now}},id,now).ttft==='-s');
  check('aborted-new-turn-does-not-restore-old-sample',formatMetrics({...data,metrics:{...data.metrics,stage:'idle',turn_started_at_ms:now}},id,now).speed==='- tok/s');
  check('idle-turn-mismatch-does-not-restore-old-sample',formatMetrics({...data,metrics:{...data.metrics,turn_id:'new',last:{...data.metrics.last,turn_id:'old'}}},id,now).speed==='- tok/s');
  const held={...data,metrics:{...data.metrics,turn_id:'turn',turn_started_at_ms:now-120000,speed_mode:'magpie',
    turn_speed:{...data.metrics.last,turn_id:'turn',turn_started_at_ms:now-120000},
    last:{...data.metrics.last,source:'response',turn_id:'turn',rate:900}}};
  check('retained-magpie-speed-survives-latest-missing-or-local-rate',formatMetrics(held,id,now).speed==='45 tok/s');
  check('new-turn-cannot-reuse-retained-speed',formatMetrics({...held,metrics:{...held.metrics,turn_id:'next',last:{...held.metrics.last,turn_id:'next'}}},id,now).speed==='- tok/s');
  check('turn-start-must-match-retained-speed',formatMetrics({...held,metrics:{...held.metrics,turn_started_at_ms:now-119000}},id,now).speed==='- tok/s');
  check('missing-turn-speed-never-borrows-local-algorithm',formatMetrics({...held,metrics:{...held.metrics,turn_speed:null}},id,now).speed==='- tok/s');
  check('future-retained-speed-is-hidden',formatMetrics({...held,metrics:{...held.metrics,turn_speed:{...held.metrics.turn_speed,measured_at_ms:now+1}}},id,now).speed==='- tok/s');
  check('retained-speed-rejects-another-model',formatMetrics({...held,metrics:{...held.metrics,turn_speed:{...held.metrics.turn_speed,model:'other'}}},id,now).speed==='- tok/s');
  const oldHeld={...held,metrics:{...held.metrics,turn_started_at_ms:now-1000000,
    turn_speed:{...held.metrics.turn_speed,turn_started_at_ms:now-1000000,measured_at_ms:now-950000},
    last:{...held.metrics.last,measured_at_ms:now-900000}}};
  check('same-turn-magpie-speed-remains-while-cache-expires',formatMetrics(oldHeld,id,now).speed==='45 tok/s'&&formatMetrics(oldHeld,id,now).cache==='-%');
  const local={...held,metrics:{...held.metrics,speed_mode:'local',turn_speed:{...held.metrics.turn_speed,source:'response',rate_basis:'response-request-average-v2',rate:23.6}}};
  check('explicit-local-mode-displays-request-average',formatMetrics(local,id,now).speed==='24 tok/s');
  check('local-speed-is-rejected-in-magpie-mode',formatMetrics({...local,metrics:{...local.metrics,speed_mode:'magpie'}},id,now).speed==='- tok/s');
  check('magpie-speed-is-rejected-in-local-mode',formatMetrics({...held,metrics:{...held.metrics,speed_mode:'local'}},id,now).speed==='- tok/s');
  fs.writeFileSync(path.join(evidence,'verification.json'),JSON.stringify({scope:'Synthetic Edge composer, not actual Codex renderer',results},null,2));console.log(JSON.stringify({passed:results.length}));
 }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
