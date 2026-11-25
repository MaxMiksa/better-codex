// Own the file tree, not the native file viewer. The only layout adapter is
// the active chat's toolbar and horizontal content lane.
(() => {
  if(window.__codexWorkspaceTree)return;
  const triggerHost=document.createElement('span'),pane=document.createElement('aside');
  triggerHost.dataset.bcWorkspaceTreeTrigger='';
  pane.dataset.bcWorkspaceTree='';pane.id='bc-workspace-tree';pane.hidden=true;
  triggerHost.style.cssText='display:inline-flex;flex:none;pointer-events:auto;-webkit-app-region:no-drag';
  pane.style.cssText='box-sizing:border-box;flex:0 0 min(280px,38%);min-width:0;min-height:0;align-self:stretch';
  const triggerRoot=triggerHost.attachShadow({mode:'open'}),shadow=pane.attachShadow({mode:'open'});
  const icon=body=>'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+body+'</svg>';
  const folder=icon('<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>');
  const file=icon('<path d="M6 3h8l4 4v14H6zM14 3v5h4"/>');
  const tree=icon('<path d="M3 4h5l2 2h4v5H5a2 2 0 0 1-2-2Zm3 7v7h5m0-2h7l2 2v3h-9z"/>');
  const chevron=icon('<path d="m9 5 7 7-7 7"/>');
  const x=icon('<path d="m6 6 12 12M18 6 6 18"/>');
  const controlCss='button{font:inherit;color:inherit;border:0;background:none;padding:0;cursor:pointer;-webkit-app-region:no-drag}button:where(:hover,[aria-expanded="true"].icon){background:var(--bc-tree-hover,color-mix(in srgb,currentColor 9%,transparent))}button:focus-visible{outline:1px solid var(--codex-base-accent,currentColor);outline-offset:-2px}.icon{display:grid;place-items:center;width:28px;height:28px;flex:none;border-radius:7px}';
  const make=(tag,cls,html)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(html)e.innerHTML=html;return e;};
  const trigger=make('button','icon',tree);trigger.type='button';trigger.setAttribute('aria-expanded','false');
  const triggerStyle=make('style');triggerStyle.textContent=controlCss;triggerRoot.append(triggerStyle,trigger);
  const style=make('style');style.textContent=`
    :host{display:block;color:var(--color-text-primary,var(--color-text,currentColor))}
    :host([hidden]){display:none!important}
    .surface{display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;
      border-inline-start:1px solid var(--color-border-primary,color-mix(in srgb,currentColor 13%,transparent));
      background:var(--color-background-elevated,var(--color-token-side-bar-background,transparent));
      font:400 13px/1.35 var(--font-sans,"Segoe UI",sans-serif)}
    header{min-height:39px;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;flex:none;
      border-bottom:1px solid var(--color-border-primary,color-mix(in srgb,currentColor 13%,transparent))}
    .name,.label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .name{flex:1;font-weight:600}
    .list{min-height:0;overflow:auto;overscroll-behavior:contain;flex:1;padding:5px 5px 8px;scrollbar-width:thin}
    .row{min-height:26px;width:100%;box-sizing:border-box;display:flex;align-items:center;gap:6px;text-align:start;
      padding-inline-end:6px;padding-inline-start:calc(5px + min(var(--depth),14)*12px);border-radius:5px}
    .row svg,.symbol svg{display:block;flex:none;opacity:.75}
    .chevron{width:12px;flex:0 0 12px}
    .chevron svg{width:12px;height:12px}
    [aria-expanded="true"]>.chevron svg{transform:rotate(90deg)}
    .message{padding:9px 8px;font:inherit}
    `+controlCss;
  const surface=make('div','surface'),header=make('header'),rootIcon=make('span','symbol',folder);
  const headerName=make('span','name');headerName.id='workspace-name';
  const closeButton=make('button','icon',x);closeButton.type='button';
  const list=make('div','list'),message=make('div','message');message.setAttribute('role','status');
  header.append(rootIcon,headerName,closeButton);surface.append(header,list);shadow.append(style,surface);
  const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const activeSelector='[data-app-shell-active-page="true"]';
  const toolbarSelector='[data-app-shell-main-titlebar] [data-app-shell-header-toolbar]';
  const composerSelector='[data-codex-composer-root]';
  const threadMarker='[data-above-composer-conversation-id]';
  const labelFor=key=>window.__codexHudI18n?.t?.('workspaceTree.'+key)??({title:'Workspace files',close:'Close workspace files',loading:'Loading…',unavailable:'Workspace unavailable',empty:'Empty folder',large:'Too many entries',limit:'Close another folder to expand this one'})[key];
  const visible=node=>node.getClientRects().length>0&&node.checkVisibility();
  const horizontal=node=>node&&['flex','inline-flex'].includes(getComputedStyle(node).display)&&getComputedStyle(node).flexDirection==='row';
  const rows=new Map(),expanded=new Set();
  let enabled=false,wantedOpen=false,threadId=null,token='',snapshot=null,lane=null,frame=0,disposed=false;
  function rotate(){
    token=crypto.randomUUID();snapshot=null;expanded.clear();rows.clear();list.replaceChildren();list.scrollTop=0;paint();
  }
  function layoutContract(){
    // The active-page scope can be display:contents (no box); its toolbar
    // and main lane below are the elements that must be visible.
    const pages=[...document.querySelectorAll(activeSelector)].filter(node=>!node.closest('[inert],[aria-hidden="true"]'));
    if(pages.length!==1)return null;
    const active=pages[0],bars=[...active.querySelectorAll(toolbarSelector)].filter(visible);
    const toolbar=bars.length===1?bars[0]:null,slot=toolbar?.lastElementChild;
    if(!horizontal(toolbar)||!horizontal(slot)||!slot.querySelector('button,[role="button"]'))return null;
    const composers=[...active.querySelectorAll(composerSelector)].filter(node=>
      !node.closest('[inert],[aria-hidden="true"],[data-right-panel-composer-overlay-content="true"]')&&
      (visible(node)||window.__codexComposerFold?.hides(node))&&
      node.closest('[data-app-shell-focus-area]')?.getAttribute('data-app-shell-focus-area')==='main'&&node.closest('[data-app-shell-main-surface]'));
    if(composers.length!==1)return null;
    const composer=composers[0],main=composer.closest('[data-app-shell-focus-area="main"]'),dock=main?.parentElement;
    if(!horizontal(dock)||!visible(main)||dock.getBoundingClientRect().width<520)return null;
    const ids=[...new Set([...composer.querySelectorAll(threadMarker)].map(node=>node.getAttribute('data-above-composer-conversation-id')))];
    if(ids.length!==1||!idPattern.test(ids[0]??''))return null;
    const id=ids[0];
    const matching=[...document.querySelectorAll('[data-app-action-sidebar-thread-id]')].filter(row=>{
      const key=row.getAttribute('data-app-action-sidebar-thread-id');
      return key===id||key?.endsWith(':'+id);
    });
    if(matching.some(row=>['data-app-action-sidebar-thread-kind','data-app-action-sidebar-thread-host-id']
      .some(name=>row.hasAttribute(name)&&row.getAttribute(name)!=='local')))return null;
    return {id,slot,dock,main};
  }
  function localize(){
    trigger.title=labelFor('title');trigger.setAttribute('aria-label',trigger.title);
    closeButton.title=labelFor('close');closeButton.setAttribute('aria-label',closeButton.title);pane.setAttribute('aria-label',trigger.title);
    if(!snapshot?.label)headerName.textContent=trigger.title;
  }
  function reconcile(){
    if(disposed)return;
    const next=enabled?layoutContract():null,id=next?.id??null;
    if(threadId!==id){threadId=id;rotate();}
    if(lane!==next?.dock){
      resize.disconnect();lane=next?.dock??null;if(lane)resize.observe(lane);
    }
    if(!next){
      triggerHost.remove();pane.remove();pane.hidden=true;return;
    }
    if(triggerHost.parentElement!==next.slot)next.slot.append(triggerHost);
    if(wantedOpen){
      if(pane.parentElement!==next.dock||pane.previousElementSibling!==next.main)next.main.after(pane);
      pane.hidden=false;
    }else{
      pane.hidden=true;pane.remove();
    }
    trigger.setAttribute('aria-expanded',String(wantedOpen));localize();
  }
  function toggle(open,focus=false){
    if(open===wantedOpen)return;
    wantedOpen=open;rotate();reconcile();if(focus&&triggerHost.isConnected)trigger.focus({preventScroll:true});
  }
  trigger.addEventListener('click',()=>toggle(!wantedOpen));
  closeButton.addEventListener('click',()=>toggle(false,true));
  shadow.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();toggle(false,true);}
  });
  function row(key,entry,depth){
    let node=rows.get(key);
    if(!node||Boolean(node.tagName==='BUTTON')!==entry.folder){
      node=make(entry.folder?'button':'div','row', '<span class="chevron">'+(entry.folder?chevron:'')+'</span>'+(entry.folder?folder:file));
      if(entry.folder){
        node.type='button';
        node.addEventListener('click',()=>{
          if(expanded.has(key)){
            for(const k of expanded)if(k===key||k.startsWith(key+'/'))expanded.delete(k);
          }else if(expanded.size<47)expanded.add(key);
          else{setMessage('limit');return;}
          paint();
        });
      }
      const label=make('span','label');label.textContent=entry.name;node.title=entry.name;node.append(label);rows.set(key,node);
    }
    node.style.setProperty('--depth',String(depth));
    if(entry.folder)node.setAttribute('aria-expanded',String(expanded.has(key)));
    return node;
  }
  function setMessage(key){message.textContent=labelFor(key);list.append(message);}
  function paint(){
    const label=snapshot?.label||labelFor('title');
    headerName.textContent=label;headerName.title=label;
    const dirs=new Map(snapshot?.dirs.map(dir=>[dir.key,dir])??[]),next=[],used=new Set(),focused=shadow.activeElement;
    const statusRow=(key,depth)=>{
      if(depth===0){message.textContent=labelFor(key);next.push(message);return;}
      const notice=make('div','message row');notice.textContent=labelFor(key);notice.style.setProperty('--depth',String(depth));next.push(notice);
    };
    function visit(key,depth){
      const result=dirs.get(key);
      if(!result||result.status!=='ready')return statusRow(result?.status??'loading',depth);
      if(!result.entries.length)return statusRow('empty',depth);
      for(const entry of result.entries){
        const child=key?key+'/'+entry.name:entry.name;
        next.push(row(child,entry,depth));used.add(child);
        if(entry.folder&&expanded.has(child))visit(child,depth+1);
      }
    }
    if(!snapshot||snapshot.status!=='ready')statusRow(snapshot?.status??'loading',0);
    else visit('',0);
    const keep=new Set(next);
    for(const child of [...list.children])if(!keep.has(child))child.remove();
    let position=list.firstChild;
    for(const node of next){
      if(position===node)position=position.nextSibling;
      else list.insertBefore(node,position);
    }
    for(const key of rows.keys())if(!used.has(key))rows.delete(key);
    for(const key of expanded)if(!used.has(key))expanded.delete(key);
    if(focused&&focused.isConnected&&shadow.activeElement!==focused)focused.focus({preventScroll:true});
  }
  const schedule=()=>{
    if(enabled&&!frame&&!disposed)frame=requestAnimationFrame(()=>{frame=0;reconcile();});
  };
  const resize=new ResizeObserver(schedule);
  const observer=new MutationObserver(records=>{
    if(records.some(record=>record.type==='attributes'||[...record.addedNodes,...record.removedNodes]
      .some(node=>node instanceof Element&&node!==pane&&node!==triggerHost&&
        (node.matches([activeSelector,toolbarSelector,composerSelector,threadMarker].join(','))||
          node.querySelector([activeSelector,toolbarSelector,composerSelector,threadMarker].join(','))))))schedule();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,
    attributeFilter:['data-app-shell-active-page','data-above-composer-conversation-id','inert','aria-hidden']});
  window.addEventListener('resize',schedule);
  window.__codexWorkspaceTree={
    setEnabled(value){
      if(enabled===(value===true))return;
      enabled=value===true;if(!enabled)wantedOpen=false;reconcile();
    },
    intent(){
      reconcile();return threadId&&wantedOpen?{open:true,threadId,token,expanded:[...expanded]}:null;
    },
    state(value){
      reconcile();
      if(!threadId||!wantedOpen||value?.token!==token)return;
      snapshot=value;paint();
    },
    workspace({threadId:id,token:requestToken}){
      reconcile();
      if(!wantedOpen||threadId!==id||token!==requestToken||typeof window.electronBridge?.sendMessageFromView!=='function')return null;
      return new Promise(resolve=>{
        const requestId='better-codex-workspace:'+crypto.randomUUID();
        const finish=value=>{clearTimeout(timer);window.removeEventListener('message',receive);resolve(value);};
        const receive=event=>{
          if(event.source!==window||event.origin!==location.origin)return;
          const data=event.data;
          if(data?.type!=='mcp-response'||data.hostId!=='local'||data.message?.id!==requestId)return;
          const native=data.message.result?.thread;
          reconcile();finish(!disposed&&wantedOpen&&threadId===id&&token===requestToken&&native?.id===id&&typeof native.cwd==='string'?native.cwd:null);
        };
        const timer=setTimeout(()=>finish(null),1800);window.addEventListener('message',receive);
        Promise.resolve().then(()=>window.electronBridge.sendMessageFromView({type:'mcp-request',hostId:'local',
          request:{id:requestId,method:'thread/read',params:{threadId:id,includeTurns:false}},timeoutMs:1500})).catch(()=>finish(null));
      });
    },
    remove(){
      disposed=true;observer.disconnect();resize.disconnect();cancelAnimationFrame(frame);
      window.removeEventListener('resize',schedule);triggerHost.remove();pane.remove();delete window.__codexWorkspaceTree;
    }
  };
})()
