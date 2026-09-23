import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from './config.js';
import { Vault } from './vault.js';

// Explicit local recovery utility. Never sends a key through Telegram or HTTP.
if (!process.argv[2]) throw new Error('Provide a new file path outside the repository: npm run export-wallet -- /secure/path/backup.key.json');
const wallet = new Vault(config(process.env, false)).load();
if (!wallet) throw new Error('No wallet exists.');
writeFileSync(resolve(process.argv[2]), JSON.stringify(Array.from(wallet.signer.secretKey)), { flag: 'wx', mode: 0o600 });
console.log('Wallet keypair exported to the requested local file. Keep this file private; it controls the funds.');
