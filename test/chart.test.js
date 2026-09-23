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
  const elements = { chart: { getBoundingClientRect: () => ({ width: 320, height: 178 }),
    getContext: () => context, setAttribute: (key, value) => { text[key] = value; } }, 'chart-empty': {} };
  const sandbox = { state: { position, strategy: { takeProfit: 6, stopLoss: 3 }, quote: 'SOL' }, livePrice,
    window: { devicePixelRatio: 1 }, $: id => elements[id], text: (id, value) => { text[id] = value; } };
  vm.createContext(sandbox); vm.runInContext(draw, sandbox);
  return { sandbox, labels, text, render: samples => { labels.length = 0; sandbox.drawChart(samples); } };
}

test('flat positions show clearly labeled TP and SL preview values', () => {
  const c = chart(); c.render([{ time: 1, price: 500 }, { time: 15001, price: 600 }]);
  assert.deepEqual(c.labels, ['TP preview 636 SOL', 'SL preview 582 SOL']);
  assert.match(c.text['chart-levels'], /no open position/);
});

test('open-position levels use entry cost despite independent price updates', () => {
  const c = chart({ amount: '0.00005', cost: '0.025' }, { price: 700 });
  c.render([{ time: 1, price: 600 }]);
  assert.deepEqual(c.labels, ['TP 530 SOL', 'SL 485 SOL']);
  c.render([]); assert.deepEqual(c.labels, ['TP 530 SOL', 'SL 485 SOL']);
  c.sandbox.state.strategy.takeProfit = 10; c.render([]);
  assert.equal(c.labels[0], 'TP 550 SOL');
});

test('first live quote supplies preview levels before chart history arrives', () => {
  const c = chart(null, { price: 500 }); c.render([]);
  assert.deepEqual(c.labels, ['TP preview 530 SOL', 'SL preview 485 SOL']);
});

test('closing a position returns to previews and missing prices show a waiting message', () => {
  const c = chart({ amount: '0.00005', cost: '0.025' }); c.render([]);
  c.sandbox.state.position = null; c.render([{ time: 1, price: 600 }]);
  assert.deepEqual(c.labels, ['TP preview 636 SOL', 'SL preview 582 SOL']);
  c.render([]); assert.equal(c.labels.length, 0);
  assert.match(c.text['chart-levels'], /Waiting for a price/);
});
