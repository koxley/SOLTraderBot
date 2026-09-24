import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { Engine, signal } from '../src/engine.js';
import { Store } from '../src/store.js';
import { snapshot, appServer } from '../src/server.js';
import { lotsOf, aggregate, reduceLots, availableQuote } from '../src/positions.js';
import { strategySettings, validateStrategy } from '../src/strategy.js';
function fixture(t) {
  const cfg = config({},false), store = new Store(':memory:',cfg.paper); t.after(()=>store.close());
  let price = 1000000000n;
  const provider = {quote:async (input,output,amount) => {
    const out = input === 'SOL' ? BigInt(amount)*100000000n/price : BigInt(amount)*price/100000000n;
    return {inputMint:cfg.tokens[input].mint,outputMint:cfg.tokens[output].mint,inAmount:amount,outAmount:String(out),otherAmountThreshold:String(out),slippageBps:50,swapMode:'ExactIn'};
  }};
  const engine = new Engine(cfg,store,provider); engine.configure({...strategySettings(cfg),sizePercent:10,maxTrade:1,maxDaily:10});
  return {engine,cfg,store,price:n=>{price=BigInt(n);}};
}
test('consecutive buys use changing cash balances; consecutive sells reduce oldest lots and realize only sold cost', async t=>{
  const {engine,store,cfg,price}=fixture(t); engine.start();
  await engine.trade({side:'buy',reason:'test'}); price(2000000000); await engine.trade({side:'buy',reason:'test'});
  let p=engine.position(); assert.equal(p.lots.length,2); assert.equal(p.cost,'190000000'); assert.equal(p.amount,'14500000');
  assert.equal(p.lots[0].cost,'100000000'); assert.equal(p.lots[1].cost,'90000000');
  const second = {...p.lots[1]};
  await engine.trade({side:'sell',reason:'test'});
  assert.equal(engine.position().amount,'13050000'); assert.deepEqual(engine.position().lots[1],second);
  assert.equal(engine.orders()[0].actualInput,'1450000'); assert.equal(engine.orders()[0].realizedQuote,'14500000');
  await engine.trade({side:'sell',reason:'test'});
  assert.equal(engine.position().amount,'11745000'); assert.equal(engine.orders()[0].actualInput,'1305000');
  assert.equal(engine.position().cost,'162450000');
  const reopened = new Engine(config({},false),store,{}); assert.equal(reopened.position().lots.length,2);
  assert.equal(reopened.cfg.tradePercentBps,1000); assert.equal(reopened.active(),false);
});
test('old TP SL and trailing levels cannot close buys; manual close still exits every lot', async t=>{
  const {engine,cfg,store,price}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  price(1100000000); await engine.trade({side:'buy',reason:'second'});
  const before=engine.position(); before.lots[0].slHigh='999999999999'; store.set(engine.key('position'),before);
  cfg.stopLoss=200; cfg.takeProfit=300;
  for (const value of [100000000,1200000000,5000000000]) {
    store.set(engine.key('samples'),[]); price(value); await engine.tick();
    assert.deepEqual(engine.position(),before); assert.equal(engine.orders().length,2);
  }
  engine.requestClose(); await engine.tick(); assert.equal(engine.position(),null); assert.equal(engine.active(),false);
});

test('partial fills allocate cost without loss and reject over-selling atomically', async t=>{
  const {engine,store}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  const before=engine.position(), balance=await engine.balances();
  assert.throws(()=>engine.fill({id:'bad',mode:'paper',side:'sell',input:'cbBTC',output:'SOL'},'10000001','1'));
  assert.deepEqual(engine.position(),before); assert.deepEqual(await engine.balances(),balance); assert.equal(store.order('bad'),undefined);
  const p=aggregate([{id:'a',amount:'3',cost:'10',slHigh:'5'},{id:'b',amount:'4',cost:'11'}]);
  const first=reduceLots(p,'2'); assert.equal(first.cost,6n); assert.equal(first.position.lots[0].slHigh,'5');
  const rest=reduceLots(first.position,'5'); assert.equal(rest.cost,15n); assert.equal(rest.position,null);
});
test('legacy holdings and fixed-size settings migrate without losing basis or trailing state', ()=>{
  const legacy={amount:'100',cost:'250',opened:123,slHigh:'7'};
  assert.deepEqual(lotsOf(legacy),[{...legacy,id:'legacy'}]);
  const settings=strategySettings(config({},false)); delete settings.sizePercent;
  assert.equal(validateStrategy({...settings,size:'0.025'}).tradePercentBps,250);
  assert.equal(validateStrategy({...settings,size:'0.012345678'}).tradePercentBps,123);
  for (const sizePercent of [0,100.01,1.234,'NaN']) assert.throws(()=>validateStrategy({...settings,sizePercent}));
});
test('buy signals can add to holdings and live Available to Trade excludes gas reserve and fee buffer', async t=>{
  const {engine,cfg}=fixture(t);
  cfg.fast=2; cfg.slow=3; cfg.takeProfit=50000; cfg.stopLoss=9000;
  const p={amount:'100000000',cost:'1000000000'};
  assert.equal(signal([1000000000,1000000000,1000000000,1100000000].map(price=>({price:String(price)})),p,cfg).side,'buy');
  cfg.mode='live'; assert.equal(availableQuote({SOL:'1000000000'},cfg),970000000n);
  assert.equal(availableQuote({SOL:'1'},cfg),0n);
  cfg.mode='paper';
  const server=appServer(engine,{demo:true}); await new Promise(r=>server.listen(0,'127.0.0.1',r)); t.after(()=>new Promise(r=>server.close(r)));
  const balance=await (await fetch(`http://127.0.0.1:${server.address().port}/api/balance`)).json(); assert.equal(balance.availableToTrade,'1000000000');
});
test('snapshot retains per-buy cost and amounts but omits exit levels', async t=>{
  const {engine,price}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  price(2000000000); await engine.trade({side:'buy',reason:'second'});
  const state=snapshot(engine); assert.equal(state.positions.length,2);
  for (const lot of [state.position,...state.positions]) {
    assert.ok(lot.amount && lot.cost);
    for (const key of ['takeProfitPrice','stopPrice','slTrailing']) assert.equal(Object.hasOwn(lot,key),false);
  }
});

