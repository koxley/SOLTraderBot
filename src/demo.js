import { config } from './config.js';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { appServer } from './server.js';
import { ASSETS } from './assets.js';
import { UserError } from './config.js';

// Isolated in-memory preview. No Telegram credentials, wallet keys or external requests.
const cfg = config({}, false);
let step = 0;
const market = {
  async quote(input, output, amount) {
    if (input === 'SOL' && output === 'USDT') return { inputMint: cfg.tokens.SOL.mint, outputMint: cfg.tokens.USDT.mint, inAmount: amount, outAmount: '150000000', otherAmountThreshold: '149250000', slippageBps: 50, swapMode: 'ExactIn' };
    const price = BigInt(Math.round(550000000000 + Math.sin(step++ / 4) * 8000000000 + Math.sin(step / 11) * 3000000000));
    const unit = 10n ** BigInt(cfg.tokens[cfg.base].decimals);
    const assetPrice = cfg.base === 'cbBTC' ? price : price / 80000n;
    const out = input === 'SOL' ? BigInt(amount) * unit / assetPrice : BigInt(amount) * assetPrice / unit;
    return { inputMint: cfg.tokens[input].mint, outputMint: cfg.tokens[output].mint, inAmount: amount,
      outAmount: out.toString(), otherAmountThreshold: (out * BigInt(10000 - cfg.slippage) / 10000n).toString(), slippageBps: cfg.slippage, swapMode: 'ExactIn' };
  },
};
const store = new Store(':memory:', cfg.paper);
const engine = new Engine(cfg, store, market);
const now = Date.now();
store.set(engine.key('samples'), Array.from({ length: 70 }, (_, i) => ({ time: now - (70 - i) * cfg.sampleMs,
  price: String(Math.round(540000000000 + i * 200000000 + Math.sin(i / 4) * 8000000000 + Math.sin(i / 1.6) * 1000000000)) })));
const server = appServer(engine, { demo: true, assetResolver: async input => {
  const asset = ASSETS.find(a => a.symbol === input.preset);
  if (!asset) throw new UserError('Custom mint validation is available in the deployed app. Preview supports presets.');
  return asset;
} });
server.listen(3001, '127.0.0.1', () => console.log('Interactive DEMO at http://127.0.0.1:3001 — no real funds or external APIs.'));
const timer = setInterval(async () => { const event = await engine.tick(); if (event) console.log(event); }, 1000);
process.on('SIGINT', () => { clearInterval(timer); server.close(); });
