const {text}=require('../../platform/i18n/localization.cjs');
const t=(key,values)=>text('check.'+key,values);
function row(id,state,detail='',suggestion='',{status,summary=null}={}){
  return {id,label:t(id),state,status:status??t(state==='unknown'?'unknownStatus':state),detail,summary,suggestion};
}
function summarize(rows){
  if(rows.some(r=>r.state==='pending'))return 'checking';
  if(rows.some(r=>r.state==='fail'&&['app','sessions','sandbox','network'].includes(r.id)))return 'failed';
  if(rows.some(r=>['fail','warning'].includes(r.state)))return 'partial';
  if(rows.some(r=>r.state==='unknown'))return 'unknown';
  return 'healthy';
}
function report(rows,version=''){
  const state=summarize(rows);
  return {state,title:t(state),description:t(state+'Description'),rows,checkedAt:new Date().toISOString(),
    packageVersion:version,note:t('note'),modelMessageSent:false};
}
const severity={fail:5,warning:4,unknown:3,pending:2,pass:1,notApplicable:1};
function partsRow(id,parts){
  const state=parts.every(p=>p.state==='notApplicable')?'notApplicable':summarize(parts);
  const brief=parts.reduce((a,b)=>severity[b.state]>severity[a.state]?b:a);
  return row(id,({healthy:'pass',partial:'warning',checking:'pending'})[state]??state,
    parts.map(p=>t(p.code)).join('\n'),'',{summary:t(brief.code)});
}
module.exports={t,row,summarize,report,partsRow,severity};
