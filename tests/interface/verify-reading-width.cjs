// Synthetic layout contract; desktop acceptance is recorded separately.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||require('node:path').resolve(__dirname,'../../scripts/node/node_modules/playwright'));
const source=fs.readFileSync(path.join(__dirname,'../../src/generated/ui/reading-width.js'),'utf8');
const scratch=path.resolve(process.argv[2]);
const results=[];
function check(name,ok){if(!ok)throw Error(name);results.push(name);}
const html=`<!doctype html><style>
html{font-size:16px;--thread-content-max-width:48rem}body{margin:0}
.thread-scroll-container{height:400px;padding:0 16px;overflow:auto}
.transcript{width:100%;max-width:var(--thread-body-max-width);--thread-body-max-width:calc(var(--thread-content-max-width) + 0px * 2);margin:auto}
.composer{width:100%;max-width:var(--thread-content-max-width);height:80px;margin:auto}
</style><div class="thread-scroll-container"><div class="transcript max-w-(--thread-body-max-width)"><p>Layout fixture</p></div><div class="composer max-w-(--thread-body-max-width)"><div data-codex-composer-root></div></div></div>`;
(async()=>{
 const browser=await chromium.launchPersistentContext(scratch,{headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1600,height:600}});
 try{
  const page=await browser.newPage();await page.setContent(html);await page.evaluate(source);
  const update=mode=>page.evaluate(mode=>window.__codexReadingWidth.update(mode),mode);
  const width=selector=>page.locator(selector).evaluate(e=>e.getBoundingClientRect().width);
  check('default-transcript-768',await width('.transcript')===768);
  check('wide-transcript-1152',(await update('wide')).applied && await width('.transcript')===1152);
  check('composer-unchanged',await width('.composer')===768);
  await page.locator('[data-codex-composer-root]').evaluate(e=>{e.removeAttribute('data-codex-composer-root');e.setAttribute('data-composer-body','');});
  check('chat-transcript-reuses-width-without-codex-root',(await update('wide')).width===1152 && await width('.composer')===768);
  check('custom-numeric-width',(await update(1280)).width===1280);
  check('invalid-width-restores-default',!(await update(9999)).applied&&await width('.transcript')===768);
  await update('wide');
  await page.setViewportSize({width:640,height:600});await update('wide');
  check('narrow-panel-fits',await width('.transcript')===608);
  await page.setViewportSize({width:1600,height:600});
  await page.locator('.thread-scroll-container').evaluate(e=>e.style.width='700px');await update('wide');
  check('side-panel-fits',await width('.transcript')===700);
  await page.locator('.thread-scroll-container').evaluate(e=>e.style.removeProperty('width'));
  const replacedWidth=await page.locator('.transcript').evaluate(e=>new Promise(resolve=>{
    const next=e.cloneNode(true);next.removeAttribute('data-codex-hud-reading-width');e.replaceWith(next);
    requestAnimationFrame(()=>resolve(next.getBoundingClientRect().width));
  }));
  check('replaced-transcript-wide-on-first-frame-without-polling',replacedWidth===1152);
  const routeWidth=await page.locator('.thread-scroll-container').evaluate(e=>new Promise(resolve=>{
    const next=e.cloneNode(true);next.querySelectorAll('[data-codex-hud-reading-width]').forEach(n=>n.removeAttribute('data-codex-hud-reading-width'));e.replaceWith(next);
    requestAnimationFrame(()=>resolve(next.querySelector('.transcript').getBoundingClientRect().width));
  }));
  check('new-route-wide-on-first-frame-without-polling',routeWidth===1152);
  const revealedWidth=await page.locator('.thread-scroll-container').evaluate(e=>new Promise(resolve=>{
    e.hidden=true;requestAnimationFrame(()=>{e.hidden=false;requestAnimationFrame(()=>resolve(e.querySelector('.transcript').getBoundingClientRect().width));});
  }));
  check('revealed-route-wide-on-first-frame-without-polling',revealedWidth===1152);
  await update('default');check('restore-default',await width('.transcript')===768 && await page.locator('#codex-hud-reading-width').count()===0);
  await update('wide');await page.evaluate(()=>document.body.append(document.querySelector('.thread-scroll-container').cloneNode(true)));
  check('side-chat-and-main-body-both-apply',(await update('wide')).targets===2 && await page.locator('[data-codex-hud-reading-width]').count()===2);
  await page.evaluate(()=>document.querySelectorAll('.thread-scroll-container')[1].style.width='600px');
  check('side-chat-shrinks-without-resetting-main',JSON.stringify((await update('wide')).widths)==='[1152,600]');
  await page.locator('.thread-scroll-container').nth(1).locator('.composer').evaluate(e=>e.hidden=true);
  check('read-only-subagent-body-without-composer-keeps-width',JSON.stringify((await update('wide')).widths)==='[1152,600]');
  await page.locator('.thread-scroll-container').nth(1).locator('.composer').evaluate(e=>e.hidden=false);
  check('width-setting-propagates-to-each-panel',JSON.stringify((await update(1280)).widths)==='[1280,600]');
  await update('wide');
  await page.evaluate(()=>{
    document.querySelectorAll('.transcript').forEach(e=>e.setAttribute('data-thread-user-message-navigation-content','true'));
    const auxiliary=document.createElement('div');auxiliary.className='auxiliary max-w-(--thread-body-max-width)';auxiliary.style.height='10px';
    document.querySelector('.thread-scroll-container').append(auxiliary);
  });
  check('native-transcript-metadata-ignores-extra-wrapper',(await update('wide')).targets===2 && await page.locator('.auxiliary[data-codex-hud-reading-width]').count()===0);
  await page.evaluate(()=>{
    const empty=document.createElement('div');empty.className='thread-scroll-container blank-panel';
    empty.innerHTML='<div class="max-w-(--thread-body-max-width)" style="height:0"></div>';
    const doc=document.createElement('section');doc.className='document-panel';
    doc.innerHTML='<div class="max-w-(--thread-body-max-width)" style="height:30px;max-width:var(--thread-content-max-width)">Document fixture</div>';
    document.body.append(empty,doc);
  });
  check('blank-page-and-document-do-not-reset-chat',(await update('wide')).targets===2);
  check('document-preview-not-modified',await page.locator('.document-panel [data-codex-hud-reading-width]').count()===0);
  await page.evaluate(()=>{
    const first=document.querySelector('.thread-scroll-container');const duplicate=first.querySelector('.transcript').cloneNode(true);
    duplicate.classList.add('duplicate');first.append(duplicate);
  });
  check('ambiguous-panel-isolated-from-valid-side-chat',(await update('wide')).targets===1 && await page.locator('.thread-scroll-container').nth(1).locator('[data-codex-hud-reading-width]').count()===1);
  const recovered=await page.evaluate(()=>new Promise(resolve=>{
    document.querySelector('.duplicate').remove();requestAnimationFrame(()=>resolve(document.querySelector('.transcript').getBoundingClientRect().width));
  }));
  check('main-recovers-before-paint-without-polling',recovered===1152);
  const sidebarClosed=await page.evaluate(()=>new Promise(resolve=>{
    document.querySelectorAll('.thread-scroll-container')[1].remove();requestAnimationFrame(()=>resolve(document.querySelector('.transcript').getBoundingClientRect().width));
  }));
  check('closing-side-chat-keeps-main-width',sidebarClosed===1152);
  await update('default');check('default-restores-all-panels',await page.locator('[data-codex-hud-reading-width]').count()===0);
  await update('wide');
  await page.evaluate(()=>window.__codexReadingWidth.remove());
  check('stop-restores-layout',await width('.transcript')===768 && await page.locator('#codex-hud-reading-width').count()===0);
  const table=(id,cells,wide=true)=>`<div data-markdown-table="true" ${wide?'data-wide-block':''} id="${id}"><button type="button" onclick="this.dataset.clicked='true'">Copy</button><div class="_TableScroller_fixture"><div class="_TableWrapper_fixture"><table><tbody><tr>${cells}</tr></tbody></table></div></div></div>`;
  const smallCells='<td>项目</td><td>金额</td>';
  const wideCells=Array.from({length:7},(_,i)=>`<td data-col-size="${i?'sm':'lg'}">${i?'说明内容需要保留足够的阅读空间':'日期与说明'}</td>`).join('');
  const hugeCells=Array.from({length:16},()=>'<td data-col-size="sm">说明内容需要保留足够的阅读空间</td>').join('');
  await page.setContent(`<!doctype html><style>
   html{font-size:16px;--thread-content-max-width:48rem}body{margin:0;font:16px/1.6 sans-serif}
   .thread-scroll-container{height:550px;padding:0 16px;overflow:auto}
   .panel{overflow:clip}.transcript{width:100%;max-width:var(--thread-content-max-width);margin:auto}
   [data-markdown-text-style="assistant-message"]{display:grid;grid-template-columns:minmax(0,1fr)}
   [data-markdown-table]{position:relative;width:100%;min-width:100%;margin:24px 0}
   [data-markdown-table][data-wide-block]{justify-self:unsafe center;width:fit-content;max-width:calc(50% + 800px)}
   ._TableScroller_fixture,.TableScroller-native{overflow-x:auto;display:flex}
   ._TableWrapper_fixture,.TableWrapper-native{flex-shrink:0;width:fit-content;min-width:100%}
   table{border-collapse:separate;border-spacing:0;table-layout:auto;width:fit-content;min-width:100%}
   td{max-width:calc(var(--thread-content-max-width)*18/24);overflow-wrap:break-word;padding:8px 24px 8px 0;border-bottom:1px solid #999}
   [align="right"]{text-align:right}
   [data-col-size="sm"]{min-width:calc(var(--thread-content-max-width)*4/24);max-width:calc(var(--thread-content-max-width)*6/24)}
   [data-col-size="lg"]{min-width:calc(var(--thread-content-max-width)*8/24);max-width:calc(var(--thread-content-max-width)*12/24)}
   [data-col-size="xl"]{min-width:calc(var(--thread-content-max-width)*14/24);max-width:calc(var(--thread-content-max-width)*18/24)}
   [data-markdown-table]:not([data-wide-block]) [data-col-size]{min-width:auto}
   button{position:absolute;right:0;top:-20px}
  </style><div class="thread-scroll-container"><div class="panel"><div class="transcript max-w-(--thread-body-max-width)" data-thread-user-message-navigation-content="true"><div data-markdown-text-style="assistant-message">
   <p>Table layout fixture</p>${table('small',smallCells,false)}${table('wide',wideCells)}${table('huge',hugeCells)}${table('prose','<td data-col-size="xl">'+('Readable text wraps in a native column. '.repeat(20))+'</td>')}
  </div><div data-markdown-text-style="user-message">${table('user',smallCells)}</div>
  <div data-conversation-print><div data-markdown-text-style="assistant-message">${table('print',smallCells)}</div></div>
  </div></div></div><div data-markdown-text-style="assistant-message">${table('document',smallCells)}</div>`);
  await page.evaluate(source);
  const box=selector=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width,center:r.left+r.width/2};});
  const near=(a,b)=>Math.abs(a-b)<1;
  await update(768);
  const small=await box('#small'),wide=await box('#wide');
  check('narrow-table-does-not-fill-prose',small.width<400);
  check('wide-table-can-exceed-prose',wide.width>768);
  check('tables-enhanced-at-default-width',await page.locator('[data-codex-hud-reading-table]').count()===4);
  for(const value of [992,1280,1600,768]){
   await update(value);
   const body=await box('.transcript'),s=await box('#small'),w=await box('#wide');
   check(`table-width-independent-of-prose-${value}`,near(s.width,small.width)&&near(w.width,wide.width));
   check(`tables-centered-around-prose-${value}`,near(s.center,body.center)&&near(w.center,body.center));
  }
  check('table-centering-can-be-disabled',await page.evaluate(()=>window.__codexReadingWidth.setTableCentered(false).tableCentered===false));
  const nativeSmall=await box('#small'),nativeBody=await box('.transcript');
  check('uncentered-table-uses-native-start-alignment',near(nativeSmall.left,nativeBody.left)&&near(nativeSmall.width,nativeBody.width));
  check('uncentered-table-keeps-column-enhancement',await page.locator('#wide td').first().evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='20px'&&await page.locator('[data-codex-hud-reading-table]').count()===4);
  check('table-centering-can-be-restored',await page.evaluate(()=>window.__codexReadingWidth.setTableCentered(true).tableCentered===true));
  check('restored-table-is-centered-again',near((await box('#small')).center,(await box('.transcript')).center));
  const tablesDisabled=await page.evaluate(()=>window.__codexReadingWidth.setTablesEnabled(false));
  check('table-master-switch-removes-layout-enhancement',tablesDisabled.tableEnabled===false&&tablesDisabled.tables===0&&await page.locator('[data-codex-hud-reading-table]').count()===0);
  check('table-master-off-restores-native-cell-spacing',await page.locator('#wide td').first().evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='24px');
  const tablesEnabled=await page.evaluate(()=>window.__codexReadingWidth.setTablesEnabled(true));
  check('table-master-switch-restores-layout-enhancement',tablesEnabled.tableEnabled===true&&tablesEnabled.tables===4&&await page.locator('[data-codex-hud-reading-table]').count()===4);
  check('prose-column-readable-minimum',await page.locator('#wide td').nth(1).evaluate(e=>getComputedStyle(e).minWidth)==='96px');
  check('short-column-gap-is-20px',await page.locator('#wide td').first().evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='20px');
  check('prose-column-gap-stays-32px',await page.locator('#wide td').nth(1).evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='32px');
  check('last-column-padding-stays-native',await page.locator('#wide td').last().evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='24px');
  await page.evaluate(()=>{const style=document.createElement('style');style.id='font-fixture';style.textContent='#wide table{font-size:20px}';document.head.append(style);});await update(768);
  check('font-change-refreshes-measurement-without-content-mutation',await page.locator('#wide td').nth(1).evaluate(e=>getComputedStyle(e).minWidth)==='120px');
  check('font-change-keeps-prose-gap-at-32px',await page.locator('#wide td').nth(1).evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='32px');
  await page.evaluate(()=>document.querySelector('#font-fixture').remove());await update(768);
  check('native-font-and-alignment-retained',await page.locator('#wide table').evaluate(e=>getComputedStyle(e).tableLayout)==='auto');
  check('long-prose-uses-comfortable-column-wrap',await width('#prose')<500);
  await page.locator('#small button').click();
  check('native-table-control-remains-clickable',await page.locator('#small button').getAttribute('data-clicked')==='true');
  check('user-print-and-document-tables-untouched',await page.locator('#user[data-codex-hud-reading-table],#print[data-codex-hud-reading-table],#document[data-codex-hud-reading-table]').count()===0);
  check('oversize-table-keeps-local-horizontal-scroll',await page.locator('#huge ._TableScroller_fixture').evaluate(e=>{e.scrollLeft=1e6;return e.scrollWidth>e.clientWidth&&e.scrollLeft>0;}));
  await page.setViewportSize({width:640,height:700});await update(992);
  const narrow=await box('#wide');
  check('narrow-window-both-edges-accessible',narrow.left>=16&&narrow.right<=624&&await page.locator('#wide ._TableScroller_fixture').evaluate(e=>e.scrollWidth>e.clientWidth));
  check('narrow-window-long-columns-not-squeezed',await page.locator('#wide td').nth(1).evaluate(e=>e.getBoundingClientRect().width>=128));
  check('narrow-window-no-page-horizontal-overflow',await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
  await page.setViewportSize({width:1600,height:700});await update(992);
  await page.locator('.panel').evaluate(e=>e.style.width='600px');
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const side=await box('#wide'),panel=await box('.panel');
  check('split-pane-resize-observed-without-polling',side.left>=panel.left-1&&side.right<=panel.right+1&&near(side.center,panel.center));
  await page.locator('.panel').evaluate(e=>e.style.removeProperty('width'));await update(992);
  check('wider-window-restores-natural-table-width',near((await box('#wide')).width,wide.width));
  const mounted=await page.locator('#small').evaluate(e=>new Promise(resolve=>{
   const clone=e.cloneNode(true);clone.id='mounted';clone.removeAttribute('data-codex-hud-reading-table');e.after(clone);
   requestAnimationFrame(()=>resolve(clone.hasAttribute('data-codex-hud-reading-table')));
  }));
  check('new-streamed-table-enhanced-before-paint',mounted);
  await page.locator('#small td').last().evaluate(e=>e.textContent='A newly streamed longer value');
  check('streamed-content-can-change-natural-width',(await box('#small')).width>small.width);
  await page.evaluate(()=>document.querySelector('#mounted').remove());await update(992);
  await page.evaluate(()=>{
   const scroll=document.querySelector('.thread-scroll-container'),side=scroll.cloneNode(true);
   side.id='side';side.querySelector('.panel').style.width='600px';document.body.append(side);
  });
  check('main-and-side-tables-enhanced-together',(await update(992)).tables===8);
  const sideTable=await box('#side #wide'),sideBody=await box('#side .transcript');
  check('side-table-independent-of-main-panel',near(sideTable.center,sideBody.center)&&sideTable.width<=600&&near((await box('.thread-scroll-container:not(#side) #wide')).width,wide.width));
  await page.evaluate(()=>{
   const first=document.querySelector('.thread-scroll-container:not(#side)'),duplicate=first.querySelector('.transcript').cloneNode(true);
   duplicate.id='duplicate';first.querySelector('.panel').append(duplicate);
  });
  check('ambiguous-table-layout-isolated',(await update(992)).tables===4&&await page.locator('.thread-scroll-container:not(#side) [data-codex-hud-reading-table]').count()===0);
  await page.evaluate(()=>{document.querySelector('#duplicate').remove();document.querySelector('#side').remove();});await update(992);
  await page.locator('[data-markdown-text-style="assistant-message"]').first().evaluate((e,markup)=>e.insertAdjacentHTML('beforeend',markup),
    table('mixed','<td>任务</td><td>先做</td><td data-col-size="sm">需要明确输入身份与撤回范围，为后续开发提供稳定基础</td>')+
    table('numeric','<td align="right">12</td><td align="right">8.50</td><td>通过</td>')+
    table('unbroken','<td>路径</td><td><span style="white-space:nowrap">'+('very-long-unbroken-path/'.repeat(30))+'</span></td>'));
  await update(992);
  check('short-columns-avoid-native-128px-floor',await page.locator('#mixed td').nth(1).evaluate(e=>e.getBoundingClientRect().width<100));
  check('explanation-column-expands-independently',await page.locator('#mixed td').nth(2).evaluate(e=>e.getBoundingClientRect().width>300));
  check('numeric-table-stays-compact',await width('#numeric')<300);
  check('numeric-alignment-retained',await page.locator('#numeric td').first().evaluate(e=>getComputedStyle(e).textAlign)==='right');
  check('unbreakable-content-scrolls-without-clipping',await page.locator('#unbroken ._TableScroller_fixture').evaluate(e=>{e.scrollLeft=1e6;return e.scrollWidth>e.clientWidth&&e.scrollLeft>0;}));
  const noExtraMeasurement=await page.evaluate(()=>{
    let count=0;const prototype=Element.prototype,original=prototype.setAttribute;
    prototype.setAttribute=function(name,value){if(name==='data-codex-hud-table-measuring')count++;return original.call(this,name,value);};
    try{for(let i=0;i<10;i++)window.__codexReadingWidth.update(992);}finally{prototype.setAttribute=original;}
    return count===0;
  });
  check('unchanged-polling-reuses-column-measurements',noExtraMeasurement);
  await page.locator('#mixed td').nth(1).evaluate(e=>{e.firstChild.data='这段流式说明现在需要更宽的列来保留清晰的阅读空间';});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  check('text-node-streaming-refreshes-readable-floor',await page.locator('#mixed td').nth(1).evaluate(e=>getComputedStyle(e).minWidth)==='96px');
  check('streamed-prose-restores-comfortable-gap',await page.locator('#mixed td').nth(1).evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='32px');
  await page.locator('#mixed td').nth(1).evaluate(e=>{e.firstChild.data='先做';});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  check('shorter-content-releases-column-width',await page.locator('#mixed td').nth(1).evaluate(e=>e.getBoundingClientRect().width<100));
  check('shortened-content-restores-compact-gap',await page.locator('#mixed td').nth(1).evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='20px');
  check('measurement-leaves-no-live-markers',await page.locator('[data-codex-hud-table-measuring]').count()===0);
  const beforeRename=await width('#mixed');
  await page.evaluate(()=>{
   document.querySelectorAll('._TableScroller_fixture').forEach(e=>e.className='TableScroller-native');
   document.querySelectorAll('._TableWrapper_fixture').forEach(e=>e.className='TableWrapper-native');
  });await update(992);
  check('updated-codex-class-names-preserve-column-layout',near(await width('#mixed'),beforeRename)&&await page.locator('#mixed td').first().evaluate(e=>getComputedStyle(e).paddingInlineEnd)==='20px');
  if(process.env.BETTER_CODEX_TABLE_SCREENSHOT){
   await page.locator('#mixed').screenshot({path:process.env.BETTER_CODEX_TABLE_SCREENSHOT});
   await page.setViewportSize({width:640,height:700});await update(992);
   await page.locator('#wide').screenshot({path:process.env.BETTER_CODEX_TABLE_SCREENSHOT.replace(/\.png$/,'-narrow.png')});
   await page.setViewportSize({width:1600,height:700});await update(992);
  }
  const details=(id,rows)=>`<div data-markdown-table="true" data-wide-block id="${id}"><div class="TableScroller-native"><div class="TableWrapper-native"><table><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div></div>`;
  const sentence=length=>'需要核对输入内容和处理规则并保留必要记录以便后续检查'.repeat(5).slice(0,length);
  const lengths=[35,36,39,42,45,47,50,53,62,70];
  await page.locator('[data-markdown-text-style="assistant-message"]').first().evaluate((e,markup)=>e.insertAdjacentHTML('beforeend',markup),
    details('balanced',lengths.map((length,i)=>[`任务 ${i+1}`,sentence(length)]))+
    details('outlier',Array.from({length:10},(_,i)=>[`任务 ${i+1}`,sentence(i===0?110:8)]))+
    details('several',[31,32,33,35,36,38,42,45,50,56].map((length,i)=>[`任务 ${i+1}`,sentence(length),sentence(length)]))+
    details('manual-lines',[['说明',`<p>${sentence(12)}</p><p>${sentence(12)}</p>`],['规则',`${sentence(10)}<br>${sentence(10)}`]])+
    details('inline-prose',lengths.map((length,i)=>[`任务 ${i+1}`,`<p><strong>${sentence(8)}</strong>${sentence(length-8)}</p>`])));
  await update(992);
  const geometry=id=>page.locator(`#${id} table`).evaluate(table=>({width:table.getBoundingClientRect().width,height:table.getBoundingClientRect().height,columns:[...table.rows[0].cells].map(cell=>cell.getBoundingClientRect().width),caps:[...table.rows[0].cells].map(cell=>parseFloat(getComputedStyle(cell).getPropertyValue('--codex-hud-column-max'))),text:table.textContent}));
  const capture=async suffix=>{
   if(!process.env.BETTER_CODEX_TABLE_SCREENSHOT)return;
   const scroll=page.locator('.thread-scroll-container').first();
   await scroll.evaluate(e=>{e.style.height='auto';e.scrollTop=0;});
   try{await page.locator('#balanced').screenshot({path:process.env.BETTER_CODEX_TABLE_SCREENSHOT.replace(/\.png$/,`-wrap-${suffix}.png`)});}finally{await scroll.evaluate(e=>e.style.removeProperty('height'));}
  };
  await page.evaluate(()=>{const style=document.createElement('style');style.id='baseline-caps';style.textContent='#balanced td{max-width:28em!important}';document.head.append(style);});await update(992);
  const before=await geometry('balanced');
  await capture('before');
  await page.evaluate(()=>document.querySelector('#baseline-caps').remove());await update(992);
  const after=await geometry('balanced');
  check('explanation-with-repeated-wrapping-gets-extra-width',after.columns[1]>before.columns[1]*1.15);
  check('extra-width-reduces-real-table-height',after.height<before.height*.9);
  check('extra-width-keeps-short-column-compact',near(before.columns[0],after.columns[0]));
  check('adaptive-width-does-not-change-text',before.text===after.text);
  check('one-long-outlier-does-not-widen-every-row',(await geometry('outlier')).caps[1]===28);
  const several=await geometry('several');
  check('multiple-long-columns-share-a-bounded-expansion-budget',several.caps[1]>28&&several.caps[2]>28&&several.caps.reduce((sum,cap)=>sum+cap-28,0)<=12&&several.caps.every(cap=>cap<=40));
  check('deliberate-paragraphs-and-line-breaks-keep-natural-width',(await geometry('manual-lines')).caps[1]===28);
  check('nested-paragraph-and-inline-markup-measure-actual-content',(await geometry('inline-prose')).caps[1]>28);
  for(const value of [768,1280,1600]){await update(value);check(`adaptive-table-width-independent-of-prose-${value}`,near((await geometry('balanced')).width,after.width));}
  await page.setViewportSize({width:420,height:700});await update(992);
  check('adaptive-table-respects-narrow-panel',await page.locator('#balanced').evaluate(e=>e.getBoundingClientRect().width<=388)&&await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
  await page.setViewportSize({width:200,height:700});await update(992);
  check('adaptive-long-column-scrolls-locally-in-narrow-window',await page.locator('#balanced .TableScroller-native').evaluate(e=>e.scrollWidth>e.clientWidth)&&await page.evaluate(()=>document.documentElement.scrollWidth===document.documentElement.clientWidth));
  await page.setViewportSize({width:1600,height:700});await update(992);
  check('adaptive-width-restores-after-narrow-window',near((await geometry('balanced')).width,after.width));
  await page.locator('#balanced td:nth-child(2)').evaluateAll(cells=>cells.forEach(cell=>cell.textContent='短说明'));await update(992);
  check('shortened-content-releases-adaptive-expansion',(await geometry('balanced')).caps[1]===28&&(await geometry('balanced')).width<after.width*.6);
  await page.locator('#balanced td:nth-child(2)').evaluateAll((cells,values)=>cells.forEach((cell,index)=>cell.textContent=values[index]),lengths.map(sentence));await update(992);
  await capture('after');
  await page.locator('[data-markdown-text-style="assistant-message"]').first().evaluate((e,markup)=>e.insertAdjacentHTML('beforeend',markup),
    details('many-descriptions',Array.from({length:6},(_,i)=>[sentence(22+i),sentence(48+i),sentence(36+i),sentence(42+i),sentence(40+i),sentence(32+i)])));
  await page.setViewportSize({width:2560,height:900});await update(1216);
  const bounded=await geometry('many-descriptions'),boundedBox=await box('#many-descriptions');
  check('six-long-columns-have-comfortable-overall-width',bounded.width<=1281&&bounded.width>1100);
  check('wide-table-leaves-space-on-both-sides',boundedBox.left>400&&2560-boundedBox.right>400);
  check('bounded-table-remains-centered-on-prose',near(boundedBox.center,(await box('.transcript')).center));
  await page.setViewportSize({width:3840,height:900});await update(1600);
  check('larger-display-does-not-stretch-multi-column-table',near((await geometry('many-descriptions')).width,bounded.width));
  check('two-column-improvement-survives-overall-width-limit',near((await geometry('balanced')).width,after.width));
  await page.locator('#many-descriptions table').evaluate(e=>e.style.fontSize='24px');await update(1600);
  check('larger-font-cannot-expand-table-beyond-absolute-limit',(await box('#many-descriptions')).width<=1441);
  await page.locator('#many-descriptions table').evaluate(e=>e.style.removeProperty('font-size'));await update(1216);
  await page.setViewportSize({width:640,height:900});await update(1216);
  const boundedNarrow=await box('#many-descriptions');
  check('bounded-many-column-table-still-scrolls-in-narrow-panel',boundedNarrow.left>=16&&boundedNarrow.right<=624&&await page.locator('#many-descriptions .TableScroller-native').evaluate(e=>e.scrollWidth>e.clientWidth));
  check('bounded-many-column-table-keeps-readable-cell-floors',await page.locator('#many-descriptions td').evaluateAll(cells=>cells.every(cell=>cell.getBoundingClientRect().width>=120)));
  await page.setViewportSize({width:1600,height:700});await update(992);
  await page.evaluate(()=>window.__codexReadingWidth.remove());
  check('stop-restores-native-table-styles',await page.locator('[data-codex-hud-reading-table],#codex-hud-reading-tables').count()===0&&await width('#small')===768);
  check('stop-removes-measurement-styles',await page.locator('#codex-hud-reading-table-measure,[data-codex-hud-table-measuring]').count()===0);
  await page.setContent(`<!doctype html><style>
   header{display:flex;width:420px} [data-viewer-header-item]{display:flex;flex:1;min-width:0}
   nav{display:grid;grid-template-columns:minmax(0,1fr);min-width:0}
   nav>div{grid-area:1/1;min-width:0;max-width:100%;justify-self:start}
   nav>[aria-hidden]{visibility:hidden;height:0} nav span{display:block;width:240px;transform:scaleX(1.0001)}
   nav ol{display:flex;width:max-content;max-width:100%;overflow:hidden;margin:0;padding:0;list-style:none}
   nav li{width:240px;flex:none} nav li[aria-hidden]{display:none;width:24px} nav[data-compact] li[aria-hidden]{display:list-item}
  </style><header data-viewer-density="compact"><div data-viewer-header-item><nav aria-label="File path">
   <div aria-hidden="true"><span></span></div><div data-menu-overlay-surface><div><ol><li aria-hidden="true">…</li>
   <li><button onclick="this.dataset.clicked='true'">File</button></li></ol></div></div>
  </nav></div><button id="tools">Tools</button></header>`);
  // A fractional intrinsic width undercounts the path in the full state; the
  // compact label grows it again. This models the native fit feedback loop.
  await page.locator('nav').evaluate(nav=>{
   new ResizeObserver(()=>nav.toggleAttribute('data-compact',nav.getBoundingClientRect().width<nav.querySelector('span').getBoundingClientRect().width)).observe(nav);
  });
  const samplePath=()=>page.locator('nav').evaluate(async nav=>{
   const states=new Set();
   for(let i=0;i<8;i++){
    await new Promise(resolve=>requestAnimationFrame(resolve));
    states.add(nav.hasAttribute('data-compact'));
   }
   return [...states];
  });
  check('native-file-path-fixture-oscillates', (await samplePath()).length===2);
  const toolsBefore=await box('#tools');
  await page.evaluate(source);
  await page.waitForFunction(()=>!document.querySelector('nav').hasAttribute('data-compact'));
  check('file-path-stable-at-fractional-intrinsic-width',JSON.stringify(await samplePath())==='[false]'&&near((await box('#tools')).left,toolsBefore.left)&&await width('[data-menu-overlay-surface]')===240);
  await page.locator('nav button').click();
  check('file-path-native-button-stays-clickable',await page.locator('nav button').getAttribute('data-clicked')==='true');
  await page.locator('header').evaluate(e=>e.style.width='225px');
  await page.waitForFunction(()=>document.querySelector('nav').hasAttribute('data-compact'));
  check('file-path-still-compacts-when-panel-narrows',JSON.stringify(await samplePath())==='[true]');
  await page.evaluate(()=>window.__codexReadingWidth.remove());
  check('stop-restores-native-file-path-layout',await page.locator('#codex-hud-file-path-width').count()===0&&await page.locator('nav').evaluate(e=>getComputedStyle(e).flexGrow)==='0');
  const dimensions=({width,height,columns})=>({width,height,columns});
  console.log(JSON.stringify({scope:'synthetic Edge layout',passed:results.length,results,comparison:{before:dimensions(before),after:dimensions(after)}}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
