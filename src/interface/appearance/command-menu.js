// Native slash-menu presentation, with draft-only skill and Prompt insertion.
(() => {
  const groups=[['chat',['new','rename','ai-rename','archive']],['context',['side','fork','compact']],['project',['init','review-mode']],['organize',['pin','share','delete']],['model',['model','reasoning','service-tier:priority']],['workflow',['plan-mode','goal']],['tools',['mcp','ide-context']],['creative',['sketch','pet']],['help',['status','usage','feedback']],['other',[]]];
  const initial=new Set(['new','rename','ai-rename','archive','side','fork','compact','init','review-mode']);
  const shortened=new Set(['pin','share','delete','mcp','usage']);
  const commands=groups.flatMap(([group,ids])=>ids.map(id=>({id,group,label:'command.'+id,shortLabel:(shortened.has(id)?'commandShort.':'command.')+id})));
  const defaults=Object.fromEntries(commands.map(item=>[item.id,initial.has(item.id)]));
  const isSkill=id=>id.startsWith('skill:');
  const presetSkills={'create-statusline':'Create Statusline','excel-live-control':'Excel Live Control',health:'Health',spreadsheets:'Spreadsheets',visualize:'Visualize'};
  const skillAliases={'health:health':'health','spreadsheets:excel-live-control':'excel-live-control','spreadsheets:spreadsheets':'spreadsheets','visualize:visualize':'visualize'};
  function skillKey(title,name){
    const slug=text=>text.trim().toLowerCase().replace(/\s*:\s*/g,':').replace(/[\s_-]+/g,'-');
    const key=slug(title),raw=name?slug(name):key;
    if(Object.hasOwn(skillAliases,raw))return skillAliases[raw];
    if(Object.hasOwn(presetSkills,raw))return raw;
    return Object.hasOwn(skillAliases,key)?skillAliases[key]:key;
  }
  function normalizeSkillVisible(value){
    const defaults=Object.fromEntries(Object.keys(presetSkills).map(id=>[id,false]));
    const choices=value&&typeof value==='object'&&!Array.isArray(value)?Object.entries(value):[];
    return {...defaults,...Object.fromEntries(choices.filter(([id,on])=>id.length>0&&id.length<1024&&typeof on==='boolean'))};
  }
  function normalize(value){return {...defaults,...Object.fromEntries(Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{}).filter(([id,on])=>id.length>0&&id.length<1024&&typeof on==='boolean'))};}
  function normalizeSectionOrder(value){return Array.isArray(value)&&value[0]==='skills'?['skills','commands']:['commands','skills'];}
  function normalizeGroupOrder(value){
    const saved=Array.isArray(value)?value:[],secondary=groups.slice(3,-1).map(([id])=>id);
    const legacy=saved.includes('other')&&!saved.some(id=>secondary.includes(id));
    return [...new Set([...saved.flatMap(id=>id==='other'&&legacy?[...secondary,id]:[id]).filter(id=>groups.some(([group])=>group===id)),...groups.map(([id])=>id)])];
  }
  function normalizeItemOrder(value){return Object.fromEntries(groups.map(([group,ids])=>{
    const saved=Array.isArray(value?.[group])?value[group]:Array.isArray(value?.other)?value.other:[];
    const valid=saved.filter(id=>typeof id==='string'&&id.length>0&&id.length<1024&&!isSkill(id)&&(group==='other'?!commands.some(item=>item.id===id):ids.includes(id)));
    const ordered=valid.length?valid:[...ids];
    if(group==='chat'&&!ordered.includes('ai-rename')&&ids.includes('ai-rename')){
      const at=ordered.indexOf('rename');
      ordered.splice(at>=0?at+1:0,0,'ai-rename');
    }
    return [group,[...new Set([...ordered,...ids])]];
  }));}
  function orderedGroups(groupOrder,itemOrder,extra=[]){const order=normalizeItemOrder(itemOrder);return normalizeGroupOrder(groupOrder).map(group=>({id:group,items:[...commands,...extra].filter(item=>item.group===group&&!isSkill(item.id)).sort((a,b)=>{const rank=id=>order[group].includes(id)?order[group].indexOf(id):order[group].length+extra.findIndex(item=>item.id===id);return rank(a.id)-rank(b.id);})}));}
  const catalog={groups,commands,defaults,normalize,isSkill,normalizeGroupOrder,normalizeItemOrder,orderedGroups,normalizeSkillVisible,normalizeSectionOrder};
  if(typeof module==='object'&&module.exports){module.exports=catalog;return;}
  if(window.__codexCommandMenu)return;
  let preferences=normalize(),groupOrder=normalizeGroupOrder(),itemOrder=normalizeItemOrder(),enabled=true,disposed=false,queued=false;
  let skillVisible=normalizeSkillVisible();
  const knownNativeSkills=new Map();
  const showSkill=id=>!Object.hasOwn(skillVisible,id)||skillVisible[id]!==false;
  const standalone={element:null,editor:null,composer:null,query:'',request:null,loaded:false,entries:[],open:false,timer:0,promptTimer:0};
  const discovered=new Map(),managed=new Set(),selections=new WeakMap(),views=new Map(),openings=new Map(),proxySources=new WeakMap(),columns=new WeakMap();
  const headings={skills:'Skills',prompts:'Prompt'},instance=String(Math.random()),namesOrder=new Intl.Collator(undefined,{sensitivity:'base',numeric:true});
  let nextOpening=0,lastPrompts=[];
  const style=document.createElement('style');style.id='better-codex-command-menu-style';
  // Native rows use viewport intersection to replace offscreen icons with text placeholders.
  // Keep source geometry in the viewport without exposing or laying out duplicate controls.
  style.textContent=`[data-bc-command-hidden]{display:none!important}
    [data-bc-command-source]{display:block!important;position:absolute!important;top:0;left:0;width:100%;visibility:hidden;pointer-events:none}
    [data-bc-section-hidden]{display:block!important;position:absolute!important;top:0;left:0;width:100%;height:0;visibility:hidden;pointer-events:none}
    [data-bc-command-root]{position:relative;display:flex;flex-direction:column;overflow-x:hidden!important;scrollbar-gutter:stable}
    [data-bc-prompt-pending],div:has(> [data-bc-prompt-pending]){visibility:hidden!important;pointer-events:none!important}
    [data-bc-command-empty]>div.px-row-x.py-row-y.text-tertiary:not([data-mention-section-id],[data-bc-command-grid]):not(:has(input,textarea,button,a,[contenteditable],[role="searchbox"],[role="button"])){display:none!important}
    div:has(> [data-mention-list-scroll-area][data-bc-command-root]){max-height:min(var(--composer-overlay-available-height,var(--autocomplete-overlay-available-height,calc(100vh - 24px))),var(--composer-top-menu-max-height,100vh))!important}
    [data-bc-command-section]{order:1;flex-shrink:0}
    [data-bc-command-grid]{order:0;display:grid;gap:4px;padding:4px;flex-shrink:0;min-width:0}
    [data-bc-command-grid][hidden]{display:none}
    [data-bc-command-group]{display:flex;flex-wrap:nowrap;gap:4px;overflow-x:auto;scrollbar-width:thin;min-width:0}
    [data-bc-menu-heading]{display:flex;align-items:center;gap:8px;padding:2px 8px 0;color:var(--color-text-tertiary,currentColor);font-size:.85em;font-weight:400;line-height:1.25;cursor:default}
    [data-bc-menu-heading]::before,[data-bc-menu-heading]::after{content:"";flex:1;border-block-start:1px solid color-mix(in srgb,currentColor 40%,transparent)}
    :is([data-bc-skill-row],[data-bc-prompt-row]){display:grid;grid-template-columns:repeat(3,minmax(0,1fr));overflow:visible}
    :is([data-bc-skill-row],[data-bc-prompt-row]) [data-bc-menu-button]{min-width:0;width:100%}
    [data-bc-menu-button]{display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;flex:0 0 auto;max-width:100%;height:32px;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;line-height:1.25;white-space:nowrap;cursor:pointer;text-align:start}
    [data-bc-menu-icon]{display:grid;place-items:center;flex:0 0 16px;width:16px;height:16px}
    [data-bc-menu-icon] svg{width:100%;height:100%}
    [data-bc-menu-button] span{min-width:0;overflow:hidden;text-overflow:ellipsis}
    [data-bc-menu-button]:disabled{opacity:.4;cursor:default}
    [data-bc-menu-button]:focus-visible{outline:2px solid var(--codex-base-accent,currentColor);outline-offset:-2px}
    [data-bc-active]{background:var(--color-background-secondary,#ffffff14)!important}
    [data-bc-command]:not([data-bc-active]){background:transparent!important}
    [data-bc-standalone-root]{position:fixed!important;z-index:2147483000;max-width:min(720px,calc(100vw - 24px));max-height:min(420px,calc(100vh - 24px));padding:7px;border:1px solid var(--color-border-primary,#ffffff24);border-radius:14px;background:var(--color-background-elevated,#2b2b2b);box-shadow:0 18px 50px #0008;overflow-y:auto;overscroll-behavior:contain}
    [data-bc-standalone-root][hidden]{display:none!important}`;
  document.head.append(style);
  const fiber=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];
  function autocomplete(root){for(let current=fiber(root),depth=0;current&&depth<24;current=current.return,depth++){const value=current.memoizedProps?.autocomplete;if(value)return value;}return null;}
  function metadata(row){for(let current=fiber(row),depth=0;current&&depth<5;current=current.return,depth++){const item=current.memoizedProps?.children?.props?.item;if(item&&typeof item.id==='string'&&typeof item.title==='string')return {id:item.id,title:item.title};}return null;}
  function attribute(node,key,value){managed.add(node);if(value===null){if(node.hasAttribute(key))node.removeAttribute(key);}else if(node.getAttribute(key)!==value)node.setAttribute(key,value);}
  function clear(node){for(const name of ['data-bc-command-root','data-bc-command-empty','data-bc-prompt-pending','data-bc-command-section','data-bc-command','data-bc-command-hidden','data-bc-command-source','data-bc-section-hidden','data-bc-active'])node.removeAttribute(name);node.style?.removeProperty('--bc-command-order');}
  function restore(root){clearTimeout(openings.get(root)?.promptTimer);views.get(root)?.surface.remove();views.delete(root);openings.delete(root);selections.delete(root);columns.delete(root);for(const node of [...managed])if(root.contains(node)){clear(node);managed.delete(node);}}
  function requestPrompts(opening){
    if(typeof window.__betterCodexRequestPrompts!=='function')return;
    const request=opening.request;
    // A slow or disconnected reader must neither trap the menu nor patch its visible layout later.
    opening.promptTimer=setTimeout(()=>applyPrompts([request],lastPrompts,false),180);
    try{window.__betterCodexRequestPrompts(request);}catch{}
  }
  function eligible(root,value=autocomplete(root)){return enabled&&value?.ui?.active===true&&value.ui.trigger==='/'&&!value.submenuCommand;}
  function nativeAvailable(row){return row.isConnected&&!row.hasAttribute('data-bc-command-hidden')&&row.getAttribute('aria-disabled')!=='true'&&!row.disabled;}
  function rows(root){return [...views.get(root)?.buttons||[]].filter(([row,button])=>!button.disabled&&(typeof row==='string'||nativeAvailable(row))).map(([row])=>row);}
  function visual(root,row){return views.get(root)?.buttons.get(row)||row;}
  function select(root,row){selections.set(root,row);for(const node of root.querySelectorAll('[data-bc-command]'))attribute(node,'data-bc-active',node===row?'':null);for(const [source,button] of views.get(root)?.buttons||[]){button.toggleAttribute('data-bc-active',source===row);button.setAttribute('aria-selected',String(source===row));}}
  function focusedEditor(editor=document.activeElement){
    if(!editor?.matches?.('[contenteditable="true"],[contenteditable="plaintext-only"],textarea'))return null;
    const composer=editor.closest('[data-codex-composer-root]');
    return composer?{editor,composer}:null;
  }
  function nativeMenuOpen(){return [...document.querySelectorAll('[data-mention-list-scroll-area]')].some(root=>root.isConnected&&eligible(root)&&root.getBoundingClientRect().width>0);}
  function nativeSkillContext(focused){
    if(!focused)return null;
    const {editor,composer}=focused;
    let viewController,client,scope;
    const capture=current=>{
      const props=current.memoizedProps;
      const controller=props?.composerController??props?.value;
      if(controller?.view?.dom===editor&&typeof controller.insertMention==='function')viewController??=controller;
      const skills=props?.skillSuggestions;
      if(skills?.hostId==='local'&&Array.isArray(skills.roots)&&skills.roots.every(root=>typeof root==='string')&&typeof skills.autocomplete?.addMention==='function')scope??=skills;
    };
    // Match the actual editor and its local skill scope, not another input or a global list.
    for(let current=fiber(composer),depth=0;current&&depth<220;current=current.return,depth++){
      const candidate=current.memoizedProps?.value?.queryClient;
      if(typeof candidate?.getQueryData==='function'){client=candidate;break;}
    }
    if(!client)return null;
    const stack=[fiber(composer)?.child];
    for(let count=0;stack.length&&count<600&&!(viewController&&scope);count++){
      const current=stack.pop();if(!current)continue;
      capture(current);if(current.sibling)stack.push(current.sibling);if(current.child)stack.push(current.child);
    }
    if(!scope||!viewController?.view?.editable||viewController.view.isDestroyed)return null;
    let data;
    try{data=client.getQueryData(['skills',scope.hostId,scope.roots])?.data;}catch{return null;}
    if(!Array.isArray(data))return null;
    return {controller:viewController,skills:data.flatMap(entry=>Array.isArray(entry?.skills)?entry.skills:[])};
  }
  function usableSkill(skill){return skill?.enabled===true&&skill.isPublic!==false&&typeof skill.name==='string'&&skill.name.trim()&&typeof skill.path==='string'&&skill.path;}
  function skillTitle(skill){
    const display=skill.interface?.displayName;
    return typeof display==='string'&&display.trim()||skill.name.replace(/[_-]+/g,' ').replace(/:\s*/g,': ').replace(/(^|\s)\p{L}/gu,letter=>letter.toLocaleUpperCase());
  }
  function skillEntries(composer){
    const entries=new Map(Object.entries(presetSkills));
    for(const [id,title] of knownNativeSkills)entries.set(id,title);
    for(const editor of composer?.querySelectorAll('[contenteditable="true"],[contenteditable="plaintext-only"],textarea')??[]){
      for(const skill of nativeSkillContext(focusedEditor(editor))?.skills??[]){
        if(!usableSkill(skill))continue;
        const title=skillTitle(skill);entries.set(skillKey(title,skill.name),title);
      }
    }
    return [...entries].sort((a,b)=>namesOrder.compare(a[1],b[1])).map(([id,title])=>({id,title}));
  }
  function cachedSkills(focused,query){
    if(typeof query!=='string')return [];
    const context=nativeSkillContext(focused),seen=new Set(),needle=query.toLocaleLowerCase();
    return (context?.skills??[]).flatMap(skill=>{
      if(!usableSkill(skill)||seen.has(skill.path))return [];
      seen.add(skill.path);
      const id='skill:'+skill.path,title=skillTitle(skill);
      return showSkill(skillKey(title,skill.name))&&(!needle||[title,skill.name].some(name=>name.toLocaleLowerCase().includes(needle)))?[{row:id,item:{id,title}}]:[];
    });
  }
  function insertSkill(root,id,query){
    const focused=focusedEditor(),owner=root.closest('[data-codex-composer-root]');
    if(!focused||owner&&owner!==focused.composer||typeof query!=='string'||/[\s/]/u.test(query))return false;
    const context=nativeSkillContext(focused),view=context?.controller.view;
    const skill=context?.skills.find(skill=>usableSkill(skill)&&'skill:'+skill.path===id);
    if(!skill||!showSkill(skillKey(skillTitle(skill),skill.name))||view.composing||!view.state?.selection?.empty)return false;
    const {doc,selection}=view.state,to=selection.to,trigger='/'+query,from=to-trigger.length;
    if(!Number.isInteger(to)||from<1||typeof doc?.textBetween!=='function')return false;
    try{
      if(doc.textBetween(from,to)!==trigger)return false;
      const before=doc.resolve(from).parentOffset>0?doc.textBetween(from-1,from):'';
      if(before&&!/\s/u.test(before))return false;
      // The native editor replaces the typed slash range with a real skill mention in one edit.
      context.controller.insertMention({kind:'skill',name:skill.name,displayName:skillTitle(skill),path:skill.path,
        description:skill.interface?.shortDescription||skill.short_description||skill.shortDescription||skill.description||'',iconSmall:skill.interface?.iconSmall??''},{range:{from,to}});
      return true;
    }catch{return false;}
  }
  function linePrefix(editor){
    if(editor.matches('textarea')){
      if(editor.selectionStart!==editor.selectionEnd)return null;
      const offset=editor.selectionStart,start=editor.value.lastIndexOf('\n',offset-1)+1;
      return editor.value.slice(start,offset);
    }
    const selection=getSelection();
    if(!selection?.isCollapsed||!selection.focusNode||!editor.contains(selection.focusNode))return null;
    const focusNode=selection.focusNode,element=focusNode.nodeType===Node.TEXT_NODE?focusNode.parentElement:focusNode;
    const block=element?.closest?.('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6'),line=block&&editor.contains(block)?block:editor;
    const range=document.createRange();range.selectNodeContents(line);range.setEnd(focusNode,selection.focusOffset);
    return range.toString();
  }
  function slashQuery(editor){
    const prefix=linePrefix(editor),match=typeof prefix==='string'?prefix.match(/(?:^|\s)\/([^\s/]*)$/u):null;
    return match?match[1]:null;
  }
  function ensureStandalone(){
    if(!standalone.element){
      const element=document.createElement('div');element.dataset.bcStandaloneRoot='';element.dataset.bcCommandRoot='';element.setAttribute('role','listbox');element.hidden=true;
      document.body.append(element);standalone.element=element;
    }
    return standalone.element;
  }
  function standaloneGroups(){
    const query=standalone.query.toLocaleLowerCase();
    const entries=standalone.entries.filter(entry=>!query||entry.name.toLocaleLowerCase().includes(query)).map(({name})=>({row:'prompt:'+name,item:{id:'prompt:'+name,title:name}}));
    const skills=cachedSkills({editor:standalone.editor,composer:standalone.composer},standalone.query);
    return {entries,skillGroups:nameLayout('skills',skills),promptGroups:nameLayout('prompts',entries)};
  }
  function positionStandalone(){
    const element=standalone.element,composer=standalone.composer;
    if(!element||element.hidden||!composer?.isConnected)return;
    const margin=12,rect=composer.getBoundingClientRect(),width=Math.max(280,Math.min(720,rect.width));
    element.style.width=width+'px';element.style.left=Math.max(margin,Math.min(innerWidth-margin-width,rect.left))+'px';
    element.style.top=Math.max(margin,rect.top-8-element.getBoundingClientRect().height)+'px';element.style.bottom='auto';
  }
  function renderStandalone(){
    if(!standalone.open||standalone.promptTimer)return false;
    const {entries,skillGroups,promptGroups}=standaloneGroups();
    if(!skillGroups.length&&!promptGroups.length){if(standalone.element)standalone.element.hidden=true;return false;}
    const element=ensureStandalone();element.hidden=false;build(element,entries,[],skillGroups,promptGroups);
    const visible=rows(element),selected=selections.get(element);select(element,visible.includes(selected)?selected:visible[0]);positionStandalone();
    return true;
  }
  function closeStandalone(){
    if(standalone.timer){clearTimeout(standalone.timer);standalone.timer=0;}
    clearTimeout(standalone.promptTimer);standalone.promptTimer=0;
    standalone.open=false;standalone.loaded=false;standalone.request=null;standalone.query='';standalone.entries=[];standalone.editor=null;standalone.composer=null;
    if(standalone.element){standalone.element.hidden=true;restore(standalone.element);}
  }
  function inspectStandalone(){
    standalone.timer=0;
    if(disposed||!enabled||nativeMenuOpen()){closeStandalone();return;}
    const focused=focusedEditor(),query=focused?slashQuery(focused.editor):null;
    if(query===null){closeStandalone();return;}
    if(!standalone.open||standalone.editor!==focused.editor){
      closeStandalone();standalone.open=true;standalone.editor=focused.editor;standalone.composer=focused.composer;
      standalone.request=instance+':standalone:'+(++nextOpening);
      requestPrompts(standalone);
    }
    standalone.query=query;
    renderStandalone();
  }
  function scheduleStandalone(delay=80){if(disposed)return;if(standalone.timer)clearTimeout(standalone.timer);standalone.timer=setTimeout(inspectStandalone,delay);}
  function label(item){const known=commands.find(command=>command.id===item.id);return known&&window.__codexHudI18n?window.__codexHudI18n.t(known.shortLabel):item.title;}
  function syntheticAvailable(id){
    if(id!=='ai-rename')return true;
    if(window.__codexComposerHud?.snapshot?.().id)return true;
    return [...document.querySelectorAll('[data-app-action-sidebar-thread-active="true"]')].some(row=>row.checkVisibility());
  }
  function nameLayout(id,entries){
    const names=entries.sort((a,b)=>namesOrder.compare(a.item.title,b.item.title));
    const size=Math.ceil(names.length/3),cols=[];
    for(let column=0;column<3;column++)cols.push(names.slice(column*size,(column+1)*size));
    return Array.from({length:size},(_,index)=>({id,heading:index===0?headings[id]:null,entries:cols.map(column=>column[index]).filter(Boolean)}));
  }
  function run(root,row){
    const standaloneRun=root===standalone.element;
    if(!standaloneRun&&!eligible(root))return;
    if(typeof row!=='string'){if(nativeAvailable(row))row.click();return;}
    if(isSkill(row)){
      if(insertSkill(root,row,standaloneRun?standalone.query:autocomplete(root)?.ui?.query)&&standaloneRun)closeStandalone();
      return;
    }
    if(row==='ai-rename'){
      window.__codexAiRename?.request?.();
      insertPrompt(root,'',standaloneRun?standalone.query:undefined);
      if(standaloneRun)closeStandalone();
      else queueMicrotask(()=>{
        if(root.isConnected){try{autocomplete(root)?.closeAutocomplete?.();}catch{}}
      });
      return;
    }
    const opening=openings.get(root),body=standaloneRun?standalone.entries.find(entry=>'prompt:'+entry.name===row)?.body:opening?.prompts.get(row),editor=document.activeElement;
    if(body&&insertPrompt(root,body,standaloneRun?standalone.query:undefined)){
      if(standaloneRun){closeStandalone();return;}
      queueMicrotask(()=>{
        // Give the editor its normal DOM update first; never dispatch a global Escape.
        if(root.isConnected&&openings.get(root)===opening&&document.activeElement===editor&&eligible(root)){
          try{autocomplete(root)?.closeAutocomplete?.();}catch{}
        }
      });
    }
  }
  function withNewlines(body,before,after){
    if(!body)return '';
    return (before&&!/^[\r\n]/.test(before)&&!/^[\r\n]/.test(body)?'\n':'')+body+
      (after&&!/^[\r\n]/.test(after)&&!/[\r\n]$/.test(body)?'\n':'');
  }
  function edge(range,backward){
    const contents=range.cloneContents();
    const walk=document.createTreeWalker(contents,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode(node){
      return node.nodeName==='BR'||node.nodeType===Node.TEXT_NODE&&node.length?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP;
    }});
    if(backward){while(walk.nextNode()){}}
    else walk.nextNode();
    const node=walk.currentNode;
    return node.nodeName==='BR'?'\n':node.nodeType===Node.TEXT_NODE?node.data.at(backward?-1:0):'';
  }
  function insertPrompt(root,body,queryOverride){
    const editor=document.activeElement,composer=editor?.closest('[data-codex-composer-root]'),owner=root.closest('[data-codex-composer-root]');
    if(!composer||owner&&owner!==composer||!editor.matches('[contenteditable="true"],[contenteditable="plaintext-only"],textarea'))return false;
    // Remove only the confirmed, immediate slash trigger (and query, when native metadata supplies one).
    const query=queryOverride!==undefined?queryOverride:autocomplete(root)?.ui?.query;
    const trigger='/'+(typeof query==='string'&&!/\s/.test(query)?query:'');
    function triggerLength(prefix,previous){
      if(!prefix.endsWith(trigger))return 0;
      const before=prefix.at(-trigger.length-1)??previous?.();
      return !before||/\s/.test(before)?trigger.length:0;
    }
    let before,after,restore;
    if(editor.matches('textarea')){
      if(editor.readOnly||editor.disabled)return false;
      const {selectionStart:start,selectionEnd:end,selectionDirection:direction,value}=editor;
      const caret=direction==='backward'?start:end,left=caret-(start===end?triggerLength(value.slice(0,caret)):0);
      before=value[left-1];after=value[caret];
      editor.setSelectionRange(left,caret);restore=()=>editor.setSelectionRange(start,end,direction);
    }else{
      const selection=getSelection(),{anchorNode,anchorOffset,focusNode,focusOffset}=selection;
      if(!editor.contains(focusNode)||!editor.contains(anchorNode))return false;
      const point=document.createRange();point.setStart(focusNode,focusOffset);point.collapse(true);
      const block=(focusNode.nodeType===Node.TEXT_NODE?focusNode.parentElement:focusNode).closest?.('p,div,li,pre,blockquote,h1,h2,h3,h4,h5,h6');
      const line=block&&editor.contains(block)?block:editor;
      const left=document.createRange(),right=document.createRange();
      left.selectNodeContents(line);left.setEnd(focusNode,focusOffset);
      right.selectNodeContents(line);right.setStart(focusNode,focusOffset);
      const removed=selection.isCollapsed&&focusNode.nodeType===Node.TEXT_NODE?triggerLength(focusNode.data.slice(0,focusOffset),()=>{
        const beforeNode=left.cloneRange();beforeNode.setEnd(focusNode,0);return edge(beforeNode,true);
      }):0;
      if(removed){point.setStart(focusNode,focusOffset-removed);left.setEnd(focusNode,focusOffset-removed);}
      before=edge(left,true);after=edge(right,false);
      selection.removeAllRanges();selection.addRange(point);
      restore=()=>selection.setBaseAndExtent(anchorNode,anchorOffset,focusNode,focusOffset);
    }
    try{if(document.execCommand('insertText',false,withNewlines(body,before,after)))return true;}catch{}
    restore();
    return false;
  }
  function syncIcons(icons){
    for(const [row,state] of icons){
      if(typeof row==='string')continue;
      const icon=row.querySelector('svg'),markup=icon?.outerHTML;
      if(state.markup===markup)continue;
      state.slot.replaceChildren(...(icon?[icon.cloneNode(true)]:[]));state.markup=markup;
    }
  }
  function build(root,entries,ordered,skillGroups,promptGroups){
    const available=new Map(entries.filter(({item})=>!isSkill(item.id)&&preferences[item.id]===true).map(entry=>[entry.item.id,entry]));
    const layout=ordered.map(group=>({id:group.id,entries:group.items.map(item=>available.get(item.id)).filter(Boolean)})).filter(group=>group.entries.length);
    layout.push(...skillGroups,...promptGroups);
    const signature=JSON.stringify(layout.map(group=>[group.id,group.entries.map(({row,item})=>[item.id,label(item),item.title,row.getAttribute?.('aria-disabled'),row.disabled])]));
    const old=views.get(root),sources=layout.flatMap(group=>group.entries.map(entry=>entry.row));
    if(old?.surface.isConnected&&old.signature===signature&&sources.length===old.sources.length&&sources.every((row,index)=>old.sources[index]===row)){syncIcons(old.icons);return;}
    old?.surface.remove();const surface=document.createElement('div');surface.dataset.bcCommandGrid='';
    const buttons=new Map(),icons=new Map();
    for(const group of layout){
      if(group.heading){const title=document.createElement('div');title.dataset.bcMenuHeading=group.id;title.textContent=group.heading;surface.append(title);}
      const line=document.createElement('div');line.dataset.bcCommandGroup=group.id;line.setAttribute('role','group');
      if(group.id==='skills')line.dataset.bcSkillRow='';
      if(group.id==='prompts')line.dataset.bcPromptRow='';
      line.setAttribute('aria-label',headings[group.id]||window.__codexHudI18n?.t(`commandGroup.${group.id}`)||group.id);
      for(const {row,item} of group.entries){
        const button=document.createElement('button');button.type='button';button.dataset.bcMenuButton=item.id;button.setAttribute('role','option');button.title=item.title;
        button.disabled=Boolean(row.disabled||row.getAttribute?.('aria-disabled')==='true'||!syntheticAvailable(item.id));
        // Native SVGs may mount after the menu is shown; their space is present from the first frame.
        if(!headings[group.id]){
          const slot=document.createElement('span');slot.dataset.bcMenuIcon='';slot.setAttribute('aria-hidden','true');button.append(slot);
          if(item.id==='ai-rename')slot.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>';
          else icons.set(row,{slot});
        }
        const text=document.createElement('span');text.textContent=label(item);button.append(text);button.tabIndex=-1;
        button.addEventListener('pointerdown',event=>event.preventDefault());
        button.addEventListener('click',event=>{if(typeof row==='string')event.stopPropagation();if(!button.disabled)run(root,row);});
        proxySources.set(button,row);buttons.set(row,button);line.append(button);
      }surface.append(line);
    }
    syncIcons(icons);surface.hidden=!layout.length;root.prepend(surface);views.set(root,{surface,buttons,sources,signature,icons});
  }
  function refresh(){
    queued=false;if(disposed)return;
    if(!enabled){closeStandalone();for(const root of [...openings.keys()])restore(root);for(const node of managed)clear(node);managed.clear();return;}
    if(nativeMenuOpen())closeStandalone();else if(standalone.open)renderStandalone();
    for(const root of openings.keys())if(!root.isConnected)restore(root);
    for(const node of [...managed])if(!node.isConnected){clear(node);managed.delete(node);}
    let changed=false;
    for(const root of document.querySelectorAll('[data-mention-list-scroll-area]')){
      const value=autocomplete(root);
      if(!eligible(root,value)){restore(root);continue;}
      const entries=[...root.querySelectorAll('[data-list-navigation-item="true"]')].map(row=>({row,item:metadata(row)}));
      const hasNativeRows=entries.length>0;
      // A changed native contract leaves the entire menu native.
      if(entries.some(entry=>!entry.item)){restore(root);continue;}
      const nativeSkills=entries.filter(({item})=>isSkill(item.id));
      for(const {item} of nativeSkills){
        const id=skillKey(item.title,item.id.slice(6));
        if(knownNativeSkills.get(id)!==item.title){knownNativeSkills.set(id,item.title);changed=true;}
      }
      const skillGroups=nameLayout('skills',nativeSkills.length?nativeSkills.filter(({item})=>showSkill(skillKey(item.title,item.id.slice(6)))):cachedSkills(focusedEditor(),value.ui.query));
      if(!hasNativeRows&&!skillGroups.length){restore(root);continue;}
      attribute(root,'data-bc-command-root','');
      attribute(root,'data-bc-command-empty',hasNativeRows?null:'');
      entries.unshift({row:'ai-rename',item:{id:'ai-rename',title:label({id:'ai-rename'})}});
      const extra=entries.filter(({item})=>!isSkill(item.id)&&!commands.some(command=>command.id===item.id)).map(({item})=>({...item,group:'other'}));
      if(!openings.has(root)){
        const opening={request:instance+':'+(++nextOpening),loaded:false,promptTimer:0,prompts:new Map(),promptGroups:[]};
        openings.set(root,opening);requestPrompts(opening);
      }
      const opening=openings.get(root);
      attribute(root,'data-bc-prompt-pending',opening.promptTimer?'':null);
      if(opening.promptTimer)continue;
      const ordered=orderedGroups(groupOrder,itemOrder,extra),flat=ordered.flatMap(group=>group.items);
      const skillRanks=new Map(skillGroups.flatMap(group=>group.entries).map(({item},index)=>[item.id,flat.length+index])),ranks=new Map(flat.map((item,index)=>[item.id,index]));
      for(const {row,item} of entries){
        if(typeof row==='string')continue;
        if(!isSkill(item.id)&&discovered.get(item.id)!==item.title){discovered.set(item.id,item.title);changed=true;}
        const visible=isSkill(item.id)?skillRanks.has(item.id):preferences[item.id]===true;
        attribute(row,'data-bc-command',item.id);attribute(row,'data-bc-command-hidden',visible?null:'');attribute(row,'data-bc-command-source','');
        const order=isSkill(item.id)?skillRanks.get(item.id):ranks.get(item.id);if(row.style.getPropertyValue('--bc-command-order')!==String(order))row.style.setProperty('--bc-command-order',String(order));
      }
      for(const section of root.querySelectorAll('[data-mention-section-id]')){
        attribute(section,'data-bc-command-section','');attribute(section,'data-bc-section-hidden',hasNativeRows&&!section.querySelector('[data-bc-command]:not([data-bc-command-hidden]):not([data-bc-command-source])')?'':null);
      }
      build(root,entries,ordered,skillGroups,opening.promptGroups);
      const visible=rows(root),native=visible.find(row=>typeof row!=='string'&&(row.getAttribute('aria-current')==='true'||row.getAttribute('aria-selected')==='true')),selected=selections.get(root);
      select(root,visible.includes(selected)?selected:native||visible[0]);if(root.scrollLeft)root.scrollLeft=0;
    }
    if(changed)window.dispatchEvent(new Event('better-codex-command-catalog'));
  }
  function schedule(){if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}}
  const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current','aria-disabled','disabled']});
  function keydown(event){
    const groupJump=event.ctrlKey&&['ArrowUp','ArrowDown'].includes(event.key);
    const focused=focusedEditor(),standaloneFocused=standalone.open&&focused?.editor===standalone.editor;
    const standaloneRoot=standaloneFocused&&standalone.element&&!standalone.element.hidden?standalone.element:null;
    const standaloneWaiting=standaloneFocused&&standalone.promptTimer;
    if(event.key==='Escape'&&(standaloneRoot||standaloneWaiting)&&!event.defaultPrevented&&!event.isComposing){event.preventDefault();event.stopImmediatePropagation();closeStandalone();return;}
    if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey&&!groupJump||event.metaKey||event.shiftKey||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter','Tab'].includes(event.key))return;
    const roots=[...document.querySelectorAll('[data-mention-list-scroll-area]')].filter(root=>eligible(root)&&root.getBoundingClientRect().width>0&&(views.has(root)||root.hasAttribute('data-bc-prompt-pending')));
    if(roots.length>1||!roots.length&&!standaloneRoot&&!standaloneWaiting||event.composedPath().some(node=>node?.id==='codex-composer-hud'))return;
    const root=roots[0]||standaloneRoot;
    event.preventDefault();event.stopImmediatePropagation();
    if(!root||root.hasAttribute('data-bc-prompt-pending'))return;
    const visible=rows(root),selected=selections.get(root);
    if(event.key==='Enter'||event.key==='Tab'){if(visible.length)run(root,visible.includes(selected)?selected:visible[0]);return;}
    if(!visible.length)return;
    const available=new Set(visible);
    const lines=[...root.querySelectorAll('[data-bc-command-group]')].map(line=>({id:line.dataset.bcCommandGroup,items:[...line.children].map(button=>proxySources.get(button)).filter(row=>available.has(row))})).filter(line=>line.items.length);
    let y=lines.findIndex(line=>line.items.includes(selected));if(y<0)y=0;let x=Math.max(0,lines[y].items.indexOf(selected)),next;
    if(event.key==='Home'||event.key==='End'){next=event.key==='Home'?visible[0]:visible.at(-1);columns.delete(root);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){const line=lines[y].items;x=(x+(event.key==='ArrowLeft'?-1:1)+line.length)%line.length;next=line[x];columns.set(root,x);}
    else{
      const desired=columns.get(root)??x,direction=event.key==='ArrowUp'?-1:1;
      let line;
      if(groupJump){
        const groups=[...new Set(lines.map(line=>line.id))],index=groups.indexOf(lines[y].id),target=groups[(index+direction+groups.length)%groups.length];
        const candidates=lines.filter(line=>line.id===target).map(line=>line.items);
        if(direction<0)candidates.reverse();
        line=candidates.find(items=>items.length>desired)||candidates.reduce((best,items)=>items.length>best.length?items:best);
      }else line=lines[(y+direction+lines.length)%lines.length].items;
      next=line[Math.min(desired,line.length-1)];columns.set(root,desired);
    }
    select(root,next);const target=visual(root,next),bounds=root.getBoundingClientRect(),rect=target.getBoundingClientRect();if(rect.top<bounds.top)root.scrollTop-=bounds.top-rect.top;else if(rect.bottom>bounds.bottom)root.scrollTop+=rect.bottom-bounds.bottom;
    const line=target.closest('[data-bc-command-group]');if(line){const box=line.getBoundingClientRect();if(rect.left<box.left)line.scrollLeft-=box.left-rect.left;else if(rect.right>box.right)line.scrollLeft+=rect.right-box.right;}
  }
  function pointermove(event){const button=event.target.closest?.('[data-bc-menu-button]'),row=button?proxySources.get(button):event.target.closest?.('[data-bc-command]:not([data-bc-command-hidden])'),root=(button||row)?.closest('[data-mention-list-scroll-area],[data-bc-standalone-root]');if(row&&root&&(root===standalone.element||eligible(root))){columns.delete(root);select(root,row);}}
  function input(event){
    const target=event.target;
    if(target?.matches?.('[contenteditable="true"],[contenteditable="plaintext-only"],textarea')&&target.closest?.('[data-codex-composer-root]'))scheduleStandalone();
  }
  function outside(event){
    if(standalone.open&&!standalone.element?.contains(event.target)&&!event.target.closest?.('[data-codex-composer-root]'))closeStandalone();
  }
  function applyPrompts(requests,entries,keep){
    const targets=[...openings].filter(([root,opening])=>root.isConnected&&eligible(root)&&!opening.loaded&&requests.includes(opening.request));
    const standaloneTarget=standalone.open&&!standalone.loaded&&requests.includes(standalone.request);
    if(!targets.length&&!standaloneTarget)return;
    if(keep)lastPrompts=entries;
    const prompts=new Map(entries.map(({name,body})=>['prompt:'+name,body]));
    const promptGroups=nameLayout('prompts',entries.map(({name})=>{const id='prompt:'+name;return {row:id,item:{id,title:name}};}));
    for(const [,opening] of targets){clearTimeout(opening.promptTimer);opening.promptTimer=0;opening.prompts=prompts;opening.promptGroups=promptGroups;opening.loaded=true;}
    if(standaloneTarget){clearTimeout(standalone.promptTimer);standalone.promptTimer=0;standalone.entries=entries;standalone.loaded=true;}
    refresh();
  }
  window.addEventListener('keydown',keydown,true);window.addEventListener('mousemove',pointermove,true);
  document.addEventListener('input',input,true);document.addEventListener('pointerdown',outside,true);window.addEventListener('resize',positionStandalone);
  window.__codexCommandMenu={catalog,skillEntries,update(value,order){if(typeof order?.enabled==='boolean')enabled=order.enabled;preferences=normalize(value);skillVisible=normalizeSkillVisible(order?.skillVisible??skillVisible);groupOrder=normalizeGroupOrder(order?.groupOrder??groupOrder);itemOrder=normalizeItemOrder(order?.itemOrder??itemOrder);refresh();},entries(){return [...discovered].filter(([id])=>!commands.some(item=>item.id===id)).map(([id,title])=>({id,title,group:'other'}));},
    promptRequests(){const requests=[...openings].filter(([root,opening])=>root.isConnected&&eligible(root)&&!opening.loaded).map(([,opening])=>opening.request);if(standalone.open&&!standalone.loaded)requests.push(standalone.request);return requests;},
    promptState({requests,entries}){applyPrompts(requests,entries,true);},
    remove(){disposed=true;closeStandalone();observer.disconnect();window.removeEventListener('keydown',keydown,true);window.removeEventListener('mousemove',pointermove,true);document.removeEventListener('input',input,true);document.removeEventListener('pointerdown',outside,true);window.removeEventListener('resize',positionStandalone);for(const view of views.values())view.surface.remove();views.clear();for(const root of openings.keys())restore(root);for(const node of managed)clear(node);managed.clear();standalone.element?.remove();style.remove();delete window.__codexCommandMenu;}};
  refresh();
})();
