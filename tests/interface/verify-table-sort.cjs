// Synthetic pages only. No application context, persisted settings or model requests.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||path.resolve(__dirname,'../../.runtime/token-hud/node/node_modules/playwright'));
const source=fs.readFileSync(path.join(__dirname,'../../src/interface/reading/table-sort.js'),'utf8');
const reading=fs.readFileSync(path.join(__dirname,'../../src/interface/reading/reading-width.js'),'utf8');
const i18n=require('../../src/platform/i18n/i18n.js');
const [scratch,evidence]=process.argv.slice(2).map(value=>path.resolve(value));
const results=[];
function check(name,ok){if(!ok)throw Error(name);results.push(name);}
const table=(id,rows,headers=['项目','数值','说明'])=>`<div data-markdown-table="true" data-wide-block id="${id}"><div class="_TableScroller_fixture"><div class="_TableWrapper_fixture"><table><thead><tr>${headers.map(text=>`<th>${text}</th>`).join('')}</tr></thead><tbody>${rows.map((row,index)=>`<tr data-row="${index}">${row.map(text=>`<td>${text}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></div>`;
const html=`<!doctype html><html lang="zh-CN"><style>
html{--thread-content-max-width:48rem;font-size:16px}body{margin:0;background:#191919;color:#eee;font:16px/1.7 'Microsoft YaHei UI',sans-serif}
.thread-scroll-container{height:760px;overflow:auto;padding:24px}.panel{overflow:clip}.transcript{max-width:var(--thread-content-max-width);margin:auto}
[data-markdown-table]{position:relative;width:100%;min-width:100%;margin:24px 0}._TableScroller_fixture,.TableScroller-native{display:flex;overflow-x:auto}._TableWrapper_fixture,.TableWrapper-native{flex-shrink:0;width:fit-content;min-width:100%}
table{font:inherit;width:fit-content;min-width:100%;border-collapse:separate;border-spacing:0;table-layout:auto}
th,td{max-width:24em;padding:8px 24px 8px 0;border-bottom:1px solid #444;vertical-align:top;text-align:left;overflow-wrap:break-word}
th{padding-bottom:12px}th:last-child{padding-inline-end:40px}th.sticky{position:sticky;top:0}a{color:inherit}button{font:inherit}
</style><div class="thread-scroll-container"><div class="panel"><div class="transcript max-w-(--thread-body-max-width)" data-thread-user-message-navigation-content="true"><div data-markdown-text-style="assistant-message">
${table('numbers',[['丙','20','短说明'],['甲','3','较长说明<br>第二行<br>第三行'],['乙','10','<a href="#detail">保留原始链接</a>'],['丁','3','相同数值'],['空','—','缺失']])}
${table('currency',[['丙','¥1,200.00',''],['甲','(¥25.00)',''],['乙','¥9.50','']])}
${table('percent',[['丙','80%',''],['甲','3.5%',''],['乙','12%','']])}
${table('units',[['丙','12 天',''],['甲','2 天',''],['乙','4 天','']])}
${table('mixed',[['丙','2 元',''],['甲','1 万元',''],['乙','3 元','']])}
${table('spans',[['合并','2',''],['原样','1','']])}
</div><div data-markdown-text-style="user-message">${table('user',[['乙','2',''],['甲','1','']])}</div><div data-conversation-print><div data-markdown-text-style="assistant-message">${table('print',[['乙','2',''],['甲','1','']])}</div></div></div></div></div>
<div data-markdown-text-style="assistant-message">${table('document',[['乙','2',''],['甲','1','']])}</div></html>`;
async function extended(page,sort,visual,dom,frame) {
 const mount=async(id,rows,headers)=>{
  await page.locator('.transcript > [data-markdown-text-style="assistant-message"]').evaluate((parent,html)=>parent.insertAdjacentHTML('beforeend',html),table(id,rows,headers));await frame();
 };
  check('default-sort-mode-is-smart',await page.evaluate(()=>window.__codexTableSort.snapshot().defaultMode==='smart'));
  await page.evaluate(()=>window.__codexTableSort.setDefaultMode('ascending'));await frame();
  await mount('forced-ascending',[['3','',''],['1','',''],['2','','']]);await sort('forced-ascending',0);await frame();
  check('forced-ascending-overrides-automatic-direction',JSON.stringify(await visual('forced-ascending'))==='["1","2","0"]'&&await page.locator('#forced-ascending th').first().getAttribute('aria-sort')==='ascending');
  await page.evaluate(()=>window.__codexTableSort.setDefaultMode('descending'));await frame();
  await mount('forced-descending',[['3','',''],['1','',''],['2','','']]);await sort('forced-descending',0);await frame();
  check('forced-descending-applies-to-numeric-columns',JSON.stringify(await visual('forced-descending'))==='["0","2","1"]');
  await mount('forced-descending-series',[['P5','',''],['P2','',''],['P10','','']]);await sort('forced-descending-series',0);await frame();
  check('forced-mode-overrides-automatic-prefix-order',JSON.stringify(await visual('forced-descending-series'))==='["2","0","1"]');
  await page.evaluate(()=>window.__codexTableSort.setDefaultMode('smart'));await frame();
  check('smart-sort-mode-can-be-restored',await page.evaluate(()=>window.__codexTableSort.snapshot().defaultMode==='smart'));
 for(const [id,values,expected] of [
  ['sequence',['3','4','5'],['0','1','2']],
  ['reverse-sequence',['5','4','3'],['2','1','0']],
  ['priority',['P5','P2','P10'],['1','0','2']],
  ['task-id',['T3','T2','T12'],['1','0','2']],
  ['random-number',['3','1','2'],['0','2','1']],
  ['nonserial',['P3','T1','P2'],['1','0','2']]
 ]){
  await mount(id,values.map(value=>[value,'','']));await sort(id,0);await frame();
  check(`${id}-chooses-appropriate-first-direction`,JSON.stringify(await visual(id))===JSON.stringify(expected));
 }
 await mount('multi',[
  ['甲','2','10'],['乙','2','30'],['丙','1','20'],['丁','1','40'],['戊','—','50'],['己','2','30']
 ],['项目','成本','耗时']);
 const headers=page.locator('#multi th');
 const ranks=()=>headers.evaluateAll(cells=>cells.map(cell=>cell.getAttribute('data-codex-sort-rank')));
 const multi=async(columns)=>{await page.keyboard.down('Control');for(const column of columns)await sort('multi',column);await page.keyboard.up('Control');await frame();};
 await multi([1,2]);
 check('ctrl-first-click-has-highest-priority-and-ties-stay-stable',JSON.stringify(await visual('multi'))==='["1","5","0","3","2","4"]');
 check('multi-priority-ranks-and-secondary-aria-sort',JSON.stringify(await ranks())==='[null,"1","2"]'&&await headers.nth(2).getAttribute('aria-sort')==='other');
 check('multi-badges-show-selection-order',await headers.nth(1).locator('[data-priority]').textContent()==='1'&&await headers.nth(2).locator('[data-priority]').textContent()==='2');
 await sort('multi',0,{modifiers:['Alt']});await frame();
 check('alt-inactive-only-presets-without-changing-active-combination',JSON.stringify(await visual('multi'))==='["1","5","0","3","2","4"]'&&JSON.stringify(await ranks())==='[null,"1","2"]'&&await headers.first().getAttribute('data-codex-sort-direction')==='ascending');
 await sort('multi',1,{modifiers:['Alt']});await frame();
 check('alt-active-reverses-only-that-column-with-rank-unchanged',JSON.stringify(await visual('multi'))==='["3","2","1","5","0","4"]'&&JSON.stringify(await ranks())==='[null,"1","2"]');
 await multi([2,1,2]);
 check('new-ctrl-section-overwrites-old-priorities-and-ignores-duplicate',JSON.stringify(await ranks())==='[null,"2","1"]'&&JSON.stringify(await visual('multi'))==='["4","3","1","5","2","0"]');
 check('alt-preset-direction-survives-ctrl-reselection',await headers.nth(1).getAttribute('data-codex-sort-direction')==='ascending');
 await sort('multi',0);await frame();
 check('ordinary-click-exits-multi-and-uses-alt-preset',JSON.stringify(await ranks())==='["1",null,null]'&&await headers.first().getAttribute('aria-sort')==='ascending'&&await headers.first().locator('[data-priority]').isHidden());
 await sort('multi',0);await frame();check('ordinary-click-reverses-preset-direction',await headers.first().getAttribute('aria-sort')==='descending');
 await sort('multi',0);await frame();check('third-click-restores-after-alt-preset',JSON.stringify(await visual('multi'))===JSON.stringify(await dom('multi')));
 await page.keyboard.down('Control');await sort('multi',1);await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.keyboard.up('Control');
 await multi([2]);
 check('focus-loss-does-not-reuse-previous-ctrl-combination',JSON.stringify(await ranks())==='[null,null,"1"]');
 await multi([1,2]);
 await page.locator('#multi tbody tr').nth(2).locator('td').nth(1).evaluate(cell=>cell.textContent='2');await frame();
 check('streamed-edit-recomputes-all-multi-sort-keys',JSON.stringify(await visual('multi'))==='["3","1","5","2","0","4"]');
 await page.locator('#multi tbody tr').nth(2).locator('td').nth(2).evaluate(cell=>cell.textContent='60');await frame();
 check('secondary-streamed-edit-invalidates-cached-order',JSON.stringify(await visual('multi'))==='["3","2","1","5","0","4"]');
 check('multi-sorting-preserves-original-nodes-and-text-order',JSON.stringify(await dom('multi'))==='["0","1","2","3","4","5"]');
 await page.locator('#multi').screenshot({path:path.join(evidence,'multi-priority.png')});
 // Emoji remains ordinary full text: no color mapping or suffix suppression.
 await mount('emoji',[['🔴 A','1',''],['🔴 C','2',''],['🟢 B','3','']]);await sort('emoji',0);await frame();
 const expected=await page.locator('#emoji tbody tr').evaluateAll(rows=>rows.map((row,index)=>({text:row.cells[0].textContent,index})).sort((a,b)=>new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'}).compare(b.text,a.text)||a.index-b.index).map(item=>String(item.index)));
 check('emoji-compares-whole-original-text-without-special-priority',JSON.stringify(await visual('emoji'))===JSON.stringify(expected));
 // Native controls stay outside table, exactly as in Codex's floating toolbar.
 for(const [id,last] of [['actions-short','说明'],['actions-long','单项综合评估与补充说明']]){
  await mount(id,[['P2','20','可继续'],['P3','10','需要复核']],['工作','耗时',last]);
  await page.locator(`#${id}`).evaluate(container=>{
   const toolbar=document.createElement('div');toolbar.dataset.nativeActions='';toolbar.style.cssText='position:absolute;right:0;top:0;display:flex;gap:8px';
   toolbar.innerHTML='<button style="width:28px;height:28px" aria-label="复制">⧉</button><button style="width:28px;height:28px" aria-label="展开">⤢</button>';
   toolbar.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>container.dataset.nativeClicked='true'));container.append(toolbar);
  });await frame();
 }
 const noOverlap=id=>page.locator(`#${id}`).evaluate(container=>{
  const controls=[...container.querySelectorAll('[data-codex-table-sort-control]')].map(host=>host.getBoundingClientRect());
  const actions=[...container.querySelectorAll('[data-native-actions] button')].map(button=>button.getBoundingClientRect());
  return controls.every(a=>actions.every(b=>a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom));
 });
 check('short-last-header-avoids-both-native-actions',await noOverlap('actions-short'));
 check('long-last-header-avoids-both-native-actions',await noOverlap('actions-long'));
 await page.locator('#actions-long [data-native-actions] button').last().click();
 check('native-action-remains-clickable',await page.locator('#actions-long').getAttribute('data-native-clicked')==='true');
 await sort('actions-long',2);await frame();
 check('size-icons-use-distinct-lucide-geometries',await page.locator('#actions-long th').nth(2).locator('[data-symbol]').getAttribute('data-icon')==='large-first'&&await page.locator('#priority th').first().locator('[data-symbol]').getAttribute('data-icon')==='small-first');
 await page.locator('#actions-long').screenshot({path:path.join(evidence,'native-actions.png')});
 await page.setViewportSize({width:420,height:900});await frame();
 check('narrow-window-native-actions-do-not-cover-sort-controls',await noOverlap('actions-short')&&await noOverlap('actions-long'));
 await page.locator('#actions-long [class*="TableScroller"]').evaluate(scroller=>{scroller.scrollLeft=scroller.scrollWidth;});await frame();
 check('horizontal-scroll-keeps-native-actions-clear',await noOverlap('actions-long'));
 // Release temporary padding and all key listeners/state when unloading.
 await page.evaluate(()=>window.__codexTableSort.remove());await frame();
 check('unload-restores-original-native-header-padding',await page.locator('#actions-long th,#actions-short th').evaluateAll(cells=>cells.every(cell=>!cell.style.getPropertyValue('padding-inline-end'))));
 check('unload-clears-ranks-directions-and-all-row-translates',await page.locator('[data-codex-sort-rank],[data-codex-sort-direction],tbody tr[style]').count()===0);
 await page.keyboard.down('Control');await page.keyboard.up('Control');await page.evaluate(source);await frame();await sort('multi',1);await frame();
 check('reinstall-forgets-direction-presets-and-multi-selection',await headers.nth(1).getAttribute('aria-sort')==='descending'&&await headers.nth(1).locator('[data-priority]').isHidden());
 await page.setViewportSize({width:1280,height:900});await frame();
}
(async()=>{
 fs.mkdirSync(evidence,{recursive:true});
 const browser=await chromium.launchPersistentContext(scratch,{headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1280,height:900}});
 try{
  const page=await browser.newPage();await page.setContent(html);
  await page.locator('#spans tbody tr').first().evaluate(row=>{row.cells[0].colSpan=2;row.cells[1].remove();});
  await page.locator('#numbers th').first().evaluate(cell=>cell.classList.add('sticky'));
  await page.evaluate(i18n.pageSource('zh-CN'));await page.evaluate(reading);await page.evaluate(()=>window.__codexReadingWidth.update(992));
  const original=await page.locator('#numbers table').evaluate(table=>{window.originalRows=[...table.tBodies[0].rows];window.sourceModel=window.originalRows.map(row=>row.textContent);window.linkClicks=0;table.querySelector('a').addEventListener('click',event=>{event.preventDefault();window.linkClicks++;});return {text:table.textContent,width:table.getBoundingClientRect().width};});
  const sort=async(id,column,options={})=>{await page.locator(`#${id} th`).nth(column).locator('button').click(options);};
  const visual=id=>page.locator(`#${id} tbody tr`).evaluateAll(rows=>[...rows].sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top).map(row=>row.getAttribute('data-row')));
  const dom=id=>page.locator(`#${id} tbody tr`).evaluateAll(rows=>rows.map(row=>row.getAttribute('data-row')));
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(source);await frame();
  check('sort-controls-added-only-to-regular-assistant-tables',await page.locator('[data-codex-table-sort-control]').count()===15);
  check('user-document-print-and-span-tables-untouched',await page.locator('#user [data-codex-table-sort-control],#document [data-codex-table-sort-control],#print [data-codex-table-sort-control],#spans [data-codex-table-sort-control]').count()===0);
  check('sort-enabled-by-default',(await page.evaluate(()=>window.__codexTableSort.snapshot())).enabled===true);
  const sortDisabled=await page.evaluate(()=>window.__codexTableSort.setEnabled(false));
  check('table-master-off-removes-sort-entry-points',sortDisabled.enabled===false&&sortDisabled.tables===0&&await page.locator('[data-codex-table-sort-control],#codex-table-sort').count()===0);
  await page.evaluate(()=>window.__codexTableSort.setEnabled(true));await frame();
  check('table-master-on-restores-sort-entry-points',(await page.evaluate(()=>window.__codexTableSort.snapshot())).enabled===true&&await page.locator('[data-codex-table-sort-control]').count()===15);
  check('controls-follow-header-label-without-covering-it',await page.locator('#numbers th').evaluateAll(cells=>cells.every(cell=>{const range=document.createRange();range.selectNodeContents(cell.firstChild);return cell.querySelector('[data-codex-table-sort-control]').getBoundingClientRect().left>=range.getBoundingClientRect().right;})));
  check('native-sticky-header-position-retained',await page.locator('#numbers th').first().evaluate(cell=>getComputedStyle(cell).position)==='sticky');
  await sort('numbers',1);await frame();
  check('numeric-default-descending-is-not-lexical',JSON.stringify(await visual('numbers'))==='["0","2","1","3","4"]');
  check('header-aria-indicates-descending',await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='descending');
  check('source-dom-row-order-unchanged',JSON.stringify(await dom('numbers'))==='["0","1","2","3","4"]');
  check('row-identities-and-model-values-unchanged',await page.locator('#numbers table').evaluate(table=>[...table.tBodies[0].rows].every((row,index)=>row===window.originalRows[index]&&row.textContent===window.sourceModel[index])));
  check('source-table-text-unchanged',await page.locator('#numbers table').textContent()===original.text);
  check('variable-height-rows-have-no-overlap-or-gaps',await page.locator('#numbers tbody tr').evaluateAll(rows=>{const boxes=rows.map(row=>row.getBoundingClientRect()).sort((a,b)=>a.top-b.top);return boxes.every((box,i)=>!i||Math.abs(box.top-boxes[i-1].bottom)<1);}));
  await page.locator('#numbers a').click();
  check('native-link-handler-retained-after-sorting',await page.evaluate(()=>window.linkClicks===1));
  await sort('numbers',1);await frame();
  check('ascending-keeps-ties-stable-and-missing-last',JSON.stringify(await visual('numbers'))==='["1","3","2","0","4"]');
  await sort('numbers',1);await frame();
  check('third-click-restores-original-visual-order',JSON.stringify(await visual('numbers'))==='["0","1","2","3","4"]'&&await page.locator('#numbers tbody tr[style]').count()===0);
  await page.locator('#numbers td').first().evaluate(cell=>{const range=document.createRange();range.selectNodeContents(cell);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
  await sort('numbers',1);await frame();
  check('sort-button-works-while-other-text-is-selected',await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='descending');
  await page.evaluate(()=>window.getSelection().removeAllRanges());await sort('numbers',1);await sort('numbers',1);await frame();
  await sort('numbers',0);await frame();
  const expectedChinese=await page.locator('#numbers tbody tr').evaluateAll(rows=>rows.map((row,index)=>({text:row.cells[0].textContent,index})).sort((a,b)=>new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'}).compare(b.text,a.text)||a.index-b.index).map(item=>String(item.index)));
  check('chinese-column-uses-locale-collation',JSON.stringify(await visual('numbers'))===JSON.stringify(expectedChinese));
  await sort('currency',1);await frame();check('currency-thousands-decimals-and-negatives',JSON.stringify(await visual('currency'))==='["0","2","1"]');
  await sort('percent',1);await frame();check('percent-column-sorts-numerically',JSON.stringify(await visual('percent'))==='["0","2","1"]');
  await sort('units',1);await frame();check('same-unit-column-sorts-numerically',JSON.stringify(await visual('units'))==='["0","2","1"]');
  await sort('mixed',1);await frame();check('different-units-use-a-consistent-text-order',JSON.stringify(await visual('mixed'))==='["2","0","1"]');
  check('table-sort-states-are-independent',await page.locator('#numbers th').first().getAttribute('aria-sort')==='descending'&&await page.locator('#currency th').nth(1).getAttribute('aria-sort')==='descending');
  await sort('numbers',1);await frame();
  await page.locator('#numbers tbody tr').first().locator('td').nth(1).evaluate(cell=>cell.firstChild.data='1');await frame();
  check('streaming-text-resorts-without-source-reordering',JSON.stringify(await visual('numbers'))==='["2","1","3","0","4"]'&&JSON.stringify(await dom('numbers'))==='["0","1","2","3","4"]');
  await page.locator('#numbers tbody').evaluate(body=>{const row=document.createElement('tr');row.dataset.row='5';row.innerHTML='<td>新</td><td>2</td><td>新增</td>';body.append(row);});await frame();
  check('new-streamed-rows-join-current-sort',JSON.stringify(await visual('numbers'))==='["2","1","3","5","0","4"]');
  await page.setViewportSize({width:640,height:900});await frame();
  check('resize-retains-sorted-order',JSON.stringify(await visual('numbers'))==='["2","1","3","5","0","4"]');
  check('resize-reflows-variable-height-rows-without-overlap',await page.locator('#numbers tbody tr').evaluateAll(rows=>{const boxes=rows.map(row=>row.getBoundingClientRect()).sort((a,b)=>a.top-b.top);return boxes.every((box,i)=>!i||Math.abs(box.top-boxes[i-1].bottom)<1);}));
  await page.setViewportSize({width:1280,height:900});await frame();
  await page.locator('html').evaluate(e=>e.lang='en');await frame();
  check('sort-controls-follow-page-language',/small values first|large values first/.test(await page.locator('#numbers th').nth(1).locator('button').getAttribute('aria-label')));
  await page.locator('#numbers th').nth(1).locator('button').focus();await page.keyboard.press('Enter');await frame();
  check('keyboard-activates-sort-control',await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='ascending');
  await page.locator('#numbers th').nth(1).locator('button').focus();await page.keyboard.press('Space');await frame();
  check('keyboard-restores-original-order',JSON.stringify(await visual('numbers'))==='["0","1","2","3","4","5"]');
  await page.locator('html').evaluate(e=>e.lang='zh-CN');await frame();await sort('numbers',1);await frame();
  await page.locator('#numbers th button').evaluateAll(buttons=>buttons.forEach(button=>button.blur()));
  await page.locator('#numbers').screenshot({path:path.join(evidence,'table-sorted.png')});
  await page.locator('#units').evaluate(e=>e.remove());await frame();
  check('unmount-cleans-only-removed-table',await page.evaluate(()=>window.__codexTableSort.snapshot().tables===4)&&await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='descending');
  const beforeRedraw=await visual('numbers');
  await page.locator('#numbers thead').evaluate(head=>{head.innerHTML='<tr><th>项目</th><th>数值</th><th>说明</th></tr>';});await frame();
  check('matching-rebuilt-header-retains-selection-and-row-order',await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='descending'&&JSON.stringify(await visual('numbers'))===JSON.stringify(beforeRedraw));
  await page.locator('#numbers').evaluate(element=>{element.hidden=true;});await frame();
  await page.locator('#numbers').evaluate(element=>{element.hidden=false;});await frame();
  check('same-table-restores-sort-after-hidden-ancestor',await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='descending'&&JSON.stringify(await visual('numbers'))===JSON.stringify(beforeRedraw));
  await page.locator('#numbers th').nth(1).evaluate(cell=>cell.textContent='更新后的数值');await frame();
  check('mismatched-header-rebuilds-controls-without-inheriting-sort',await page.locator('#numbers [data-codex-table-sort-control]').count()===3&&await page.locator('#numbers th').nth(1).textContent()==='更新后的数值'&&await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='none'&&JSON.stringify(await visual('numbers'))===JSON.stringify(await dom('numbers')));
  await sort('numbers',1);await frame();
  check('rebuilt-header-control-still-sorts',await page.locator('#numbers th').nth(1).getAttribute('aria-sort')==='descending');
  await page.evaluate(()=>window.__codexTableSort.remove());await frame();
  check('remove-cleans-controls-header-attributes-and-row-translates',await page.locator('[data-codex-table-sort-control],[data-codex-table-sort-header],[data-codex-table-sort-positioned],#codex-table-sort').count()===0&&await page.locator('#numbers tbody tr[style]').count()===0);
  check('remove-restores-original-order-and-header-semantics',JSON.stringify(await visual('numbers'))==='["0","1","2","3","4","5"]'&&await page.locator('#numbers th[aria-sort]').count()===0);
  check('reading-enhancement-survives-sort-removal',await page.locator('#codex-hud-reading-tables').count()===1);
  await page.evaluate(source);await frame();check('reinstall-starts-with-original-order',await page.evaluate(()=>window.__codexTableSort.snapshot().sorted===0));
  await page.evaluate(()=>{
   document.querySelectorAll('._TableScroller_fixture').forEach(e=>e.className='TableScroller-native');
   document.querySelectorAll('._TableWrapper_fixture').forEach(e=>e.className='TableWrapper-native');
  });await frame();
  check('updated-codex-class-names-keep-sort-controls',await page.locator('#numbers [data-codex-table-sort-control]').count()===3);
  await sort('numbers',1);await frame();
  check('updated-codex-class-names-sort-and-preserve-source-order',JSON.stringify(await visual('numbers'))==='["2","1","3","5","0","4"]'&&JSON.stringify(await dom('numbers'))==='["0","1","2","3","4","5"]');
  check('updated-codex-class-names-retain-width-enhancement',await page.locator('#numbers').evaluate(e=>e.hasAttribute('data-codex-hud-reading-table')));
  // Additional interactions are isolated from the earlier fixtures.
  await extended(page,sort,visual,dom,frame);
  await page.evaluate(()=>{window.__codexTableSort.remove();window.__codexReadingWidth.remove();});
  console.log(JSON.stringify({scope:'synthetic Edge; visual sorting only',passed:results.length,results}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
