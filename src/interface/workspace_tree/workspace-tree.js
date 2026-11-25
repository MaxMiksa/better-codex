// The native file tab owns the data, rendering, links, and filesystem lifecycle.
(() => {
  if(window.__codexWorkspaceTree)return;
  const activeSelector='[data-app-shell-active-page="true"]';
  const toolbarSelector='[data-app-shell-main-titlebar] [data-app-shell-header-toolbar]';
  const threadMarker='[data-above-composer-conversation-id]';
  const mainSelector='[data-app-shell-main-surface]';
  const layoutSelector='[data-app-shell-workspace-layout="split"][data-app-shell-right-panel-full-width="false"]';
  const nativePane='[role="tabpanel"][data-app-shell-tab-panel-controller="right"][data-tab-id="file:local:"]';
  const hostSelector='file-tree-container[data-file-tree-virtualized="true"]';
  const viewportSelector='[data-app-shell-pane-content-viewport="true"]';
  const changedLabels=new Set(['Changed files','已更改的文件','已變更的檔案','變更的檔案']);
  const allLabels=new Set(['All files','所有文件','所有檔案']);
  const summaryLabels=new Set(['All changes','所有更改','所有變更']);
  const emptyLabels=new Set(['Open file','打开文件','開啟檔案']);
  const visible=node=>node?.getClientRects().length>0&&node.checkVisibility()&&!node.closest('[inert],[aria-hidden="true"]');
  const single=(node,selector,test=()=>true)=>{
    const matches=[...node.querySelectorAll(selector)].filter(test);
    return matches.length===1?matches[0]:null;
  };
  const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const attr='data-bc-native-tree-layout';
  const triggerHost=document.createElement('span');
  triggerHost.dataset.bcWorkspaceTreeTrigger='';
  triggerHost.style.cssText='display:inline-flex;flex:none;pointer-events:auto;-webkit-app-region:no-drag';
  const shadow=triggerHost.attachShadow({mode:'open'});
  shadow.innerHTML='<style>button{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:7px;background:none;color:inherit;cursor:pointer;padding:0}button:where(:hover,[aria-expanded=true]){background:color-mix(in srgb,currentColor 9%,transparent)}button:focus-visible{outline:1px solid var(--codex-base-accent,currentColor);outline-offset:-2px}</style><button type="button" aria-expanded="false"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h5l2 2h4v5H5a2 2 0 0 1-2-2Zm3 7v7h5m0-2h7l2 2v3h-9z"/></svg></button>';
  const trigger=shadow.querySelector('button'),style=document.createElement('style');
  style.textContent='['+attr+'="hide"]{display:none!important}['+attr+'="fill"]{width:100%!important;max-width:none!important;flex:1 1 100%!important;border-inline-start:0!important}';
  document.head.append(style);
  let enabled=false,disposed=false,frame=0,session=null,failed=false;
  let paneObserver=new MutationObserver(schedule),treeObserver=new MutationObserver(schedule);

  function layout(){
    const page=single(document,activeSelector,n=>!n.closest('[inert],[aria-hidden="true"]'));
    if(!page)return null;
    const toolbar=single(page,toolbarSelector,visible),slot=toolbar?.lastElementChild;
    const main=single(page,mainSelector,visible);
    if(!slot||!visible(slot)||!slot.querySelector('button:not([data-bc-workspace-tree-trigger] button),[role="button"]')||!main)return null;
    if(!['flex','inline-flex'].includes(getComputedStyle(slot).display)||!single(main,layoutSelector,visible))return null;
    const ids=[...new Set([...main.querySelectorAll(threadMarker)]
      .filter(n=>!n.closest('[inert],[aria-hidden="true"],[data-app-shell-focus-area="right-panel"]'))
      .map(n=>n.getAttribute('data-above-composer-conversation-id')).filter(id=>idPattern.test(id??'')))];
    if(ids.length!==1)return null;
    const id=ids[0];
    if([...document.querySelectorAll('[data-app-action-sidebar-thread-id]')].some(row=>{
      const key=row.getAttribute('data-app-action-sidebar-thread-id');
      return (key===id||key?.endsWith(':'+id))&&['kind','host-id'].some(name=>{
        const value=row.getAttribute('data-app-action-sidebar-thread-'+name);
        return value!==null&&value!=='local';
      });
    }))return null;
    return {page,id,main,slot};
  }
  const same=(a,b)=>a&&b&&a.id===b.id&&a.page===b.page&&a.main===b.main;
  const findPane=scope=>single(scope.main,nativePane,n=>visible(n)&&n.closest('aside[data-app-shell-focus-area="right-panel"]'));
  const toggleNative=()=>window.dispatchEvent(new MessageEvent('message',{source:window,origin:location.origin,data:{type:'toggle-file-tree-panel'}}));
  function label(open){
    const t=window.__codexHudI18n?.t;
    trigger.title=failed&&!open?(t?.('workspaceTree.unavailable')??'Native workspace tree unavailable'):
      open?(t?.('workspaceTree.close')??'Close workspace files'):(t?.('workspaceTree.title')??'Workspace files');
    trigger.setAttribute('aria-label',trigger.title);
    trigger.setAttribute('aria-expanded',String(open));
  }

  function findSurface(pane){
    const host=single(pane,hostSelector);
    if(!host?.shadowRoot?.querySelector('[data-file-tree-id]'))return null;
    const viewport=host.closest(viewportSelector);
    if(!viewport||!pane.contains(viewport))return null;
    // Only compact the empty file browser whose native tree and empty
    // preview are sibling branches. Never style a real file tab.
    for(let nav=host.parentElement;nav&&nav!==viewport;nav=nav.parentElement){
      const group=nav.parentElement;
      if(group?.children.length!==2||nav!==group.lastElementChild)continue;
      const separator=single(nav,':scope > [role="separator"]');
      if(!separator)continue;
      const preview=group.firstElementChild;
      if(!single(preview,'h2',n=>emptyLabels.has(n.textContent.trim())))continue;
      if(!single(nav,'input:not([type="hidden"])'))return null;
      const header=viewport.parentElement?.children.length===2&&viewport===viewport.parentElement.lastElementChild&&
        viewport.previousElementSibling.classList.contains('shrink-0')?viewport.previousElementSibling:null;
      return {nav,preview,separator,header,host};
    }
    return null;
  }
  function mark(current,node,value){
    if(!node||node.getAttribute(attr)===value)return;
    node.setAttribute(attr,value);current.marked.add(node);
  }
  function clearMarks(current){
    for(const node of current.marked)node.removeAttribute(attr);
    current.marked.clear();
  }
  const baseRows='[role="treeitem"][data-item-type="folder"][aria-level="1"][data-item-path]';
  const findRow=(root,labels)=>single(root,baseRows,row=>{
    // The official truncation component duplicates text for visual measurement.
    // Match the accessible label and native root path, not raw textContent.
    const path=row.getAttribute('data-item-path').replace(/\/$/,'');
    return labels.has(path)&&labels.has(row.getAttribute('aria-label'));
  });
  function toggleFolder(row){
    // The native icon's click handler performs expansion and updates its own
    // virtual list. CSS alone cannot remove a tall virtualized changes group.
    const icon=row.querySelector('[data-item-section="icon"]');
    if(!icon)return false;
    icon.click();return true;
  }
  function restoreChanges(current){
    if(!current.collapsedByUs||!current.root?.host.isConnected)return;
    const row=findRow(current.root,changedLabels);
    if(row?.getAttribute('data-item-path')===current.changedPath&&row.getAttribute('aria-expanded')==='false')toggleFolder(row);
  }
  function clearTree(current,restore){
    paneObserver.disconnect();treeObserver.disconnect();
    current.groupStyle?.remove();
    clearMarks(current);
    if(restore)restoreChanges(current);
    current.root=null;current.groupStyle=null;current.surface=null;
    current.changedPath=null;current.collapsedByUs=false;current.expandedAll=false;
  }
  function release({restore=false,close=false}={}){
    if(!session)return;
    const current=session;session=null;clearTimeout(current.timer);
    const canClose=close&&current.pane&&same(current.scope,layout())&&findPane(current.scope)===current.pane;
    clearTree(current,restore);
    if(canClose)toggleNative();
  }
  function compact(current,surface){
    if(current.surface?.host!==surface.host||current.surface?.nav!==surface.nav){
      clearTree(current,true);
      current.surface=surface;current.root=surface.host.shadowRoot;
      paneObserver.observe(current.pane,{subtree:true,childList:true});
      treeObserver.observe(current.root,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-expanded']});
    }
    mark(current,surface.preview,'hide');mark(current,surface.nav,'fill');
    mark(current,surface.separator,'hide');mark(current,surface.header,'hide');
    for(const button of surface.nav.querySelectorAll('button,[role="button"]')){
      if(!summaryLabels.has(button.getAttribute('aria-label')??button.innerText?.trim()))continue;
      const group=button.closest('[class~="group/nav-list"]');
      if(group&&surface.nav.contains(group)&&!group.contains(surface.host))mark(current,group,'hide');
    }
    const all=findRow(current.root,allLabels),changed=findRow(current.root,changedLabels);
    if(changed){
      const path=changed.getAttribute('data-item-path');
      if(current.changedPath!==path){
        current.groupStyle?.remove();current.groupStyle=document.createElement('style');
        // Preserve virtual row geometry. Reveal the header if the user
        // reaches it with the native keyboard navigation.
        const match='[data-item-path='+CSS.escape(path)+']';
        current.groupStyle.textContent=match+':is([aria-expanded="false"],[data-file-tree-sticky-row]):not(:focus-within){opacity:0!important;pointer-events:none}';
        current.root.append(current.groupStyle);current.changedPath=path;
      }
      if(changed.getAttribute('aria-expanded')==='true'&&!current.collapsedByUs){
        current.collapsedByUs=toggleFolder(changed);
      }
    }
    if(all?.getAttribute('aria-expanded')==='false'&&!current.expandedAll){
      current.expandedAll=toggleFolder(all);
    }
  }
  function reconcile(){
    if(disposed)return;
    const scope=enabled?layout():null;
    if(session&&!same(session.scope,scope))release({restore:true});
    if(!scope){triggerHost.remove();return;}
    if(triggerHost.parentElement!==scope.slot){scope.slot.append(triggerHost);failed=false;}
    const pane=findPane(scope);
    if(session){
      if(session.pane&&session.pane!==pane)release({restore:true});
      if(session&&pane){
        if(!session.pane){
          clearTimeout(session.timer);session.pane=pane;
          paneObserver.observe(pane,{subtree:true,childList:true});
        }
        const surface=findSurface(pane);
        if(surface)compact(session,surface);
        else if(session.surface){
          clearTree(session,true);paneObserver.observe(pane,{subtree:true,childList:true});
        }
      }
    }
    label(Boolean(pane));
  }
  function schedule(){
    if(enabled&&!disposed&&!frame)frame=requestAnimationFrame(()=>{frame=0;reconcile();});
  }
  trigger.addEventListener('click',()=>{
    reconcile();
    const scope=enabled?layout():null;
    if(!scope)return;
    const pane=findPane(scope);
    if(pane){
      if(session?.pane)release({restore:true,close:true});
      else{release();toggleNative();}
      trigger.focus({preventScroll:true});schedule();return;
    }
    if(session)return; // Do not send two toggle messages during native mount.
    failed=false;session={scope,pane:null,marked:new Set()};
    session.timer=setTimeout(()=>{if(!session?.pane){release();failed=true;reconcile();}},2000);
    toggleNative();schedule();
  });
  const observed=[activeSelector,toolbarSelector,threadMarker,mainSelector,nativePane,layoutSelector].join(',');
  const pageObserver=new MutationObserver(records=>{
    if(records.some(record=>record.type==='attributes'||[...record.addedNodes,...record.removedNodes].some(node=>
      node instanceof Element&&node!==triggerHost&&(node.matches(observed)||node.querySelector(observed)))))schedule();
  });
  pageObserver.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:[
    'data-app-shell-active-page','data-app-shell-workspace-layout','data-app-shell-right-panel-full-width',
    'data-above-composer-conversation-id','data-app-shell-tab-panel-controller','data-tab-id','inert','aria-hidden','hidden','lang'
  ]});
  pageObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  window.addEventListener('resize',schedule);
  window.__codexWorkspaceTree={
    setEnabled(value){
      if(enabled===(value===true))return;
      enabled=value===true;
      if(!enabled)release({restore:true});
      failed=false;reconcile();
    },
    remove(){
      release({restore:true});disposed=true;pageObserver.disconnect();cancelAnimationFrame(frame);
      window.removeEventListener('resize',schedule);triggerHost.remove();style.remove();delete window.__codexWorkspaceTree;
    }
  };
})()
