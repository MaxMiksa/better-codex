// Layout only: inspect container geometry, never read conversation text.
(() => {
  if (window.__codexReadingWidth) return false;
  const marker = 'data-codex-hud-reading-width';
  const style = document.createElement('style');
  style.id = 'codex-hud-reading-width';
  let target = null, pending = null, preference;
  function clear() {
    if (target) target.removeAttribute(marker);
    document.querySelectorAll(`[${marker}]`).forEach(e=>e.removeAttribute(marker));
    target = null;
    style.remove();
  }
  function apply() {
    const value = pending ?? preference;
    const maxWidth = value==='wide' ? 1152 : Number.isInteger(value) && value>=768 && value<=1600 ? value : 768;
    const mode = maxWidth===768 ? 'default' : 'custom';
    if (mode === 'default') { clear(); return {mode,maxWidth,applied:false}; }
    const visible = e => { const r=e.getBoundingClientRect(); return r.width>0 && r.height>0; };
    const scrolls = [...document.querySelectorAll('.thread-scroll-container')].filter(visible);
    const candidates = scrolls.length===1
      ? [...scrolls[0].querySelectorAll('[class~="max-w-(--thread-body-max-width)"]')].filter(e=>visible(e) && !e.querySelector('[data-codex-composer-root],[data-composer-body]')) : [];
    if (candidates.length!==1 || !getComputedStyle(candidates[0]).getPropertyValue('--thread-content-max-width').trim()) {
      clear(); return {mode,maxWidth,applied:false,reason:'unknown-transcript-layout'};
    }
    if (target!==candidates[0]) { clear(); target=candidates[0]; }
    const css = `[${marker}="wide"]{--thread-content-max-width:${maxWidth}px!important;}`;
    if (style.textContent!==css) style.textContent=css;
    if (!style.isConnected) document.head.append(style);
    target.setAttribute(marker,'wide');
    return {mode,maxWidth,applied:true,width:Math.round(target.getBoundingClientRect().width)};
  }
  // MutationObserver runs before rendering. Rebind mounted/revealed views without
  // waiting for the controller's statistics/settings polling interval.
  const scope = '.thread-scroll-container,[class~="max-w-(--thread-body-max-width)"]';
  const observer = new MutationObserver(records=>{
    const relevant=records.some(record=>{
      const element=record.target.nodeType===1?record.target:record.target.parentElement;
      if(element?.closest('#codex-composer-hud'))return false;
      if(record.type==='attributes')return element?.matches(scope) || element?.contains(target) || Boolean(element?.querySelector(scope));
      return [...record.addedNodes,...record.removedNodes].some(node=>node.nodeType===1 && (node.matches(scope) || node.querySelector(scope)));
    });
    if(relevant)apply();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','aria-hidden']});
  window.addEventListener('resize',apply);
  window.__codexReadingWidth = {
    update(value) { preference=value;return apply(); },
    preview(value) { if(Number.isInteger(value) && value>=768 && value<=1600)pending=value;return this.update(value); },
    settle(value) { if(pending===value)pending=null; },
    remove() { observer.disconnect();window.removeEventListener('resize',apply);clear(); delete window.__codexReadingWidth; }
  };
  return true;
})()
