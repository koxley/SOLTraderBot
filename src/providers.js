import { readFileSync } from 'node:fs';
import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { UserError } from './config.js';

export async function jsonRequest(url, options = {}, timeout = 15000) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) }); }
  catch { throw new UserError('Service request timed out or could not connect.'); }
  if (!response.ok) throw new UserError(`Service returned HTTP ${response.status}. Try again later.`);
  try { return await response.json(); } catch { throw new UserError('Service returned invalid JSON.'); }
}

export class Jupiter {
  constructor(cfg, request = jsonRequest) { this.cfg = cfg; this.request = request; this.lastRequest = 0; }
  quote(...args) {
    // Price polling and strategy requests share the provider's request spacing.
    const request = (this.quoteQueue || Promise.resolve()).then(() => this.fetchQuote(...args));
    this.quoteQueue = request.catch(() => {});
    return request;
  }
  async fetchQuote(input, output, amount, taker) {
    // Public/keyless tier is 0.5 requests per second. Commands are processed serially.
    const delay = (this.cfg.apiKey ? 150 : 2100) - (Date.now() - this.lastRequest);
    if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
    this.lastRequest = Date.now();
    if (!this.cfg.pairReady) throw new UserError('Trading token mint is not configured.');
    const params = new URLSearchParams({ inputMint: this.cfg.tokens[input].mint, outputMint: this.cfg.tokens[output].mint,
      amount, slippageBps: String(this.cfg.slippage), swapMode: 'ExactIn', excludeRouters: 'jupiterz' });
    if (taker) params.set('taker', taker);
    return this.request(`https://api.jup.ag/swap/v2/order?${params}`, { headers: this.headers() });
  }
  headers() { return { 'Content-Type': 'application/json', ...(this.cfg.apiKey ? { 'x-api-key': this.cfg.apiKey } : {}) }; }
  async topTradingAsset(assets) {
    if (!Array.isArray(assets) || !assets.length) throw new UserError('The stored Asset List is empty.');
    const byMint = new Map(assets.map(asset => [asset.mint, asset]));
    const query = encodeURIComponent(assets.map(asset => asset.mint).join(','));
    const rows = await this.request(`https://api.jup.ag/tokens/v2/search?query=${query}`, { headers: this.headers() });
    if (!Array.isArray(rows)) throw new UserError('Jupiter returned invalid one-hour market data.');
    const ranked = rows.flatMap(row => {
      const asset = byMint.get(row?.id), gain = Number(row?.stats1h?.priceChange);
      return asset && Number.isFinite(gain) ? [{ asset, gain }] : [];
    }).sort((a, b) => b.gain - a.gain || assets.indexOf(a.asset) - assets.indexOf(b.asset));
    if (!ranked.length) throw new UserError('One-hour performance is unavailable for the stored Asset List.');
    return ranked[0];
  }
  execute(order, signedTransaction) {
    return this.request('https://api.jup.ag/swap/v2/execute', { method: 'POST', headers: this.headers(),
      body: JSON.stringify({ signedTransaction, requestId: order.requestId, lastValidBlockHeight: order.lastValidBlockHeight }) }, 60000);
  }
}

