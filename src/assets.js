import { Connection, PublicKey } from '@solana/web3.js';
import { TOKENS, UserError } from './config.js';
import { Jupiter } from './providers.js';

// Fixed Jupiter organic-score snapshot, 2026-09-25. See TRADING_ASSETS.md.
export const ASSETS = [
  {
    "symbol": "USDC",
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "decimals": 6
  },
  {
    "symbol": "USDT",
    "mint": "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    "decimals": 6
  },
  {
    "symbol": "JUP",
    "mint": "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
    "decimals": 6
  },
  {
    "symbol": "RAY",
    "mint": "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
    "decimals": 6
  },
  {
    "symbol": "ZEC",
    "mint": "A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS",
    "decimals": 8
  },
  {
    "symbol": "STONK",
    "mint": "6GmAFSYs4gk3FDao5FzzySQpPZaWsa4rUJHacpMpUNgx",
    "decimals": 9
  },
  {
    "symbol": "JitoSOL",
    "mint": "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn",
    "decimals": 9
  },
  {
    "symbol": "MET",
    "mint": "METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL",
    "decimals": 6
  },
  {
    "symbol": "USELESS",
    "mint": "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk",
    "decimals": 6
  },
  {
    "symbol": "PENGU",
    "mint": "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv",
    "decimals": 6
  }
];

export function selectedPreset(input) {
  const preset = ASSETS.find(a => a.symbol === input?.preset);
  if (!preset || input.symbol !== undefined || input.mint !== undefined)
    throw new UserError('Choose one of the ten supported trading pairs. Custom tokens are no longer supported.');
  return { ...preset };
}

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
  const { symbol, mint, decimals } = selectedPreset(input);
  assetConfig(cfg, { symbol, mint, decimals });
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
  for (const [from, to, amount] of [['SOL', symbol, '10000000'], [symbol, 'SOL', (10n ** BigInt(asset.decimals)).toString()]]) {
    const q = await provider.quote(from, to, amount);
    if (q.error || q.errorCode || q.inputMint !== candidate.tokens[from].mint || q.outputMint !== candidate.tokens[to].mint ||
        q.inAmount !== amount || !/^\d+$/.test(q.outAmount || '') || BigInt(q.outAmount) <= 0n)
      throw new UserError('No buy and sell route is available for this mint.');
  }
  return asset;
}
