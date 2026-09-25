import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const draw = app.slice(app.indexOf('function drawChart('), app.indexOf('function renderPrice('));
function chart(position = null, livePrice = null) {
  const labels = [], text = {};
  const context = new Proxy({}, {
    get: (_, key) => key === 'createLinearGradient' ? () => ({ addColorStop() {} }) :
      key === 'measureText' ? () => ({ width: 140 }) :
      key === 'fillText' ? (label, x, y) => { assert.ok(Number.isFinite(x) && Number.isFinite(y)); labels.push(label); } : () => {},
    set: () => true
  });
  const elements = { 'chart-levels': {}, 'chart-risk-details': {}, 'chart-entry-detail': {}, 'chart-tp-detail': {}, 'chart-sl-detail': {}, chart: { getBoundingClientRect: () => ({ width: 320, height: 178 }),
    getContext: () => context, setAttribute: (key, value) => { text[key] = value; } }, 'chart-empty': {} };
  const sandbox = { state: { position, strategy: { takeProfit: 6, stopLoss: 3 }, quote: 'SOL' }, livePrice,
    window: { devicePixelRatio: 1 }, number: (value, max = 6) => Number(value).toLocaleString('en-US', { maximumFractionDigits: max }),
    $: id => elements[id], text: (id, value) => { text[id] = value; if(elements[id]) elements[id].textContent=value; } };
  vm.createContext(sandbox); vm.runInContext(draw, sandbox);
  return { sandbox, labels, text, render: samples => { labels.length = 0; sandbox.drawChart(samples); } };
}

test('chart shows configurable TP and SL, preserves receipt markers and tightly scales real prices', () => {
  const c = chart({amount:'1',cost:'100'});
  c.sandbox.state.chartTrades=[{time:15001,side:'buy',status:'filled'},{time:30001,side:'sell',status:'filled'}];
  c.render([{time:1,price:500},{time:15001,price:500.1},{time:30001,price:500.05}]);
  assert.deepEqual(c.labels, ['TP +6% 106 SOL ↓ below range','SL −3% 97 SOL ↓ below range']);
  assert.match(c.text['chart-levels'], /Auto scale 499.985–500.115 SOL/);
  assert.match(c.text['aria-label'], /1 completed buys.*1 completed sells/);
  assert.match(c.text['aria-label'], /Position levels: TP \+6% at 106 SOL · SL −3% at 97 SOL/);
  assert.equal(c.text['chart-entry-detail'], 'Weighted-average entry · 100 SOL');
  assert.match(c.text['chart-tp-detail'], /\+6% · 106 SOL · reached by/);
  assert.match(c.text['chart-sl-detail'], /−3% · 97 SOL · 80.6% buffer/);
});
test('empty and single-sample charts still display active position levels', () => {
  const c=chart({amount:'1',cost:'100'}, {price:120});
  for (const samples of [[], [{time:1,price:120}]]) {
    c.render(samples); assert.deepEqual(c.labels, ['TP +6% 106 SOL','SL −3% 97 SOL']);
    assert.match(c.text['aria-label'], /Position levels: TP \+6% at 106 SOL · SL −3% at 97 SOL/);
  }
});
