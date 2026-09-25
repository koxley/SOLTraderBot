import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { strategySettings, validateStrategy } from '../src/strategy.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';

test('TP and SL default, validate, persist and update a running bot without resetting warm-up', t => {
  const cfg=config({},false);
  const store=new Store(':memory:',cfg.paper); t.after(()=>store.close());
  assert.equal(cfg.stopLoss,150); assert.equal(cfg.takeProfit,250);
  assert.equal(strategySettings(cfg).stopLoss,1.5); assert.equal(strategySettings(cfg).takeProfit,2.5);
  const saved={...strategySettings(cfg),stopLoss:2,takeProfit:3};
  store.set('CBBTC_SOL:paper:strategy',saved);
  const engine=new Engine(cfg,store,{});
  assert.equal(engine.active(),false);
  assert.equal(cfg.stopLoss,200); assert.equal(cfg.takeProfit,300);
  engine.start(); store.set(engine.key('samples'),[{time:1,price:'1000'}]);
  engine.configure({...strategySettings(cfg),stopLoss:1.25,takeProfit:4.5});
  assert.equal(engine.active(),true); assert.equal(store.get(engine.key('samples')).length,1);
  assert.equal(cfg.stopLoss,125); assert.equal(cfg.takeProfit,450);
  assert.equal(store.get(engine.key('strategy')).stopLoss,1.25);
  for (const patch of [{stopLoss:0},{stopLoss:90.01},{takeProfit:0},{takeProfit:500.01},{takeProfit:1.234}])
    assert.throws(()=>validateStrategy({...strategySettings(cfg),...patch}));
});
