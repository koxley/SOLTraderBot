import { config } from './config.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { appServer } from './server.js';

// Isolated in-memory preview. No Telegram credentials, wallet keys or external requests.
const cfg = config({ SAMPLE_SECONDS: '15' }, false);
let step = 0;
const market = {
  async quote(input, output, amount) {
    const price = BigInt(Math.round(6700000 + Math.sin(step++ / 4) * 300000 + Math.sin(step / 11) * 120000));
    const out = input === 'SOL' ? BigInt(amount) * 1000000n / price : BigInt(amount) * price / 1000000n;
    return { inputMint: cfg.tokens[input].mint, outputMint: cfg.tokens[output].mint, inAmount: amount,
      outAmount: out.toString(), otherAmountThreshold: (out * BigInt(10000 - cfg.slippage) / 10000n).toString(), slippageBps: cfg.slippage, swapMode: 'ExactIn' };
  },
};
const store = new Store(':memory:', cfg.paper);
const engine = new Engine(cfg, store, market);
const now = Date.now();
store.set(engine.key('samples'), Array.from({ length: 70 }, (_, i) => ({ time: now - (70 - i) * cfg.sampleMs,
  price: String(Math.round(6500000 + i * 2400 + Math.sin(i / 4) * 90000 + Math.sin(i / 1.6) * 13000)) })));
const server = appServer(engine, { demo: true });
server.listen(3001, '127.0.0.1', () => console.log('Interactive DEMO at http://127.0.0.1:3001 — no real funds or external APIs.'));
const timer = setInterval(async () => { const event = await engine.tick(); if (event) console.log(event); }, 1000);
process.on('SIGINT', () => { clearInterval(timer); server.close(); });
