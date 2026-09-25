import { lotsOf, aggregate, reduceLots, availableQuote, percentAmount } from './positions.js';
import { warmup, alternativeSignal } from './indicators.js';
import { randomUUID } from 'node:crypto';
import { UserError, format, units } from './config.js';
import { strategySettings, validateStrategy } from './strategy.js';
import { ASSETS, assetConfig, resolveAsset, selectedPreset } from './assets.js';

const unresolved = new Set(['submitting', 'unknown']);
const positiveInteger = n => typeof n === 'string' && /^\d+$/.test(n) && BigInt(n) > 0n;

export function validateQuote(q, input, output, amount, cfg, live = false) {
  if (q.error || q.errorCode || q.inputMint !== cfg.tokens[input].mint || q.outputMint !== cfg.tokens[output].mint ||
    q.inAmount !== amount || !positiveInteger(q.outAmount) || !positiveInteger(q.otherAmountThreshold) ||
    !Number.isInteger(q.slippageBps) || q.slippageBps < 0 || q.slippageBps > cfg.slippage || q.swapMode !== 'ExactIn')
    throw new UserError('Quote failed token, amount, or slippage validation.');
  const floor = BigInt(q.outAmount) * BigInt(10000 - cfg.slippage) / 10000n;
  if (BigInt(q.otherAmountThreshold) < floor || BigInt(q.otherAmountThreshold) > BigInt(q.outAmount))
    throw new UserError('Quote minimum output is outside configured limits.');
  if (live && (!q.transaction || !q.requestId || q.router === 'jupiterz'))
    throw new UserError('No supported executable route.');
  return q;
}

export function ema(values, period) {
  if (!values.length) return 0;
  period = Math.min(period, values.length);
  let result = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) result += alpha * (values[i] - result);
  return result;
}

export function signal(samples, position, cfg) {
  if (!samples.length) return null;
  if (position) {
    const last = BigInt(samples.at(-1).price), amount = BigInt(position.amount), cost = BigInt(position.cost);
    const scale = 10n ** BigInt(cfg.tokens[cfg.base].decimals);
    if (last * amount * 10000n <= cost * scale * BigInt(10000 - cfg.stopLoss))
      return { side: 'sell', reason: 'Stop loss', exitAll: true };
    if (last * amount * 10000n >= cost * scale * BigInt(10000 + cfg.takeProfit))
      return { side: 'sell', reason: 'Take profit', exitAll: true };
  }
  if (samples.length < warmup(cfg)) return null;
  const prices = samples.map(s => Number(s.price));
  if (cfg.strategyType && cfg.strategyType !== 'ema') return alternativeSignal(prices, position, cfg);
  const fast = ema(prices, cfg.fast), slow = ema(prices, cfg.slow);
  const previous = prices.slice(0, -1);
  if (ema(previous, cfg.fast) <= ema(previous, cfg.slow) && fast > slow)
    return { side: 'buy', reason: 'EMA crossed up' };
  if (position && ema(previous, cfg.fast) >= ema(previous, cfg.slow) && fast < slow)
    return { side: 'sell', reason: 'EMA crossed down' };
  return null;
}

export function trackingSignal(samples, cfg) {
  if (samples.length < warmup(cfg)) return { state: 'warming', reason: 'Collecting price samples' };
  const decision = signal(samples, null, cfg);
  if (decision) return { state: 'entry', reason: decision.reason };
  const prices = samples.map(s => Number(s.price));
  if ((cfg.strategyType || 'ema') === 'ema')
    return { state: ema(prices, cfg.fast) >= ema(prices, cfg.slow) ? 'bullish' : 'bearish', reason: 'Current EMA direction' };
  return { state: 'watching', reason: `Monitoring ${(cfg.strategyType || 'ema').toUpperCase()} conditions` };
}