test('sell allocations retain exact buy identity, cost and proceeds through partial sells and restart', async t => {
  const {engine,store,price}=fixture(t); engine.start();
  await engine.trade({side:'buy',reason:'first'}); const first=engine.orders()[0].id;
  price(2000000000); await engine.trade({side:'buy',reason:'second'}); const second=engine.orders()[0].id;
  await engine.trade({side:'sell',reason:'partial'});
  const partial=engine.orders()[0]; assert.equal(partial.buyAllocations[0].buyId,first);
  engine.requestClose(); await engine.tick(); const close=engine.orders()[0];
  assert.deepEqual(close.buyAllocations.map(a=>a.buyId),[first,second]);
  for (const sell of [partial,close]) {
    const sum=key=>sell.buyAllocations.reduce((n,a)=>n+BigInt(a[key]),0n);
    assert.equal(sum('amount'),BigInt(sell.actualInput)); assert.equal(sum('proceeds'),BigInt(sell.actualOutput));
    assert.equal(sum('realizedQuote'),BigInt(sell.realizedQuote));
  }
  engine.fill(close,close.actualInput,close.actualOutput);
  assert.deepEqual(store.order(close.id).buyAllocations,close.buyAllocations);
  const reopened=new Engine(config({},false),store,{}), view=snapshot(reopened);
  assert.equal(view.trades.find(o=>o.id===first).sellAllocations.length,2);
  assert.equal(view.trades.find(o=>o.id===second).sellAllocations[0].sellId,close.id);
  assert.equal(view.trades.find(o=>o.id===close.id).buyAllocations[0].buyId,first);
});

test('explicit Stop clears displayed history and graph, resets paper cash/return and preserves inventory and limits', async t => {
  const {engine,store,price}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  price(2000000000); await engine.trade({side:'sell',reason:'partial'});
  const position=engine.position(), count=engine.orders().length;
  store.set(engine.key('samples'),[{time:1,price:'2000000000'}]); store.set(engine.key('chartSamples'),[{time:1,price:'2000000000'}]);
  engine.stop(true); const state=snapshot(engine);
  assert.equal(state.trades.length,0); assert.equal(state.tradeCount,0); assert.equal(state.realized,0);
  assert.deepEqual(state.samples,[]); assert.deepEqual(state.chartTrades,[]);
  assert.equal((await engine.balances()).SOL,'1000000000'); assert.deepEqual(engine.position(),position);
  assert.equal(engine.orders().length,count); assert.equal(state.chartReset,true);
  const reopened=new Engine(config({},false),store,{}); assert.equal(snapshot(reopened).tradeCount,0);
  engine.start(); assert.equal(snapshot(engine).chartReset,false);
  await engine.trade({side:'sell',reason:'new session'}); assert.equal(snapshot(engine).tradeCount,1);
  assert.equal(engine.orders()[0].buyAllocations[0].buyId,position.lots[0].id);
});
test('Stop defers paper cash reset for an unsettled operation and never writes live wallet balances', async t => {
  const {engine,store,cfg}=fixture(t); engine.setPaperBalance('4'); engine.busy=true; engine.stop(true);
  assert.equal((await engine.balances()).SOL,'4000000000');
  engine.busy=false; engine.finishSessionReset(); assert.equal((await engine.balances()).SOL,'1000000000');
  engine.setPaperBalance('4'); cfg.mode='live'; engine.stop(true);
  assert.equal(store.get(engine.paperKey()).SOL,'4000000000');
});