export class Wallet {
  constructor(cfg, suppliedSigner) {
    this.cfg = cfg;
    const bytes = suppliedSigner ? Array.from(suppliedSigner.secretKey) : JSON.parse(readFileSync(cfg.keyPath, 'utf8'));
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(n => !Number.isInteger(n) || n < 0 || n > 255))
      throw new Error('Keypair file must contain 64 bytes.');
    this.signer = Keypair.fromSecretKey(Uint8Array.from(bytes));
    this.address = this.signer.publicKey.toBase58();
    this.connection = new Connection(cfg.rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true,
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) });
  }
  async verifyNetwork() {
    if (await this.connection.getGenesisHash() !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')
      throw new Error('Live swaps require a Solana mainnet RPC.');
  }
  async balances() {
    const [sol, tokens] = await Promise.all([
      this.connection.getBalance(this.signer.publicKey),
      this.cfg.pairReady ? this.connection.getParsedTokenAccountsByOwner(this.signer.publicKey, { mint: new PublicKey(this.cfg.tokens[this.cfg.splToken].mint) }) : Promise.resolve({ value: [] }),
    ]);
    if (!Number.isSafeInteger(sol)) throw new UserError('SOL balance exceeds safe RPC integer range.');
    return { SOL: String(sol), [this.cfg.splToken]: tokens.value.reduce((sum, t) => sum + BigInt(t.account.data.parsed.info.tokenAmount.amount), 0n).toString() };
  }
  async prepare(quote) {
    const tx = VersionedTransaction.deserialize(Buffer.from(quote.transaction, 'base64'));
    if (!tx.message.staticAccountKeys[0].equals(this.signer.publicKey) || tx.message.header.numRequiredSignatures !== 1)
      throw new UserError('Unexpected fee payer or additional signer; refusing transaction.');
    if (!(await this.connection.isBlockhashValid(tx.message.recentBlockhash)).value)
      throw new UserError('Transaction expired; request a new quote.');
    const mint = new PublicKey(this.cfg.tokens[this.cfg.splToken].mint);
    const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const [ata] = PublicKey.findProgramAddressSync([this.signer.publicKey.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'));
    const [beforeSol, beforeToken] = await Promise.all([
      this.connection.getBalance(this.signer.publicKey), this.connection.getAccountInfo(ata),
    ]);
    if (!Number.isSafeInteger(beforeSol)) throw new UserError('Invalid wallet balance.');
    const beforeDoge = beforeToken ? beforeToken.data.readBigUInt64LE(64) : 0n;
    tx.sign([this.signer]);
    const simulation = await this.connection.simulateTransaction(tx, { sigVerify: true, commitment: 'confirmed',
      accounts: { encoding: 'base64', addresses: [this.address, ata.toBase58()] } });
    if (simulation.value.err) throw new UserError('Transaction simulation failed; no swap was submitted.');
    const [afterSol, afterToken] = simulation.value.accounts || [];
    if (!afterSol || !Number.isSafeInteger(afterSol.lamports) || !afterToken)
      throw new UserError('Could not verify simulated wallet balances.');
    const afterDoge = Buffer.from(afterToken.data[0], 'base64').readBigUInt64LE(64);
    const dogeDelta = afterDoge - beforeDoge, solDelta = BigInt(afterSol.lamports) - BigInt(beforeSol);
    const feeAllowance = BigInt(quote.signatureFeeLamports) + BigInt(quote.prioritizationFeeLamports) + BigInt(quote.rentFeeLamports);
    const buying = quote.inputMint === this.cfg.tokens.SOL.mint;
    if (buying ? (dogeDelta < BigInt(quote.otherAmountThreshold) || -solDelta > BigInt(quote.inAmount) + feeAllowance)
      : (-dogeDelta !== BigInt(quote.inAmount) || solDelta + feeAllowance < BigInt(quote.otherAmountThreshold)))
      throw new UserError('Simulated balance changes do not match the approved swap.');
    return { signed: Buffer.from(tx.serialize()).toString('base64'), signature: bs58.encode(tx.signatures[0]) };
  }
  async status(signature) {
    return (await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
  }
  async expired(lastValidBlockHeight) {
    if (!/^\d+$/.test(String(lastValidBlockHeight))) return false;
    return BigInt(await this.connection.getBlockHeight('finalized')) > BigInt(lastValidBlockHeight) + 150n;
  }
  async receipt(order) {
    const tx = await this.connection.getTransaction(order.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta || tx.meta.err) return null;
    const meta = tx.meta;
    const tokenTotal = list => (list || []).filter(b => b.owner === this.address && b.mint === this.cfg.tokens[this.cfg.splToken].mint)
      .reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
    const dogeDelta = tokenTotal(meta.postTokenBalances) - tokenTotal(meta.preTokenBalances);
    if (![meta.postBalances[0], meta.preBalances[0], meta.fee].every(Number.isSafeInteger)) return null;
    // Fee payer is verified before signing. SOL received is conservative if rent was paid.
    const solDelta = BigInt(meta.postBalances[0]) - BigInt(meta.preBalances[0]) + BigInt(meta.fee);
    const input = order.input === 'SOL' ? -solDelta : -dogeDelta;
    const output = order.input === 'SOL' ? dogeDelta : solDelta;
    if (input <= 0n || output <= 0n) return null;
    return { input: input.toString(), output: output.toString() };
  }
}

export async function verifyMint(cfg) {
  if (!cfg.pairReady) return;
  const connection = new Connection(cfg.rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) });
  const result = await connection.getParsedAccountInfo(new PublicKey(cfg.tokens[cfg.splToken].mint));
  const account = result.value;
  // Keep this implementation scoped to classic SPL tokens; transfer-fee extensions need extra accounting.
  if (!account || account.owner.toBase58() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
      account.data.parsed?.type !== 'mint' || account.data.parsed.info.decimals !== cfg.tokens[cfg.splToken].decimals)
    throw new Error('Trading token mint is not a classic SPL mint with the configured decimals.');
}
