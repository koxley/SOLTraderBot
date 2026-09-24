// A legacy aggregate position is treated as one buy lot without changing its basis.
export function lotsOf(position) {
  if (!position) return [];
  return position.lots || [{ ...position, id: position.id || 'legacy' }];
}
export function aggregate(lots) {
  if (!lots.length) return null;
  return { amount: lots.reduce((n, p) => n + BigInt(p.amount), 0n).toString(),
    cost: lots.reduce((n, p) => n + BigInt(p.cost), 0n).toString(), opened: lots[0].opened,
    ...(lots.length === 1 && lots[0].slHigh ? { slHigh: lots[0].slHigh } : {}), lots };
}
export function reduceLots(position, amount, lotId) {
  let remaining = BigInt(amount), cost = 0n;
  const allocations = [];
  const lots = lotsOf(position).map(lot => {
    if (!remaining || (lotId && lot.id !== lotId)) return lot;
    const held = BigInt(lot.amount), sold = remaining < held ? remaining : held;
    const basis = sold === held ? BigInt(lot.cost) : BigInt(lot.cost) * sold / held;
    allocations.push({ buyId: lot.id, amount: sold.toString(), cost: basis.toString() });
    remaining -= sold; cost += basis;
    return { ...lot, amount: (held - sold).toString(), cost: (BigInt(lot.cost) - basis).toString() };
  }).filter(lot => BigInt(lot.amount) > 0n);
  if (remaining) throw new Error('Sell receipt exceeds tracked position inventory.');
  return { position: aggregate(lots), cost, allocations };
}
export function availableQuote(balances, cfg) {
  const held = BigInt(balances[cfg.quote] || '0');
  const reserved = cfg.mode === 'live' && cfg.quote === 'SOL' ? BigInt(cfg.reserve) + BigInt(cfg.maxFee) : 0n;
  return held > reserved ? held - reserved : 0n;
}
export function percentAmount(amount, bps) { return BigInt(amount) * BigInt(bps) / 10000n; }
