// Transient status and request bridge for AI naming; no draft or chat content is retained.
(() => {
  if(window.__codexAiRename)return;
  const fallback={running:'AI 正在整理会话…',success:'已重命名为 {title}',failed:'AI 重命名失败，已保留原名',noChat:'请先打开已保存的聊天',busy:'AI 重命名正在处理',
    unavailable:'无法读取聊天记录，已保留原名',changing:'聊天记录仍在更新，请稍后重试',noMessages:'没有可用于命名的用户消息'};
  const t=(key,values={})=>window.__codexHudI18n?.t?.(key,values)??(fallback[key.replace(/^aiRename\./,'')]||key).replace(/\{(\w+)\}/g,(match,name)=>Object.hasOwn(values,name)?String(values[name]):match);
  const style=document.createElement('style');style.id='better-codex-ai-rename-style';
  style.textContent=`[data-bc-ai-rename-root]{position:fixed;z-index:2147483002;display:flex;align-items:center;gap:8px;max-width:min(440px,calc(100vw - 24px));min-height:36px;padding:7px 12px;border:1px solid color-mix(in srgb,var(--color-border-primary,#ffffff24) 88%,transparent);border-radius:12px;background:color-mix(in srgb,var(--color-background-elevated,#2b2b2b) 94%,transparent);color:var(--color-text-primary,var(--color-text,currentColor));box-shadow:0 12px 34px #0006;font:500 13px/1.35 var(--font-sans,'Segoe UI',sans-serif);pointer-events:none;transform:translate(-50%,-100%)}
  [data-bc-ai-rename-root][hidden]{display:none!important}
  [data-bc-ai-rename-mark]{display:grid;place-items:center;flex:0 0 16px;width:16px;height:16px;color:var(--codex-base-accent,currentColor)}
  [data-bc-ai-rename-mark] svg{width:16px;height:16px}
  [data-bc-ai-rename-mark][data-spin] svg{animation:bc-ai-rename-spin .9s linear infinite}
  [data-bc-ai-rename-text]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  @keyframes bc-ai-rename-spin{to{transform:rotate(360deg)}}`;
  document.head.append(style);
  const host=document.createElement('div');host.dataset.bcAiRenameRoot='';host.hidden=true;host.setAttribute('role','status');host.setAttribute('aria-live','polite');
  const mark=document.createElement('span');mark.dataset.bcAiRenameMark='';
  const text=document.createElement('span');text.dataset.bcAiRenameText='';
  host.append(mark,text);document.body.append(host);
  const sparkle='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.1L5 10l5.1 1.9L12 17l1.9-5.1L19 10l-5.1-1.9Z"/><path d="M5 3v4M3 5h4M19 17v4M17 19h4"/></svg>';
  const spinner='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.2-8.56"/></svg>';
  let pending=null,busy=false,timer=0,staleTimer=0,activeId=null;
  function position(){
    const composers=[...document.querySelectorAll('[data-codex-composer-root]')].filter(element=>element.checkVisibility()&&element.getBoundingClientRect().width>0)
      .sort((a,b)=>b.getBoundingClientRect().top-a.getBoundingClientRect().top);
    const rect=composers[0]?.getBoundingClientRect();
    if(rect){
      host.style.left=Math.max(12,Math.min(innerWidth-12,rect.left+rect.width/2))+'px';
      host.style.top=Math.max(56,rect.top-10)+'px';
    }else{
      host.style.left='50%';host.style.top='calc(100vh - 112px)';
    }
  }
  function hide(){if(timer)clearTimeout(timer);timer=0;host.hidden=true;}
  function show(kind,message){
    if(timer)clearTimeout(timer);
    host.hidden=false;host.dataset.state=kind;mark.innerHTML=kind==='running'?spinner:sparkle;
    mark.toggleAttribute('data-spin',kind==='running');text.textContent=message;position();
    if(kind!=='running')timer=setTimeout(hide,kind==='success'?4200:5200);
  }
  function available(){return Boolean(window.__codexComposerHud?.snapshot?.().id);}
  function request(){
    const snapshot=window.__codexComposerHud?.snapshot?.();
    if(!snapshot?.id){show('failed',t('aiRename.noChat'));return false;}
    if(busy){show('failed',t('aiRename.busy'));return false;}
    busy=true;
    const id='ai-rename:'+Date.now()+':'+Math.random().toString(36).slice(2);
    activeId=id;
    pending={requestId:id,threadId:snapshot.id,generation:snapshot.generation,createdAt:Date.now()};
    show('running',t('aiRename.running'));
    if(staleTimer)clearTimeout(staleTimer);
    staleTimer=setTimeout(()=>{
      if(busy&&pending){busy=false;pending=null;activeId=null;show('failed',t('aiRename.failed'));}
    },180000);
    return true;
  }
  function pull(){const value=pending;pending=null;return value;}
  function state(value){
    if(!value?.requestId||value.requestId!==activeId)return;
    busy=Boolean(value.running);
    if(staleTimer){clearTimeout(staleTimer);staleTimer=0;}
    if(value.phase==='success'){activeId=null;show('success',t('aiRename.success',{title:value.title||''}));}
    else if(value.phase==='failed'){
      activeId=null;
      const message=value.reason==='transcript-unavailable'?t('aiRename.unavailable'):
        value.reason==='transcript-changed'?t('aiRename.changing'):
        value.reason==='empty'?t('aiRename.noMessages'):t('aiRename.failed');
      show('failed',message);
    }
  }
  function remove(){
    if(timer)clearTimeout(timer);if(staleTimer)clearTimeout(staleTimer);
    window.removeEventListener('resize',position);style.remove();host.remove();delete window.__codexAiRename;
  }
  window.addEventListener('resize',position);
  window.__codexAiRename={request,pull,state,available,remove,snapshot:()=>({pending,busy,visible:!host.hidden,text:text.textContent})};
})();
