import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { UserError, format } from './config.js';
import { strategySettings } from './strategy.js';

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
  const time = Number(params.get('auth_date'));
  if (!Number.isInteger(time) || time > now / 1000 + 30 || now / 1000 - time > 3600) return false;
  try { return String(JSON.parse(params.get('user')).id) === owner; } catch { return false; }
}

export function snapshot(engine) {
  const cfg = engine.cfg, p = engine.position();
  const samples = engine.store.get(engine.key('samples')) || [];
  const orders = engine.store.orders().filter(o => o.mode === cfg.mode).sort((a, b) => b.time - a.time);
  const realized = orders.filter(o => o.realizedSOL).reduce((n, o) => n + BigInt(o.realizedSOL), 0n);
  const last = samples.at(-1);
  return { mode: cfg.mode, running: engine.active(), closing: engine.closing, busy: engine.busy, error: engine.store.get('lastError') || '',
    wallet: engine.wallet?.address || null, pairReady: cfg.pairReady, dogeMint: cfg.tokens.DOGE.mint, dogeDecimals: cfg.tokens.DOGE.decimals, pending: engine.pending().length,
    price: last ? Number(last.price) / 1e9 : null,
    samples: samples.map(s => ({ time: s.time, price: Number(s.price) / 1e9 })),
    warmup: Math.min(samples.length, cfg.slow + 1), warmupRequired: cfg.slow + 1,
    position: p ? { amount: format(p.amount, cfg.tokens.DOGE.decimals), cost: format(p.cost, 9),
      value: last ? Number(BigInt(p.amount) * BigInt(last.price) / (10n ** BigInt(cfg.tokens.DOGE.decimals))) / 1e9 : null } : null,
    realized: Number(realized) / 1e9,
    strategy: strategySettings(cfg),
    tradeCount: orders.length,
    trades: orders.slice(0, 30).map(o => ({ id: o.id, mode: o.mode, side: o.side, reason: o.reason, status: o.status,
      time: o.time, input: o.input, output: o.output, amount: format(o.actualInput || o.amount, cfg.tokens[o.input].decimals),
      received: o.actualOutput ? format(o.actualOutput, cfg.tokens[o.output].decimals) : null, signature: o.signature })),
  };
}

export function appServer(engine, { token, owner, demo = false, publicUrl = '', vault = null }) {
  const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'] };
  let lastAction = 0, walletBusy = false;
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
        return reply(401, { error: 'Open this app from your bot in Telegram. Session expires after one hour; reopen to refresh.' });
      if (req.method === 'GET' && path === '/api/state') return reply(200, { ...snapshot(engine), demo });
      if (req.method === 'GET' && path === '/api/balance') return reply(200, await engine.balances());
      if (req.method === 'GET' && path === '/api/wallet') {
        if (!engine.wallet) return reply(200, { exists: vault?.exists() || false, locked: vault?.exists() || false, demo });
        if (demo) return reply(200, { exists: true, demo: true, address: 'Preview wallet — no real deposits', balance: { SOL: '0', DOGE: '0' } });
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
          case '/api/mode': {
            const input = await readSettings(req);
            if (demo && input.mode === 'live') throw new UserError('Live trading is disabled in this simulated preview. Open your deployed Telegram app.');
            engine.switchMode(input.mode, input.acknowledged === true);
            break;
          }
          case '/api/strategy': engine.configure(await readSettings(req)); break;
          case '/api/wallet/unlock':
          case '/api/wallet/create': {
            if (demo) {
              engine.wallet ||= { address: 'Preview wallet', balances: async () => ({ SOL: '0', DOGE: '0' }) };
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
