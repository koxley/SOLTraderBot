import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { advanceStop, stopLevel } from '../src/risk.js';
import { Engine, signal } from '../src/engine.js';
import { Store } from '../src/store.js';
import { snapshot } from '../src/server.js';

test('defaults are 3% TP and 2% SL while explicit overrides remain valid', () => {
  const cfg = config({}, false);
  assert.equal(cfg.takeProfit, 300); assert.equal(cfg.stopLoss, 200);
  const custom = config({ TAKE_PROFIT_BPS: '600', STOP_LOSS_BPS: '300' }, false);
  assert.equal(custom.takeProfit, 600); assert.equal(custom.stopLoss, 300);
});

test('SL activates at the exact percentage gain, follows higher prices and never retreats', () => {
  const cfg = config({}, false), p = { amount: '100000000', cost: '100000000000' };
  assert.equal(advanceStop(p, '101999999999', cfg), p);
  const first = advanceStop(p, '102000000000', cfg), level = stopLevel(first, cfg);
  assert.equal(first.slHigh, '102000000000');
  assert.equal(level.numerator / level.denominator, 99960000000n);
  const high = advanceStop(first, '102500000000', cfg);
  assert.equal(stopLevel(high, cfg).numerator / level.denominator, 100450000000n);
  assert.equal(advanceStop(high, '101000000000', cfg), high);
  assert.equal(signal([{ price: '100450000000' }], high, cfg).reason, 'stop loss');
  assert.equal(signal([{ price: '100450000001' }], high, cfg), null);
  const atProfit = advanceStop(high, '103000000000', cfg);
  assert.equal(signal([{ price: '103000000000' }], atProfit, cfg).reason, 'take profit');
});

test('sampled trailing stop persists through restart and is exposed to the chart', async t => {
  const cfg = config({}, false), store = new Store(':memory:', cfg.paper);
  t.after(() => store.close());
  const provider = { quote: async (from, to, amount) => ({ inputMint: cfg.tokens[from].mint,
    outputMint: cfg.tokens[to].mint, inAmount: amount, outAmount: '102000000000', otherAmountThreshold: '101490000000',
    slippageBps: 50, swapMode: 'ExactIn' }) };
  const engine = new Engine(cfg, store, provider);
  store.set(engine.key('position'), { amount: '100000000', cost: '100000000000' });
  engine.start(); await engine.tick();
  assert.equal(engine.position().slHigh, '102000000000');
  const reopened = new Engine(config({}, false), store, provider);
  assert.equal(reopened.active(), false);
  assert.equal(snapshot(reopened).position.stopPrice, 99.96);
  assert.equal(snapshot(reopened).position.slTrailing, true);
});
