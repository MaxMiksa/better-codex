const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const net=require('node:net'),{spawn,spawnSync}=require('node:child_process'),{setTimeout:sleep}=require('node:timers/promises');
const {invoke,checked,executable}=require('../../src/platform/windows/native.cjs');
const {inspectPreview,replacePreview}=require('../../src/features/workspace-tree/host/windows-shell.cjs');
const runtime=process.argv[2];fs.mkdirSync(runtime,{recursive:true});
const call=(verb,args,options)=>invoke(verb,args,options);
const server=()=>new Promise((resolve,reject)=>{
  const listener=net.createServer();listener.once('error',reject);
  listener.listen(0,'127.0.0.1',()=>resolve(listener));
});
test('strict UTF-8 JSON with no logs or argument echo',()=>{
  const {stdout,stderr,status}=spawnSync(executable,['not-a-command','测试隐私'],{encoding:'utf8',windowsHide:true});
  assert.equal(status,1);assert.equal(stderr,'');assert.ok(!stdout.startsWith('\uFEFF')&&!stdout.includes('测试隐私'));
  assert.equal(JSON.parse(stdout).status,'invalid-arguments');
});
test('loopback binding has executable, current session and exact creation identity',async()=>{
  const listener=await server();
  try{
    const {listeners}=await checked('port-listeners',['--port',String(listener.address().port)]);
    assert.equal(listeners.length,1);
    const [row]=listeners;
    assert.equal(row.executable.toLowerCase(),process.execPath.toLowerCase());
    assert.equal(row.pid,process.pid);assert.equal(row.address,'127.0.0.1');assert.equal(row.loopback,true);
    assert.equal(row.currentSession,true);assert.ok(BigInt(row.created)>116444736000000000n);
    for(const created of [row.created,String(BigInt(row.created)-1n)]){
      const {alive}=await checked('process-alive',['--pid',String(row.pid),'--created',created]);
      assert.equal(alive,created===row.created);
    }
  }finally{await new Promise(resolve=>listener.close(resolve));}
});
test('COM writes and reopens Unicode shortcut with AppUserModelID, without activating it',async()=>{
  const dir=fs.mkdtempSync(path.join(runtime,'shortcut-'));
  const file=path.join(dir,'测试入口.lnk'),args='"'+path.join(dir,'脚本.vbs')+'"';
  const expected={target:process.execPath,arguments:args,workingDirectory:dir,icon:process.execPath,iconIndex:0,description:'隔离测试',appId:'BetterCodex.IsolatedFixture'};
  const install=await checked('shortcut-install',['--input-stdin'],{input:{...expected,path:file,iconIndex:'0'}});
  assert.deepEqual(install.shortcut,expected);
  const receipt=await checked('shortcut-inspect',['--path',file]);assert.deepEqual(receipt.shortcut,expected);
});
test('preview metadata and version-checked replacement do not open the document',async()=>{
  const dir=fs.mkdtempSync(path.join(runtime,'preview-'));
  const file=path.join(dir,'测试.txt'),staged=path.join(dir,'staged.tmp');
  fs.writeFileSync(file,'before');fs.writeFileSync(staged,'after');
  assert.deepEqual(await inspectPreview(file),{ok:true,cloudOnly:false,size:6});
  const version=fs.statSync(file,{bigint:true});
  assert.equal(await replacePreview(file,staged,{...version,mtimeNs:version.mtimeNs-100n}),false);
  assert.equal(fs.readFileSync(file,'utf8'),'before');
  assert.equal(await replacePreview(file,staged,version),true);
  assert.equal(fs.readFileSync(file,'utf8'),'after');
  const response=await call('shell-action',['--input-stdin'],{input:{verb:'quicklook',path:file,executable:process.execPath}});
  assert.equal(response.ok,false);assert.equal(response.status,'invalid-arguments');
});
test('Restart Manager only closes the exact off-screen fixture when it accepts',async()=>{
  const csc=path.join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),fixture=path.join(runtime,'ExitFixture.exe');
  const built=spawnSync(csc,['/nologo','/target:winexe','/platform:x64','/out:'+fixture,
    path.join(__dirname,'NativeExitFixture.cs')],{encoding:'utf8',windowsHide:true});
  assert.equal(built.status,0,built.stdout+built.stderr);
  for(const mode of ['accept','veto']){
    const receipt=path.join(runtime,mode+'.txt'),child=spawn(fixture,[mode,receipt],{stdio:'ignore'});
    const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
    try{
      for(let i=0;i<100&&!fs.existsSync(receipt);i++)await sleep(40);
      assert.equal(fs.readFileSync(receipt,'utf8'),'0,0');
      // The fixture is our child; its creation time can be read directly from the kernel.
      const shell=path.join(process.env.WINDIR,'System32/WindowsPowerShell/v1.0/powershell.exe');
      const time=spawnSync(shell,['-NoProfile','-NonInteractive','-Command',
        '(Get-Process -Id '+child.pid+').StartTime.ToUniversalTime().ToFileTimeUtc().ToString()'],{encoding:'utf8',windowsHide:true});
      const created=time.stdout.trim(),args=['--pid',String(child.pid),'--created'];
      assert.ok(/^\d+$/.test(created));
      const wrong=await call('graceful-close',[...args,String(BigInt(created)-1n)]);
      assert.equal(wrong.status,'identity-mismatch');assert.equal(child.exitCode,null);
      const result=await call('graceful-close',[...args,created,'--timeout-ms','8000'],{timeout:15000});
      const [queries,ends]=fs.readFileSync(receipt,'utf8').split(',').map(Number);
      assert.ok(queries>=1,mode+': '+JSON.stringify(result));
      if(mode==='accept'){assert.equal(result.status,'closed');assert.equal(await closed,0);assert.equal(ends,1);}
      else{
        assert.ok(['refused','timed-out'].includes(result.status),result.status);
        assert.equal(result.ok,false);assert.equal(ends,0);assert.equal(child.exitCode,null);
      }
    }finally{if(child.exitCode===null&&child.signalCode===null){child.kill();await closed;}}
  }
});
