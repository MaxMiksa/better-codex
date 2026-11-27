// Transient status and request bridge for AI naming; no draft or chat content is retained.
(() => {
  if(window.__codexAiRename)return;
  const fallback={running:'AI 正在整理会话…',success:'已重命名为 {title}',failed:'AI 重命名失败，已保留原名',noChat:'请先打开已保存的聊天',busy:'AI 重命名正在处理',
    unavailable:'无法读取聊天记录，已保留原名',changing:'聊天记录仍在更新，请稍后重试',noMessages:'没有可用于命名的用户消息',
    unconfirmed:'未能确认新标题是否已保存',batchAction:'批量 AI 重命名',batchChecking:'正在检查项目聊天…',
    batchProgress:'批量 AI 重命名：{finished}/{total}',batchNone:'当前项目没有需要重命名的聊天',
    batchDone:'已重命名 {renamed} 个，跳过 {skipped} 个，失败 {failed} 个',
    batchUnavailable:'无法核实项目聊天，已停止批量重命名'};
  const t=(key,values={})=>window.__codexHudI18n?.t?.(key,values)??(fallback[key.replace(/^aiRename\./,'')]||key).replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
  const style=document.createElement('style');style.id='better-codex-ai-rename-style';
  style.textContent=`[data-bc-ai-rename-root]{position:fixed;z-index:2147483002;display:flex;align-items:center;gap:8px;max-width:min(440px,calc(100vw - 24px));min-height:36px;padding:7px 12px;border:1px solid color-mix(in srgb,var(--color-border-primary,#ffffff24) 88%,transparent);border-radius:12px;background:color-mix(in srgb,var(--color-background-elevated,#2b2b2b) 94%,transparent);color:var(--color-text-primary,var(--color-text,currentColor));box-shadow:0 12px 34px #0006;font:500 13px/1.35 var(--font-sans,'Segoe UI',sans-serif);pointer-events:none;transform:translate(-50%,-100%)}
  [data-bc-ai-rename-root][hidden]{display:none!important}
  [data-bc-ai-rename-mark]{display:grid;place-items:center;flex:0 0 16px;width:16px;height:16px;color:var(--codex-base-accent,currentColor)}
  [data-bc-ai-rename-mark] svg{width:16px;height:16px}
  [data-bc-ai-rename-mark][data-spin] svg{animation:bc-ai-rename-spin .9s linear infinite}
  [data-bc-ai-rename-text]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @keyframes bc-ai-rename-spin{to{transform:rotate(360deg)}}`;
  document.head.append(style);
  const host=document.createElement('div');host.dataset.bcAiRenameRoot='';host.hidden=true;host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  const mark=document.createElement('span');mark.dataset.bcAiRenameMark='';
  const text=document.createElement('span');text.dataset.bcAiRenameText='';
  host.append(mark,text);document.body.append(host);
  const sparkle='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>';
  const spinner='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>';
  const jobs=new Map();
  let timer=0,projectResolving=false,disposed=false;
  function position(){
    const composers=[...document.querySelectorAll('[data-codex-composer-root]')].filter(element=>element.checkVisibility()&&element.getBoundingClientRect().width>0)
      .sort((a,b)=>b.getBoundingClientRect().top-a.getBoundingClientRect().top);
    const rect=composers[0]?.getBoundingClientRect();
    if(rect){
      host.style.left=Math.max(12,Math.min(innerWidth-12,rect.left+rect.width/2))+'px';
      host.style.top=Math.max(56,rect.top-10)+'px';
    }else{
      host.style.left='50%';host.style.top='calc(100vh - 112px)';
    }
  }
  function show(kind,message){
    if(timer)clearTimeout(timer);
    timer=0;
    host.hidden=false;host.dataset.state=kind;mark.innerHTML=kind==='running'?spinner:sparkle;
    mark.toggleAttribute('data-spin',kind==='running');text.textContent=message;position();
    if(kind!=='running')timer=setTimeout(()=>{
      timer=0;
      if(jobs.size)show('running',t('aiRename.running'));
      else host.hidden=true;
    },kind==='success'?4200:5200);
  }
  function available(){return Boolean(window.__codexComposerHud?.snapshot?.().id);}
  function arm(job){
    clearTimeout(job.timeout);
    job.timeout=setTimeout(()=>state({requestId:job.request.requestId,phase:'failed',
      reason:job.request.kind==='project'?'project-catalog':job.sent?'title-not-confirmed':'failed'}),180000);
  }
  function enqueue(data,message){
    const id='ai-rename:'+Date.now()+':'+Math.random().toString(36).slice(2);
    const job={sent:false,request:{...data,requestId:id,createdAt:Date.now()}};
    jobs.set(id,job);
    arm(job);
    show('running',message);
    try{window.__betterCodexRequestAiRename?.(id);}catch{} // the worker also polls as a fallback
    return true;
  }
  function requestFor(snapshot){
    if(typeof snapshot?.id!=='string'||!snapshot.id){show('failed',t('aiRename.noChat'));return false;}
    const threadKey=snapshot.id.toLowerCase();
    if([...jobs.values()].some(job=>job.request.threadId?.toLowerCase()===threadKey)){show('failed',t('aiRename.busy'));return false;}
    return enqueue({threadId:snapshot.id,generation:snapshot.generation},t('aiRename.running'));
  }
  function request(){return requestFor(window.__codexComposerHud?.snapshot?.());}
  function pull(id){
    // The binding claims one exact request; each fallback poll claims the oldest unsent one.
    const job=id===undefined?[...jobs.values()].find(job=>!job.sent):jobs.get(id);
    if(!job||job.sent)return null;
    job.sent=true;
    return job.request;
  }
  function state(value){
    const job=jobs.get(value?.requestId);
    if(!job)return;
    if(job.request.kind==='project'&&value.phase==='running'){
      arm(job);
      show('running',value.total?t('aiRename.batchProgress',value):t('aiRename.batchChecking'));
      return;
    }
    if(!['success','failed'].includes(value.phase))return;
    clearTimeout(job.timeout);
    jobs.delete(value.requestId);
    if(job.request.kind==='project'){
      if(value.phase==='success')
        show('success',value.total||value.skipped?t('aiRename.batchDone',value):t('aiRename.batchNone'));
      else if(value.reason==='busy')show('failed',t('aiRename.busy'));
      else show('failed',t('aiRename.batchUnavailable')+(value.finished?' · '+t('aiRename.batchDone',value):''));
      return;
    }
    if(value.phase==='success')show('success',t('aiRename.success',{title:value.title||''}));
    else{
      const message=value.reason==='transcript-unavailable'?t('aiRename.unavailable'):
        value.reason==='transcript-changed'?t('aiRename.changing'):
        value.reason==='empty'?t('aiRename.noMessages'):
        value.reason==='busy'?t('aiRename.busy'):
        value.reason==='title-not-confirmed'?t('aiRename.unconfirmed'):t('aiRename.failed');
      show('failed',message);
    }
  }
  const rowSelector='[data-app-action-sidebar-thread-id]';
  const projectSelector='[data-app-action-sidebar-project-row][data-app-action-sidebar-project-id]';
  const targetSelector=rowSelector+','+projectSelector;
  const uuid=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  const menuSelector='[role="menu"][data-state="open"]';
  const menuEntries='[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"]';
  const menuItems=new WeakMap();
  const menuEntriesFor=menu=>[...menu.querySelectorAll(menuEntries)]
    .filter(item=>item.closest('[role="menu"]')===menu&&!item.hasAttribute('data-bc-sidebar-ai-rename'));
  function fiberOf(element){
    const key=Object.getOwnPropertyNames(element).find(key=>key.startsWith('__reactFiber$'));
    return key?element[key]:null;
  }
  function projectScope(row){
    if(row.closest('[data-sidebar-project-kind]')?.getAttribute('data-sidebar-project-kind')!=='local')return null;
    const id=row.dataset.appActionSidebarProjectId;
    for(let fiber=fiberOf(row);fiber;fiber=fiber.return){
      const p=fiber.memoizedProps;
      // Use the native group's complete list, never the mounted rows or cwd.
      if(uuid.test(id??'')&&p?.group?.projectId===id&&Array.isArray(p.group.threadKeys))
        return {id,keys:p.group.threadKeys};
      if(/^g-p-[\da-f]{32}$/i.test(id??'')&&p?.project?.gizmo?.id===id&&uuid.test(p.linkedLocalProjectId??'')&&Array.isArray(p.localThreadKeys))
        return {id,keys:p.localThreadKeys};
    }
    return null;
  }
  async function readClientBindings(){
    const readers=new Set();
    for(const script of document.scripts){
      if(script.type!=='module'||!script.src)continue;
      const url=new URL(script.src);
      if(url.origin!==location.origin||!/^\/assets\/[^/]+\.js$/.test(url.pathname))continue;
      try{
        const loader=(await import(url.href)).__webpack_require__;
        for(const module of Object.values(loader?.c??{})){
          const api=module?.exports;
          // This is the initialized persisted-atom reader on compatible builds.
          // Don't load a private chunk, write atoms, or guess a module ID.
          if(api&&['TB','A2','Nj','Uz','Iy'].every(key=>typeof api[key]==='function'))readers.add(api.TB);
        }
      }catch{}
    }
    if(readers.size===1)try{return [...readers][0]('client-thread-bindings-v1',null);}catch{}
    return null;
  }
  async function requestProject(scope){
    if(projectResolving||[...jobs.values()].some(job=>job.request.kind==='project')){
      show('failed',t('aiRename.busy'));return;
    }
    projectResolving=true;
    show('running',t('aiRename.batchChecking'));
    try{
      const keys=[...new Set(scope.keys.filter(key=>typeof key==='string'&&key.startsWith('local:')))];
      const aliases=new Set(keys.filter(key=>key.startsWith('local:client-new-thread:')));
      const bindings=aliases.size?await readClientBindings():null;
      if(disposed)return;
      const mounted=new Map();
      for(const row of aliases.size?document.querySelectorAll(rowSelector):[]){
        const key=row.getAttribute('data-app-action-sidebar-thread-id');
        if(!aliases.has(key))continue;
        const id=sidebarThreadId(row);
        if(id){
          if(!mounted.has(key))mounted.set(key,new Set());
          mounted.get(key).add(id);
        }
      }
      const ids=new Set();
      let unresolved=0;
      for(const key of keys){
        const raw=key.slice(6);
        if(uuid.test(raw)){ids.add(raw.toLowerCase());continue;}
        const alias=raw.slice('client-new-thread:'.length);
        if(!raw.startsWith('client-new-thread:')||!uuid.test(alias)){unresolved++;continue;}
        const mapped=bindings&&Object.hasOwn(bindings,raw)?bindings[raw]:null;
        const candidates=new Set(mounted.get(key));
        if(typeof mapped==='string'&&uuid.test(mapped)&&mapped.toLowerCase()!==alias.toLowerCase())candidates.add(mapped.toLowerCase());
        if(candidates.size===1)ids.add([...candidates][0]);
        else unresolved++;
      }
      enqueue({kind:'project',projectId:scope.id,threadIds:[...ids],unresolved},t('aiRename.batchChecking'));
    }finally{projectResolving=false;}
  }
  function sidebarThreadId(row){
    if(row.getAttribute('data-app-action-sidebar-thread-host-id')!=='local'||
      row.getAttribute('data-app-action-sidebar-thread-kind')!=='local')return null;
    const raw=row.getAttribute('data-app-action-sidebar-thread-id')||'';
    if(!raw.startsWith('local:'))return null;
    const local=raw.slice('local:'.length);
    if(uuid.test(local))return local;
    if(!local.startsWith('client-new-thread:'))return null;
    const alias=local.slice('client-new-thread:'.length);
    if(!uuid.test(alias))return null;
    // Newly opened rows may retain a UI-only key after Codex has assigned a
    // persisted ID. Accept only a local component that explicitly owns this row.
    const ids=new Set();
    for(let fiber=fiberOf(row),depth=0;fiber&&depth<12;fiber=fiber.return,depth+=1){
      const props=fiber.memoizedProps;
      if(props?.rowRef?.current!==row||props.hostId!=='local'||props.isCodexCloudTask||
        typeof props.conversationId!=='string'||!uuid.test(props.conversationId))continue;
      const id=props.conversationId.toLowerCase();
      if(id!==alias.toLowerCase())ids.add(id);
    }
    return ids.size===1?ids.values().next().value:null;
  }
  function uniqueTriggerRow(branch){
    const stack=branch?[branch]:[];
    let row=null,visited=0;
    while(stack.length){
      if(++visited>256)return null;
      const fiber=stack.pop(),element=fiber.stateNode;
      if(fiber.sibling)stack.push(fiber.sibling);
      // The trigger is rendered in the owner's normal tree, not its menu portal.
      if(fiber.tag===4||element instanceof Element&&element.matches('[role="menu"]'))continue;
      if(element instanceof Element&&element.isConnected&&element.matches(targetSelector)){
        if(row&&row!==element)return null;
        row=element;
      }else if(fiber.child)stack.push(fiber.child);
    }
    return row;
  }
  function menuOwner(menu){
    if(menu.parentElement?.closest('[role="menu"]'))return null;
    // Native popover menus and their triggers explicitly reference each other.
    const labelledBy=menu.getAttribute('aria-labelledby');
    const triggerElement=labelledBy&&document.getElementById(labelledBy);
    if(menu.id&&triggerElement?.getAttribute('aria-haspopup')==='menu'&&
      triggerElement.getAttribute('aria-controls')===menu.id)return triggerElement.closest(targetSelector);
    let clickMenu=false;
    // Radix and desktop overlay adapters can insert dozens of layers between
    // the menu content and its owner. Follow the ancestry rather than counting them.
    for(let fiber=fiberOf(menu);fiber;fiber=fiber.return){
      const element=fiber.stateNode,props=fiber.memoizedProps;
      if(element instanceof Element&&element!==menu){
        if(element.matches('[role="menu"]'))return null; // portaled submenu
        if(clickMenu){
          const row=element.closest(targetSelector);
          if(row)return row;
        }
      }
      const trigger=props?.triggerRef?.current;
      if(trigger instanceof Element&&trigger.isConnected&&
        (menu.id&&props.contentId===menu.id||trigger.id&&menu.getAttribute('aria-labelledby')===trigger.id))
        return trigger.closest(targetSelector);
      if(typeof props?.getItems==='function'&&(props.menuShortcuts===true||typeof props.preserveBrowserContextMenu==='boolean')){
        if(clickMenu)return null; // do not fall through from an unrelated nested click menu
        if(props.trigger==='click')clickMenu=true;
        else return uniqueTriggerRow(fiber.child);
      }
    }
    return null;
  }
  function extendMenu(menu){
    const previous=menuItems.get(menu);
    const items=menu.matches(menuSelector)?menuEntriesFor(menu):[];
    const rename=items.find(item=>item.getAttribute('aria-keyshortcuts')?.toLowerCase()==='r'||
      /^(?:rename(?: chat)?|重命名(?:聊天)?)(?:\s*r)?$/iu.test(item.textContent.trim()));
    const row=items.length?menuOwner(menu):null;
    const project=row?.matches(projectSelector)?projectScope(row):null;
    const id=project?.id??(row?.matches(rowSelector)&&rename&&rename.getAttribute('aria-disabled')!=='true'&&!rename.hasAttribute('data-disabled')?
      sidebarThreadId(row):null),first=items[0];
    if(previous?.row===row&&previous?.id===id&&menu.contains(previous.item)){
      if(previous.item.nextElementSibling!==first)first.before(previous.item);
      return;
    }
    if(previous){previous.item.remove();menuItems.delete(menu);}
    if(!id)return;
    const item=document.createElement('button'),icon=document.createElement('span');
    item.type='button';item.setAttribute('role','menuitem');item.tabIndex=-1;item.dataset.bcSidebarAiRename='';
    item.className=(project?first:rename).className;
    item.style.cssText='display:flex;justify-content:flex-start;align-items:center;gap:8px;width:100%;text-align:start';
    icon.style.cssText='display:grid;place-items:center;width:16px;height:16px;flex:none';
    icon.innerHTML=sparkle;
    icon.firstElementChild.setAttribute('width','16');icon.firstElementChild.setAttribute('height','16');
    const label=project?t('aiRename.batchAction'):window.__codexHudI18n?.t?.('command.ai-rename')||'AI 重命名';
    item.append(icon,document.createTextNode(label));
    item.addEventListener('pointermove',event=>{if(event.pointerType==='mouse')item.focus({preventScroll:true});});
    item.addEventListener('click',event=>{
      event.stopPropagation();
      if(!menu.matches(menuSelector)||menuOwner(menu)!==row||!menu.contains(item))return;
      if(project){
        const scope=projectScope(row);
        if(scope?.id!==id)return;
        requestProject(scope).catch(()=>{if(!disposed)show('failed',t('aiRename.batchUnavailable'));});
      }else{
        if(sidebarThreadId(row)!==id)return;
        requestFor({id});
      }
      // Dismiss only the menu that owns the new item. The title is saved by the host API.
      item.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
    });
    menuItems.set(menu,{row,id,item});
    first.before(item);
  }
  function menuKey(event){
    if(!['ArrowUp','ArrowDown'].includes(event.key)||!(event.target instanceof Element))return;
    const menu=event.target.closest(menuSelector),item=menu?.querySelector('[data-bc-sidebar-ai-rename]');
    if(!item)return;
    const first=menuEntriesFor(menu).find(entry=>entry.getAttribute('aria-disabled')!=='true');
    const destination=event.key==='ArrowDown'&&event.target===item?first:
      event.key==='ArrowUp'&&event.target===first?item:null;
    if(destination){event.preventDefault();event.stopPropagation();destination.focus({preventScroll:true});}
  }
  const menuObserver=new MutationObserver(changes=>{
    const menus=new Set();
    for(const change of changes){
      const target=change.target instanceof Element?change.target:change.target.parentElement;
      const menu=target?.closest('[role="menu"]');
      if(menu)menus.add(menu);
      if(change.type==='attributes'&&target?.matches(targetSelector)){
        for(const open of document.querySelectorAll(menuSelector))menus.add(open);
      }
      for(const node of change.addedNodes){
        if(!(node instanceof Element))continue;
        if(node.matches(menuSelector))menus.add(node);
        for(const child of node.querySelectorAll(menuSelector))menus.add(child);
      }
    }
    for(const menu of menus)if(menu.isConnected)extendMenu(menu);
  });
  menuObserver.observe(document.body,{childList:true,subtree:true,attributes:true,
    attributeFilter:['data-state','aria-disabled','data-disabled','data-app-action-sidebar-thread-id','data-app-action-sidebar-project-id']});
  for(const menu of document.querySelectorAll(menuSelector))extendMenu(menu);
  window.addEventListener('keydown',menuKey,true);
  function remove(){
    disposed=true;
    if(timer)clearTimeout(timer);
    for(const job of jobs.values())clearTimeout(job.timeout);
    jobs.clear();
    menuObserver.disconnect();
    window.removeEventListener('keydown',menuKey,true);
    for(const item of document.querySelectorAll('[data-bc-sidebar-ai-rename]'))item.remove();
    window.removeEventListener('resize',position);style.remove();host.remove();delete window.__codexAiRename;
  }
  window.addEventListener('resize',position);
  window.__codexAiRename={request,pull,state,available,remove,snapshot:()=>({busy:projectResolving||jobs.size>0,visible:!host.hidden,text:text.textContent})};
})();
