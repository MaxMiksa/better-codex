const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const sentenceBoundaries=new Intl.Segmenter('zh-CN',{granularity:'sentence'});

let DatabaseSync=null;
function database(){
  if(!DatabaseSync)DatabaseSync=require('node:sqlite').DatabaseSync;
  return DatabaseSync;
}
function databases(home,prefix){
  let entries;
  try{entries=fs.readdirSync(home,{withFileTypes:true});}catch{return [];}
  return entries.filter(entry=>entry.isFile()&&entry.name.startsWith(prefix)&&entry.name.endsWith('.sqlite'))
    .map(entry=>({name:entry.name,index:Number(entry.name.slice(prefix.length,-7)),file:path.join(home,entry.name)}))
    .filter(entry=>Number.isInteger(entry.index))
    .sort((a,b)=>b.index-a.index);
}
function open(file){
  const Database=database();
  return new Database(file,{readOnly:true});
}
function readThreadRow(home,threadId){
  for(const {file} of databases(home,'state_')){
    let db;
    try{
      db=open(file);
      const columns=new Set(db.prepare('PRAGMA table_info(threads)').all().map(row=>row.name));
      if(!columns.has('id'))continue;
      const row=db.prepare('SELECT id,title,name,rollout_path,updated_at_ms FROM threads WHERE id=?').get(threadId);
      if(row)return row;
    }catch{}
    finally{try{db?.close();}catch{}}
  }
  return null;
}
function isInjectedUserPart(text){
  return /^\s*#\s+AGENTS\.md instructions for\b/i.test(text)||/^\s*<environment_context>/i.test(text);
}
function imagePart(part){
  return /image/i.test(String(part?.type||''));
}
function contentText(content){
  if(!Array.isArray(content))return '';
  const parts=[];
  for(const part of content){
    if(typeof part?.text==='string'&&part.text.trim()&&!isInjectedUserPart(part.text))parts.push(part.text);
    else if(imagePart(part))parts.push('[图片]');
  }
  return parts.join('\n');
}
function responseText(payload){
  if(!Array.isArray(payload?.content))return '';
  return payload.content.filter(part=>typeof part?.text==='string'&&part.text.trim())
    .map(part=>part.text).join('\n');
}
async function rolloutMessages(file,threadId){
  const before=await fs.promises.stat(file);
  if(!before.isFile())throw new Error('transcript-unavailable');
  const messages=[];
  const stream=fs.createReadStream(file,{encoding:'utf8'});
  const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
  let ordinal=0,turnId=null,matched=false,unreadable=false;
  try{
    for await(const line of lines){
      if(!line.trim())continue;
      ordinal+=1;
      let row;
      try{row=JSON.parse(line);}catch{unreadable=true;break;}
      const payload=row?.payload;
      if(row?.type==='session_meta'){
        if(typeof payload?.id!=='string'||payload.id.toLowerCase()!==threadId.toLowerCase()){
          unreadable=true;
          break;
        }
        matched=true;
        turnId=null;
      }else if(!matched){unreadable=true;break;}
      if(row?.type==='event_msg'){
        if(/^(task_started|turn_started)$/.test(payload?.type))turnId=payload.turn_id||null;
        if(/^(task_complete|task_completed|turn_complete|turn_aborted)$/.test(payload?.type)&&
          (!payload.turn_id||payload.turn_id===turnId))turnId=null;
      }
      if(row?.type==='turn_context'&&payload?.turn_id)turnId=payload.turn_id;
      if(row?.type!=='response_item'||payload?.type!=='message')continue;
      if(payload.role==='user'){
        const text=contentText(payload.content);
        if(text.trim())messages.push({role:'user',text,ordinal,turnId:payload.turn_id||turnId});
      }else if(payload.role==='assistant'&&payload.phase==='final_answer'){
        const text=responseText(payload);
        if(text.trim())messages.push({role:'assistant',text,ordinal,turnId:payload.turn_id||turnId});
      }
    }
  }finally{
    lines.close();
    stream.destroy();
  }
  const after=await fs.promises.stat(file);
  if(['dev','ino','size','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]))throw new Error('transcript-changed');
  if(!matched||unreadable)throw new Error('transcript-unavailable');
  return messages;
}
function validThreadId(value){
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function readThreadTranscript(codexHome,threadId,{readRow=readThreadRow}={}){
  if(!validThreadId(threadId))throw new Error('invalid-thread');
  let row=readRow(codexHome,threadId),reason;
  for(let attempt=0;attempt<2;attempt++){
    const file=row?.rollout_path;
    let messages;
    reason='transcript-unavailable';
    if(typeof file==='string'&&path.isAbsolute(file)){
      try{messages=await rolloutMessages(file,threadId);}
      catch(error){if(error.message==='transcript-changed')reason='transcript-changed';}
    }
    row=readRow(codexHome,threadId);
    if(row?.rollout_path!==file){reason='transcript-changed';continue;}
    if(messages){
      if(!messages.some(message=>message.role==='user'))throw new Error('empty');
      return {messages,source:'rollout',thread:row};
    }
  }
  throw new Error(reason);
}
function formatTranscript(messages){
  let round=0,currentTurn=null,previousRole=null,users=0,answers=0;
  return messages.map(({role,text,turnId})=>{
    const user=role==='user';
    const nextRound=!round||(turnId&&currentTurn?turnId!==currentTurn:user&&previousRole==='assistant');
    let heading='';
    if(nextRound){
      heading=`【第 ${++round} 轮】\n`;
      currentTurn=null;
      users=0;
      answers=0;
    }
    if(turnId)currentTurn=turnId;
    previousRole=role;
    const label=user?`用户消息 ${++users}`:`模型回复 ${++answers}`;
    const content=String(text).trim();
    const excerpt=user?content:(sentenceBoundaries.segment(content)[Symbol.iterator]().next().value?.segment.trimEnd()??'');
    return `${heading}【${label}】\n${excerpt}`;
  }).join('\n\n');
}
module.exports={readThreadTranscript,readThreadRow,formatTranscript,
  contentText,responseText,isInjectedUserPart,validThreadId,databases};
