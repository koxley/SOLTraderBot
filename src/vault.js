import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { UserError } from './config.js';
import { Wallet } from './providers.js';

export class Vault {
  constructor(cfg) { this.cfg = cfg; this.path = join(cfg.dataDir, 'wallet.encrypted.json'); }
  key() {
    if (!/^[a-fA-F0-9]{64}$/.test(this.cfg.encryptionKey))
      throw new UserError('Wallet creation needs WALLET_ENCRYPTION_KEY. Run the local setup command first.');
    return Buffer.from(this.cfg.encryptionKey, 'hex');
  }
  load() {
    if (this.cfg.keyPath) return new Wallet(this.cfg);
    if (!existsSync(this.path)) return null;
    const payload = JSON.parse(readFileSync(this.path, 'utf8'));
    if (payload.version !== 1) throw new Error('Unsupported wallet format.');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(payload.iv, 'hex'));
    decipher.setAAD(Buffer.from('sol-pilot-wallet-v1'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    const secret = Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'hex')), decipher.final()]);
    try { return new Wallet(this.cfg, Keypair.fromSecretKey(secret)); } finally { secret.fill(0); }
  }
  create() {
    if (this.cfg.keyPath || existsSync(this.path)) throw new UserError('A wallet already exists. It will not be overwritten.');
    const key = this.key();
    const signer = Keypair.generate(), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('sol-pilot-wallet-v1'));
    const ciphertext = Buffer.concat([cipher.update(signer.secretKey), cipher.final()]);
    writeFileSync(this.path, JSON.stringify({ version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), ciphertext: ciphertext.toString('hex') }), { flag: 'wx', mode: 0o600 });
    return new Wallet(this.cfg, signer);
  }
}
