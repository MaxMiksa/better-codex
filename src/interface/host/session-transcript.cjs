const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');

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
function parsedItem(row){
  try{
    const item=JSON.parse(row.item_json);
    return item&&typeof item==='object'?item:null;
  }catch{return null;}
}
function historyMessages(home,threadId){
  for(const {file} of databases(home,'thread_history_')){
    let db;
    try{
      db=open(file);
      const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
      if(!tables.has('thread_items')||!tables.has('thread_turns'))continue;
      const finals=new Set(db.prepare('SELECT final_agent_item_id FROM thread_turns WHERE thread_id=? AND final_agent_item_id IS NOT NULL').all(threadId)
        .map(row=>row.final_agent_item_id));
      const turnColumn=db.prepare('PRAGMA table_info(thread_items)').all().some(column=>column.name==='turn_id')?'turn_id':'NULL AS turn_id';
      const rows=db.prepare(`SELECT item_id,rollout_ordinal,item_type,item_json,${turnColumn} FROM thread_items
        WHERE thread_id=? AND item_type IN ('userMessage','agentMessage') ORDER BY rollout_ordinal,item_id`).all(threadId);
      const messages=[],seen=new Set();
      for(const row of rows){
        if(seen.has(row.item_id))continue;
        const item=parsedItem(row);
        if(!item)continue;
        if(row.item_type==='agentMessage'&&item.phase!=='final_answer'&&!finals.has(row.item_id))continue;
        const text=row.item_type==='userMessage'?contentText(item.content):typeof item.text==='string'?item.text:'';
        if(!text.trim())continue;
        seen.add(row.item_id);
        messages.push({role:row.item_type==='userMessage'?'user':'assistant',text,ordinal:row.rollout_ordinal,turnId:row.turn_id});
      }
      if(messages.length)return messages;
    }catch{}
    finally{try{db?.close();}catch{}}
  }
  return [];
}
function responseText(payload){
  if(!Array.isArray(payload?.content))return '';
  return payload.content.filter(part=>typeof part?.text==='string'&&part.text.trim())
    .map(part=>part.text).join('\n');
}
async function rolloutMessages(file){
  const messages=[];
  const stream=fs.createReadStream(file,{encoding:'utf8'});
  const lines=readline.createInterface({input:stream,crlfDelay:Infinity});
  let ordinal=0,turnId=null;
  try{
    for await(const line of lines){
      if(!line.trim())continue;
      ordinal+=1;
      let row;
      try{row=JSON.parse(line);}catch{continue;}
      const payload=row?.payload;
      if(row?.type==='session_meta')turnId=null;
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
  }
  return messages;
}
function validThreadId(value){
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
async function readThreadTranscript(codexHome,threadId){
  if(!validThreadId(threadId))throw new Error('invalid-thread');
  const row=readThreadRow(codexHome,threadId);
  const history=historyMessages(codexHome,threadId);
  if(history.length)return {messages:history,source:'history',thread:row||null};
  if(typeof row?.rollout_path==='string'&&row.rollout_path){
    const messages=await rolloutMessages(row.rollout_path);
    if(messages.length)return {messages,source:'rollout',thread:row};
  }
  return {messages:[],source:'none',thread:row||null};
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
    return `${heading}【${label}】\n${String(text).trim()}`;
  }).join('\n\n');
}
function forwardBoundary(text,index){
  const target=Math.max(0,Math.min(text.length,index));
  const paragraph=text.indexOf('\n\n',target);
  if(paragraph>=0&&paragraph-target<4000)return paragraph+2;
  const line=text.indexOf('\n',target);
  if(line>=0&&line-target<2000)return line+1;
  return target;
}
function backwardBoundary(text,index){
  const target=Math.max(0,Math.min(text.length,index));
  const paragraph=text.lastIndexOf('\n\n',target);
  if(paragraph>=0&&target-paragraph<4000)return paragraph+2;
  const line=text.lastIndexOf('\n',target);
  if(line>=0&&target-line<2000)return line+1;
  return target;
}
function chunkText(text,size){
  const chunks=[];
  let offset=0;
  while(offset<text.length){
    let end=forwardBoundary(text,offset+size);
    if(end<=offset)end=Math.min(text.length,offset+size);
    chunks.push(text.slice(offset,end));
    offset=end;
  }
  return chunks.filter(chunk=>chunk.trim());
}
function splitTranscript(text,{fullBudget=70000,headBudget=25000,tailBudget=25000,chunkSize=40000}={}){
  if(text.length<=fullBudget)return {mode:'full',full:text,originalChars:text.length};
  const headEnd=forwardBoundary(text,headBudget);
  let tailStart=backwardBoundary(text,text.length-tailBudget);
  if(tailStart<headEnd)tailStart=headEnd;
  return {
    mode:'compressed',
    head:text.slice(0,headEnd),
    middleChunks:chunkText(text.slice(headEnd,tailStart),chunkSize),
    tail:text.slice(tailStart),
    originalChars:text.length
  };
}
module.exports={readThreadTranscript,readThreadRow,formatTranscript,splitTranscript,chunkText,
  contentText,responseText,isInjectedUserPart,validThreadId,databases};
