import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env already exists; no settings changed.');
} else {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync('.env', source.replace('WALLET_ENCRYPTION_KEY=', 'WALLET_ENCRYPTION_KEY=' + randomBytes(32).toString('hex')), { flag: 'wx', mode: 0o600 });
  console.log('Created private .env with a random wallet encryption key. Add your Telegram token, owner ID, and HTTPS app URL. Default mode is paper.');
}
