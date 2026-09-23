import { config } from './config.js';
import { Jupiter, verifyMint } from './providers.js';
import { validateQuote } from './engine.js';
const cfg = config(process.env, false);
await verifyMint(cfg);
const jupiter = new Jupiter(cfg);
for (const [input, output, amount] of [['SOL', 'DOGE', cfg.tradeSize], ['DOGE', 'SOL', (10n ** BigInt(cfg.tokens.DOGE.decimals)).toString()]]) {
  const q = validateQuote(await jupiter.quote(input, output, amount), input, output, amount, cfg);
  console.log(`${input} -> ${output}: valid quote; router=${q.router}, slippage=${q.slippageBps} bps.`);
}
console.log('Read-only mainnet smoke test passed. No wallet loaded, no transactions signed or submitted.');
