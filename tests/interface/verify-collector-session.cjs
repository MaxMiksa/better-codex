// Failure budget and stale-source rejection without starting any process.
const assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createCollector}=require('../../src/interface/host/collector-session.cjs');
const children=[];
const session=createCollector({settings:{python:'fixture',collectorDir:'fixture',codexHome:'fixture'},runtime:'fixture',launch:()=>{
  const child=new EventEmitter();child.pid=children.length+1;child.exitCode=null;child.signalCode=null;
  child.kill=()=>{child.signalCode='SIGTERM';child.emit('exit');return true;};children.push(child);return child;
}});
session.tick(1000);
assert.ok(!session.accepts({collector_pid:1,updated_at_ms:999}));
assert.ok(session.accepts({collector_pid:1,updated_at_ms:1000}));
children[0].exitCode=1;session.tick(1100);
assert.ok(!session.accepts({collector_pid:1,updated_at_ms:2000}));
session.tick(2100);
assert.ok(!session.accepts({collector_pid:1,updated_at_ms:2100}));
assert.ok(session.accepts({collector_pid:2,updated_at_ms:2100}));
children[0].emit('error',new Error('late old-child error'));
assert.ok(session.accepts({collector_pid:2,updated_at_ms:2100}));
children[1].exitCode=1;session.tick(2200);session.tick(3200);
children[2].exitCode=1;session.tick(3300);session.tick(5000);
assert.equal(children.length,3);
session.tick(61001);assert.equal(children.length,4);
session.stop().then(()=>{assert.ok(!session.accepts({collector_pid:4,updated_at_ms:62000}));console.log(JSON.stringify({passed:9,scope:'synthetic children only'}));}).catch(error=>{console.error(error);process.exitCode=1;});
