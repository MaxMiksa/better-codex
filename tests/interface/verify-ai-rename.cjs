const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {chromium}=require(process.env.HUD_PLAYWRIGHT||path.resolve(__dirname,'../../.runtime/token-hud/node/node_modules/playwright'));
const rename=require('../../src/interface/host/ai-rename.cjs');
const transcript=require('../../src/interface/host/session-transcript.cjs');
const commandMenu=require('../../src/interface/appearance/command-menu.js');
const i18nSource=require('../../src/platform/i18n/i18n.js').pageSource('zh-CN');
const browserPath=process.env.HUD_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const aiRenameSource=fs.readFileSync(path.join(__dirname,'../../src/interface/appearance/ai-rename.js'),'utf8');
const {listDesktopRenameTargets,setDesktopThreadTitle,setThreadTitle}=require('../../src/interface/host/thread-title-api.cjs');
const {PassThrough}=require('node:stream');
const {EventEmitter}=require('node:events');
const {spawn}=require('node:child_process');
const id='00000000-0000-4000-8000-000000000001',otherId='00000000-0000-4000-8000-000000000002';
const results=[];
function check(name,condition){assert.ok(condition,name);results.push(name);}
async function waitFor(predicate,timeout=3000){
  const started=Date.now();
  while(Date.now()-started<timeout){
    if(await predicate())return;
    await new Promise(resolve=>setTimeout(resolve,20));
  }
  throw new Error('wait-timeout');
}

