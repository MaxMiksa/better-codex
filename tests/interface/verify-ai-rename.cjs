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
const {applyThreadTitle}=require('../../src/interface/host/native-rename.cjs');
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
  check('prompt-weighs-user-goal-changes-over-followups',prompt.includes('明确改变目标时，以新目标为准')&&
    prompt.includes('排查同一功能或询问实现细节，仍按原主题命名'));

  const injected=transcript.contentText([
    {type:'input_text',text:'# AGENTS.md instructions for fixture'},
    {type:'input_text',text:'<environment_context>fixture</environment_context>'},
    {type:'input_text',text:'真实用户内容'},
    {type:'input_image',image_url:'fixture'}
  ]);
  check('injected-user-context-is-removed',injected==='真实用户内容\n[图片]');

  const longText=Array.from({length:9000},(_,index)=>`section-${index} 会话内容`).join('\n');
  const split=transcript.splitTranscript(longText);
  check('long-transcript-compresses',split.mode==='compressed'&&split.middleChunks.length>0);
  check('compression-preserves-every-character',
    split.head+split.middleChunks.join('')+split.tail===longText);

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'better-codex-ai-rename-'));
  try{
    const rollout=path.join(root,'rollout.jsonl');
    fs.writeFileSync(rollout,[
      {type:'response_item',payload:{type:'message',role:'developer',content:[{type:'input_text',text:'developer'}]}},
      {type:'event_msg',payload:{type:'task_started',turn_id:'r1'}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'未答复的用户消息'}]}},
      {type:'event_msg',payload:{type:'turn_aborted',turn_id:'r1'}},
      {type:'turn_context',payload:{turn_id:'r2'}},
      {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'# AGENTS.md instructions for x'},{type:'input_text',text:'用户目标'}]}},
      {type:'response_item',payload:{type:'message',role:'assistant',phase:'commentary',content:[{type:'output_text',text:'commentary'}]}},
      {type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text:'最终回复'}]}}
    ].map(value=>JSON.stringify(value)).join('\n'),'utf8');
    const state=new DatabaseSync(path.join(root,'state_5.sqlite'));
    state.exec('CREATE TABLE threads (id TEXT,title TEXT,name TEXT,rollout_path TEXT,updated_at_ms INTEGER)');
    state.prepare('INSERT INTO threads VALUES (?,?,?,?,?)').run(id,'title',null,rollout,1);
    state.close();
    const fallback=await transcript.readThreadTranscript(root,id);
    check('rollout-fallback-keeps-user-and-final-only',fallback.source==='rollout'&&fallback.messages.map(message=>message.text).join('|')===
      '未答复的用户消息|用户目标|最终回复');
    check('rollout-boundaries-preserve-unanswered-turn',transcript.formatTranscript(fallback.messages)===
      '【第 1 轮】\n【用户消息 1】\n未答复的用户消息\n\n【第 2 轮】\n【用户消息 1】\n用户目标\n\n【模型回复 1】\n最终回复');

    const history=new DatabaseSync(path.join(root,'thread_history_1.sqlite'));
    history.exec('CREATE TABLE thread_items (thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,item_json TEXT,item_type TEXT)');
    history.exec('CREATE TABLE thread_turns (thread_id TEXT,turn_id TEXT,final_agent_item_id TEXT)');
    const insert=history.prepare('INSERT INTO thread_items VALUES (?,?,?,?,?,?)');
    insert.run(id,'t1','u1',1,JSON.stringify({type:'userMessage',content:[{type:'text',text:'用户信息'}]}),'userMessage');
    insert.run(id,'t1','a0',2,JSON.stringify({type:'agentMessage',phase:'commentary',text:'中间说明'}),'agentMessage');
    insert.run(id,'t1','a1',3,JSON.stringify({type:'agentMessage',phase:'final_answer',text:'最终答复'}),'agentMessage');
    insert.run(id,'t1','tool',4,JSON.stringify({type:'commandExecution',command:'fixture'}),'commandExecution');
    insert.run(id,'t2','u2',5,JSON.stringify({type:'userMessage',content:[{type:'text',text:'后续需求'}]}),'userMessage');
    insert.run(id,'t2','u3',6,JSON.stringify({type:'userMessage',content:[{type:'text',text:'补充消息'}]}),'userMessage');
    insert.run(id,'t2','a2',7,JSON.stringify({type:'agentMessage',phase:'final_answer',text:'后续答复'}),'agentMessage');
    history.prepare('INSERT INTO thread_turns VALUES (?,?,?)').run(id,'t1','a1');
    history.close();
    const fromHistory=await transcript.readThreadTranscript(root,id);
    check('history-prefers-user-and-final',fromHistory.source==='history'&&fromHistory.messages.map(message=>message.role).join('|')==='user|assistant|user|user|assistant'&&
      fromHistory.messages[1].text==='最终答复');
    check('history-restarts-role-numbering-each-round',transcript.formatTranscript(fromHistory.messages)===
      '【第 1 轮】\n【用户消息 1】\n用户信息\n\n【模型回复 1】\n最终答复\n\n'+
      '【第 2 轮】\n【用户消息 1】\n后续需求\n\n【用户消息 2】\n补充消息\n\n【模型回复 1】\n后续答复');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }

  const calls=[];
  const title=await rename.generateTitle([{role:'user',text:'做一个 AI 重命名命令'}],{call:async prompt=>{
    calls.push(prompt);
    return '{"title":"feat: AI 重命名"}';
  }});
  check('generate-title-uses-model-output',title==='feat：AI 重命名'&&calls.length===1&&calls[0].includes('风格示例'));
  check('model-receives-round-formatted-session',calls[0].endsWith('<session>\n【第 1 轮】\n【用户消息 1】\n做一个 AI 重命名命令\n</session>'));
  check('older-untagged-messages-can-start-another-round',transcript.formatTranscript([
    {role:'user',text:'第一条'},{role:'assistant',text:'答复'},{role:'user',text:'下一条'}
  ]).endsWith('【第 2 轮】\n【用户消息 1】\n下一条'));

  const longMessages=[{role:'user',text:longText}];
  let summaryCalls=0;
  const compressed=await rename.generateTitle(longMessages,{call:async prompt=>{
    if(prompt.includes('分段压缩器')){summaryCalls+=1;return '{"summary":"长会话分段摘要"}';}
    return '{"title":"feat: 超长会话"}';
  }});
  check('long-title-compresses-middle',compressed==='feat：超长会话'&&summaryCalls>0);

  let currentId=id,notifications=[],applied=null,readCount=0;
  globalThis.window={
    __codexComposerHud:{snapshot:()=>({id:currentId})},
    __codexAiRename:{state:value=>notifications.push(value)}
  };
  const fakePage={evaluate:(fn,arg)=>Promise.resolve(fn(arg))};
  const transcriptMessages=[{role:'user',text:'做一个 AI 重命名命令'}];
  const makeManager=(options={})=>rename.createAiRenameManager({
    settings:{codexHome:'fixture'},page:fakePage,
    isActive:options.isActive||(()=>true),
    readTranscript:options.readTranscript||(async()=>{readCount+=1;return {messages:transcriptMessages};}),
    resolveExecutable:async()=>'codex.exe',
    callFactory:options.callFactory||(()=>({run:async()=>'{"title":"feat: AI 重命名"}',cancel(){}})),
    applyTitle:options.applyTitle||(async(page,threadId,title)=>applied={threadId,title})
  });
  try{
    const manager=makeManager();
    manager.start({requestId:'success',threadId:id},{id});
    await waitFor(()=>notifications.some(value=>value.requestId==='success'));
    check('manager-applies-generated-title-to-current-chat',applied?.threadId===id&&applied.title==='feat：AI 重命名'&&
      manager.status().phase==='success'&&notifications.at(-1).title==='feat：AI 重命名');
    manager.close();

    currentId=id;applied=null;notifications=[];
    const changed=makeManager({readTranscript:async()=>{
      currentId=otherId;
      return {messages:transcriptMessages};
    }});
    changed.start({requestId:'changed',threadId:id},{id});
    await waitFor(()=>notifications.some(value=>value.requestId==='changed'));
    check('manager-never-applies-after-chat-switch',applied===null&&changed.status().phase==='failed'&&
      changed.status().reason==='thread-changed');
    changed.close();

    currentId=id;applied=null;notifications=[];
    const failed=makeManager({callFactory:()=>({run:async()=>{throw new Error('model');},cancel(){}})});
    failed.start({requestId:'failed',threadId:id},{id});
    await waitFor(()=>notifications.some(value=>value.requestId==='failed'));
    check('manager-keeps-original-title-on-model-failure',applied===null&&failed.status().phase==='failed'&&
      notifications.at(-1).phase==='failed');
    failed.close();

    currentId=id;let cancelled=0,started=false;
    const closing=makeManager({callFactory:()=>({run:()=>{started=true;return new Promise(()=>{});},cancel(){cancelled+=1;}})});
    closing.start({requestId:'closing',threadId:id},{id});
    await waitFor(()=>started);
    closing.close();
    check('manager-close-cancels-active-model-call',cancelled===1);
  }finally{
    delete globalThis.window;
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
    await page.evaluate(()=>window.__codexAiRename.remove());
    check('page-module-cleans-up',await page.locator('[data-bc-ai-rename-root],[id="better-codex-ai-rename-style"]').count()===0);

    await page.evaluate(value=>{
      const row=document.createElement('div');
      row.dataset.appActionSidebarThreadActive='true';
      row.dataset.appActionSidebarThreadId='local:'+value;
      row.dataset.appActionSidebarThreadTitle='旧标题';
      row.innerHTML='<button data-thread-title>旧标题</button>';
      row.style.cssText='position:fixed;left:20px;top:20px;width:180px;height:32px';
      const open=()=>{
        document.querySelector('[role="dialog"]')?.remove();
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
        dialog.style.cssText='position:fixed;left:220px;top:80px;width:320px;height:90px;background:#222;padding:12px';
        dialog.innerHTML='<form><input><button type="submit">保存</button></form>';
        dialog.querySelector('input').value=row.dataset.appActionSidebarThreadTitle||'';
        dialog.querySelector('form').addEventListener('submit',event=>{
          event.preventDefault();
          row.querySelector('[data-thread-title]').textContent=dialog.querySelector('input').value;
          row.dataset.appActionSidebarThreadTitle=dialog.querySelector('input').value;
          dialog.remove();
        });
        document.body.append(dialog);
        dialog.querySelector('input').focus();
      };
      row.querySelector('[data-thread-title]').addEventListener('dblclick',open);
      document.addEventListener('keydown',event=>{
        if(event.key==='Escape')document.querySelector('[role="dialog"]')?.remove();
      });
      document.body.append(row);
    },id);
    await applyThreadTitle(page,id,'feat：AI 重命名',{timeout:2000});
    check('native-rename-targets-current-chat-and-submits-title',
      await page.locator(`[data-app-action-sidebar-thread-id="local:${id}"] [data-thread-title]`).textContent()==='feat：AI 重命名');

    await page.evaluate(({id,otherId})=>{
      const row=document.querySelector('[data-app-action-sidebar-thread-id="local:'+id+'"]');
      row.dataset.appActionSidebarThreadActive='true';
      row.dataset.appActionSidebarThreadSelected='true';
      row.dataset.appActionSidebarThreadId='local:client-new-thread:'+otherId;
      row.dataset.appActionSidebarThreadTitle='旧标题';
      row.querySelector('[data-thread-title]').textContent='旧标题';
    },{id,otherId});
    await assert.rejects(applyThreadTitle(page,id,'bug: 无法确认目标',{expectedName:'其他标题'}),/title-row-missing/);
    await applyThreadTitle(page,id,'bug: 临时聊天标题',{timeout:2000,expectedName:'旧标题'});
    check('native-rename-follows-selected-temporary-chat-row',
      await page.locator(`[data-app-action-sidebar-thread-id="local:client-new-thread:${otherId}"] [data-thread-title]`).textContent()==='bug: 临时聊天标题');

    await page.evaluate(({id,otherId})=>{
      const editor=document.querySelector('[data-app-action-sidebar-thread-id="local:client-new-thread:'+otherId+'"] [data-thread-title]');
      editor.textContent='旧标题';
      editor.closest('[data-app-action-sidebar-thread-id]').dataset.appActionSidebarThreadTitle='旧标题';
      document.querySelector('[role="dialog"]')?.remove();
      document.addEventListener('input',event=>{
        if(event.target.matches('[role="dialog"] input'))window.activeThreadId=otherId;
      },{once:true});
    },{id,otherId});
    await assert.rejects(applyThreadTitle(page,id,'bug: 错误标题',{timeout:1000,expectedName:'旧标题'}),error=>error.message==='thread-changed');
    check('native-rename-aborts-when-chat-switches-during-edit',
      await page.locator(`[data-app-action-sidebar-thread-id="local:client-new-thread:${otherId}"] [data-thread-title]`).textContent()==='旧标题');

    await page.evaluate(value=>window.activeThreadId=value,id);
    await page.evaluate(()=>{
      const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
      dialog.style.cssText='position:fixed;left:220px;top:80px;width:320px;height:90px;background:#222;padding:12px';
      dialog.innerHTML='<form><input></form>';document.body.append(dialog);
    });
    await assert.rejects(applyThreadTitle(page,id,'chore: 忙碌弹窗',{timeout:500}),error=>error.message==='dialog-busy');
    check('native-rename-refuses-to-replace-another-dialog',true);
  }finally{
    await context.close();
    fs.rmSync(scratch,{recursive:true,force:true});
  }
  console.log(JSON.stringify({passed:results.length}));
})().catch(error=>{console.error(error);process.exitCode=1;});
