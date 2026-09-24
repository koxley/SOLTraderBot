import { lotsOf, availableQuote } from './positions.js';
import { warmup } from './indicators.js';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { UserError, format } from './config.js';
import { strategySettings } from './strategy.js';
import { validateQuote } from './engine.js';
import { ASSETS, resolveAsset } from './assets.js';
import { stopLevel } from './risk.js';

async function readSettings(req) {
  let size = 0; const parts = [];
  for await (const part of req) {
    size += part.length;
    if (size > 4096) throw new UserError('Settings request is too large.');
    parts.push(part);
  }
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new UserError('Invalid settings JSON.'); }
}

export function authenticate(initData, token, owner, now = Date.now()) {
  if (!initData || initData.length > 8192) return false;
  const params = new URLSearchParams(initData);
  if (new Set(params.keys()).size !== [...params.keys()].length) return false;
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/.test(hash || '')) return false;
  params.delete('hash');
  const text = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(text).digest();
  if (!timingSafeEqual(expected, Buffer.from(hash, 'hex'))) return false;
  const authDate = params.get('auth_date');
  const time = Number(authDate);
  // Owner-requested non-expiring sessions; signed identity is still checked on every request.
  if (!/^\d+$/.test(authDate || '') || !Number.isSafeInteger(time) || time <= 0 || time > now / 1000 + 30) return false;
  try { return String(JSON.parse(params.get('user')).id) === owner; } catch { return false; }
}

export function snapshot(engine) {
  const cfg = engine.cfg, p = engine.position();
  const market = engine.market(), referenceDecimals = cfg.tokens[market.reference].decimals;
  const stop = p ? stopLevel(p, cfg) : null;
  const samples = engine.store.get(engine.key('samples')) || [];
  const chartSamples = engine.store.get(engine.key('chartSamples')) || samples;
  const orders = engine.orders().filter(o => o.mode === cfg.mode).sort((a, b) => b.time - a.time);
  const realized = orders.reduce((n, o) => n + BigInt(o.realizedQuote || o.realizedSOL || '0'), 0n) -
    (cfg.mode === 'paper' ? BigInt(engine.store.get(engine.key('realizedBaseline')) || '0') : 0n);
  const last = samples.at(-1);
  return { pair: cfg.pair, assets: ASSETS, base: cfg.base, quote: cfg.quote, quoteDecimals: cfg.quoteDecimals, marketType: cfg.marketType || 'pair', trackedAsset: cfg.trackedAsset, market, marketKey: `${cfg.marketType || 'pair'}:${market.asset}:${market.reference}`, mode: cfg.mode, running: engine.active(), closing: engine.closing, busy: engine.busy, error: engine.store.get('lastError') || '',
    wallet: engine.wallet?.address || null, pairReady: cfg.pairReady, dogeMint: cfg.tokens[cfg.base].mint, dogeDecimals: cfg.tokens[cfg.base].decimals, usdcMint: cfg.tokens.USDC.mint, tokenMint: cfg.tokens[cfg.splToken].mint, tokenDecimals: cfg.tokens[cfg.splToken].decimals, pending: engine.pending().length,
    assetMint: cfg.tokens[market.asset].mint, tracker: engine.store.get(engine.key('tracker')) || null,
    price: last ? Number(last.price) / 10 ** referenceDecimals : null,
    chartInterval: 15,
    samples: chartSamples.map(s => ({ time: s.time, price: Number(s.price) / 10 ** referenceDecimals })),
    warmup: Math.min(samples.length, warmup(cfg)), warmupRequired: warmup(cfg),
    position: market.executable && p ? { amount: format(p.amount, cfg.tokens[cfg.base].decimals), cost: format(p.cost, cfg.quoteDecimals),
      stopPrice: Number(stop.numerator) / Number(stop.denominator) / 10 ** cfg.quoteDecimals,
      slTrailing: Boolean(p.slHigh),
      value: last ? Number(BigInt(p.amount) * BigInt(last.price) / (10n ** BigInt(cfg.tokens[cfg.base].decimals))) / 10 ** cfg.quoteDecimals : null } : null,
    positions: lotsOf(p).map((lot, index) => {
      const level = stopLevel(lot, cfg);
      return { id: lot.id, label: `Buy ${index + 1}`, opened: lot.opened, amount: format(lot.amount, cfg.tokens[cfg.base].decimals), cost: format(lot.cost, cfg.quoteDecimals),
        takeProfitPrice: Number(lot.cost) / Number(lot.amount) * 10 ** (cfg.tokens[cfg.base].decimals - cfg.quoteDecimals) * (1 + cfg.takeProfit / 10000),
        stopPrice: Number(level.numerator) / Number(level.denominator) / 10 ** cfg.quoteDecimals, slTrailing: Boolean(lot.slHigh) };
    }),
    realized: Number(realized) / 10 ** cfg.quoteDecimals,
    strategy: strategySettings(cfg),
    chartTrades: orders.filter(o => o.status === 'filled' && chartSamples.length && o.time >= chartSamples[0].time)
      .map(o => ({ time: o.time, side: o.side, status: o.status })),
    paperStartingBalance: format(engine.store.get(engine.key('startingBalance')) ?? (10n ** BigInt(cfg.quoteDecimals)).toString(), cfg.quoteDecimals),
    tradeCount: orders.length,
    trades: orders.slice(0, 30).map(o => ({ id: o.id, mode: o.mode, side: o.side, reason: o.reason, status: o.status,
      time: o.time, input: o.input, output: o.output, amount: format(o.actualInput || o.amount, cfg.tokens[o.input].decimals),
      received: o.actualOutput ? format(o.actualOutput, cfg.tokens[o.output].decimals) : null, signature: o.signature })),
  };
}

