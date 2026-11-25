const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createWorkspaceTree}=require('../../src/interface/workspace_tree/workspace-tree.cjs');
const {pageSource}=require('../../src/platform/i18n/i18n.js');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
const [fixture]=process.argv.slice(2);
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
const codexHome=path.resolve(fixture,'codex-data');
const folderA=path.resolve(fixture,'project'),folderB=path.resolve(codexHome,'worktrees','worktree');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let passed=0;
function check(name,value){assert.ok(value,name);passed++;console.log('PASS '+name);}

(async()=>{
  await fs.mkdir(path.join(folderA,'src'),{recursive:true});
  await fs.mkdir(folderB,{recursive:true});
  await fs.writeFile(path.join(folderA,'readme.md'),'does not enter the tree');
  await fs.writeFile(path.join(folderB,'other.txt'),'another scope');
  await fs.symlink(folderB,path.join(folderA,'outside'),process.platform==='win32'?'junction':'dir');
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1060,height:640}});
  const fixtureUrl='https://workspace-tree.invalid/index.html';
  await page.route(fixtureUrl,route=>route.fulfill({contentType:'text/html',body:`
    <!doctype html><html lang="zh-CN"><body>
    <section data-app-shell-active-page="true" style="display:contents">
      <div data-app-shell-main-titlebar><div data-app-shell-header-toolbar style="display:flex">
        <div>Chat</div><div id="actions" style="display:flex"><button id="native">Native files</button></div>
      </div></div>
      <div data-app-shell-main-surface><div id="lane" style="display:flex;height:520px">
        <main id="chat" style="flex:1 1 0;min-width:0" data-app-shell-focus-area="main"><div data-codex-composer-root>
          <div id="thread" data-above-composer-conversation-id="${a}">composer</div>
        </div></main>
      </div></div>
    </section></body></html>`}));
  await page.goto(fixtureUrl);
  await page.evaluate(({roots})=>{
    window.calls=[];window.waitForNative=0;window.shortcuts=0;
    window.addEventListener('keydown',event=>{if(event.ctrlKey&&event.shiftKey&&event.code==='KeyE'&&!event.defaultPrevented)window.shortcuts++;});
    window.electronBridge={sendMessageFromView({type,hostId,request}){
      window.calls.push({type,hostId,method:request.method,includeTurns:request.params.includeTurns});
      setTimeout(()=>window.postMessage({type:'mcp-response',hostId,message:{id:request.id,
        result:{thread:{id:request.params.threadId,cwd:roots[request.params.threadId]}}}},location.origin),window.waitForNative);
    }};
  },{roots:{[a]:folderA,[b]:folderB}});
  await page.addScriptTag({content:pageSource('zh-CN')});
  await page.addScriptTag({path:path.resolve(__dirname,'../../src/interface/workspace_tree/workspace-tree.js')});
  const tree=createWorkspaceTree({codexHome,readWorkspace:request=>page.evaluate(request=>window.__codexWorkspaceTree.workspace(request),request)});
  async function step(){
    const intent=await page.evaluate(()=>window.__codexWorkspaceTree.intent());
    const state=tree.tick(intent);
    if(state)await page.evaluate(state=>window.__codexWorkspaceTree.state(state),state);
    return intent;
  }
  async function until(test,label){
    const end=Date.now()+5200;
    do{await step();if(await test())return true;await wait(60);}while(Date.now()<end);
    throw Error('timeout: '+label);
  }
  const pane=page.locator('[data-bc-workspace-tree]');
  const trigger=page.locator('[data-bc-workspace-tree-trigger] button');
  const rows=()=>pane.locator('.row .label').allTextContents();
  const has=name=>pane.getByText(name,{exact:true}).isVisible();
  try{
    await page.evaluate(()=>window.__codexWorkspaceTree.setEnabled(true));
    check('default closed and no directory query',await trigger.isVisible()&&!(await pane.count())&&!await step()&&(await page.evaluate(()=>window.calls.length))===0);
    await page.keyboard.press('Control+Shift+E');
    check('native shortcut not consumed',await page.evaluate(()=>window.shortcuts===1));
    await trigger.click();
    check('real workspace list, directories first',await until(()=>has('readme.md'),'initial tree')&&
      (await rows()).join('|')==='src|outside|readme.md');
    check('local native metadata-only request',await page.evaluate(()=>window.calls.length===1&&window.calls.every(x=>
      x.type==='mcp-request'&&x.hostId==='local'&&x.method==='thread/read'&&x.includeTurns===false)));
    check('beside chat not overlay, no editor',await page.evaluate(()=>{
      const pane=document.querySelector('[data-bc-workspace-tree]'),chat=document.querySelector('#chat');
      return chat.getBoundingClientRect().right===pane.getBoundingClientRect().left&&pane.getBoundingClientRect().width>=220&&
        pane.shadowRoot.querySelector('header .name').textContent==='project'&&!pane.querySelector('textarea,input');
    }));
    check('junction is non-expandable',!(await pane.getByRole('button',{name:'outside',exact:true}).count()));
    await pane.getByRole('button',{name:'src',exact:true}).click();
    await until(()=>has('空文件夹'),'empty child');
    const added=path.join(folderA,'src','fresh.txt'),renamed=path.join(folderA,'src','renamed.txt');
    await fs.writeFile(added,'example');
    check('new entry arrives in expanded child',await until(()=>has('fresh.txt'),'disk create'));
    await fs.rename(added,renamed);
    check('renamed entry replaces old path',await until(async()=>await has('renamed.txt')&&!await has('fresh.txt'),'disk rename'));
    await fs.rename(renamed,path.join(fixture,'moved-out.txt'));
    check('removed entry disappears',await until(async()=>await has('空文件夹')&&!await has('renamed.txt'),'disk remove'));
    await pane.getByRole('button',{name:'src',exact:true}).click();
    check('collapse releases child selection',!(await step()).expanded.length&&!await has('空文件夹'));
    await page.evaluate(id=>document.querySelector('#thread').dataset.aboveComposerConversationId=id,b);
    await step();
    check('old scope clears immediately',!await has('readme.md'));
    check('worktree uses its own directory',await until(()=>has('other.txt'),'switch to worktree')&&!await has('src'));
    await pane.getByRole('button',{name:'关闭工作区文件树'}).click();
    check('close detaches panel and clears request',!await pane.count()&&!await step()&&await trigger.isVisible());
    await page.evaluate(()=>window.waitForNative=400);
    await trigger.click();
    await step();
    await page.evaluate(id=>document.querySelector('#thread').dataset.aboveComposerConversationId=id,a);
    check('late previous request cannot cross scopes',await until(()=>has('readme.md'),'switch during metadata read')&&!await has('other.txt'));
    await page.evaluate(()=>window.__codexWorkspaceTree.setEnabled(false));
    check('disable removes both surfaces',!await trigger.count()&&!await pane.count()&&!await step());
    await page.evaluate(()=>{window.__codexWorkspaceTree.setEnabled(true);document.querySelector('#lane').style.display='block';});
    check('unknown layout leaves native UI intact',!await step()&&!await trigger.count()&&await page.locator('#native').isVisible());
    console.log(JSON.stringify({passed}));
  }finally{tree.close();await browser.close();await fs.unlink(path.join(folderA,'outside'));}
})().catch(error=>{console.error(error);process.exitCode=1;});
