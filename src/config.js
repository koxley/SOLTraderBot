import { resolve } from 'node:path';

export const TOKENS = Object.freeze({
  USDT: { mint: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6 },
  cbBTC: { mint: 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij', decimals: 8 },
  USDC: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
  SOL: { mint: 'So11111111111111111111111111111111111111112', decimals: 9 },
  ETH: { mint: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', decimals: 8 },
  DOGE: { mint: 'DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R', decimals: 8 },
  XRP: { mint: '6UpQcMAb5xMzxc7ZfPaVMgx3KqsvKZdT5U718BzD5We2', decimals: 6 },
});
export const TRACKED_ASSETS = Object.freeze(['SOL', 'ETH', 'DOGE', 'XRP', 'USDC', 'USDT']);

export class UserError extends Error {}

export function units(value, decimals) {
  if (typeof value !== 'string' || !/^\d+(\.\d+)?$/.test(value) || value.length > 30)
    throw new UserError('Use a positive decimal amount, without commas or exponent notation.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new UserError(`At most ${decimals} decimal places allowed.`);
  const result = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  if (result > 18446744073709551615n) throw new UserError('Amount too large.');
  return result;
}

export function format(value, decimals) {
  const n = BigInt(value), base = 10n ** BigInt(decimals);
  const tail = (n % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${n / base}${tail ? `.${tail}` : ''}`;
}

export function config(env = process.env, requireTelegram = true) {
  const pair = env.TRADING_PAIR || 'CBBTC_SOL';
  if (!['DOGE_SOL', 'SOL_USDC', 'USDC_SOL', 'CBBTC_SOL'].includes(pair)) throw new Error('Unsupported TRADING_PAIR.');
  const legacy = pair === 'DOGE_SOL';
  const inverse = env.TRADING_PAIR === 'SOL_USDC';
  const base = legacy ? 'DOGE' : inverse ? 'SOL' : pair === 'USDC_SOL' ? 'USDC' : 'cbBTC', quote = inverse ? 'USDC' : 'SOL';
  const quoteDecimals = inverse ? 6 : 9;
  const mode = env.TRADING_MODE || 'paper';
  if (!['paper', 'live'].includes(mode)) throw new Error('TRADING_MODE must be paper or live.');
  if (requireTelegram && (!/^\d+:[\w-]+$/.test(env.TELEGRAM_BOT_TOKEN || '') || !/^[1-9]\d*$/.test(env.TELEGRAM_OWNER_ID || '')))
    throw new Error('Set TELEGRAM_BOT_TOKEN and numeric TELEGRAM_OWNER_ID in .env.');
  if (mode === 'live' && env.LIVE_TRADING_ACK !== 'I_UNDERSTAND_REAL_FUNDS')
    throw new Error('Live mode requires LIVE_TRADING_ACK=I_UNDERSTAND_REAL_FUNDS.');
  const integer = (name, fallback, min, max) => {
    const n = Number(env[name] ?? fallback);
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name}.`);
    return n;
  };
  const amount = (name, fallback, decimals) => {
    const n = units(env[name] ?? fallback, decimals);
    if (n <= 0n) throw new Error(`${name} must be positive.`);
    return n.toString();
  };
  const rpc = env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
  if (!['http:', 'https:'].includes(new URL(rpc).protocol)) throw new Error('Invalid RPC URL.');
  const fast = integer('EMA_FAST', 5, 2, 100);
  const slow = integer('EMA_SLOW', 12, 3, 200);
  if (fast >= slow) throw new Error('EMA_FAST must be less than EMA_SLOW.');
  const dogeDecimals = integer('DOGE_DECIMALS', 8, 0, 12);
  const dogeMint = env.DOGE_MINT || TOKENS.DOGE.mint;
  if (dogeMint && (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(dogeMint) || dogeMint === TOKENS.SOL.mint))
    throw new Error('DOGE_MINT must be the verified wrapped DOGE mint on Solana.');
  return {
    base, quote, quoteDecimals, pair, splToken: base === 'SOL' ? quote : base,
    mode, token: env.TELEGRAM_BOT_TOKEN, owner: env.TELEGRAM_OWNER_ID,
    apiKey: env.JUPITER_API_KEY || '', rpc, keyPath: env.WALLET_KEYPAIR_PATH,
    dataDir: resolve(env.DATA_DIR || './data'),
    slippage: integer('SLIPPAGE_BPS', 50, 1, 300),
    ttl: integer('QUOTE_TTL_SECONDS', 20, 5, 30) * 1000,
    tokens: { ...TOKENS, DOGE: { mint: dogeMint, decimals: dogeDecimals } },
    pairReady: true,
    marketType: 'pair', trackedAsset: base,
    encryptionKey: '', // Supplied by the authenticated owner at wallet unlock, never from .env.
    maxTrade: amount(inverse ? 'MAX_TRADE_USDC' : 'MAX_TRADE_SOL', inverse ? '1' : '0.1', quoteDecimals), maxDaily: amount(inverse ? 'MAX_DAILY_USDC' : 'MAX_DAILY_SOL', inverse ? '5' : '0.5', quoteDecimals),
    reserve: amount('MIN_SOL_RESERVE', '0.02', 9), maxFee: amount('MAX_NETWORK_FEE_SOL', '0.01', 9),
    paper: { cbBTC: units(env.PAPER_CBBTC ?? '0', 8).toString(), USDC: units(env.PAPER_USDC ?? (inverse ? '1' : '0'), 6).toString(), DOGE: units(env.PAPER_DOGE ?? '0', dogeDecimals).toString(), SOL: units(env.PAPER_SOL ?? '1', 9).toString() },
    tradeSize: amount(inverse ? 'TRADE_SIZE_USDC' : 'TRADE_SIZE_SOL', inverse ? '0.25' : '0.025', quoteDecimals),
    sampleMs: integer('SAMPLE_SECONDS', 15, 15, 3600) * 1000,
    fast, slow,
    stopLoss: integer('STOP_LOSS_BPS', 200, 1, 9000),
    takeProfit: integer('TAKE_PROFIT_BPS', 300, 1, 50000),
  };
}
