const assert=require('node:assert/strict');
const {pageSource}=require('../../src/platform/i18n/i18n.js');
const {workspaceTreeSource}=require('../../src/interface/workspace_tree/page-source.cjs');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [a,b,c,d,e,f,p,q]=[1,2,3,4,5,6,100,101].map(uuid);
let passed=0;
function check(name,value=true){assert.ok(value,name);passed++;console.log('PASS '+name);}

(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1060,height:640}});
    const page=await context.newPage();
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
    await page.evaluate(({a,b,c,d,e,f,p,q})=>{
      const app=window.fixture={requests:[],nativeCalls:0,delay:0,watches:new Map(),
        projectIds:{[c]:p,[b]:q},projects:[
          {id:p,name:'Registered project',roots:[{path:'d:/WORK/app/'}]},
          {id:q,name:'Other project',roots:[{path:'D:\\work\\other'}]}
        ],
        roots:{
          [a]:'D:\\work\\app',[b]:'D:\\work\\other',[c]:'C:\\Users\\Max\\.codex\\worktrees\\one\\app',
          [d]:'d:\\WORK\\app\\sub',[e]:'D:/work/unregistered/',[f]:'d:\\WORK\\unregistered'
        },files:{
          'D:\\work\\app':[['src',true],['empty',true],['.gitignore'],['package.json'],['name..'],['..\\unsafe']],
          'D:\\work\\app\\src':[['index.ts'],['index.js']],
          'D:\\work\\app\\empty':[],
          'D:\\work\\other':[['other.md']],
          'C:\\Users\\Max\\.codex\\worktrees\\one\\app':[['worktree.md']],
          'd:\\WORK\\app\\sub':[['child-root.md']],
          'D:\\work\\unregistered':[['fallback.md']],
          'd:\\WORK\\unregistered':[['fallback.md']]
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
          if(method==='thread/read')result={thread:{id:params.threadId,cwd:app.roots[params.threadId],projectId:app.projectIds[params.threadId]}};
          else if(method==='project/list')result={data:app.projects,nextCursor:null};
          else if(method==='project/read')result={project:app.projects.find(p=>p.id===params.projectId)};
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
    },{a,b,c,d,e,f,p,q});
    await page.addScriptTag({content:pageSource('zh-CN')});
    await page.addScriptTag({content:workspaceTreeSource({home:'C:\\Users\\Max',codexHome:'C:\\Users\\Max\\.codex'})});
    const pane=page.locator('[data-bc-workspace-files]'),trigger=page.locator('[data-bc-workspace-tree-trigger] button');
    const projectName=page.locator('[data-bc-workspace-project-name]');
    const row=name=>pane.getByRole('treeitem',{name,exact:true});
    const ready=()=>pane.getByRole('searchbox').isEnabled();
    async function waitRow(name){await row(name).waitFor();}
    const evalPage=fn=>page.evaluate(fn);
    const waits=condition=>page.waitForFunction(condition);
    const setEnabled=value=>page.evaluate(value=>window.__codexWorkspaceTree.setEnabled(value),value);
    const click=()=>trigger.click();
    const noPane=()=>pane.waitFor({state:'detached'});
    const change=id=>page.evaluate(id=>fixture.change(id),id);
    const roots=()=>evalPage(()=>window.fixture.requests.filter(r=>r.method==='fs/readDirectory').map(r=>r.params.path));
    await setEnabled(true);
    await trigger.waitFor();
    check('a closed tree resolves identity without any filesystem access',await pane.count()===0&&
      await evalPage(()=>fixture.requests.every(r=>!r.method.startsWith('fs/'))));
    await projectName.getByText('Registered project',{exact:true}).waitFor();
    check('the registered project name appears beside the button even when closed',await pane.count()===0&&
      await evalPage(()=>document.querySelector('[data-bc-workspace-tree-trigger]').shadowRoot
        .querySelector('button').nextElementSibling.hasAttribute('data-bc-workspace-project-name')));
    await click();await waitRow('package.json');
    check('button and dock sit to the left without moving native controls',await ready()&&await evalPage(()=>{
      const own=document.querySelector('[data-bc-workspace-files]');
      const content=own.nextElementSibling;
      const toolbar=document.querySelector('[data-app-shell-header-toolbar]');
      return own.parentElement.id==='dock'&&content.hasAttribute('data-app-shell-main-content-layout')&&
        own.clientHeight>400&&content.clientWidth>500&&own.clientWidth>=260&&
        own.getBoundingClientRect().right<=content.getBoundingClientRect().left&&
        toolbar.firstElementChild.hasAttribute('data-bc-workspace-tree-trigger')&&toolbar.lastElementChild.id==='actions';
    }));
    check('keeps official file page and tag untouched',await evalPage(()=>fixture.nativeCalls===0&&
      !document.querySelector('[data-tab-id],file-tree-container')&&customElements.get('file-tree-container')===fixture.nativeTag));
    check('only current thread and root are fetched',JSON.stringify(await roots())===JSON.stringify(['D:\\work\\app'])&&
      await evalPage(()=>fixture.requests[0].method==='thread/read'&&fixture.requests[0].params.includeTurns===false));
    check('workspace folders and files are first-level rows without a synthetic root',
      await row('所有文件').count()===0&&await row('src').getAttribute('aria-level')==='1'&&
      await row('package.json').getAttribute('aria-level')==='1'&&await row('src').getAttribute('aria-expanded')==='false');
    check('does not turn malformed path components into rows',await row('name..').count()===0&&await row('..\\unsafe').count()===0);
    check('uses Pierre colored file type icons',await evalPage(()=>{
      const shadow=document.querySelector('[data-bc-workspace-files]').shadowRoot.querySelector('bc-workspace-file-tree').shadowRoot;
      const icons=['.gitignore','package.json'].map(name=>shadow.querySelector('[aria-label="'+name+'"] use')?.getAttribute('href'));
      return !!shadow.querySelector('[data-file-tree-colored-icons="true"]')&&icons.every(Boolean)&&icons[0]!==icons[1];
    }));
    await row('src').locator('[data-item-section="icon"]').click();
    await waitRow('index.ts');
    check('expanding reads only the chosen directory and shows its children on level two',
      JSON.stringify(await roots())===JSON.stringify(['D:\\work\\app','D:\\work\\app\\src'])&&
      await row('index.ts').getAttribute('aria-level')==='2');
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
    await evalPage(()=>{fixture.watchDelay=0;});
    await click();await waitRow('package.json');
    await evalPage(()=>{fixture.pane=document.querySelector('[data-bc-workspace-files]');fixture.delay=160;});
    await change(c);await pane.getByText('正在加载…').waitFor();await waitRow('worktree.md');
    check('same registered project retains the open dock across sessions and switches to the current worktree',await evalPage(()=>
      fixture.pane===document.querySelector('[data-bc-workspace-files]'))&&await row('package.json').count()===0);
    await projectName.getByText('Registered project',{exact:true}).waitFor();
    check('a worktree uses its registered project name rather than its folder name');
    await change(d);await waitRow('child-root.md');
    check('an unassigned session below the registered root shares the same open state',await row('worktree.md').count()===0);
    await change(b);await noPane();
    check('a different project starts closed and releases the old directory watch',await waits(()=>fixture.watches.size===0));
    await click();await waitRow('other.md');
    await change(a);await waitRow('package.json');
    await click();await noPane();
    await change(c);await page.waitForTimeout(240);
    check('closing in one project session closes other sessions of that project',await pane.count()===0);
    await change(b);await waitRow('other.md');
    check('the other project keeps its own remembered open state');
    await setEnabled(false);await noPane();await waits(()=>fixture.watches.size===0);
    check('settings off removes only our button/dock',await trigger.count()===0&&await page.locator('#native').isVisible());
    await evalPage(()=>{window.__codexWorkspaceTree.remove();});
    await page.addScriptTag({content:workspaceTreeSource({home:'C:\\Users\\Max',codexHome:'C:\\Users\\Max\\.codex'})});
    await setEnabled(true);await waitRow('other.md');
    check('a new tree module restores the local project state');
    const peer=await context.newPage();
    await peer.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Peer</title>'}));
    await peer.goto(url);
    await peer.evaluate(id=>localStorage.removeItem('better-codex:workspace-tree-open:project:'+id),q);
    await noPane();
    await peer.evaluate(id=>localStorage.setItem('better-codex:workspace-tree-open:project:'+id,'1'),q);
    await waitRow('other.md');
    await peer.close();
    check('project open and close synchronize between windows');
    await click();await noPane();
    await evalPage(()=>{fixture.watchDelay=0;fixture.delay=175;});
    await change(a);
    await click();
    await change(b);
    await noPane();
    const reads=await roots();
    await page.waitForTimeout(225);
    check('a late chat lookup cannot read old scope',(await roots()).length===reads.length);
    await click();await waitRow('other.md');
    check('new chat opens its own workspace',await row('package.json').count()===0);
    await click();await noPane();
    await evalPage(()=>fixture.link='D:\\work\\other');
    await click();await pane.getByText('当前无法读取工作区文件').waitFor();
    check('directory symlink is not listed or watched',(await roots()).at(-1)==='D:\\work\\other'&&
      (await roots()).length===reads.length+1&&await evalPage(()=>fixture.watches.size===0));
    await click();await noPane();
    const metadata=await evalPage(()=>fixture.requests.filter(r=>r.method==='fs/getMetadata').length);
    for(const blocked of ['C:\\','C:\\Users\\Max','C:\\Users\\Max\\.codex\\sessions','D:\\work\\..\\private','\\\\remote\\share']){
      await setEnabled(false);
      await page.evaluate(({b,blocked})=>fixture.roots[b]=blocked,{b,blocked});
      await setEnabled(true);
      await click();await pane.getByText('当前无法读取工作区文件').waitFor();await click();
    }
    check('unsafe roots are rejected before filesystem RPC',await evalPage(()=>fixture.requests.filter(r=>r.method==='fs/getMetadata').length)===metadata);
    await change(e);await click();await waitRow('fallback.md');
    await projectName.getByText('unregistered',{exact:true}).waitFor();
    check('an unregistered project uses the workspace folder name');
    await change(f);
    await page.waitForFunction(()=>[...fixture.watches.values()].includes('d:\\WORK\\unregistered'));
    await waitRow('fallback.md');
    check('unregistered sessions at the same normalized workspace share the open state');
    await click();await noPane();
    await change(b);
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
