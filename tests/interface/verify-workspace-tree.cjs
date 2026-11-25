const assert=require('node:assert/strict');
const {pageSource}=require('../../src/platform/i18n/i18n.js');
const {workspaceTreeSource}=require('../../src/interface/workspace_tree/page-source.cjs');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
let passed=0;
function check(name,value=true){assert.ok(value,name);passed++;console.log('PASS '+name);}

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1060,height:640}});
    const exceptions=[];page.on('pageerror',error=>exceptions.push(error.message));
    const url='https://workspace-tree.invalid/index.html';
    await page.route(url,route=>route.fulfill({contentType:'text/html',body:
      '<!doctype html><html lang="zh-CN"><body><section data-app-shell-active-page="true">'+
      '<div data-app-shell-main-titlebar><div data-app-shell-header-toolbar style="display:flex">'+
      '<div>Chat</div><div id="actions" style="display:flex"><button id="native">Native files</button></div></div></div>'+
      '<main data-app-shell-main-surface><div id="dock" style="display:flex;height:520px">'+
      '<div data-app-shell-main-content-layout style="flex:1;min-width:0">'+
      '<div id="thread" data-above-composer-conversation-id="'+a+'">Chat composer</div></div></div></main></section></body></html>'}));
    await page.goto(url);
    await page.evaluate(({a,b})=>{
      const app=window.fixture={requests:[],nativeCalls:0,delay:0,watches:new Map(),remote:false,
        roots:{[a]:'D:\\work\\app',[b]:'D:\\work\\other'},files:{
          'D:\\work\\app':[['src',true],['empty',true],['.gitignore'],['package.json'],['name..'],['..\\unsafe']],
          'D:\\work\\app\\src':[['index.ts'],['index.js']],
          'D:\\work\\app\\empty':[],
          'D:\\work\\other':[['other.md']]
        }};
      const emit=(data,origin=location.origin)=>window.dispatchEvent(new MessageEvent('message',{source:window,origin,data}));
      app.notify=(watchId,hostId='local',origin=location.origin)=>emit({
        type:'mcp-notification',hostId,method:'fs/changed',params:{watchId,changedPaths:['ignored']}
      },origin);
      app.change=id=>document.querySelector('#thread').setAttribute('data-above-composer-conversation-id',id);
      customElements.define('file-tree-container',class extends HTMLElement{});
      app.nativeTag=customElements.get('file-tree-container');
      document.querySelector('#native').addEventListener('click',()=>{
        app.nativeCalls++;
        const tab=document.createElement('div');tab.dataset.tabId='file:local:';tab.setAttribute('role','tabpanel');
        document.querySelector('#dock').append(tab);
      });
      window.addEventListener('message',e=>{if(e.data?.type==='toggle-file-tree-panel')app.nativeCalls++;});
      window.electronBridge={sendMessageFromView({type,hostId,request:{id,method,params}}){
        if(type!=='mcp-request'||hostId!=='local')throw Error('Wrong transport');
        app.requests.push({method,params});
        const wait=method==='thread/read'?app.delay:method==='fs/watch'?app.watchDelay||0:0;
        setTimeout(()=>{
          const path=params.path;
          let result,error;
          if(method==='thread/read')result={thread:{id:params.threadId,cwd:app.roots[params.threadId]}};
          else if(method==='fs/getMetadata')result={isDirectory:!!app.files[path],isFile:false,isSymlink:path===app.link};
          else if(method==='fs/watch'){app.watches.set(params.watchId,path);result={};}
          else if(method==='fs/unwatch'){app.watches.delete(params.watchId);result={};}
          else if(method==='fs/readDirectory'){
            if(!app.files[path])error={message:'Not a directory'};
            else result={entries:app.files[path].map(([fileName,isDirectory=false])=>({fileName,isDirectory,isFile:!isDirectory}))};
          }else throw Error('Unexpected RPC');
          emit({type:'mcp-response',hostId:'local',message:{id,result,error}});
        },wait);
      }};
    },{a,b});
    await page.addScriptTag({content:pageSource('zh-CN')});
    await page.addScriptTag({content:workspaceTreeSource({home:'C:\\Users\\Max',codexHome:'C:\\Users\\Max\\.codex'})});
    const pane=page.locator('[data-bc-workspace-files]'),trigger=page.locator('[data-bc-workspace-tree-trigger] button');
    const row=name=>pane.getByRole('treeitem',{name,exact:true});
    const ready=()=>pane.getByRole('searchbox').isEnabled();
    async function waitRow(name){await row(name).waitFor();}
    const evalPage=fn=>page.evaluate(fn);
    const waits=condition=>page.waitForFunction(condition);
    const setEnabled=value=>page.evaluate(value=>window.__codexWorkspaceTree.setEnabled(value),value);
    const click=()=>trigger.click();
    const noPane=()=>pane.waitFor({state:'detached'});
    const roots=()=>evalPage(()=>window.fixture.requests.filter(r=>r.method==='fs/readDirectory').map(r=>r.params.path));
    await setEnabled(true);
    await trigger.waitFor();
    check('enable is idle: no tree or app-server request',await pane.count()===0&&await evalPage(()=>fixture.requests.length===0));
    await click();await waitRow('package.json');
    check('opens independent dock alongside chat',await ready()&&await evalPage(()=>{
      const own=document.querySelector('[data-bc-workspace-files]');
      const content=own.previousElementSibling;
      return own.parentElement.id==='dock'&&content.hasAttribute('data-app-shell-main-content-layout')&&
        own.clientHeight>400&&content.clientWidth>500&&own.clientWidth>=260;
    }));
    check('keeps official file page and tag untouched',await evalPage(()=>fixture.nativeCalls===0&&
      !document.querySelector('[data-tab-id],file-tree-container')&&customElements.get('file-tree-container')===fixture.nativeTag));
    check('only current thread and root are fetched',JSON.stringify(await roots())===JSON.stringify(['D:\\work\\app'])&&
      await evalPage(()=>fixture.requests[0].method==='thread/read'&&fixture.requests[0].params.includeTurns===false));
    check('starts at expanded All files with named, collapsed directories',(await row('所有文件').getAttribute('aria-expanded'))==='true'&&
      (await row('src').getAttribute('aria-expanded'))==='false'&&await row('empty').count()===1);
    check('does not turn malformed path components into rows',await row('name..').count()===0&&await row('..\\unsafe').count()===0);
    check('uses Pierre colored file type icons',await evalPage(()=>{
      const shadow=document.querySelector('[data-bc-workspace-files]').shadowRoot.querySelector('bc-workspace-file-tree').shadowRoot;
      const icons=['.gitignore','package.json'].map(name=>shadow.querySelector('[aria-label="'+name+'"] use')?.getAttribute('href'));
      return !!shadow.querySelector('[data-file-tree-colored-icons="true"]')&&icons.every(Boolean)&&icons[0]!==icons[1];
    }));
    await row('src').locator('[data-item-section="icon"]').click();
    await waitRow('index.ts');
    check('expanding reads only the chosen directory',JSON.stringify(await roots())===JSON.stringify(['D:\\work\\app','D:\\work\\app\\src']));
    await row('index.ts').click();
    check('selecting a file does not open a page',await page.locator('[role="tabpanel"]').count()===0&&
      await row('index.ts').getAttribute('aria-selected')==='true');
    const search=pane.getByRole('searchbox');
    await search.fill('index.ts');
    await row('index.js').waitFor({state:'detached'});
    check('filters loaded files without another read',await row('index.ts').count()===1&&(await roots()).length===2);
    await search.fill('asdjkl-nonexistent');
    await pane.getByText('没有匹配的文件').waitFor();
    await search.fill('');
    await waitRow('index.js');
    check('clearing filter restores the expanded branch');
    await evalPage(()=>{
      const root=[...fixture.watches].find(([,p])=>p.endsWith('\\app'))[0];
      fixture.files['D:\\work\\app'].push(['README.md']);
      fixture.notify(root,'remote');fixture.notify(root,'local','https://other.invalid');
    });
    await page.waitForTimeout(135);
    check('ignores wrong origin and host notifications',await row('README.md').count()===0&&(await roots()).length===2);
    await evalPage(()=>{
      for(const [id,path] of fixture.watches){
        if(path.endsWith('\\src'))fixture.files[path]=[['index.ts'],['new.css']];
        fixture.notify(id);
      }
    });
    await waitRow('README.md');await waitRow('new.css');
    check('watch updates root and expanded child without collapsing',await row('index.js').count()===0&&
      (await row('src').getAttribute('aria-expanded'))==='true');
    await row('src').locator('[data-item-section="icon"]').click();
    await waits(()=>fixture.watches.size===1);
    check('collapsing releases child watch');
    await search.press('Escape');await noPane();
    await waits(()=>fixture.watches.size===0);
    check('Escape inside dock closes and releases all watches');
    await evalPage(()=>{fixture.watchDelay=250;});
    await click();await waitRow('package.json');
    await click();await noPane();
    await page.waitForTimeout(375);
    check('late watch acknowledgement is released after close',await evalPage(()=>fixture.watches.size===0));
    await evalPage(()=>{fixture.watchDelay=0;fixture.delay=175;});
    await click();
    await page.evaluate(b=>fixture.change(b),b);
    await noPane();
    const reads=await roots();
    await page.waitForTimeout(225);
    check('a late chat lookup cannot read old scope',(await roots()).length===reads.length);
    await click();await waitRow('other.md');
    check('new chat opens its own workspace',await row('package.json').count()===0);
    await setEnabled(false);await noPane();await waits(()=>fixture.watches.size===0);
    check('settings off removes only our button/dock',await trigger.count()===0&&await page.locator('#native').isVisible());
    await setEnabled(true);
    await evalPage(()=>fixture.link='D:\\work\\other');
    await click();await pane.getByText('当前无法读取工作区文件').waitFor();
    check('directory symlink is not listed or watched',(await roots()).at(-1)==='D:\\work\\other'&&
      (await roots()).length===reads.length+1&&await evalPage(()=>fixture.watches.size===0));
    await click();await noPane();
    const metadata=await evalPage(()=>fixture.requests.filter(r=>r.method==='fs/getMetadata').length);
    for(const blocked of ['C:\\','C:\\Users\\Max','C:\\Users\\Max\\.codex\\sessions','D:\\work\\..\\private','\\\\remote\\share']){
      await page.evaluate(({b,blocked})=>fixture.roots[b]=blocked,{b,blocked});
      await click();await pane.getByText('当前无法读取工作区文件').waitFor();await click();
    }
    check('unsafe roots are rejected before filesystem RPC',await evalPage(()=>fixture.requests.filter(r=>r.method==='fs/getMetadata').length)===metadata);
    await page.evaluate(b=>{
      const remote=document.createElement('div');
      remote.dataset.appActionSidebarThreadId=b;
      remote.dataset.appActionSidebarThreadHostId='remote';
      document.body.append(remote);
    },b);
    await trigger.waitFor({state:'detached'});
    check('remote chat does not get a local tree button');
    await evalPage(()=>window.__codexWorkspaceTree.remove());
    check('no native action, browser errors or residual pane',!exceptions.length&&await pane.count()===0&&await evalPage(()=>fixture.nativeCalls===0));
    console.log('workspace-tree: '+passed+' passed');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
