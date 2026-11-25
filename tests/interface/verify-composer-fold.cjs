const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
const source=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
const i18n=require('../../src/platform/i18n/i18n.js').pageSource();
const id='00000000-0000-4000-8000-000000000001';
const html=`<!doctype html><html lang="zh-CN"><style>
  body{margin:0} .thread-scroll-container{height:100vh;overflow:auto;position:relative}
  [data-thread-scroll-footer]{position:absolute;bottom:16px;left:15%;right:15%}
  [data-thread-find-composer]{display:flex;flex-direction:column}
  [data-composer-body]{background:#333;border-radius:20px;padding:10px}
  [contenteditable]{height:38px;outline:none} [contenteditable] p{margin:0}
  footer{display:flex;justify-content:space-between;margin-top:10px}
  button{height:28px}
</style><div data-app-shell-focus-area="main" class="thread-scroll-container" tabindex="0">
  <div id="transcript"><button id="message-action">Message action</button></div>
  <div data-thread-scroll-footer><div data-thread-composer-backdrop><div data-thread-find-composer>
    <div id="track"><div style="display:contents"><div id="composer" data-codex-composer-root data-composer-placement="thread">
      <div data-above-composer-conversation-id="${id}"></div><div data-composer-body>
      <div data-composer-attachments></div><div id="editor" contenteditable="true" data-codex-composer="true" role="textbox"><p data-empty-paragraph><br class="ProseMirror-trailingBreak"></p></div>
      <footer><button id="add">+</button><div><button id="model" aria-expanded="false">Model</button><button data-dictation-button aria-label="Dictation">Mic</button></div></footer>
      </div></div></div></div>
  </div></div></div>
</div>`;
const message='<div data-turn-key="fixture"><span data-user-message-bubble data-user-message-has-prompt="true">Fixture</span></div>';
let count=0;
const check=(label,value)=>{assert.ok(value,label);count++;console.log('PASS '+label);};
(async()=>{
  const browser=await chromium.launchPersistentContext(process.argv[2],{headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:900,height:600}});
  try{
    const page=browser.pages()[0];
    await page.setContent(html);
    await page.evaluate(i18n);
    await page.evaluate(source('src/interface/appearance/composer-fold.js'));
    await page.evaluate(source('src/interface/statistics/composer-strip.js'));
    const mode=value=>page.evaluate(value=>window.__codexComposerHud.settingsState({composerAutoHide:value}),value);
    const state=()=>page.locator('[data-thread-find-composer]').getAttribute('data-bc-composer-fold');
    const settled=value=>page.waitForFunction(value=>document.querySelector('[data-thread-find-composer]').getAttribute('data-bc-composer-fold')===value,value);
    const shape=()=>page.locator('[data-thread-find-composer]').evaluate(e=>e.getBoundingClientRect().height);
    const pill=page.locator('#codex-hud-expand-composer');
    const editor=page.locator('#editor'),empty='<p data-empty-paragraph><br class="ProseMirror-trailingBreak"></p>';
    const blur=()=>page.locator('.thread-scroll-container').focus();
    const edit=value=>editor.evaluate((e,value)=>{e.innerHTML=value;},value);
    const focus=()=>page.evaluate(()=>document.activeElement.id);
    const twice=async()=>{await page.keyboard.press('Enter');await page.keyboard.press('Enter');};
    const insertMessage=()=>page.locator('#transcript').evaluate((e,message)=>e.insertAdjacentHTML('beforeend',message),message);
    const openHeight=await shape();
    await page.evaluate(()=>{window.editorIdentity=document.querySelector('#editor');window.nativeEnter=0;document.querySelector('#editor').addEventListener('keydown',e=>{if(e.key==='Enter')window.nativeEnter++;});});
    check('default-off-does-not-install-fold-styles',await page.locator('#codex-hud-composer-fold').count()===0);
    await mode('minimize');await page.waitForTimeout(260);
    check('id-alone-does-not-hide-an-empty-new-chat',await editor.isVisible()&&await state()===null);
    await editor.focus();await insertMessage();await page.waitForTimeout(260);
    check('first-message-does-not-hide-a-focused-composer',await editor.isVisible()&&await state()===null);
    await blur();await settled('moving');
    check('collapse-animates-the-native-layout',await page.locator('[data-thread-find-composer]').evaluate(e=>e.getAnimations().length===1));
    await settled('minimize');
    check('minimize-leaves-real-keyboard-accessible-pill-and-less-height',await pill.isVisible()&&await pill.innerText()==='展开输入框'&&(await shape())<openHeight&&!(await editor.isVisible()));
    check('HUD-keeps-chat-binding-while-folded',await page.evaluate(()=>{const s=window.__codexComposerHud.snapshot();return Boolean(s.id)&&!s.visible&&s.compatibility.reason==='composer-folded';}));
    await page.keyboard.press('Enter');
    check('one-enter-does-not-open',await state()==='minimize');
    await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
    check('another-key-resets-the-pair',await state()==='minimize');
    await page.keyboard.press('Enter');await settled('moving');await settled(null);
    check('second-enter-opens-and-focuses-without-sending-or-replacing-editor',await focus()==='editor'&&await page.evaluate(()=>window.nativeEnter===0&&window.editorIdentity===document.activeElement)&&await shape()===openHeight);
    await edit('<p>Unsent draft</p>');await blur();await page.waitForTimeout(260);
    check('unsent-draft-stays-visible',await state()===null&&await editor.innerText()==='Unsent draft');
    await edit(empty);
    await page.locator('[data-composer-attachments]').evaluate(e=>e.append(document.createElement('span')));
    await page.waitForTimeout(260);
    check('attachment-only-draft-stays-visible',await state()===null);
    await page.locator('[data-composer-attachments]').evaluate(e=>e.replaceChildren());
    await page.locator('#model').evaluate(e=>e.setAttribute('aria-expanded','true'));await page.waitForTimeout(260);
    check('native-menu-protects-composer',await state()===null);
    await page.locator('#model').evaluate(e=>e.setAttribute('aria-expanded','false'));
    await settled('minimize');await pill.click();await settled(null);
    check('minimized-pill-click-focuses-native-editor',await focus()==='editor');
    await blur();await mode('hide');await settled('hide');
    check('hide-releases-all-composer-height-with-no-persistent-affordance',!(await pill.isVisible())&&!(await editor.isVisible())&&await shape()===0);
    await page.locator('#message-action').focus();await twice();
    check('interactive-message-controls-keep-their-enter-key',await state()==='hide');
    await blur();
    await page.keyboard.press('Shift+Enter');await page.keyboard.press('Enter');
    check('modified-enter-is-not-counted',await state()==='hide');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.up('Enter');
    check('press-and-hold-never-counts-as-double-enter',await state()==='hide');
    await page.evaluate(()=>document.activeElement.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
    await twice();check('IME-confirmations-do-not-wake-input',await state()==='hide');
    await page.evaluate(()=>document.activeElement.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await page.locator('#transcript').evaluate(e=>{const popup=document.createElement('div');popup.role='dialog';popup.textContent='Fixture dialog';e.append(popup);});
    await twice();check('visible-dialog-prevents-global-wakeup',await state()==='hide');
    await page.locator('#transcript [role="dialog"]').evaluate(e=>e.remove());
    await page.locator('#model').evaluate(e=>e.setAttribute('aria-label','停止'));
    await settled(null);await page.waitForTimeout(260);
    check('new-stop-action-restores-and-keeps-native-controls-visible',await page.getByRole('button',{name:'停止'}).isVisible());
    await page.locator('#model').evaluate(e=>e.removeAttribute('aria-label'));
    await settled('moving');await twice();await settled(null);
    check('double-enter-can-reverse-an-in-progress-collapse',await focus()==='editor'&&await shape()===openHeight);
    await blur();await page.emulateMedia({reducedMotion:'reduce'});await settled('hide');await twice();await settled(null);
    check('reduced-motion-opens-without-layout-animation',await focus()==='editor'&&await page.locator('[data-thread-find-composer]').evaluate(e=>e.getAnimations().length===0));
    await blur();await settled('hide');await page.locator('[data-turn-key]').evaluate(e=>e.remove());await settled(null);
    check('switching-to-empty-thread-restores-native-composer',await editor.isVisible());
    await insertMessage();await settled('hide');await mode('off');await settled(null);
    check('off-cleans-layout-styles-and-controls-without-reload',await editor.isVisible()&&await pill.count()===0&&await page.locator('#codex-hud-composer-fold').count()===0);
    console.log(count+' composer fold checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