export function appServer(engine, { token, owner, demo = false, publicUrl = '', vault = null, clock = Date.now, assetResolver = resolveAsset }) {
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  let lastAction = 0, walletBusy = false;
  let priceRequest = null, lastPrice = null;
  let assetBusy = false;
  async function marketPrice() {
    if (assetBusy) throw new UserError('Asset change in progress.');
    if (priceRequest) return priceRequest;
    const selected = engine.market(), selectedKey = `${engine.cfg.marketType || 'pair'}:${selected.asset}:${selected.reference}`;
    if (lastPrice?.marketKey === selectedKey && clock() - lastPrice.time < 4500) return lastPrice;
    priceRequest = (async () => {
      const cfg = engine.cfg, market = engine.market(), chartKey = engine.key('chartSamples');
      const amount = (10n ** BigInt(cfg.tokens[market.asset].decimals)).toString();
      const q = validateQuote(await engine.jupiter.quote(market.asset, market.reference, amount), market.asset, market.reference, amount, cfg);
      const now = clock();
      lastPrice = { pair: cfg.pair, marketKey: `${cfg.marketType || 'pair'}:${market.asset}:${market.reference}`, price: Number(q.outAmount) / 10 ** cfg.tokens[market.reference].decimals, time: now };
      const chart = engine.store.get(chartKey) || [];
      // Display sampling is independent of trading, EMA warm-up and strategy intervals.
      const bucket = Math.floor(now / 15000) * 15000;
      if (!chart.length || bucket > chart.at(-1).time) {
        chart.push({ time: bucket, price: q.outAmount });
        engine.store.set(chartKey, chart.slice(-600));
      }
      return lastPrice;
    })();
    try { return await priceRequest; } finally { priceRequest = null; }
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors https://web.telegram.org https://*.telegram.org");
    const reply = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/healthz') return reply(200, { status: 'ok' });
      if (req.method === 'GET' && files[path]) {
        const [file, type] = files[path];
        res.writeHead(200, { 'Content-Type': type });
        res.end(await readFile(fileURLToPath(new URL(`../web/${file}`, import.meta.url)))); return;
      }
      if (!path.startsWith('/api/')) return reply(404, { error: 'Not found' });
      if (!demo && !authenticate(req.headers.authorization?.replace(/^tma /, ''), token, owner))
        return reply(401, { error: 'Open this app from your bot in Telegram using the authorized owner account.' });
      if (req.method === 'GET' && path === '/api/price') return reply(200, await marketPrice());
      if (req.method === 'GET' && path === '/api/state') return reply(200, { ...snapshot(engine), demo });
      if (req.method === 'GET' && path === '/api/balance') { const balance = await engine.balances(); return reply(200, { ...balance, availableToTrade: availableQuote(balance, engine.cfg).toString() }); }
      if (req.method === 'GET' && path === '/api/wallet') {
        if (!engine.wallet) return reply(200, { exists: vault?.exists() || false, locked: vault?.exists() || false, demo });
        if (demo) return reply(200, { exists: true, demo: true, address: 'Preview wallet — no real deposits', balance: await engine.balances() });
        const address = engine.wallet.address;
        let balance = null;
        try { balance = await engine.wallet.balances(); } catch { /* The deposit address remains available during RPC outages. */ }
        return reply(200, { exists: true, locked: false, address, balance, network: 'Solana mainnet', uri: 'solana:' + address,
          qr: await QRCode.toDataURL('solana:' + address, { width: 300, margin: 2, errorCorrectionLevel: 'M' }) });
      }
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        const expectedOrigin = publicUrl ? new URL(publicUrl).origin : null;
        if (origin && ((expectedOrigin && origin !== expectedOrigin) || (!expectedOrigin && origin !== `http://${req.headers.host}`)))
          return reply(403, { error: 'Origin rejected.' });
        if (path !== '/api/stop' && Date.now() - lastAction < 750) return reply(429, { error: 'Please wait a moment.' });
        lastAction = Date.now();
        switch (path) {
          case '/api/asset': {
            const input = await readSettings(req);
            if (assetBusy) throw new UserError('Asset change already in progress.');
            assetBusy = true;
            try {
              if (priceRequest) await priceRequest.catch(() => {});
              await engine.changeAsset(input, assetResolver);
              lastPrice = null;
            } finally { assetBusy = false; }
            break;
          }
          case '/api/mode': {
            const input = await readSettings(req);
            if (demo && input.mode === 'live') throw new UserError('Live trading is disabled in this simulated preview. Open your deployed Telegram app.');
            engine.switchMode(input.mode, input.acknowledged === true);
            break;
          }
          case '/api/strategy': await engine.configureWhenReady(await readSettings(req)); break;
          case '/api/wallet/unlock':
          case '/api/wallet/create': {
            if (demo) {
              engine.wallet ||= { address: 'Preview wallet', balances: async () => ({ SOL: '0', USDC: '0', DOGE: '0', cbBTC: '0' }) };
              return reply(200, { message: 'Preview wallet created. Deposits are disabled in the demo.' });
            }
            if (!vault) throw new UserError('Wallet service unavailable.');
            if (engine.wallet || walletBusy) throw new UserError('Wallet already unlocked or an operation is in progress.');
            walletBusy = true;
            try {
              const input = await readSettings(req);
              const wallet = vault.withKey(input.key, path === '/api/wallet/create');
              input.key = '';
              if (!wallet) throw new UserError('No wallet exists. Create one first.');
              await wallet.verifyNetwork();
              engine.bindWallet(wallet.address);
              engine.wallet = wallet;
              return reply(200, { address: wallet.address });
            } finally { walletBusy = false; }
          }
          case '/api/paper/balance': { const input = await readSettings(req); engine.setPaperBalance(input.amount); break; }
          case '/api/paper/reset-balance': engine.resetPaperSession(); break;
          case '/api/start': engine.start(); break;
          case '/api/stop': engine.stop(); break;
          case '/api/close': engine.requestClose(); break;
          case '/api/reconcile': return reply(200, { message: await engine.reconcile() });
          default: return reply(404, { error: 'Unknown action.' });
        }
        return reply(200, snapshot(engine));
      }
      reply(405, { error: 'Method not allowed.' });
    } catch (error) { reply(error instanceof UserError ? 400 : 503, { error: error instanceof UserError ? error.message : 'Service unavailable. Try again shortly.' }); }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}
