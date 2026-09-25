import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const functions = app.slice(app.indexOf('function renderMarketHeader('), app.indexOf('function toast('));
const trackedCoinLock = app.slice(app.indexOf('function updateTrackedCoinLock('), app.indexOf("$('setting-type').addEventListener"));

test('Tracked Coin and Select Top Trading are locked only while the bot is running', () => {
  const fields = { 'setting-asset': {}, 'setting-selectTopTrading': {} };
  const sandbox = { $: id => fields[id] };
  vm.createContext(sandbox);
  vm.runInContext(trackedCoinLock, sandbox);
  sandbox.updateTrackedCoinLock({ running: true });
  assert.equal(fields['setting-asset'].disabled, true);
  assert.equal(fields['setting-selectTopTrading'].disabled, true);
  sandbox.updateTrackedCoinLock({ running: false });
  assert.equal(fields['setting-asset'].disabled, false);
  assert.equal(fields['setting-selectTopTrading'].disabled, false);
});

test('changing Tracked Coin immediately previews the selected SOL pair', () => {
  const labels = {};
  const elements = {
    'setting-asset': { value: 'RAY' },
    'setting-marketType': { value: 'pair' }
  };
  const sandbox = {
    state: { market: { asset: 'USDC', reference: 'SOL', executable: true }, quote: 'SOL' },
    $: id => elements[id] ||= {},
    text: (id, value) => { labels[id] = value; }
  };
  vm.createContext(sandbox);
  vm.runInContext(functions, sandbox);
  sandbox.previewTrackedCoin();
  assert.equal(labels['market-pair'], 'SOL / RAY');
  assert.equal(labels['market-name'], 'Selection preview · save to load the RAY chart');
  assert.equal(labels['market-tag'], 'SPOT');
});

test('single coin tracking still shows its SOL reference in the chart header', () => {
  const labels = {};
  const elements = {
    'setting-asset': { value: 'RAY' },
    'setting-marketType': { value: 'track' }
  };
  const sandbox = {
    state: { market: { asset: 'USDC', reference: 'SOL', executable: true }, quote: 'SOL' },
    $: id => elements[id] ||= {},
    text: (id, value) => { labels[id] = value; }
  };
  vm.createContext(sandbox);
  vm.runInContext(functions, sandbox);
  sandbox.previewTrackedCoin();
  assert.equal(labels['market-pair'], 'SOL / RAY');
  assert.equal(labels['market-tag'], 'TRACK ONLY');
});
