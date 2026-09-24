// Use integer ratios so small-token and exact-boundary prices do not lose precision.
export function stopLevel(position, cfg) {
  const amount = BigInt(position.amount), unit = 10n ** BigInt(cfg.tokens[cfg.base].decimals);
  const denominator = amount * 10000n;
  const entryStop = BigInt(position.cost) * unit * BigInt(10000 - cfg.stopLoss);
  const trailingStop = position.slHigh ? BigInt(position.slHigh) * amount * BigInt(10000 - cfg.stopLoss) : 0n;
  return { numerator: trailingStop > entryStop ? trailingStop : entryStop, denominator };
}

export function advanceStop(position, price, cfg) {
  const last = BigInt(price), amount = BigInt(position.amount);
  const unit = 10n ** BigInt(cfg.tokens[cfg.base].decimals);
  const activated = last * amount * 10000n >= BigInt(position.cost) * unit * BigInt(10000 + cfg.stopLoss);
  if ((position.slHigh || activated) && last > BigInt(position.slHigh || '0')) return { ...position, slHigh: last.toString() };
  return position;
}
