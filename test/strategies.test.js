import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { Engine, signal } from '../src/engine.js';
import { Store } from '../src/store.js';
import { snapshot } from '../src/server.js';
import { strategySettings, validateStrategy } from '../src/strategy.js';
import { sma, rsi, bands, warmup, alternativeSignal } from '../src/indicators.js';
const cfgFor = patch => ({ ...config({}, false), ...validateStrategy({ ...strategySettings(config({}, false)), ...patch }) });

test('indicator calculations use equal-weight SMA, Wilder RSI and population-deviation bands', () => {
  assert.equal(sma([100, 2, 4, 6], 3), 4);
  assert.equal(rsi([1, 1, 1, 1], 2), 50);
  assert.equal(rsi([1, 2, 3, 4], 2), 100);
  assert.equal(rsi([4, 3, 2, 1], 2), 0);
  assert.equal(rsi([1, 2, 1, 2], 2), 75);
  const b = bands([1, 2, 3], 3, 2);
  assert.equal(b.middle, 2); assert.ok(Math.abs(b.lower - (2 - 2 * Math.sqrt(2 / 3))) < 1e-12);
});
test('alternative strategies generate distinct entries and exits, not repeated oversold entries', () => {
  const smaCfg = cfgFor({type:'sma', fast:2, slow:3});
  assert.equal(alternativeSignal([5,4,3,6], null, smaCfg).side, 'buy');
  assert.equal(alternativeSignal([6,5,4,3], {}, smaCfg).side, 'sell');
  const rsiCfg = cfgFor({type:'rsi',rsiPeriod:2});
  assert.equal(alternativeSignal([5,4,3,4], null, rsiCfg).side, 'buy');
  assert.equal(alternativeSignal([5,4,3,2], null, rsiCfg), null);
  assert.equal(alternativeSignal([1,2,3,4], {}, rsiCfg).side, 'sell');
  const bbCfg = cfgFor({type:'bollinger',bbPeriod:3,bbDeviation:1});
  assert.equal(alternativeSignal([10,10,5,8], null, bbCfg).side, 'buy');
  assert.equal(alternativeSignal([10,10,5,8], {}, bbCfg).side, 'sell');
  assert.equal(alternativeSignal([10,10,5,1], null, bbCfg), null);
});
test('all strategies wait for warm-up and ignore old exit thresholds', () => {
  for (const type of ['ema','sma','rsi','bollinger']) {
    const cfg = cfgFor({type}), position = {amount:'100000000',cost:'100000000000'};
    assert.equal(signal([{price:'100000000000'}], null, cfg), null);
    assert.equal(signal([{price:'97000000000'}], position, cfg), null);
    assert.equal(signal([{price:'103000000000'}], position, cfg), null);
    assert.ok(warmup(cfg) >= 3);
  }
});
test('legacy settings default to EMA and malformed indicator settings are rejected', () => {
  const legacy = strategySettings(config({},false));
  for (const key of ['type','rsiPeriod','rsiBuy','rsiSell','bbPeriod','bbDeviation']) delete legacy[key];
  assert.equal(validateStrategy(legacy).strategyType, 'ema');
  for (const patch of [{type:'unknown'},{rsiPeriod:1},{rsiPeriod:2.5},{rsiBuy:80,rsiSell:70},{bbDeviation:0},{bbPeriod:201},{rsiBuy:null}]) {
    assert.throws(() => validateStrategy({...legacy,...patch}));
  }
});
test('on-the-fly strategy saves wait for a quote, keep running and persist across restart', async t => {
  const cfg = cfgFor({}), store = new Store(':memory:', cfg.paper); t.after(()=>store.close());
  let release;
  const engine = new Engine(cfg, store, {quote: async (from,to,amount) => {
    await new Promise(resolve => {release = resolve;});
    return {inputMint:cfg.tokens[from].mint,outputMint:cfg.tokens[to].mint,inAmount:amount,outAmount:'100000000000',otherAmountThreshold:'99500000000',slippageBps:50,swapMode:'ExactIn'};
  }});
  engine.start(); const ticking = engine.tick();
  const saving = engine.configureWhenReady({...strategySettings(cfg),type:'rsi',rsiPeriod:8});
  assert.equal(cfg.strategyType, 'ema'); release(); await ticking; await saving;
  assert.equal(engine.active(), true); assert.equal(cfg.strategyType,'rsi');
  assert.equal(snapshot(engine).warmupRequired,10); assert.equal(snapshot(engine).warmup,0);
  store.set(engine.key('position'),{amount:'100000000',cost:'100000000000',slHigh:'102000000000'});
  engine.configure({...strategySettings(cfg),type:'bollinger'});
  assert.equal(engine.position().slHigh,'102000000000'); assert.equal(engine.active(),true);
  const fresh = new Engine(config({},false),store,{});
  assert.equal(fresh.cfg.strategyType,'bollinger'); assert.equal(fresh.active(),false);
});
test('unsettled transactions and closing still block strategy changes without partial writes', async t => {
  const cfg = cfgFor({}), store = new Store(':memory:',cfg.paper); t.after(()=>store.close());
  const engine = new Engine(cfg,store,{}), settings = {...strategySettings(cfg),type:'rsi'};
  engine.closing = true;
  await assert.rejects(engine.configureWhenReady(settings), /settle/);
  engine.closing = false; engine.pending = () => [{status:'unknown'}];
  await assert.rejects(engine.configureWhenReady(settings), /settle/);
  assert.equal(cfg.strategyType,'ema');
});
