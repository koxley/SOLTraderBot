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
test('TP exits only the triggered buy, retains other lots, and Close Open Positions exits the rest', async t=>{
  const {engine,cfg,price}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  price(1100000000); await engine.trade({side:'buy',reason:'second'});
  const second={...engine.position().lots[1]};
  const decision=signal([{price:'1040000000'}],engine.position(),cfg);
  assert.equal(decision.reason,'take profit'); assert.equal(decision.lotId,engine.position().lots[0].id);
  price(1040000000); await engine.trade(decision);
  assert.equal(engine.position().lots.length,1); assert.deepEqual(engine.position().lots[0],second);
  assert.equal(engine.orders()[0].actualInput,'10000000');
  engine.requestClose(); await engine.tick(); assert.equal(engine.position(),null); assert.equal(engine.active(),false);
});
test('one sample closes all triggered lots and each trailing high persists separately', async t=>{
  const {engine,store,price}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  price(1100000000); await engine.trade({side:'buy',reason:'second'});
  price(1020000000); await engine.tick();
  // Second buy hits its own SL; first buy gains 2% and activates its own trailing stop.
  assert.equal(engine.position().lots.length,1); assert.equal(engine.position().lots[0].slHigh,'1020000000');
  assert.equal(engine.orders()[0].reason,'stop loss');
  price(1020000000); await engine.trade({side:'buy',reason:'third'});
  store.set(engine.key('samples'),[]); price(1200000000); await engine.tick();
  assert.equal(engine.position(),null); assert.equal(engine.orders().filter(o=>o.reason==='take profit').length,2);
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
test('snapshot publishes independent per-buy TP and SL values', async t=>{
  const {engine,price}=fixture(t); engine.start(); await engine.trade({side:'buy',reason:'first'});
  price(2000000000); await engine.trade({side:'buy',reason:'second'});
  const state=snapshot(engine); assert.equal(state.positions.length,2);
  assert.equal(state.positions[0].takeProfitPrice,1.03); assert.equal(state.positions[1].takeProfitPrice,2.06);
  assert.equal(state.positions[0].stopPrice,0.98); assert.equal(state.positions[1].stopPrice,1.96);
});
