// Resolve temporary desktop IDs using metadata only; never guess among titles.
const fs=require('node:fs');
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const persistent=new RegExp('^'+uuid+'$','i'),temporary=new RegExp('^local:client-new-thread:'+uuid+'$','i');
function resolveChat(request,source){
  if(!request || !temporary.test(request.raw) || !request.title)return null;
  const latest=new Map();
  for(const line of source.replace(/^\uFEFF/,'').split(/\r?\n/)){
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{return null;}
    if(typeof row?.id==='string')latest.set(row.id,row.thread_name);
  }
  const matches=[...latest].filter(([,title])=>title===request.title);
  return matches.length===1 && persistent.test(matches[0][0])?matches[0][0]:null;
}
function readBinding(request,index){
  try{return resolveChat(request,fs.readFileSync(index,'utf8'));}catch{return null;}
}
module.exports={resolveChat,readBinding};