export class Engine {
  constructor(cfg, store, jupiter, wallet = null, now = () => Date.now()) {
    const selectedAsset = store.get('selectedAsset');
    if (selectedAsset) Object.assign(cfg, assetConfig(cfg, selectedAsset));
    Object.assign(this, { cfg, store, jupiter, wallet, now });
    this.busy = false;
    this.stopping = false;
    this.generation = 0;
    this.closing = false;
    this.defaultStrategy = strategySettings(cfg);
    // Never interpret a position from a different trading direction as this market.
    const otherPairs = ['DOGE_SOL', 'SOL_USDC', 'USDC_SOL', 'CBBTC_SOL'].filter(pair => pair !== cfg.pair);
    if (store.livePositionKeys().some(key => key !== `${cfg.pair === 'DOGE_SOL' ? '' : cfg.pair + ':'}live:position`) || otherPairs.some(pair => store.get(`${pair === 'DOGE_SOL' ? '' : pair + ':'}live:position`)) ||
        store.orders().some(o => o.mode === 'live' && (o.pair || 'DOGE_SOL') !== cfg.pair && unresolved.has(o.status)))
      throw new Error('Close or reconcile the legacy DOGE or other market live position before changing trading direction.');
    if (store.get(`${cfg.pair === 'DOGE_SOL' ? '' : cfg.pair + ':'}live:position`) ||
        store.orders().some(o => o.mode === 'live' && (o.pair || 'DOGE_SOL') === cfg.pair && unresolved.has(o.status))) cfg.mode = 'live';
    // SOL-denominated user settings carry forward; holdings and trade history do not.
    if (cfg.pair === 'CBBTC_SOL') {
      for (const mode of ['paper', 'live']) for (const name of ['strategy', 'startingBalance']) {
        const target = `CBBTC_SOL:${mode}:${name}`, previous = store.get(`USDC_SOL:${mode}:${name}`);
        if (store.get(target) === undefined && previous !== undefined) store.set(target, previous);
      }
    }
    if (!store.get(this.paperKey())) store.set(this.paperKey(), { ...cfg.paper, [cfg.base]: cfg.paper[cfg.base] || '0' });
    const marketKey = cfg.pair === 'DOGE_SOL' ? 'market' : `market:${cfg.pair}`;
    const market = cfg.pair === 'DOGE_SOL' ? `${cfg.tokens.DOGE.mint}:${cfg.tokens.DOGE.decimals}` : `${cfg.tokens[cfg.base].mint}:${cfg.tokens[cfg.quote].mint}`;
    const existingMarket = this.store.get(marketKey);
    if (existingMarket && existingMarket !== market) throw new Error('Token configuration changed. Use a separate DATA_DIR for a different token.');
    this.store.set(marketKey, market);
    if (wallet && cfg.mode === 'live') this.bindWallet(wallet.address);
    // A host restart must never silently resume automated spending.
    this.store.set('running', false);
    let saved = this.store.get(this.key('strategy'));
    // One-time upgrade of the slow paper preset; retain size, limits, asset and all holdings.
    if (cfg.mode === 'paper' && !store.get(this.key('responsivePresetV1'))) {
      if (saved?.type === 'sma' && Number(saved.fast) === 10 && Number(saved.slow) === 30 && Number(saved.interval) === 60) {
        saved = { ...saved, fast: 5, slow: 12, interval: 30 };
        store.atomic(() => {
          store.set(this.key('strategy'), saved); store.set(this.key('samples'), []);
          store.set(this.key('tracker'), null);
        });
      }
      store.set(this.key('responsivePresetV1'), true);
    }
    if (saved) Object.assign(this.cfg, validateStrategy(saved, cfg.pair, true));
    else this.cfg.tradePercentBps = Math.max(1, Math.min(10000, Math.round(this.defaultStrategy.sizePercent * 100)));
    this.finishSessionReset();
  }
  configure(settings) {
    if (this.busy || this.closing || this.pending().length)
      throw new UserError('Wait for the current trade to settle before changing the strategy.');
    const next = validateStrategy(settings, this.cfg.pair);
    const previousSettings = strategySettings(this.cfg), nextSettings = strategySettings(next);
    if (this.active() && nextSettings.selectTopTrading !== previousSettings.selectTopTrading)
      throw new UserError('Stop the bot before changing Select Top Trading.');
    const marketChanged = nextSettings.marketType !== previousSettings.marketType ||
      (nextSettings.marketType === 'track' && nextSettings.asset !== previousSettings.asset);
    if (marketChanged && this.position()) throw new UserError('Close the open position before changing between trading and tracking.');
    const reset = marketChanged || ['type', 'fast', 'slow', 'interval', 'rsiPeriod', 'rsiBuy', 'rsiSell', 'bbPeriod', 'bbDeviation'].some(k => nextSettings[k] !== previousSettings[k]);
    this.store.atomic(() => {
      this.store.set(this.key('strategy'), nextSettings);
      if (reset) { this.store.set(this.key('samples'), []); this.store.set(this.key('chartSamples'), []); this.store.set(this.key('tracker'), null); }
    });
    if (marketChanged) this.stop();
    Object.assign(this.cfg, next);
  }
  async configureWhenReady(settings) {
    const requested = validateStrategy(settings, this.cfg.pair);
    const key = this.key('strategy'), deadline = Date.now() + 15000;
    while (this.busy && !this.closing && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
    if (key !== this.key('strategy')) throw new UserError('Market or mode changed. Reload settings and try again.');
    this.configure(settings);
    return requested;
  }
  async configureWithTopSelection(settings, resolve = resolveAsset) {
    const requested = validateStrategy(settings, this.cfg.pair);
    if (!requested.selectTopTrading || this.active()) {
      await this.configureWhenReady(settings);
      return null;
    }
    if (this.busy || this.closing || this.pending().length)
      throw new UserError('Wait for the current trade to settle before changing the strategy.');
    const selection = await this.jupiter.topTradingAsset(ASSETS);
    const currentMint = this.cfg.tokens[this.cfg.base]?.mint;
    if (selection.asset.mint !== currentMint)
      await this.changeAsset({ preset: selection.asset.symbol }, resolve, { topTrading: true });
    this.configure({ ...settings, marketType: 'pair', asset: selection.asset.symbol, selectTopTrading: true });
    return selection;
  }
  async changeAsset(input, resolve = resolveAsset, { topTrading = false } = {}) {
    if (this.cfg.quote !== 'SOL') throw new UserError('Asset selection requires SOL-funded trading.');
    if (this.active() || this.busy || this.closing || this.store.orders().some(o => unresolved.has(o.status)))
      throw new UserError('Stop the bot and settle all trades before changing asset.');
    const prefix = this.cfg.pair === 'DOGE_SOL' ? '' : this.cfg.pair + ':';
    if (['paper', 'live'].some(mode => this.store.get(`${prefix}${mode}:position`)))
      throw new UserError('Close your paper and live positions before changing asset.');
    const generation = this.generation;
    this.busy = true;
    try {
      const preset = selectedPreset(input);
      const resolved = await resolve(input, this.cfg);
      if (resolved.mint !== preset.mint || resolved.symbol !== preset.symbol || resolved.decimals !== preset.decimals)
        throw new UserError('Asset validation did not match the selected preset.');
      const asset = this.store.get(`asset:${resolved.mint}`) || resolved;
      const next = assetConfig(this.cfg, asset);
      if (generation !== this.generation || this.closing) throw new UserError('Asset change cancelled. Try again while stopped.');
      const savedSettings = this.store.get(`${next.pair}:${this.cfg.mode}:strategy`) || strategySettings(this.cfg);
      const settings = validateStrategy(topTrading ? { ...savedSettings, marketType: 'pair', asset: asset.symbol, selectTopTrading: true } : savedSettings, next.pair);
      const startingBalance = this.store.get(this.key('startingBalance')) || '1000000000';
      this.store.atomic(() => {
        this.store.set('selectedAsset', asset);
        this.store.set(`asset:${asset.mint}`, asset);
        if (!this.store.get(`paper:${next.pair}`)) this.store.set(`paper:${next.pair}`, { SOL: startingBalance, [asset.symbol]: '0' });
        if (this.store.get(`${next.pair}:paper:startingBalance`) === undefined) this.store.set(`${next.pair}:paper:startingBalance`, startingBalance);
        this.store.set(`${next.pair}:${this.cfg.mode}:strategy`, strategySettings({ ...this.cfg, ...settings }));
        this.store.set('lastError', '');
      });
      Object.assign(this.cfg, next, settings);
      this.stop();
    } finally { this.busy = false; }
  }
  key(name) { return `${this.cfg.pair === 'DOGE_SOL' ? '' : this.cfg.pair + ':'}${this.cfg.mode}:${name}`; }
  paperKey() { return this.cfg.pair === 'DOGE_SOL' ? 'paper' : `paper:${this.cfg.pair}`; }
  orders() { return this.store.orders().filter(o => (o.pair || 'DOGE_SOL') === this.cfg.pair); }
  market() {
    if ((this.cfg.marketType || 'pair') === 'pair')
      return { asset: this.cfg.base, reference: this.cfg.quote, executable: true };
    const asset = this.cfg.trackedAsset;
    return { asset, reference: asset === 'USDC' ? 'USDT' : 'USDC', executable: false };
  }
  switchMode(mode, acknowledged = false) {
    if (!['paper', 'live'].includes(mode)) throw new UserError('Choose paper or live mode.');
    if (mode === this.cfg.mode) return;
    if (this.active() || this.busy || this.closing || this.store.orders().some(o => unresolved.has(o.status)))
      throw new UserError('Stop the bot and reconcile unsettled trades before switching mode.');
    if (this.cfg.mode === 'live' && this.position())
      throw new UserError('Close your live position before switching to paper mode.');
    if (mode === 'live' && this.market().executable && (!acknowledged || !this.wallet))
      throw new UserError('Unlock your wallet and acknowledge real-fund trading before selecting live.');
    const settings = validateStrategy(this.store.get(`${this.cfg.pair === 'DOGE_SOL' ? '' : this.cfg.pair + ':'}${mode}:strategy`) || this.defaultStrategy, this.cfg.pair, true);
    if (mode === 'live') this.bindWallet(this.wallet.address);
    this.stop();
    Object.assign(this.cfg, settings, { mode });
    this.store.set('lastError', '');
  }
  bindWallet(address) {
    const bound = this.store.get('walletAddress');
    if (bound && bound !== address) throw new Error('Wallet changed. Use a separate DATA_DIR.');
    this.store.set('walletAddress', address);
  }
  position() { return this.store.get(this.key('position')) || null; }
  pending() { return this.orders().filter(o => o.mode === this.cfg.mode && unresolved.has(o.status)); }
  setPaperBalance(amount) {
    if (this.cfg.mode !== 'paper') throw new UserError('Live balances come from the wallet and cannot be edited.');
    if (this.active() || this.busy || this.closing || this.pending().length)
      throw new UserError('Stop the bot and settle pending trades before changing the paper balance.');
    const value = units(amount, this.cfg.quoteDecimals).toString();
    this.store.atomic(() => {
      this.store.set(this.key('startingBalance'), value);
      this.store.set(this.paperKey(), { ...this.store.get(this.paperKey()), [this.cfg.quote]: value });
    });
  }
  resetPaperSession() {
    if (this.cfg.mode !== 'paper' || this.active() || this.busy || this.closing || this.pending().length) return;
    const realized = this.orders().filter(order => order.mode === 'paper')
      .reduce((sum, order) => sum + BigInt(order.realizedQuote || order.realizedSOL || '0'), 0n);
    this.store.atomic(() => {
      this.store.set(this.paperKey(), { ...this.store.get(this.paperKey()), [this.cfg.quote]: (10n ** BigInt(this.cfg.quoteDecimals)).toString() });
      this.store.set(this.key('realizedBaseline'), realized.toString());
    });
  }
  resetPaperSOL() {
    if (this.cfg.mode !== 'paper' || this.active() || this.busy || this.closing || this.pending().length) return;
    this.store.set(this.paperKey(), { ...this.store.get(this.paperKey()), [this.cfg.quote]: (10n ** BigInt(this.cfg.quoteDecimals)).toString() });
  }
  resetRealizedReturn() {
    const realized = this.orders().filter(order => order.mode === this.cfg.mode)
      .reduce((sum, order) => sum + BigInt(order.realizedQuote || order.realizedSOL || '0'), 0n);
    this.store.set(this.key('realizedBaseline'), realized.toString());
  }
  chartHistoryKey() {
    const market = this.market();
    return `chartHistory:${this.cfg.tokens[market.asset].mint}:${this.cfg.tokens[market.reference].mint}`;
  }
  rememberChart(samples) {
    const key = this.chartHistoryKey(), now = this.now();
    const buckets = new Map();
    for (const sample of [...(this.store.get(key) || []), ...samples]) {
      if (!Number.isFinite(sample.time) || sample.time < now - 15 * 60 * 1000 || sample.time > now || !/^\d+$/.test(String(sample.price)) || BigInt(sample.price) <= 0n) continue;
      const time = Math.floor(sample.time / 5000) * 5000;
      buckets.set(time, { time, price: String(sample.price) });
    }
    const history = [...buckets.values()].sort((a,b) => a.time-b.time).slice(-180);
    this.store.set(key, history); return history;
  }
  restoreChart() {
    if (this.store.get(this.key('resetRequested'))) return;
    const history = this.rememberChart([...(this.store.get(this.key('samples')) || []), ...(this.store.get(this.key('chartSamples')) || [])]);
    this.store.set(this.key('chartSamples'), history);
    this.store.set(this.key('chartReset'), false);
  }
  start() {
    if (this.market().executable && !this.cfg.pairReady) throw new UserError('Trading pair is not configured.');
    if (this.market().executable && this.cfg.mode === 'live' && !this.wallet) throw new UserError('Create your wallet in the app first.');
    if (this.closing || this.busy) throw new UserError('An operation is in progress. Wait for it to finish.');
    if (this.pending().length) throw new UserError('An unsettled trade blocks starting. Use /reconcile.');
    if (this.market().executable) this.resetPaperSOL();
    this.resetRealizedReturn();
    this.restoreChart();
    this.stopping = false;
    this.store.set(this.key('chartReset'), false);
    this.store.set('running', true);
    this.store.set('errors', 0);
    this.store.set('lastError', '');
  }
  async startWithSelection(resolve = resolveAsset) {
    if (!this.cfg.selectTopTrading) { this.start(); return null; }
    if (this.active()) throw new UserError('The bot is already running.');
    if (this.market().executable && !this.cfg.pairReady) throw new UserError('Trading pair is not configured.');
    if (this.market().executable && this.cfg.mode === 'live' && !this.wallet) throw new UserError('Create your wallet in the app first.');
    if (this.closing || this.busy) throw new UserError('An operation is in progress. Wait for it to finish.');
    if (this.pending().length) throw new UserError('An unsettled trade blocks starting. Use /reconcile.');
    const selection = await this.jupiter.topTradingAsset(ASSETS);
    const currentMint = this.cfg.tokens[this.cfg.base]?.mint;
    if (selection.asset.mint !== currentMint)
      await this.changeAsset({ preset: selection.asset.symbol }, resolve, { topTrading: true });
    this.start();
    return selection;
  }
  stop(resetSession = false) {
    this.generation++; this.stopping = true; this.closing = false; this.store.set('running', false);
    if (resetSession) { this.store.set(this.key('resetRequested'), true); this.finishSessionReset(); }
  }
  finishSessionReset() {
    if (!this.store.get(this.key('resetRequested'))) return;
    const orders = this.orders().filter(o => o.mode === this.cfg.mode);
    this.rememberChart([...(this.store.get(this.key('samples')) || []), ...(this.store.get(this.key('chartSamples')) || [])]);
    this.store.atomic(() => {
      // Keep the accounting ledger for open-buy relationships, reconciliation and accounting.
      this.store.set(this.key('hiddenHistory'), orders.map(o => o.id));
      this.store.set(this.key('realizedBaseline'), orders.reduce((n,o) => n + BigInt(o.realizedQuote || o.realizedSOL || '0'), 0n).toString());
      this.store.set(this.key('samples'), []); this.store.set(this.key('chartSamples'), []);
      this.store.set(this.key('tracker'), null); this.store.set(this.key('chartReset'), true);
      if (!this.busy && !this.pending().length) {
        if (this.cfg.mode === 'paper') this.store.set(this.paperKey(), { ...this.store.get(this.paperKey()), [this.cfg.quote]: (10n ** BigInt(this.cfg.quoteDecimals)).toString() });
        this.store.set(this.key('resetRequested'), false);
      }
    });
  }
  requestClose() { if (!this.market().executable) throw new UserError('Single-coin tracking has no position to close.'); this.stop(); this.closing = true; }
  active() { return !this.stopping && this.store.get('running') === true; }
  async balances() { return this.cfg.mode === 'paper' ? this.store.get(this.paperKey()) : this.wallet ? this.wallet.balances() : { SOL: '0', [this.cfg.splToken]: '0' }; }
  budget(notional) {
    if (notional > BigInt(this.cfg.maxTrade)) throw new UserError('Per-trade limit exceeded. Adjust limits before restarting.');

  }
  async tick() {
    if (this.busy || (!this.active() && !this.closing)) return null;
    this.busy = true;
    try {
      if (this.pending().length) throw new UserError('Unsettled trade; use /reconcile.');
      if (this.closing) {
        if (!this.position()) { this.closing = false; return 'No bot position is open. Bot remains stopped.'; }
        const result = await this.trade({ side: 'sell', reason: 'Close Open Positions' }, true);
        this.closing = false;
        return result;
      }
      const now = this.now();
      let samples = this.store.get(this.key('samples')) || [];
      if (samples.length && now - samples.at(-1).time < this.cfg.sampleMs) return null;
      if (samples.length && now - samples.at(-1).time > this.cfg.sampleMs * 3) samples = [];
      const market = this.market();
      const amount = (10n ** BigInt(this.cfg.tokens[market.asset].decimals)).toString();
      const q = validateQuote(await this.jupiter.quote(market.asset, market.reference, amount), market.asset, market.reference, amount, this.cfg);
      samples.push({ time: this.now(), price: q.outAmount });
      samples = samples.slice(-Math.max(10, this.cfg.slow + 1, (this.cfg.rsiPeriod ?? 14) + 2, (this.cfg.bbPeriod ?? 20) + 1) * 10);
      this.store.set(this.key('samples'), samples);
      this.rememberChart([{ time: this.now(), price: q.outAmount }]);
      this.store.set('lastTick', this.now());
      if (!market.executable) {
        const tracked = trackingSignal(samples, this.cfg);
        this.store.set(this.key('tracker'), tracked);
        this.store.set('errors', 0);
        return tracked.state === 'entry' ? `${market.asset} tracking signal: ${tracked.reason}. No trade was submitted.` : null;
      }
      const decision = signal(samples, this.position(), this.cfg);
      if (!decision || !this.active()) { this.store.set('errors', 0); return null; }
      const result = await this.trade(decision, decision.exitAll === true);
      this.store.set('errors', 0);
      return result;
    } catch (error) {
      const failures = (this.store.get('errors') || 0) + 1;
      this.store.set('errors', failures);
      if (error instanceof UserError || failures >= 3) this.stop();
      this.store.set('lastError', error instanceof UserError ? error.message : 'Provider or storage error. Check connectivity.');
      // Never relay raw RPC errors: they may contain private provider URLs.
      return `${this.active() ? 'Temporary failure' : 'Bot stopped'}: ${error instanceof UserError ? error.message : 'Provider or storage error; inspect connectivity and /status.'}`;
    } finally { this.busy = false; this.finishSessionReset(); }
  }
  async trade({ side, reason, lotId }, forceExit = false) {
    if (!this.market().executable) throw new UserError('Single-coin tracking never submits trades.');
    const generation = this.generation;
    const allowed = () => generation === this.generation && (this.active() || forceExit);
    const input = side === 'buy' ? this.cfg.quote : this.cfg.base, output = side === 'buy' ? this.cfg.base : this.cfg.quote;
    const balances = await this.balances();
    if (!allowed()) return 'Stopped before trade submission.';
    const position = this.position();
    const lot = lotId ? lotsOf(position).find(p => p.id === lotId) : null;
    const held = BigInt(position?.amount || '0');
    const amount = (side === 'buy' ? percentAmount(availableQuote(balances, this.cfg), this.cfg.tradePercentBps) :
      forceExit ? held : lotId ? BigInt(lot?.amount || '0') : percentAmount(held, this.cfg.tradePercentBps)).toString();
    if (BigInt(amount) === 0n) return 'Signal skipped: available balance is too small for the configured percentage.';
    const fetchedAt = this.now();
    const q = validateQuote(await this.jupiter.quote(input, output, amount, this.cfg.mode === 'live' ? this.wallet?.address : undefined), input, output, amount, this.cfg, this.cfg.mode === 'live');
    if (this.cfg.mode === 'live' && q.taker !== this.wallet.address) throw new UserError('Quote wallet mismatch.');
    const notional = BigInt(side === 'buy' ? amount : q.outAmount);
    // Entry limits must never trap an existing position after a price increase.
    if (side === 'buy') this.budget(notional);
    if (BigInt(balances[input]) < BigInt(amount)) throw new UserError(`Insufficient ${input} balance.`);
    if (this.cfg.mode === 'live') {
      const fees = ['signatureFeeLamports', 'prioritizationFeeLamports', 'rentFeeLamports'].reduce((sum, key) => {
        if (!Number.isSafeInteger(q[key]) || q[key] < 0) throw new UserError('Missing or invalid network fee estimate.');
        return sum + BigInt(q[key]);
      }, 0n);
      if (fees > BigInt(this.cfg.maxFee)) throw new UserError('Network fee estimate exceeds limit.');
      if (BigInt(balances.SOL) - (input === 'SOL' ? BigInt(amount) : 0n) < (side === 'buy' ? BigInt(this.cfg.reserve) : 0n) + fees)
        throw new UserError('Insufficient SOL gas reserve.');
    }
    if (!allowed()) return 'Stopped before trade submission.';
    const order = { id: randomUUID(), ...(lotId ? { lotId } : {}), pair: this.cfg.pair, mode: this.cfg.mode, side, reason, input, output, amount,
      expected: q.outAmount, minimum: q.otherAmountThreshold, notional: notional.toString(),
      day: new Date(this.now()).toISOString().slice(0, 10), time: this.now(), status: 'submitting' };
    if (this.cfg.mode === 'paper') {
      if (this.now() - fetchedAt > this.cfg.ttl) throw new UserError('Quote expired.');
      this.fill(order, amount, q.otherAmountThreshold);
      return this.describe(order);
    }
    const prepared = await this.wallet.prepare(q);
    if (!allowed()) return 'Stopped before trade submission.';
    if (this.now() - fetchedAt > this.cfg.ttl) throw new UserError('Quote expired during preflight; no trade submitted.');
    order.signature = prepared.signature;
    order.requestId = q.requestId;
    order.lastValidBlockHeight = q.lastValidBlockHeight || null;
    // Commit the signature before sending. A crash can then never silently replay a trade.
    this.store.put(order);
    try {
      const result = await this.jupiter.execute(q, prepared.signed);
      if (result.status === 'Success' && result.code === 0 && result.signature === order.signature &&
          positiveInteger(result.totalInputAmount) && positiveInteger(result.totalOutputAmount)) {
        this.fill(order, result.totalInputAmount, result.totalOutputAmount);
        return this.describe(order);
      }
      // Even an API failure is reconciled on-chain instead of assumed safe to retry.
      throw new Error('Execution not conclusively confirmed.');
    } catch {
      order.status = 'unknown';
      this.store.put(order);
      this.stop();
      this.store.set('lastError', 'Trade outcome unknown. Use Check unsettled transaction before restarting.');
      return `Bot stopped: trade outcome unknown. No retry will be sent. Use /reconcile.\nhttps://solscan.io/tx/${order.signature}`;
    }
  }
  fill(order, actualInput, actualOutput) {
    this.store.atomic(() => {
      if (this.store.order(order.id)?.status === 'filled') return;
      if (order.mode === 'paper') {
        const b = this.store.get(this.paperKey());
        if (BigInt(b[order.input]) < BigInt(actualInput)) throw new UserError('Insufficient paper balance.');
        b[order.input] = (BigInt(b[order.input]) - BigInt(actualInput)).toString();
        b[order.output] = (BigInt(b[order.output]) + BigInt(actualOutput)).toString();
        this.store.set(this.paperKey(), b);
      }
      const old = this.position();
      if (order.side === 'buy') {
        this.store.set(this.key('position'), aggregate([...lotsOf(old), { id: order.id, amount: actualOutput, cost: actualInput, opened: this.now() }]));
      } else {
        const reduced = reduceLots(old, actualInput, order.lotId);
        let allocatedAmount = 0n, allocatedProceeds = 0n;
        order.buyAllocations = reduced.allocations.map(allocation => {
          allocatedAmount += BigInt(allocation.amount);
          const cumulative = BigInt(actualOutput) * allocatedAmount / BigInt(actualInput);
          const proceeds = cumulative - allocatedProceeds; allocatedProceeds = cumulative;
          return { ...allocation, proceeds: proceeds.toString(), realizedQuote: (proceeds - BigInt(allocation.cost)).toString() };
        });
        order.realizedQuote = (BigInt(actualOutput) - reduced.cost).toString();
        this.store.set(this.key('position'), reduced.position);
      }
      Object.assign(order, { status: 'filled', actualInput, actualOutput });
      this.store.put(order);
    });
  }
  async reconcile() {
    if (this.pending().length && !this.wallet) throw new UserError('Unlock your wallet before reconciling trades.');
    const results = [];
    for (const order of this.pending()) {
      const status = await this.wallet.status(order.signature);
      if (status?.err) { order.status = 'failed'; this.store.put(order); results.push(`${order.id.slice(0, 8)} failed on-chain.`); }
      else if (['confirmed', 'finalized'].includes(status?.confirmationStatus)) {
        const receipt = await this.wallet.receipt(order);
        if (!receipt) { results.push('Confirmed; waiting for transaction balance details.'); continue; }
        this.fill(order, receipt.input, receipt.output);
        results.push(this.describe(order));
      } else if (!status && order.lastValidBlockHeight && await this.wallet.expired(order.lastValidBlockHeight)) {
        // Recheck historical status after finalization has passed the transaction's validity window.
        const checked = await this.wallet.status(order.signature);
        if (!checked) { order.status = 'expired'; this.store.put(order); results.push(`${order.id.slice(0, 8)} expired without a recorded transaction. Bot remains stopped.`); }
        else results.push('Transaction status changed. Reconcile again before restarting.');
      } else results.push(`${order.id.slice(0, 8)} unresolved; bot remains stopped. Signature: ${order.signature}`);
    }
    this.finishSessionReset();
    return results.join('\n') || 'No unsettled trades.';
  }
  describe(o) {
    return `${o.mode.toUpperCase()} ${o.side.toUpperCase()} — ${o.reason}\n${format(o.actualInput, this.cfg.tokens[o.input].decimals)} ${o.input} → ${format(o.actualOutput, this.cfg.tokens[o.output].decimals)} ${o.output}${o.signature ? `\nhttps://solscan.io/tx/${o.signature}` : '\nSimulated fill; no real funds moved.'}`;
  }
  status() {
    const samples = this.store.get(this.key('samples')) || [];
    const p = this.position();
    const market = this.market();
    const heading = market.executable ? `${market.asset}/${market.reference} trading` : `${market.asset} single-coin tracking (${market.reference} reference; no trades)`;
    return `${this.cfg.mode.toUpperCase()} · ${this.active() ? 'RUNNING' : 'STOPPED'}\n${heading} · ${(this.cfg.strategyType || "ema").toUpperCase()} · ${this.cfg.sampleMs / 1000}s samples\nWarm-up: ${Math.min(samples.length, warmup(this.cfg))}/${warmup(this.cfg)}\nLast sample: ${samples.length ? new Date(samples.at(-1).time).toISOString() : 'none'}${market.executable ? `\nTrade size: ${this.cfg.tradePercentBps / 100}% of available balance\nStop loss: ${this.cfg.stopLoss / 100}% · Take profit: ${this.cfg.takeProfit / 100}%\nSlippage: ${this.cfg.slippage / 100}%\nLimits: ${format(this.cfg.maxTrade, this.cfg.quoteDecimals)} ${this.cfg.quote}/trade\nPosition: ${p ? `${format(p.amount, this.cfg.tokens[this.cfg.base].decimals)} ${this.cfg.base}; cost ${format(p.cost, this.cfg.quoteDecimals)} ${this.cfg.quote}` : 'none'}\nUnsettled trades: ${this.pending().length}` : `\nTracker: ${this.store.get(this.key('tracker'))?.state || 'warming'}\nNo swaps or positions are created in tracking mode.`}`;
  }
}
