// Local presentation only; leave file actions and React state ownership to Codex.
(() => {
  if (window.__codexFileChanges) return false;
  const headerSelector = '.thread-scroll-container [class~="group/turn-diff-header"]';
  const marker = 'data-codex-hud-file-list';
  const toggleMarker = 'data-codex-hud-file-toggle';
  const records = new Map();
  const style = document.createElement('style');
  style.id = 'codex-hud-file-changes';
  style.textContent = `[${marker}="closed"]{display:none!important}
    [${marker}]>button[aria-expanded]{display:none!important}
    [${toggleMarker}]{border-top:1px solid var(--color-border)}
    [${toggleMarker}] svg{transition:transform .15s}
    [${toggleMarker}][aria-expanded="true"] svg{transform:rotate(180deg)}`;
  document.head.append(style);

  function inspect(header) {
    const body = header.nextElementSibling;
    if (!body?.matches('div.flex.flex-col.border-t') ||
        !body.classList.contains('[--codex-diffs-header-padding-x:var(--resource-card-row-padding-x)]')) return null;
    const children = [...body.children];
    const footer = children.at(-1)?.matches('button[aria-expanded]') ? children.pop() : null;
    if (children.length<2 || children.some(e=>e.tagName!=='DIV')) return null;
    let count = children.length;
    if (footer?.getAttribute('aria-expanded')==='false') {
      // Only the native aggregate count is read, never filenames or chat text.
      const numbers = footer.textContent.match(/\d[\d,\u00a0\u202f]*/g);
      const remaining = numbers?.length===1 ? Number(numbers[0].replace(/[,\u00a0\u202f]/g,'')) : NaN;
      if (!Number.isSafeInteger(remaining) || remaining<=0) return null;
      count += remaining;
    }
    return {body,footer,count};
  }

  function release(record) {
    record.body.removeAttribute(marker);
    record.button.remove();
    if (record.openedNative && record.body.isConnected) {
      const footer = record.body.lastElementChild;
      if (footer?.matches('button[aria-expanded="true"]')) footer.click();
    }
  }

  function sync(record, info) {
    const {body,footer,count} = info;
    const expanded = String(record.expanded);
    const mode = record.expanded ? 'open' : 'closed';
    if (body.getAttribute(marker)!==mode) body.setAttribute(marker,mode);
    if (record.button.getAttribute('aria-expanded')!==expanded) record.button.setAttribute('aria-expanded',expanded);
    const label = record.expanded ? '收起文件' : `展开 ${count} 个文件`;
    if (record.label.textContent!==label) record.label.textContent=label;
    if (!record.button.isConnected) record.header.parentElement.append(record.button);
    // Use the native reveal action once so all files, including those not yet
    // mounted by React, become available. Do not reach into private React state.
    if (record.expanded && footer?.getAttribute('aria-expanded')==='false' && record.pendingFooter!==footer) {
      record.pendingFooter=footer;
      record.openedNative=true;
      footer.click();
    }
    if (footer?.getAttribute('aria-expanded')==='true') record.pendingFooter=null;
  }

  function create(header, info, expanded=false) {
    const button = document.createElement('button');
    button.type='button';
    button.setAttribute(toggleMarker,'');
    button.className='flex h-9 w-full cursor-interaction items-center gap-2 rounded-b-lg px-[var(--resource-card-row-padding-x)] py-[var(--turn-diff-row-padding-y)] text-start text-size-chat text-default hover:bg-background-primary-ghost-hover/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset';
    const label = document.createElement('span');
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 16 16');
    svg.setAttribute('class','icon-2xs');
    svg.setAttribute('width','12');svg.setAttribute('height','12');
    svg.setAttribute('aria-hidden','true');
    const path = document.createElementNS(svg.namespaceURI,'path');
    path.setAttribute('d','m4 6 4 4 4-4');path.setAttribute('fill','none');
    path.setAttribute('stroke','currentColor');path.setAttribute('stroke-width','1.5');
    svg.append(path);button.append(label,svg);
    const record = {header,body:info.body,button,label,expanded,openedNative:false,pendingFooter:null};
    button.addEventListener('click',event=>{
      event.stopPropagation();
      const current=inspect(header);
      if (!current || current.body!==record.body) { scan();return; }
      record.expanded=!record.expanded;
      record.pendingFooter=null;
      sync(record,current);
    });
    return record;
  }

  function scan() {
    for (const [header,record] of records) {
      if (!header.isConnected || !header.matches(headerSelector) || !inspect(header)) { release(record);records.delete(header); }
    }
    for (const header of document.querySelectorAll(headerSelector)) {
      const info=inspect(header);
      if (!info) continue;
      let record=records.get(header);
      if (record && record.body!==info.body) {
        const expanded=record.expanded,openedNative=record.openedNative;
        release(record);record=create(header,info,expanded);records.set(header,record);
        record.openedNative=openedNative;
      }
      if (!record) { record=create(header,info);records.set(header,record); }
      sync(record,info);
    }
    return {cards:records.size,expanded:[...records.values()].filter(r=>r.expanded).length};
  }

  const own = node => (node.nodeType===1 ? node : node.parentElement)?.closest(`[${toggleMarker}],#codex-composer-hud`);
  const observer = new MutationObserver(changes=>{
    if (changes.some(change=>!own(change.target) && (change.type!=='childList' ||
        [...change.addedNodes,...change.removedNodes].some(node=>!own(node))))) scan();
  });
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','aria-expanded']});
  window.__codexFileChanges = {
    snapshot:scan,
    remove() {
      observer.disconnect();
      records.forEach(release);records.clear();style.remove();
      delete window.__codexFileChanges;
    }
  };
  scan();
  return true;
})()
