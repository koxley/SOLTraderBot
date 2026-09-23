import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists; no settings changed.');
} else {
  const source = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  writeFileSync('.env', source, { flag: 'wx', mode: 0o600 });
  console.log('Created private .env. Create or unlock your wallet from the app. Add your Telegram token, owner ID, and HTTPS app URL. Default mode is paper.');
}
