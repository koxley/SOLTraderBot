import { config, format, UserError, TRACKED_ASSETS } from './config.js';

export function strategySettings(cfg) {
  return { marketType: cfg.marketType || 'pair', asset: cfg.trackedAsset || cfg.base, type: cfg.strategyType || 'ema', rsiPeriod: cfg.rsiPeriod ?? 14, rsiBuy: cfg.rsiBuy ?? 30, rsiSell: cfg.rsiSell ?? 70, bbPeriod: cfg.bbPeriod ?? 20, bbDeviation: cfg.bbDeviation ?? 2, fast: cfg.fast, slow: cfg.slow, interval: cfg.sampleMs / 1000,
    size: format(cfg.tradeSize, cfg.quoteDecimals), stopLoss: cfg.stopLoss / 100,
    takeProfit: cfg.takeProfit / 100, slippage: cfg.slippage / 100,
    maxTrade: format(cfg.maxTrade, cfg.quoteDecimals), maxDaily: format(cfg.maxDaily, cfg.quoteDecimals) };
}

export function validateStrategy(input, pair = 'CBBTC_SOL') {
  const keys = ['fast', 'slow', 'interval', 'size', 'stopLoss', 'takeProfit', 'slippage', 'maxTrade', 'maxDaily'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => ![...keys, 'marketType', 'asset', 'type', 'rsiPeriod', 'rsiBuy', 'rsiSell', 'bbPeriod', 'bbDeviation'].includes(k)) ||
      keys.some(k => !Object.hasOwn(input, k) || !['string', 'number'].includes(typeof input[k]) || !/^\d+(\.\d+)?$/.test(String(input[k]))))
    throw new UserError('Provide all nine strategy settings as positive decimal numbers.');
  const strategyType = Object.hasOwn(input, 'type') ? input.type : 'ema';
  if (!['ema', 'sma', 'rsi', 'bollinger'].includes(strategyType)) throw new UserError('Choose a supported strategy.');
  const marketType = Object.hasOwn(input, 'marketType') ? input.marketType : 'pair';
  if (!['pair', 'track'].includes(marketType)) throw new UserError('Choose paired trading or single-coin tracking.');
  const pairAsset = pair === 'SOL_USDC' ? 'SOL' : pair === 'USDC_SOL' ? 'USDC' : pair === 'DOGE_SOL' ? 'DOGE' : pair === 'CBBTC_SOL' ? 'cbBTC' : null;
  const selectedAsset = Object.hasOwn(input, 'asset') ? input.asset : pairAsset;
  if (marketType === 'track' && !TRACKED_ASSETS.includes(selectedAsset)) throw new UserError('Choose SOL, ETH, DOGE, XRP, USDC, or USDT for tracking.');
  const trackedAsset = TRACKED_ASSETS.includes(selectedAsset) ? selectedAsset : 'SOL';
  const numeric = (key, fallback, min, max, integer = false) => {
    const value = Object.hasOwn(input, key) ? input[key] : fallback;
    const n = Number(value);
    if (!['number', 'string'].includes(typeof value) || !/^\d+(\.\d+)?$/.test(String(value)) || !Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
      throw new UserError(`${key} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
    return n;
  };
  const extra = { strategyType, rsiPeriod: numeric('rsiPeriod', 14, 2, 200, true), rsiBuy: numeric('rsiBuy', 30, 1, 99), rsiSell: numeric('rsiSell', 70, 1, 99), bbPeriod: numeric('bbPeriod', 20, 2, 200, true), bbDeviation: numeric('bbDeviation', 2, 0.5, 5) };
  if (extra.rsiBuy >= extra.rsiSell) throw new UserError('RSI entry threshold must be below its exit threshold.');
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
    return { ...extra, marketType, trackedAsset, quoteDecimals: cfg.quoteDecimals, fast: cfg.fast, slow: cfg.slow, sampleMs: cfg.sampleMs, tradeSize: cfg.tradeSize,
      stopLoss: cfg.stopLoss, takeProfit: cfg.takeProfit, slippage: cfg.slippage, maxTrade: cfg.maxTrade, maxDaily: cfg.maxDaily };
  } catch (error) { throw new UserError(error.message); }
}
