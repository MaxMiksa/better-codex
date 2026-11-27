// Fold only the confirmed main-thread composer; never reparent or rewrite native content.
(() => {
  if (window.__codexComposerFold) return;
  const rootSelector='[data-codex-composer-root][data-composer-placement="thread"]';
  const inactivePage='[data-app-shell-active-page="false"],[data-right-panel-composer-overlay-content="true"]';
  const interactionBlocked='[inert],[aria-hidden="true"]';
  const persistentBlock='[inert]:not([data-inert-ed]),[aria-hidden="true"]:not([data-aria-hidden])';
  const inactive=interactionBlocked+','+inactivePage;
  const popups='[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"],[role="combobox"][aria-expanded="true"],[data-state="open"][data-side],[popover]:popover-open';
  const interactive='button,a[href],input,textarea,select,summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="tab"],[role="treeitem"],[role="checkbox"],[role="switch"],[role="radio"],[role="combobox"],[role="textbox"],[tabindex]';
  const sidebarRow='[data-app-action-sidebar-thread-row][data-app-action-sidebar-thread-host-id="local"][data-app-action-sidebar-thread-kind="local"]';
  const rowActive='data-app-action-sidebar-thread-active',rowId='data-app-action-sidebar-thread-id';
  const uuid=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  const entryAttributes=['data-above-composer-conversation-id','data-composer-placement','data-app-shell-active-page','data-app-shell-focus-area','data-right-panel-composer-overlay-content'];
  const stateAttr='data-bc-composer-fold',trackAttr='data-bc-composer-fold-track';
  const pathAttr='data-bc-fold-status-path',statusAttr='data-bc-fold-status-row';
  const inputPath='data-bc-fold-input-path',inputAttr='data-bc-fold-input';
  const measureAttr='data-bc-fold-measure-input';
  const inputBox=['left','bottom','width','height'].map(key=>'--bc-fold-input-'+key);
  const keptPath=`:is([${pathAttr}],[${inputPath}])`;
  const keptChild=`:is(${keptPath},[${statusAttr}],[${inputAttr}])`;
  const collapsed=`:is([${stateAttr}="minimize"],[${stateAttr}="hide"]):not([${measureAttr}])`;
  const doubleEnter=350,sendTimeout=3500,sidebarTimeout=3000;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const style=document.createElement('style');
  style.id='codex-hud-composer-fold';
  style.textContent=`
    #codex-hud-expand-composer{align-self:center;display:flex;align-items:center;justify-content:center;gap:7px;height:34px;max-width:100%;padding:0 13px;border:1px solid var(--color-border,#7776);border-radius:999px;background:var(--bc-composer-surface,var(--color-background-secondary,#323237));color:var(--color-text,inherit);font:inherit;cursor:pointer}
    #codex-hud-expand-composer svg{flex:none;width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    #codex-hud-expand-composer:hover{background:color-mix(in srgb,var(--bc-composer-surface,var(--color-background-secondary,#323237)) 88%,currentColor)}
    #codex-hud-expand-composer:focus-visible{outline:2px solid var(--codex-base-accent,currentColor);outline-offset:-3px}
    #codex-hud-expand-composer[hidden],[${measureAttr}]>#codex-hud-expand-composer{display:none!important}
    ${collapsed}>[${trackAttr}]:not(${keptPath}),${collapsed} ${keptPath} > :not(${keptChild}){display:none!important}
    ${collapsed} ${keptPath}{display:contents!important}
    ${collapsed}:has([${inputAttr}]){position:relative}
    ${collapsed} [${inputAttr}]{position:absolute!important;inset:auto auto var(${inputBox[1]},0px) var(${inputBox[0]},0px)!important;width:var(${inputBox[2]},0px)!important;height:var(${inputBox[3]},0px)!important;min-width:0!important;min-height:0!important;max-width:none!important;max-height:none!important;margin:0!important;box-sizing:border-box!important;opacity:0!important;pointer-events:none!important}
    ${collapsed}:has(>[${trackAttr}][${pathAttr}]){display:flex;flex-flow:row wrap;justify-content:center;align-items:center;gap:8px}
    ${collapsed} [${statusAttr}]{width:max-content;max-width:100%;min-width:0;height:auto!important;align-self:center}
    ${collapsed} [${statusAttr}]>div{position:relative!important;inset:auto!important;padding-bottom:0!important}
    [${stateAttr}="moving"]{position:relative;min-height:0!important;overflow:clip}
    [${stateAttr}="moving"]>[${trackAttr}]{position:absolute;inset:auto 0 0;transform-origin:center bottom}
    [${stateAttr}="moving"]>#codex-hud-expand-composer{position:absolute;inset:auto auto 0 50%;translate:-50% 0}
    [${stateAttr}="moving"]:has([data-codex-composer="true"]:focus)>[${trackAttr}],
    [${stateAttr}="moving"] [data-composer-body]:has([data-codex-composer="true"]:focus){scale:none!important}
    [data-bc-fold-closing]>[${trackAttr}]{pointer-events:none}
    [data-bc-fold-closing]>[${trackAttr}]:not([${inputPath}]),[data-bc-fold-closing] [${inputPath}] > :not([${inputPath}],[${inputAttr}]){interactivity:inert}
  `;
  const pill=document.createElement('button');
  pill.type='button';pill.id='codex-hud-expand-composer';pill.hidden=true;
  pill.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 22V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H8zM8 7h8m-8 3.5h8M8 14h5"/></svg><span></span>';
  const pillLabel=pill.lastElementChild;
  let mode='off',binding=null,threadId=null,folded='open',animation=[],listeners=null,frame=0;
  let foldAfterSend=false,sendAttempt=null,sidebarClick=null,standby=null;
  let enterAt=-Infinity,pressed=false,swallow=false,composing=false,escapeHeld=false;
  const visible=e=>Boolean(e?.getClientRects().length&&e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility==='visible'&&!e.closest(inactive));
  const foldedOrClosing=()=>['minimize','hide','closing'].includes(folded);
  const resetKeys=()=>{enterAt=-Infinity;pressed=false;swallow=false;};
  const inputResize=new ResizeObserver(()=>schedule());
  function stopAnimation(){const previous=animation;animation=[];for(const motion of previous)motion.cancel();}
  function commit(next){
    if(!binding)return;
    const {shell,track}=binding;
    stopAnimation();
    shell.removeAttribute('data-bc-fold-closing');
    if(next==='open'){shell.removeAttribute(stateAttr);track.removeAttribute(trackAttr);clearStandby();}
    else{shell.setAttribute(stateAttr,next);track.setAttribute(trackAttr,'');}
    pill.hidden=next!=='minimize';
    folded=next;
  }
  function detach(){
    resetKeys();
    clearStandby('blur');
    if(binding){commit('open');setStatus(binding.status, false);pill.remove();binding=null;}
  }
  function main(root,keepFolded=false){
    const area=root.closest('[data-app-shell-focus-area]');
    // Radix temporarily hides the menu background from the accessibility tree.
    // This does not deactivate the chat or justify revealing a folded composer.
    return (!area||area.getAttribute('data-app-shell-focus-area')==='main')
      &&!root.closest(inactivePage)&&!root.closest(keepFolded?persistentBlock:interactionBlocked);
  }
  function composerFields(root){
    const bodies=root.querySelectorAll('[data-composer-body]'),editors=root.querySelectorAll('[data-codex-composer="true"]');
    if(bodies.length!==1||editors.length!==1||!bodies[0].contains(editors[0]))return null;
    const body=bodies[0],editor=editors[0],attachments=body.querySelectorAll('[data-composer-attachments]');
    return attachments.length===1?{body,editor,attachments:attachments[0]}:null;
  }
  function fixedStatus(root,track,id){
    // The active turn ports its change/plan strip into this conversation's composer.
    // Keep the original controls in place; only expose their confirmed path when folded.
    const owner=`[data-above-composer-conversation-id="${id}"]`;
    const rows=[...root.querySelectorAll(`[data-above-composer-portal]${owner}>[data-in-progress-fixed-content]`)];
    if(rows.length!==1)return null;
    const row=rows[0],layer=row.firstElementChild;
    if(row.childElementCount!==1||!layer.matches('div.absolute')||!layer.querySelector('button')
      ||!layer.querySelector(`[data-above-composer-fixed-content-portal]${owner}`))return null;
    const path=[];
    for(let node=row.parentElement;node;node=node.parentElement){
      path.push(node);
      if(node===track)return {row,layer,path};
    }
    return null;
  }
  function setStatus(status, enabled){
    if(!status)return;
    status.row.toggleAttribute(statusAttr,enabled);
    for(const node of status.path)node.toggleAttribute(pathAttr,enabled);
  }
  function bind(next){
    const before=binding?.status,after=next.status;
    const changed=before?.row!==after?.row||before?.layer!==after?.layer
      ||before?.path.some((node,index)=>node!==after?.path[index])||before?.path.length!==after?.path.length;
    if(changed){setStatus(before,false);setStatus(after,true);}
    binding=next;
    if(changed&&animation.length)commit(folded==='opening'?'open':mode);
  }
  function find(keepFolded=false){
    const roots=[...document.querySelectorAll(rootSelector)].filter(root=>main(root,keepFolded&&root===binding?.root)&&(root===binding?.root||visible(root)));
    if(roots.length!==1)return null;
    const root=roots[0],scroll=root.closest('.thread-scroll-container');
    const shell=root.closest('[data-thread-find-composer]'),backdrop=shell?.parentElement;
    const tracks=shell&&[...shell.children].filter(node=>node!==pill);
    // Codex mirrors the same conversation ID into a second portal while a task is running.
    const ids=new Set([...root.querySelectorAll('[data-above-composer-conversation-id]')].map(node=>node.getAttribute('data-above-composer-conversation-id')));
    const id=ids.values().next().value;
    if(!scroll||!backdrop?.matches('[data-thread-composer-backdrop]')||!backdrop.getBoundingClientRect().width||getComputedStyle(backdrop).visibility!=='visible'
      ||tracks.length!==1||!tracks[0].contains(root)
      ||ids.size!==1||!uuid.test(id))return null;
    if(keepFolded&&id!==binding?.id&&!main(root))return null;
    const fields=composerFields(root);
    return fields?{root,scroll,shell,track:tracks[0],id,...fields,status:fixedStatus(root,tracks[0],id)}:null;
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
  function safe(fields,keepFolded=false){
    const {root,body}=fields;
    if(!emptyDraft(fields)||root.querySelector('[data-codex-composer-request-navigation],[data-composer-expanded],[data-codex-composer-queue],button[data-dictation-button][data-state="on"]'))return false;
    const unavailable='[hidden],'+(keepFolded?persistentBlock:interactionBlocked);
    const controls=[...body.querySelectorAll('button')].filter(node=>!node.closest(unavailable));
    // Stop is a normal composer action during a run, not a pending decision.
    return !controls.some(node=>/^(cancel|取消)/i.test(actionLabel(node)))
      &&controls.some(node=>node.matches('[data-dictation-button]')||sendAction(node)||stopAction(node));
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
  function menuOutside(popup,root){
    if(!popup.matches('[role="menu"]')||root.contains(popup))return false;
    const owner=document.getElementById(popup.getAttribute('aria-labelledby')||'');
    return !root.contains(owner)&&(!popup.id||!root.querySelector(`[aria-controls="${CSS.escape(popup.id)}"]`));
  }
  function overlayOpen(ignoreMenusOutside=null){
    return window.__codexComposerHud?.settingsOpen?.()||[...document.querySelectorAll(popups)].some(popup=>
      visible(popup)&&(!ignoreMenusOutside||!menuOutside(popup,ignoreMenusOutside)));
  }
  function clearStandby(returnFocus){
    if(!standby)return;
    const {editor,path,origin}=standby;
    standby=null;
    inputResize.disconnect();
    if(returnFocus&&document.activeElement===editor){
      if(returnFocus==='origin'&&origin===binding?.scroll&&visible(origin))origin.focus({preventScroll:true});
      if(document.activeElement===editor)editor.blur();
    }
    editor.removeAttribute(inputAttr);
    for(const property of inputBox)editor.style.removeProperty(property);
    for(const node of path)node.removeAttribute(inputPath);
  }
  function positionStandby(){
    if(!standby||!['minimize','hide'].includes(folded))return;
    const {shell,editor}=binding,base=shell.getBoundingClientRect();
    const layout=[base.width,base.height,innerWidth,innerHeight,devicePixelRatio,binding.status?.row];
    if(layout.every((value,index)=>value===standby.layout?.[index]))return;
    standby.layout=layout;
    // Read the native expanded geometry without painting or replacing the editor.
    // An IME can ask for the old caret bounds before the renderer sees its first key.
    shell.setAttribute(measureAttr,'');
    const bounds=editor.getBoundingClientRect();
    shell.removeAttribute(measureAttr);
    if(!bounds.width||!bounds.height)return;
    const css=getComputedStyle(shell);
    const values=[
      bounds.left-base.left-parseFloat(css.borderLeftWidth),
      base.bottom-bounds.bottom-parseFloat(css.borderBottomWidth),
      bounds.width,bounds.height
    ];
    for(const [index,property] of inputBox.entries())editor.style.setProperty(property,values[index]+'px');
  }
  function prepareInput(){
    if(!binding||!foldedOrClosing())return;
    const {editor,scroll,root,track}=binding,active=document.activeElement;
    if(!standby&&(!document.hasFocus()||document.getSelection()?.isCollapsed===false
      ||![scroll,document.body,document.documentElement].includes(active)))return;
    const available=main(root)&&editor.matches('[contenteditable="true"],textarea:not([readonly]):not(:disabled)')
      &&!editor.closest('[hidden],'+inactive)&&!overlayOpen();
    if(standby){
      if(available&&active===editor&&standby.editor===editor&&standby.path.at(-1)===track
        &&standby.path.every((node,index)=>node===(standby.path[index-1]||editor).parentElement)){
        positionStandby();return;
      }
      clearStandby('blur');
      return;
    }
    if(!available)return;
    const path=[];
    for(let node=editor.parentElement;node;node=node.parentElement){
      path.push(node);
      if(node!==track)continue;
      // Windows IME needs the original editable focused before the first keystroke.
      // Keep only its DOM path rendered and the caret at the expanded position.
      standby={editor,path,origin:active};
      for(const part of path)part.setAttribute(inputPath,'');
      editor.setAttribute(inputAttr,'');
      positionStandby();
      editor.focus({preventScroll:true});
      if(document.activeElement!==editor)clearStandby();
      else inputResize.observe(binding.shell);
      return;
    }
  }
  function armSidebarFocus(event){
    if(!event.isTrusted||event.defaultPrevented||event.detail===0||event.button!==0||event.pointerType&&event.pointerType!=='mouse'
      ||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||composing)return;
    const target=event.composedPath()[0],button=target instanceof Element?target.closest('button'):null;
    if(!button?.hasAttribute('data-interactive-row-button')||button.matches(':disabled,[aria-disabled="true"]'))return;
    const row=button.closest(sidebarRow);
    if(!row)return;
    sidebarClick={row,button,key:row.getAttribute(rowId),from:threadId??find()?.id,expires:performance.now()+sidebarTimeout};
    schedule();
  }
  function sidebarMatches(row,id){
    const raw=row.getAttribute(rowId);
    if(raw===`local:${id}`)return true;
    const prefix='local:client-new-thread:',alias=raw?.slice(prefix.length);
    if(!raw?.startsWith(prefix)||!uuid.test(alias))return false;
    // A saved chat may still have a temporary sidebar ID. Match its owning local component only.
    const key=Object.getOwnPropertyNames(row).find(name=>name.startsWith('__reactFiber$'));
    const owners=new Set();
    for(let fiber=key?row[key]:null,depth=0;fiber&&depth<12;fiber=fiber.return,depth++){
      const props=fiber.memoizedProps,actual=props?.conversationId;
      if(props?.rowRef?.current===row&&props.hostId==='local'&&!props.isCodexCloudTask
        &&typeof actual==='string'&&uuid.test(actual)&&actual!==alias)owners.add(actual);
    }
    return owners.size===1&&owners.has(id);
  }
  function matchingSidebarClick(){
    if(!sidebarClick)return null;
    const {row,button,key,expires}=sidebarClick,{id,scroll}=binding;
    if(performance.now()>expires||!row.contains(button)||row.getAttribute(rowId)!==key){
      sidebarClick=null;return null;
    }
    return scroll.hasAttribute('tabindex')&&visible(scroll)&&sidebarMatches(row,id)?sidebarClick:null;
  }
  function handoffSidebarFocus(){
    const click=matchingSidebarClick();
    if(!click||document.activeElement!==click.button||click.row.getAttribute(rowActive)!=='true'
      ||!visible(click.button)||overlayOpen())return;
    sidebarClick=null;
    binding.scroll.focus({preventScroll:true});
  }
  function canFold(allowedFocus,keepClosing=false){
    const active=document.activeElement;
    return !composing&&(!binding.root.contains(active)||active===allowedFocus||active===standby?.editor)&&!active?.closest('#codex-composer-hud')
      &&!binding.root.querySelector('[aria-expanded="true"]')&&!overlayOpen(keepClosing?binding.root:null);
  }
  function updatePillSurface(){
    const background=getComputedStyle(binding.body.parentElement).backgroundColor;
    pill.style.setProperty('--bc-composer-surface',background==='rgba(0, 0, 0, 0)'?'':background);
  }
  function relativeCenter(element,shell){
    const rect=element.getBoundingClientRect(),bounds=shell.getBoundingClientRect();
    return rect.width&&rect.height?[rect.left+rect.width/2-bounds.left,rect.top+rect.height/2-bounds.bottom]:null;
  }
  function shift(from,base){
    return from&&base?`translate(${from[0]-base[0]}px,${from[1]-base[1]}px)`:'none';
  }
  function transition(next){
    const {shell,track,status,body}=binding;
    if(folded===next)return;
    if(reduced.matches){commit(next);return;}
    const start=shell.getBoundingClientRect().height,previous=folded;
    const surface=status?body:track;
    const current=getComputedStyle(surface),currentScale=current.scale,currentOpacity=current.opacity,miniOpacity=getComputedStyle(pill).opacity;
    const badgeFrom=status&&relativeCenter(status.layer,shell),pillFrom=status&&relativeCenter(pill,shell);
    if(previous==='open')updatePillSurface();
    commit(next);
    const end=shell.getBoundingClientRect().height;
    const badgeTo=status&&relativeCenter(status.layer,shell),pillTo=status&&relativeCenter(pill,shell);
    const mini=next==='minimize'||previous==='minimize';
    pill.hidden=!mini;
    const scale=mini?Math.min(1,pill.getBoundingClientRect().width/Math.max(1,shell.getBoundingClientRect().width)):.96;
    shell.setAttribute(stateAttr,'moving');track.setAttribute(trackAttr,'');
    shell.toggleAttribute('data-bc-fold-closing',next!=='open');
    const options={duration:next==='open'?220:150,easing:'cubic-bezier(.22,.75,.25,1)',fill:'both'};
    const startingVisible=previous==='open'||previous==='opening'||previous==='closing';
    const motion=shell.animate([{height:start+'px'},{height:end+'px'}],options);
    animation=[motion,surface.animate([
      {scale:startingVisible?currentScale:scale+' 1',opacity:startingVisible?currentOpacity:0},
      {scale:next==='open'?'1 1':scale+' 1',opacity:next==='open'?1:0}
    ],options)];
    if(status){
      const badgeBase=relativeCenter(status.layer,shell);
      if(badgeFrom&&badgeTo&&badgeBase)animation.push(status.row.animate([
        {transform:shift(badgeFrom,badgeBase)},{transform:shift(badgeTo,badgeBase)}
      ],options));
    }
    if(mini){
      const pillBase=status&&relativeCenter(pill,shell);
      animation.push(pill.animate([
        {opacity:previous==='minimize'?1:previous==='opening'||previous==='closing'?miniOpacity:0,transform:shift(pillFrom||pillTo,pillBase)},
        {opacity:next==='minimize'?1:0,transform:shift(pillTo||pillFrom,pillBase)}
      ],options));
    }
    folded=next==='open'?'opening':'closing';
    motion.onfinish=()=>{if(animation[0]===motion){commit(next);prepareInput();}};
  }
  function check(){
    frame=0;if(mode==='off')return;
    reconcile();prepareInput();
  }
  function reconcile(){
    const next=find(foldedOrClosing());
    if(!next||!ready(next)){
      if(next?.id!==threadId)threadId=null;
      detach();return;
    }
    const entering=next.id!==threadId;
    // Codex can keep the previous transcript mounted while switching the composer to the next ID.
    if(entering&&next.scroll.querySelector('[data-turn-key] [data-response-update-thread]')
      &&!next.scroll.querySelector('[data-turn-key] [data-response-update-thread="'+next.id+'"]')){detach();return;}
    threadId=next.id;
    if(next.root!==binding?.root||next.id!==binding?.id||next.track!==binding?.track){
      detach();bind(next);pill.hidden=true;binding.shell.append(pill);
    }else bind(next);
    if(!pill.isConnected)binding.shell.append(pill);
    const label=window.__codexHudI18n.t('expandComposer');
    if(pillLabel.textContent!==label){pillLabel.textContent=label;pill.title=window.__codexHudI18n.t('composerFoldShortcut');}
    const sent=confirmSend(next);
    const active=document.activeElement;
    if(sent&&safe(binding)&&canFold(active===sent.button?sent.button:binding.editor)){
      if(active===binding.editor||active===sent.button)active.blur();
      transition(mode);return;
    }
    if(!safe(binding,foldedOrClosing())){
      clearStandby('origin');commit('open');resetKeys();return;
    }
    // Native navigation may preserve or restore the caret before the destination is ready.
    // Only override that focus for a matching mouse switch, never after user input.
    const click=active===next.editor?matchingSidebarClick():null;
    const restoredFocus=click&&click.from!==next.id;
    if((entering||restoredFocus)&&canFold(restoredFocus?next.editor:undefined)){
      if(restoredFocus){
        sidebarClick=null;
        next.scroll.focus({preventScroll:true});
        if(next.root.contains(document.activeElement))return;
      }
      if(mode==='minimize')updatePillSurface();
      commit(mode);handoffSidebarFocus();return;
    }
    if(folded==='closing'){if(!canFold(undefined,true))transition('open');else handoffSidebarFocus();return;}
    if(folded==='minimize'||folded==='hide'){if(folded!==mode)transition(mode);handoffSidebarFocus();return;}
    if(canFold()){transition(mode);handoffSidebarFocus();}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(check);}
  function wake(immediate=false){
    const latest=find();
    if(!binding||latest?.root!==binding.root||latest?.id!==binding.id||latest.track!==binding.track||!ready(latest)
      ||immediate&&latest.editor!==standby?.editor){detach();return false;}
    if(overlayOpen()){clearStandby('blur');return false;}
    sendAttempt=null;bind(latest);
    if(immediate)commit('open');else transition('open');
    if(document.activeElement!==binding.editor)binding.editor.focus({preventScroll:true});
    return true;
  }
  const consume=event=>{event.preventDefault();event.stopImmediatePropagation();};
  const plainKey=event=>!event.defaultPrevented&&!event.isComposing&&event.keyCode!==229&&!composing
    &&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey;
  function foldOnEscape(event){
    const active=document.activeElement;
    if(!event.isTrusted||!plainKey(event)||event.repeat||!binding||active!==binding.editor||!['open','opening'].includes(folded))return;
    const next=find();
    if(!next||next.root!==binding.root||next.id!==binding.id||next.track!==binding.track
      ||next.editor!==active||!ready(next)||!safe(next)||!canFold(active))return;
    bind(next);
    escapeHeld=true;consume(event);
    active.blur();
    transition(mode);
    prepareInput();
  }
  const inputKeys=event=>event.isComposing||event.keyCode===229||event.key==='Process'||event.key==='Dead'
    ||event.key.length===1&&event.key!==' '&&(!event.altKey&&!event.ctrlKey&&!event.metaKey||event.getModifierState('AltGraph'));
  function standbyEvent(event){
    return standby&&event.isTrusted&&standby.editor===event.composedPath()[0]&&document.activeElement===standby.editor;
  }
  function keydown(event){
    sidebarClick=null;
    if(escapeHeld&&event.key==='Escape'){consume(event);return;}
    const parked=standbyEvent(event);
    if(parked&&!event.defaultPrevented){
      if(inputKeys(event)){enterAt=-Infinity;wake(true);return;}
      if(event.key==='Tab'||event.key===' '||event.key==='Escape'||/^(?:Arrow(?:Up|Down|Left|Right)|Page(?:Up|Down)|Home|End)$/.test(event.key)){
        enterAt=-Infinity;clearStandby('origin');return;
      }
    }
    if(event.key==='Escape'){enterAt=-Infinity;foldOnEscape(event);return;}
    if(swallow&&event.key==='Enter'&&event.repeat){consume(event);return;}
    if(event.key==='Enter')armSend(event);
    const target=event.composedPath()[0],inside=parked||target===document.body||target===document.documentElement
      ||(target instanceof Element&&binding?.scroll.contains(target)&&(!target.closest(interactive)||target===binding.scroll));
    if(event.key!=='Enter'||!plainKey(event)
      ||!inside||!binding||!foldedOrClosing()||overlayOpen()){
      if(parked&&event.key==='Enter'&&!event.defaultPrevented)consume(event);
      enterAt=-Infinity;return;
    }
    if(parked)consume(event);
    if(event.repeat||pressed){enterAt=-Infinity;return;}
    pressed=true;
    const now=performance.now();
    if(now-enterAt<=doubleEnter){
      enterAt=-Infinity;
      if(wake()){swallow=true;consume(event);}
    }else enterAt=now;
  }
  function keyup(event){
    if(event.key==='Escape'&&escapeHeld){escapeHeld=false;consume(event);}
    if(event.key==='Enter'){pressed=false;if(swallow){swallow=false;consume(event);}}
  }
  const observer=new MutationObserver(records=>{
    const native=records.filter(record=>record.target!==pill&&!pill.contains(record.target));
    if(!native.length)return;
    // Navigation can commit during an animation frame; reconcile identity changes before paint.
    if(sendAttempt||!binding?.root.isConnected||native.some(record=>entryAttributes.includes(record.attributeName)
      ||sidebarClick&&(record.attributeName===rowActive||record.attributeName===rowId)
      ||record.type==='childList'&&(record.target===binding.root||record.target===binding.shell))){
      cancelAnimationFrame(frame);check();
    }else schedule();
  });
  function start(){
    document.head.append(style);listeners=new AbortController();
    const on=(target,type,fn)=>target.addEventListener(type,fn,{capture:true,signal:listeners.signal});
    on(window,'keydown',keydown);on(window,'keyup',keyup);
    on(window,'focus',schedule);
    on(document,'focusin',event=>{
      const target=event.target;
      if(target===standby?.editor)return;
      clearStandby();
      if(sidebarClick&&target!==sidebarClick.button
        &&!(target instanceof Element&&target.matches('[data-codex-composer="true"],.thread-scroll-container')&&main(target)))sidebarClick=null;
      enterAt=-Infinity;schedule();
    });
    on(document,'focusout',schedule);
    on(document,'beforeinput',event=>{if(standbyEvent(event)&&event.inputType?.startsWith('insert'))wake(true);});
    on(document,'paste',event=>{if(standbyEvent(event))wake(true);});
    on(document,'input',event=>{
      if(event.isTrusted){
        sidebarClick=null;
        if(event.inputType?.startsWith('insert'))sendAttempt=null;
      }
      schedule();
    });on(document,'click',event=>{armSend(event);armSidebarFocus(event);});
    on(document,'pointerdown',event=>{
      enterAt=-Infinity;sidebarClick=null;
      if(sendAttempt&&!event.composedPath().includes(sendAttempt.root))sendAttempt=null;
      schedule();
    });on(document,'pointerup',schedule);
    on(document,'compositionstart',event=>{
      composing=true;sidebarClick=null;resetKeys();
      if(standbyEvent(event))wake(true);
      schedule();
    });on(document,'compositionend',()=>{composing=false;schedule();});
    on(window,'blur',event=>{
      if(event.target===standby?.origin)return;
      composing=false;
      if(event.target===window){sidebarClick=null;escapeHeld=false;}
      resetKeys();
    });on(window,'resize',schedule);on(window,'languagechange',schedule);
    on(reduced,'change',()=>{if(binding&&animation.length)commit(folded==='opening'?'open':mode);});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:[
      ...entryAttributes,rowActive,rowId,'data-response-update-thread',
      'data-empty-paragraph','data-composer-expanded','data-state','aria-label','aria-expanded','aria-hidden','inert','hidden','data-aria-hidden','data-inert-ed'
    ]});
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
    schedule();
  }
  function stop(){
    listeners?.abort();listeners=null;observer.disconnect();cancelAnimationFrame(frame);frame=0;
    composing=false;threadId=null;sendAttempt=null;sidebarClick=null;escapeHeld=false;detach();style.remove();
  }
  pill.addEventListener('click',()=>wake());
  window.__codexComposerFold={
    update(value,afterSend=false){
      const next=['minimize','hide'].includes(value)?value:'off';
      const afterSendChanged=foldAfterSend!==(afterSend===true);
      if(!afterSendChanged&&mode===next)return;
      mode=next;
      foldAfterSend=afterSend===true;
      if(!foldAfterSend)sendAttempt=null;
      if(next==='off')stop();else if(!listeners)start();else schedule();
    },
    hides(root){return binding?.root===root&&folded!=='open';},
    remove(){stop();delete window.__codexComposerFold;}
  };
})();
