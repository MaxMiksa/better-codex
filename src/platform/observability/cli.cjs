const path=require('node:path'),{parseArgs}=require('node:util');
const {event}=require('./events.cjs'),{Store}=require('./store.cjs');

async function main(args=process.argv.slice(2),input=process.stdin){
  try{
    const {values,positionals}=parseArgs({args,allowPositionals:true,options:Object.fromEntries(
      ['runtime','since','until','kind','source','correlation-id','limit'].map(name=>[name,{type:'string'}]))});
    const [command]=positionals;
    if(positionals.length!==1||!['append','query'].includes(command))throw Error();
    const {runtime=path.resolve(__dirname,'../../../.runtime/state'),limit='100',...filters}=values;
    const store=new Store(runtime);
    if(command==='query'){
      if(!/^\d+$/.test(limit))throw Error();
      const {'correlation-id':correlation_id,...rest}=filters;
      return store.query({...rest,correlation_id,limit:Number(limit)});
    }
    if(Object.keys(filters).length||Object.hasOwn(values,'limit'))throw Error();
    const chunks=[];let size=0;
    for await(const buffer of input){
      const chunk=Buffer.from(buffer);size+=chunk.length;
      if(size>65536)throw Error();
      chunks.push(chunk);
    }
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
    const fields=['kind','status','source','correlation_id','instance','occurred_at','context'];
    if(!value||typeof value!=='object'||Array.isArray(value)||
      (!Object.hasOwn(value,'event_id')&&Object.keys(value).some(key=>!fields.includes(key))))throw Error();
    const record=Object.hasOwn(value,'event_id')?value:event(...fields.map(key=>value[key]));
    return {schema_version:1,...store.append(record)};
  }catch{return {schema_version:1,ok:false,error_category:'invalid_arguments'};}
}
if(require.main===module)main().then(result=>{
  process.stdout.write(JSON.stringify(result)+'\n');
  process.exitCode=result.ok?0:result.error_category==='invalid_arguments'?2:1;
});
module.exports={main};
