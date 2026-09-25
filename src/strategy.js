import { config, format, UserError, TRACKED_ASSETS, TOKENS } from './config.js';

export function strategySettings(cfg) {
  return { marketType: cfg.marketType || 'pair', asset: cfg.marketType === 'track' ? cfg.trackedAsset : (TRACKED_ASSETS.includes(cfg.trackedAsset || cfg.base) ? (cfg.trackedAsset || cfg.base) : TRACKED_ASSETS[0]), type: cfg.strategyType || 'ema', rsiPeriod: cfg.rsiPeriod ?? 14, rsiBuy: cfg.rsiBuy ?? 30, rsiSell: cfg.rsiSell ?? 70, bbPeriod: cfg.bbPeriod ?? 20, bbDeviation: cfg.bbDeviation ?? 2, fast: cfg.fast, slow: cfg.slow, interval: cfg.sampleMs / 1000,
    sizePercent: (cfg.tradePercentBps ?? Math.max(1, Math.min(10000, Number(BigInt(cfg.tradeSize) * 10000n / (10n ** BigInt(cfg.quoteDecimals)))))) / 100, slippage: cfg.slippage / 100,
    maxTrade: format(cfg.maxTrade, cfg.quoteDecimals), maxDaily: format(cfg.maxDaily, cfg.quoteDecimals) };
}

export function validateStrategy(input, pair = 'CBBTC_SOL', restore = false) {
  const keys = ['fast', 'slow', 'interval', 'slippage', 'maxTrade', 'maxDaily'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => ![...keys, 'stopLoss', 'takeProfit', 'marketType', 'asset', 'size', 'sizePercent', 'type', 'rsiPeriod', 'rsiBuy', 'rsiSell', 'bbPeriod', 'bbDeviation'].includes(k)) ||
      keys.some(k => !Object.hasOwn(input, k) || !['string', 'number'].includes(typeof input[k]) || !/^\d+(\.\d+)?$/.test(String(input[k]))))
    throw new UserError('Provide all required strategy settings as positive decimal numbers.');
  if (Object.hasOwn(input, 'size') === Object.hasOwn(input, 'sizePercent')) throw new UserError('Provide trade size as a percentage.');
  const strategyType = Object.hasOwn(input, 'type') ? input.type : 'ema';
  if (!['ema', 'sma', 'rsi', 'bollinger'].includes(strategyType)) throw new UserError('Choose a supported strategy.');
  const marketType = Object.hasOwn(input, 'marketType') ? input.marketType : 'pair';
  if (!['pair', 'track'].includes(marketType)) throw new UserError('Choose paired trading or single-coin tracking.');
  const pairAsset = pair === 'SOL_USDC' ? 'SOL' : pair === 'USDC_SOL' ? 'USDC' : pair === 'DOGE_SOL' ? 'DOGE' : pair === 'CBBTC_SOL' ? 'cbBTC' : null;
  const selectedAsset = Object.hasOwn(input, 'asset') ? input.asset : pairAsset;
  if (marketType === 'track' && !TRACKED_ASSETS.includes(selectedAsset) && !(restore && Object.hasOwn(TOKENS, selectedAsset))) throw new UserError('Choose a tracked coin from the supported Trading Asset list.');
  const trackedAsset = TRACKED_ASSETS.includes(selectedAsset) || (restore && marketType === 'track' && Object.hasOwn(TOKENS, selectedAsset)) ? selectedAsset : TRACKED_ASSETS[0];
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
    const tradePercentBps = Object.hasOwn(input, 'sizePercent') ? Number(bps(numeric('sizePercent', 2.5, 0.01, 100))) : Math.max(1, Math.min(10000, Math.round(numeric('size', 0.025, 0.000000001, 1000000000) * 10000)));
    if (tradePercentBps < 1 || tradePercentBps > 10000) throw new UserError('Trade size must be between 0.01% and 100%.');
    const cfg = config({ TRADING_PAIR: pair.startsWith('TOKEN_') ? 'CBBTC_SOL' : pair, EMA_FAST: String(input.fast), EMA_SLOW: String(input.slow), SAMPLE_SECONDS: String(input.interval),
      [pair === 'SOL_USDC' ? 'TRADE_SIZE_USDC' : 'TRADE_SIZE_SOL']: String(input.size ?? (pair === 'SOL_USDC' ? '0.000001' : '0.000000001')),
      SLIPPAGE_BPS: bps(input.slippage), [pair === 'SOL_USDC' ? 'MAX_TRADE_USDC' : 'MAX_TRADE_SOL']: String(input.maxTrade), [pair === 'SOL_USDC' ? 'MAX_DAILY_USDC' : 'MAX_DAILY_SOL']: String(input.maxDaily) }, false);
    if (BigInt(cfg.maxTrade) > BigInt(cfg.maxDaily))
      throw new UserError('Maximum entry must be no greater than the daily limit.');
    return { ...extra, marketType, trackedAsset, tradePercentBps, quoteDecimals: cfg.quoteDecimals, fast: cfg.fast, slow: cfg.slow, sampleMs: cfg.sampleMs, tradeSize: cfg.tradeSize,
      slippage: cfg.slippage, maxTrade: cfg.maxTrade, maxDaily: cfg.maxDaily };
  } catch (error) { throw new UserError(error.message); }
}

// Default button values are independent of saved settings and old deployment overrides.
export function recommendedDefaults(cfg) {
  return { ...strategySettings(cfg), type: 'sma', fast: 10, slow: 30, interval: 60,
    sizePercent: 10, maxTrade: cfg.quote === 'SOL' ? '0.1' : '1',
    maxDaily: cfg.quote === 'SOL' ? '0.5' : '5', slippage: 0.5 };
}
