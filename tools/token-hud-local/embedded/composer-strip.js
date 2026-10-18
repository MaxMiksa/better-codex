// Page-only view. Receives whitelisted metadata; never reads the editor or messages.
(() => {
  if (window.__codexComposerHud) return false;
  const host = document.createElement('div');
  host.id = 'codex-composer-hud';
  host.style.cssText = 'position:fixed;width:max-content;pointer-events:none;z-index:20;transform:translateX(-50%);color:var(--color-text-tertiary,#a8a8a8);';
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = `<style>
    section{display:flex;align-items:center;justify-content:center;white-space:nowrap}
    #metrics{display:flex;align-items:center;gap:10px;padding:0;margin:0;border:0;background:none;color:inherit;font:inherit;letter-spacing:inherit;cursor:pointer;pointer-events:auto}
    #metrics:focus-visible{outline:2px solid currentColor;outline-offset:4px;border-radius:3px}i{font-style:inherit}
    #width-panel{position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);width:280px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:14px 16px 12px;border:1px solid var(--color-border,#666);border-radius:12px;background:var(--color-surface,#292929);box-shadow:0 8px 28px #0003;pointer-events:auto;font-size:13px;line-height:20px}
    #width-panel[hidden]{display:none}.heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}output{font-variant-numeric:tabular-nums}
    input{display:block;box-sizing:border-box;width:100%;height:20px;margin:0;background:transparent;color:inherit;cursor:ew-resize;appearance:none}
    input::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:color-mix(in srgb,currentColor 25%,transparent)}
    input::-webkit-slider-thumb{appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:currentColor}
    input:focus-visible{outline:1px solid currentColor;outline-offset:3px;border-radius:4px}
  </style><section><button id="metrics" type="button" title="调整正文宽度" aria-haspopup="dialog" aria-expanded="false" aria-controls="width-panel"><span>— tok/s</span><i>·</i><span>—%</span><i>·</i><span>等待统计</span></button></section>
  <div id="width-panel" role="dialog" aria-label="正文宽度" hidden><div class="heading"><label for="width-range">正文宽度</label><output for="width-range">1152 px</output></div><input id="width-range" type="range" min="768" max="1600" step="16" value="1152"></div>`;
  const metrics = shadow.querySelector('#metrics'), panel = shadow.querySelector('#width-panel');
  const range = shadow.querySelector('input'), output = shadow.querySelector('output');
  const fields = metrics.querySelectorAll('span');
  let pendingWidth = null, widthRevision = 0;
  function showWidth(value) { range.value=String(value);output.textContent=value===768?'默认':`${value} px`;range.setAttribute('aria-valuetext',value===768?'默认宽度':`${value} 像素`); }
  function closePanel(focus=false) { panel.hidden=true;metrics.setAttribute('aria-expanded','false');if(focus)metrics.focus({preventScroll:true}); }
  metrics.addEventListener('click',()=>{
    if(!panel.hidden){closePanel();return;}
    panel.hidden=false;metrics.setAttribute('aria-expanded','true');layout();if(!panel.hidden)range.focus({preventScroll:true});
  });
  range.addEventListener('input',()=>{
    const value=Number(range.value);pendingWidth={value,revision:++widthRevision};showWidth(value);
    window.__codexReadingWidth?.preview(value);
  });
  const outside = event => { if(!event.composedPath().includes(host))closePanel(); };
  const escape = event => { if(event.key==='Escape' && !panel.hidden){event.preventDefault();event.stopPropagation();closePanel(true);} };
  document.addEventListener('pointerdown',outside,true);
  window.addEventListener('keydown',escape,true);
  window.addEventListener('keyup',escape,true);
  window.addEventListener('blur',closeOnBlur);
  function closeOnBlur(){closePanel();}
  let key = '', generation = 0, updated = 0, disposed = false;
  let resolved = null;
  let compatibility = {status:'pending',reason:'awaiting-chat'};
  const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden'; };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function refuse(reason) { compatibility={status:'pending',reason}; return null; }
  function chat() {
    const roots=[...document.querySelectorAll('[data-codex-composer-root]')].filter(visible);
    if(roots.length!==1)return refuse('ambiguous-or-missing-composer');
    // This metadata node may have zero height. Its owning composer determines visibility.
    const markers=[...roots[0].querySelectorAll('[data-above-composer-conversation-id]')];
    if(markers.length){
      const ids=[...new Set(markers.map(e=>e.getAttribute('data-above-composer-conversation-id')))];
      if(ids.length!==1)return refuse('ambiguous-composer-chat');
      const id=ids[0];
      if(!uuid.test(id || ''))return refuse('invalid-composer-chat-id');
      return {raw:'local:'+id,title:''};
    }
    const rows = [...document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')].filter(visible);
    if (rows.length!==1) return refuse('ambiguous-or-missing-chat');
    const row=rows[0], raw=row.getAttribute('data-app-action-sidebar-thread-id') || '';
    if (row.getAttribute('data-app-action-sidebar-thread-kind')!=='local' || row.getAttribute('data-app-action-sidebar-thread-host-id')!=='local') return refuse('unsupported-chat');
    return {raw,title:row.getAttribute('data-app-action-sidebar-thread-title') || ''};
  }
  function context() {
    const selected=chat();if(!selected)return null;
    const {raw,title}=selected;
    let id=/^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)?raw.slice(6):null;
    if(!id && resolved?.raw===raw && resolved.title===title && Date.now()-resolved.at<1500)id=resolved.id;
    if(!id)return refuse('awaiting-persistent-chat-id');
    const roots=[...document.querySelectorAll('[data-codex-composer-root]')].filter(visible);
    if (roots.length!==1) return refuse('ambiguous-or-missing-composer');
    const root=roots[0], bounds=root.getBoundingClientRect();
    const editors=[...root.querySelectorAll('[contenteditable="true"],textarea')].filter(visible);
    if (editors.length!==1) return refuse('unknown-editor-contract');
    const buttons=[...root.querySelectorAll('button,[role="button"],select')].filter(visible);
    const controls=buttons.map(e=>e.getBoundingClientRect());
    if (controls.length<2) return refuse('missing-composer-controls');
    const bottom=Math.max(...controls.map(r=>(r.top+r.bottom)/2));
    const rowControls=controls.filter(r=>Math.abs((r.top+r.bottom)/2-bottom)<12);
    if (rowControls.length<2 || bottom<editors[0].getBoundingClientRect().bottom-3) return refuse('unknown-footer-contract');
    const x=(bounds.left+bounds.right)/2;
    // Match label typography; keep the muted theme color independent of menu state.
    const labels=buttons.filter(e=>{const r=e.getBoundingClientRect();return r.left>x && Math.abs((r.top+r.bottom)/2-bottom)<12;}).sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left);
    let reference;
    for(const button of labels){
      const walker=document.createTreeWalker(button,NodeFilter.SHOW_TEXT);
      let node;
      while((node=walker.nextNode())){
        if(node.textContent.trim().length>1 && /[\p{L}\p{N}]/u.test(node.textContent) && !node.parentElement.closest('svg') && visible(node.parentElement)){reference=node.parentElement;break;}
      }
      if(reference)break;
    }
    if(!reference)return refuse('missing-footer-label-style');
    const style=getComputedStyle(reference);
    for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing'])host.style[property]=style[property];
    if(!host.isConnected)document.body.append(host);
    host.style.visibility='hidden';host.hidden=false;
    const size=host.getBoundingClientRect(), y=bottom-size.height/2;
    const candidate={left:x-size.width/2,right:x+size.width/2,top:y,bottom:y+size.height};
    if (candidate.left<bounds.left+12 || candidate.right>bounds.right-12 || candidate.top<bounds.top || candidate.bottom>bounds.bottom || candidate.bottom>innerHeight || candidate.top<0) return refuse('insufficient-space');
    if (controls.some(r=>r.left<candidate.right+12 && r.right>candidate.left-12 && r.top<candidate.bottom+4 && r.bottom>candidate.top-4)) return refuse('controls-overlap');
    compatibility={status:'compatible',reason:'composer-contract-passed'};
    return {id,x,y};
  }
  function clear() { ['— tok/s','—%','等待统计'].forEach((s,i)=>{fields[i].textContent=s;}); updated=0; }
  function layout() {
    if (disposed) return null;
    const current=context(), next=current?.id || '';
    if (key!==next) { key=next; generation++; clear();closePanel(); }
    if (!current) { host.hidden=true;closePanel(); return null; }
    if (!host.isConnected) document.body.append(host);
    host.style.left=current.x+'px';host.style.top=current.y+'px';host.style.visibility='visible';host.hidden=false;
    if(!panel.hidden){
      panel.style.marginLeft='0px';
      const bounds=panel.getBoundingClientRect();
      panel.style.marginLeft=(bounds.left<12?12-bounds.left:bounds.right>innerWidth-12?innerWidth-12-bounds.right:0)+'px';
      if(bounds.top<8)closePanel();
    }
    return current;
  }
  const timer=setInterval(()=>{layout();if(updated && Date.now()-updated>3000)clear();},250);
  const observer=new MutationObserver(records=>{if(records.some(r=>r.target!==host && !host.contains(r.target)))layout();});
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-above-composer-conversation-id','data-app-action-sidebar-thread-active','data-app-action-sidebar-thread-id','aria-hidden']});
  window.addEventListener('resize',layout);
  window.__codexComposerHud={
    readingRequest(){return pendingWidth;},
    readingAck(value){if(pendingWidth?.revision===value.revision){pendingWidth=null;window.__codexReadingWidth?.settle(value.value);}},
    readingState(value){if(!pendingWidth && Number.isInteger(value?.maxWidth))showWidth(value.maxWidth);},
    bindingRequest(){layout();const selected=chat();return selected && selected.raw.startsWith('local:client-new-thread:')?{...selected,generation}:null;},
    bind(value){const selected=chat();if(!selected || value.raw!==selected.raw || value.title!==selected.title || value.generation!==generation)return false;resolved={...value,at:Date.now()};layout();return true;},
    snapshot(){const current=layout();return {id:current?.id || null,generation,visible:host.isConnected&&!host.hidden,compatibility};},
    render(value){const current=layout();if(!current || value.id!==current.id || value.generation!==generation)return false;[value.speed,value.cache,value.age].forEach((s,i)=>{fields[i].textContent=String(s);});updated=Date.now();return Boolean(layout());},
    remove(){disposed=true;clearInterval(timer);observer.disconnect();window.removeEventListener('resize',layout);window.removeEventListener('blur',closeOnBlur);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('keydown',escape,true);window.removeEventListener('keyup',escape,true);host.remove();delete window.__codexComposerHud;}
  };
  layout();return true;
})()
