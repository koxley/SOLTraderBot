# Choose the trading asset in the Mini App

Open **Strategy → Trading asset**, select cbBTC, USDC, or USDT, then choose **Validate & save asset**. SOL continues to fund buys, fees and the strategy limits. The chosen token is sold back to SOL.

For another asset, select **Custom Solana token**, enter its display symbol and exact Solana mint. Wrapped DOGE or XRP requires an issuer/bridge token on Solana; native Dogecoin and XRP Ledger addresses are not supported. A matching symbol does not establish issuer authenticity. The server reads decimals from the mint account, requires an initialized classic SPL mint and checks read-only Jupiter quotes in both directions. Token-2022 is not supported by the current wallet accounting.

USDT preset mint: `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`, as listed by [Tether](https://tether.to/en/supported-protocols/). cbBTC and USDC retain their existing configured mints. Preset symbols cannot be assigned a different mint.

Stop trading, close positions in both paper and live modes, and reconcile unsettled orders before switching. Saving an asset never starts trading. Validation does not sign or submit a transaction, and available routes can change later.

The selected asset is persisted in SQLite and restored on restart before mint verification. Custom markets are identified by mint, not symbol. Each market keeps its own chart, position, transaction history, paper balance and strategy settings. New markets inherit the current SOL strategy and paper starting balance; returning to a market restores its saved settings. Daily limits apply to the selected market. Existing cbBTC and SOL-funded USDC records retain their original market keys.

Prices continue to refresh every 5 seconds and chart samples every 15 seconds. All asset labels, wallet token balances, receipts and TP/SL chart labels follow the selected market. The simulated preview supports presets only; custom mint verification runs in the deployed app.

## Exit defaults and trailing stop

New defaults are TP 3%, SL 2%, with a 15-second strategy sample interval. Explicit environment overrides and existing saved strategy settings keep their values.

TP remains fixed at the configured percentage above the actual fill entry price (position cost divided by amount). SL starts at the configured percentage below entry. Once an observed strategy sample reaches SL% above entry, SL moves to SL% below that price and follows subsequent higher sampled prices. It never follows falling prices downward. Example: entry 100, SL 2% starts at 98; at price 102 it rises to 99.96, and at 102.5 it rises to 100.45. TP stays at 103 for a 3% target and still sells when reached. EMA downward exits remain enabled.

The trailing high is stored with each position and survives restarts. It resets with a new buy. The chart displays the server's actual stop level; the separate 5-second price display does not change the strategy's stop between samples. Trailing updates and exits run only while the bot is running, at its configured strategy interval. Existing positions without trailing state initialize it on their next sample after starting. Editing the configured SL percentage explicitly recalculates its distance from the saved trailing high.
