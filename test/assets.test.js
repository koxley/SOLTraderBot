import test from 'node:test';
import assert from 'node:assert/strict';
import { config, TOKENS } from '../src/config.js';
import { ASSETS, assetConfig, resolveAsset, selectedPreset } from '../src/assets.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { appServer, snapshot } from '../src/server.js';
import { strategySettings } from '../src/strategy.js';

const usdt = ASSETS.find(a => a.symbol === 'USDT');
const btc = { symbol: 'cbBTC', ...TOKENS.cbBTC };
function fixture(t) {
  const cfg = config({}, false), store = new Store(':memory:', cfg.paper);
  const provider = { cfg, quote: async (from, to, amount) => ({ inputMint: cfg.tokens[from].mint,
    outputMint: cfg.tokens[to].mint, inAmount: amount, outAmount: '1000000', otherAmountThreshold: '995000', swapMode: 'ExactIn', slippageBps: 50 }) };
  const engine = new Engine(cfg, store, provider);
  t.after(() => store.close()); return { cfg, store, provider, engine };
}
test('asset selection persists, restores before startup and keeps charts, history and settings isolated', async t => {
  const { engine, store, cfg, provider } = fixture(t);
  engine.setPaperBalance('2');
  engine.configure({ ...strategySettings(cfg), fast: 3 });
  store.set(engine.key('samples'), [{ time: 1, price: '500000000000' }]);
  store.put({ id: 'old', pair: cfg.pair, mode: 'paper', status: 'filled', time: 1 });
  await engine.changeAsset({ preset: 'USDT' }, async () => usdt);
  assert.equal(cfg.base, 'USDT'); assert.equal(engine.active(), false);
  assert.equal(snapshot(engine).samples.length, 0); assert.equal(engine.orders().length, 0);
  assert.deepEqual(await engine.balances(), { SOL: '2000000000', USDT: '0' });
  engine.configure({ ...strategySettings(cfg), fast: 4 });
  const fresh = config({}, false);
  const reopened = new Engine(fresh, store, provider);
  assert.equal(fresh.base, 'USDT'); assert.equal(fresh.tokens.USDT.decimals, 6); assert.equal(fresh.fast, 4);
  await assert.rejects(reopened.changeAsset({ preset: 'cbBTC' }, async () => btc), /supported trading pairs/);
  assert.equal(store.get('CBBTC_SOL:paper:samples')[0].price, '500000000000');
});
test('asset switching refuses running, busy, closing, any unresolved order and either mode position', async t => {
  const { engine, store } = fixture(t);
  engine.start(); await assert.rejects(engine.changeAsset({ preset: 'USDT' }, async () => usdt), /Stop/); engine.stop();
  engine.busy = true; await assert.rejects(engine.changeAsset({ preset: 'USDT' }, async () => usdt), /Stop/); engine.busy = false;
  engine.closing = true; await assert.rejects(engine.changeAsset({ preset: 'USDT' }, async () => usdt), /Stop/); engine.closing = false;
  for (const mode of ['paper', 'live']) {
    store.set(`CBBTC_SOL:${mode}:position`, { amount: '1', cost: '1' });
    await assert.rejects(engine.changeAsset({ preset: 'USDT' }, async () => usdt), /Close/);
    store.set(`CBBTC_SOL:${mode}:position`, null);
  }
  store.put({ id: 'unresolved', pair: 'other', mode: 'live', status: 'unknown' });
  await assert.rejects(engine.changeAsset({ preset: 'USDT' }, async () => usdt), /settle/);
});
test('failed validation and stop during validation leave original market untouched', async t => {
  const { engine, store, cfg } = fixture(t);
  await assert.rejects(engine.changeAsset({ preset: 'USDT' }, async () => { throw new Error('No route'); }), /No route/);
  assert.equal(cfg.base, 'cbBTC'); assert.equal(store.get('selectedAsset'), undefined); assert.equal(engine.busy, false);
  let finish;
  const pending = engine.changeAsset({ preset: 'USDT' }, () => new Promise(resolve => { finish = resolve; }));
  assert.throws(() => engine.start(), /operation/);
  engine.stop(); finish(usdt); await assert.rejects(pending, /cancelled/);
  assert.equal(cfg.base, 'cbBTC'); assert.equal(engine.busy, false);
});
test('custom assets use mint identity and reject native SOL, symbol spoofing and unsafe labels', () => {
  const cfg = config({}, false), mint = 'DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R';
  const next = assetConfig(cfg, { symbol: 'DOGE', mint, decimals: 8 });
  assert.equal(next.pair, `TOKEN_${mint}_SOL`);
  for (const asset of [{ symbol: 'SOL', mint, decimals: 8 }, { symbol: 'ABC', mint: TOKENS.SOL.mint, decimals: 9 },
    { symbol: 'USDT', mint, decimals: 8 }, { symbol: '<script>', mint, decimals: 8 }, { symbol: 'ABC', mint, decimals: 20 }])
    assert.throws(() => assetConfig(cfg, asset));
});
test('asset API requires owner authentication', async t => {
  const { engine } = fixture(t);
  const server = appServer(engine, { token: '123:secret', owner: '456' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/asset`, { method: 'POST', body: JSON.stringify({ preset: 'USDT' }) })).status, 401);
});
test('asset API clears old price cache and returns selected token precision', async t => {
  const { engine } = fixture(t);
  const server = appServer(engine, { demo: true, assetResolver: async () => usdt });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/`;
  const before = await (await fetch(url + 'price')).json();
  const result = await fetch(url + 'asset', { method: 'POST', body: JSON.stringify({ preset: 'USDT' }) });
  assert.equal(result.status, 200); const state = await result.json();
  assert.equal(state.tokenDecimals, 6); assert.equal(state.base, 'USDT');
  const after = await (await fetch(url + 'price')).json();
  assert.notEqual(after.pair, before.pair); assert.equal(after.pair, state.pair);
});

 test('selected six-decimal asset is bought and sold with correctly labeled receipts', async t => {
  const { engine, cfg } = fixture(t);
  await engine.changeAsset({ preset: 'USDT' }, async () => usdt);
  engine.start(); await engine.trade({ side: 'buy', reason: 'test' });
  assert.equal(engine.position().amount, '995000');
  assert.equal(snapshot(engine).position.amount, '0.995');
  assert.equal(engine.orders()[0].output, 'USDT');
  await engine.trade({ side: 'sell', reason: 'test' });
  assert.equal(engine.position().amount, '970125');
  assert.equal(engine.orders()[0].input, 'USDT');
  assert.equal((await engine.balances()).USDT, '970125');
  engine.requestClose(); await engine.tick(); assert.equal(engine.position(), null);
});

test('ten fixed mints and preset-only selection; legacy configuration remains readable', async t => {
  const { engine, cfg } = fixture(t);
  assert.equal(ASSETS.length, 10);
  assert.equal(new Set(ASSETS.map(a => a.mint)).size, 10);
  for (const asset of ASSETS) assert.equal(assetConfig(cfg, asset).base, asset.symbol);
  for (const input of [{preset:'custom',symbol:'ABC',mint:TOKENS.DOGE.mint}, {preset:'USDC',mint:TOKENS.DOGE.mint}, {}]) {
    assert.throws(() => selectedPreset(input), /supported/);
    await assert.rejects(engine.changeAsset(input, async () => { throw new Error('must not resolve'); }), /supported/);
  }
  assert.equal(assetConfig(cfg, btc).base, 'cbBTC');
});
