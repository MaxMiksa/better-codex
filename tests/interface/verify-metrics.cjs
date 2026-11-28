// Same timing and magpie boundary matrix as the retained Python oracle.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),os=require('node:os');
const base='../../src/features/statistics/host/collector/';
const {Measurements,SessionTail,ThreadRepository,requestRate}=require(base+'metrics.cjs');
const {SessionCatalog,HistoryCache}=require(base+'history.cjs');
const {gatewaySample,MagpieMeasurements,TransportError,HttpStatus}=require(base+'magpie.cjs');
const {createSampler}=require('../../src/runtime/collector-session.cjs');
const {DatabaseSync}=require('node:sqlite');
const E=1792800000000,iso=ms=>new Date(E+ms).toISOString();
const rowEvent=(ms,type,payload)=>({type,timestamp:iso(ms),payload});
const feed=(m,ms,type,payload)=>m.feed(rowEvent(ms,type,payload));
const start=(m,ms=0,turn_id='turn')=>feed(m,ms,'event_msg',{type:'task_started',turn_id});
const end=(m,ms)=>feed(m,ms,'event_msg',{type:'task_complete'});
const tokens={input_tokens:200,cached_input_tokens:180,output_tokens:100,reasoning_output_tokens:50};
const usage=(m,ms,response_id='response',output_tokens=100,turn_id='turn')=>
  feed(m,ms,'token_usage_record',{response_id,turn_id,usage:{...tokens,output_tokens,reasoning_output_tokens:Math.floor(output_tokens/2)}});
const tool=(m,ms,call_id='call',out=false,custom=false)=>
  feed(m,ms,'response_item',{type:(custom?'custom_tool_call':'function_call')+(out?'_output':''),call_id});
