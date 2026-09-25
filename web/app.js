const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const $ = id => document.getElementById(id);
const marketFields = document.createElement('div');
marketFields.className = 'settings-grid';
marketFields.innerHTML = '<label class="strategy-field" for="setting-marketType">Mode<select id="setting-marketType" name="marketType"><option value="pair">Paired trading</option><option value="track">Single coin tracking — no trades</option></select></label><label class="strategy-field" for="setting-asset">Tracked coin<select id="setting-asset" name="asset"></select></label>';
$('strategy-fields').prepend(marketFields);
let state = null, activeView = 'dashboard', toastTimer, actionBusy = false;
let settingsDirty = false, savingSettings = false;
let assetDirty = false, savingAsset = false;
let recentSince = Date.now();
let savingBalance = false;
let returnRate = null, returnRateAt = 0, returnRateBusy = false;
let livePrice = null, priceBusy = false, priceFailed = false;
function fillSettings(settings) {
  const tracked = $('setting-asset');
  tracked.replaceChildren();
  for (const asset of state?.assets || []) tracked.add(new Option(asset.symbol, asset.symbol));
  if (settings.marketType === 'track' && !state?.assets?.some(a => a.symbol === settings.asset)) {
    const legacy = new Option(`Previous ${settings.asset} — choose a supported coin`, '');
    tracked.add(legacy, 0);
  }

  for (const [key, value] of Object.entries(settings)) { const field = $(`setting-${key}`); if (field) field.value = value; }
  if (!tracked.value && settings.marketType !== 'track') tracked.value = state?.assets?.[0]?.symbol || '';
  updateStrategyFields();
}
const strategyNames = { ema: 'EMA crossover', sma: 'SMA crossover', rsi: 'RSI recovery', bollinger: 'Bollinger band recovery' };
function updateStrategyFields() {
  const type = $('setting-type').value;
  document.querySelectorAll('[data-strategies]').forEach(field => { field.hidden = !field.dataset.strategies.split(' ').includes(type); });
  text('strategy-description', {
    ema: 'Buy when the fast exponential moving average crosses above the slow average. Sell when the fast average is below the slow average.',
    sma: 'Buy when the fast simple moving average crosses above the slow average. Sell when the fast average is below the slow average. Every sample in each window has equal weight.',
    rsi: 'Buy when Wilder RSI crosses back above the entry threshold after being oversold. Sell when RSI reaches or exceeds the exit threshold. Defaults: 14 samples, entry 30, exit 70.',
    bollinger: 'Buy when price returns inside the lower band after a sample below it. Sell when price reaches or exceeds the middle simple moving average. Defaults: 20 samples and 2 standard deviations.'
  }[type]);
}
$('setting-type').addEventListener('change', updateStrategyFields);
const number = (v, max = 6) => Number(v).toLocaleString('en-US', { maximumFractionDigits: max });
const text = (id, value) => { $(id).textContent = value; };
function toast(message) { text('toast', message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers: { Authorization: `tma ${tg?.initData || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(path === 'asset' ? 60000 : 20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function render(s) {
  if (state?.marketKey !== s.marketKey) { livePrice = null; recentSince = Date.now(); settingsDirty = false; }
  state = s;
  const market = s.market || { asset: s.base, reference: s.quote, executable: true }, tracking = !market.executable;
  text('market-pair', tracking ? market.asset : `${market.reference} / ${market.asset}`);
  text('market-name', tracking ? `Single coin tracking · ${market.reference} reference` : `${market.asset} · Solana`);
  text('market-tag', tracking ? 'TRACK ONLY' : 'SPOT');
  text('asset-icon', market.asset === 'cbBTC' ? '₿' : market.asset === 'ETH' ? 'Ξ' : market.asset.slice(0, 1));
  text('price-label', `${market.asset} price in ${market.reference}`);
  text('position-symbol', market.asset);
  text('position-heading', tracking ? 'Tracker signal' : 'Open buys');
  text('position-empty-title', tracking ? (s.tracker?.state || 'Warming up').toUpperCase() : 'No open position');
  text('position-help', tracking ? `${market.asset} is observed against ${market.reference}. Signals are informational and create no position.` : `The bot buys ${s.base} with SOL when its entry signal fires.`);
  text('deposit-title', `Deposit SOL or ${s.base}`);
  if (!assetDirty && !savingAsset) {
    const select = $('asset-preset');
    select.replaceChildren(new Option('Choose a supported pair', ''));
    for (const asset of s.assets || []) select.add(new Option(`SOL / ${asset.symbol}`, asset.symbol));
    select.value = s.assets?.find(a => a.mint === s.tokenMint)?.symbol || '';
    if (!select.value) select.options[0].text = `Current SOL / ${s.base} is a legacy asset — choose a supported pair`;

    updateAssetFields();
  }
  $('asset-fields').disabled = savingAsset || actionBusy || s.running || s.busy || s.closing || !!s.pending || !!s.position;
  text('asset-address', `Current ${s.base} mint: ${s.tokenMint}`);
  $('connection-error').hidden = true;
  $('demo-banner').hidden = !s.demo;
  $('setup-notice').hidden = s.pairReady;
  $('trade-error').hidden = !s.error; text('trade-error', s.error ? `Last trading error: ${s.error}` : '');
  text('mode', s.mode.toUpperCase() + ' MODE');
  $('trading-mode').value = s.mode;
  $('trading-mode').disabled = actionBusy || s.running || s.busy || s.closing || !!s.pending;
  renderPrice();
  text('available-label', tracking ? 'Capital required' : 'Available to trade');
  text('realized-label', tracking ? 'Execution' : 'Realized return');
  text('realized', tracking ? '—' : (s.realized > 0 ? '+' : '') + number(s.realized, 6));
  text('realized-note', tracking ? 'No swaps submitted' : 'SOL · before network fees');
  $('realized').className = s.realized > 0 ? 'green' : s.realized < 0 ? 'red' : '';
  renderReturnUSDT();
  text('status-title', s.closing ? 'Bringing it home' : s.running ? 'Your strategy is flying' : 'Ready when you are');
  text('status-pill', s.closing ? 'Closing' : s.running ? (s.warmup < s.warmupRequired ? 'Warming Up' : 'Running') : 'Stopped');
  $('status-pill').className = 'status-pill' + (s.closing ? ' closing' : s.running ? ' running' : '');
  text('status-detail', tracking ? (s.running ? `Monitoring ${market.asset}. Tracking mode never submits swaps.` : `Start monitoring ${market.asset}. Tracking mode never submits swaps.`) : s.pending ? 'A trade needs reconciliation. New trades are blocked.' : s.closing ? `Selling the bot’s ${s.base} position back to SOL. Trading will stay stopped.` : s.running ? s.warmup < s.warmupRequired ? 'Collecting price samples before the first entry signal.' : 'Watching for the selected strategy signals. Buys and sells happen automatically.' : 'Start the bot to monitor the market and trade automatically.');
  text('status-help', tracking ? 'Stop pauses price monitoring. It never opens or closes a position.' : 'Stop pauses all trading and keeps your position open.');
  text('warmup-text', `${s.warmup} / ${s.warmupRequired} samples`);
  $('warmup-progress').max = s.warmupRequired; $('warmup-progress').value = s.warmup;
  $('start').disabled = actionBusy || s.running || s.closing || !!s.pending || (market.executable && (!s.pairReady || (s.mode === 'live' && !s.wallet)));
  $('stop').disabled = actionBusy || (!s.running && !s.closing && !s.busy);
  $('close').hidden = tracking; $('position-action-help').hidden = tracking;
  $('close').disabled = tracking || actionBusy || s.closing || !!s.pending || (!s.position && !s.busy) || (s.mode === 'live' && !s.wallet);
  $('reconcile').hidden = !s.pending;
  $('position-empty').hidden = !!s.position; $('position-data').hidden = !s.position;
  text('position-tag', tracking ? 'NO TRADES' : s.position ? `${s.positions?.length || 1} OPEN BUY${s.positions?.length === 1 ? '' : 'S'}` : 'NO POSITION');
  if (s.position) { text('position-amount', number(s.position.amount, 8)); text('position-cost', number(s.position.cost, 6) + ' SOL'); text('position-value', s.position.value === null ? '—' : number(s.position.value, 6) + ' SOL'); }
  text('strategy-name', strategyNames[s.strategy.type || 'ema']);
  text('ema', s.strategy.type === 'rsi' ? `${s.strategy.rsiPeriod} samples / ${s.strategy.rsiBuy}-${s.strategy.rsiSell}` : s.strategy.type === 'bollinger' ? `${s.strategy.bbPeriod} samples / ${s.strategy.bbDeviation} SD` : `${s.strategy.fast} / ${s.strategy.slow}`); text('interval', s.chartInterval || 15);
  text('trade-size', tracking ? 'TRACK ONLY' : s.strategy.sizePercent + '%');
  text('strategy-summary-help', tracking ? 'Signals update the tracker only. They are not orders or trading recommendations.' : 'Exits are checked at each sample while running. They are not exchange-held orders or guaranteed prices.');
  text('max-trade', s.strategy.maxTrade + ' SOL'); text('max-daily', s.strategy.maxDaily + ' SOL'); text('slippage', s.strategy.slippage + '%');
  text('mint-label', market.asset + ' mint: ' + s.assetMint);
  text('trade-count', (s.tradeCount ?? s.trades.length) + ' TOTAL');
  text('dashboard-trade-count', s.mode.toUpperCase());
  text('trade-history-note', `Showing latest ${s.trades.length} of ${s.tradeCount ?? s.trades.length} ${s.mode} transactions. Updates every 3 seconds. ${s.demo ? 'Preview history resets when the demo restarts.' : 'History is saved on the bot server.'}`);
  if (!settingsDirty && !savingSettings) fillSettings(s.strategy);
  const locked = s.running || s.busy || s.closing || !!s.pending;
  $('edit-balance').hidden = tracking || s.mode !== 'paper';
  if (s.mode !== 'paper') $('balance-form').hidden = true;
  $('edit-balance').disabled = locked || savingBalance || actionBusy;
  $('balance-amount').disabled = locked || savingBalance || actionBusy;
  $('save-balance').disabled = locked || savingBalance || actionBusy;
  if (tracking) { text('available', '—'); text('available-note', 'Tracking uses no funds'); }
  else text('available-note', s.mode === 'paper' ? 'SOL · resets to 1 on open/start/stop' : 'SOL · available after gas reserve and fee buffer');
  const strategyLocked = s.closing || !!s.pending;
  $('strategy-fields').disabled = strategyLocked || savingSettings;
  $('save-strategy').disabled = strategyLocked || savingSettings;
  $('reset-strategy').disabled = savingSettings;
  $('settings-lock').hidden = !strategyLocked;
  renderLots(s.positions || []);
  renderTrades(s.trades, 'trade-list'); renderTrades(s.trades.filter(trade => trade.time >= recentSince).slice(0, 5), 'dashboard-trade-list'); drawChart(s.samples);
}
function renderLots(lots) {
  const list = $('position-lots'); list.replaceChildren();
  for (const lot of lots) {
    const row = document.createElement('p'); row.className = 'footnote';
    row.textContent = `${lot.label} [${lot.id}] · ${number(lot.amount, 8)} ${state.base} · cost ${number(lot.cost, 8)} SOL`;
    list.append(row);
  }
  if (!lots.length) list.textContent = 'No open buys.';
}
function renderTrades(trades, target) {
  const list = $(target);
  const revision = JSON.stringify(trades);
  if (list.dataset.revision === revision) return;
  list.dataset.revision = revision; list.replaceChildren();
  if (!trades.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = target === 'dashboard-trade-list' ? 'No new transactions this session. Completed buys and sells will appear here.' : 'No trades yet. Start the bot to begin building your trade history.'; list.append(p); }
  for (const trade of trades) {
    const row = document.createElement('div'); row.className = 'trade-item';
    const icon = document.createElement('div'); icon.className = 'trade-icon ' + trade.side; icon.textContent = trade.side === 'buy' ? '↗' : '↙';
    const info = document.createElement('div'); info.className = 'trade-info';
    const title = document.createElement('strong'); title.textContent = trade.side === 'buy' ? 'Bought ' + trade.output : 'Sold ' + trade.input;
    if (trade.status !== 'filled') title.textContent = (trade.side === 'buy' ? 'Buy' : 'Sell') + ' · ' + trade.status;
    const status = document.createElement('small'); status.className = 'transaction-status';
    const labels = { filled: 'Completed', submitting: 'Submitting', unknown: 'Needs reconciliation', failed: 'Failed', expired: 'Expired' };
    status.textContent = `${(trade.mode || state.mode).toUpperCase()} · ${labels[trade.status] || trade.status}`;
    const reason = document.createElement('small'); reason.textContent = trade.reason;
    const date = document.createElement('small'); date.textContent = new Date(trade.time).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }); info.append(title, status, reason, date);
    const reference = document.createElement('small'); reference.textContent = `${trade.side === 'buy' ? 'Buy' : 'Sell'} ID: ${trade.id}`; info.append(reference);
    const links = trade.side === 'sell' ? trade.buyAllocations : trade.sellAllocations;
    for (const link of links || []) {
      const relation = document.createElement('small');
      relation.textContent = `${trade.side === 'sell' ? 'From buy' : 'Sold by'} ${trade.side === 'sell' ? link.buyId : link.sellId} · ${link.amount} ${trade.side === 'sell' ? trade.input : trade.output} · cost ${link.cost} ${state.quote} · received ${link.proceeds} ${state.quote} · return ${number(link.realized, 9)} ${state.quote}`;
      info.append(relation);
    }
    if (trade.side === 'sell' && trade.status === 'filled' && !trade.relationshipKnown) {
      const legacy = document.createElement('small'); legacy.textContent = 'Historical sell: buy linkage was not recorded.'; info.append(legacy);
    }
    const result = document.createElement('div'); result.className = 'trade-result'; result.textContent = (trade.status === 'filled' ? 'Sent ' : 'Requested ') + trade.amount + ' ' + trade.input;
    const out = document.createElement('small'); out.textContent = trade.received !== null ? 'Received ' + trade.received + ' ' + trade.output : ['failed', 'expired'].includes(trade.status) ? 'No completed swap' : 'Awaiting confirmation'; result.append(out);
    if (trade.signature) { const a = document.createElement('a'); a.href = 'https://solscan.io/tx/' + encodeURIComponent(trade.signature); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'View transaction ↗'; const small = document.createElement('small'); small.append(a); result.append(small); }
    row.append(icon, info, result); list.append(row);
  }
}
function drawChart(samples) {
  const latestTime = samples.at(-1)?.time;
  samples = samples.filter(sample => sample.time >= latestTime - 15 * 60 * 1000).slice(-60);
  const trades = state?.chartTrades || state?.trades || [];
  const tracking = state?.market && !state.market.executable;
  const reference = state?.market?.reference || state?.quote || 'SOL';
  text('chart-levels', tracking ? `Tracking only · ${state.market.asset} / ${reference} reference · no orders` : 'Observed prices');
  const canvas = $('chart'), rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = window.devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.strokeStyle = '#25302f'; ctx.lineWidth = .6; ctx.setLineDash([3, 5]);
  for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke(); }
  ctx.setLineDash([]); $('chart-empty').hidden = samples.length > 1;
  if (samples.length < 2) { canvas.setAttribute('aria-label', `Observed ${state?.market?.asset || state?.base || 'asset'} price in ${reference}. Waiting for price samples; no open position.`); text('chart-first', '—'); text('chart-last', '—'); text('chart-empty', samples.length ? 'Collecting samples for your price history.' : 'Your price history starts when the bot runs.'); return; }
  const values = samples.map(s => s.price);
  const low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max((high - low) * .15, Math.abs(high) * .000001, Number.EPSILON);
  const min = low - padding, max = high + padding, range = max - min;
  text('chart-levels', `${$('chart-levels').textContent} · Auto scale ${Number(min.toPrecision(8))}–${Number(max.toPrecision(8))} ${reference}`);
  const firstTime = samples[0]?.time ?? 0, lastTime = samples.at(-1)?.time ?? firstTime;
  const xAt = time => 12 + Math.min(1, Math.max(0, (time - firstTime) / (lastTime - firstTime || 1))) * (w - 24);
  const points = samples.map(s => [xAt(s.time), h - 28 - (s.price - min) / range * (h - 56)]);
  const gradient = ctx.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, '#70b7ff24'); gradient.addColorStop(1, '#70b7ff00');
  if (points.length) {
  ctx.beginPath(); ctx.moveTo(points[0][0], h); for (const p of points) ctx.lineTo(...p); ctx.lineTo(points.at(-1)[0], h); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.strokeStyle = '#70b7ff'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(...points.at(-1), 3, 0, Math.PI * 2); ctx.fillStyle = '#70b7ff'; ctx.fill();
  }
  const completed = trades.filter(t => points.length && t.status === 'filled' && ['buy', 'sell'].includes(t.side) && t.time >= firstTime);
  for (const trade of completed) {
    // Place the receipt on the observed quote line, interpolating between samples.
    const next = samples.findIndex(s => s.time >= trade.time);
    const right = next < 0 ? samples.length - 1 : next, left = Math.max(0, right - 1);
    const fraction = Math.min(1, Math.max(0, (trade.time - samples[left].time) / (samples[right].time - samples[left].time || 1)));
    const x = xAt(trade.time), y = points[left][1] + (points[right][1] - points[left][1]) * fraction;
    const direction = trade.side === 'buy' ? 1 : -1;
    ctx.beginPath(); ctx.moveTo(x, y + direction * 4);
    ctx.lineTo(x - 6, y + direction * 15); ctx.lineTo(x + 6, y + direction * 15); ctx.closePath();
    ctx.fillStyle = trade.side === 'buy' ? '#b6f36b' : '#f09391'; ctx.fill();
    ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  canvas.setAttribute('aria-label', `Observed ${state?.market?.asset || state?.base || 'asset'} price in ${reference}. ${tracking ? 'Tracking only; no trades are submitted.' : `${completed.filter(t => t.side === 'buy').length} completed buys marked with green upward triangles; ${completed.filter(t => t.side === 'sell').length} completed sells marked with red downward triangles. Details in Transactions.`}`);
  const time = n => new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); text('chart-first', samples.length ? time(samples[0].time) : '—'); text('chart-last', samples.length ? time(samples.at(-1).time) : '—');
}
function renderPrice() {
  const price = livePrice?.price ?? state?.price ?? null;
  $('price').replaceChildren(document.createTextNode(price === null ? '— ' : number(price, 9) + ' '), Object.assign(document.createElement('small'), { textContent: state?.market?.reference || state?.quote || 'SOL' }));
  text('sample-label', priceFailed ? 'Price refresh failed · retrying' : livePrice ? 'Live price · 5s refresh' : 'Fetching live price');
}
async function refreshPrice() {
  if (priceBusy) return;
  priceBusy = true;
  try { const quote = await api('price'); if (!savingAsset && (!state?.marketKey || quote.marketKey === state.marketKey)) livePrice = quote; priceFailed = false; }
  catch { priceFailed = true; }
  finally { priceBusy = false; renderPrice(); }
}
async function refresh() {
  try { render(await api('state')); } catch (error) { text('connection-error', error.message); $('connection-error').hidden = false; for (const id of ['start', 'stop', 'close', 'create-wallet']) $(id).disabled = true; }
}
async function balances() { if (state?.market && !state.market.executable) return; try { const b = await api('balance'); text('available', number(Number(b.availableToTrade ?? b.SOL) / 1e9, 5)); } catch { text('available', 'Unavailable'); } }
async function wallet() {
  try {
    const w = await api('wallet');
    $('wallet-key-card').hidden = w.exists && !w.locked;
    $('wallet-key').disabled = !!w.demo; $('generate-key').disabled = !!w.demo; $('key-backed-up').disabled = !!w.demo;
    if (w.demo) text('key-description', 'The deployed Telegram app requests your key here. Do not enter real keys in this simulated preview.');
    $('unlock-wallet').hidden = !w.locked;
    $('generate-key').hidden = w.exists;
    $('create-wallet').hidden = w.exists; $('wallet-balances').hidden = !w.exists || !!w.locked; $('deposit-card').hidden = !w.exists || !!w.locked;
    text('wallet-heading', w.exists ? 'Your trading wallet' : 'Create your Solana wallet');
    text('wallet-description', w.exists ? w.demo ? 'Preview wallet. No real deposits can be made here.' : `Your wallet can receive ${state?.base || 'your selected token'} and SOL on Solana.` : 'A dedicated wallet for your bot. Deposit SOL to fund automatic asset buys and network fees.');
    if (w.locked) { text('wallet-heading', 'Unlock your trading wallet'); text('wallet-description', 'Enter the original encryption key above. Your wallet and funds are preserved.'); }
    if (w.exists && !w.locked) {
      text('wallet-sol', w.balance ? number(Number(w.balance.SOL) / 1e9) + ' SOL' : 'Balance unavailable'); text('wallet-doge', w.balance ? number(Number(w.balance[state?.base] || 0) / 10 ** (state?.tokenDecimals || 0), 8) + ' ' + (state?.base || 'asset') : 'You can still copy your receiving address.');
      $('wallet-address').value = w.address;
      $('deposit-qr').hidden = !!w.demo; if (w.qr) $('deposit-qr').src = w.qr;
      $('explorer').hidden = !!w.demo; if (!w.demo) $('explorer').href = 'https://solscan.io/account/' + w.address;
      $('copy-address').disabled = !!w.demo;
    }
    $('create-wallet').disabled = false;
  } catch (error) { toast(error.message); }
}
async function action(name) {
  if (actionBusy) return; actionBusy = true; if (state) render(state);
  try {
    const response = await api(name, 'POST');
    if (name === 'start' || name === 'stop') { recentSince = Date.now(); livePrice = null; }
    tg?.HapticFeedback?.notificationOccurred('success');
    toast(response.message || ({ start: 'Autopilot started.', stop: 'Bot stopped. Your position is kept.', close: 'Closing requested. The bot will remain stopped.', 'wallet/create': 'Wallet created. You can now deposit SOL.' })[name] || 'Done.');
    if (name === 'wallet/create') await wallet();
  } catch (error) { toast(error.message); }
  finally { actionBusy = false; await refresh(); await balances(); }
}
for (const name of ['start', 'stop', 'close', 'reconcile']) $(name).addEventListener('click', () => action(name));
async function unlockWallet(create) {
  if (actionBusy) return;
  if (state?.demo) return action('wallet/create');
  const field = $('wallet-key');
  if (!/^[a-fA-F0-9]{64}$/.test(field.value) || (create && !$('key-backed-up').checked)) {
    text('wallet-error', 'Enter a valid 64-character key and save a backup before creating a wallet.'); $('wallet-error').hidden = false; return;
  }
  actionBusy = true; $('wallet-error').hidden = true;
  try {
    const pending = api(create ? 'wallet/create' : 'wallet/unlock', 'POST', { key: field.value });
    field.value = ''; field.type = 'password'; $('key-backed-up').checked = false;
    await pending; toast('Wallet unlocked. Trading remains stopped.');
  } catch (error) { text('wallet-error', error.message); $('wallet-error').hidden = false; }
  finally { actionBusy = false; await wallet(); await refresh(); }
}
$('create-wallet').addEventListener('click', () => unlockWallet(true));
$('unlock-wallet').addEventListener('click', () => unlockWallet(false));
$('generate-key').addEventListener('click', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  $('wallet-key').value = [...bytes].map(b => b.toString(16).padStart(2, '0')).join(''); bytes.fill(0);
  $('wallet-key').type = 'text'; $('wallet-key').select(); $('key-backed-up').checked = false;
  toast('Save this key in your password manager before creating the wallet.');
});
$('trading-mode').addEventListener('change', async event => {
  const mode = event.target.value;
  const acknowledged = mode === 'live' && confirm('Live mode uses real funds. Switching leaves the bot stopped. Enable live mode?');
  if (mode === 'live' && !acknowledged) { render(state); return; }
  actionBusy = true; settingsDirty = false;
  try { await api('mode', 'POST', { mode, acknowledged }); toast('Mode changed. Trading remains stopped.'); }
  catch (error) { toast(error.message); }
  finally { actionBusy = false; await refresh(); await balances(); }
});
$('refresh-wallet').addEventListener('click', async () => { await wallet(); toast('Balance checked.'); });
$('copy-address').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('wallet-address').value); toast('Wallet address copied.'); } catch { $('wallet-address').select(); toast('Select and copy the address above.'); } });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  activeView = button.dataset.view;
  document.querySelectorAll('.view').forEach(view => view.hidden = view.id !== activeView);
  document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('selected', b.dataset.view === activeView));
  if (activeView === 'wallet-view') wallet(); if (activeView === 'dashboard' && state) drawChart(state.samples);
  window.scrollTo({ top: 0 });
}));
window.addEventListener('resize', () => state && drawChart(state.samples));
$('strategy-form').addEventListener('input', () => { settingsDirty = true; text('settings-status', 'Unsaved changes'); });
$('reset-strategy').addEventListener('click', () => { if (state) fillSettings(state.strategy); settingsDirty = false; $('settings-error').hidden = true; text('settings-status', 'Edits discarded.'); });
$('strategy-form').addEventListener('submit', async event => {
  event.preventDefault(); if (savingSettings) return;
  const settings = Object.fromEntries(new FormData(event.currentTarget));
  savingSettings = true; $('settings-error').hidden = true; if (state) render(state);
  try {
    const result = await api('strategy', 'POST', settings);
    settingsDirty = false; savingSettings = false; render({ ...result, demo: state?.demo });
    const message = result.running ? 'Strategy applied. The bot is still running.' : 'Strategy saved. The bot remains stopped.';
    text('settings-status', message); toast(message);
  } catch (error) { text('settings-error', error.message); $('settings-error').hidden = false; }
  finally { savingSettings = false; if (state) render(state); }
});
$('edit-balance').addEventListener('click', () => {
  $('balance-amount').value = state?.paperStartingBalance || '1';
  $('balance-error').hidden = true; $('balance-form').hidden = false; $('balance-amount').focus();
});
$('cancel-balance').addEventListener('click', () => { $('balance-form').hidden = true; });
$('balance-form').addEventListener('submit', async event => {
  event.preventDefault(); if (savingBalance || actionBusy) return;
  savingBalance = true; actionBusy = true; $('balance-error').hidden = true; if (state) render(state);
  try {
    await api('paper/balance', 'POST', { amount: $('balance-amount').value });
    $('balance-form').hidden = true; toast('Paper balance saved.');
  } catch (error) { text('balance-error', error.message); $('balance-error').hidden = false; }
  finally { savingBalance = false; actionBusy = false; await refresh(); await balances(); }
});
async function openApp() {
  try { await api('paper/reset-balance', 'POST'); } catch (error) { toast(error.message); }
  await refresh(); await balances();
}
openApp(); refreshPrice();
setInterval(() => { if (!document.hidden) refreshPrice(); }, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshPrice(); });
setInterval(() => { if (!document.hidden) refresh(); }, 3000);
setInterval(() => { if (!document.hidden) { balances(); if (activeView === 'wallet-view') wallet(); } }, 15000);

function updateAssetFields() {
  const asset = state?.assets?.find(a => a.symbol === $('asset-preset').value);
  text('asset-selected-mint', asset ? `${asset.symbol} mint: ${asset.mint}` : 'Select a pair to see its built-in mint.');
}
$('asset-preset').addEventListener('change', updateAssetFields);
$('asset-form').addEventListener('input', () => { assetDirty = true; });
$('asset-form').addEventListener('submit', async event => {
  event.preventDefault(); if (savingAsset || actionBusy) return;
  const input = { preset: $('asset-preset').value };
  savingAsset = true; actionBusy = true; $('asset-error').hidden = true;
  text('asset-status', 'Checking mint and buy/sell routes…'); if (state) render(state);
  try {
    const result = await api('asset', 'POST', input);
    livePrice = null; assetDirty = false; settingsDirty = false;
    render({ ...result, demo: state?.demo });
    text('asset-status', `${result.base} saved. Trading remains stopped.`);
    toast('Asset saved. Start the bot when ready.');
  } catch (error) { text('asset-error', error.message); $('asset-error').hidden = false; text('asset-status', 'Refresh to check the current asset before retrying.'); }
  finally { savingAsset = false; actionBusy = false; await refresh(); await balances(); await refreshPrice(); }
});

$('load-defaults').addEventListener('click', () => {
  if (!state || savingSettings) return;
  fillSettings(state.defaultStrategy); settingsDirty = true;
  text('settings-status', 'Defaults loaded. Press Save strategy to apply.');
});

function renderReturnUSDT() {
  const tracking = state?.market && !state.market.executable;
  $('realized-usdt').hidden = !!tracking; $('realized-usdt-note').hidden = !!tracking;
  if (!state || tracking) return;
  const fresh = returnRate?.currency === state.quote && Date.now() - returnRateAt < 60000;
  const value = state.realized === 0 ? 0 : fresh ? state.realized * returnRate.rate : null;
  text('realized-usdt', value === null ? 'USDT equivalent unavailable' : `≈ ${value > 0 ? '+' : ''}${number(value, 6)} USDT`);
  $('realized-usdt').className = value > 0 ? 'green' : value < 0 ? 'red' : '';
  text('realized-usdt-note', 'Equivalent at current exchange rate · before network fees');
}
async function refreshReturnRate() {
  if (returnRateBusy) return;
  returnRateBusy = true;
  try { returnRate = await api('return-rate'); returnRateAt = Date.now(); }
  catch { returnRate = null; }
  finally { returnRateBusy = false; renderReturnUSDT(); }
}
refreshReturnRate();
setInterval(refreshReturnRate, 30000);
