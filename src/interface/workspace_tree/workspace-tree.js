// Our dock mounts the public Pierre renderer, never Codex's file page.
(() => {
  const activeSelector='[data-app-shell-active-page="true"]';
  const toolbarSelector='[data-app-shell-main-titlebar] [data-app-shell-header-toolbar]';
  const threadMarker='[data-above-composer-conversation-id]';
  const mainSelector='[data-app-shell-main-surface]';
  const contentSelector='[data-app-shell-main-content-layout]';
  const sidebarRow='[data-app-action-sidebar-thread-id]';
  const idPattern=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  const excluded='[inert],[aria-hidden="true"]';
  const visible=node=>node?.getClientRects().length>0&&node.checkVisibility()&&!node.closest(excluded);
  function single(node,selector,test=()=>true){
    const matches=[...node.querySelectorAll(selector)].filter(test);
    return matches.length===1?matches[0]:null;
  }
  function layout(){
    const page=single(document,activeSelector,n=>!n.closest(excluded));
    if(!page)return null;
    const slot=single(page,toolbarSelector,visible);
    const main=single(page,mainSelector,visible);
    if(!main||!slot?.lastElementChild?.querySelector('button,[role="button"]'))return null;
    const slotStyle=getComputedStyle(slot);
    if(!['flex','inline-flex'].includes(slotStyle.display)||slotStyle.flexDirection!=='row')return null;
    const content=single(main,contentSelector,n=>visible(n)&&!n.closest('[data-app-shell-focus-area="right-panel"]'));
    const dock=content?.parentElement;
    if(!dock)return null;
    const dockStyle=getComputedStyle(dock);
    if(dockStyle.display!=='flex'||dockStyle.flexDirection!=='row')return null;
    const ids=[...new Set([...content.querySelectorAll(threadMarker)]
      .filter(n=>!n.closest(excluded+',[data-app-shell-focus-area="right-panel"]'))
      .map(n=>n.getAttribute('data-above-composer-conversation-id')).filter(id=>idPattern.test(id??'')))];
    if(ids.length!==1)return null;
    const id=ids[0];
    if([...document.querySelectorAll(sidebarRow)].some(row=>{
      const key=row.getAttribute('data-app-action-sidebar-thread-id');
      return (key===id||key?.endsWith(':'+id))&&['kind','host-id'].some(name=>{
        const value=row.getAttribute('data-app-action-sidebar-thread-'+name);
        return value!==null&&value!=='local';
      });
    }))return null;
    return {page,id,content,dock,slot};
  }
  const same=(a,b)=>a&&b&&a.id===b.id&&a.page===b.page&&a.content===b.content&&a.dock===b.dock;

  function windowsPath(value){
    if(typeof value!=='string'||!/^[a-z]:[\\/]/i.test(value)||value.length>32767)return null;
    const path=value.replaceAll('/','\\').replace(/\\+$/,'');
    const pieces=path.slice(3).split('\\');
    if(path.length>2&&!pieces.every(bcWorkspaceWindowsName))return null;
    return path;
  }
  function allowedRoot(value){
    const path=windowsPath(value),home=windowsPath(bcTreeRoots.home),codex=windowsPath(bcTreeRoots.codexHome);
    if(!path||path.length<4||!home||!codex)return null;
    const key=path.toLowerCase(),personal=home.toLowerCase(),state=codex.toLowerCase();
    const within=(p,base)=>p===base||p.startsWith(base+'\\');
    if(within(personal,key)||within(state,key))return null;
    if(within(key,state)&&!key.startsWith(state+'\\worktrees\\'))return null;
    // Protect the normal state directory too when the app uses a custom Codex home.
    const defaultState=personal+'\\.codex';
    if(within(key,defaultState)&&!key.startsWith(defaultState+'\\worktrees\\'))return null;
    return path;
  }
  function registeredProject(root,projects){
    const path=root.toLowerCase();
    let longest=0,matches=new Map();
    for(const project of projects){
      if(!idPattern.test(project?.id??'')||!Array.isArray(project.roots))continue;
      for(const item of project.roots){
        const base=allowedRoot(item?.path)?.toLowerCase();
        if(!base||base.length<longest||(path!==base&&!path.startsWith(base+'\\')))continue;
        if(base.length>longest){longest=base.length;matches.clear();}
        matches.set(project.id.toLowerCase(),project);
      }
    }
    return matches.size===1?matches.values().next().value:null;
  }
  const projectName=value=>typeof value==='string'?value.trim():'';
  const storagePrefix='better-codex:workspace-tree-open:';
  const transient=new Map();
  function remembered(key){
    if(transient.has(key))return transient.get(key);
    try{return window.localStorage.getItem(storagePrefix+key)==='1';}
    catch{return false;}
  }
  function remember(key,open){
    try{
      if(open)window.localStorage.setItem(storagePrefix+key,'1');
      else window.localStorage.removeItem(storagePrefix+key);
      transient.delete(key);
    }catch{transient.set(key,open);}
  }
  const strings={
    en:{title:'Workspace files',close:'Close workspace files',filter:'Filter files…',
      loading:'Loading files…',readError:'Workspace files unavailable',empty:'No files',noMatches:'No matching files'},
    zh:{title:'工作区文件树',close:'关闭工作区文件树',filter:'筛选文件…',
      loading:'正在加载…',readError:'当前无法读取工作区文件',empty:'工作区为空',noMatches:'没有匹配的文件'}
  };
  const locale=()=>window.__codexHudI18n?.locale?.()??document.documentElement.lang;
  function t(full){
    const text=window.__codexHudI18n?.t?.(full);
    // An already-open window can temporarily retain the previous language pack.
    return text&&text!==full?text:strings[/^zh/i.test(locale())?'zh':'en'][full.slice('workspaceTree.'.length)];
  }

  const triggerHost=document.createElement('span');
  triggerHost.dataset.bcWorkspaceTreeTrigger='';
  triggerHost.style.cssText='display:inline-flex;align-items:center;gap:8px;flex:0 1 auto;min-width:28px;max-width:32%;pointer-events:auto;-webkit-app-region:no-drag';
  const triggerShadow=triggerHost.attachShadow({mode:'open'});
  triggerShadow.innerHTML='<style>button{display:grid;place-items:center;width:28px;height:28px;border:0;border-radius:7px;background:none;color:inherit;cursor:pointer;padding:0}button:where(:hover,[aria-expanded=true]){background:color-mix(in srgb,currentColor 9%,transparent)}button:focus-visible{outline:1px solid var(--codex-base-accent,currentColor);outline-offset:-2px}</style><button type="button" aria-expanded="false" aria-controls="bc-workspace-files"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h5l2 2h4v5H5a2 2 0 0 1-2-2Zm3 7v7h5m0-2h7l2 2v3h-9z"/></svg></button>';
  const trigger=triggerShadow.querySelector('button');
  trigger.style.flex='none';
  const projectLabel=document.createElement('span');
  projectLabel.dataset.bcWorkspaceProjectName='';
  projectLabel.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-inline-size:200px;font-size:var(--text-sm,13px);font-weight:600';
  projectLabel.hidden=true;
  triggerShadow.append(projectLabel);
  let enabled=false,disposed=false,frame=0,binding=null,surface=null,current=null;

  function label(){
    trigger.title=surface?t('workspaceTree.close'):t('workspaceTree.title');
    trigger.setAttribute('aria-label',trigger.title);
    trigger.setAttribute('aria-expanded',String(Boolean(surface)));
    const name=binding?.name??'';
    if(projectLabel.textContent!==name){
      projectLabel.textContent=name;projectLabel.title=name;projectLabel.hidden=!name;
    }
  }
  function disposeView(){
    if(!current)return;
    const view=current;current=null;
    view.dirs?.close();view.unsubscribe?.();view.tree?.cleanUp();
  }
  function hide(focus=false){
    disposeView();surface?.pane.remove();surface=null;
    label();
    if(focus&&triggerHost.isConnected)trigger.focus({preventScroll:true});
  }
  function makeSurface(){
    const pane=document.createElement('aside');
    pane.id='bc-workspace-files';pane.dataset.bcWorkspaceFiles='';
    pane.style.cssText='display:flex;flex:0 0 min(300px,45%);width:min(300px,45%);min-width:0;min-height:0;align-self:stretch';
    const shadow=pane.attachShadow({mode:'open'});
    shadow.innerHTML='<style>'+
      ':host{box-sizing:border-box;border-inline-end:1px solid var(--color-token-border, color-mix(in srgb,currentColor 13%,transparent));background:var(--color-token-bg-primary,light-dark(#fff,#1c1c1c));color:var(--color-token-text-primary,inherit)}'+
      '.dock{display:flex;flex-direction:column;min-height:0;min-width:0;width:100%;padding:8px 6px 0;box-sizing:border-box}'+
      'label{display:flex;gap:7px;align-items:center;margin:0 3px 7px;padding:0 9px;height:29px;flex:none;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-radius:7px}'+
      'label:focus-within{border-color:var(--codex-base-accent,currentColor)}label svg{flex:none;opacity:.65}'+
      'input{box-sizing:border-box;width:100%;min-width:0;padding:0;border:0;outline:none;background:none;color:inherit;font:inherit;font-size:13px}'+
      'input::placeholder{color:currentColor;opacity:.6}'+
      '.tree{display:flex;flex-direction:column;min-height:0;min-width:0;flex:1;overflow:hidden;--trees-theme-sidebar-bg:transparent;--trees-theme-sidebar-fg:var(--color-token-text-primary,currentColor);--trees-theme-list-hover-bg:color-mix(in srgb,currentColor 8%,transparent);--trees-theme-list-active-selection-bg:color-mix(in srgb,currentColor 13%,transparent)}'+
      '.tree>bc-workspace-file-tree{display:block;min-height:0;min-width:0;flex:1;height:100%}'+
      '.status{margin:8px 9px;font:inherit}'+
      '</style><div class="dock"><label><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg><input type="search" autocomplete="off" spellcheck="false" disabled></label><div class="status" role="status"></div><div class="tree"></div></div>';
    const input=shadow.querySelector('input'),status=shadow.querySelector('.status'),wrap=shadow.querySelector('.tree');
    pane.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!event.defaultPrevented){
        event.preventDefault();event.stopPropagation();setOpen(reconcile(),false,true);
      }
    });
    return {pane,input,status,wrap};
  }
  function present(scope,message){
    disposeView();
    const {pane,input,status,wrap}=surface??=makeSurface();
    wrap.replaceChildren();input.oninput=null;input.value='';input.disabled=true;
    pane.setAttribute('aria-label',t('workspaceTree.title'));
    input.placeholder=t('workspaceTree.filter');input.setAttribute('aria-label',input.placeholder);
    status.textContent=t(message);status.hidden=false;
    if(scope.content.previousElementSibling!==pane)scope.content.before(pane);
    label();return surface;
  }
  function open(context){
    if(current?.context===context)return;
    const {scope,root}=context;
    const {pane,input,status,wrap}=present(scope,root?'workspaceTree.loading':'workspaceTree.readError');
    if(!root)return;
    const view={context,tree:null,dirs:null,unsubscribe:null,expanded:[],pathCount:0,updating:false};
    current=view;
    const isCurrent=()=>current===view&&binding===context&&pane.isConnected&&same(scope,layout());
    const displayStatus=()=>{
      const filter=input.value.trim();
      const noMatches=filter&&view.tree.getSearchMatchingPaths().length===0;
      status.textContent=noMatches?t('workspaceTree.noMatches'):!view.pathCount?t('workspaceTree.empty'):'';
      status.hidden=!status.textContent;
    };
    function onUpdate(paths){
      if(!isCurrent())return;
      view.pathCount=paths.length;
      if(!view.tree){
        view.tree=new bcTreeRenderer.FileTree({paths,initialExpansion:'closed',
          flattenEmptyDirectories:false,icons:{set:'complete',colored:true},itemHeight:26,fileTreeSearchMode:'hide-non-matches'});
        view.tree.render({containerWrapper:wrap});
        view.unsubscribe=view.tree.subscribe(()=>{
          if(view.updating||input.value.trim()||!isCurrent())return;
          // Search can temporarily reveal branches; only actual expansions drive IO.
          const expanded=view.tree.getVisibleRows(0,view.tree.getVisibleCount())
            .filter(row=>row.kind==='directory'&&row.isExpanded)
            .map(row=>row.path.replace(/\/$/,''));
          if(expanded.length===view.expanded.length&&expanded.every((path,i)=>path===view.expanded[i]))return;
          view.expanded=expanded;
          view.dirs.expand(expanded);
        });
      }else{
        view.updating=true;
        try{view.tree.resetPaths(paths,{initialExpandedPaths:view.expanded});}
        finally{view.updating=false;}
      }
      input.disabled=false;displayStatus();
    }
    function onError(){
      if(!isCurrent())return;
      view.unsubscribe?.();view.unsubscribe=null;view.tree?.cleanUp();view.tree=null;wrap.replaceChildren();
      input.value='';input.disabled=true;status.textContent=t('workspaceTree.readError');status.hidden=false;
    }
    input.oninput=()=>{
      if(!view.tree||!isCurrent())return;
      view.updating=true;
      try{view.tree.setSearch(input.value.trim()||null);}
      finally{view.updating=false;}
      displayStatus();
    };
    view.dirs=bcCreateWorkspaceDirectories({root,isCurrent,onUpdate,onError});
    view.dirs.start();
  }
  function setOpen(context,openIt,focus=false){
    if(!context||context!==binding)return;
    if(context.pending)context.intent=openIt;
    else if(context.key)remember(context.key,openIt);
    if(!openIt)hide(focus);
    else if(context.pending)present(context.scope,'workspaceTree.loading');
    else open(context);
  }
  function applyRemembered(context){
    if(context.key&&remembered(context.key))open(context);
    else hide();
  }
  async function loadProjectName(context,projectId){
    const transport=bcWorkspaceTransport();
    try{
      const {project}=await transport.send('project/read',{projectId},1400);
      if(binding!==context||!same(context.scope,layout())||project?.id?.toLowerCase()!==projectId)return;
      const name=projectName(project.name);
      if(name){context.name=name;label();}
    }catch{/* The workspace folder name remains visible. */}
    finally{transport.close();}
  }
  async function resolve(context){
    const {scope}=context,transport=bcWorkspaceTransport();
    const valid=()=>binding===context&&same(scope,layout());
    let explicitId=null;
    try{
      const result=await transport.send('thread/read',{threadId:scope.id,includeTurns:false},2400);
      if(!valid())return;
      const thread=result?.thread,root=thread?.id===scope.id&&allowedRoot(thread.cwd);
      if(root){
        explicitId=idPattern.test(thread.projectId??'')?thread.projectId.toLowerCase():null;
        let registered=null;
        if(!explicitId){
          // Chats without an explicit project ID still belong to a registered root.
          const projects=[];
          try{
            let cursor=null;
            for(let page=0;page<3;page++){
              const result=await transport.send('project/list',{cursor,limit:100},1400);
              if(!valid())return;
              if(!Array.isArray(result?.data))break;
              projects.push(...result.data);
              cursor=result.nextCursor;
              if(typeof cursor!=='string'||!cursor)break;
            }
          }catch{/* Older App Servers can still use the workspace path. */}
          registered=registeredProject(root,projects);
        }
        const projectId=explicitId??registered?.id.toLowerCase();
        context.root=root;
        context.key=projectId?'project:'+projectId:'root:'+root.toLowerCase();
        context.name=projectName(registered?.name)||root.split('\\').at(-1);
      }
    }catch{/* A failed lookup never reuses another chat's files or project. */}
    finally{transport.close();}
    if(!valid())return;
    context.pending=false;
    if(context.intent!==null)setOpen(context,context.intent);
    else applyRemembered(context);
    if(explicitId)void loadProjectName(context,explicitId);
  }
  function reconcile(){
    if(disposed)return null;
    const scope=enabled?layout():null;
    if(!scope){binding=null;hide();triggerHost.remove();return null;}
    if(scope.slot.firstElementChild!==triggerHost)scope.slot.prepend(triggerHost);
    if(!same(binding?.scope,scope)){
      binding={scope,pending:true,intent:null,root:null,key:null};
      // Keep the left rail in place while changing chats, but do not show old files.
      if(surface)present(scope,'workspaceTree.loading');
      void resolve(binding);
    }else if(surface&&scope.content.previousElementSibling!==surface.pane){
      scope.content.before(surface.pane);
    }
    label();return binding;
  }
  function schedule(){
    if(enabled&&!disposed&&!frame)frame=requestAnimationFrame(()=>{frame=0;reconcile();});
  }
  trigger.addEventListener('click',()=>{
    const context=reconcile();
    setOpen(context,!surface,true);
  });
  function storageChanged(event){
    if(!binding?.pending&&binding?.key&&(event.key===null||event.key===storagePrefix+binding.key)){
      const context=reconcile();
      if(context&&!context.pending&&context.key&&(event.key===null||event.key===storagePrefix+context.key)){
        transient.delete(context.key);applyRemembered(context);
      }
    }
  }
  const observed=[activeSelector,toolbarSelector,threadMarker,mainSelector,contentSelector,sidebarRow,'[data-bc-workspace-files]'].join(',');
  const observer=new MutationObserver(records=>{
    if(records.some(record=>record.type==='attributes'||[...record.addedNodes,...record.removedNodes].some(node=>
      node instanceof Element&&(node.matches(observed)||node.querySelector(observed)))))schedule();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:[
    'data-app-shell-active-page','data-above-composer-conversation-id','data-app-action-sidebar-thread-id',
    'data-app-action-sidebar-thread-kind','data-app-action-sidebar-thread-host-id','inert','aria-hidden','hidden'
  ]});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  window.addEventListener('resize',schedule);
  window.addEventListener('storage',storageChanged);
  window.__codexWorkspaceTree={
    setEnabled(value){
      if(enabled===(value===true))return;
      enabled=value===true;reconcile();
    },
    remove(){
      binding=null;hide();disposed=true;observer.disconnect();cancelAnimationFrame(frame);
      window.removeEventListener('resize',schedule);window.removeEventListener('storage',storageChanged);
      triggerHost.remove();delete window.__codexWorkspaceTree;
    }
  };
})();
