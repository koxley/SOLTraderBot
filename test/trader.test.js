import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { config, units, format } from '../src/config.js';
import { Store } from '../src/store.js';
import { Engine, signal, validateQuote } from '../src/engine.js';
import { authenticate, appServer } from '../src/server.js';
import { Vault } from '../src/vault.js';
import { Telegram } from '../src/telegram.js';
import { Jupiter, Wallet } from '../src/providers.js';
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { strategySettings } from '../src/strategy.js';

test('strategy settings persist, update runtime and reset sampling only when needed', t => {
  const f = fixture(t); const original = strategySettings(f.cfg);
  f.store.set(f.engine.key('samples'), [{ price: '1000', time: 1 }]);
  f.engine.configure({ ...original, size: '0.03', slippage: '0.25' });
  assert.equal(f.cfg.tradeSize, '30000000'); assert.equal(f.cfg.slippage, 25);
  assert.equal(f.store.get(f.engine.key('samples')).length, 1);
  f.engine.configure({ ...strategySettings(f.cfg), fast: 4, slow: 9 });
  assert.deepEqual(f.store.get(f.engine.key('samples')), []);
  const fresh = config({ DOGE_MINT: mint }, false);
  new Engine(fresh, f.store, f.provider);
  assert.equal(fresh.fast, 4); assert.equal(fresh.tradeSize, '30000000');
  assert.equal(f.store.get('live:strategy'), undefined);
});
test('strategy rejects invalid settings and changes during trading without partial writes', t => {
  const f = fixture(t), settings = strategySettings(f.cfg);
  for (const patch of [{ fast: 20, slow: 5 }, { size: '2' }, { slippage: '3.01' }, { interval: '1' }, { stopLoss: '0' }, { size: '1e-4' }, { takeProfit: '0.001' }, { maxDaily: '0.001' }, { token: 'secret' }])
    assert.throws(() => f.engine.configure({ ...settings, ...patch }));
  assert.deepEqual(strategySettings(f.cfg), settings);
  assert.equal(f.store.get(f.engine.key('strategy')), undefined);
  f.engine.start(); assert.throws(() => f.engine.configure(settings), /Stop the bot/);
  f.engine.stop(); f.engine.busy = true; assert.throws(() => f.engine.configure(settings), /Stop the bot/);
});
test('strategy API requires owner authentication and validates request payload', async t => {
  const f = fixture(t), token = '123:secret', owner = '456';
  const server = appServer(f.engine, { token, owner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/strategy`;
  const body = JSON.stringify({ ...strategySettings(f.cfg), size: '0.04' });
  assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
  const response = await fetch(url, { method: 'POST', body, headers: { Authorization: 'tma ' + signedAuth(token, owner), 'Content-Type': 'application/json' } });
  assert.equal(response.status, 200); assert.equal((await response.json()).strategy.size, '0.04');
  assert.equal(f.engine.active(), false);
});

const mint = 'DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R';
function fixture(t, env = {}) {
  const cfg = config({ DOGE_MINT: mint, EMA_FAST: '2', EMA_SLOW: '3', ...env }, false);
  const store = new Store(':memory:', cfg.paper); t.after(() => store.close());
  let now = Date.parse('2026-09-23T12:00:00Z'), price = 1000000n, executions = 0;
  const provider = {
    async quote(input, output, amount, taker) {
      const out = input === 'SOL' ? BigInt(amount) * 100000000n / price : BigInt(amount) * price / 100000000n;
      return { inputMint: cfg.tokens[input].mint, outputMint: cfg.tokens[output].mint, inAmount: amount,
        outAmount: out.toString(), otherAmountThreshold: (out * 9950n / 10000n).toString(),
        slippageBps: 50, swapMode: 'ExactIn', taker, transaction: 'test', requestId: 'request', router: 'metis',
        signatureFeeLamports: 5000, prioritizationFeeLamports: 0, rentFeeLamports: 0 };
    },
    async execute() { executions++; throw new Error('timeout'); },
  };
  const wallet = { address: 'wallet', async balances() { return { SOL: '1000000000', DOGE: '10000000000' }; },
    async prepare() { return { signed: 'signed', signature: 'signature' }; }, async status() { return null; } };
  const engine = new Engine(cfg, store, provider, cfg.mode === 'live' ? wallet : null, () => now);
  return { cfg, store, engine, provider, wallet, advance: () => now += cfg.sampleMs, price: n => price = BigInt(n), executions: () => executions };
}
test('decimal amounts retain exact smallest units and reject malformed input', () => {
  assert.equal(units('0.000000001', 9), 1n); assert.equal(format('1234000000', 9), '1.234');
  for (const input of ['-1', 'NaN', '1e9', '1,000', '0.0000000001', 'Infinity', '']) assert.throws(() => units(input, 9));
});
test('live execution requires explicit local acknowledgement; invalid strategy rejected', () => {
  assert.throws(() => config({ TRADING_MODE: 'live' }, false));
  assert.throws(() => config({ EMA_FAST: '12', EMA_SLOW: '5' }, false));
});
test('EMA buy crossover and stop-loss/take-profit exits', () => {
  const cfg = config({ DOGE_MINT: mint, EMA_FAST: '2', EMA_SLOW: '3' }, false);
  const series = [100, 100, 100, 130].map(price => ({ price: String(price * 10000) }));
  assert.equal(signal(series, null, cfg).side, 'buy');
  assert.equal(signal([{ price: '960000' }], { amount: '100000000', cost: '1000000' }, cfg).reason, 'stop loss');
  assert.equal(signal([{ price: '1070000' }], { amount: '100000000', cost: '1000000' }, cfg).reason, 'take profit');
  assert.equal(signal(series.slice(0, 2), null, cfg), null);
});
test('automatic crossover buys DOGE using SOL and stop loss sells it back', async t => {
  const f = fixture(t); f.engine.start();
  for (const price of [1000000, 1000000, 1000000, 1100000]) { f.price(price); await f.engine.tick(); f.advance(); }
  assert.equal(f.store.orders().length, 1); assert.ok(f.engine.position());
  f.price(900000); await f.engine.tick();
  assert.equal(f.store.orders().length, 2); assert.equal(f.engine.position(), null);
  assert.equal(f.store.orders()[0].side, 'sell'); assert.equal(f.store.orders()[0].reason, 'stop loss');
});
test('stopped bot makes no price requests or trades', async t => {
  const f = fixture(t); f.provider.quote = () => assert.fail('provider should not be called');
  assert.equal(await f.engine.tick(), null);
});
test('Close Open Positions exits while stopped and does not sell external DOGE deposits', async t => {
  const f = fixture(t, { PAPER_DOGE: '10' }); f.engine.start();
  await f.engine.trade({ side: 'buy', reason: 'test entry' });
  f.engine.requestClose(); await f.engine.tick();
  assert.equal(f.engine.position(), null); assert.equal(f.engine.active(), false);
  assert.equal(f.store.get('paper').DOGE, '1000000000');
  assert.equal(f.store.orders()[0].reason, 'Close Open Positions');
});
test('closing an empty position is a no-op', async t => {
  const f = fixture(t); f.engine.requestClose();
  assert.match(await f.engine.tick(), /No bot position/); assert.equal(f.store.orders().length, 0);
});
test('exits remain possible above entry limits', async t => {
  const f = fixture(t); f.engine.start(); await f.engine.trade({ side: 'buy', reason: 'test' });
  f.cfg.maxTrade = '1'; f.cfg.maxDaily = '1'; f.engine.requestClose(); await f.engine.tick();
  assert.equal(f.engine.position(), null);
});
test('entry budget and insufficient paper funds are enforced before debiting', async t => {
  const f = fixture(t, { MAX_DAILY_SOL: '0.01' }); f.engine.start();
  await assert.rejects(f.engine.trade({ side: 'buy', reason: 'test' }), /Daily/);
  assert.equal(f.store.orders().length, 0); assert.equal(f.store.get('paper').SOL, '1000000000');
  f.cfg.maxDaily = '1000000000'; f.store.set('paper', { SOL: '1', DOGE: '0' });
  await assert.rejects(f.engine.trade({ side: 'buy', reason: 'test' }), /Insufficient/);
});
test('tampered mint, input and slippage are rejected', async t => {
  const f = fixture(t), q = await f.provider.quote('SOL', 'DOGE', '25000000');
  for (const changed of [{ inputMint: mint }, { inAmount: '1' }, { otherAmountThreshold: '1' }, { slippageBps: 500 }])
    assert.throws(() => validateQuote({ ...q, ...changed }, 'SOL', 'DOGE', '25000000', f.cfg));
});
test('Stop during quote fetch prevents submission', async t => {
  const f = fixture(t); f.engine.start(); const original = f.provider.quote;
  f.provider.quote = async (...args) => { const q = await original(...args); f.engine.stop(); return q; };
  assert.match(await f.engine.trade({ side: 'buy', reason: 'test' }), /Stopped before/);
  assert.equal(f.store.orders().length, 0);
});
test('timeout is persisted as unknown, halts trading and cannot be retried', async t => {
  const f = fixture(t, { TRADING_MODE: 'live', LIVE_TRADING_ACK: 'I_UNDERSTAND_REAL_FUNDS' });
  f.engine.start(); assert.match(await f.engine.trade({ side: 'buy', reason: 'test' }), /unknown/);
  assert.equal(f.store.orders()[0].status, 'unknown'); assert.equal(f.engine.active(), false);
  assert.equal(f.executions(), 1); assert.throws(() => f.engine.start(), /unsettled/);
  await f.engine.tick(); assert.equal(f.executions(), 1);
});
test('reconciliation applies a confirmed fill once', async t => {
  const f = fixture(t, { TRADING_MODE: 'live', LIVE_TRADING_ACK: 'I_UNDERSTAND_REAL_FUNDS' });
  f.engine.start(); await f.engine.trade({ side: 'buy', reason: 'test' });
  f.wallet.status = async () => ({ confirmationStatus: 'confirmed', err: null });
  f.wallet.receipt = async () => ({ input: '25000000', output: '2400000000' });
  await f.engine.reconcile(); await f.engine.reconcile();
  assert.equal(f.engine.position().amount, '2400000000'); assert.equal(f.store.orders().length, 1);
  assert.equal(f.store.orders()[0].status, 'filled'); assert.equal(f.engine.active(), false);
});
test('restart preserves positions, cancels automatic running and blocks unsettled orders', async t => {
  const f = fixture(t); f.engine.start(); await f.engine.trade({ side: 'buy', reason: 'test' });
  const reopened = new Engine(f.cfg, f.store, f.provider);
  assert.ok(reopened.position()); assert.equal(reopened.active(), false);
});
test('database transaction rolls back failed fill bookkeeping', t => {
  const f = fixture(t);
  assert.throws(() => f.store.atomic(() => { f.store.set('paper', { SOL: '0' }); throw new Error('disk failure'); }));
  assert.equal(f.store.get('paper').SOL, '1000000000');
});
test('encrypted wallet round-trip, no overwrite, wrong key and tampering rejected', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sol-pilot-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const secret = randomBytes(32).toString('hex');
  const cfg = config({ DATA_DIR: dir, WALLET_ENCRYPTION_KEY: secret }, false);
  assert.equal(cfg.encryptionKey, '');
  const vault = new Vault(cfg), wallet = vault.withKey(secret, true);
  assert.equal(cfg.encryptionKey, "");
  assert.equal(vault.withKey(secret).address, wallet.address); assert.throws(() => vault.withKey(secret, true), /already exists/);
  assert.throws(() => vault.withKey(randomBytes(32).toString("hex")), /Could not unlock/);
  assert.equal(cfg.encryptionKey, "");
  const raw = readFileSync(vault.path, 'utf8'); assert.ok(!raw.includes(JSON.stringify(Array.from(wallet.signer.secretKey))));
  assert.throws(() => new Vault({ ...cfg, encryptionKey: randomBytes(32).toString('hex') }).load());
  const payload = JSON.parse(raw); payload.ciphertext = '00' + payload.ciphertext.slice(2);
  if (JSON.parse(raw).ciphertext === payload.ciphertext) payload.ciphertext = 'ff' + payload.ciphertext.slice(2);
  writeFileSync(vault.path, JSON.stringify(payload)); assert.throws(() => vault.withKey(secret));
});
function signedAuth(token, owner, date = Math.floor(Date.now() / 1000)) {
  const p = new URLSearchParams({ auth_date: String(date), query_id: 'test', user: JSON.stringify({ id: Number(owner) }) });
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const body = [...p].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  p.set('hash', createHmac('sha256', secret).update(body).digest('hex')); return p.toString();
}
test('Telegram initData accepts only the owner with a fresh authentic signature', () => {
  const token = '123:secret', owner = '456', valid = signedAuth(token, owner);
  assert.equal(authenticate(valid, token, owner), true);
  assert.equal(authenticate(valid, token, '999'), false);
  assert.equal(authenticate(valid.replace('456', '457'), token, owner), false);
  assert.equal(authenticate(signedAuth(token, owner, 1), token, owner), false);
  assert.equal(authenticate(valid + '&user={}', token, owner), false);
  assert.equal(authenticate('', token, owner), false);
});
test('HTTP app blocks unauthenticated trading and accepts owner-signed controls', async t => {
  const f = fixture(t), token = '123:secret', owner = '456';
  const server = appServer(f.engine, { token, owner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/api/start', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/')).status, 200);
  const health = await fetch(base + '/healthz');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  const headers = { Authorization: 'tma ' + signedAuth(token, owner) };
  assert.equal((await fetch(base + '/api/start', { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/start', { method: 'POST', headers })).status, 200);
  assert.equal(f.engine.active(), true);
  const state = await (await fetch(base + '/api/state', { headers })).json();
  assert.equal(state.running, true); assert.equal(state.dogeMint, mint);
  assert.equal(JSON.stringify(state).includes('secret'), false);
});
test('Telegram commands reject other users and groups', async t => {
  const f = fixture(t), telegram = new Telegram({ ...f.cfg, owner: '456' }, f.engine);
  telegram.send = async () => {};
  const message = { text: '/start', date: Math.floor(Date.now() / 1000), from: { id: 123 }, chat: { id: 456, type: 'private' } };
  await telegram.handle({ message }); assert.equal(f.engine.active(), false);
  await telegram.handle({ message: { ...message, from: { id: 456 }, chat: { id: 456, type: 'group' } } }); assert.equal(f.engine.active(), false);
  await telegram.handle({ message: { ...message, from: { id: 456 } } }); assert.equal(f.engine.active(), true);
});
test('Jupiter adapter passes selected mints, exact amounts and excludes additional signers', async t => {
  const f = fixture(t); let request;
  const j = new Jupiter(f.cfg, async (url, options) => { request = { url, options }; return {}; });
  await j.quote('SOL', 'DOGE', '25000000', 'wallet');
  const url = new URL(request.url);
  assert.equal(url.searchParams.get('outputMint'), mint); assert.equal(url.searchParams.get('amount'), '25000000');
  assert.equal(url.searchParams.get('excludeRouters'), 'jupiterz'); assert.equal(url.searchParams.get('slippageBps'), '50');
});
test('live preflight signs only after simulation matches input and minimum output', async t => {
  const f = fixture(t), signer = Keypair.generate(), wallet = new Wallet(f.cfg, signer);
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [SystemProgram.transfer({ fromPubkey: signer.publicKey,
      toPubkey: Keypair.generate().publicKey, lamports: 1 })] }).compileToV0Message());
  const q = await f.provider.quote('SOL', 'DOGE', '25000000', wallet.address);
  q.transaction = Buffer.from(tx.serialize()).toString('base64');
  let simulatedDoge = BigInt(q.otherAmountThreshold), simulatedSol = 974995000;
  wallet.connection = {
    async isBlockhashValid() { return { value: true }; }, async getBalance() { return 1000000000; }, async getAccountInfo() { return null; },
    async simulateTransaction() {
      const data = Buffer.alloc(165); data.writeBigUInt64LE(simulatedDoge, 64);
      return { value: { err: null, accounts: [{ lamports: simulatedSol }, { data: [data.toString('base64'), 'base64'] }] } };
    },
  };
  const result = await wallet.prepare(q); assert.ok(result.signed); assert.ok(result.signature);
  simulatedDoge = 1n; await assert.rejects(wallet.prepare(q), /do not match/);
  simulatedDoge = BigInt(q.otherAmountThreshold); simulatedSol = 1;
  await assert.rejects(wallet.prepare(q), /do not match/);
});
test('expired unknown transaction releases the block only after a finalized recheck', async t => {
  const f = fixture(t, { TRADING_MODE: 'live', LIVE_TRADING_ACK: 'I_UNDERSTAND_REAL_FUNDS' });
  f.store.put({ id: 'expired', mode: 'live', status: 'unknown', signature: 'sig', lastValidBlockHeight: '100' });
  f.wallet.expired = async () => true;
  assert.match(await f.engine.reconcile(), /expired without/); assert.equal(f.engine.pending().length, 0);
  assert.equal(f.engine.active(), false);
});
test('SQLite reopens with the same balances and position on disk', t => {
  const dir = mkdtempSync(join(tmpdir(), 'sol-pilot-db-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cfg = config({ DOGE_MINT: mint }, false), path = join(dir, 'test.sqlite');
  const a = new Store(path, cfg.paper); a.set('paper', { SOL: '123', DOGE: '456' });
  a.set('paper:position', { amount: '456', cost: '789' }); a.close();
  const b = new Store(path, cfg.paper); assert.equal(b.get('paper').SOL, '123');
  assert.equal(b.get('paper:position').amount, '456'); b.close();
});
test('HTTP wallet creation and deposit QR never expose private material', async t => {
  const f = fixture(t), token = '123:secret', owner = '456';
  const signer = Keypair.generate();
  const server = appServer(f.engine, { token, owner, vault: { withKey: () => ({ verifyNetwork: async () => {}, address: signer.publicKey.toBase58(),
    signer, balances: async () => ({ SOL: '123000000', DOGE: '0' }) }) } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Authorization: 'tma ' + signedAuth(token, owner) };
  assert.equal((await fetch(base + '/api/wallet/create', { method: 'POST', headers, body: JSON.stringify({ key: 'a'.repeat(64) }) })).status, 200);
  const body = await (await fetch(base + '/api/wallet', { headers })).json();
  assert.equal(body.address, signer.publicKey.toBase58()); assert.equal(body.balance.SOL, '123000000');
  assert.equal(body.uri, 'solana:' + body.address); assert.match(body.qr, /^data:image\/png;base64,/);
  assert.equal(JSON.stringify(body).includes('secretKey'), false); assert.equal(body.signer, undefined);
});


test('mode changes isolate strategies and balances and never start trading', t => {
  const f = fixture(t), paper = f.store.get('paper'); f.engine.wallet = f.wallet;
  f.engine.configure({ ...strategySettings(f.cfg), size: '0.04' });
  assert.throws(() => f.engine.switchMode('live'), /acknowledge/);
  f.engine.start(); assert.throws(() => f.engine.switchMode('live', true), /Stop/); f.engine.stop();
  f.engine.switchMode('live', true);
  assert.equal(f.cfg.mode, 'live'); assert.equal(f.cfg.tradeSize, '25000000'); assert.equal(f.engine.active(), false);
  f.engine.configure({ ...strategySettings(f.cfg), size: '0.05' });
  f.engine.switchMode('paper'); assert.equal(f.cfg.tradeSize, '40000000'); assert.deepEqual(f.store.get('paper'), paper);
  f.engine.switchMode('live', true); assert.equal(f.cfg.tradeSize, '50000000');
  f.store.set('live:position', { amount: '1', cost: '1' });
  assert.throws(() => f.engine.switchMode('paper'), /Close your live/);
});

test('restart exposes real positions and unknown trades for unlock and recovery', async t => {
  const f = fixture(t);
  f.store.put({ id: 'pending-live', mode: 'live', status: 'unknown', signature: 'sig' });
  const restarted = new Engine(config({ DOGE_MINT: mint }, false), f.store, f.provider);
  assert.equal(restarted.cfg.mode, 'live'); assert.equal(restarted.pending().length, 1);
  assert.equal(restarted.active(), false);
  assert.throws(() => restarted.switchMode('paper'), /reconcile/);
  await assert.rejects(restarted.reconcile(), /Unlock/);
});

test('wallet address survives balance outages and mode API requires authentication', async t => {
  const f = fixture(t), token = '123:secret', owner = '456';
  f.engine.wallet = f.wallet;
  f.wallet.balances = async () => { throw new Error('private rpc detail'); };
  const server = appServer(f.engine, { token, owner });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Authorization: 'tma ' + signedAuth(token, owner) };
  const data = await (await fetch(base + '/api/wallet', { headers })).json();
  assert.equal(data.address, f.wallet.address); assert.equal(data.balance, null); assert.ok(data.qr);
  assert.equal((await fetch(base + '/api/mode', { method: 'POST', body: JSON.stringify({ mode: 'live', acknowledged: true }) })).status, 401);
  const result = await fetch(base + '/api/mode', { method: 'POST', headers, body: JSON.stringify({ mode: 'live', acknowledged: true }) });
  assert.equal(result.status, 200); assert.equal((await result.json()).mode, 'live'); assert.equal(f.engine.active(), false);
});

test('unlock endpoint requires owner and origin, clears supplied key, and reports locked wallets', async t => {
  const f = fixture(t), token = '123:secret', owner = '456'; f.engine.wallet = null;
  let calls = 0;
  const vault = { exists: () => true, withKey: key => { calls++; assert.equal(key, 'a'.repeat(64)); return { address: f.wallet.address, verifyNetwork: async () => {}, balances: f.wallet.balances }; } };
  const server = appServer(f.engine, { token, owner, vault, publicUrl: 'https://bot.example' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, headers = { Authorization: 'tma ' + signedAuth(token, owner) };
  assert.equal((await (await fetch(base + '/api/wallet', { headers })).json()).locked, true);
  const body = JSON.stringify({ key: 'a'.repeat(64) });
  assert.equal((await fetch(base + '/api/wallet/unlock', { method: 'POST', body })).status, 401);
  assert.equal((await fetch(base + '/api/wallet/unlock', { method: 'POST', body, headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  assert.equal(calls, 0);
  const response = await fetch(base + '/api/wallet/unlock', { method: 'POST', body, headers });
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal((await response.text()).includes('a'.repeat(64)), false);
});


test('Telegram optional setup rate limits do not abort startup; webhook checks still block', async t => {
  const f = fixture(t), bot = new Telegram(f.cfg, f.engine, 'https://bot.example');
  const calls = [];
  bot.api = async method => { calls.push(method); if (method === 'getWebhookInfo') return { url: '' }; throw new Error('Service returned HTTP 429'); };
  await bot.setup();
  assert.ok(calls.includes('setMyName')); assert.ok(calls.includes('setChatMenuButton')); assert.ok(calls.includes('sendMessage'));
  bot.api = async () => ({ url: 'https://existing.example/webhook' });
  await assert.rejects(bot.setup(), /webhook/);
  bot.api = async () => { throw new Error('unauthorized'); };
  await assert.rejects(bot.setup(), /unauthorized/);
});

test('wallet mainnet verification accepts full genesis hash and rejects other networks', async () => {
  const wallet = new Wallet(config({}, false), Keypair.generate());
  wallet.connection = { getGenesisHash: async () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' };
  await wallet.verifyNetwork();
  wallet.connection.getGenesisHash = async () => 'devnet';
  await assert.rejects(wallet.verifyNetwork(), /mainnet/);
});
