// Fold only the confirmed main-thread composer; never move or edit native nodes.
(() => {
  if (window.__codexComposerFold) return;
  const rootSelector='[data-codex-composer-root][data-composer-placement="thread"]';
  const inactive='[inert],[aria-hidden="true"],[data-app-shell-active-page="false"],[data-right-panel-composer-overlay-content="true"]';
  const popups='[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"][aria-expanded="true"],[data-state="open"][data-side],[popover]:popover-open';
  const interactive='button,a[href],input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="treeitem"],[role="checkbox"],[role="switch"],[role="radio"],[role="combobox"],[role="textbox"],[tabindex]';
  const entryAttributes=['data-above-composer-conversation-id','data-composer-placement','data-app-shell-active-page','data-app-shell-focus-area','data-right-panel-composer-overlay-content'];
  const stateAttr='data-bc-composer-fold',trackAttr='data-bc-composer-fold-track';
  const foldDelay=180,doubleEnter=350,sendTimeout=3500;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const style=document.createElement('style');
  style.id='codex-hud-composer-fold';
  style.textContent=`
    #codex-hud-expand-composer{align-self:center;display:flex;align-items:center;justify-content:center;gap:7px;height:34px;max-width:100%;padding:0 13px;border:1px solid var(--color-border,#7776);border-radius:999px;background:var(--bc-composer-surface,var(--color-background-secondary,#323237));color:var(--color-text,inherit);font:inherit;cursor:pointer}
    #codex-hud-expand-composer svg{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #codex-hud-expand-composer:hover{background:color-mix(in srgb,var(--bc-composer-surface,var(--color-background-secondary,#323237)) 88%,currentColor)}
    #codex-hud-expand-composer:focus-visible{outline:2px solid var(--codex-base-accent,currentColor);outline-offset:-3px}
    #codex-hud-expand-composer[hidden]{display:none}
    [${stateAttr}="minimize"]>[${trackAttr}],[${stateAttr}="hide"]>[${trackAttr}]{display:none!important}
    [${stateAttr}="moving"]{position:relative;min-height:0!important;overflow:clip}
    [${stateAttr}="moving"]>[${trackAttr}]{position:absolute;inset:auto 0 0;transform-origin:center bottom}
    [${stateAttr}="moving"]>#codex-hud-expand-composer{position:absolute;inset:auto auto 0 50%;translate:-50% 0}
    [${stateAttr}="moving"][data-bc-fold-closing]>[${trackAttr}]{pointer-events:none;interactivity:inert}
  `;
  const pill=document.createElement('button');
  pill.type='button';pill.id='codex-hud-expand-composer';pill.hidden=true;
  pill.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg><span></span>';
  const pillLabel=pill.lastElementChild;
  let mode='off',binding=null,threadId=null,folded='open',animation=[],listeners=null,frame=0,timer=0;
  let foldAfterSend=false,sendAttempt=null,sentId=null;
  let enterAt=-Infinity,pressed=false,swallow=false,composing=false;
  const visible=e=>Boolean(e?.getClientRects().length&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility==='visible'&&!e.closest(inactive));
  const clearTimer=()=>{clearTimeout(timer);timer=0;};
  const resetKeys=()=>{enterAt=-Infinity;pressed=false;swallow=false;};
  function stopAnimation(){const previous=animation;animation=[];for(const motion of previous)motion.cancel();}
  function commit(next){
    if(!binding)return;
    const {shell,track}=binding;
    stopAnimation();
    shell.removeAttribute('data-bc-fold-closing');
    if(next==='open'){shell.removeAttribute(stateAttr);track.removeAttribute(trackAttr);}
    else{shell.setAttribute(stateAttr,next);track.setAttribute(trackAttr,'');}
    pill.hidden=next!=='minimize';
    folded=next;
  }
  function detach(){
    clearTimer();resetKeys();
    if(binding){commit('open');pill.remove();binding=null;}
  }
  function main(root){
    const area=root.closest('[data-app-shell-focus-area]');
    return (!area||area.getAttribute('data-app-shell-focus-area')==='main')&&!root.closest(inactive);
  }
  function composerFields(root){
    const bodies=root.querySelectorAll('[data-composer-body]'),editors=root.querySelectorAll('[data-codex-composer="true"]');
    if(bodies.length!==1||editors.length!==1||!bodies[0].contains(editors[0]))return null;
    const body=bodies[0],editor=editors[0],attachments=body.querySelectorAll('[data-composer-attachments]');
    return attachments.length===1?{body,editor,attachments:attachments[0]}:null;
  }
  function find(){
    const roots=[...document.querySelectorAll(rootSelector)].filter(root=>main(root)&&(root===binding?.root||visible(root)));
    if(roots.length!==1)return null;
    const root=roots[0],scroll=root.closest('.thread-scroll-container');
    const shell=root.closest('[data-thread-find-composer]'),backdrop=shell?.parentElement;
    const tracks=shell&&[...shell.children].filter(node=>node!==pill);
    const ids=[...root.querySelectorAll('[data-above-composer-conversation-id]')];
    const id=ids[0]?.getAttribute('data-above-composer-conversation-id');
    if(!scroll||!backdrop?.matches('[data-thread-composer-backdrop]')||!backdrop.getBoundingClientRect().width||getComputedStyle(backdrop).visibility!=='visible'
      ||tracks.length!==1||!tracks[0].contains(root)
      ||ids.length!==1||!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))return null;
    const fields=composerFields(root);
    return fields?{root,scroll,shell,track:tracks[0],id,...fields}:null;
  }
  function ready({scroll,root}){
    const message=scroll.querySelector('[data-turn-key] :is([data-user-message-bubble][data-user-message-has-prompt],[data-markdown-text-style="assistant-message"]):not(:is([data-conversation-print] *,[data-codex-composer-root] *,[data-app-shell-active-page="false"] *))');
    return Boolean(message&&!root.contains(message));
  }
  function emptyDraft({editor,attachments}){
    // Only accept the native empty paragraph; any text, inline chip or unfamiliar shape stays open.
    if(attachments.childElementCount)return false;
    return editor.matches('textarea')?editor.value==='':editor.matches('[contenteditable="true"]')
      &&editor.querySelector(':scope > p[data-empty-paragraph]:only-child > br.ProseMirror-trailingBreak:only-child')&&!editor.textContent;
  }
  const actionLabel=node=>node.getAttribute('aria-label')||node.getAttribute('title')||'';
  const sendAction=node=>/^(?:send(?:\s+(?:message|prompt|now))?|发送(?:消息|提示词|提示)?)(?:\s*[(（].*)?$/i.test(actionLabel(node));
  const stopAction=node=>/^(stop|interrupt|停止|中断)/i.test(actionLabel(node));
  function safe(fields,allowStop=false){
    const {root,body}=fields;
    if(!emptyDraft(fields)||root.querySelector('[data-codex-composer-request-navigation],[data-composer-expanded],[data-codex-composer-queue],button[data-dictation-button][data-state="on"]'))return false;
    const controls=[...body.querySelectorAll('button')].filter(node=>!node.closest('[hidden],[aria-hidden="true"],[inert]'));
    const busy=controls.some(stopAction);
    return (allowStop||!busy)&&!controls.some(node=>/^(cancel|取消)/i.test(actionLabel(node)))
      &&(busy||controls.some(node=>node.matches('[data-dictation-button]')||sendAction(node)));
  }
  function latestUserTurn({scroll,root}){
    const bubbles=scroll.querySelectorAll('[data-turn-key] [data-user-message-bubble]:not(:is([data-conversation-print] *,[data-codex-composer-root] *,[data-app-shell-active-page="false"] *))');
    const bubble=bubbles[bubbles.length-1];
    return bubble&&!root.contains(bubble)?bubble.closest('[data-turn-key]')?.getAttribute('data-turn-key'):null;
  }
  function armSend(event){
    if(!foldAfterSend||event.defaultPrevented||event.isComposing||event.keyCode===229||composing||event.repeat)return;
    const target=event.composedPath()[0];
    if(!(target instanceof Element))return;
    const root=target.closest('[data-codex-composer-root]'),placement=root?.getAttribute('data-composer-placement');
    if(!root||!main(root)||!['thread','home'].includes(placement))return;
    const current=placement==='thread'?find():null;
    if(placement==='thread'&&current?.root!==root)return;
    const fields=current||composerFields(root);
    if(!fields||emptyDraft(fields))return;
    const button=event.type==='click'?target.closest('button'):null;
    if(event.type==='click'?!button||!fields.body.contains(button)||!sendAction(button)||button.matches(':disabled,[aria-disabled="true"]')
      :event.key!=='Enter'||!fields.editor.contains(target))return;
    sendAttempt={id:current?.id||null,root,button,previous:current?latestUserTurn(current):null,expires:performance.now()+sendTimeout};
  }
  function confirmSend(next){
    const attempt=sendAttempt;
    if(!attempt)return null;
    if(performance.now()>attempt.expires||(attempt.id&&next.id!==attempt.id)){sendAttempt=null;return null;}
    if(!emptyDraft(next))return null;
    // Key/click alone is not a send: require Codex to add a new user turn and clear the draft.
    const turn=latestUserTurn(next);
    if(!turn||turn===attempt.previous)return null;
    sendAttempt=null;
    return attempt;
  }
  function overlayOpen(){return window.__codexComposerHud?.settingsOpen?.()||[...document.querySelectorAll(popups)].some(visible);}
  function canFold(sent){
    const active=document.activeElement;
    return !composing&&(!binding.root.contains(active)||sent&&(active===binding.editor||active===sent.button))&&!active?.closest('#codex-composer-hud')
      &&!binding.root.querySelector('[aria-expanded="true"]')&&!overlayOpen();
  }
  function updatePillSurface(){
    const background=getComputedStyle(binding.body.parentElement).backgroundColor;
    pill.style.setProperty('--bc-composer-surface',background==='rgba(0, 0, 0, 0)'?'':background);
  }
  function transition(next){
    const {shell,track}=binding;
    if(folded===next)return;
    if(reduced.matches){commit(next);return;}
    const start=shell.getBoundingClientRect().height,previous=folded;
    const current=getComputedStyle(track),currentScale=current.scale,currentOpacity=current.opacity,miniOpacity=getComputedStyle(pill).opacity;
    if(previous==='open')updatePillSurface();
    commit(next);
    const end=shell.getBoundingClientRect().height;
    const mini=next==='minimize'||previous==='minimize';
    pill.hidden=!mini;
    const scale=mini?Math.min(1,pill.getBoundingClientRect().width/Math.max(1,shell.getBoundingClientRect().width)):.96;
    shell.setAttribute(stateAttr,'moving');track.setAttribute(trackAttr,'');
    shell.toggleAttribute('data-bc-fold-closing',next!=='open');
    const options={duration:220,easing:'cubic-bezier(.22,.75,.25,1)',fill:'both'};
    const startingVisible=previous==='open'||previous==='opening'||previous==='closing';
    const motion=shell.animate([{height:start+'px'},{height:end+'px'}],options);
    animation=[motion,track.animate([
      {scale:startingVisible?currentScale:scale+' 1',opacity:startingVisible?currentOpacity:0},
      {scale:next==='open'?'1 1':scale+' 1',opacity:next==='open'?1:0}
    ],options)];
    if(mini)animation.push(pill.animate([{opacity:previous==='minimize'?1:previous==='opening'||previous==='closing'?miniOpacity:0},{opacity:next==='minimize'?1:0}],options));
    folded=next==='open'?'opening':'closing';
    motion.onfinish=()=>{if(animation[0]===motion)commit(next);};
  }
  function check(){
    frame=0;if(mode==='off')return;
    const next=find();
    if(!next||!ready(next)){
      if(next?.id!==threadId)threadId=null;
      if(next?.id!==sentId)sentId=null;
      detach();return;
    }
    const entering=next.id!==threadId;
    // Codex can keep the previous transcript mounted while switching the composer to the next ID.
    if(entering&&next.scroll.querySelector('[data-turn-key] [data-response-update-thread]')
      &&!next.scroll.querySelector('[data-turn-key] [data-response-update-thread="'+next.id+'"]')){detach();return;}
    threadId=next.id;
    if(sentId!==next.id)sentId=null;
    if(next.root!==binding?.root||next.id!==binding?.id||next.track!==binding?.track){
      detach();binding=next;pill.hidden=true;binding.shell.append(pill);
    }else binding=next;
    if(!pill.isConnected)binding.shell.append(pill);
    const label=window.__codexHudI18n.t('expandComposer');
    if(pillLabel.textContent!==label){pillLabel.textContent=label;pill.title=window.__codexHudI18n.t('composerFoldShortcut');}
    const sent=confirmSend(next);
    if(sent&&safe(binding,true)&&canFold(sent)){
      clearTimer();sentId=next.id;
      const active=document.activeElement;
      if(active===binding.editor||active===sent.button)active.blur();
      transition(mode);return;
    }
    if(!safe(binding,sentId===next.id||folded==='opening')){sentId=null;clearTimer();commit('open');resetKeys();return;}
    if(entering&&canFold()){
      if(mode==='minimize')updatePillSurface();
      commit(mode);return;
    }
    if(folded==='closing'){if(!canFold())transition('open');return;}
    if(folded==='opening')return;
    if(folded!=='open'){if(folded!==mode)transition(mode);return;}
    if(!canFold()){clearTimer();return;}
    if(!timer)timer=setTimeout(()=>{
      timer=0;
      const latest=find();
      if(latest&&binding&&latest.root===binding.root&&latest.id===binding.id&&ready(latest)&&safe(latest)&&canFold())transition(mode);
    },foldDelay);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(check);}
  function wake(){
    const latest=find();
    if(!binding||latest?.root!==binding.root||latest?.id!==binding.id||!ready(latest)){detach();return false;}
    sentId=null;sendAttempt=null;binding=latest;transition('open');binding.editor.focus({preventScroll:true});return true;
  }
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
  function keydown(event){
    if(swallow&&event.key==='Enter'&&event.repeat){consume(event);return;}
    if(event.key==='Enter')armSend(event);
    const target=event.composedPath()[0],inside=target===document.body||target===document.documentElement
      ||(target instanceof Element&&binding?.scroll.contains(target)&&(!target.closest(interactive)||target===binding.scroll));
    if(event.defaultPrevented||event.key!=='Enter'||event.isComposing||event.keyCode===229||composing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey
      ||!inside||!binding||!['minimize','hide','closing'].includes(folded)||overlayOpen()){
      enterAt=-Infinity;return;
    }
    if(event.repeat||pressed){enterAt=-Infinity;return;}
    pressed=true;
    const now=performance.now();
    if(now-enterAt<=doubleEnter){
      enterAt=-Infinity;
      if(wake()){swallow=true;consume(event);}
    }else enterAt=now;
  }
  function keyup(event){if(event.key==='Enter'){pressed=false;if(swallow){swallow=false;consume(event);}}}
  const observer=new MutationObserver(records=>{
    const native=records.filter(record=>record.target!==pill&&!pill.contains(record.target));
    if(!native.length)return;
    // Navigation can commit during an animation frame; reconcile identity changes before paint.
    if(sendAttempt||!binding?.root.isConnected||native.some(record=>entryAttributes.includes(record.attributeName)
      ||record.type==='childList'&&(record.target===binding.root||record.target===binding.shell))){
      cancelAnimationFrame(frame);check();
    }else schedule();
  });
  function start(){
    document.head.append(style);listeners=new AbortController();
    const on=(target,type,fn)=>target.addEventListener(type,fn,{capture:true,signal:listeners.signal});
    on(window,'keydown',keydown);on(window,'keyup',keyup);
    on(document,'focusin',()=>{enterAt=-Infinity;schedule();});on(document,'focusout',schedule);
    on(document,'input',event=>{
      if(sendAttempt&&event.isTrusted&&event.inputType?.startsWith('insert'))sendAttempt=null;
      schedule();
    });on(document,'click',armSend);
    on(document,'pointerdown',event=>{
      enterAt=-Infinity;
      if(sendAttempt&&!event.composedPath().includes(sendAttempt.root))sendAttempt=null;
      schedule();
    });on(document,'pointerup',schedule);
    on(document,'compositionstart',()=>{composing=true;resetKeys();schedule();});on(document,'compositionend',()=>{composing=false;schedule();});
    on(window,'blur',()=>{composing=false;resetKeys();});on(window,'resize',schedule);on(window,'languagechange',schedule);
    on(reduced,'change',()=>{if(binding&&animation.length)commit(folded==='opening'?'open':mode);});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:[
      ...entryAttributes,'data-response-update-thread',
      'data-empty-paragraph','data-composer-expanded','data-state','aria-label','aria-expanded','aria-hidden','inert','hidden'
    ]});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    schedule();
  }
  function stop(){
    listeners?.abort();listeners=null;observer.disconnect();cancelAnimationFrame(frame);frame=0;
    composing=false;threadId=null;sendAttempt=null;sentId=null;detach();style.remove();
  }
  pill.addEventListener('click',wake);
  window.__codexComposerFold={
    update(value,afterSend=false){
      const next=['minimize','hide'].includes(value)?value:'off';
      const afterSendChanged=foldAfterSend!==(afterSend===true);
      if(!afterSendChanged&&mode===next)return;
      mode=next;
      foldAfterSend=afterSend===true;
      if(!foldAfterSend){sendAttempt=null;sentId=null;}
      if(next==='off')stop();else if(!listeners)start();else schedule();
    },
    hides(root){return binding?.root===root&&folded!=='open';},
    remove(){stop();delete window.__codexComposerFold;}
  };
})();