(async()=>{
  check('catalog-has-ai-rename',commandMenu.commands.some(item=>item.id==='ai-rename'));
  check('new-chat-order',commandMenu.normalizeItemOrder().chat.join('|')==='new|rename|ai-rename|archive');
  check('saved-order-migrates-after-native-rename',commandMenu.normalizeItemOrder({chat:['archive','new','rename']}).chat.join('|')==='archive|new|rename|ai-rename');
  check('ai-rename-default-visible',commandMenu.normalize()['ai-rename']===true);

  check('title-separator-is-fullwidth-and-unspaced',rename.normalizeTitle('feat: AI 重命名')==='feat：AI 重命名'&&
    rename.normalizeTitle('bug ： 小怪倒计时消失')==='bug：小怪倒计时消失'&&
    rename.normalizeTitle('feat：命令行界面 prompt')==='feat：命令行界面 prompt');
  check('fix-normalizes-to-bug',rename.normalizeTitle('fix: 地图标记消失')==='bug：地图标记消失');
  check('scope-is-removed',rename.normalizeTitle('feat(ui): 命令栏图标')==='feat：命令栏图标');
  check('quotes-and-periods-are-removed',rename.normalizeTitle('"`bug: 小怪倒计时消失。`"')==='bug：小怪倒计时消失');
  assert.throws(()=>rename.normalizeTitle('feat: 这是一个超过二十四个字符的非常非常长的标题内容'),error=>error.code==='too-long');
  check('overlong-title-is-rejected',true);
  check('fenced-json-title',rename.parseTitleResponse('```json\n{"title":"feat：AI 重命名"}\n```')==='feat：AI 重命名');
  check('configured-title-length-includes-only-one-separator',Array.from(rename.normalizeTitle('feat: '+'字'.repeat(19))).length===24);
  const prompt=rename.titlePrompt('测试正文');
  check('prompt-and-examples-use-chinese-separator',prompt.includes('{"title":"类型：描述"}')&&
    prompt.includes('冒号前后不加空格')&&rename.EXAMPLES.every(example=>/^[a-z]+：\S/u.test(example)));
  check('prompt-centers-the-whole-session-on-core-subjects',prompt.includes('围绕哪个核心关键词或核心对象展开工作')&&
    prompt.includes('默认选一个核心关键词或核心对象，通常不超过两个')&&
    prompt.includes('核心关键词或核心对象的名称')&&!prompt.includes('以新目标为准'));

  const injected=transcript.contentText([
    {type:'input_text',text:'# AGENTS.md instructions for fixture'},
    {type:'input_text',text:'<environment_context>fixture</environment_context>'},
    {type:'input_text',text:'真实用户内容'},
    {type:'input_image',image_url:'fixture'}
  ]);
  check('injected-user-context-is-removed',injected==='真实用户内容\n[图片]');

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'better-codex-ai-rename-'));
  try{
    const rollout=path.join(root,'rollout.jsonl');
    const retired=path.join(root,'rollout-retired.jsonl');
    const wrong=path.join(root,'rollout-other.jsonl');
    const assistantOnly=path.join(root,'rollout-assistant-only.jsonl');
    const meta=threadId=>({type:'session_meta',payload:{id:threadId}});
    const message=(role,text)=>({type:'response_item',payload:{type:'message',role,
      phase:role==='assistant'?'final_answer':undefined,content:[{type:role==='assistant'?'output_text':'input_text',text}]}});
    const write=(file,items)=>fs.writeFileSync(file,items.map(value=>JSON.stringify(value)).join('\n'),'utf8');
    write(retired,[meta(id),message('user','旧任务'),message('assistant','旧结果')]);
    write(wrong,[meta(otherId),message('user','另一个聊天')]);
    write(assistantOnly,[meta(id),message('assistant','没有用户消息')]);
    write(rollout,[meta(id),
      {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'developer'}]}},
      {type:'event_msg',payload:{type:'task_started',turn_id:'r1'}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'未答复的用户消息'}]}},
      {type:'event_msg',payload:{type:'turn_aborted',turn_id:'r1'}},
      {type:'turn_context',payload:{turn_id:'r2'}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'# AGENTS.md instructions for x'},{type:'input_text',text:'用户目标'}]}},
      {type:'response_item',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'commentary'}]}},
      message('user','补充消息'),message('assistant','最终回复')
    ]);
    const state=new DatabaseSync(path.join(root,'state_5.sqlite'));
    state.exec('CREATE TABLE threads (id TEXT,title TEXT,name TEXT,rollout_path TEXT,updated_at_ms INTEGER)');
    state.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(id,'title',null,rollout,1);
    state.close();
    const history=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
    history.exec('CREATE TABLE thread_items (thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT)');
    history.exec('CREATE TABLE thread_turns (thread_id TEXT,turn_id TEXT,final_agent_item_id TEXT)');
    const insert=history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?)');
    insert.run(id,'t1','u1',1,JSON.stringify({type:'userMessage',content:[{type:'text',text:'旧任务'}]}),'userMessage');
    insert.run(id,'t1','a1',2,JSON.stringify({type:'agentMessage',phase:'final_answer',text:'旧结果'}),'agentMessage');
    history.prepare('INSERT INTO thread_turns VALUES (?,?,?)').run(id,'t1','a1');
    history.close();
    const active=await transcript.readThreadTranscript(root,id);
    check('current-rollout-wins-over-populated-stale-history',active.source==='rollout'&&active.messages.map(item=>item.text).join('|')===
      '未答复的用户消息|用户目标|补充消息|最终回复');
    check('current-rollout-preserves-turns-and-role-numbering',transcript.formatTranscript(active.messages)===
      '【第 1 轮】\n【用户消息 1】\n未答复的用户消息\n\n【第 2 轮】\n【用户消息 1】\n用户目标\n\n【用户消息 2】\n补充消息\n\n【模型回复 1】\n最终回复');

    let reads=0;
    const readAt=file=>({rollout_path:file});
    const moved=await transcript.readThreadTranscript(root,id,{readRow:()=>readAt(reads++===0?retired:rollout)});
    check('path-change-reads-new-rollout-once',reads===3&&transcript.formatTranscript(moved.messages)===transcript.formatTranscript(active.messages));
    reads=0;
    await assert.rejects(transcript.readThreadTranscript(root,id,{readRow:()=>readAt(reads++%2?rollout:retired)}),/^Error: transcript-changed$/);
    check('repeated-path-change-refuses-to-name',reads===3);
    await assert.rejects(transcript.readThreadTranscript(root,id,{readRow:()=>readAt(wrong)}),/^Error: transcript-unavailable$/);
    await assert.rejects(transcript.readThreadTranscript(root,id,{readRow:()=>readAt(path.join(root,'missing.jsonl'))}),/^Error: transcript-unavailable$/);
    await assert.rejects(transcript.readThreadTranscript(root,id,{readRow:()=>readAt(assistantOnly)}),/^Error: empty$/);
    check('missing-mismatched-and-assistant-only-files-do-not-fall-back',true);
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }

  const calls=[];
  const title=await rename.generateTitle([
    {role:'user',text:'做一个 AI 重命名命令。保留完整需求。'},
    {role:'assistant',text:'命令已接入！这段不发送。'},
    {role:'user',text:'验证两个轮次。也保留这句话。'},
    {role:'assistant',text:'Version 0.5.8 is ready. This sentence is omitted.'}
  ],{call:async prompt=>{
    calls.push(prompt);
    return '{"title":"feat: AI 重命名"}';
  }});
  check('generate-title-uses-model-output',title==='feat：AI 重命名'&&calls.length===1&&calls[0].includes('风格示例'));
  check('model-receives-full-user-text-and-only-first-final-sentences',calls[0].endsWith(
    '<session>\n【第 1 轮】\n【用户消息 1】\n做一个 AI 重命名命令。保留完整需求。\n\n【模型回复 1】\n命令已接入！\n\n'+
    '【第 2 轮】\n【用户消息 1】\n验证两个轮次。也保留这句话。\n\n【模型回复 1】\nVersion 0.5.8 is ready.\n</session>'));
  check('older-untagged-messages-can-start-another-round',transcript.formatTranscript([
    {role:'user',text:'第一条'},{role:'assistant',text:'答复'},{role:'user',text:'下一条'}
  ]).endsWith('【第 2 轮】\n【用户消息 1】\n下一条'));

  const longText=Array.from({length:9000},(_,index)=>`section-${index} 会话内容`).join('\n');
  const longMessages=[{role:'user',text:longText},{role:'assistant',text:'结果已确认。无需发送的后续正文。'}];
  const longCalls=[];
  const longTitle=await rename.generateTitle(longMessages,{call:async prompt=>{
    longCalls.push(prompt);
    return '{"title":"feat: 超长会话"}';
  }});
  check('long-session-uses-one-model-request',longTitle==='feat：超长会话'&&longCalls.length===1);
  check('long-session-retains-all-user-text-and-only-first-reply-sentence',longText.length>70000&&
    longCalls[0].endsWith(`<session>\n【第 1 轮】\n【用户消息 1】\n${longText}\n\n【模型回复 1】\n结果已确认。\n</session>`));

  const transcriptMessages=[{role:'user',text:'做一个 AI 重命名命令'}];
  let applied=[],readIds=[],states=[];
  const onState=(status,notice)=>states.push({status,notice});
  const makeManager=(options={})=>rename.createAiRenameManager({
    settings:{codexHome:'fixture'},
    readTranscript:async(home,threadId)=>{readIds.push(threadId);return {messages:transcriptMessages};},
    resolveExecutable:async()=>'codex.exe',
    callFactory:()=>({run:async()=>'{"title":"feat: AI 重命名"}',cancel(){}}),
    applyTitle:async({threadId,title})=>applied.push({threadId,title}),
    ...options
  });
  let finishModel,started=false;
  const manager=makeManager({callFactory:()=>({
    run:()=>{started=true;return new Promise(resolve=>{finishModel=resolve;});},cancel(){}
  })});
  const trigger={requestId:'bound',threadId:id};
  const job=manager.start(trigger,onState);
  trigger.threadId=otherId;
  manager.start({requestId:'duplicate',threadId:id.toUpperCase()},onState);
  await waitFor(()=>started);
  finishModel('{"title":"feat: AI 重命名"}');
  await job;
  check('manager-sticks-to-bound-session-and-deduplicates',readIds.length===1&&readIds[0]===id&&
    applied.length===1&&applied[0].threadId===id&&applied[0].title==='feat：AI 重命名'&&
    states.some(({status})=>status.reason==='busy'));
  check('manager-reports-model-and-save-times-without-title',states.at(-1).status.phase==='success'&&
    Number.isInteger(states.at(-1).status.modelMs)&&Number.isInteger(states.at(-1).status.saveMs)&&
    !Object.hasOwn(states.at(-1).status,'title'));
  manager.close();

  applied=[];states=[];
  const parallel=makeManager();
  await Promise.all([parallel.start({requestId:'a',threadId:id},onState),
    parallel.start({requestId:'b',threadId:otherId},onState)]);
  check('parallel-renames-use-their-own-session-id',applied.length===2&&applied.some(item=>item.threadId===id)&&
    applied.some(item=>item.threadId===otherId));
  parallel.close();

  const [third,fourth,coloned,inactive,outside]=[3,4,5,6,7].map(n=>id.slice(0,-1)+n);
  const projectIds=[id,otherId,third,fourth,coloned,inactive];
  const names=new Map([[id,'half: width'],[otherId,null],[third,'original'],[fourth,'queued'],[coloned,'有：旧名'],[outside,'outside']]);
  const requestedCatalogs=[],modelFinishers=[],projectSaves=[];
  readIds=[];states=[];
  const project=makeManager({callFactory:()=>({
    run:()=>new Promise(resolve=>modelFinishers.push(resolve)),cancel(){}
  })});
  const projectOptions={listTargets:async ids=>{
    requestedCatalogs.push(ids);
    return [...ids,outside].filter(id=>names.has(id)).map(id=>({id,name:names.get(id)}));
  },saveTitle:async({threadId,expected})=>{
    if(threadId===third)throw Error('not-eligible');
    projectSaves.push({threadId,expected});
  }};
  const projectJob=project.startProject({requestId:'batch',projectId:id,threadIds:projectIds,unresolved:1},onState,projectOptions);
  project.startProject({requestId:'batch-duplicate',projectId:id,threadIds:projectIds},onState,projectOptions);
  await waitFor(()=>modelFinishers.length===3);
  check('batch-only-starts-three-models-for-eligible-project-members',readIds.join()===String([id,otherId,third])&&
    states.some(({status})=>status.reason==='busy'));
  names.set(fourth,'changed while queued');
  for(const finish of modelFinishers)finish('{"title":"feat: AI 重命名"}');
  await projectJob;
  const finalBatch=states.at(-1).notice;
  check('batch-rechecks-queued-chats-and-summarizes-guarded-saves',modelFinishers.length===3&&
    requestedCatalogs.length===2&&String(requestedCatalogs[1])===fourth&&projectSaves.length===2&&
    projectSaves.find(save=>save.threadId===id)?.expected.name==='half: width'&&
    finalBatch.phase==='success'&&finalBatch.finished===4&&finalBatch.renamed===2&&finalBatch.skipped===3&&finalBatch.failed===0);
  await project.close();

  applied=[];states=[];
  const failed=makeManager({callFactory:()=>({run:async()=>{throw new Error('model');},cancel(){}})});
  await failed.start({requestId:'failed',threadId:id},onState);
  check('manager-keeps-original-title-on-model-failure',applied.length===0&&states.at(-1).status.reason==='model');
  failed.close();

  let modelStarted=false;
  const stale=makeManager({readTranscript:async()=>{throw new Error('transcript-changed');},
    callFactory:()=>{modelStarted=true;throw new Error('unexpected-model-call');}});
  await stale.start({requestId:'stale',threadId:id},onState);
  check('unstable-transcript-never-calls-model-or-applies-title',!modelStarted&&applied.length===0&&
    states.at(-1).status.reason==='transcript-changed');
  stale.close();

  let cancelled=0,finishClosing;started=false;
  const closing=makeManager({callFactory:()=>({
    run:()=>{started=true;return new Promise((resolve,reject)=>{finishClosing=reject;});},
    cancel(){cancelled+=1;finishClosing(new Error('cancelled'));}
  })});
  closing.start({requestId:'closing',threadId:id},onState);
  await waitFor(()=>started);
  await closing.close();
  check('manager-close-cancels-active-model-call',cancelled===1);

  function childFixture(code){
    const fixture={closed:false};
    fixture.launch=(_executable,_args,options)=>{
      fixture.child=spawn(process.execPath,['-e',code],options);
      fixture.child.once('close',()=>{fixture.closed=true;});
      return fixture.child;
    };
    return fixture;
  }
  const keepAlive='setInterval(()=>{},60000)';
  const modelReply=childFixture(`console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture title'}}))`);
  const luna=options=>rename.createLunaClient({executable:'codex.exe',codexHome:'fixture',...options});
  check('model-child-exits-before-returning-the-title',await luna(modelReply).run('fixture')==='fixture title'&&modelReply.closed);
  for(const [reason,signalChild] of [
    ['timeout',()=>{}],
    ['cancelled',client=>client.cancel()],
    ['model',(_client,fixture)=>fixture.child.stdin.emit('error',new Error('fixture pipe failure'))]
  ]){
    const fixture=childFixture(keepAlive);
    const client=luna({...fixture,timeoutMs:reason==='timeout'?40:3000});
    const run=client.run('fixture');
    signalChild(client,fixture);
    await assert.rejects(run,{message:reason});
    check('model-child-is-reaped-after-'+reason,fixture.closed);
  }

  const rpcLog=[];
  function appServer(reply){
    return (executable,args)=>{
      assert.deepEqual(args,['app-server','--listen','stdio://']);
      const child=new EventEmitter();
      child.stdin=new PassThrough();child.stdout=new PassThrough();child.exitCode=null;child.signalCode=null;
      child.kill=()=>child.emit('close');
      child.stdin.on('data',chunk=>{
        const request=JSON.parse(String(chunk));
        rpcLog.push(request);
        if(request.id!==undefined){
          const answer=reply(request);
          if(answer)child.stdout.write(JSON.stringify({id:request.id,...answer})+'\n');
        }
      });
      child.stdin.on('end',()=>{child.exitCode=0;child.emit('close');});
      return child;
    };
  }
  const rpcOptions={threadId:id,title:'feat：AI 重命名',executable:'codex.exe',codexHome:'fixture'};
  const answer=request=>({result:request.method==='thread/read'?{thread:{id,name:rpcOptions.title}}:{}});
  await setThreadTitle({...rpcOptions,launch:appServer(answer)});
  check('direct-rename-rpc-saves-and-verifies-the-same-id',rpcLog.map(e=>e.method).join('|')===
    'initialize|initialized|thread/name/set|thread/read'&&rpcLog[2].params.threadId===id&&rpcLog[3].params.threadId===id);
  await assert.rejects(setThreadTitle({...rpcOptions,launch:appServer(request=>
    request.method==='thread/read'?{result:{thread:{id:otherId,name:rpcOptions.title}}}:answer(request))}),/title-not-confirmed/);
  check('direct-rename-never-confirms-a-different-thread',true);
  await assert.rejects(setThreadTitle({...rpcOptions,launch:appServer(request=>
    request.method==='thread/name/set'?{error:{code:-32602}}:answer(request))}),/title-api-rejected/);
  check('direct-rename-reports-app-server-rejection',true);
  const stubbornServer=childFixture(`
    ${keepAlive};
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const request=JSON.parse(line);
      if(request.id===undefined)return;
      const result=request.method==='thread/read'?{thread:${JSON.stringify({id,name:rpcOptions.title})}}:{};
      console.log(JSON.stringify({id:request.id,result}));
    });
  `);
  await setThreadTitle({...rpcOptions,launch:stubbornServer.launch});
  check('direct-rename-reaps-its-own-server-even-if-it-ignores-eof',stubbornServer.closed);

  const desktopCalls=[];
  let failDesktop=null;
  let listReply=()=>({data:[{id,name:'old',preview:'not returned'}]});
  const desktop=new EventTarget();
  desktop.electronBridge={sendMessageFromView:async({type,hostId,request})=>{
    assert.equal(type,'mcp-request');assert.equal(hostId,'local');
    desktopCalls.push(request);
    const event=new Event('message');
    Object.assign(event,{source:desktop,origin:location.origin,data:{type:'mcp-response',hostId,
      message:{id:request.id,...(request.method===failDesktop?{error:{code:-32000}}:
        request.method==='thread/list'?{result:listReply(request.params)}:answer(request))}}});
    desktop.dispatchEvent(event);
  }};
  globalThis.window=desktop;
  globalThis.location={protocol:'app:',host:'-',pathname:'/index.html',origin:'app://-'};
  const desktopPage={evaluate:(fn,arg)=>fn(arg)};
  try{
    check('desktop-rpc-routes-directly-to-the-local-id',await setDesktopThreadTitle(desktopPage,rpcOptions)&&
      desktopCalls.map(call=>call.method).join('|')==='thread/read|thread/name/set|thread/read'&&
      desktopCalls.every(call=>call.params.threadId===id));
    failDesktop='thread/read';desktopCalls.length=0;
    check('desktop-rpc-is-fallback-safe-only-before-writing',!await setDesktopThreadTitle(desktopPage,rpcOptions)&&
      desktopCalls.length===1);
    failDesktop='thread/name/set';desktopCalls.length=0;
    await assert.rejects(setDesktopThreadTitle(desktopPage,rpcOptions),/title-api-rejected/);
    check('desktop-rpc-does-not-replay-a-rejected-write',desktopCalls.length===2);
    failDesktop=null;desktopCalls.length=0;
    listReply=({cursor})=>cursor?{data:[{id:otherId,name:null}]}:{data:[{id,name:'old',preview:'not returned'}],nextCursor:'next'};
    assert.deepEqual(await listDesktopRenameTargets(desktopPage,[id,otherId]),[{id,name:'old'},{id:otherId,name:null}]);
    check('desktop-project-catalog-requests-only-active-included-ids-and-follows-cursor',desktopCalls.length===2&&
      desktopCalls.every(({method,params})=>method==='thread/list'&&String(params.includedThreadIds)===String([id,otherId])&&
        params.archived===false&&params.useStateDbOnly===true)&&desktopCalls[1].params.cursor==='next');
    listReply=()=>({data:[{id:otherId,name:'outside'}]});
    await assert.rejects(listDesktopRenameTargets(desktopPage,[id]),/catalog/);
    check('desktop-project-catalog-rejects-outside-ids',true);
    const guarded={...rpcOptions,expected:{name:'old'}};
    listReply=()=>({data:[{id,name:'old'}]});desktopCalls.length=0;
    check('desktop-project-save-rechecks-active-title-before-writing',await setDesktopThreadTitle(desktopPage,guarded)&&
      desktopCalls.map(call=>call.method).join('|')==='thread/list|thread/name/set|thread/read');
    for(const data of [[],[{id,name:'manual change'}],[{id,name:'AI：title'}]]){
      listReply=()=>({data});desktopCalls.length=0;
      await assert.rejects(setDesktopThreadTitle(desktopPage,guarded),/not-eligible/);
      assert.deepEqual(desktopCalls.map(call=>call.method),['thread/list']);
    }
    check('desktop-project-save-never-writes-if-chat-disappeared-or-title-changed',true);
  }finally{
    delete globalThis.window;delete globalThis.location;
  }

  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'better-codex-ai-rename-page-'));
  const context=await chromium.launchPersistentContext(scratch,{headless:true,executablePath:browserPath,viewport:{width:900,height:600}});
  try{
    const page=context.pages()[0];
    await page.setContent('<div data-codex-composer-root style="position:fixed;left:100px;right:100px;top:360px;height:120px"></div>');
    await page.evaluate(i18nSource);
    await page.evaluate(value=>{
      window.activeThreadId=value;
      window.__codexComposerHud={snapshot:()=>({id:window.activeThreadId,generation:7,visible:true})};
    },id);
    await page.evaluate(aiRenameSource);
    const requested=await page.evaluate(()=>window.__codexAiRename.request());
    const pending=await page.evaluate(()=>window.__codexAiRename.pull());
    check('page-request-binds-thread-and-generation',requested&&pending.threadId==='00000000-0000-4000-8000-000000000001'&&pending.generation===7);
    check('running-status-is-visible',await page.evaluate(()=>window.__codexAiRename.snapshot().visible&&window.__codexAiRename.snapshot().text.includes('整理会话')));
    await page.evaluate(value=>window.__codexAiRename.state(value),{requestId:pending.requestId,phase:'success',title:'feat：AI 重命名',running:false});
    check('success-status-shows-applied-title',await page.evaluate(()=>window.__codexAiRename.snapshot().text==='已重命名为 feat：AI 重命名'&&!window.__codexAiRename.snapshot().busy));
    check('failure-status-explains-unavailable-chat-record',await page.evaluate(()=>{
      const bridge=window.__codexAiRename;
      bridge.request();
      bridge.state({requestId:bridge.pull().requestId,phase:'failed',reason:'transcript-unavailable'});
      return bridge.snapshot().text==='无法读取聊天记录，已保留原名'&&!bridge.snapshot().busy;
    }));
    await page.evaluate(({id,otherId})=>{
      window.fastRequests=[];
      window.__betterCodexRequestAiRename=requestId=>window.fastRequests.push(requestId);
      const sidebar=document.createElement('aside');
      sidebar.innerHTML=[id,otherId].map(value=>`<div data-app-action-sidebar-thread-id="local:${value}"
        data-app-action-sidebar-thread-kind="local" data-app-action-sidebar-thread-host-id="local">
        <span>聊天</span><button aria-label="聊天菜单">…</button></div>`).join('');
      document.body.append(sidebar);
      for(const row of sidebar.children){
        function open(event){
          event.preventDefault();
          document.querySelector('[role="menu"]')?.remove();
          const menu=document.createElement('div');
          menu.setAttribute('role','menu');menu.dataset.state='open';
          menu.innerHTML='<div tabindex="-1" role="menuitem" aria-keyshortcuts="R">重命名</div><div role="menuitem">置顶</div>';
          window.bindNativeMenu(row,menu,event.type==='click');
          menu.addEventListener('keydown',event=>{if(event.key==='Escape')menu.remove();});
          document.body.append(menu);
        }
        row.addEventListener('contextmenu',open);
        row.querySelector('button').addEventListener('click',open);
      }
      window.bindNativeMenu=(row,menu,click=false)=>{
        const portal={tag:4};
        if(click){
          const trigger=row.querySelector('button');
          menu.id='fixture-dropdown';
          portal.return={memoizedProps:{contentId:menu.id,triggerRef:{current:trigger}}};
        }else{
          portal.return={memoizedProps:{menuShortcuts:true,getItems:()=>[]},child:{stateNode:row,sibling:portal}};
        }
        // The real Radix menu reaches its owner through the focus, popper,
        // and desktop portal wrappers, putting the owner beyond 48 ancestors.
        let branch=portal;
        for(let i=0;i<65;i++)branch={return:branch};
        menu.__reactFiber$fixture={stateNode:menu,return:branch};
      };
    },{id,otherId});
    const otherRow=page.locator(`[data-app-action-sidebar-thread-id="local:${otherId}"]`);
    await otherRow.locator('span').click({button:'right'});
    let top=page.locator('[role="menu"] [role="menuitem"]').first();
    check('sidebar-context-menu-puts-ai-rename-with-icon-first',await top.textContent()==='AI 重命名'&&
      await top.locator('svg').count()===1);
    await page.getByRole('menuitem',{name:'重命名',exact:true}).focus();
    await page.keyboard.press('ArrowUp');
    check('sidebar-rename-can-be-reached-by-keyboard',await top.evaluate(element=>document.activeElement===element));
    await page.keyboard.press('Enter');
    const sidebarRequest=await page.evaluate(()=>{
      const requestId=window.fastRequests.pop();
      return window.__codexAiRename.pull(requestId);
    });
    check('sidebar-context-menu-binds-target-not-active-chat-and-dispatches-immediately',
      sidebarRequest.threadId===otherId&&await page.locator('[role="menu"]').count()===0);
    await page.locator(`[data-app-action-sidebar-thread-id="local:${id}"] button`).click();
    top=page.locator('[role="menu"] [role="menuitem"]').first();
    check('sidebar-ellipsis-adds-same-top-item',await top.textContent()==='AI 重命名');
    await top.click();
    const secondRequest=await page.evaluate(()=>window.__codexAiRename.pull(window.fastRequests.pop()));
    check('sidebar-ellipsis-accepts-a-second-chat-before-the-first-finishes',secondRequest?.threadId===id&&
      secondRequest.requestId!==sidebarRequest.requestId);
    check('out-of-order-failure-does-not-end-the-other-rename',await page.evaluate(({first,second,otherId,id})=>{
      const bridge=window.__codexAiRename;
      bridge.state({requestId:second,phase:'failed',reason:'transcript-unavailable'});
      const afterFailure=bridge.snapshot();
      // The composer now points at the first sidebar job; only that duplicate is blocked.
      window.activeThreadId=otherId;
      const duplicate=bridge.request();
      window.activeThreadId=id;
      bridge.state({requestId:first,phase:'success',title:'feat：另一条聊天'});
      return afterFailure.busy&&afterFailure.text.includes('无法读取')&&!duplicate&&window.fastRequests.length===0&&
        !bridge.snapshot().busy&&bridge.snapshot().text==='已重命名为 feat：另一条聊天';
    },{first:sidebarRequest.requestId,second:secondRequest.requestId,otherId,id}));
    check('fallback-polls-unclaimed-requests-in-order-without-replaying-the-fast-path',await page.evaluate(({id,otherId})=>{
      const bridge=window.__codexAiRename,thirdId='00000000-0000-4000-8000-000000000003';
      const accepted=[id,otherId,thirdId].every(threadId=>{window.activeThreadId=threadId;return bridge.request();});
      window.activeThreadId=id;
      const [first,second,third]=window.fastRequests.splice(0);
      const fast=bridge.pull(second);
      const polled=[bridge.pull()?.threadId,bridge.pull()?.threadId];
      const noMore=!bridge.pull(first)&&!bridge.pull(second)&&!bridge.pull();
      for(const requestId of [first,second,third])bridge.state({requestId,phase:'success',title:'feat：并发测试'});
      return accepted&&fast?.threadId===otherId&&polled.join('|')===[id,thirdId].join('|')&&noMore&&!bridge.snapshot().busy;
    },{id,otherId}));
    await page.evaluate(({id,otherId})=>{
      const row=document.querySelector('[data-app-action-sidebar-thread-id="local:'+otherId+'"]');
      const wrongRow=document.querySelector('[data-app-action-sidebar-thread-id="local:'+id+'"]');
      row.dataset.appActionSidebarThreadId='local:client-new-thread:'+id;
      const owner=conversationId=>({memoizedProps:{hostId:'local',rowRef:{current:row},conversationId}});
      row.__reactFiber$fixture={memoizedProps:{hostId:'local',rowRef:{current:wrongRow},
        conversationId:'00000000-0000-4000-8000-000000000004'},
        return:{...owner(otherId),return:owner(otherId)}};
    },{id,otherId});
    const aliasedRow=page.locator('[data-app-action-sidebar-thread-id^="local:client-new-thread:"]');
    await aliasedRow.locator('span').click({button:'right'});
    check('temporary-sidebar-key-still-displays-the-action-first',await top.textContent()==='AI 重命名');
    await top.click();
    const aliasedRequest=await page.evaluate(()=>{
      const bridge=window.__codexAiRename,request=bridge.pull();
      bridge.state({requestId:request.requestId,phase:'success',title:'feat：AI 重命名'});
      return request;
    });
    check('temporary-sidebar-key-binds-only-the-owning-component-session',aliasedRequest.threadId===otherId);
    await aliasedRow.evaluate(row=>{
      row.__reactFiber$fixture.return.return.memoizedProps.conversationId='00000000-0000-4000-8000-000000000003';
    });
    await aliasedRow.locator('button').click();
    check('ambiguous-sidebar-alias-keeps-the-native-menu-unchanged',await top.textContent()==='重命名');

    // An unrelated menu with the same shortcut cannot consume the sidebar
    // action, and genuine menus need no fresh DOM event to be decorated.
    await page.evaluate(value=>{
      document.querySelector('[role="menu"]')?.remove();
      const make=()=>{
        const node=document.createElement('div');node.setAttribute('role','menu');node.dataset.state='open';
        node.innerHTML='<div role="menuitem" aria-keyshortcuts="R">重命名</div>';
        return node;
      };
      const other=make();other.id='unrelated-menu';document.body.append(other);
      const sidebar=make();sidebar.id='sidebar-menu';
      window.bindNativeMenu(document.querySelector('[data-app-action-sidebar-thread-id="local:'+value+'"]'),sidebar);
      document.body.append(sidebar);
    },id);
    const owned=page.locator('#sidebar-menu');
    check('menu-owned-by-a-sidebar-row-is-decorated-without-an-opening-event',
      await owned.locator('[role="menuitem"]').first().textContent()==='AI 重命名');
    check('same-shortcut-outside-the-sidebar-is-not-decorated',
      await page.locator('#unrelated-menu [data-bc-sidebar-ai-rename]').count()===0);
    await page.evaluate(value=>{
      const trigger=document.querySelector(`[data-app-action-sidebar-thread-id="local:${value}"] button`);
      trigger.id='native-popover-trigger';
      trigger.setAttribute('aria-haspopup','menu');
      trigger.setAttribute('aria-controls','native-popover');
      const menu=document.createElement('div');menu.id='native-popover';
      menu.setAttribute('role','menu');menu.dataset.state='open';
      menu.setAttribute('aria-labelledby',trigger.id);
      menu.innerHTML='<div role="menuitem" aria-keyshortcuts="R">重命名</div>';
      document.body.append(menu);
      const unrelated=menu.cloneNode(true);
      unrelated.id='another-popover';
      document.body.append(unrelated);
    },id);
    check('native-popover-uses-reciprocal-trigger-relationship-without-react-fiber',
      await page.locator('#native-popover [role="menuitem"]').first().textContent()==='AI 重命名'&&
      await page.locator('#another-popover [data-bc-sidebar-ai-rename]').count()===0);
    await owned.evaluate(menu=>{menu.dataset.state='closed';});
    check('closed-menu-drops-its-old-binding',await owned.locator('[data-bc-sidebar-ai-rename]').count()===0);
    await owned.evaluate(menu=>{menu.dataset.state='open';});
    check('reused-menu-node-gets-its-binding-on-reopen',await owned.locator('[data-bc-sidebar-ai-rename]').count()===1);
    await owned.evaluate(menu=>{
      const native=menu.querySelector('[aria-keyshortcuts="R"]').cloneNode(true);
      menu.replaceChildren(native);
    });
    check('native-menu-rerender-restores-the-action-once-at-the-top',
      await owned.locator('[role="menuitem"]').first().textContent()==='AI 重命名'&&
      await owned.locator('[data-bc-sidebar-ai-rename]').count()===1);
    const projectPage=await context.newPage();
    await projectPage.route('https://fixture.invalid/**',route=>route.fulfill(route.request().url().endsWith('.js')?
      {contentType:'text/javascript',body:`export const __webpack_require__={c:{module:{exports:{
        A2(){}, Nj(){}, Uz(){}, Iy(){}, TB(key){return key==='client-thread-bindings-v1'?{'client-new-thread:${third}':'${otherId}'}:null;}
      }}}};`}:{contentType:'text/html',body:'<script type="module" src="/assets/fixture.js"></script>'}));
    await projectPage.goto('https://fixture.invalid/');
    await projectPage.evaluate(i18nSource);
    await projectPage.evaluate(aiRenameSource);
    const linkedId='g-p-'+fourth.replaceAll('-','');
    await projectPage.evaluate(({id,third,fourth,inactive,linkedId})=>{
      for(const [heading,projectId,group] of [
        ['local',id,{group:{projectId:id,threadKeys:[`local:${fourth}`]}}],
        ['linked',linkedId,{project:{gizmo:{id:linkedId}},linkedLocalProjectId:id,
          localThreadKeys:[`local:${id}`,`local:client-new-thread:${third}`,`local:${id}`,`remote:${inactive}`]}],
        ['remote',fourth,{group:{projectId:fourth,threadKeys:[`local:${inactive}`]}}],
      ]){
        const outer=document.createElement('div');
        outer.dataset.sidebarProjectKind=heading==='remote'?'remote':'local';
        outer.innerHTML=`<div data-app-action-sidebar-project-row data-app-action-sidebar-project-id="${projectId}">
          <button>${heading}</button></div>`;
        const row=outer.firstElementChild;
        row.__reactFiber$fixture={stateNode:row,return:{memoizedProps:group}};
        row.querySelector('button').onclick=()=>{
          document.querySelector('[role="menu"]')?.remove();
          const menu=document.createElement('div');
          menu.setAttribute('role','menu');menu.dataset.state='open';
          menu.innerHTML='<div role="menuitem" tabindex="-1">置顶</div><div role="menuitem">编辑</div>';
          menu.__reactFiber$fixture={stateNode:menu,return:{tag:4,return:{
            memoizedProps:{trigger:'click',preserveBrowserContextMenu:true,getItems:()=>[]},return:{stateNode:row}
          }}};
          menu.onkeydown=event=>{if(event.key==='Escape')menu.remove();};
          document.body.append(menu);
        };
        document.body.append(outer);
      }
    },{id,third,fourth,inactive,linkedId});
    const projectTop=projectPage.locator('[role="menu"] [role="menuitem"]').first();
    await projectPage.getByRole('button',{name:'remote'}).click();
    check('project-menu-does-not-decorate-unproven-nonlocal-groups',await projectTop.textContent()==='置顶');
    await projectPage.getByRole('button',{name:'local'}).click();
    check('local-project-menu-adds-batch-action-without-native-rename-item',await projectTop.textContent()==='批量 AI 重命名');
    await projectTop.click();
    const localRequest=await projectPage.evaluate(()=>window.__codexAiRename.pull());
    check('local-project-menu-enqueues-unmounted-member-without-expanding',localRequest.kind==='project'&&
      localRequest.projectId===id&&String(localRequest.threadIds)===fourth&&await projectPage.locator('[role="menu"]').count()===0);
    await projectPage.evaluate(requestId=>window.__codexAiRename.state({requestId,phase:'success'}),localRequest.requestId);
    await projectPage.getByRole('button',{name:'linked'}).click();
    await projectTop.click();
    await projectPage.waitForFunction(()=>window.__codexAiRename.snapshot().busy);
    let linkedRequest;
    await waitFor(async()=>!!(linkedRequest=await projectPage.evaluate(()=>window.__codexAiRename.pull())));
    check('linked-project-menu-resolves-hidden-alias-and-deduplicates-native-group',linkedRequest.projectId===linkedId&&
      String(linkedRequest.threadIds)===String([id,otherId])&&linkedRequest.unresolved===0);
    await projectPage.close();
    await page.evaluate(()=>window.__codexAiRename.remove());
    check('page-module-cleans-up',await page.locator('[data-bc-ai-rename-root],[id="better-codex-ai-rename-style"],[data-bc-sidebar-ai-rename]').count()===0);
  }finally{
    await context.close();
    fs.rmSync(scratch,{recursive:true,force:true});
  }
  console.log(JSON.stringify({passed:results.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
