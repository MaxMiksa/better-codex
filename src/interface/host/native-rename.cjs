function titleRow({threadId,expectedName,dispatch=false}){
  if(window.__codexComposerHud?.snapshot?.().id!==threadId)return null;
  const rows=[...document.querySelectorAll('[data-app-action-sidebar-thread-id]')]
    .filter(row=>row.checkVisibility()&&row.querySelector('[data-thread-title]'));
  const selected=row=>row.getAttribute('data-app-action-sidebar-thread-selected')==='true';
  const active=row=>row.getAttribute('data-app-action-sidebar-thread-active')==='true';
  const exact=rows.filter(row=>row.getAttribute('data-app-action-sidebar-thread-id')===`local:${threadId}`&&active(row));
  if(exact.length>1)return null;
  // A just-created chat can still use local:client-new-thread:* in the sidebar.
  const current=rows.filter(row=>selected(row)&&active(row));
  const temporary=current.length===1&&current[0].getAttribute('data-app-action-sidebar-thread-id').startsWith('local:client-new-thread:')&&
    expectedName&&current[0].getAttribute('data-app-action-sidebar-thread-title')?.trim()===expectedName?current[0]:null;
  const row=exact[0]??temporary;
  if(!row)return null;
  const name=row.getAttribute('data-app-action-sidebar-thread-title')?.trim()??'';
  if(dispatch){
    if([...document.querySelectorAll('[role="dialog"]')].some(element=>element.checkVisibility()))return null;
    // Dispatch only the rename gesture; a physical double-click first clicks and can navigate.
    row.querySelector('[data-thread-title]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true,view:window,detail:2}));
  }
  return {name,rowId:row.getAttribute('data-app-action-sidebar-thread-id')};
}
async function isCurrentThread(page,threadId){
  return page.evaluate(id=>window.__codexComposerHud?.snapshot?.().id===id,threadId);
}
async function applyThreadTitle(page,threadId,title,{active=()=>true,timeout=5000,verify,expectedName}={}){
  if(!active())throw new Error('inactive');
  if(!await isCurrentThread(page,threadId))throw new Error('thread-changed');
  if(await page.evaluate(()=>[...document.querySelectorAll('[role="dialog"]')].some(element=>element.checkVisibility())))throw new Error('dialog-busy');
  const row=await page.evaluate(titleRow,{threadId,expectedName,dispatch:true});
  if(!row)throw new Error('title-row-missing');
  let handle,input;
  try{
    handle=await page.waitForFunction(name=>{
      const candidates=[...document.querySelectorAll('[role="dialog"] form input:not([type="hidden"])')]
        .filter(el=>el.checkVisibility()&&!el.disabled&&!el.readOnly&&el.value.trim()===name);
      return candidates.length===1?candidates[0]:null;
    },row.name,{timeout});
    input=handle.asElement();
    if(!active())throw new Error('inactive');
    if(!await isCurrentThread(page,threadId))throw new Error('thread-changed');
    if(row.name===title&&(!verify||await verify())){await input.press('Escape',{timeout});return true;}
    await input.fill(title,{timeout});
    if(!active())throw new Error('inactive');
    if(!await isCurrentThread(page,threadId))throw new Error('thread-changed');
    const submitted=await input.evaluate((el,{threadId,title})=>{
      if(!el.checkVisibility()||el.value!==title||window.__codexComposerHud?.snapshot?.().id!==threadId)return false;
      const button=el.form?.querySelector('button[type="submit"]:not(:disabled)');
      if(!button)return false;
      button.click();
      return true;
    },{threadId,title});
    if(!submitted)throw new Error('title-not-applied');
    if(verify){
      const deadline=Date.now()+timeout;
      while(Date.now()<deadline){
        if(await verify())return true;
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      throw new Error('title-not-applied');
    }
    await page.waitForFunction(({rowId,title})=>[...document.querySelectorAll('[data-app-action-sidebar-thread-id]')]
      .some(row=>row.getAttribute('data-app-action-sidebar-thread-id')===rowId&&row.getAttribute('data-app-action-sidebar-thread-title')===title),
    {rowId:row.rowId,title},{timeout});
    return true;
  }catch(error){
    if(await input?.isVisible().catch(()=>false))await input.press('Escape',{timeout}).catch(()=>{});
    throw error;
  }finally{
    await handle?.dispose().catch(()=>{});
  }
}
module.exports={applyThreadTitle};
