// Synthetic interaction/lifecycle contract; real desktop checks are separate.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||require('node:path').resolve(__dirname,'../../../.runtime/token-hud/node/node_modules/playwright'));
const source=fs.readFileSync(path.join(__dirname,'file-changes.js'),'utf8');
const scratch=path.resolve(process.argv[2]),results=[];
function check(name,ok){if(!ok)throw Error(name);results.push(name);}
const fixture=()=>{
  window.actions={review:0,undo:0,native:0};
  window.fixture=(id,count,expanded=false)=>{
    const card=document.createElement('section');card.id=id;
    const header=document.createElement('div');header.className='group/turn-diff-header';
    header.innerHTML='<span>Summary</span><button data-review>查看变更</button><button data-undo>撤销</button>';
    header.querySelector('[data-review]').onclick=()=>window.actions.review++;
    header.querySelector('[data-undo]').onclick=()=>window.actions.undo++;
    card.append(header);
    if(count>1){
      const body=document.createElement('div');
      body.className='flex flex-col border-t [--codex-diffs-header-padding-x:var(--resource-card-row-padding-x)]';
      const render=open=>{
        body.replaceChildren();
        for(let n=0;n<(open?count:Math.min(3,count));n++){
          const row=document.createElement('div');row.className='group/turn-diff-file-row';row.textContent='fixture-file';body.append(row);
        }
        if(count>3){
          const more=document.createElement('button');more.setAttribute('aria-expanded',String(open));
          more.textContent=open?'收起文件':`再显示 ${count-3} 个文件`;
          more.onclick=()=>{window.actions.native++;render(!open);};body.append(more);
        }
      };
      render(expanded);card.append(body);
    }
    return card;
  };
  for(const [id,count] of [['one',1],['two',2],['three',3],['many',7]])document.querySelector('.thread-scroll-container').append(window.fixture(id,count));
};
(async()=>{
  const browser=await chromium.launchPersistentContext(scratch,{headless:true,executablePath:process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport:{width:1200,height:900}});
  try{
    const page=await browser.newPage();
    await page.setContent('<!doctype html><style>:root{--color-border:#555}.flex{display:flex}.flex-col{flex-direction:column}button{min-height:36px}section{margin:12px;background:#eee}[class~="group/turn-diff-file-row"]{height:36px}</style><main class="thread-scroll-container"></main>');
    await page.evaluate(fixture);await page.evaluate(source);
    const toggle=id=>page.locator(`#${id} [data-codex-hud-file-toggle]`);
    const visibleRows=id=>page.locator(`#${id} [class~="group/turn-diff-file-row"]`).evaluateAll(rows=>rows.filter(e=>e.getBoundingClientRect().height>0).length);
    for(const id of ['two','three','many'])check(`${id}-default-zero-rows`,await visibleRows(id)===0);
    check('single-file-header-untouched',await toggle('one').count()===0 && await page.locator('#one [data-review]').isVisible());
    check('collapsed-count-includes-unmounted-files',await toggle('many').innerText()==='展开 7 个文件');
    await toggle('two').press('Enter');check('two-keyboard-expand',await visibleRows('two')===2);
    await toggle('two').press('Space');check('two-keyboard-collapse',await visibleRows('two')===0);
    await toggle('three').click();check('three-expand-all',await visibleRows('three')===3);
    await toggle('three').click();check('three-collapse-zero',await visibleRows('three')===0);
    await toggle('many').click();check('many-native-reveal-all',await visibleRows('many')===7);
    check('native-footer-hidden',!await page.locator('#many [data-codex-hud-file-list]>button').isVisible());
    await page.evaluate(()=>{for(let i=0;i<4;i++)window.__codexFileChanges.snapshot();});
    check('expanded-survives-controller-refresh',await visibleRows('many')===7 && await page.evaluate(()=>window.actions.native)===1);
    await page.locator('#many [data-review]').click();await page.locator('#many [data-undo]').click();
    check('header-actions-preserved',await page.evaluate(()=>window.actions.review===1&&window.actions.undo===1));
    await toggle('many').click();check('many-collapse-zero',await visibleRows('many')===0);
    await toggle('many').click();check('reopen-does-not-toggle-native-back',await visibleRows('many')===7&&await page.evaluate(()=>window.actions.native)===1);
    await page.evaluate(()=>document.querySelector('#many [data-codex-hud-file-list]').replaceWith(document.querySelector('#many [data-codex-hud-file-list]').cloneNode(true)));
    check('body-replacement-keeps-user-expanded',await visibleRows('many')===7);
    // Restore a fixture with native handlers for shutdown checks.
    await page.evaluate(()=>document.querySelector('#many').replaceWith(window.fixture('many',7)));
    check('new-card-default-collapsed',await visibleRows('many')===0);
    await toggle('many').click();
    const firstFrame=await page.evaluate(()=>new Promise(resolve=>{
      const next=window.fixture('next',5);document.querySelector('.thread-scroll-container').append(next);
      requestAnimationFrame(()=>resolve(next.querySelector('[data-codex-hud-file-list]')?.getBoundingClientRect().height===0));
    }));
    check('new-card-collapsed-before-first-frame',firstFrame);
    await page.evaluate(()=>{
      const wrong=window.fixture('unknown',4);wrong.querySelector('.border-t').className='new-unsupported-layout';document.querySelector('.thread-scroll-container').append(wrong);
    });
    check('unknown-layout-untouched',await toggle('unknown').count()===0&&await visibleRows('unknown')===3);
    await page.evaluate(()=>document.querySelector('.thread-scroll-container').append(window.fixture('preexpanded',5,true)));
    check('preexpanded-default-hidden',await visibleRows('preexpanded')===0);
    await toggle('preexpanded').click();check('preexpanded-reveals-without-native-click',await visibleRows('preexpanded')===5);
    await page.evaluate(()=>document.querySelector('#next').remove());
    check('removed-cards-released',(await page.evaluate(()=>window.__codexFileChanges.snapshot())).cards===4);
    await page.evaluate(()=>window.__codexFileChanges.remove());
    check('remove-restores-native-three-rows',await visibleRows('many')===3);
    check('remove-preserves-original-native-expanded',await visibleRows('preexpanded')===5);
    check('remove-cleans-own-dom',await page.locator('[data-codex-hud-file-list],[data-codex-hud-file-toggle],#codex-hud-file-changes').count()===0);
    check('remove-preserves-small-file-lists',await visibleRows('two')===2&&await visibleRows('three')===3);
    await page.evaluate(source);check('reinstall-collapses-again',await visibleRows('many')===0);
    console.log(JSON.stringify({scope:'synthetic Edge interaction',passed:results.length,results}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
