> **Current release: SOL/USDC.** See [SOL-USDC.md](SOL-USDC.md) for current trading units, defaults, deposits, and migration behavior. The DOGE-specific setup below describes the legacy market.

# SOL TRADER

A self-hosted, single-owner Telegram Mini App for automatic SOL / wrapped DOGE spot trading on Solana. Deposit SOL; the strategy buys DOGE with SOL and sells DOGE back to SOL. The user controls **Start**, **Stop**, and **Close Open Positions**. There are no manual trade commands.

Configured mint: `DoGEV7LASBkQbibMc5k5vKnTZoMg423GpJ5QtJEGfm7R` (8 decimals). This is the mint supplied by the user. Mainnet account validation checks its SPL program and decimals; it does not certify a bridge, issuer, backing, or redemption rights. This app does not interact with the native Dogecoin network.

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
5. Run `pnpm start`. The bot registers commands and an **Open SOL TRADER** menu button for your account. Open `/app` in a private Telegram conversation with your bot.

Other accounts, groups, unsigned browser API calls, altered initData, and expired Telegram sessions are rejected. Reopen the Mini App after one hour to refresh the Telegram session. Opening the production URL directly in an ordinary browser cannot control the wallet.

The included Dockerfile builds the app. Supply `.env` via your platform's secret environment settings or Docker `--env-file`, mount a writable persistent volume at `/app/data`, and put HTTPS in front of it. Ensure the volume is writable by the container's `node` user. Never bake `.env` into an image. Docker deployment has not been exercised in this workspace.

## Create and fund a wallet

Open **Wallet**, generate or enter your encryption key, save a backup, and select **Create wallet**. A new Solana keypair is generated on the server and encrypted with AES-256-GCM using the key you enter in Wallet. The server retains signing access so it can trade unattended; this is an operator-controlled hot wallet, not a browser-only wallet.

The app displays the receiving address, Solana Pay QR code, copy button, confirmed on-chain SOL/DOGE balances, and a Solscan link. Transfer SOL to that address from an existing Solana wallet or withdraw SOL from an exchange over **Solana mainnet**. **Check deposit** refreshes balances; the screen also refreshes periodically. Funding is a normal on-chain transfer, not a card/fiat purchase. Native DOGE must not be sent to this Solana address.

Before funding, back up `data/wallet.encrypted.json`, the database, and your encryption key separately. On Windows, restrict access to the app directory and `.env` to the service account; POSIX file mode flags alone do not configure Windows ACLs. Loss of both the running key and a recoverable backup means loss of access to funds. To recover into another wallet, explicitly export a local Solana keypair file:

```sh
pnpm export-wallet /secure/location/recovery.key.json
```

The recovery command refuses to overwrite an existing file and does not print the private key. Never share the exported file. You can alternatively configure an existing local Solana keypair with `WALLET_KEYPAIR_PATH`; the app will use it instead of creating another wallet. Do not change the wallet or token against an existing trading database; use a separate `DATA_DIR`.

## Automatic strategy and controls

| Control | Behavior |
| --- | --- |
| Start bot / `/start` | Monitor quotes and automatically enter/exit positions. |
| Stop bot / `/stop` | Stop new submissions; keep the existing DOGE position. |
| Close Open Positions / `/close` | Stop the strategy and sell its tracked DOGE position back to SOL. No automatic re-entry. |
| Check unsettled transaction / `/reconcile` | Query on-chain outcome without re-submitting a swap. |

An already-submitted transaction cannot be cancelled. Close waits for an in-progress operation; an unknown outcome must be reconciled before closing. Externally deposited DOGE is not treated as an open strategy position and is not sold by Close. A restart always leaves the strategy stopped while preserving balances, position, and trade records.

Default strategy: one executable quote for one DOGE in SOL every 60 seconds, EMA 5/12 crossover entry, exit on fast EMA below slow EMA, a 3% loss threshold, or a 6% profit threshold. It requires 13 samples to warm up (about 13 minutes). Samples are observed quotes, not exchange OHLC candles. After a gap longer than three sample intervals, the EMA history warms up again; a tracked position can still trigger its price exits. Only one DOGE position is held at a time. The strategy is a configurable example, not a backtested profitability claim.

Strategy exits are checked only while the process is online and the bot is running. They are not on-chain limit orders and cannot guarantee an exit price. Quote outages, illiquidity, slippage, and network failures can prevent exits. A failed validation stops the bot and displays the reason. Generic transient failures stop it after three consecutive attempts.

## Paper and live modes

Paper mode is the default, with 1 simulated SOL. It uses real Jupiter quotes, conservative minimum-output fills, and a separate simulated ledger. It never submits swaps and excludes gas/rent. Creating/funding a real wallet does not add money to the paper ledger.

For real trades, set both in the private `.env` and restart:

```dotenv
TRADING_MODE=live
LIVE_TRADING_ACK=I_UNDERSTAND_REAL_FUNDS
```

Open Telegram and start the bot. Live trading requires a funded wallet and a working mainnet RPC. Defaults use a 0.025 SOL entry size, 0.1 SOL maximum entry, 0.5 SOL daily gross turnover threshold for new entries, 0.02 SOL reserve on buys, 0.01 SOL maximum network/rent estimate, and 50 bps slippage. Entry limits do not block exits. Exit trades still require sufficient gas and acceptable network fees. Daily gross turnover counts buys and sells; new entries are blocked when the threshold would be exceeded. The day resets at midnight UTC. Configure strategy values in the authenticated Strategy tab while stopped. Saved settings persist separately for paper and live modes and take precedence over `.env` defaults. Changes to EMA periods or sampling interval restart warm-up. Exit thresholds apply to the existing bot position when trading resumes. Token and startup defaults remain in `.env`. Select paper/live mode in the Dashboard and enter the wallet key in Wallet.

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
