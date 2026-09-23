import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';
import { config } from './config.js';
import { Store } from './store.js';
import { Jupiter, verifyMint } from './providers.js';
import { Vault } from './vault.js';
import { Engine } from './engine.js';
import { Telegram } from './telegram.js';
import { appServer } from './server.js';

let engine, telegram, server, timer, release;
async function shutdown() {
  if (engine) engine.stop();
  if (telegram) telegram.stopped = true;
  clearInterval(timer);
  server?.close();
  // Allow a submitted swap to record its outcome before exiting.
  const deadline = Date.now() + 70000;
  while (engine?.busy && Date.now() < deadline) await new Promise(r => setTimeout(r, 200));
  if (release) await release();
  process.exit(0);
}
try {
  const cfg = config();
  const publicUrl = process.env.PUBLIC_APP_URL || '';
  if (publicUrl && new URL(publicUrl).protocol !== 'https:') throw new Error('PUBLIC_APP_URL must use HTTPS.');
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  mkdirSync(cfg.dataDir, { recursive: true });
  release = await lockfile.lock(cfg.dataDir, { stale: 120000, update: 10000,
    onCompromised: () => { engine?.stop(); process.exit(1); } });
  const store = new Store(join(cfg.dataDir, 'trader.sqlite'), cfg.paper);
  const vault = new Vault(cfg);
  const wallet = cfg.keyPath ? vault.load() : null;
  if (wallet) await wallet.verifyNetwork();
  await verifyMint(cfg);
  engine = new Engine(cfg, store, new Jupiter(cfg), wallet);
  telegram = new Telegram(cfg, engine, publicUrl);
  await telegram.setup();
  server = appServer(engine, { token: cfg.token, owner: cfg.owner, publicUrl, vault });
  server.listen(port, process.env.HOST || '127.0.0.1');
  server.on('error', () => { console.error('HTTP server could not listen. Check HOST and PORT.'); shutdown(); });
  timer = setInterval(async () => {
    const message = await engine.tick();
    if (message) { try { await telegram.send(message); } catch { console.error('Trade event saved; Telegram notification failed.'); } }
  }, 1000);
  console.log(`SOL TRADER started in ${cfg.mode.toUpperCase()} mode. Mini App on port ${port}. Strategy STOPPED.`);
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  await telegram.poll();
} catch {
  // Do not print provider errors, tokens, RPC URLs, or key material.
  console.error('Startup failed. Check .env, wallet file, network access, and whether another instance is running. Run npm test to verify the installation.');
  if (release) await release();
  process.exitCode = 1;
}
