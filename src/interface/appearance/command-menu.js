// Native slash-menu metadata only. Never read drafts/messages or change React state.
(() => {
  const groups=[['chat',['new','rename','archive']],['context',['side','fork','compact']],['project',['init','review-mode']],['organize',['pin','share','delete']],['model',['model','reasoning','service-tier:priority']],['workflow',['plan-mode','goal']],['tools',['mcp','ide-context']],['creative',['sketch','pet']],['help',['status','usage','feedback']],['other',[]]];
  const initial=new Set(['new','rename','archive','side','fork','compact','init','review-mode']);
  const shortened=new Set(['pin','share','delete','mcp','usage']);
  const commands=groups.flatMap(([group,ids])=>ids.map(id=>({id,group,label:'command.'+id,shortLabel:(shortened.has(id)?'commandShort.':'command.')+id})));
  const defaults=Object.fromEntries(commands.map(item=>[item.id,initial.has(item.id)]));
  const isSkill=id=>id.startsWith('skill:');
  function normalize(value){return {...defaults,...Object.fromEntries(Object.entries(value&&typeof value==='object'&&!Array.isArray(value)?value:{}).filter(([id,on])=>id.length>0&&id.length<1024&&typeof on==='boolean'))};}
  function normalizeGroupOrder(value){
    const saved=Array.isArray(value)?value:[],secondary=groups.slice(3,-1).map(([id])=>id);
    const legacy=saved.includes('other')&&!saved.some(id=>secondary.includes(id));
    return [...new Set([...saved.flatMap(id=>id==='other'&&legacy?[...secondary,id]:[id]).filter(id=>groups.some(([group])=>group===id)),...groups.map(([id])=>id)])];
  }
  function normalizeItemOrder(value){return Object.fromEntries(groups.map(([group,ids])=>{
    const saved=Array.isArray(value?.[group])?value[group]:Array.isArray(value?.other)?value.other:[];
    return [group,[...new Set([...saved.filter(id=>typeof id==='string'&&id.length>0&&id.length<1024&&!isSkill(id)&&(group==='other'?!commands.some(item=>item.id===id):ids.includes(id))),...ids])]];
  }));}
  function orderedGroups(groupOrder,itemOrder,extra=[]){const order=normalizeItemOrder(itemOrder);return normalizeGroupOrder(groupOrder).map(group=>({id:group,items:[...commands,...extra].filter(item=>item.group===group&&!isSkill(item.id)).sort((a,b)=>{const rank=id=>order[group].includes(id)?order[group].indexOf(id):order[group].length+extra.findIndex(item=>item.id===id);return rank(a.id)-rank(b.id);})}));}
  const catalog={groups,commands,defaults,normalize,isSkill,normalizeGroupOrder,normalizeItemOrder,orderedGroups};
  if(typeof module==='object'&&module.exports){module.exports=catalog;return;}
  if(window.__codexCommandMenu)return;
  let preferences=normalize(),groupOrder=normalizeGroupOrder(),itemOrder=normalizeItemOrder(),enabled=true,disposed=false,queued=false;
  const discovered=new Map(),managed=new Set(),selections=new WeakMap(),views=new Map(),proxySources=new WeakMap(),columns=new WeakMap();
  const style=document.createElement('style');style.id='better-codex-command-menu-style';
  // Native rows use viewport intersection to replace offscreen icons with text placeholders.
  // Keep source geometry in the viewport without exposing or laying out duplicate controls.
  style.textContent=`[data-bc-command-hidden]{display:none!important}
    [data-bc-command-source]{display:block!important;position:absolute!important;top:0;left:0;width:100%;visibility:hidden;pointer-events:none}
    [data-bc-section-hidden]{display:block!important;position:absolute!important;top:0;left:0;width:100%;height:0;visibility:hidden;pointer-events:none}
    [data-bc-command-root]{position:relative;display:flex;flex-direction:column;overflow-x:hidden!important;scrollbar-gutter:stable}
    [data-bc-command-section]{order:1;flex-shrink:0}
    [data-bc-command-grid]{order:0;display:grid;gap:4px;padding:4px;flex-shrink:0;min-width:0}
    [data-bc-command-grid][hidden]{display:none}
    [data-bc-command-group]{display:flex;flex-wrap:nowrap;gap:4px;overflow-x:auto;scrollbar-width:thin;min-width:0}
    [data-bc-menu-button]{display:inline-flex;align-items:center;justify-content:flex-start;gap:6px;flex:0 0 auto;max-width:100%;height:32px;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;line-height:1.25;white-space:nowrap;cursor:pointer;text-align:start}
    [data-bc-menu-icon]{display:grid;place-items:center;flex:0 0 16px;width:16px;height:16px}
    [data-bc-menu-icon] svg{width:100%;height:100%}
    [data-bc-menu-button] span{overflow:hidden;text-overflow:ellipsis}
    [data-bc-menu-button]:disabled{opacity:.4;cursor:default}
    [data-bc-menu-button]:focus-visible{outline:2px solid var(--codex-base-accent,currentColor);outline-offset:-2px}
    [data-bc-active]{background:var(--color-background-secondary,#ffffff14)!important}
    [data-bc-command]:not([data-bc-active]){background:transparent!important}`;
  document.head.append(style);
  const fiber=node=>node?.[Object.keys(node).find(key=>key.startsWith('__reactFiber$'))];
  function autocomplete(root){for(let current=fiber(root),depth=0;current&&depth<24;current=current.return,depth++){const value=current.memoizedProps?.autocomplete;if(value)return value;}return null;}
  function metadata(row){for(let current=fiber(row),depth=0;current&&depth<5;current=current.return,depth++){const item=current.memoizedProps?.children?.props?.item;if(item&&typeof item.id==='string'&&typeof item.title==='string')return {id:item.id,title:item.title};}return null;}
  function attribute(node,key,value){managed.add(node);if(value===null){if(node.hasAttribute(key))node.removeAttribute(key);}else if(node.getAttribute(key)!==value)node.setAttribute(key,value);}
  function clear(node){for(const name of ['data-bc-command-root','data-bc-command-section','data-bc-command','data-bc-command-hidden','data-bc-command-source','data-bc-section-hidden','data-bc-active'])node.removeAttribute(name);node.style?.removeProperty('--bc-command-order');}
  function restore(root){views.get(root)?.surface.remove();views.delete(root);selections.delete(root);columns.delete(root);for(const node of [...managed])if(root.contains(node)){clear(node);managed.delete(node);}}
  function eligible(root){const value=autocomplete(root);return enabled&&value?.ui?.active===true&&value.ui.trigger==='/'&&!value.submenuCommand;}
  function rows(root){return [...root.querySelectorAll('[data-list-navigation-item="true"]')].filter(row=>row.hasAttribute('data-bc-command')&&!row.hasAttribute('data-bc-command-hidden')&&row.getAttribute('aria-disabled')!=='true'&&!row.disabled).sort((a,b)=>Number(a.style.getPropertyValue('--bc-command-order'))-Number(b.style.getPropertyValue('--bc-command-order')));}
  function visual(root,row){return views.get(root)?.buttons.get(row)||row;}
  function select(root,row){selections.set(root,row);for(const node of root.querySelectorAll('[data-bc-command]'))attribute(node,'data-bc-active',node===row?'':null);for(const [source,button] of views.get(root)?.buttons||[]){button.toggleAttribute('data-bc-active',source===row);button.setAttribute('aria-selected',String(source===row));}}
  function label(item){const known=commands.find(command=>command.id===item.id);return known&&window.__codexHudI18n?window.__codexHudI18n.t(known.shortLabel):item.title;}
  function syncIcons(icons){
    for(const [row,state] of icons){
      const icon=row.querySelector('svg'),markup=icon?.outerHTML;
      if(state.markup===markup)continue;
      state.slot.replaceChildren(...(icon?[icon.cloneNode(true)]:[]));state.markup=markup;
    }
  }
  function build(root,entries,ordered){
    const available=new Map(entries.filter(({item})=>!isSkill(item.id)&&preferences[item.id]===true).map(entry=>[entry.item.id,entry]));
    const layout=ordered.map(group=>({id:group.id,entries:group.items.map(item=>available.get(item.id)).filter(Boolean)})).filter(group=>group.entries.length);
    const signature=JSON.stringify(layout.map(group=>[group.id,group.entries.map(({row,item})=>[item.id,label(item),item.title,row.getAttribute('aria-disabled'),row.disabled])]));
    const old=views.get(root),sources=layout.flatMap(group=>group.entries.map(entry=>entry.row));
    if(old?.surface.isConnected&&old.signature===signature&&sources.length===old.sources.length&&sources.every((row,index)=>old.sources[index]===row)){syncIcons(old.icons);return;}
    old?.surface.remove();const surface=document.createElement('div');surface.dataset.bcCommandGrid='';
    const buttons=new Map(),icons=new Map();
    for(const group of layout){const line=document.createElement('div');line.dataset.bcCommandGroup=group.id;line.setAttribute('role','group');line.setAttribute('aria-label',window.__codexHudI18n?.t(`commandGroup.${group.id}`)||group.id);
      for(const {row,item} of group.entries){
        const button=document.createElement('button');button.type='button';button.dataset.bcMenuButton=item.id;button.setAttribute('role','option');button.title=item.title;button.disabled=row.disabled||row.getAttribute('aria-disabled')==='true';
        // Native SVGs may mount after the menu is shown; their space is present from the first frame.
        const slot=document.createElement('span');slot.dataset.bcMenuIcon='';slot.setAttribute('aria-hidden','true');button.append(slot);icons.set(row,{slot});
        const text=document.createElement('span');text.textContent=label(item);button.append(text);button.tabIndex=-1;
        button.addEventListener('pointerdown',event=>event.preventDefault());
        button.addEventListener('click',()=>{if(row.isConnected&&eligible(root)&&!row.hasAttribute('data-bc-command-hidden')&&!button.disabled)row.click();});
        proxySources.set(button,row);buttons.set(row,button);line.append(button);
      }surface.append(line);
    }
    syncIcons(icons);surface.hidden=!layout.length;root.prepend(surface);views.set(root,{surface,buttons,sources,signature,icons});
  }
  function refresh(){
    queued=false;if(disposed)return;
    if(!enabled){for(const root of [...views.keys()])restore(root);for(const node of managed)clear(node);managed.clear();return;}
    for(const [root,view] of views)if(!root.isConnected){view.surface.remove();views.delete(root);}
    for(const node of [...managed])if(!node.isConnected)managed.delete(node);
    let changed=false;
    for(const root of document.querySelectorAll('[data-mention-list-scroll-area]')){
      if(!eligible(root)){restore(root);continue;}
      const entries=[...root.querySelectorAll('[data-list-navigation-item="true"]')].map(row=>({row,item:metadata(row)}));
      // A changed native contract leaves the entire menu native.
      if(!entries.length||entries.some(entry=>!entry.item)){restore(root);continue;}
      attribute(root,'data-bc-command-root','');
      const extra=entries.filter(({item})=>!isSkill(item.id)&&!commands.some(command=>command.id===item.id)).map(({item})=>({...item,group:'other'}));
      const ordered=orderedGroups(groupOrder,itemOrder,extra),flat=ordered.flatMap(group=>group.items),ranks=new Map(flat.map((item,index)=>[item.id,index]));let skillIndex=0;
      for(const {row,item} of entries){
        if(!isSkill(item.id)&&discovered.get(item.id)!==item.title){discovered.set(item.id,item.title);changed=true;}
        attribute(row,'data-bc-command',item.id);attribute(row,'data-bc-command-hidden',isSkill(item.id)||preferences[item.id]===true?null:'');attribute(row,'data-bc-command-source',isSkill(item.id)?null:'');
        const order=isSkill(item.id)?flat.length+skillIndex++:ranks.get(item.id);if(row.style.getPropertyValue('--bc-command-order')!==String(order))row.style.setProperty('--bc-command-order',String(order));
      }
      for(const section of root.querySelectorAll('[data-mention-section-id]')){
        attribute(section,'data-bc-command-section','');attribute(section,'data-bc-section-hidden',section.querySelector('[data-bc-command]:not([data-bc-command-hidden]):not([data-bc-command-source])')?null:'');
      }
      build(root,entries,ordered);
      const visible=rows(root),native=visible.find(row=>row.getAttribute('aria-current')==='true'||row.getAttribute('aria-selected')==='true'),selected=selections.get(root);
      select(root,visible.includes(selected)?selected:native||visible[0]);if(root.scrollLeft)root.scrollLeft=0;
    }
    if(changed)window.dispatchEvent(new Event('better-codex-command-catalog'));
  }
  function schedule(){if(!queued&&!disposed){queued=true;queueMicrotask(refresh);}}
  const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-current','aria-disabled','disabled']});
  function keydown(event){
    if(event.defaultPrevented||event.isComposing||event.keyCode===229||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter','Tab'].includes(event.key))return;
    const roots=[...document.querySelectorAll('[data-mention-list-scroll-area]')].filter(root=>eligible(root)&&root.getBoundingClientRect().width>0&&root.querySelector('[data-bc-command]'));
    if(roots.length!==1||event.composedPath().some(node=>node?.id==='codex-composer-hud'))return;
    const root=roots[0],visible=rows(root),selected=selections.get(root);
    event.preventDefault();event.stopImmediatePropagation();
    if(event.key==='Enter'||event.key==='Tab'){if(visible.includes(selected))selected.click();else visible[0]?.click();return;}
    if(!visible.length)return;
    const lines=[...root.querySelectorAll('[data-bc-command-group]')].map(line=>[...line.children].map(button=>proxySources.get(button)).filter(row=>visible.includes(row))).filter(line=>line.length);
    lines.push(...visible.filter(row=>isSkill(row.dataset.bcCommand)).map(row=>[row]));
    let y=lines.findIndex(line=>line.includes(selected));if(y<0)y=0;let x=Math.max(0,lines[y].indexOf(selected)),next;
    if(event.key==='Home'||event.key==='End'){next=event.key==='Home'?visible[0]:visible.at(-1);columns.delete(root);}
    else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){x=(x+(event.key==='ArrowLeft'?-1:1)+lines[y].length)%lines[y].length;next=lines[y][x];columns.set(root,x);}
    else{const desired=columns.get(root)??x;y=(y+(event.key==='ArrowUp'?-1:1)+lines.length)%lines.length;next=lines[y][Math.min(desired,lines[y].length-1)];columns.set(root,desired);}
    select(root,next);const target=visual(root,next),bounds=root.getBoundingClientRect(),rect=target.getBoundingClientRect();if(rect.top<bounds.top)root.scrollTop-=bounds.top-rect.top;else if(rect.bottom>bounds.bottom)root.scrollTop+=rect.bottom-bounds.bottom;
    const line=target.closest('[data-bc-command-group]');if(line){const box=line.getBoundingClientRect();if(rect.left<box.left)line.scrollLeft-=box.left-rect.left;else if(rect.right>box.right)line.scrollLeft+=rect.right-box.right;}
  }
  function pointermove(event){const button=event.target.closest?.('[data-bc-menu-button]'),row=button?proxySources.get(button):event.target.closest?.('[data-bc-command]:not([data-bc-command-hidden])'),root=row?.closest('[data-mention-list-scroll-area]');if(root&&eligible(root)){columns.delete(root);select(root,row);}}
  window.addEventListener('keydown',keydown,true);window.addEventListener('mousemove',pointermove,true);
  window.__codexCommandMenu={catalog,update(value,order){if(typeof order?.enabled==='boolean')enabled=order.enabled;preferences=normalize(value);groupOrder=normalizeGroupOrder(order?.groupOrder??groupOrder);itemOrder=normalizeItemOrder(order?.itemOrder??itemOrder);refresh();},entries(){return [...discovered].filter(([id])=>!commands.some(item=>item.id===id)).map(([id,title])=>({id,title,group:'other'}));},
    remove(){disposed=true;observer.disconnect();window.removeEventListener('keydown',keydown,true);window.removeEventListener('mousemove',pointermove,true);for(const view of views.values())view.surface.remove();views.clear();for(const node of managed)clear(node);managed.clear();style.remove();delete window.__codexCommandMenu;}};
  refresh();
})();
