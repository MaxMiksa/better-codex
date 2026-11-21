const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),limit=256*1024,decoder=new TextDecoder('utf-8',{fatal:true});
const markdown=name=>!name.startsWith('.')&&name.length>3&&name.toLowerCase().endsWith('.md');
const unchanged=(a,b)=>a&&a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;

async function names(directory){
  const entries=(await fs.readdir(directory,{withFileTypes:true})).filter(entry=>entry.isFile()&&markdown(entry.name));
  if(!entries.length||process.platform!=='win32')return entries.map(entry=>entry.name);
  // Node's Dirent does not expose the Windows hidden bit. DIR supplies names only;
  // the fixed command receives an absolute path via the environment, not command text.
  const {stdout}=await run(path.join(process.env.SystemRoot||'C:\\Windows','System32','cmd.exe'),
    ['/d','/u','/v:off','/c','dir /b /a:-d-h "%BETTER_CODEX_PROMPTS_DIRECTORY%\\*.md"'],
    {windowsVerbatimArguments:true,windowsHide:true,timeout:1500,maxBuffer:1024*1024,encoding:'utf16le',
      env:{...process.env,BETTER_CODEX_PROMPTS_DIRECTORY:directory}});
  const visible=new Set(stdout.replace(/^\uFEFF/,'').split(/\r?\n/));
  return entries.filter(entry=>visible.has(entry.name)).map(entry=>entry.name);
}

async function load(file,stat){
  const handle=await fs.open(file,'r');
  try{
    if(!unchanged(await handle.stat({bigint:true}),stat))return null;
    const buffer=Buffer.alloc(Number(stat.size)+1);
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead!==Number(stat.size)||!unchanged(await handle.stat({bigint:true}),stat))return null;
    let body;
    try{body=decoder.decode(buffer.subarray(0,bytesRead));}catch{return {stat,body:null};}
    // A complete frontmatter block must start at byte one (after an optional UTF-8 BOM).
    body=body.replace(/^---[ \t]*\r?\n(?:[^\r\n]*\r?\n)*?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/,'');
    return {stat,body:body.trim()&&!body.includes('\0')?body:null};
  }finally{await handle.close();}
}

function createPromptReader(codexHome){
  const directory=path.resolve(codexHome,'prompts');
  let cache=new Map(),pending=null;
  async function scan(){
    const next=new Map(),catalog=[];
    try{
      for(const name of await names(directory)){
        try{
          const file=path.join(directory,name),stat=await fs.lstat(file,{bigint:true});
          if(!stat.isFile()||stat.size===0n||stat.size>BigInt(limit))continue;
          const before=cache.get(name),entry=unchanged(before?.stat,stat)?before:await load(file,stat);
          if(!entry)continue;
          next.set(name,entry);
          if(entry.body!==null)catalog.push({name:name.slice(0,-3),body:entry.body});
        }catch{} // A bad file never replaces other usable entries.
      }
    }catch{} // Missing/unreadable directory (including no visible Windows files).
    cache=next;
    return catalog;
  }
  return ()=>pending||=scan().finally(()=>{pending=null;});
}
module.exports={createPromptReader};
