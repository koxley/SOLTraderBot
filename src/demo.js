import { config } from './config.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { appServer } from './server.js';

// Isolated in-memory preview. No Telegram credentials, wallet keys or external requests.
const cfg = config({ DOGE_MINT: 'DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R', SAMPLE_SECONDS: '15' }, false);
let step = 0;
const market = {
  async quote(input, output, amount) {
    const price = BigInt(Math.round(920000 + Math.sin(step++ / 4) * 45000 + Math.sin(step / 11) * 18000));
    const out = input === 'SOL' ? BigInt(amount) * 100000000n / price : BigInt(amount) * price / 100000000n;
    return { inputMint: cfg.tokens[input].mint, outputMint: cfg.tokens[output].mint, inAmount: amount,
      outAmount: out.toString(), otherAmountThreshold: (out * BigInt(10000 - cfg.slippage) / 10000n).toString(), slippageBps: cfg.slippage, swapMode: 'ExactIn' };
  },
};
const store = new Store(':memory:', cfg.paper);
const engine = new Engine(cfg, store, market);
const now = Date.now();
store.set(engine.key('samples'), Array.from({ length: 70 }, (_, i) => ({ time: now - (70 - i) * cfg.sampleMs,
  price: String(Math.round(880000 + i * 550 + Math.sin(i / 4) * 20000 + Math.sin(i / 1.6) * 3000)) })));
// Clearly-labelled sample history gives the preview a usable activity and position screen.
engine.fill({ id: 'demo-buy-1', mode: 'paper', side: 'buy', reason: 'Preview · EMA crossed up', input: 'SOL', output: 'DOGE',
  amount: '25000000', notional: '25000000', day: new Date(now).toISOString().slice(0, 10), time: now - 400000 }, '25000000', '2750000000');
engine.fill({ id: 'demo-sell-1', mode: 'paper', side: 'sell', reason: 'Preview · take profit', input: 'DOGE', output: 'SOL',
  amount: '2750000000', notional: '26800000', day: new Date(now).toISOString().slice(0, 10), time: now - 200000 }, '2750000000', '26800000');
engine.fill({ id: 'demo-buy-2', mode: 'paper', side: 'buy', reason: 'Preview · EMA crossed up', input: 'SOL', output: 'DOGE',
  amount: '25000000', notional: '25000000', day: new Date(now).toISOString().slice(0, 10), time: now - 60000 }, '25000000', '2700000000');
const server = appServer(engine, { demo: true });
server.listen(3001, '127.0.0.1', () => console.log('Interactive DEMO at http://127.0.0.1:3001 — no real funds or external APIs.'));
const timer = setInterval(async () => { const event = await engine.tick(); if (event) console.log(event); }, 1000);
process.on('SIGINT', () => { clearInterval(timer); server.close(); });
