// Small ZIP32 subset for release artifacts: UTF-8, store/deflate, CRC32.
import {crc32,deflateRawSync,inflateRawSync} from 'node:zlib';

const LOCAL=0x04034b50,CENTRAL=0x02014b50,END=0x06054b50,UTF8=0x800;
const LIMIT=512*1024*1024;
function validName(name){
  return name.length>0&&!/[\x00-\x1f\\:<>"|?*]/.test(name)&&name.split('/').every(
    part=>part&&!/^[. ]+$|[. ]$|^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
}
export function writeZip(entries){
  const locals=[],directory=[],seen=new Set();
  let offset=0;
  for(const [name,bytes] of entries){
    const key=name.toLowerCase();
    if(!validName(name)||seen.has(key))throw Error('Unsafe ZIP entry');
    seen.add(key);
    const filename=Buffer.from(name),encoded=deflateRawSync(bytes,{level:9});
    const method=encoded.length<bytes.length?8:0,compressed=method?encoded:bytes,crc=crc32(bytes);
    const local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(LOCAL);central.writeUInt32LE(CENTRAL);
    local.writeUInt16LE(20,4);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    local.writeUInt16LE(UTF8,6);local.writeUInt16LE(method,8);local.writeUInt16LE(33,12);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);
    local.writeUInt16LE(filename.length,26);
    local.copy(central,8,6,28);
    central.writeUInt32LE(offset,42);
    offset+=local.length+filename.length+compressed.length;
    locals.push(local,filename,compressed);directory.push(central,filename);
    if(offset>LIMIT||seen.size>65534)throw Error('ZIP32 release limit exceeded');
  }
  const end=Buffer.alloc(22);
  end.writeUInt32LE(END);end.writeUInt16LE(seen.size,8);end.writeUInt16LE(seen.size,10);
  end.writeUInt32LE(directory.reduce((n,b)=>n+b.length,0),12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,...directory,end]);
}
export function readZip(blob){
  const u16=i=>blob.readUInt16LE(i),u32=i=>blob.readUInt32LE(i);
  if(blob.length<22||blob.length>LIMIT)throw Error('Invalid ZIP size');
  let end=blob.length-22;
  while(end>=Math.max(0,blob.length-65557)&&!(u32(end)===END&&end+22+u16(end+20)===blob.length))end--;
  if(end<Math.max(0,blob.length-65557)||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))
    throw Error('Invalid ZIP end record');
  const start=u32(end+16);
  if(start+u32(end+12)!==end)throw Error('Invalid ZIP directory range');
  const seen=new Set(),files=new Map(),ranges=[];
  let offset=start,total=0;
  for(let i=0;i<u16(end+10);i++){
    if(offset+46>end||u32(offset)!==CENTRAL)throw Error('Invalid ZIP directory entry');
    const flags=u16(offset+8),method=u16(offset+10),crc=u32(offset+16),compressed=u32(offset+20),size=u32(offset+24);
    const length=u16(offset+28),next=offset+46+length+u16(offset+30)+u16(offset+32),local=u32(offset+42);
    const encoded=blob.subarray(offset+46,offset+46+length);
    const name=new TextDecoder('utf-8',{fatal:true}).decode(encoded),dir=name.endsWith('/');
    const key=(dir?name.slice(0,-1):name).toLowerCase();
    const mode=u32(offset+38)>>>16&0xf000;
    if(next>end||!validName(dir?name.slice(0,-1):name)||seen.has(key)||mode===0xa000||
      flags&~(UTF8|8|6)||![0,8].includes(method)||u16(offset+34)||local+30>start||u32(local)!==LOCAL||
      u16(local+6)!==flags||u16(local+8)!==method||u16(local+26)!==length||
      !encoded.equals(blob.subarray(local+30,local+30+length)))throw Error('Unsafe ZIP entry');
    seen.add(key);offset=next;
    const data=local+30+length+u16(local+28);
    if(data+compressed>start||size>128*1024*1024||(total+=size)>LIMIT||
      (!(flags&8)&&(u32(local+14)!==crc||u32(local+18)!==compressed||u32(local+22)!==size)))throw Error('Invalid ZIP payload');
    ranges.push([local,data+compressed]);
    if(dir){if(size!==0)throw Error('Invalid ZIP directory');continue;}
    files.set(name,()=>{
      const encoded=blob.subarray(data,data+compressed);
      const bytes=method===0?encoded:inflateRawSync(encoded,{maxOutputLength:Math.max(1,size)});
      if(bytes.length!==size||crc32(bytes)!==crc)throw Error('ZIP entry integrity failure: '+name);
      return bytes;
    });
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  if(offset!==end||ranges.some(([start],i)=>i>0&&start<ranges[i-1][1]))throw Error('Invalid ZIP entry range');
  return files;
}
