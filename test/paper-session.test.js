import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { snapshot, appServer } from '../src/server.js';
function fixture(t) {
  const cfg = config({},false), store = new Store(':memory:',cfg.paper);
  t.after(()=>store.close()); const engine = new Engine(cfg,store,{});
  engine.setPaperBalance('5');
  store.put({id:'previous',pair:cfg.pair,mode:'paper',side:'sell',input:cfg.base,output:cfg.quote,amount:'1',status:'filled',time:1,realizedQuote:'250000000'});
  store.set(engine.key('position'),{amount:'100',cost:'200',opened:1});
  return {cfg,store,engine};
}
test('stopped paper reopen resets cash and return, preserves holdings/history, and counts later returns', t=>{
  const {engine,store}=fixture(t); const position=engine.position();
  assert.equal(snapshot(engine).realized,0.25); engine.resetPaperSession();
  assert.equal(store.get(engine.paperKey()).SOL,'1000000000'); assert.equal(snapshot(engine).realized,0);
  assert.deepEqual(engine.position(),position); assert.equal(engine.orders().length,1);
  store.put({id:'later',pair:engine.cfg.pair,mode:'paper',side:'sell',input:engine.cfg.base,output:engine.cfg.quote,amount:'1',status:'filled',time:2,realizedQuote:'-50000000'});
  assert.equal(snapshot(engine).realized,-0.05);
  engine.resetPaperSession(); assert.equal(snapshot(engine).realized,0); assert.equal(engine.orders().length,2);
});
test('running, busy, closing, unresolved and live sessions are not reset', t=>{
  const {engine,store,cfg}=fixture(t);
  for (const flag of ['running','busy','closing','pending']) {
    store.set('running',flag==='running'); engine.busy=flag==='busy'; engine.closing=flag==='closing';
    engine.pending=()=>flag==='pending'?[{}]:[];
    engine.resetPaperSession(); assert.equal(store.get(engine.paperKey()).SOL,'5000000000');
    assert.equal(store.get(engine.key('realizedBaseline')),undefined);
  }
  engine.pending=()=>[]; engine.closing=false; cfg.mode='live'; engine.resetPaperSession();
  assert.equal(store.get(engine.paperKey()).SOL,'5000000000');
  assert.equal(store.get(engine.key('realizedBaseline')),undefined);
});
test('reopen endpoint performs reset; start and restart use one SOL despite a previously configured balance', async t=>{
  const {engine,store}=fixture(t); const server=appServer(engine,{demo:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); t.after(()=>new Promise(resolve=>server.close(resolve)));
  const response=await fetch(`http://127.0.0.1:${server.address().port}/api/paper/reset-balance`,{method:'POST'});
  assert.equal(response.status,200); assert.equal((await response.json()).realized,0);
  assert.equal(store.get(engine.paperKey()).SOL,'1000000000'); engine.start();
  assert.equal(store.get(engine.paperKey()).SOL,'1000000000');
  engine.stop(); engine.setPaperBalance('3'); engine.start();
  assert.equal(store.get(engine.paperKey()).SOL,'1000000000');
});
