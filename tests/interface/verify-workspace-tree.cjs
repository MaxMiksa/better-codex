const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {pageSource}=require('../../src/platform/i18n/i18n.js');
const {workspaceTreeSource}=require('../../src/interface/workspace_tree/page-source.cjs');
const {createWorkspaceActions}=require('../../src/interface/workspace_tree/native-actions.cjs');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||'playwright');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [a,b,c,d,e,f,p,q]=[1,2,3,4,5,6,100,101].map(uuid);
let passed=0;
function check(name,value=true){assert.ok(value,name);passed++;console.log('PASS '+name);}

async function checkNativeActions(){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bc-tree-actions-'));
  try{
    const root=path.join(dir,'folder, with (punctuation)'),other=path.join(dir,'other');
    const home=path.join(dir,'home'),codexHome=path.join(home,'.codex');
    await fs.mkdir(root);await fs.mkdir(other);await fs.mkdir(codexHome,{recursive:true});
    const preview=path.join(dir,'PowerToys.Peek.UI.exe'),doc=path.join(root,'文件 & notes.md');
    const script=path.join(root,'script.js'),shortcut=path.join(root,'test.lnk');
    for(const file of [preview,doc,script,shortcut,path.join(other,'outside.md')])await fs.writeFile(file,'fixture');
    await fs.symlink(other,path.join(root,'redirect'),'junction');
    const calls=[];
    const settings={home,codexHome};
    const shell=async(...args)=>{calls.push(args);};
    const perform=createWorkspaceActions(settings,{candidates:[preview],peek:async(...args)=>{calls.push(['peek',...args]);},shell});
    const yes=()=>true,run=(kind,relative,still=yes)=>perform({kind,root,relative},still);
    check('Preview passes a single literal path to the known Peek executable',
      await run('preview',path.basename(doc))===null&&JSON.stringify(calls.pop())===JSON.stringify(['peek',preview,[doc]]));
    check('Open uses the default app for ordinary documents',await run('open',path.basename(doc))===null&&calls.pop()?.[0]==='open');
    check('Folder and locate use separate Explorer verbs',await run('folder','')===null&&
      JSON.stringify(calls.pop())===JSON.stringify(['folder',root])&&await run('locate',path.basename(doc))===null&&calls.pop()?.[0]==='locate');
    check('Folder launch distinguishes foreground denial from a failed open',await createWorkspaceActions(settings,{
      candidates:[],shell:async()=>{throw Object.assign(Error(),{code:3});}
    })({kind:'folder',root,relative:''},yes)==='folderBackground');
    const nativeFolder={kind:'folder',root,relative:'',nativeFolder:true};
    check('Host authorizes the native handoff only after path and scope validation without launching Windows',
      await perform(nativeFolder,yes)==='openNativeFolder'&&await perform(nativeFolder,()=>false)===null&&
      await perform({...nativeFolder,root:codexHome},yes)==='actionFailed'&&calls.length===0);
    check('Source previews as text, but scripts and shortcuts do not open through the shell',
      await run('preview','script.js')===null&&calls.pop()?.[0]==='peek'&&await run('open','script.js')==='locateOnly'&&calls.pop()?.[0]==='locate'&&
      await run('preview','test.lnk')==='locateOnly'&&calls.pop()?.[0]==='locate');
    check('Missing Peek does not prevent ordinary opening',await createWorkspaceActions(settings,{candidates:[],shell})(
      {kind:'preview',root,relative:path.basename(doc)},yes)==='peekUnavailable'&&calls.length===0&&
      await createWorkspaceActions(settings,{candidates:[],shell})({kind:'open',root,relative:path.basename(doc)},yes)===null&&calls.pop()?.[0]==='open');
    check('Missing Windows file association falls back to locating',await createWorkspaceActions(settings,{
      candidates:[],shell:async(verb,file)=>{if(verb==='open')throw Object.assign(Error(),{code:2});await shell(verb,file);}
    })({kind:'open',root,relative:path.basename(doc)},yes)==='locateOnly'&&calls.pop()?.[0]==='locate');
    for(const relative of ['../other/outside.md','redirect/outside.md','test.lnk:alt','COM1 .md','no-longer-exists.md']){
      assert.equal(await run('open',relative),'actionFailed',relative);
    }
    check('Host rejects traversal, redirects, devices, ADS, deleted files and private roots without launching',
      await perform({kind:'folder',root:codexHome,relative:''},yes)==='actionFailed'&&calls.length===0);
    check('Host rechecks the current chat just before launching',await run('preview',path.basename(doc),()=>false)===null&&calls.length===0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}

(async()=>{
  await checkNativeActions();
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
      const app=window.fixture={requests:[],nativeCalls:0,nativeOpens:[],actions:[],delay:0,watches:new Map(),
        projectIds:{[c]:p,[b]:q},projects:[
          {id:p,name:'Registered project',roots:[{path:'d:/WORK/app/'}]},
          {id:q,name:'Other project',roots:[{path:'D:\\work\\other'}]}
        ],
        roots:{
          [a]:'D:\\work\\app',[b]:'D:\\work\\other',[c]:'C:\\Users\\Max\\.codex\\worktrees\\one\\app',
          [d]:'d:\\WORK\\app\\sub',[e]:'D:/work/unregistered/',[f]:'d:\\WORK\\unregistered'
        },files:{
          'D:\\work\\app':[['src',true],['empty',true],['.gitignore'],['.gitattributes'],['package.json'],['Zebra.cmd'],['Alpha.md'],['beta.CMD'],['LICENSE'],['name..'],['..\\unsafe']],
          'D:\\work\\app\\src':[['index.ts'],['index.js'],['Zulu.JS']],
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
      window.__betterCodexWorkspaceAction=id=>{
        const tree=window.__codexWorkspaceTree,request=tree.pullAction(id);
        if(!request||tree.pullAction(id)!==null)throw Error('Invalid action');
        app.actions.push({id,...request});
        if(!app.holdActions)tree.actionResult(id,tree.confirmAction(id)?
          request.nativeFolder?'openNativeFolder':app.actionResult??null:null);
      };
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
    const pane=page.locator('[data-bc-workspace-files]'),trigger=page.locator('[data-bc-workspace-tree-trigger] button[aria-controls]');
    const projectName=page.locator('[data-bc-workspace-project-name]');
    const splitter=pane.getByRole('separator',{name:'调整文件树宽度'});
    const widthKey='better-codex:workspace-tree-width';
    const width=async()=>Math.round((await pane.boundingBox()).width);
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
    await evalPage(()=>{fixture.actionResult='folderBackground';});
    await projectName.click();
    check('the project name opens the actual folder without opening the dock',await pane.count()===0&&
      await evalPage(()=>fixture.actions.at(-1)?.kind==='folder'&&fixture.actions.at(-1)?.root==='D:\\work\\app'));
    check('a background Explorer window is reported even when the tree is closed',await page
      .locator('[data-bc-workspace-tree-trigger]').getByText('目录已打开，可从任务栏切换到资源管理器。').isVisible());
    await evalPage(()=>{fixture.actionResult=null;});
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
    const order=level=>pane.locator('[role="treeitem"][aria-level="'+level+'"]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('aria-label')));
    const ordered=(actual,expected)=>expected.every((name,i)=>actual.indexOf(name)>=0&&(i===0||actual.indexOf(name)>actual.indexOf(expected[i-1])));
    check('folders first, then type groups, then alphabetical without regard to case',ordered(await order(1),
      ['empty','src','beta.CMD','Zebra.cmd','.gitattributes','.gitignore','package.json','Alpha.md','LICENSE']));
    check('splitter starts at the established default width',await width()===300&&await splitter.getAttribute('aria-valuenow')==='300');
    const edge=await splitter.boundingBox();
    const x=edge.x+edge.width/2,y=edge.y+edge.height/2;
    await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+116,y,{steps:4});
    check('dragging the edge previews the width without saving or reloading files',await width()===416&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)===null&&(await roots()).length===1);
    await page.mouse.up();
    check('releasing the splitter saves the whole pane width',await page.evaluate(key=>localStorage.getItem(key),widthKey)==='416');
    await splitter.press('ArrowLeft');
    check('the focused splitter adjusts width with the keyboard',await width()===400&&await splitter.getAttribute('aria-valuenow')==='400');
    const cancelEdge=await splitter.boundingBox();
    const cx=cancelEdge.x+cancelEdge.width/2;
    await page.mouse.move(cx,y);await page.mouse.down();await page.mouse.move(cx+42,y,{steps:2});
    await page.keyboard.press('Escape');await page.mouse.up();
    check('Escape cancels an in-progress drag without closing the pane',await width()===400&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)==='400');
    await page.setViewportSize({width:460,height:640});
    await waits(()=>document.querySelector('[data-bc-workspace-files]').getBoundingClientRect().width<180);
    check('narrow windows retain chat space without overwriting the saved width',
      await evalPage(()=>document.querySelector('[data-app-shell-main-content-layout]').clientWidth>=300)&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)==='400');
    await page.setViewportSize({width:1060,height:640});
    await waits(()=>document.querySelector('[data-bc-workspace-files]').getBoundingClientRect().width===400);
    check('enlarging the window restores the preferred width',await width()===400);
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
    check('type grouping is repeated inside folders',ordered(await order(2),['index.js','Zulu.JS','index.ts']));
    await row('index.ts').click();
    check('selecting a file does not open a page',await page.locator('[role="tabpanel"]').count()===0&&
      await row('index.ts').getAttribute('aria-selected')==='true'&&await evalPage(()=>fixture.actions.length===1));
    await evalPage(()=>{fixture.actionResult='peekUnavailable';});
    await page.keyboard.press('Space');
    await pane.getByText('未找到 PowerToys Peek。').waitFor();
    check('Space previews the focused file, not a page',await evalPage(()=>fixture.actions.at(-1)?.kind==='preview'&&
      fixture.actions.at(-1)?.relative==='src/index.ts'));
    await evalPage(()=>{fixture.actionResult=null;});
    await row('index.ts').dblclick();
    check('double-click opens without also previewing',await evalPage(()=>fixture.actions.length===3&&fixture.actions.at(-1)?.kind==='open'));
    await row('index.ts').click({button:'right'});
    await pane.getByRole('menuitem',{name:'在资源管理器中定位'}).click();
    check('right-click menu locates the selected file',await evalPage(()=>fixture.actions.at(-1)?.kind==='locate'&&
      fixture.actions.at(-1)?.relative==='src/index.ts'));
    const search=pane.getByRole('searchbox');
    await search.press('Space');
    check('Space in the filter is not intercepted',await search.inputValue()===' '&&await evalPage(()=>fixture.actions.length===4));
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
    check('live file additions keep their type group order',ordered(await order(1),['Alpha.md','README.md','LICENSE'])&&
      ordered(await order(2),['new.css','index.ts']));
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
    await evalPage(()=>{fixture.holdActions=true;});
    await row('package.json').click();
    await page.keyboard.press('Space');
    check('current scope can confirm a pending launch',await evalPage(()=>window.__codexWorkspaceTree.confirmAction(fixture.actions.at(-1).id)));
    await evalPage(()=>{fixture.pane=document.querySelector('[data-bc-workspace-files]');fixture.delay=160;});
    await change(c);await pane.getByText('正在加载…').waitFor();await waitRow('worktree.md');
    check('a previous chat can no longer confirm its pending action',await evalPage(()=>
      !window.__codexWorkspaceTree.confirmAction(fixture.actions.at(-1).id)));
    await evalPage(()=>{fixture.holdActions=false;});
    check('same registered project retains the open dock across sessions and switches to the current worktree',await evalPage(()=>
      fixture.pane===document.querySelector('[data-bc-workspace-files]'))&&await row('package.json').count()===0);
    await projectName.getByText('Registered project',{exact:true}).waitFor();
    check('a worktree uses its registered project name rather than its folder name');
    await page.route('**/assets/fixture-runtime.js',route=>route.fulfill({contentType:'application/javascript',body:`
      export const __webpack_require__=()=>{throw Error('Never instantiate a module')};
      __webpack_require__.c={'arbitrary-build-id':{exports:{setAppServices(){},setAppHost(){},appServices:{
        openIn:{open(input){fixture.nativeOpens.push(input);return Promise.resolve({success:!fixture.failNative});}}
      }}}};
    `}));
    await page.addScriptTag({url:'https://workspace-tree.invalid/assets/fixture-runtime.js',type:'module'});
    await projectName.click();
    await waits(()=>fixture.nativeOpens.length===1);
    check('clicking a worktree title uses its actual root via the initialized Codex File Explorer service',
      await evalPage(()=>fixture.actions.at(-1).nativeFolder&&
        JSON.stringify(fixture.nativeOpens[0])===JSON.stringify({cwd:null,hostId:'local',path:'C:\\Users\\Max\\.codex\\worktrees\\one\\app',target:'fileManager'})));
    await evalPage(()=>{fixture.failNative=true;fixture.actionCount=fixture.actions.length;});
    await projectName.click();
    await pane.getByText('无法打开此项。').waitFor();
    check('a native failure does not launch a second fallback window',
      await evalPage(()=>fixture.nativeOpens.length===2&&fixture.actions.length===fixture.actionCount+1));
    await evalPage(()=>{fixture.holdActions=true;});
    await projectName.click();
    await waits(()=>fixture.actions.length===fixture.actionCount+2);
    await change(d);await waitRow('child-root.md');
    await evalPage(()=>{
      window.__codexWorkspaceTree.actionResult(fixture.actions.at(-1).id,'openNativeFolder');
      fixture.holdActions=false;
    });
    check('a late native handoff cannot open the previous chat folder',await evalPage(()=>fixture.nativeOpens.length===2));
    check('an unassigned session below the registered root shares the same open state',await row('worktree.md').count()===0);
    await change(b);await noPane();
    check('a different project starts closed and releases the old directory watch',await waits(()=>fixture.watches.size===0));
    await click();await waitRow('other.md');
    check('different projects share the panel width',await width()===400);
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
    check('a new tree module restores the saved panel width',await width()===400);
    const peer=await context.newPage();
    await peer.route(url,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Peer</title>'}));
    await peer.goto(url);
    await peer.evaluate(id=>localStorage.removeItem('better-codex:workspace-tree-open:project:'+id),q);
    await noPane();
    await peer.evaluate(id=>localStorage.setItem('better-codex:workspace-tree-open:project:'+id,'1'),q);
    await waitRow('other.md');
    await peer.evaluate(key=>localStorage.setItem(key,'352'),widthKey);
    await waits(()=>document.querySelector('[data-bc-workspace-files]').getBoundingClientRect().width===352);
    await peer.close();
    check('project open state and width synchronize between windows');
    await splitter.dblclick();
    check('double-clicking the splitter restores the default width',await width()===300&&
      await page.evaluate(key=>localStorage.getItem(key),widthKey)==='300');
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
