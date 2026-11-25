const assert=require('node:assert/strict'),path=require('node:path');
const {pageSource}=require('../../src/platform/i18n/i18n.js');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
let passed=0;
function check(name,value){assert.ok(value,name);passed++;console.log('PASS '+name);}

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1060,height:640}});
    const fixtureUrl='https://workspace-tree.invalid/index.html';
    await page.route(fixtureUrl,route=>route.fulfill({contentType:'text/html',body:`
      <!doctype html><html lang="zh-CN"><body>
      <section data-app-shell-active-page="true" style="display:contents">
        <div data-app-shell-main-titlebar><div data-app-shell-header-toolbar style="display:flex">
          <div>Chat</div><div id="actions" style="display:flex"><button id="native">Native files</button></div>
        </div></div>
        <main data-app-shell-main-surface style="display:flex;height:520px">
          <div id="layout" data-app-shell-workspace-layout="split" data-app-shell-right-panel-full-width="false" style="flex:1;min-width:0">
            <div id="thread" data-above-composer-conversation-id="${a}">Chat composer</div>
          </div>
          <aside data-app-shell-focus-area="right-panel" id="right"></aside>
        </main>
      </section></body></html>`}));
    await page.goto(fixtureUrl);
    await page.evaluate(({a,b})=>{
      const right=document.getElementById('right'),root=()=>right.querySelector('file-tree-container')?.shadowRoot;
      const state=window.native={calls:0,shortcuts:0,previewOpened:0,protocolCalls:0,unsupported:false,offline:false,delay:0,roots:{}};
      window.electronBridge={sendMessageFromView(){state.protocolCalls++;}};
      const mount=()=>{
        const id=document.getElementById('thread').dataset.aboveComposerConversationId;
        if(!state.roots[id])state.roots[id]={changed:true,all:true};
        const expansion=state.roots[id];
        right.innerHTML='<section role="tabpanel" data-app-shell-tab-panel-controller="right" data-tab-id="file:local:" style="width:320px"><div><div id="native-breadcrumb" class="shrink-0">Native breadcrumbs</div><div data-app-shell-pane-content-viewport="true"><div id="native-row" style="display:flex"><div id="native-preview" style="flex:1"><h2>打开文件</h2></div><div id="navigation" style="width:130px;max-width:60%"><div role="separator"></div><div><input placeholder="筛选文件…"><div class="group/nav-list"><button>所有更改</button></div><file-tree-container data-file-tree-virtualized="true"></file-tree-container></div></div></div></div></div></section>';
        if(state.unsupported)right.querySelector('h2').textContent='Unexpected native layout';
        const tree=right.querySelector('file-tree-container').attachShadow({mode:'open'});
        tree.innerHTML='<div data-file-tree-id="fixture"><div role="tree"></div></div>';
        const rows=tree.querySelector('[role=tree]');
        const folder=(label,key)=>{
          const row=document.createElement('button');row.type='button';row.setAttribute('role','treeitem');
          row.setAttribute('aria-level','1');row.setAttribute('aria-expanded',String(expansion[key]));row.setAttribute('aria-label',label);
          row.dataset.itemType='folder';row.dataset.itemPath=label+'/';
          const icon=document.createElement('div');icon.dataset.itemSection='icon';
          const content=document.createElement('div');content.dataset.itemSection='content';content.textContent=label;
          const measure=document.createElement('span');measure.hidden=true;measure.textContent='…'+label;content.append(measure);
          row.append(icon,content);row.addEventListener('click',()=>{expansion[key]=!expansion[key];paint();});return row;
        };
        const paint=()=>{
          rows.replaceChildren(folder('已更改的文件','changed'));
          if(expansion.changed){const change=document.createElement('div');change.textContent='native change';rows.append(change);}
          rows.append(folder('所有文件','all'));
          if(expansion.all){
            const row=document.createElement('button');row.type='button';row.textContent=id===a?'main.js':'worktree.ps1';
            const icon=document.createElement('span');icon.dataset.nativeIcon=id===a?'javascript':'powershell';
            icon.setAttribute('aria-hidden','true');icon.textContent=id===a?'JS':'PS';row.prepend(icon);
            row.addEventListener('click',()=>{
              state.previewOpened++;
              right.firstElementChild.dataset.tabId='file:local:opened-example';
              right.querySelector('h2').textContent='File preview';
            });
            rows.append(row);
          }
        };
        paint();
      };
      const nativeToggle=()=>{
        if(root()&&right.firstElementChild.dataset.tabId==='file:local:')right.replaceChildren();
        else if(!state.offline){if(state.delay)setTimeout(mount,state.delay);else mount();}
      };
      window.addEventListener('message',e=>{
        if(e.origin===location.origin&&e.source===window&&e.data?.type==='toggle-file-tree-panel'){
          state.calls++;nativeToggle();
        }
      });
      window.addEventListener('keydown',e=>{
        if(e.code==='KeyE'&&e.ctrlKey&&e.shiftKey&&!e.defaultPrevented){state.shortcuts++;nativeToggle();}
      });
      document.getElementById('native').addEventListener('click',nativeToggle);
      state.switchThread=id=>{right.replaceChildren();document.getElementById('thread').dataset.aboveComposerConversationId=id;};
    },{a,b});
    await page.addScriptTag({content:pageSource('zh-CN')});
    await page.addScriptTag({path:path.resolve(__dirname,'../../src/interface/workspace_tree/workspace-tree.js')});
    const trigger=page.locator('[data-bc-workspace-tree-trigger] button');
    const preview=page.locator('#native-preview'),filter=page.getByPlaceholder('筛选文件…'),tree=page.locator('file-tree-container');
    const compact=page.locator('[data-bc-native-tree-layout="fill"]');
    const enable=value=>page.evaluate(v=>window.__codexWorkspaceTree.setEnabled(v),value);
    const stats=()=>page.evaluate(()=>({calls:window.native.calls,shortcuts:window.native.shortcuts,protocolCalls:window.native.protocolCalls,previewOpened:window.native.previewOpened}));
    const switchThread=id=>page.evaluate(id=>window.native.switchThread(id),id);
    const aria=(value)=>page.waitForFunction(value=>document.querySelector('[data-bc-workspace-tree-trigger]')?.shadowRoot.querySelector('button').getAttribute('aria-expanded')===value,value);
    await enable(true);
    check('toolbar starts closed and makes no native request',await trigger.isVisible()&&!(await tree.count())&&(await stats()).calls===0);
    await page.keyboard.press('Control+Shift+E');
    await tree.waitFor();await aria('true');
    check('stock shortcut opens stock preview and change list',await preview.isVisible()&&await tree.getByText('native change').isVisible()&&!(await compact.count())&&(await stats()).shortcuts===1);
    await trigger.click();await tree.waitFor({state:'detached'});await aria('false');
    check('existing stock pane can be closed by toolbar', (await stats()).calls===1);
    await page.evaluate(()=>{window.native.delay=120;});
    await trigger.evaluate(b=>{b.click();b.click();});
    await compact.waitFor();await tree.getByText('native change').waitFor({state:'detached'});await aria('true');
    check('one native action even with fast repeated clicks', (await stats()).calls===2&&(await stats()).protocolCalls===0);
    check('native layout alone is compacted', !await preview.isVisible()&&await filter.isVisible()&&
      await page.locator('#native-breadcrumb').isHidden()&&await page.getByText('所有更改').isHidden()&&
      await page.locator('#navigation > [role="separator"]').isHidden()&&await page.getByText('Chat composer').isVisible());
    check('unchanged native icon and all files rows',await tree.locator('[data-native-icon="javascript"]').isVisible()&&
      await tree.getByRole('treeitem',{name:'所有文件'}).getAttribute('aria-expanded')==='true'&&
      await tree.getByRole('treeitem',{name:'已更改的文件'}).evaluate(e=>getComputedStyle(e).opacity)==='0');
    await filter.fill('main');
    check('existing native search is editable',await filter.inputValue()==='main');
    await trigger.click();await tree.waitFor({state:'detached'});
    check('managed close restores the changes expansion',await page.evaluate(id=>window.native.roots[id].changed,a));
    await trigger.click();await compact.waitFor();
    await tree.getByRole('button',{name:'main.js'}).click();
    await compact.waitFor({state:'detached'});
    check('explicit file selection opens stock preview',await preview.isVisible()&&(await stats()).previewOpened===1);
    await switchThread(b);
    await trigger.click();await compact.waitFor();
    check('next thread uses native worktree content, not previous rows',await tree.locator('[data-native-icon="powershell"]').isVisible()&&!(await tree.getByText('main.js').count()));
    await enable(false);await compact.waitFor({state:'detached'});
    check('disabling removes added button and CSS, not native files',await trigger.count()===0&&await tree.isVisible()&&await preview.isVisible()&&await tree.getByText('native change').isVisible());
    await page.keyboard.press('Control+Shift+E');
    await tree.waitFor({state:'detached'});
    await enable(true);
    await page.evaluate(()=>{window.native.unsupported=true;window.native.delay=0;});
    await trigger.click();await tree.waitFor();await aria('true');
    check('unrecognized layout uses original native viewer',await preview.isVisible()&&!(await compact.count()));
    await trigger.click();await tree.waitFor({state:'detached'});
    await page.evaluate(()=>{window.native.offline=true;});
    await trigger.click();await page.waitForFunction(()=>document.querySelector('[data-bc-workspace-tree-trigger]').shadowRoot.querySelector('button').title.includes('无法打开'));
    check('unavailable native command fails without fabricating files',!(await tree.count())&&(await stats()).protocolCalls===0);
    await page.evaluate(()=>{document.getElementById('layout').dataset.appShellRightPanelFullWidth='true';});
    await trigger.waitFor({state:'detached'});
    await page.evaluate(()=>window.__codexWorkspaceTree.remove());
    await page.locator('#native').click();
    check('removal preserves stock action',await page.locator('#native').isVisible()&&!await trigger.count());
    console.log(JSON.stringify({passed}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
