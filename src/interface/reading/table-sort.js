// Sort keys live only in page memory. Source rows and Markdown stay in their original order.
(() => {
  if(window.__codexTableSort)return false;
  const marker='data-codex-table-sort-header', control='data-codex-table-sort-control';
  const states=new Map(), style=document.createElement('style');
  style.id='codex-table-sort';
  style.textContent=`[${marker}]{cursor:var(--cursor-interaction,pointer);}[${control}]{display:inline-flex;margin-inline-start:5px;vertical-align:middle;line-height:0;}[data-codex-hud-table-measuring] [${control}]{display:none!important;}`;
  // Lucide geometry; ISC/MIT notices are preserved in THIRD_PARTY_NOTICES.md.
  const icons={
    'small-first':'<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h4"/><path d="M11 8h7"/><path d="M11 12h10"/>',
    'large-first':'<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/>'
  };
  const normalize=value=>value.normalize('NFKC').trim().replace(/\s+/g,' ');
  const blank=value=>!value || /^(?:[-–—]|n\/a)$/i.test(value);
  const t=(key,values={})=>window.__codexHudI18n?.t(key,values)??key;
  let pending=null, stopped=false, enabled=true, ctrlDown=false, controlSession=0, defaultMode='smart';
  function number(value) {
    const negative=value.startsWith('(')&&value.endsWith(')');
    if(negative)value=value.slice(1,-1).trim();
    value=value.replace(/^([+-])\s*([¥$€£])/,'$2$1');
    const match=value.match(/^(?:([¥$€£])\s*)?([+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*([%\p{L}]+)?$/iu);
    if(!match)return null;
    const numeric=Number(match[2].replaceAll(',',''));
    return Number.isFinite(numeric)?{value:negative?-Math.abs(numeric):numeric,unit:(match[1]||'')+(match[3]||'')}:null;
  }
  function serial(values) {
    const ids=values.map(value=>value.match(/^([a-z]{0,8})(\d+)$/i));
    if(!ids.length || ids.some(id=>!id||!Number.isSafeInteger(Number(id[2]))))return false;
    const prefix=ids[0][1].toUpperCase();
    if(ids.some(id=>id[1].toUpperCase()!==prefix))return false;
    if(prefix)return true;
    if(ids.length<3)return false;
    const step=Number(ids[1][2])-Number(ids[0][2]);
    return Math.abs(step)===1&&ids.every((id,index)=>!index||Number(id[2])-Number(ids[index-1][2])===step);
  }
  function profiles(state,rows) {
    if(state.profiles&&state.profiles.rows.length===rows.length&&rows.every((row,index)=>state.profiles.rows[index]===row))return state.profiles;
    const columns=state.controls.map((_,column)=>{
      const values=rows.map(row=>{const value=normalize(row.cells[column].textContent);return {value,empty:blank(value),number:number(value)};});
      const filled=values.filter(value=>!value.empty);
      return {values,numeric:filled.length>0&&filled.every(value=>value.number&&value.number.unit===filled[0].number?.unit),serial:serial(filled.map(value=>value.value))};
    });
    state.profiles={rows:[...rows],columns,collator:new Intl.Collator(window.__codexHudI18n?.locale()||document.documentElement.lang||'zh-CN',{numeric:true,sensitivity:'base'})};
    state.order=null;
    return state.profiles;
  }
  const direction=(state,column,data)=>state.directions.get(column)??(defaultMode==='ascending'?1:defaultMode==='descending'?-1:data.columns[column].serial?1:-1);
  function restorePadding(entry) {
    if(!entry.reserved)return;
    if(entry.header.style.getPropertyValue('padding-inline-end')===entry.appliedPadding){
      if(entry.originalPadding)entry.header.style.setProperty('padding-inline-end',entry.originalPadding,entry.paddingPriority);else entry.header.style.removeProperty('padding-inline-end');
      if(!entry.hadStyle&&!entry.header.style.length)entry.header.removeAttribute('style');
    }
    entry.reserved=false;
  }
  function reserveActions(state) {
    const container=state.table.closest('[data-markdown-table]');
    const buttons=[...container.querySelectorAll('button,[role="button"]')].filter(button=>!state.table.contains(button)).map(button=>button.getBoundingClientRect()).filter(box=>box.width>0&&box.height>0);
    for(const entry of state.controls){
      const box=entry.header.getBoundingClientRect(),rtl=getComputedStyle(entry.header).direction==='rtl';
      if(!entry.reserved)entry.basePadding=parseFloat(getComputedStyle(entry.header).paddingInlineEnd);
      let needed=0;
      for(const button of buttons)if(button.left<box.right&&button.right>box.left&&button.top<box.bottom&&button.bottom>box.top)needed=Math.max(needed,rtl?button.right-box.left+6:box.right-button.left+6);
      if(needed<=entry.basePadding){restorePadding(entry);continue;}
      if(!entry.reserved){entry.originalPadding=entry.header.style.getPropertyValue('padding-inline-end');entry.paddingPriority=entry.header.style.getPropertyPriority('padding-inline-end');entry.hadStyle=entry.header.hasAttribute('style');entry.reserved=true;}
      const value=`${Math.ceil(needed)}px`;
      if(entry.header.style.getPropertyValue('padding-inline-end')!==value)entry.header.style.setProperty('padding-inline-end',value,'important');
      entry.appliedPadding=entry.header.style.getPropertyValue('padding-inline-end');
    }
  }
  function restoreRow(state,row) {
    const move=state.moves.get(row);
    if(!move)return;
    // Yield if the application has replaced our temporary style meanwhile.
    if(row.style.getPropertyValue('translate')===move.value){
      if(move.original)row.style.setProperty('translate',move.original,move.priority);else row.style.removeProperty('translate');
      if(!move.hadStyle&&!row.style.length)row.removeAttribute('style');
    }
    state.moves.delete(row);
  }
  function moveRow(state,row,delta) {
    if(Math.abs(delta)<.01){restoreRow(state,row);return;}
    let move=state.moves.get(row);
    if(!move){
      move={original:row.style.getPropertyValue('translate'),priority:row.style.getPropertyPriority('translate'),hadStyle:row.hasAttribute('style')};
      state.moves.set(row,move);
    }
    const value=`0px ${Number(delta.toFixed(3))}px`;
    if(row.style.getPropertyValue('translate')!==value)row.style.setProperty('translate',value,'important');
    move.value=row.style.getPropertyValue('translate');move.delta=Number(delta.toFixed(3));
  }
  function structure(table) {
    const container=table.closest('[data-markdown-table]');
    if(!container?.closest('.thread-scroll-container') || container.closest('[data-conversation-print]'))return null;
    if(container.closest('[data-markdown-text-style]')?.getAttribute('data-markdown-text-style')!=='assistant-message')return null;
    if(container.querySelector(':scope > [class*="TableScroller"] > [class*="TableWrapper"] > table')!==table)return null;
    if(table.tHead?.rows.length!==1 || table.tBodies.length!==1)return null;
    const headers=[...table.tHead.rows[0].cells], rows=[...table.tBodies[0].rows], state=states.get(table);
    if(!headers.length || headers.some(cell=>cell.tagName!=='TH') || rows.length<2)return null;
    if([...headers,...rows.flatMap(row=>[...row.cells])].some(cell=>cell.colSpan!==1 || cell.rowSpan!==1))return null;
    if(rows.some(row=>row.cells.length!==headers.length))return null;
    if(rows.some(row=>{
      const move=state?.moves.get(row);
      return !(move&&row.style.getPropertyValue('translate')===move.value)&&!['none','0px'].includes(getComputedStyle(row).translate);
    }))return null;
    return {headers,rows};
  }
  function labels(state,data) {
    for(const [index,entry] of state.controls.entries()){
      const rank=state.keys.findIndex(key=>key.column===index),active=rank>=0;
      const current=active?state.keys[rank].direction:direction(state,index,data);
      const priority=active&&state.multi?t('tableSortPriority',{count:rank+1}):'';
      const label=t('tableSortHint',{column:entry.header.textContent.trim(),direction:t(current===1?'tableSortSmallFirst':'tableSortLargeFirst'),priority:priority?` · ${priority}`:''});
      entry.button.setAttribute('aria-label',label);entry.button.title=label;
      entry.button.toggleAttribute('data-active',active);
      entry.button.toggleAttribute('data-preset',!active&&state.directions.has(index));
      entry.rank.hidden=!(active&&state.multi);entry.rank.textContent=entry.rank.hidden?'':String(rank+1);
      const icon=current===1?'small-first':'large-first';
      if(entry.symbol.dataset.icon!==icon){
        entry.symbol.dataset.icon=icon;
        entry.symbol.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icons[icon]}</svg>`;
      }
      entry.header.setAttribute('aria-sort',active?(rank===0?(current===1?'ascending':'descending'):'other'):'none');
      entry.header.setAttribute('data-codex-sort-direction',current===1?'ascending':'descending');
      if(active)entry.header.setAttribute('data-codex-sort-rank',String(rank+1));else entry.header.removeAttribute('data-codex-sort-rank');
    }
    reserveActions(state);
  }
  function render(state,rows) {
    const keep=new Set(rows);
    for(const row of state.rows)if(!keep.has(row)){restoreRow(state,row);resizer.unobserve(row);}
    for(const row of rows)if(!state.rows.has(row))resizer.observe(row);
    state.rows=keep;
    const data=profiles(state,rows);labels(state,data);
    if(!state.keys.length){for(const row of state.moves.keys())restoreRow(state,row);return;}
    const orderKey=state.keys.map(key=>`${key.column}:${key.direction}`).join(',');
    if(!state.order||state.orderKey!==orderKey){
      state.order=rows.map((_,index)=>index).sort((a,b)=>{
        for(const key of state.keys){
          const column=data.columns[key.column],left=column.values[a],right=column.values[b];
          if(left.empty!==right.empty)return left.empty?1:-1;
          const difference=left.empty?0:column.numeric?left.number.value-right.number.value:data.collator.compare(left.value,right.value);
          if(difference)return difference*key.direction;
        }
        return a-b;
      });state.orderKey=orderKey;
    }
    const boxes=new Map(rows.map(row=>{
      const box=row.getBoundingClientRect(), move=state.moves.get(row);
      const delta=move&&row.style.getPropertyValue('translate')===move.value?move.delta:0;
      return [row,{top:box.top-delta,height:box.height}];
    }));
    const first=boxes.get(rows[0]), second=boxes.get(rows[1]);
    const gap=Math.max(0,second.top-first.top-first.height);
    let top=first.top;
    for(const index of state.order){const row=rows[index],box=boxes.get(row);moveRow(state,row,top-box.top);top+=box.height+gap;}
  }
  function register(table,headers,headings,previous) {
    const state={table,headings,keys:previous?.keys??[],directions:previous?.directions??new Map(),
      multi:previous?.multi??false,session:previous?.session??-1,controls:[],rows:new Set(),moves:new Map(),profiles:null,order:null};
    if(!style.isConnected)document.head.append(style);
    for(const [index,header] of headers.entries()){
      const host=document.createElement('span');host.setAttribute(control,'');
      const shadow=host.attachShadow({mode:'open'});
      shadow.innerHTML='<style>:host{display:inline-flex}button{all:unset;display:inline-flex;align-items:center;justify-content:center;gap:2px;min-width:18px;height:20px;font:inherit;line-height:1;color:inherit;opacity:.45;cursor:var(--cursor-interaction,pointer);border-radius:3px}button:hover,button:focus-visible,button[data-active]{opacity:1}button[data-preset]{opacity:.7}button:focus-visible{outline:1px solid currentColor;outline-offset:1px}svg{display:block;width:16px;height:16px;pointer-events:none}[data-priority]{font-size:11px;line-height:1;font-variant-numeric:tabular-nums}[hidden]{display:none!important}</style><button type="button"><span data-symbol aria-hidden="true"></span><span data-priority aria-hidden="true" hidden></span></button>';
      const button=shadow.querySelector('button'), symbol=shadow.querySelector('[data-symbol]'), rank=shadow.querySelector('[data-priority]');
      const aria=header.getAttribute('aria-sort');
      header.setAttribute(marker,'');header.append(host);
      const click=event=>{
        if(event.defaultPrevented || event.button!==0 || event.detail>1)return;
        const buttonClick=event.composedPath().includes(button), selection=window.getSelection();
        if(!buttonClick&&selection&&!selection.isCollapsed&&header.contains(selection.anchorNode))return;
        if(!buttonClick&&event.target.closest?.('a,button,input,select,textarea,[contenteditable="true"]'))return;
        event.preventDefault();event.stopPropagation();
        const current=structure(table);if(!current||table.getBoundingClientRect().width<=0)return;
        const data=profiles(state,current.rows),preferred=direction(state,index,data),selected=state.keys.find(key=>key.column===index);
        if(event.altKey){
          const next=-(selected?.direction??preferred);state.directions.set(index,next);if(selected)selected.direction=next;
        }else if(event.ctrlKey){
          if(!ctrlDown){ctrlDown=true;controlSession++;}
          if(state.session!==controlSession){state.keys=[];state.session=controlSession;}
          state.multi=true;if(!state.keys.some(key=>key.column===index))state.keys.push({column:index,direction:preferred});
        }else{
          state.multi=false;
          if(state.keys.length===1&&selected)state.keys=selected.direction===preferred?[{column:index,direction:-preferred}]:[];
          else state.keys=[{column:index,direction:preferred}];
        }
        state.order=null;render(state,current.rows);
      };
      header.addEventListener('click',click);
      state.controls.push({header,host,button,symbol,rank,aria,click,reserved:false});
    }
    states.set(table,state);resizer.observe(table);
    return state;
  }
  function unregister(state) {
    for(const row of state.moves.keys())restoreRow(state,row);
    for(const row of state.rows)resizer.unobserve(row);
    resizer.unobserve(state.table);
    for(const entry of state.controls){
      entry.header.removeEventListener('click',entry.click);entry.host.remove();entry.header.removeAttribute(marker);
      restorePadding(entry);entry.header.removeAttribute('data-codex-sort-direction');entry.header.removeAttribute('data-codex-sort-rank');
      if(entry.aria===null)entry.header.removeAttribute('aria-sort');else entry.header.setAttribute('aria-sort',entry.aria);
    }
    states.delete(state.table);
  }
  function scan() {
    if(stopped||!enabled)return;
    const next=new Set();
    for(const table of document.querySelectorAll('.thread-scroll-container [data-markdown-table] table')){
      const current=structure(table);if(!current)continue;
      let state=states.get(table);
      if(table.getBoundingClientRect().width<=0){
        if(state){next.add(table);state.layout=null;for(const row of state.moves.keys())restoreRow(state,row);}
        continue;
      }
      const headings=current.headers.map(header=>normalize(header.textContent));
      if(state){
        const unique=new Set(headings).size===headings.length;
        const sameColumns=headings.length===state.headings.length&&headings.every((name,index)=>
          name===state.headings[index]&&(unique&&name||state.controls[index].header===current.headers[index]));
        const sameControls=current.headers.every((header,index)=>state.controls[index]?.header===header&&state.controls[index].host.parentNode===header);
        if(!sameColumns||!sameControls){
          unregister(state);
          state=register(table,current.headers,headings,sameColumns?state:null);
        }
      }
      state ||= register(table,current.headers,headings);
      next.add(table);render(state,current.rows);
    }
    for(const [table,state] of states)if(!next.has(table))unregister(state);
    if(states.size&&!style.isConnected)document.head.append(style);
    if(!states.size)style.remove();
  }
  function schedule() {if(enabled&&!stopped&&pending===null)pending=requestAnimationFrame(()=>{pending=null;scan();});}
  const resizer=new ResizeObserver(schedule), observer=new MutationObserver(records=>{
    for(const record of records){
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      const state=states.get(element?.closest('table'));
      if(state){state.profiles=null;state.order=null;}
      else if(record.type==='attributes')for(const item of states.values())if(element?.contains(item.table)){item.profiles=null;item.order=null;}
    }
    const relevant=records.some(record=>{
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      if(element?.closest('#codex-composer-hud'))return false;
      if(record.type==='attributes'&&element===document.documentElement)return true;
      if(element?.closest('[data-markdown-table]'))return true;
      if(record.type==='attributes')return Boolean(element?.querySelector('[data-markdown-table]'));
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1&&(node.matches('[data-markdown-table]')||node.querySelector('[data-markdown-table]')));
    });
    if(relevant)schedule();
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','hidden','aria-hidden','colspan','rowspan']});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  const keydown=event=>{if(event.key==='Control'&&!ctrlDown){ctrlDown=true;controlSession++;}};
  const keyup=event=>{if(event.key==='Control')ctrlDown=false;};
  const blur=()=>{ctrlDown=false;};
  const scroll=event=>{if([...states.keys()].some(table=>event.target.contains?.(table)||table.closest('[data-markdown-table]')?.contains(event.target)))schedule();};
  document.addEventListener('keydown',keydown);document.addEventListener('keyup',keyup);window.addEventListener('blur',blur);window.addEventListener('scroll',scroll,true);
  window.addEventListener('resize',schedule);
  function snapshot(){return {enabled,tables:states.size,sorted:[...states.values()].filter(state=>state.keys.length>0).length,multi:[...states.values()].filter(state=>state.multi&&state.keys.length>0).length,defaultMode};}
  window.__codexTableSort={
    setEnabled(value){
      const next=value!==false;if(next===enabled)return snapshot();enabled=next;
      if(enabled){schedule();return snapshot();}
      if(pending!==null){cancelAnimationFrame(pending);pending=null;}
      for(const state of states.values())unregister(state);style.remove();return snapshot();
    },
    setDefaultMode(value){const next=['smart','ascending','descending'].includes(value)?value:'smart';if(next===defaultMode)return snapshot();defaultMode=next;schedule();return snapshot();},
    snapshot,
    remove(){stopped=true;observer.disconnect();resizer.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('keydown',keydown);document.removeEventListener('keyup',keyup);window.removeEventListener('blur',blur);window.removeEventListener('scroll',scroll,true);if(pending!==null)cancelAnimationFrame(pending);for(const state of states.values())unregister(state);style.remove();delete window.__codexTableSort;}
  };
  scan();return true;
})()
