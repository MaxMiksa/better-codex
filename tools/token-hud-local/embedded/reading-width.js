// Layout only: inspect container geometry, never read conversation text.
(() => {
  if (window.__codexReadingWidth) return false;
  const marker = 'data-codex-hud-reading-width';
  const style = document.createElement('style');
  style.id = 'codex-hud-reading-width';
  let targets = new Set(), pending = null, preference;
  function clear() {
    for(const target of targets)target.removeAttribute(marker);
    document.querySelectorAll(`[${marker}]`).forEach(e=>e.removeAttribute(marker));
    targets.clear();
    style.remove();
  }
  function apply() {
    const value = pending ?? preference;
    const maxWidth = value==='wide' ? 1152 : Number.isInteger(value) && value>=768 && value<=1600 ? value : 768;
    const mode = maxWidth===768 ? 'default' : 'custom';
    if (mode === 'default') { clear(); return {mode,maxWidth,applied:false}; }
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
      clear(); return {mode,maxWidth,applied:false,reason:'unknown-transcript-layout'};
    }
    const css = `[${marker}="wide"]{--thread-content-max-width:${maxWidth}px!important;}`;
    if (style.textContent!==css) style.textContent=css;
    if (!style.isConnected) document.head.append(style);
    for(const target of targets)target.setAttribute(marker,'wide');
    const widths=[...targets].map(e=>Math.round(e.getBoundingClientRect().width));
    return {mode,maxWidth,applied:true,width:widths[0],targets:targets.size,widths};
  }
  // MutationObserver runs before rendering. Rebind mounted/revealed views without
  // waiting for the controller's statistics/settings polling interval.
  const scope = '.thread-scroll-container,[class~="max-w-(--thread-body-max-width)"]';
  const observer = new MutationObserver(records=>{
    const relevant=records.some(record=>{
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      if(element?.closest('#codex-composer-hud'))return false;
      if(record.type==='attributes')return element?.matches(scope) || [...targets].some(target=>element?.contains(target)) || Boolean(element?.querySelector(scope));
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && (node.matches(scope) || node.querySelector(scope)));
    });
    if(relevant)apply();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden','data-thread-user-message-navigation-content']});
  window.addEventListener('resize',apply);
  window.__codexReadingWidth = {
    update(value) { preference=value;return apply(); },
    preview(value) { if(Number.isInteger(value) && value>=768 && value<=1600)pending=value;return this.update(value); },
    settle(value) { if(pending===value)pending=null; },
    remove() { observer.disconnect();window.removeEventListener('resize',apply);clear(); delete window.__codexReadingWidth; }
  };
  return true;
})()
