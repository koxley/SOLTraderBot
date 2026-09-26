> Trading now supports independent buys and partial sells, percentage trade sizing, and strategy-driven exits. See [STRATEGIES.md](STRATEGIES.md) for current behavior and migration.

> **Current release:** selectable SOL-funded paired trading plus no-trade single-coin tracking. See [SOL-CBBTC.md](SOL-CBBTC.md) for the default cbBTC market.

# SOL Trader Bot

A self-hosted, single-owner Telegram Mini App for automatic SOL-funded spot trading on Solana, plus individual price and strategy-signal tracking for SOL, wrapped ETH, wrapped DOGE, wrapped XRP, USDC, and USDT. Paired trading buys the selected Solana token with SOL and sells it back to SOL. Single-coin tracking observes the selected coin without opening positions or submitting swaps. The user controls **Start**, **Stop**, and **Close Open Positions**. There are no manual trade commands.

The default paired asset is Coinbase Wrapped BTC; the Strategy page also supports preset and validated custom Solana tokens. Mainnet validation checks the SPL program, decimals, and Jupiter routes; it does not certify an issuer, backing, or redemption rights. Wrapped ETH, DOGE, and XRP are Solana tokens—the app does not interact with their native networks.

## Try the app locally

Requires Node.js 24 or newer and pnpm 11 (or use npm for local installation).

```sh
pnpm install --frozen-lockfile
pnpm demo
```

Open **http://127.0.0.1:3001**. The isolated preview has simulated prices, a sample position, working start/stop/close controls, wallet creation preview, and trade history. It never loads real credentials, makes trades, or accepts deposits. Preview data resets with the process. `npm install` / `npm run demo` also work if pnpm is unavailable.

## Connect to Telegram

