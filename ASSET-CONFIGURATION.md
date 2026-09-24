# Choose the trading asset in the Mini App

Open **Strategy → Trading asset**, select cbBTC, USDC, or USDT, then choose **Validate & save asset**. SOL continues to fund buys, fees and the strategy limits. The chosen token is sold back to SOL.

For another asset, select **Custom Solana token**, enter its display symbol and exact Solana mint. Wrapped DOGE or XRP requires an issuer/bridge token on Solana; native Dogecoin and XRP Ledger addresses are not supported. A matching symbol does not establish issuer authenticity. The server reads decimals from the mint account, requires an initialized classic SPL mint and checks read-only Jupiter quotes in both directions. Token-2022 is not supported by the current wallet accounting.

USDT preset mint: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, as listed by [Tether](https://tether.to/en/supported-protocols/). cbBTC and USDC retain their existing configured mints. Preset symbols cannot be assigned a different mint.

Stop trading, close positions in both paper and live modes, and reconcile unsettled orders before switching. Saving an asset never starts trading. Validation does not sign or submit a transaction, and available routes can change later.

The selected asset is persisted in SQLite and restored on restart before mint verification. Custom markets are identified by mint, not symbol. Each market keeps its own chart, position, transaction history, paper balance and strategy settings. New markets inherit the current SOL strategy and paper starting balance; returning to a market restores its saved settings. Daily limits apply to the selected market. Existing cbBTC and SOL-funded USDC records retain their original market keys.

Prices continue to refresh every 5 seconds and chart samples every 15 seconds. All asset labels, wallet token balances, receipts and TP/SL chart labels follow the selected market. The simulated preview supports presets only; custom mint verification runs in the deployed app.
