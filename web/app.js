const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const $ = id => document.getElementById(id);
let state = null, activeView = 'dashboard', toastTimer, actionBusy = false;
let settingsDirty = false, savingSettings = false;
function fillSettings(settings) {
  for (const [key, value] of Object.entries(settings)) $(`setting-${key}`).value = value;
}
const number = (v, max = 6) => Number(v).toLocaleString('en-US', { maximumFractionDigits: max });
const text = (id, value) => { $(id).textContent = value; };
function toast(message) { text('toast', message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers: { Authorization: `tma ${tg?.initData || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function render(s) {
  state = s;
  $('connection-error').hidden = true;
  $('demo-banner').hidden = !s.demo;
  $('setup-notice').hidden = s.pairReady;
  $('trade-error').hidden = !s.error; text('trade-error', s.error || '');
  text('mode', s.mode.toUpperCase() + ' MODE');
  $('price').replaceChildren(document.createTextNode(s.price === null ? '— ' : number(s.price, 9) + ' '), Object.assign(document.createElement('small'), { textContent: 'SOL' }));
  text('sample-label', s.running ? 'Monitoring market' : 'Last observed quote');
  text('realized', (s.realized > 0 ? '+' : '') + number(s.realized, 6));
  $('realized').className = s.realized > 0 ? 'green' : s.realized < 0 ? 'red' : '';
  text('status-title', s.closing ? 'Bringing it home' : s.running ? 'Your strategy is flying' : 'Ready when you are');
  text('status-pill', s.closing ? 'Closing' : s.running ? 'Running' : 'Stopped');
  $('status-pill').className = 'status-pill' + (s.closing ? ' closing' : s.running ? ' running' : '');
  text('status-detail', s.pending ? 'A trade needs reconciliation. New trades are blocked.' : s.closing ? 'Selling the bot’s DOGE position back to SOL. Trading will stay stopped.' : s.running ? s.warmup < s.warmupRequired ? 'Collecting price samples before the first entry signal.' : 'Watching for a crossover. Buys and sells happen automatically.' : 'Start the bot to monitor the market and trade automatically.');
  text('warmup-text', `${s.warmup} / ${s.warmupRequired} samples`);
  $('warmup-progress').max = s.warmupRequired; $('warmup-progress').value = s.warmup;
  $('start').disabled = actionBusy || s.running || s.closing || !!s.pending || !s.pairReady || (s.mode === 'live' && !s.wallet);
  $('stop').disabled = actionBusy || (!s.running && !s.closing && !s.busy);
  $('close').disabled = actionBusy || s.closing || !!s.pending || (!s.position && !s.busy);
  $('reconcile').hidden = !s.pending;
  $('position-empty').hidden = !!s.position; $('position-data').hidden = !s.position;
  text('position-tag', s.position ? '1 OPEN' : 'NO POSITION');
  if (s.position) { text('position-amount', number(s.position.amount, 4)); text('position-cost', number(s.position.cost, 6) + ' SOL'); text('position-value', s.position.value === null ? '—' : number(s.position.value, 6) + ' SOL'); }
  text('ema', `${s.strategy.fast} / ${s.strategy.slow}`); text('interval', s.strategy.interval);
  text('trade-size', s.strategy.size + ' SOL'); text('stop-loss', s.strategy.stopLoss + '%'); text('take-profit', s.strategy.takeProfit + '%');
  text('max-trade', s.strategy.maxTrade + ' SOL'); text('max-daily', s.strategy.maxDaily + ' SOL'); text('slippage', s.strategy.slippage + '%');
  text('mint-label', s.dogeMint ? 'Wrapped DOGE mint: ' + s.dogeMint : 'Wrapped DOGE mint: awaiting configuration');
  text('trade-count', s.trades.length + ' RECENT');
  if (!settingsDirty && !savingSettings) fillSettings(s.strategy);
  const locked = s.running || s.busy || s.closing || !!s.pending;
  $('strategy-fields').disabled = locked || savingSettings;
  $('save-strategy').disabled = locked || savingSettings;
  $('reset-strategy').disabled = savingSettings;
  $('settings-lock').hidden = !locked;
  renderTrades(s.trades); drawChart(s.samples);
}
function renderTrades(trades) {
  const list = $('trade-list'); list.replaceChildren();
  if (!trades.length) { const p = document.createElement('p'); p.className = 'muted'; p.textContent = 'No trades yet. Start the bot to begin building your trade history.'; list.append(p); }
  for (const trade of trades) {
    const row = document.createElement('div'); row.className = 'trade-item';
    const icon = document.createElement('div'); icon.className = 'trade-icon ' + trade.side; icon.textContent = trade.side === 'buy' ? '↗' : '↙';
    const info = document.createElement('div'); info.className = 'trade-info';
    const title = document.createElement('strong'); title.textContent = trade.side === 'buy' ? 'Bought DOGE' : 'Sold DOGE';
    if (trade.status !== 'filled') title.textContent = (trade.side === 'buy' ? 'Buy' : 'Sell') + ' · ' + trade.status;
    const reason = document.createElement('small'); reason.textContent = trade.reason;
    const date = document.createElement('small'); date.textContent = new Date(trade.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); info.append(title, reason, date);
    const result = document.createElement('div'); result.className = 'trade-result'; result.textContent = number(trade.amount, 5) + ' ' + trade.input;
    const out = document.createElement('small'); out.textContent = trade.received ? '→ ' + number(trade.received, 5) + ' ' + trade.output : 'Awaiting result'; result.append(out);
    if (trade.signature) { const a = document.createElement('a'); a.href = 'https://solscan.io/tx/' + encodeURIComponent(trade.signature); a.target = '_blank'; a.rel = 'noopener noreferrer'; a.textContent = 'View transaction ↗'; const small = document.createElement('small'); small.append(a); result.append(small); }
    row.append(icon, info, result); list.append(row);
  }
}
function drawChart(samples) {
  const canvas = $('chart'), rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dpr = window.devicePixelRatio || 1; canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const w = rect.width, h = rect.height;
  ctx.strokeStyle = '#25302f'; ctx.lineWidth = .6; ctx.setLineDash([3, 5]);
  for (let i = 1; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(0, h * i / 4); ctx.lineTo(w, h * i / 4); ctx.stroke(); }
  ctx.setLineDash([]); $('chart-empty').hidden = samples.length > 1;
  if (samples.length < 2) { text('chart-first', '—'); text('chart-last', '—'); text('chart-empty', samples.length ? 'Collecting samples for your price history.' : 'Your price history starts when the bot runs.'); return; }
  const values = samples.map(s => s.price), min = Math.min(...values), max = Math.max(...values), range = max - min || max * .02 || 1;
  const points = values.map((v, i) => [i / (values.length - 1) * (w - 4) + 2, h - 20 - (v - min) / range * (h - 40)]);
  const gradient = ctx.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, '#b6f36b24'); gradient.addColorStop(1, '#b6f36b00');
  ctx.beginPath(); ctx.moveTo(points[0][0], h); for (const p of points) ctx.lineTo(...p); ctx.lineTo(points.at(-1)[0], h); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
  ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.strokeStyle = '#b6f36b'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
  ctx.beginPath(); ctx.arc(...points.at(-1), 3, 0, Math.PI * 2); ctx.fillStyle = '#b6f36b'; ctx.fill();
  const time = n => new Date(n).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); text('chart-first', time(samples[0].time)); text('chart-last', time(samples.at(-1).time));
}
async function refresh() {
  try { render(await api('state')); } catch (error) { text('connection-error', error.message); $('connection-error').hidden = false; for (const id of ['start', 'stop', 'close', 'create-wallet']) $(id).disabled = true; }
}
async function balances() { try { const b = await api('balance'); text('available', number(Number(b.SOL) / 1e9, 5)); } catch { text('available', 'Unavailable'); } }
async function wallet() {
  try {
    const w = await api('wallet');
    $('create-wallet').hidden = w.exists; $('wallet-balances').hidden = !w.exists; $('deposit-card').hidden = !w.exists;
    text('wallet-heading', w.exists ? 'Your trading wallet' : 'Create your Solana wallet');
    text('wallet-description', w.exists ? w.demo ? 'Preview wallet. No real deposits can be made here.' : 'Your dedicated Solana wallet is ready to receive SOL.' : 'A dedicated wallet for your bot. Deposit SOL, then let your strategy take it from there.');
    if (w.exists) {
      text('wallet-sol', number(Number(w.balance.SOL) / 1e9) + ' SOL'); text('wallet-doge', number(Number(w.balance.DOGE) / 10 ** (state?.dogeDecimals ?? 8), 4) + ' DOGE');
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
    const response = await api(name, 'POST'); tg?.HapticFeedback?.notificationOccurred('success');
    toast(response.message || ({ start: 'Autopilot started.', stop: 'Bot stopped. Your position is kept.', close: 'Closing requested. The bot will remain stopped.', 'wallet/create': 'Wallet created. You can now deposit SOL.' })[name] || 'Done.');
    if (name === 'wallet/create') await wallet();
  } catch (error) { toast(error.message); }
  finally { actionBusy = false; await refresh(); await balances(); }
}
for (const name of ['start', 'stop', 'close', 'reconcile']) $(name).addEventListener('click', () => action(name));
$('create-wallet').addEventListener('click', () => action('wallet/create'));
$('refresh-wallet').addEventListener('click', async () => { await wallet(); toast('Balance checked.'); });
$('copy-address').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('wallet-address').value); toast('Wallet address copied.'); } catch { $('wallet-address').select(); toast('Select and copy the address above.'); } });
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  activeView = button.dataset.view;
  document.querySelectorAll('.view').forEach(view => view.hidden = view.id !== activeView);
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('selected', b === button));
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
    text('settings-status', 'Strategy saved. Start the bot when ready.'); toast('Strategy saved. The bot remains stopped.');
  } catch (error) { text('settings-error', error.message); $('settings-error').hidden = false; }
  finally { savingSettings = false; if (state) render(state); }
});
refresh(); balances();
setInterval(() => { if (!document.hidden) refresh(); }, 3000);
setInterval(() => { if (!document.hidden) { balances(); if (activeView === 'wallet-view') wallet(); } }, 15000);