1. Create a Telegram bot with [@BotFather](https://t.me/BotFather). Send it `/start` once so it can message you.
2. Run `pnpm run setup`. This creates a private `.env` without generating or storing a wallet key. It never overwrites an existing `.env`.
3. Edit `.env` locally: set `TELEGRAM_BOT_TOKEN`, your numeric `TELEGRAM_OWNER_ID`, and `PUBLIC_APP_URL` to your HTTPS deployment origin. Do not paste keys into a chat. Use the user's ID from an incoming Bot API update, not a username or group ID.
4. Host this Node process behind HTTPS, forwarding to port 3000. Telegram Mini Apps require a public HTTPS URL. Use a persistent disk for `DATA_DIR`, one process, and no webhook; this bot uses long polling. Configure `HOST=0.0.0.0` only when your hosting platform or container requires it.
5. Run `pnpm start`. The bot registers commands and an **Open SOL Trader Bot** menu button for your account. Open `/app` in a private Telegram conversation with your bot.

Other accounts, groups, unsigned browser API calls, altered initData, and expired Telegram sessions are rejected. Reopen the Mini App after one hour to refresh the Telegram session. Opening the production URL directly in an ordinary browser cannot control the wallet.

The included Dockerfile builds the app. Supply `.env` via your platform's secret environment settings or Docker `--env-file`, mount a writable persistent volume at `/app/data`, and put HTTPS in front of it. Ensure the volume is writable by the container's `node` user. Never bake `.env` into an image. Docker deployment has not been exercised in this workspace.

## Create and fund a wallet

Open **Wallet**, generate or enter your encryption key, save a backup, and select **Create wallet**. A new Solana keypair is generated on the server and encrypted with AES-256-GCM using the key you enter in Wallet. The server retains signing access so it can trade unattended; this is an operator-controlled hot wallet, not a browser-only wallet.

The app displays the receiving address, Solana Pay QR code, copy button, confirmed on-chain balances, and a Solscan link. Transfer SOL to that address from an existing Solana wallet or withdraw SOL from an exchange over **Solana mainnet**. **Check deposit** refreshes balances; the screen also refreshes periodically. Funding is a normal on-chain transfer, not a card/fiat purchase. Never send assets from another network to this Solana address.

Before funding, back up `data/wallet.encrypted.json`, the database, and your encryption key separately. On Windows, restrict access to the app directory and `.env` to the service account; POSIX file mode flags alone do not configure Windows ACLs. Loss of both the running key and a recoverable backup means loss of access to funds. To recover into another wallet, explicitly export a local Solana keypair file:

```sh
pnpm export-wallet /secure/location/recovery.key.json
```

The recovery command refuses to overwrite an existing file and does not print the private key. Never share the exported file. You can alternatively configure an existing local Solana keypair with `WALLET_KEYPAIR_PATH`; the app will use it instead of creating another wallet. Do not change the wallet or token against an existing trading database; use a separate `DATA_DIR`.

## Automatic strategy and controls

Choose the market behavior in the authenticated **Strategy** tab:

- **Paired trading** preserves the executable strategy and all current asset choices. It can buy and sell the selected token using SOL in paper or live mode.
- **Single coin tracking — no trades** monitors SOL, ETH, DOGE, XRP, USDC, or USDT individually. It charts the selected coin and reports strategy signals, but never creates a position or submits a swap. Prices use USDC as the display reference, except USDC uses USDT. ETH, DOGE, and XRP refer to their listed Solana-wrapped tokens.

Changing between paired trading and tracking clears the old market's samples so the selected strategy can warm up on comparable data, and leaves the bot stopped. An open paired position must be closed before changing modes. Existing saved strategies automatically remain in paired mode.

| Control | Behavior |
| --- | --- |
| Start bot / `/start` | Monitor quotes. Paired mode can enter/exit positions; tracking mode only reports signals. |
| Stop bot / `/stop` | Stop new submissions or price tracking; keep any existing paired position. |
| Close Open Positions / `/close` | Stop the strategy and sell its paired position back to SOL. No automatic re-entry. |
| Check unsettled transaction / `/reconcile` | Query on-chain outcome without re-submitting a swap. |

An already-submitted transaction cannot be cancelled. Close waits for an in-progress operation; an unknown outcome must be reconciled before closing. Externally deposited tokens are not treated as an open strategy position and are not sold by Close. A restart always leaves the strategy stopped while preserving balances, position, and trade records.

The default paired strategy samples every 30 seconds and uses an SMA 5/12 crossover with 10% trade sizing, 2.5% take profit, and 1.5% stop loss. EMA, SMA, RSI, and Bollinger strategies are selectable. TP and SL are measured from the weighted-average entry of all open buys, close the full position when reached, and appear on the chart. They can be changed while running without restarting or resetting warm-up; the new values apply to the current position at the next strategy sample. Close Open Positions remains available. After a long gap, indicators must warm up before generating strategy signals, while TP and SL remain active. Tracking creates no trades. Samples are observed quotes, not exchange OHLC candles. These strategies are configurable examples, not backtested profitability claims.

Strategy exits are checked only while the process is online and the bot is running. They are not on-chain limit orders and cannot guarantee an exit price. Quote outages, illiquidity, slippage, and network failures can prevent exits. A failed validation stops the bot and displays the reason. Generic transient failures stop it after three consecutive attempts.

## Paper and live modes

Paper mode is the default, with 1 simulated SOL. It uses real Jupiter quotes, conservative minimum-output fills, and a separate simulated ledger. It never submits swaps and excludes gas/rent. Creating/funding a real wallet does not add money to the paper ledger.

For real trades, set both in the private `.env` and restart:

```dotenv
TRADING_MODE=live
LIVE_TRADING_ACK=I_UNDERSTAND_REAL_FUNDS
```

Open Telegram and start the bot. Live trading requires a funded wallet and a working mainnet RPC. Defaults use 10% of available SOL per buy, 0.1 SOL maximum entry, 0.02 SOL reserve on buys, 0.01 SOL maximum network/rent estimate, and 50 bps slippage. Entry limits do not block exits. Exit trades still require sufficient gas and acceptable network fees. Configure strategy values in the authenticated Strategy tab, including while running. Saved settings persist separately for paper and live modes and take precedence over `.env` defaults. Changes to EMA periods or sampling interval restart warm-up. Token and startup defaults remain in `.env`. Select paper/live mode in the Dashboard and enter the wallet key in Wallet.

Live swaps use Jupiter Swap V2 `/order` and `/execute`, exclude RFQ routes with extra signers, verify quote mint/amount/slippage, enforce fee/reserve limits, validate fee payer, simulate wallet balance changes, and then sign locally. Jupiter and the configured RPC are trusted external services; use a dedicated wallet. A quote API key is optional for low-rate usage and recommended for reliable operation. Responses and logs never include private keys or raw credential-bearing provider errors.

The signature is committed to SQLite before transmission. Timeouts and inconclusive responses freeze the strategy; the bot never creates a replacement transaction automatically. Reconciliation checks historical status and receipts. A missing transaction can be marked expired only after the RPC's finalized block height passes its validity window plus 150 blocks and a second history check still finds nothing. Use a reliable RPC with transaction history. On-chain reconciliation derives amounts from wallet deltas; rent can affect recovered SOL accounting. Displayed realized returns exclude network fees and are not tax accounting.

## Validation

```sh
pnpm test
pnpm smoke
```

Tests cover automatic entries and exits, stop/close semantics, balance and spending checks, quote tampering, unknown submissions and reconciliation, persistence, encrypted wallet round-trips and corruption, Telegram ownership and HMAC authentication, and HTTP authorization. `smoke` is a read-only mainnet check of the configured mint and quotes in both directions; it never loads a wallet or submits a transaction.

The lockfile overrides the Solana SDK's transitive `jayson` dependency to 5.0.0 to remove vulnerable UUID/stream parsing dependencies. The SDK's HTTP RPC path is exercised by the mainnet smoke test. Optional native WebSocket accelerators are disabled; JavaScript implementations remain available. The production dependency audit reported no known vulnerabilities at implementation time.

Live funded swaps, actual deposits, Telegram launch, and public deployment require your credentials/infrastructure and have not been executed here. The local interactive preview and automated tests are runnable without those credentials.

API references: [Telegram Mini Apps and initData validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app), [Telegram Bot API](https://core.telegram.org/bots/api), [Jupiter Order & Execute](https://developers.jup.ag/docs/swap/order-and-execute).

## Wallet unlock and mode selection

The encryption key is requested in the authenticated Wallet screen and is never read from `.env`. It is discarded after encrypting/decrypting; the unlocked signing wallet stays in server memory until restart. After restart, re-enter the original key before live trading. Existing encrypted wallets remain compatible: save your old `.env` key privately and use it to unlock, rather than generating a replacement key. Do not remove your only key backup.

Use the Dashboard Paper / Live selector while stopped. Enabling live requires an unlocked wallet and an explicit real-funds acknowledgement. Switching does not start trading. Strategies, balances, positions, and history remain separate per mode. Close live positions and reconcile unknown transactions before switching away. Startup follows TRADING_MODE (paper by default), except that existing live positions or unsettled live trades force stopped live recovery mode. The runtime selection does not rewrite configuration.

Wallet shows the bot wallet ID, copy button, and Solana Pay QR code after unlock, including in live mode. Send SOL to that address over **Solana mainnet** from MetaMask or another Solana wallet. An RPC outage may hide balances but does not hide the receiving address. The local demo blocks real live mode and deposits.

Daily gross trading limits have been removed. Legacy saved maxDaily settings and MAX_DAILY environment values are ignored. Per-trade limits, available balance, slippage validation and unsettled-order safeguards remain.
