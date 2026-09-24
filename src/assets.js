import { Connection, PublicKey } from '@solana/web3.js';
import { TOKENS, UserError } from './config.js';
import { Jupiter } from './providers.js';

export const ASSETS = Object.entries(TOKENS).filter(([symbol]) => symbol !== 'SOL')
  .map(([symbol, token]) => ({ symbol, ...token }));

export function assetConfig(cfg, asset) {
  if (!asset || typeof asset.symbol !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,11}$/.test(asset.symbol) ||
      !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(asset.mint || '') ||
      !Number.isInteger(asset.decimals) || asset.decimals < 0 || asset.decimals > 12)
    throw new UserError('Enter a token symbol and a valid Solana mint.');
  if (asset.symbol.toUpperCase() === 'SOL' || asset.mint === TOKENS.SOL.mint)
    throw new UserError('Choose an asset other than SOL; SOL funds your trades.');
  const known = ASSETS.find(a => a.symbol.toUpperCase() === asset.symbol.toUpperCase());
  if (known && (known.mint !== asset.mint || known.decimals !== asset.decimals))
    throw new UserError('This symbol is reserved for its preset mint.');
  const byMint = ASSETS.find(a => a.mint === asset.mint);
  if (byMint && (byMint.symbol !== asset.symbol || byMint.decimals !== asset.decimals))
    throw new UserError('Use the preset for this mint.');
  const pair = asset.mint === TOKENS.cbBTC.mint ? 'CBBTC_SOL' : asset.mint === TOKENS.USDC.mint ? 'USDC_SOL' : `TOKEN_${asset.mint}_SOL`;
  return { base: asset.symbol, quote: 'SOL', quoteDecimals: 9, splToken: asset.symbol, pair, pairReady: true,
    tokens: { ...cfg.tokens, [asset.symbol]: { mint: asset.mint, decimals: asset.decimals } } };
}

// Mint metadata comes from the chain; display symbols never identify the traded asset.
export async function resolveAsset(input, cfg) {
  if (!input || typeof input !== 'object' || (!ASSETS.some(a => a.symbol === input.preset) &&
      (input.preset !== 'custom' || typeof input.symbol !== 'string' || typeof input.mint !== 'string')))
    throw new UserError('Choose a preset or enter a custom token symbol and Solana mint.');
  const preset = ASSETS.find(a => a.symbol === input?.preset);
  const symbol = preset?.symbol || input?.symbol?.trim();
  const mint = preset?.mint || input?.mint?.trim();
  assetConfig(cfg, { symbol, mint, decimals: preset?.decimals ?? 0 });
  let address;
  try { address = new PublicKey(mint); } catch { throw new UserError('Invalid Solana mint address.'); }
  const connection = new Connection(cfg.rpc, { commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) });
  const account = (await connection.getParsedAccountInfo(address)).value;
  if (!account || account.owner.toBase58() !== 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
      account.data.parsed?.type !== 'mint' || !account.data.parsed.info.isInitialized)
    throw new UserError('Use an initialized classic SPL token mint on Solana. Token-2022 is not supported.');
  const asset = { symbol, mint, decimals: account.data.parsed.info.decimals };
  const candidate = { ...cfg, ...assetConfig(cfg, asset) };
  const provider = new Jupiter(candidate);
  // Read-only quotes verify a route in both directions; no wallet or signing is involved.
  for (const [from, to, amount] of [['SOL', symbol, cfg.tradeSize], [symbol, 'SOL', (10n ** BigInt(asset.decimals)).toString()]]) {
    const q = await provider.quote(from, to, amount);
    if (q.error || q.errorCode || q.inputMint !== candidate.tokens[from].mint || q.outputMint !== candidate.tokens[to].mint ||
        q.inAmount !== amount || !/^\d+$/.test(q.outAmount || '') || BigInt(q.outAmount) <= 0n)
      throw new UserError('No buy and sell route is available for this mint.');
  }
  return asset;
}
