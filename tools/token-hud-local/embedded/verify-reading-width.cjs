// Synthetic layout contract; desktop acceptance is recorded separately.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||require('node:path').resolve(__dirname,'../../../.runtime/token-hud/node/node_modules/playwright'));
const source=fs.readFileSync(path.join(__dirname,'reading-width.js'),'utf8');
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
  console.log(JSON.stringify({scope:'synthetic Edge layout',passed:results.length,results}));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
