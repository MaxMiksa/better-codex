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
  [data-above-composer-portal]{position:relative;display:grid}
  [data-in-progress-fixed-content]{position:relative;height:32px}
  [data-in-progress-fixed-content] > .absolute{position:absolute;inset:auto 0 4px;display:flex;justify-content:center;padding-bottom:4px}
  .file-chip{display:flex;width:max-content;max-width:100%;min-width:0}
  .file-chip button{max-width:100%;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}
  nav{position:fixed;top:35px;left:5px;z-index:1}
</style><div id="timeline" data-app-shell-focus-area="main" class="thread-scroll-container" tabindex="0">
  <div id="transcript"><button id="message-action">Message action</button></div>
  <div data-thread-scroll-footer><div data-thread-composer-backdrop><div id="file-status" hidden><button>Files changed</button></div><div data-thread-find-composer>
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
    const editorPainted=()=>editor.evaluate(e=>e.checkVisibility({opacityProperty:true,visibilityProperty:true}));
    const caretAnchor=()=>editor.evaluate(e=>{
      const range=document.createRange(),first=e.querySelector('p')?.firstChild;
      if(first)range.selectNode(first);else range.selectNodeContents(e);
      const rect=range.getBoundingClientRect();
      return [rect.left,rect.top];
    });
    const sameAnchor=(from,to)=>from.every((v,i)=>Math.abs(v-to[i])<=1);
    const focus=()=>page.evaluate(()=>document.activeElement.id);
    const inputReady=()=>page.waitForFunction(()=>document.activeElement?.hasAttribute('data-bc-fold-input'));
    const twice=async()=>{await page.keyboard.press('Enter');await page.keyboard.press('Enter');};
    const insertMessage=()=>page.locator('#transcript').evaluate((e,message)=>e.insertAdjacentHTML('beforeend',message),message);
    const openHeight=await shape();
    await page.evaluate(()=>{window.editorIdentity=document.querySelector('#editor');window.nativeEnter=0;document.querySelector('#editor').addEventListener('keydown',e=>{if(e.key==='Enter')window.nativeEnter++;});});
    check('default-off-does-not-install-fold-styles',await page.locator('#codex-hud-composer-fold').count()===0);
    await mode('minimize');await page.waitForTimeout(260);
    check('id-alone-does-not-hide-an-empty-new-chat',await editorPainted()&&await state()===null);
    await editor.focus();await insertMessage();await page.waitForTimeout(260);
    check('first-message-does-not-hide-a-focused-composer',await editorPainted()&&await state()===null);
    await page.evaluate(()=>{
      window.clickCollapse=new Promise(resolve=>document.querySelector('#editor').addEventListener('focusout',()=>requestAnimationFrame(()=>{
        const shell=document.querySelector('[data-thread-find-composer]');
        resolve({closing:shell.hasAttribute('data-bc-fold-closing'),duration:shell.getAnimations()[0]?.effect.getTiming().duration});
      }),{once:true}));
    });
    await page.locator('#message-action').click();
    const clickCollapse=await page.evaluate(()=>window.clickCollapse);
    check('outside-click-starts-collapse-on-the-next-frame-with-a-shorter-animation',clickCollapse.closing&&clickCollapse.duration<200);
    await settled('minimize');
    check('minimize-leaves-real-keyboard-accessible-pill-and-less-height',await pill.isVisible()&&await pill.innerText()==='展开输入框'&&(await shape())<openHeight&&!(await editorPainted()));
    check('HUD-keeps-chat-binding-while-folded',await page.evaluate(()=>{const s=window.__codexComposerHud.snapshot();return Boolean(s.id)&&!s.visible&&s.compatibility.reason==='composer-folded';}));
    await blur();await page.keyboard.press('Enter');
    check('one-enter-does-not-open',await state()==='minimize');
    await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
    check('another-key-resets-the-pair',await state()==='minimize');
    await page.keyboard.press('Enter');await settled('moving');await settled(null);
    check('second-enter-opens-and-focuses-without-sending-or-replacing-editor',await focus()==='editor'&&await page.evaluate(()=>window.nativeEnter===0&&window.editorIdentity===document.activeElement)&&await shape()===openHeight);
    await page.evaluate(()=>{
      window.nativeEsc=[];
      for(const type of ['keydown','keyup'])document.addEventListener(type,e=>{if(e.key==='Escape')window.nativeEsc.push(type);});
    });
    await page.keyboard.down('Escape');await settled('minimize');
    check('escape-folds-before-key-repeat-or-release',await focus()==='editor'&&!await editorPainted());
    await page.keyboard.down('Escape');await page.keyboard.up('Escape');
    check('holding-escape-does-not-forward-repeats-to-native-actions',await page.evaluate(()=>window.nativeEsc.length===0));
    await pill.click();await settled(null);
    await edit('<p>Unsent draft</p>');await page.keyboard.press('Escape');
    check('escape-leaves-a-draft-and-its-native-key-handling-intact',await focus()==='editor'&&await state()===null&&await page.evaluate(()=>window.nativeEsc.join(',')==='keydown,keyup'));
    await blur();await page.waitForTimeout(260);
    check('unsent-draft-stays-visible',await state()===null&&await editor.innerText()==='Unsent draft');
    await edit(empty);
    await page.locator('[data-composer-attachments]').evaluate(e=>e.append(document.createElement('span')));
    await page.waitForTimeout(260);
    check('attachment-only-draft-stays-visible',await state()===null);
    await page.evaluate(()=>{
      document.querySelector('[data-composer-attachments]').replaceChildren();
      document.querySelector('#model').setAttribute('aria-expanded','true');
      document.querySelector('#editor').focus();
    });
    await page.keyboard.press('Escape');await blur();await page.waitForTimeout(260);
    check('native-menu-keeps-the-composer-open-and-receives-escape',await state()===null&&await page.evaluate(()=>window.nativeEsc.length===4));
    await page.locator('#model').evaluate(e=>e.setAttribute('aria-expanded','false'));
    await settled('minimize');await pill.click();await settled(null);
    check('minimized-pill-click-focuses-native-editor',await focus()==='editor');
    const naturalAnchor=await caretAnchor();
    await blur();await mode('hide');await settled('hide');
    check('hide-releases-all-composer-height-with-no-persistent-affordance',!(await pill.isVisible())&&!(await editorPainted())&&await shape()===0);
    const timeline=page.locator('#timeline');
    await page.locator('#transcript').evaluate(e=>e.style.minHeight='200vh');
    await inputReady();await page.keyboard.press('PageDown');
    await page.waitForFunction(()=>document.querySelector('#timeline').scrollTop>0);
    check('page-down-still-scrolls-the-conversation-with-the-editor-hidden',await state()==='hide');
    await page.locator('#transcript').evaluate(e=>e.style.minHeight='');
    await inputReady();await page.keyboard.press('Tab');
    check('tab-keeps-normal-focus-order-outside-the-hidden-editor',await focus()==='message-action'&&await state()==='hide');
    await blur();
    await inputReady();
    check('fully-hidden-editor-is-already-focused-before-native-ime-input',await editor.evaluate(e=>e===window.editorIdentity));
    check('hidden-editor-keeps-the-expanded-caret-anchor',sameAnchor(await caretAnchor(),naturalAnchor));
    await page.setViewportSize({width:765,height:555});
    await page.waitForFunction(()=>document.querySelector('#editor').getBoundingClientRect().width<600);
    const resizedAnchor=await caretAnchor();
    check('standby-caret-follows-the-resized-conversation',!sameAnchor(resizedAnchor,naturalAnchor));
    await editor.evaluate(e=>{
      window.nativeComposition=[];
      for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input'])e.addEventListener(type,event=>{
        window.nativeComposition.push({type,composing:event.isComposing,data:event.data,open:!e.hasAttribute('data-bc-fold-input'),focused:document.activeElement===e});
      });
    });
    const cdp=await browser.newCDPSession(page);
    await cdp.send('Input.imeSetComposition',{text:'n',selectionStart:1,selectionEnd:1});
    await settled(null);
    check('first-ime-letter-reveals-the-same-editor-without-breaking-composition',await editor.innerText()==='n'
      &&await page.evaluate(()=>window.nativeComposition.some(e=>e.type==='beforeinput'&&e.data==='n'&&e.composing&&e.open&&e.focused)));
    check('first-ime-letter-uses-the-same-caret-anchor-after-expansion',sameAnchor(resizedAnchor,await caretAnchor()));
    await cdp.send('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
    await cdp.send('Input.insertText',{text:'你好'});
    check('composition-commit-replaces-all-pinyin-without-a-raw-prefix',await editor.innerText()==='你好'
      &&await page.evaluate(()=>window.nativeComposition.filter(e=>e.type==='compositionstart').length===1));
    await edit(empty);await page.keyboard.press('Escape');await settled('hide');
    await page.keyboard.type('Go');
    check('english-typing-reveals-the-editor-with-no-missing-or-duplicated-keys',await state()===null&&await editor.innerText()==='Go');
    await edit(empty);await page.keyboard.press('Escape');await settled('hide');
    await cdp.send('Input.imeSetComposition',{text:'n',selectionStart:1,selectionEnd:1});
    await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
    check('canceling-ime-composition-leaves-an-empty-focused-editor',await state()===null&&await focus()==='editor'&&!(await editor.innerText()).trim());
    await edit(empty);await page.keyboard.press('Escape');await settled('hide');
    await page.setViewportSize({width:900,height:600});
    await cdp.detach();
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
    await page.evaluate(()=>{
      document.querySelector('#model').setAttribute('aria-label','停止');
      document.querySelector('#file-status').hidden=false;
    });
    await page.waitForTimeout(260);
    check('running-with-file-changes-keeps-badge-visible-and-input-hidden',await state()==='hide'&&await page.locator('#file-status').isVisible());
    await twice();await settled(null);
    check('double-enter-during-a-run-restores-the-native-stop',await focus()==='editor'&&await page.getByRole('button',{name:'停止'}).isVisible());
    await blur();await settled('hide');
    check('blur-after-manual-wake-refolds-during-a-run-without-send-pref',await shape()===0);
    await page.evaluate(id=>{
      document.querySelector('#file-status').hidden=true;
      const portal=document.querySelector('#composer > [data-above-composer-conversation-id]');
      portal.setAttribute('data-above-composer-portal','');
      portal.innerHTML=`<div data-in-progress-fixed-content><div class="absolute"><div class="file-chip">
        <button id="native-diff">3 files changed +3 −3</button>
        <div hidden data-above-composer-fixed-content-portal data-above-composer-conversation-id="${id}"></div>
        </div></div></div>`;
      window.nativeDiff=document.querySelector('#native-diff');window.nativeDiffClicks=0;
      window.nativeDiff.addEventListener('click',()=>window.nativeDiffClicks++);
    },id);
    const diff=page.locator('#native-diff');
    const compare=()=>page.evaluate(()=>{
      const badge=document.querySelector('#native-diff').getBoundingClientRect();
      const expand=document.querySelector('#codex-hud-expand-composer').getBoundingClientRect();
      return {verticalDistance:Math.abs((badge.top+badge.bottom-expand.top-expand.bottom)/2),
        overlap:badge.left<expand.right&&expand.left<badge.right,
        sharedRow:document.querySelector('[data-thread-find-composer]').offsetHeight<badge.height+expand.height};
    });
    await diff.waitFor({state:'visible'});
    check('native-fixed-status-alone-in-hide-without-an-input-slot',await state()==='hide'&&!(await editorPainted())&&!(await pill.isVisible())&&await shape()<=34);
    await mode('minimize');await settled('minimize');
    const dock=await compare();
    check('minimized-native-status-and-expand-share-one-row-without-overlap',dock.verticalDistance<=1&&!dock.overlap&&dock.sharedRow);
    await diff.click();
    await diff.evaluate(e=>{e.textContent='125 files changed +1309 −12';});
    await page.waitForTimeout(200);
    check('native-status-click-and-live-count-do-not-expand-input',await state()==='minimize'&&await diff.evaluate(e=>e===window.nativeDiff&&window.nativeDiffClicks===1)&&!(await editorPainted()));
    await page.setViewportSize({width:310,height:600});
    await page.waitForTimeout(70);
    const narrow=await compare();
    check('narrow-dock-keeps-both-controls-accessible-without-overlap',narrow.verticalDistance>=28&&await diff.isVisible()&&await pill.isVisible());
    await page.setViewportSize({width:900,height:600});
    await pill.click();await settled(null);
    check('opening-restores-original-status-layout-and-focus',await focus()==='editor'&&await diff.evaluate(e=>e===window.nativeDiff&&getComputedStyle(e.closest('.absolute')).position==='absolute'));
    await page.keyboard.press('Escape');await settled('minimize');
    check('escape-docks-the-same-status-without-hiding-it',await diff.isVisible()&&await diff.evaluate(e=>e===window.nativeDiff)&&(await compare()).verticalDistance<=1);
    await diff.evaluate(e=>e.closest('[data-in-progress-fixed-content]').remove());
    await blur();await settled('minimize');
    check('removing-status-leaves-no-space-beside-the-minimized-pill',await shape()===34&&await page.locator('[data-bc-fold-status-path]').count()===0);
    await mode('hide');await settled('hide');
    await page.locator('#composer').evaluate(e=>{
      const approval=document.createElement('div');approval.id='approval';
      approval.setAttribute('data-codex-composer-request-navigation','');e.append(approval);
    });
    await settled(null);await page.waitForTimeout(260);
    check('native-approval-restores-and-keeps-composer-visible-during-a-run',await state()===null&&await editorPainted());
    await page.locator('#approval').evaluate(e=>e.remove());
    await settled('moving');await twice();await settled(null);
    check('double-enter-can-reverse-an-in-progress-collapse',await focus()==='editor'&&await shape()===openHeight);
    await page.locator('#model').evaluate(e=>e.removeAttribute('aria-label'));
    await blur();await page.emulateMedia({reducedMotion:'reduce'});await settled('hide');await twice();await settled(null);
    check('reduced-motion-opens-without-layout-animation',await focus()==='editor'&&await page.locator('[data-thread-find-composer]').evaluate(e=>e.getAnimations().length===0));
    await blur();await settled('hide');await page.locator('[data-turn-key]').evaluate(e=>e.remove());await settled(null);
    check('switching-to-empty-thread-restores-native-composer',await editorPainted());
    await insertMessage();await settled('hide');

    await page.emulateMedia({reducedMotion:'no-preference'});
    await twice();await settled(null);await blur();
    const nextId='00000000-0000-4000-8000-000000000002';
    const firstFrame=await page.evaluate(nextId=>new Promise(resolve=>requestAnimationFrame(()=>{
      const shell=document.querySelector('[data-thread-find-composer]');
      document.querySelector('#model').setAttribute('aria-label','停止');
      document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',nextId);
      queueMicrotask(()=>resolve({state:shell.dataset.bcComposerFold,height:shell.offsetHeight,animations:shell.getAnimations().length}));
    })),nextId);
    check('navigating-to-running-thread-starts-hidden-without-a-collapse-animation',firstFrame.state==='hide'&&firstFrame.height===0&&firstFrame.animations===0);
    await page.locator('#model').evaluate(e=>e.removeAttribute('aria-label'));
    await mode('minimize');await settled('minimize');await pill.click();await settled(null);await blur();
    const replaced=await page.evaluate(nextId=>new Promise(resolve=>requestAnimationFrame(()=>{
      const old=document.querySelector('[data-thread-find-composer]'),shell=old.cloneNode(true);
      shell.querySelector('#codex-hud-expand-composer')?.remove();
      shell.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',nextId);
      old.replaceWith(shell);
      queueMicrotask(()=>resolve({state:shell.dataset.bcComposerFold,animations:shell.getAnimations().length}));
    })),id);
    check('replacing-the-composer-starts-minimized-in-the-first-frame',replaced.state==='minimize'&&replaced.animations===0);
    await page.locator('#transcript [data-turn-key]').evaluate((e,id)=>{e.firstElementChild.setAttribute('data-response-update-thread',id);},id);
    await page.locator('[data-above-composer-conversation-id]').evaluate((e,id)=>e.setAttribute('data-above-composer-conversation-id',id),nextId);
    check('old-transcript-cannot-hide-the-new-conversation-while-loading',await state()===null&&await editorPainted());
    const staleReady=await page.evaluate(id=>new Promise(resolve=>requestAnimationFrame(()=>{
      const shell=document.querySelector('[data-thread-find-composer]');
      document.querySelector('#transcript [data-response-update-thread]').setAttribute('data-response-update-thread',id);
      queueMicrotask(()=>resolve(shell.dataset.bcComposerFold==='minimize'&&shell.getAnimations().length===0));
    })),nextId);
    check('loaded-current-transcript-gets-the-preferred-state-before-paint',staleReady);

    await page.evaluate(({id,nextId})=>{
      const nav=document.createElement('nav');
      const prefix='data-app-action-sidebar-thread-';
      window.sidebarActivations=0;window.nativeEnter=0;
      for(const [name,key] of [['a',id],['b','client-new-thread:00000000-0000-4000-8000-000000000010']]){
        const row=document.createElement('div');
        row.setAttribute(prefix+'row','');row.setAttribute(prefix+'kind','local');row.setAttribute(prefix+'host-id','local');
        row.setAttribute(prefix+'id','local:'+key);row.setAttribute(prefix+'active',String(name==='b'));
        if(name==='b')row.__reactFiber$fixture={memoizedProps:{rowRef:{current:row},hostId:'local',conversationId:nextId}};
        const button=document.createElement('button');button.id='chat-'+name;button.setAttribute('data-interactive-row-button','');
        const label=document.createElement('span');label.textContent=name;button.append(label);
        button.addEventListener('click',()=>window.sidebarActivations++);
        const menu=document.createElement('button');menu.id='menu-'+name;menu.textContent='…';
        row.append(button,menu);nav.append(row);
      }
      document.body.prepend(nav);
      document.querySelector('#editor').addEventListener('keydown',event=>{if(event.key==='Enter')window.nativeEnter++;});
    },{id,nextId});
    const selected=async(name,chatId)=>page.evaluate(({name,chatId})=>{
      for(const b of document.querySelectorAll('nav [data-interactive-row-button]'))
        b.parentElement.setAttribute('data-app-action-sidebar-thread-active',String(b.id==='chat-'+name));
      document.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id',chatId);
    },{name,chatId});
    const loaded=chatId=>page.locator('#transcript [data-response-update-thread]').evaluate((e,id)=>e.setAttribute('data-response-update-thread',id),chatId);
    const activationCount=()=>page.evaluate(()=>window.sidebarActivations);
    await page.locator('#chat-a span').click();
    check('sidebar-click-waits-for-the-matching-chat',await focus()==='chat-a'&&await state()==='minimize');
    await selected('a',id);
    check('sidebar-focus-stays-put-while-the-old-transcript-is-mounted',await focus()==='chat-a'&&await state()===null);
    await loaded(id);
    check('mouse-selection-prepares-input-after-the-target-chat-is-ready',await focus()==='editor'&&await state()==='minimize'&&!(await editorPainted()));
    await twice();await settled(null);
    check('sidebar-click-then-double-enter-focuses-input-without-extra-activation-or-send',await focus()==='editor'&&await activationCount()===1&&await page.evaluate(()=>window.nativeEnter===0));
    await blur();await settled('minimize');await page.locator('#chat-a').focus();await twice();
    check('keyboard-activation-keeps-native-sidebar-focus-and-enter',await focus()==='chat-a'&&await state()==='minimize'&&await activationCount()===3);
    await page.locator('#menu-a').click();await twice();
    check('sidebar-menu-button-does-not-arm-focus-handoff',await focus()==='menu-a'&&await state()==='minimize');
    await page.locator('#chat-b').evaluate(button=>{
      const timeline=document.querySelector('#timeline');
      button.addEventListener('contextmenu',event=>{
        event.preventDefault();
        timeline.setAttribute('aria-hidden','true');
        timeline.setAttribute('data-aria-hidden','true');
        const menu=document.createElement('div');
        menu.id='sidebar-context';menu.setAttribute('role','menu');menu.dataset.state='open';
        menu.innerHTML='<button id="context-item" role="menuitem">Rename</button>';
        document.body.append(menu);
        menu.firstElementChild.focus();
        menu.addEventListener('keydown',event=>{
          if(event.key!=='Escape')return;
          menu.remove();button.focus();
          requestAnimationFrame(()=>requestAnimationFrame(()=>{
            timeline.removeAttribute('aria-hidden');timeline.removeAttribute('data-aria-hidden');
          }));
        });
      });
    });
    await page.locator('#chat-b').click({button:'right'});await page.waitForTimeout(60);
    check('sidebar-context-menu-keeps-minimized-input-and-native-focus',await state()==='minimize'&&await focus()==='context-item'&&!(await editorPainted()));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#timeline').hasAttribute('aria-hidden'));
    check('dismissing-sidebar-menu-does-not-expand-or-move-focus',await state()==='minimize'&&await focus()==='chat-b');
    await mode('hide');await settled('hide');
    await page.locator('#chat-b').click({button:'right'});await page.waitForTimeout(60);
    check('sidebar-context-menu-keeps-fully-hidden-input',await state()==='hide'&&!(await pill.isVisible())&&!(await editorPainted()));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#timeline').hasAttribute('aria-hidden'));
    await mode('minimize');await settled('minimize');
    await pill.click();await settled(null);
    await page.locator('#chat-b').evaluate(button=>{
      const editor=document.querySelector('#editor');
      editor.blur();
      requestAnimationFrame(()=>button.dispatchEvent(new MouseEvent('contextmenu',{button:2,bubbles:true,cancelable:true})));
    });
    await page.locator('#sidebar-context').waitFor({state:'visible'});
    await settled('minimize');
    check('sidebar-menu-does-not-reverse-an-in-progress-collapse',await focus()==='context-item'&&!(await editorPainted()));
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('#timeline').hasAttribute('aria-hidden'));
    await page.locator('#chat-b').click();await page.locator('#message-action').click();
    await selected('b',nextId);await loaded(nextId);await settled('minimize');
    check('new-user-interaction-cancels-delayed-sidebar-focus-handoff',await focus()==='message-action');
    await mode('hide');await settled('hide');
    await page.locator('#chat-b').click();await inputReady();
    await twice();await settled(null);
    check('temporary-sidebar-id-can-wake-a-fully-hidden-input-for-its-own-chat',await focus()==='editor'&&await activationCount()===5&&await page.evaluate(()=>window.nativeEnter===0));

    await page.locator('#chat-a').click();await selected('a',id);
    await editor.evaluate(e=>e.focus());
    check('automatic-editor-focus-is-not-moved-while-the-old-transcript-is-mounted',await focus()==='editor'&&await state()===null);
    const restoredEntry=await page.evaluate(id=>new Promise(resolve=>requestAnimationFrame(()=>{
      document.querySelector('#transcript [data-response-update-thread]').setAttribute('data-response-update-thread',id);
      queueMicrotask(()=>{
        const shell=document.querySelector('[data-thread-find-composer]');
        resolve({focus:document.activeElement.id,fold:shell.dataset.bcComposerFold,animations:shell.getAnimations().length});
      });
    })),id);
    check('historical-chat-autofocus-becomes-hidden-input-readiness-before-paint',restoredEntry.focus==='editor'&&restoredEntry.fold==='hide'&&restoredEntry.animations===0);
    await page.locator('#chat-b').click();await selected('b',nextId);
    await editor.evaluate(e=>e.focus());await editor.click();
    await loaded(nextId);
    check('user-clicking-editor-during-navigation-keeps-the-empty-input-open',await focus()==='editor'&&await state()===null);
    await page.locator('#chat-a').evaluate(e=>e.addEventListener('mousedown',event=>event.preventDefault(),{once:true}));
    await page.locator('#chat-a').click();
    check('sidebar-can-change-chats-without-taking-focus-first',await focus()==='editor');
    await selected('a',id);await loaded(id);
    check('retained-editor-focus-also-hides-on-confirmed-mouse-navigation',await focus()==='editor'&&await state()==='hide');

    await mode('minimize');await blur();await settled('minimize');
    await pill.click();await settled(null);
    await page.locator('#transcript [data-response-update-thread]').evaluate(e=>e.removeAttribute('data-response-update-thread'));
    const simulate=async({button=false,home=false,mirror=false}={})=>page.evaluate(({button,home,mirror,empty})=>{
      const composer=document.querySelector('#composer'),editor=document.querySelector('#editor');
      const commit=()=>{
        editor.innerHTML=empty;
        document.querySelector('#model').setAttribute('aria-label','停止');
        const transcript=document.querySelector('#transcript'),row=document.createElement('div');
        row.dataset.turnKey='sent-'+String(transcript.children.length);
        row.innerHTML='<span data-user-message-bubble data-user-message-has-prompt="true">Sent fixture</span>';
        if(home){
          composer.setAttribute('data-composer-placement','thread');
          composer.querySelector('[data-above-composer-conversation-id]').setAttribute('data-above-composer-conversation-id','00000000-0000-4000-8000-000000000003');
          transcript.replaceChildren(row);
        }else transcript.append(row);
        if(mirror){
          const first=composer.querySelector('[data-above-composer-conversation-id]');
          const copy=first.cloneNode(false);
          copy.id='fixed-portal';copy.setAttribute('data-above-composer-fixed-content-portal','');composer.append(copy);
        }
      };
      editor.innerHTML='<p>Outgoing fixture</p>';editor.focus();
      if(button){
        const send=document.createElement('button');send.setAttribute('aria-label','发送');composer.querySelector('footer').append(send);
        send.addEventListener('click',()=>{commit();send.remove();},{once:true});
      }else editor.addEventListener('keydown',e=>{e.preventDefault();commit();},{once:true});
    },{button,home,mirror,empty});
    const sendPref=value=>page.evaluate(value=>window.__codexComposerHud.settingsState({composerHideAfterSend:value}),value);
    await simulate();await page.keyboard.press('Enter');await page.waitForTimeout(260);
    check('sending-with-focus-does-not-close-when-the-send-option-is-off',await focus()==='editor'&&await state()===null&&await page.getByRole('button',{name:'停止'}).isVisible());
    await blur();await settled('minimize');
    check('ordinary-blur-still-minimizes-after-sending-with-the-send-option-off',await pill.isVisible()&&!(await editorPainted()));
    await pill.click();await settled(null);
    await page.locator('#model').evaluate(e=>e.removeAttribute('aria-label'));
    await sendPref(true);await simulate({mirror:true});await page.keyboard.press('Enter');
    await settled('moving');await settled('minimize');
    check('accepted-keyboard-send-folds-with-mirrored-active-task-markers-and-no-separate-stop',await pill.isVisible()&&!(await page.getByRole('button',{name:'停止'}).isVisible()));
    await pill.click();await settled(null);
    check('reopening-while-generating-restores-the-native-stop',await focus()==='editor'&&await page.getByRole('button',{name:'停止'}).isVisible());
    await page.locator('#fixed-portal').evaluate((e,id)=>e.setAttribute('data-above-composer-conversation-id',id),nextId);
    await blur();await page.waitForTimeout(430);
    check('different-conversation-markers-still-keep-the-composer-open',await state()===null&&await editorPainted());
    await page.locator('#fixed-portal').evaluate(e=>e.remove());
    await settled('minimize');await pill.click();await settled(null);
    await page.locator('#model').evaluate(e=>e.removeAttribute('aria-label'));
    await edit('<p>Not sent</p>');
    await page.evaluate(()=>document.querySelector('#editor').addEventListener('keydown',e=>e.preventDefault(),{once:true}));
    await page.keyboard.press('Enter');await page.waitForTimeout(260);
    check('unsent-enter-never-hides-the-draft',await state()===null&&await editor.innerText()==='Not sent');
    await mode('hide');await simulate({button:true});await page.getByRole('button',{name:'发送',exact:true}).click();await settled('hide');
    check('accepted-send-button-fully-hides-without-waiting-for-stop',!(await editorPainted())&&!(await pill.isVisible())&&await shape()===0);
    await twice();await settled(null);
    await page.locator('#model').evaluate(e=>e.removeAttribute('aria-label'));
    await page.locator('#composer').evaluate(e=>e.setAttribute('data-composer-placement','home'));
    await page.locator('#transcript').evaluate(e=>e.replaceChildren());
    await simulate({home:true});await page.keyboard.press('Enter');await settled('hide');
    check('first-confirmed-send-from-home-folds-the-new-conversation',!(await editorPainted())&&await shape()===0);

    await mode('off');await settled(null);
    check('off-cleans-layout-styles-and-controls-without-reload',await editorPainted()&&await pill.count()===0
      &&await page.locator('#codex-hud-composer-fold,[data-bc-fold-input],[data-bc-fold-input-path]').count()===0);
    console.log(count+' composer fold checks passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
