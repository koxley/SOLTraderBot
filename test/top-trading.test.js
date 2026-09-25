import test from 'node:test';
import assert from 'node:assert/strict';
import { config, ASSETS } from '../src/config.js';
import { Engine } from '../src/engine.js';
import { Jupiter } from '../src/providers.js';
import { snapshot } from '../src/server.js';
import { Store } from '../src/store.js';
import { strategySettings, validateStrategy } from '../src/strategy.js';

test('Jupiter ranks only stored assets by one-hour percentage gain', async () => {
  const cfg = config({ JUPITER_API_KEY: 'key' }, false);
  let requested;
  const provider = new Jupiter(cfg, async (url, options) => {
    requested = { url, options };
    return [
      { id: ASSETS[0].mint, stats1h: { priceChange: -1.2 } },
      { id: ASSETS[3].mint, stats1h: { priceChange: 7.5 } },
      { id: 'unknown', stats1h: { priceChange: 99 } },
      { id: ASSETS[4].mint, stats1h: { priceChange: 'unavailable' } },
    ];
  });
  const selected = await provider.topTradingAsset(ASSETS);
  assert.equal(selected.asset.symbol, ASSETS[3].symbol);
  assert.equal(selected.gain, 7.5);
  assert.match(requested.url, /tokens\/v2\/search\?query=/);
  assert.equal(requested.options.headers['x-api-key'], 'key');
});

test('Select Top Trading validates as a stopped paired-trading setting', () => {
  const cfg = config({}, false), settings = strategySettings(cfg);
  assert.equal(validateStrategy({ ...settings, selectTopTrading: true }).selectTopTrading, true);
  assert.throws(() => validateStrategy({ ...settings, marketType: 'track', selectTopTrading: true }), /Paired trading/);
  assert.throws(() => validateStrategy({ ...settings, selectTopTrading: 'sometimes' }), /on or off/);
});

test('Saving Select Top Trading chooses the strongest asset while stopped and Start activates it', async t => {
  const cfg = config({}, false), store = new Store(':memory:', cfg.paper);
  t.after(() => store.close());
  const winner = ASSETS.find(asset => asset.symbol === 'RAY');
  const provider = {
    topTradingAsset: async assets => ({ asset: assets.find(asset => asset.symbol === winner.symbol), gain: 6.25 }),
    quote: async () => { throw new Error('Unexpected quote'); },
  };
  const engine = new Engine(cfg, store, provider);
  const result = await engine.configureWithTopSelection({ ...strategySettings(cfg), selectTopTrading: true }, async () => winner);
  let state = snapshot(engine);
  assert.equal(result.asset.symbol, 'RAY');
  assert.equal(engine.active(), false);
  assert.equal(state.base, 'RAY');
  assert.equal(state.market.asset, 'RAY');
  assert.equal(state.strategy.asset, 'RAY');
  assert.equal(state.strategy.selectTopTrading, true);
  assert.equal(store.get('selectedAsset').symbol, 'RAY');
  engine.start();
  assert.throws(() => engine.configure({ ...strategySettings(cfg), selectTopTrading: false }), /Stop the bot/);
  engine.stop();
  await engine.startWithSelection(async () => winner);
  state = snapshot(engine);
  assert.equal(engine.active(), true);
  assert.equal(state.base, 'RAY');
  assert.equal(state.market.asset, 'RAY');
  assert.equal(state.strategy.asset, 'RAY');
  assert.equal(state.strategy.selectTopTrading, true);
  assert.equal(store.get('selectedAsset').symbol, 'RAY');
});
