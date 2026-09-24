import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { strategySettings, validateStrategy } from '../src/strategy.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';

test('legacy exit settings and env values are ignored on restore and omitted from new settings', t => {
  const cfg=config({STOP_LOSS_BPS:'invalid',TAKE_PROFIT_BPS:'invalid'},false);
  const store=new Store(':memory:',cfg.paper); t.after(()=>store.close());
  const saved={...strategySettings(cfg),stopLoss:2,takeProfit:3};
  store.set('CBBTC_SOL:paper:strategy',saved);
  const engine=new Engine(cfg,store,{});
  assert.equal(engine.active(),false);
  for (const result of [cfg,strategySettings(cfg),validateStrategy(saved)]) {
    assert.equal(Object.hasOwn(result,'stopLoss'),false);
    assert.equal(Object.hasOwn(result,'takeProfit'),false);
  }
  engine.configure(strategySettings(cfg));
  assert.equal(Object.hasOwn(store.get(engine.key('strategy')),'stopLoss'),false);
});
