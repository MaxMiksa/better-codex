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
  await reset();await page.setViewportSize({width:400,height:253});
  check('narrow-composer-hides-before-overlap',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  await page.setViewportSize({width:1261,height:253});await reset();
  await page.evaluate(()=>document.body.append(document.querySelector('#composer').cloneNode(true)));
  check('multiple-composers-refused',!(await page.evaluate(()=>window.__codexComposerHud.snapshot())).visible);
  snapshot=await reset();await page.evaluate(s=>window.__codexComposerHud.render({...s,speed:'99 tok/s',cache:'50%',age:'0s'}),snapshot);
  await page.waitForTimeout(3300);
  check('lost-controller-clears-values',!(await page.locator('#metrics').innerText()).includes('99'));
  await page.evaluate(()=>window.__codexComposerHud.remove());check('removal-cleans-view',await page.locator('#codex-composer-hud').count()===0);
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
