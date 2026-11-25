// Layout only: inspect container geometry, never read conversation text.
(() => {
  if (window.__codexReadingWidth) return false;
  const marker = 'data-codex-hud-reading-width';
  const style = document.createElement('style');
  style.id = 'codex-hud-reading-width';
  const fontStyle = document.createElement('style');
  fontStyle.id = 'codex-hud-assistant-font-size';
  const assistantReply = '.thread-scroll-container [data-markdown-text-style="assistant-message"]:not(:is([data-conversation-print], [data-conversation-print] *, [data-user-message-bubble] *, [data-codex-composer-root] *, [data-composer-body] *))';
  function setAssistantFontSize(value) {
    if (!Number.isInteger(value) || value < 10 || value > 40) {
      fontStyle.remove();
      return;
    }
    // Feed the native Markdown typography; its existing heading, table and line-height ratios still apply.
    const css = `${assistantReply}{--codex-chat-font-size:${value}px;}`;
    if (fontStyle.textContent !== css) fontStyle.textContent = css;
    if (!fontStyle.isConnected) document.head.append(fontStyle);
  }
  const tableMarker = 'data-codex-hud-reading-table';
  const tableStyle = document.createElement('style');
  tableStyle.id = 'codex-hud-reading-tables';
  const tableSelector = `[${tableMarker}]>[class*="TableScroller"]>[class*="TableWrapper"]>table`;
  const cellSelector = `${tableSelector}>:is(thead,tbody,tfoot)>tr>:is(th,td)`;
  const measuring = 'data-codex-hud-table-measuring';
  const measureStyle = document.createElement('style');
  measureStyle.id = 'codex-hud-reading-table-measure';
  measureStyle.textContent = `${tableSelector}[${measuring}]{width:max-content!important;min-width:0!important;}\n${tableSelector}[${measuring}]>:is(thead,tbody,tfoot)>tr>:is(th,td){min-width:0!important;max-width:none!important;white-space:nowrap!important;}`;
  const columnCache = new WeakMap();
  let tables = new Set(), observed = new Set();
  let targets = new Set(), pending = null, preference, tableEnabled = true, tableCentered = true;
  function clear() {
    for(const target of targets)target.removeAttribute(marker);
    document.querySelectorAll(`[${marker}]`).forEach(e=>e.removeAttribute(marker));
    targets.clear();
    style.remove();
  }
  function clearTables() {
    for(const table of tables)table.removeAttribute(tableMarker);
    document.querySelectorAll(`[${tableMarker}]`).forEach(e=>e.removeAttribute(tableMarker));
    tables.clear();tableStyle.remove();measureStyle.remove();resizer.disconnect();observed.clear();
  }
  function contentWidth(cell) {
    const walker=document.createTreeWalker(cell,NodeFilter.SHOW_TEXT),range=document.createRange();
    let node,left=Infinity,right=-Infinity;
    while(node=walker.nextNode()){
      range.selectNodeContents(node);
      for(const box of range.getClientRects())if(box.width>0&&box.height>0){left=Math.min(left,box.left);right=Math.max(right,box.right);}
    }
    return Math.max(0,right-left);
  }
  function readableCaps(samples,size) {
    const caps=samples.map(()=>28);
    const rows=Array.from({length:samples[0]?.length||0},(_,index)=>samples.map(column=>column[index]));
    // Spend extra width where it reduces row heights, including tied long columns.
    // Capped line costs keep unusually long outliers from dominating the table.
    const lines=(row,widths)=>Math.max(0,...row.map((width,index)=>Math.min(4,Math.ceil(width/(widths[index]*size)))));
    let budget=12;
    while(budget>0){
      let best=null;
      const heights=rows.map(row=>lines(row,caps)),current=heights.reduce((sum,height)=>sum+height,0),seen=new Set();
      for(const [index,row] of rows.entries()){
        const target=heights[index]-1;if(target<1)continue;
        const next=row.map((width,column)=>Math.max(caps[column],Math.ceil(width/(target*size))));
        const extra=next.reduce((sum,width,column)=>sum+width-caps[column],0),key=next.join(',');
        if(extra<=0||extra>budget||next.some(width=>width>40)||seen.has(key))continue;
        seen.add(key);
        const gain=current-rows.reduce((sum,row)=>sum+lines(row,next),0),score=gain/extra;
        if(gain<=0||gain<rows.length*.2)continue;
        if(!best||score>best.score||(score===best.score&&extra<best.extra))best={next,extra,score};
      }
      if(!best)break;
      caps.splice(0,caps.length,...best.next);budget-=best.extra;
    }
    return caps;
  }
  function columnWidths(table) {
    const css=getComputedStyle(table), key=[css.fontFamily,css.fontSize,css.fontWeight,css.fontStyle,css.fontStretch,css.letterSpacing,css.wordSpacing].join('|');
    const cached=columnCache.get(table);
    if(cached?.key===key)return cached.widths;
    const rows=[...table.rows], cells=rows.flatMap(row=>[...row.cells]);
    // Preserve browser layout for spans; ordinary Markdown columns need no text reads.
    if(cells.some(cell=>cell.colSpan!==1 || cell.rowSpan!==1))return [];
    if(!measureStyle.isConnected)document.head.append(measureStyle);
    table.setAttribute(measuring,'');
    let widths;
    try{
      const natural=[],padding=[],samples=[];
      for(const row of rows)for(const [index,cell] of [...row.cells].entries()){
        const style=getComputedStyle(cell);
        natural[index]=Math.max(natural[index]||0,cell.getBoundingClientRect().width);
        padding[index]=Math.max(padding[index]||0,parseFloat(style.paddingLeft)+parseFloat(style.paddingRight)+parseFloat(style.borderLeftWidth)+parseFloat(style.borderRightWidth));
        samples[index] ||= [];
        if(row.parentElement.tagName!=='THEAD'){
          samples[index].push(contentWidth(cell));
        }
      }
      // Short labels stay compact; prose retains a floor of six em.
      const size=parseFloat(css.fontSize),caps=readableCaps(samples,size);
      widths=natural.map((width,index)=>({min:Math.ceil(Math.min(6*size,Math.max(0,width-padding[index]))),max:caps[index]}));
    }finally{table.removeAttribute(measuring);}
    columnCache.set(table,{key,widths});
    return widths;
  }
  function applyTables(scrolls) {
    if(!tableEnabled){clearTables();return;}
    const next=new Set(), watching=new Set(scrolls), rules=[];
    for(const target of targets){
      watching.add(target);watching.add(target.parentElement);
      // Keep other native table variables independent of the prose width slider.
      const inherited=getComputedStyle(target.parentElement);
      const base=inherited.getPropertyValue('--thread-content-responsive-max-width').trim() || inherited.getPropertyValue('--thread-content-max-width').trim();
      if(!CSS.supports('width',base) || /^(inherit|initial|unset|revert)$/.test(base))continue;
      const scroll=target.closest('.thread-scroll-container');
      for(const container of target.querySelectorAll('[data-markdown-table]')){
        if(container.closest('.thread-scroll-container')!==scroll || !container.closest('[data-markdown-text-style="assistant-message"]') || container.closest('[data-conversation-print]'))continue;
        const table=container.querySelector(':scope > [class*="TableScroller"] > [class*="TableWrapper"] > table');
        if(!table || container.getBoundingClientRect().width<=0)continue;
        const parent=container.parentElement, rect=parent.getBoundingClientRect(), center=rect.x+rect.width/2;
        let left=0,right=document.documentElement.clientWidth;
        // Respect each panel's clipping boundary, including split panes.
        for(let element=parent;element;element=element.parentElement){
          const css=getComputedStyle(element);
          if(element===scroll || /^(auto|scroll|hidden|clip)$/.test(css.overflowX)){
            const box=element.getBoundingClientRect();
            left=Math.max(left,box.left+element.clientLeft+parseFloat(css.paddingLeft));
            right=Math.min(right,box.left+element.clientLeft+element.clientWidth-parseFloat(css.paddingRight));
          }
          if(element===scroll)break;
        }
        const available=Math.floor(2*Math.min(center-left,right-center));
        if(tableCentered&&available<=0)continue;
        // Wide screens should leave breathing room rather than lengthen every row.
        const comfortable=Math.min(1440,80*parseFloat(getComputedStyle(table).fontSize));
        const limit=Math.floor(Math.min(available,comfortable));
        const index=String(next.size);next.add(container);watching.add(parent);
        if(container.getAttribute(tableMarker)!==index)container.setAttribute(tableMarker,index);
        rules.push(`[${tableMarker}="${index}"]{--thread-content-max-width:${base}!important;${tableCentered?`max-width:${limit}px!important;`:''}}`);
        const columns=columnWidths(table);
        for(const [column,width] of columns.entries())rules.push(`:where([${tableMarker}="${index}"]) :is(th,td):nth-child(${column+1}){--codex-hud-column-min:${width.min}px;--codex-hud-column-max:${width.max}em;}`);
      }
    }
    for(const container of tables)if(!next.has(container))container.removeAttribute(tableMarker);
    document.querySelectorAll(`[${tableMarker}]`).forEach(e=>{if(!next.has(e))e.removeAttribute(tableMarker);});
    tables=next;
    const root=`[${tableMarker}]`, scroller=`${root}>[class*="TableScroller"]`, wrapper=`${scroller}>[class*="TableWrapper"]`;
    const rootLayout=tableCentered
      ?`${root}{position:relative;left:50%;translate:-50% 0;width:max-content!important;min-width:0!important;}`
      :`${root}{position:static;left:auto;translate:none;width:100%!important;min-width:0!important;}`;
    const css=`${rootLayout}\n${wrapper},${wrapper}>table{min-width:0!important;}\n${cellSelector}{min-width:var(--codex-hud-column-min,0px)!important;max-width:var(--codex-hud-column-max,28em)!important;}\n${cellSelector}:not(:last-child){padding-inline-end:32px!important;}\n${rules.join('\n')}`;
    if(tables.size){
      if(tableStyle.textContent!==css)tableStyle.textContent=css;
      if(!tableStyle.isConnected)document.head.append(tableStyle);
    }else {tableStyle.remove();measureStyle.remove();}
    for(const element of observed)if(!watching.has(element))resizer.unobserve(element);
    for(const element of watching)if(!observed.has(element))resizer.observe(element);
    observed=watching;
  }
  function apply() {
    const value = pending ?? preference;
    const maxWidth = value==='wide' ? 1152 : Number.isInteger(value) && value>=768 && value<=1600 ? value : 768;
    const mode = maxWidth===768 ? 'default' : 'custom';
    const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(e).visibility!=='hidden'; };
    const scrolls = [...document.querySelectorAll('.thread-scroll-container')].filter(visible);
    const next = new Set();
    for(const scroll of scrolls){
      const candidates=[...scroll.querySelectorAll('[class~="max-w-(--thread-body-max-width)"]')].filter(e=>
        visible(e) && e.closest('.thread-scroll-container')===scroll && !e.querySelector('[data-codex-composer-root],[data-composer-body]'));
      // Native transcript metadata distinguishes bodies from auxiliary width wrappers.
      const bodies=candidates.filter(e=>e.getAttribute('data-thread-user-message-navigation-content')==='true');
      const matches=bodies.length?bodies:candidates;
      if(matches.length===1 && getComputedStyle(matches[0]).getPropertyValue('--thread-content-max-width').trim())next.add(matches[0]);
    }
    for(const target of targets)if(!next.has(target))target.removeAttribute(marker);
    document.querySelectorAll(`[${marker}]`).forEach(e=>{if(!next.has(e))e.removeAttribute(marker);});
    targets=next;
    if (!targets.size) {
      clear();clearTables(); return {mode,maxWidth,applied:false,reason:'unknown-transcript-layout'};
    }
    const css = `[${marker}="wide"]{--thread-content-max-width:${maxWidth}px!important;}`;
    if (style.textContent!==css) style.textContent=css;
    if(mode==='default'){
      style.remove();for(const target of targets)target.removeAttribute(marker);
    }else{
      if (!style.isConnected) document.head.append(style);
      for(const target of targets)if(target.getAttribute(marker)!=='wide')target.setAttribute(marker,'wide');
    }
    applyTables(scrolls);
    const widths=[...targets].map(e=>Math.round(e.getBoundingClientRect().width));
    return {mode,maxWidth,applied:mode!=='default',width:widths[0],targets:targets.size,widths,tables:tables.size,tableEnabled,tableCentered};
  }
  // MutationObserver runs before rendering. Rebind mounted/revealed views without
  // waiting for the controller's statistics/settings polling interval.
  const scope = '.thread-scroll-container,[class~="max-w-(--thread-body-max-width)"],[data-markdown-table]';
  const resizer = new ResizeObserver(()=>apply());
  const observer = new MutationObserver(records=>{
    let changed=false;
    for(const record of records){
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      const table=element?.closest('table');
      if(table && tables.has(table.closest('[data-markdown-table]'))){columnCache.delete(table);changed=true;}
    }
    const relevant=records.some(record=>{
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      if(element?.closest('#codex-composer-hud'))return false;
      if(record.type==='attributes')return element?.matches(scope) || [...targets].some(target=>element?.contains(target)) || Boolean(element?.querySelector(scope));
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && (node.matches(scope) || node.querySelector(scope)));
    });
    if(changed || relevant)apply();
  });
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','colspan','rowspan','data-thread-user-message-navigation-content','data-markdown-table','data-markdown-text-style']});
  window.addEventListener('resize',apply);
  window.__codexReadingWidth = {
    update(value) { preference=value;return apply(); },
    setAssistantFontSize,
    setTablesEnabled(value) { const next=value!==false;if(next===tableEnabled)return {tableEnabled,tables:tables.size};tableEnabled=next;return apply(); },
    setTableCentered(value) { const next=value!==false;if(next===tableCentered)return {tableCentered};tableCentered=next;return apply(); },
    preview(value) { if(Number.isInteger(value) && value>=768 && value<=1600)pending=value;return this.update(value); },
    settle(value) { if(pending===value)pending=null; },
    remove() { observer.disconnect();resizer.disconnect();window.removeEventListener('resize',apply);fontStyle.remove();clear();clearTables(); delete window.__codexReadingWidth; }
  };
  return true;
})()

