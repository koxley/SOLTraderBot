export function warmup() { return 10; }
export function sma(values, period) { const window = values.slice(-period); return window.length ? window.reduce((a, b) => a + b, 0) / window.length : 0; }
export function rsi(values, period) {
  period = Math.min(period, values.length - 1);
  if (period < 1) return 50;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const d = values[i] - values[i - 1]; gain += Math.max(0, d) / period; loss += Math.max(0, -d) / period; }
  for (let i = period + 1; i < values.length; i++) { const d = values[i] - values[i - 1]; gain = (gain * (period - 1) + Math.max(0, d)) / period; loss = (loss * (period - 1) + Math.max(0, -d)) / period; }
  return loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss);
}
export function bands(values, period, deviation) {
  const middle = sma(values, period);
  const sd = Math.sqrt(values.slice(-period).reduce((sum, v) => sum + (v - middle) ** 2, 0) / Math.min(period, values.length));
  return { middle, lower: middle - deviation * sd, upper: middle + deviation * sd };
}
export function alternativeSignal(prices, position, cfg) {
  const previous = prices.slice(0, -1), last = prices.at(-1);
  if (cfg.strategyType === 'sma') {
    const fast = sma(prices, cfg.fast), slow = sma(prices, cfg.slow);
    if (sma(previous, cfg.fast) <= sma(previous, cfg.slow) && fast > slow) return { side: 'buy', reason: 'SMA crossed up' };
    if (position && sma(previous, cfg.fast) >= sma(previous, cfg.slow) && fast < slow) return { side: 'sell', reason: 'SMA crossed down' };
  }
  if (cfg.strategyType === 'rsi') {
    const value = rsi(prices, cfg.rsiPeriod);
    if (rsi(previous, cfg.rsiPeriod) <= cfg.rsiBuy && value > cfg.rsiBuy) return { side: 'buy', reason: 'RSI recovered above entry threshold' };
    if (position && rsi(previous, cfg.rsiPeriod) < cfg.rsiSell && value >= cfg.rsiSell) return { side: 'sell', reason: 'RSI crossed exit threshold' };
  }
  if (cfg.strategyType === 'bollinger') {
    const current = bands(prices, cfg.bbPeriod, cfg.bbDeviation), prior = bands(previous, cfg.bbPeriod, cfg.bbDeviation);
    if (position && previous.at(-1) < prior.middle && last >= current.middle) return { side: 'sell', reason: 'Price crossed Bollinger middle band' };
    if (previous.at(-1) < prior.lower && last >= current.lower) return { side: 'buy', reason: 'Price recovered inside Bollinger bands' };
  }
  return null;
}
