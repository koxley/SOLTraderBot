import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { Vault } from './vault.js';
import { emitKeypressEvents } from 'node:readline';

// Explicit local recovery utility. Never sends a key through Telegram or HTTP.
if (!process.argv[2]) throw new Error('Provide a new file path outside the repository: npm run export-wallet -- /secure/path/backup.key.json');
const cfg = config(process.env, false), vault = new Vault(cfg);
async function requestKey() {
  if (!process.stdin.isTTY) throw new Error('Run recovery from an interactive terminal.');
  process.stdout.write('Wallet encryption key (hidden): ');
  emitKeypressEvents(process.stdin); process.stdin.setRawMode(true); process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => { process.stdin.off('keypress', handler); process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); };
    const handler = (text, key) => {
      if (key?.ctrl && key.name === 'c') { finish(); reject(new Error('Cancelled.')); }
      else if (key?.name === 'return') { finish(); resolve(value); value = ''; }
      else if (key?.name === 'backspace') value = value.slice(0, -1);
      else if (text && /^[a-fA-F0-9]+$/.test(text) && value.length + text.length <= 64) value += text;
    };
    process.stdin.on('keypress', handler);
  });
}
const wallet = cfg.keyPath ? vault.load() : vault.withKey(await requestKey());
if (!wallet) throw new Error('No wallet exists.');
writeFileSync(resolve(process.argv[2]), JSON.stringify(Array.from(wallet.signer.secretKey)), { flag: 'wx', mode: 0o600 });
console.log('Wallet keypair exported to the requested local file. Keep this file private; it controls the funds.');
