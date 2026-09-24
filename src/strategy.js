import { config, format, UserError } from './config.js';

export function strategySettings(cfg) {
  return { fast: cfg.fast, slow: cfg.slow, interval: cfg.sampleMs / 1000,
    size: format(cfg.tradeSize, cfg.quoteDecimals), stopLoss: cfg.stopLoss / 100,
    takeProfit: cfg.takeProfit / 100, slippage: cfg.slippage / 100,
    maxTrade: format(cfg.maxTrade, cfg.quoteDecimals), maxDaily: format(cfg.maxDaily, cfg.quoteDecimals) };
}

export function validateStrategy(input, pair = 'CBBTC_SOL') {
  const keys = ['fast', 'slow', 'interval', 'size', 'stopLoss', 'takeProfit', 'slippage', 'maxTrade', 'maxDaily'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== keys.length ||
      keys.some(k => !Object.hasOwn(input, k) || !['string', 'number'].includes(typeof input[k]) || !/^\d+(\.\d+)?$/.test(String(input[k]))))
    throw new UserError('Provide all nine strategy settings as positive decimal numbers.');
  const bps = value => {
    const n = Number(value) * 100;
    if (!Number.isFinite(n) || Math.abs(n - Math.round(n)) > 1e-7) throw new UserError('Percentages allow at most two decimal places.');
    return String(Math.round(n));
  };
  try {
    const cfg = config({ TRADING_PAIR: pair.startsWith('TOKEN_') ? 'CBBTC_SOL' : pair, EMA_FAST: String(input.fast), EMA_SLOW: String(input.slow), SAMPLE_SECONDS: String(input.interval),
      [pair === 'SOL_USDC' ? 'TRADE_SIZE_USDC' : 'TRADE_SIZE_SOL']: String(input.size), STOP_LOSS_BPS: bps(input.stopLoss), TAKE_PROFIT_BPS: bps(input.takeProfit),
      SLIPPAGE_BPS: bps(input.slippage), [pair === 'SOL_USDC' ? 'MAX_TRADE_USDC' : 'MAX_TRADE_SOL']: String(input.maxTrade), [pair === 'SOL_USDC' ? 'MAX_DAILY_USDC' : 'MAX_DAILY_SOL']: String(input.maxDaily) }, false);
    if (BigInt(cfg.tradeSize) > BigInt(cfg.maxTrade) || BigInt(cfg.maxTrade) > BigInt(cfg.maxDaily))
      throw new UserError('Trade size must be ≤ maximum entry ≤ daily limit.');
    return { quoteDecimals: cfg.quoteDecimals, fast: cfg.fast, slow: cfg.slow, sampleMs: cfg.sampleMs, tradeSize: cfg.tradeSize,
      stopLoss: cfg.stopLoss, takeProfit: cfg.takeProfit, slippage: cfg.slippage, maxTrade: cfg.maxTrade, maxDaily: cfg.maxDaily };
  } catch (error) { throw new UserError(error.message); }
}