const reasoning=(m,ms)=>feed(m,ms,'response_item',{type:'reasoning'});
const steer=(m,ms)=>feed(m,ms,'response_item',{type:'message',role:'user'});
const legacy=(m,ms,total)=>feed(m,ms,'event_msg',{type:'token_count',info:{last_token_usage:tokens,total_token_usage:{output_tokens:total}}});
const measurements=()=>{const m=new Measurements();start(m);return m;};
test('sampling can pause local math without losing usage, boundaries or reset mode',()=>{
  const m=new Measurements(null,false);start(m);usage(m,12000);
  assert.deepEqual([m.last.rate,m.last.duration_ms,m.last.cache_percent,m.snapshot().turn_first_response_id],[null,12000,90,'response']);
  const tail=new SessionTail('synthetic',null,undefined,false);tail.reset();assert.equal(tail.measurements.calculateSpeed,false);
});
test('full response, not summary item duration',()=>{
  const m=measurements();tool(m,100);usage(m,200,'previous');tool(m,20651,'call',true);reasoning(m,35188);
  tool(m,36924,'next');usage(m,37462,'response',532);
  assert.equal(m.last.rate,532000/16811);assert.equal(m.last.basis,'request');
});
test('parallel standard and custom tools excluded until last result',()=>{
  for(const custom of [false,true]){
    const m=measurements();tool(m,9000,'a',false,custom);tool(m,9500,'b',false,custom);usage(m,10000);
    tool(m,30000,'a',true,custom);tool(m,50000,'b',true,custom);reasoning(m,59000);usage(m,60000,'next');
    assert.equal(m.last.rate,10);
  }
});
test('steering leaves in-flight response timing alone',()=>{
  const m=measurements();reasoning(m,5000);steer(m,9900);usage(m,10000);assert.equal(m.last.rate,10);
});
test('unknown and duplicate tool results cannot shorten response',()=>{
  const m=measurements();tool(m,9000);usage(m,10000,'previous');tool(m,20000,'call',true);reasoning(m,21000);
  tool(m,29900,'call',true);tool(m,29950,'unknown',true);usage(m,30000);assert.equal(m.last.rate,10);
});
test('tool output arriving before usage is not a response start',()=>{
  const m=measurements();tool(m,9000);tool(m,9900,'call',true);usage(m,10000);assert.equal(m.last.rate,null);
  reasoning(m,11000);usage(m,12000,'next');assert.equal(m.last.rate,null);
});
test('mid-response tail has usage but no invented rate',()=>{
  const m=new Measurements();reasoning(m,9900);usage(m,10000);assert.equal(m.last.rate,null);assert.equal(m.last.cache_percent,90);
});
test('restored legacy totals are not new usage',()=>{
  const m=measurements();legacy(m,2000,8227);assert.equal(m.last,null);assert.equal(m.turnOutput,0);
});
test('legacy growth retains cache but not speed; first canonical identity is still recorded',()=>{
  const m=measurements();legacy(m,1000,1000);legacy(m,2000,1100);
  assert.equal(m.last.rate,null);assert.equal(m.last.cache_percent,90);
  usage(m,3000,'first');assert.equal(m.snapshot().turn_first_response_id,'first');
});
test('modern usage wins over legacy mirrors and cumulative totals',()=>{
  const m=measurements();usage(m,10000);const sample=m.last;
  legacy(m,10001,1000);legacy(m,10002,1100);legacy(m,10003,1100);
  assert.equal(m.last,sample);assert.equal(m.sampleCount,1);
});
test('response dedup keeps next boundary',()=>{
  const m=measurements();usage(m,10000);usage(m,19900);usage(m,20000,'next');assert.equal(m.last.rate,10);assert.equal(m.sampleCount,2);
});
test('wrong-turn and late terminal response ignored',()=>{
  const m=measurements();usage(m,10000);const sample=m.last;
  usage(m,11000,'old',1000,'old-turn');end(m,12000);usage(m,13000,'late');
  assert.equal(m.last,sample);assert.equal(m.stage,'idle');
});
test('new turn excludes idle gap',()=>{
  const m=measurements();usage(m,10000);end(m,11000);start(m,1000000);usage(m,1010000,'next');assert.equal(m.last.rate,10);
});
test('resumed rollout clears old timing',()=>{
  const m=measurements();usage(m,10000);feed(m,20000,'session_meta',{});reasoning(m,29900);usage(m,30000,'resumed');
  assert.equal(m.last.rate,null);
});
test('compaction completion establishes request start',()=>{
  const m=measurements();tool(m,9000);feed(m,50000,'compacted',{});reasoning(m,59000);usage(m,60000);assert.equal(m.last.rate,10);
});
test('no arbitrary cap or reasoning double counting',()=>{
  const m=measurements();usage(m,10000,'response',3000);assert.equal(m.last.rate,300);assert.equal(m.last.output_tokens,3000);
});
test('invalid durations and exact 50 ms boundary',()=>{
  for(const ms of [-100,0,49,50]){
    const m=measurements();usage(m,ms);assert.equal(m.last.rate,ms===50?2000:null);
  }
});
test('turn first response identity survives later responses and steering',()=>{
  const m=measurements();usage(m,10000,'first');usage(m,12000,'next');steer(m,13000);
  assert.equal(m.snapshot().turn_first_response_id,'first');start(m,14000,'new');assert.equal(m.snapshot().turn_first_response_id,null);
});
test('idle steering starts new scope; missing boundaries do not invent first response',()=>{
  const m=measurements();usage(m,10000);end(m,11000);steer(m,12000);
  assert.equal(m.snapshot().turn_first_response_id,null);assert.equal(m.snapshot().turn_started_at_ms,E+12000);
  const partial=new Measurements();usage(partial,10000);assert.equal(partial.snapshot().turn_first_response_id,null);
});
test('missing first canonical ID is not replaced with a later ID',()=>{
  const m=measurements();usage(m,10000,null);usage(m,12000,'later');assert.equal(m.snapshot().turn_first_response_id,null);
});
function gatewayFixture(sequence=[],{now=E+15000}={}){
  const m=new Measurements('group/selected');start(m);usage(m,12000);
  const native=m.snapshot(),source={state:'ok',path:'synthetic-rollout'};
  const row={agent:'codex',session:'thread',native_session:'thread',response_id:'response',status:200,t:iso(1000),ms:10000,
    in:20,cache_read:180,cache_write:0,out:200,reasoning:80,sent_ms:2000,ttft_ms:3000,native_speed:25};
  const following={...row,response_id:'next',ttft_ms:7000,out:400,native_speed:50};
  let clock=10000;
  const gateway=new MagpieMeasurements(undefined,{clock:()=>clock,now:()=>now});
  const calls=[];
  gateway.read=async(id,limit)=>{
    calls.push([id,limit]);const value=sequence.length>1?sequence.shift():sequence[0];
    if(value instanceof Error)throw value;
    return value??[row];
  };
  gateway.nativeSpeed=async(id,row)=>row.native_speed;
  const get=(view=native,id='thread',force=true)=>gateway.select(id,view,source,force);
  return {native,source,row,following,gateway,calls,advance:ms=>{clock+=ms;},
    next:{...native,last:{...native.last,response_id:'next'}},get,sample:change=>gatewaySample({...row,...change},'thread',native,now)};
}
test('routed models use the same cache, usage, response identity and speed contract',()=>{
  const {sample}=gatewayFixture();
  for(const [provider,model] of [['codex','fixture-model-a'],['workbuddy','fixture-model-b'],['workbuddy-ai','fixture-model-c']]){
    const s=sample({provider,model,req:provider+'/'+model,served:model});
    assert.deepEqual([s.rate,s.ttft_ms,s.cache_percent,s.output_tokens,s.model,s.turn_id,s.measured_at_ms],[25,3000,90,200,'group/selected','turn',E+11000]);
  }
});
test('cache-write inclusion and unknown zero cache',()=>{
  const {sample}=gatewayFixture();
  assert.equal(sample({cache_write:100}).cache_percent,60);
  assert.equal(sample({cache_unknown:true}).cache_percent,null);
  assert.equal(sample({provider:'kiro',cache_read:0}).cache_percent,null);
  for(const name of ['in','cache_read','cache_write'])assert.equal(sample({[name]:null}),null);
});
test('magpie native rate is not rederived from duration or sent/TTFT',()=>{
  const {sample}=gatewayFixture([],{now:E+50000});
  const s=sample({ms:38550,sent_ms:2520,ttft_ms:11244,out:1621,reasoning:730,native_speed:123.4});
  assert.deepEqual([s.ttft_ms,s.rate,s.output_tokens],[11244,123.4,1621]);
});
test('native rate and cache ignore sent_ms',()=>{
  const {sample}=gatewayFixture();
  for(const sent_ms of [null,0,-1,true,'2000',10000,10001,9951])
    assert.deepEqual([sample({sent_ms}).rate,sample({sent_ms}).cache_percent,sample({sent_ms}).ttft_ms],[25,90,3000]);
});
test('TTFT may be unknown independently of native speed',()=>{
  const {sample}=gatewayFixture();
  for(const ttft_ms of [null,0,-1,true,'3000',10001])
    assert.deepEqual([sample({ttft_ms}).ttft_ms,sample({ttft_ms}).rate],[null,25]);
});
test('only exact native response and chat identity join',()=>{
  const {sample,row,native}=gatewayFixture();
  assert.ok(sample({session:'gateway-session'}));
  for(const changes of [{native_session:'other'},{response_id:'other'},{agent:'claude'},{response_id:null}])
    assert.equal(sample(changes),null);
  assert.equal(gatewaySample(row,'thread',{...native,last:{...native.last,response_id:null}},E+15000),null);
});
test('background, subagent, remotely reported and unsuccessful rows are excluded',()=>{
  const {sample}=gatewayFixture();
  for(const changes of [{kind:'thread_title'},{kind:'composer_predictions'},{kind:'guardian'},{kind:'collab_spawn'},
    {subagent:'child'},{parent_agent:'parent'},{source:'log'},{source:'reported'},{computer:'remote'},
    {via:'remote'},{status:500},{handed_on:true},{rejected:true},{err:'error'},{err_type:'server'}])assert.equal(sample(changes),null);
});
test('invalid, future, exact-TTL, and wrong-turn magpie samples are excluded',()=>{
  const {sample,row,native}=gatewayFixture();
  for(const changes of [{ms:null},{ms:0},{ms:49},{ms:true},{out:-1},{out:'200'},{ms:20000},{t:'bad'},{t:iso(-1000)}])
    assert.equal(sample(changes),null);
  assert.ok(gatewaySample(row,'thread',native,E+910999));
  assert.equal(gatewaySample(row,'thread',native,E+911000),null);
  assert.equal(gatewaySample(row,'thread',{...native,turn_id:'next'},E+15000),null);
});
test('magpie priority; native sample remains unmodified during transient failure and recovery',async()=>{
  const {row}=gatewayFixture();
  const {get,native,source}=gatewayFixture([[row],new TransportError(),[row]]);
  const [primary,primarySource]=await get(),[fallback,fallbackSource]=await get(),[restored]=await get();
  assert.equal(primary.last.source,'magpie');assert.deepEqual(primarySource,{state:'ok',provider:'magpie'});
  assert.equal(fallback.last,native.last);assert.equal(fallback.turn_ttft_ms,3000);assert.equal(fallbackSource,source);
  assert.equal(restored.last.rate,25);assert.equal(native.last.source,'response');
});
test('poll budget, chat switching, and ambiguous response IDs',async()=>{
  const {get,native,row,gateway,calls}=gatewayFixture();
  await get(native,'thread',false);await get(native,'thread',false);assert.equal(calls.length,1);
  const [other]=await get(native,'other',false);assert.equal(calls.length,2);assert.equal(other.last,native.last);assert.equal(other.turn_speed,null);
  gateway.read=async()=>[row,row];
  const [ambiguous]=await get();assert.equal(ambiguous.last,native.last);assert.equal(ambiguous.turn_ttft_ms,3000);
});
test('TTFT freezes on first response while later usage and speed update',async()=>{
  const {row,following}=gatewayFixture();
  const {get,next}=gatewayFixture([[row],[following],new TransportError()]);
  const [first]=await get(),[later]=await get(next),[fallback]=await get(next);
  assert.equal(first.turn_ttft_ms,3000);assert.deepEqual([later.turn_ttft_ms,later.last.ttft_ms,later.last.rate],[3000,7000,50]);
  assert.equal(fallback.turn_ttft_ms,3000);
});
test('new turn with no first response does not reuse old TTFT',async()=>{
  const {get,native}=gatewayFixture();
  assert.equal((await get())[0].turn_ttft_ms,3000);
  const [next]=await get({...native,turn_id:'new',turn_started_at_ms:E+13000,turn_first_response_id:null});
  assert.equal(next.turn_ttft_ms,undefined);
});
test('first response lookup expands at most once and never borrows later TTFT',async()=>{
  const {following}=gatewayFixture();
  const {get,next,calls}=gatewayFixture([[following]]);
  const [sample]=await get(next);assert.equal(sample.turn_ttft_ms,undefined);assert.equal(sample.last.ttft_ms,7000);
  await get(next);assert.deepEqual(calls,[['thread',undefined],['thread',500],['thread',undefined]]);
});
test('old first response can still fix TTFT in a long-running turn',async()=>{
  const {row,following}=gatewayFixture();
  const latest={...following,t:iso(990000)};
  const {get,next,calls}=gatewayFixture([[latest],[row,latest]],{now:E+1000000});
  const [s]=await get(next);assert.deepEqual([s.turn_ttft_ms,s.last.ttft_ms],[3000,7000]);assert.equal(calls[1][1],500);
});
test('turn caches stay bounded, isolated per chat and immutable through returned samples',async()=>{
  const {get,native,row,gateway}=gatewayFixture();
  const [first]=await get();first.turn_speed.rate=999;assert.equal((await get())[0].turn_speed.rate,25);
  for(let i=0;i<10;i++){
    const id='thread-'+i;
    gateway.read=async()=>[{...row,session:id,native_session:id,ttft_ms:3000+i}];
    assert.equal((await get(native,id))[0].turn_ttft_ms,3000+i);
  }
  assert.equal(gateway.turnTtfts.size,8);assert.equal(gateway.turnSpeeds.size,8);
});
test('loopback-only GET, HTTP errors/redirects, timeout, size cap and privacy allowlist',async()=>{
  const work=process.argv[2];await fs.mkdir(work,{recursive:true});
  const dir=await fs.mkdtemp(path.join(work,'gateway-')),file=path.join(dir,'settings.json');
  const {row,native,source}=gatewayFixture();
  let mode='ok',request;
  const server=http.createServer((req,res)=>{
    request={url:req.url,method:req.method,headers:req.headers};
    if(mode==='redirect'){res.writeHead(302,{Location:'/unexpected'});return res.end();}
    if(mode==='stall'){res.write(' ');return;}
    res.end(mode==='large'?' '.repeat(2*1024*1024+1):mode==='invalid'?'{"rows":{}}':
      JSON.stringify({rows:[{...row,providerAccount:'private',body:'private'}]}));
  });
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const port=server.address().port;
    await fs.writeFile(file,JSON.stringify({port}));
    assert.equal(new MagpieMeasurements().settings,path.join(process.env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config'),'magpie','settings.json'));
    const gateway=new MagpieMeasurements(file,{now:()=>E+15000});
    const [data]=await gateway.read('thread');
    assert.equal(data.ttft_ms,3000);
    for(const key of ['providerAccount','body','sent_ms','native_speed'])assert.ok(!Object.hasOwn(data,key));
    const url=new URL(request.url,'http://127.0.0.1');
    assert.equal(url.pathname,'/v1/magpie/usage/requests');
    assert.deepEqual([request.method,request.headers.host,request.headers.authorization],['GET','127.0.0.1:'+port,undefined]);
    assert.deepEqual(Object.fromEntries(url.searchParams),{agent:'codex',via:'through',period:'all',q:'thread',limit:'20'});
    mode='redirect';await assert.rejects(gateway.read('thread'),HttpStatus);assert.equal(request.url,url.pathname+url.search);
    mode='stall';await assert.rejects(gateway.read('thread'),TransportError);
    mode='large';await assert.rejects(gateway.read('thread'),TypeError);
    mode='invalid';await assert.rejects(gateway.read('thread'),TypeError);
    for(const [config,error] of [['{"port":0}',TypeError],['{"port":true}',TypeError],['[]',TypeError],['bad',SyntaxError]]){
      await fs.writeFile(file,config);
      await assert.rejects(gateway.read('thread'),error);
      const [s]=await gateway.select('thread',native,source,true);assert.equal(s.last,native.last);assert.equal(s.turn_speed,null);
    }
    await fs.unlink(file);await assert.rejects(gateway.read('thread'),TransportError);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('magpie speed holds through missing values and failures, then updates',async()=>{
  const {row,following}=gatewayFixture();
  const {get,next}=gatewayFixture([[row],[{...following,native_speed:null}],new TransportError(),[{...following,native_speed:60}]]);
  const [first]=await get(),[missing]=await get(next),[failed]=await get(next),[updated]=await get(next);
  assert.equal(first.turn_speed.rate,25);assert.equal(missing.last.rate,null);assert.equal(missing.turn_speed.response_id,'response');
  assert.equal(failed.turn_speed.rate,25);assert.equal(updated.turn_speed.rate,60);
});
test('retained speed clears for new turns, other chats, or unknown boundaries',async()=>{
  const {get,native}=gatewayFixture();
  assert.equal((await get())[0].turn_speed.rate,25);
  assert.equal((await get(native,'other'))[0].turn_speed,null);
  assert.equal((await get({...native,turn_id:'new',turn_started_at_ms:E+15000}))[0].turn_speed,null);
  assert.equal((await get({...native,turn_started_at_ms:null}))[0].turn_speed,null);
});
test('three transport failures, hard 30 s backoff, and source switching only at turn boundaries',async()=>{
  const {row}=gatewayFixture();
  const err=new TransportError(),{get,native,source,gateway,calls,advance}=gatewayFixture([[row],err,err,err,err,[row],[row]]);
  await get();
  for(let i=0;i<3;i++){
    assert.equal((await get())[0].speed_mode,'magpie');assert.equal(gateway.available,i<2);
  }
  const local={...native,turn_id:'local',last:{...native.last,turn_id:'local'}};
  const [s,from]=await get(local);assert.equal(from,source);
  assert.equal(s.speed_mode,'local');assert.equal(s.turn_speed.rate_basis,'response-request-average-v2');
  assert.equal(s.turn_speed.rate,requestRate(native.last));
  advance(29999);await get(local);await get(local,'other');assert.equal(calls.length,4);
  advance(1);assert.equal((await get(local))[0].speed_mode,'local');assert.equal(gateway.available,false);
  advance(30000);const [persisted]=await get(local);assert.equal(gateway.available,true);assert.equal(persisted.speed_mode,'local');
  assert.equal((await get({...local,turn_id:'restored',last:{...local.last,turn_id:'restored'}}))[0].speed_mode,'magpie');
});
test('HTTP responses and unusable payloads reset transport failure streak',async()=>{
  for(const error of [new TypeError(),new HttpStatus()]){
    const {get,native,gateway}=gatewayFixture([new TransportError(),new TransportError(),error,error]);
    for(let i=0;i<5;i++)assert.equal((await get({...native,turn_id:String(i)}))[0].speed_mode,'magpie');
    assert.notEqual(gateway.available,false);assert.equal(gateway.connectionFailures,0);
  }
});
function routeFixture(){
  let clock=10000;
  const gateway=new MagpieMeasurements(undefined,{clock:()=>clock});
  const row={route_id:12,response_id:'response',native_session:'thread'};
  const response={calls:1,decode_n:1,decode_out:240,decode_ms:2000,rows:[row]};
  return {gateway,row,response,advance:()=>{clock+=3000;}};
}
test('native route speed is exact, query-scoped and cached only for that response',async()=>{
  const {gateway,row,response}=routeFixture(),calls=[];
  gateway.fetch=async(...args)=>{calls.push(args);return response;};
  assert.equal(await gateway.nativeSpeed('thread',row),120);
  assert.equal(await gateway.nativeSpeed('thread',row),120);
  assert.deepEqual(calls,[['thread',20,12]]);
});
test('missing rate or ambiguous route is not recomputed locally',async()=>{
  const {row,response}=routeFixture();
  for(const changes of [{decode_n:0},{decode_ms:null},{decode_out:null},{calls:2},{calls:true},{decode_n:2},{rows:[]},
    {rows:[row,{...row,response_id:'other'}]},{rows:[{...row,route_id:13}]},{rows:[{...row,response_id:'other'}]},
    {rows:[{...row,native_session:'other'}]}]){
    const {gateway}=routeFixture();gateway.fetch=async()=>({...response,...changes});
    assert.equal(await gateway.nativeSpeed('thread',{...row,out:10000,ms:1}),null);
  }
});
test('route transport failures retry after the short budget without poisoning cache',async()=>{
  const {gateway,row,response,advance}=routeFixture();let calls=0;
  gateway.fetch=async()=>{if(++calls===1)throw new TransportError();return response;};
  assert.equal(await gateway.nativeSpeed('thread',row),null);assert.equal(await gateway.nativeSpeed('thread',row),null);
  assert.equal(calls,1);advance();assert.equal(await gateway.nativeSpeed('thread',row),120);assert.equal(calls,2);
});
test('missing native route never performs a route lookup',async()=>{
  const {gateway}=routeFixture();gateway.fetch=async()=>assert.fail('unexpected request');
  assert.equal(await gateway.nativeSpeed('thread',{response_id:'response'}),null);
});
test('real catalog, live tail, range cache and magpie publication on synthetic logs',async()=>{
  const work=process.argv[2],home=await fs.mkdtemp(path.join(work,'rollouts-'));
  const dir=path.join(home,'sessions');await fs.mkdir(dir);
  const file=path.join(dir,'loaded.jsonl'),serialize=rows=>rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
  const rows=[rowEvent(0,'session_meta',{id:'thread',timestamp:iso(0),model:'group/selected'}),
    rowEvent(0,'event_msg',{type:'task_started',turn_id:'turn'}),rowEvent(10,'event_msg',{type:'user_message',message:'fixture 中文'}),
    rowEvent(20,'response_item',{type:'message',role:'user',content:[{text:'fixture 中文'}]}),
    rowEvent(12000,'token_usage_record',{response_id:'response',turn_id:'turn',usage:tokens})];
  await fs.writeFile(file,serialize(rows));
  const db=new DatabaseSync(path.join(home,'state_9.sqlite'));
  db.exec('CREATE TABLE threads (id TEXT,title TEXT,name TEXT,rollout_path TEXT,model TEXT,updated_at INTEGER)');
  db.prepare('INSERT INTO threads VALUES (?,?,?,?,?,?)').run('thread','outdated','preferred',file,'group/selected',E);db.close();
  await fs.writeFile(path.join(home,'range-result.json'),JSON.stringify({thread_id:'thread',state:'saved'}));
  const catalog=new SessionCatalog(home),{gateway}=gatewayFixture();
  const sample=createSampler({settings:{codexHome:home},runtime:home,catalog,magpie:gateway});
  const out=await sample({thread_id:'thread',title:'preferred',refresh_id:'refresh'},true);
  assert.equal(out.thread_id,'thread');assert.equal(out.repository_state,'ok');
  assert.deepEqual([out.metrics.last.rate,out.metrics.last.ttft_ms,out.metrics.turn_ttft_ms,out.metrics.turn_speed.rate],[25,3000,3000,25]);
  assert.deepEqual(out.source,{state:'ok',provider:'magpie'});
  assert.equal(out.range.state,'saved');assert.equal(out.refresh.state,'ok');assert.equal(out.refresh.sample_at_ms,E+11000);
  const cache=new HistoryCache(),history=await cache.load(catalog,'thread');
  assert.equal(await cache.load(catalog,'thread'),history);
  const matches=history.findMessages('中文');assert.equal(matches.length,1);
  const range=history.calculate({mode:'messages',first_id:matches[0].id,last_id:matches[0].id});
  assert.deepEqual([range.sample_count,range.timing_basis.request,range.cache_percent],[1,1,90]);
  assert.equal(history.calculate({mode:'time',start:iso(12000),end:iso(12000)}).output_tokens,100);
  const tail=new SessionTail(file);await tail.update();
  const incomplete=JSON.stringify(rowEvent(15000,'token_usage_record',{response_id:'next',usage:tokens}));
  const bytes=Buffer.from(incomplete+'\n');await fs.appendFile(file,bytes.subarray(0,bytes.length-4));await tail.update();
  assert.equal(tail.measurements.last.response_id,'response');
  await fs.appendFile(file,bytes.subarray(-4));await tail.update();assert.equal(tail.measurements.last.response_id,'next');
  await fs.writeFile(file,serialize(rows));await tail.update();assert.equal(tail.measurements.last.response_id,'response');
  new DatabaseSync(path.join(home,'state_10.sqlite')).close();
  const repo=new ThreadRepository(home);await repo.refresh();assert.equal(repo.state,'unsupported');assert.equal(repo.rows.size,0);
});
