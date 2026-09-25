# Selectable strategies

Open Strategy, select a strategy, configure its fields and press Save strategy. New unsaved strategies default to SMA 5/12 with 30-second samples, 10% sizing, 0.1 SOL maximum entry, 0.5 SOL daily gross entry limit, and 0.5% slippage. Existing saved settings remain unchanged. Load defaults fills these values for review; Save strategy applies them. Asset selection is preserved. These are paper-test starting values, not proven profit-optimal settings.

| Strategy | Entry | Strategy exit | Defaults |
|---|---|---|---|
| EMA crossover | Fast EMA crosses above slow EMA | Fast EMA below slow EMA | 5 / 12 samples |
| SMA crossover | Fast SMA crosses above slow SMA | Fast SMA below slow SMA | 5 / 12 samples |
| RSI recovery | Wilder RSI crosses above entry threshold from at or below it | RSI at or above exit threshold | 14 samples; 30 / 70 |
| Bollinger band recovery | Price returns to or above lower band after being below it | Price at or above middle SMA | 20 samples; 2 population standard deviations |

These are long-only signals: buys spend SOL on the selected token; sells close the bot position back to SOL. TP, SL, and trailing stops are no longer used. Periods are sample counts: at the default 30-second interval, 20 samples span approximately ten minutes. These defaults are not performance guarantees.

## Change while running

Saving keeps the current running/stopped state. A save waits up to 15 seconds for an in-flight operation to finish; if still busy or an outcome is unknown, it fails without changing settings and can be retried after settlement. Submitted trades finish using their original settings. Switching asset or paper/live mode still requires stopping and satisfying existing position safeguards.

Changing signal parameters or the sample interval clears indicator history. Warm-up is fixed at 10 samples for all strategies and tracking modes, regardless of configured periods or interval. Until a full indicator window exists, calculations use the available samples; they converge to the configured window as history builds. Warm-up completion enables evaluation but does not guarantee a trade signal. Existing holdings remain intact. No automatic sells occur before warm-up completes. Saving does not place a trade immediately.

Settings persist separately per asset and paper/live mode. A server restart still leaves trading stopped. Quotes and chart display continue at their existing 5-second and 15-second cadences.

Indicator references: [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI) and [Fidelity Bollinger Bands](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/bollinger-bands).

## Independent buys and sells

Trade Size is now a percentage from 0.01% to 100% (two decimal places). A buy spends that fraction of currently available SOL. In live mode the Available to Trade display excludes MIN_SOL_RESERVE plus MAX_NETWORK_FEE_SOL; Wallet still shows the actual balance. A percentage exceeding maximum entry or remaining daily limits is rejected by the existing limits; it is not silently resized.

A buy signal can add another buy even while holdings are open. Ordinary sell signals sell the configured percentage of remaining bot-held tokens; consecutive sells are permitted. Ordinary sells consume oldest buy lots first and realize only the cost basis of tokens sold. Deposited tokens outside the bot's tracked buys are not automatically sold. There is no borrowing or short selling. Zero-sized orders after rounding are skipped.

Each buy retains its own entry cost. Close Open Positions sells all bot-held tokens. Restart, partial sells and trade reconciliation retain remaining buy lots and their cost basis.

The app lists each open buy with its amount and cost. The chart shows prices and buy/sell markers, without exit levels. Legacy exit settings and trailing-high data are ignored. Existing fixed-size settings are converted to a percentage of the former 1 SOL reference balance (for example 0.025 SOL becomes 2.5%), rounded to two percentage decimals and bounded to 0.01%-100%; review the new percentage in Strategy. The inverse legacy USDC-funded market uses a 1 USDC reference instead.

Signals retain their existing timing: crossover/recovery entries require a fresh crossing, while sell conditions are checked at each strategy sample. Multiple buys do not mean buying on every price refresh.

## Buy/sell relationships

Completed sells persist allocations to their original buy IDs, including sold quantity, cost basis, proceeds, and realized return. Partial sells consume the oldest buys first. One sell may link to several buys; each buy may link to several sells. Links survive restarts and reconciliation. Transactions show both directions, even when a linked order is outside the latest 30 rows. Earlier sells without stored allocations are explicitly marked as historical; links are not guessed. Legacy aggregate holdings retain their legacy lot identifier.


## Stop resets the displayed session

Stop clears displayed transactions and chart samples, resets displayed realized return to zero, and restores paper available funds to 1 SOL. The chart starts collecting again on Start. Live wallet balances remain actual balances. Open buy lots and the internal accounting ledger remain intact for closing, buy/sell relationships, reconciliation, and daily spending limits. If an operation is in flight, the cash reset waits for settlement.

## Responsive paper preset upgrade

The saved SMA 10/30, 60-second paper preset is upgraded once to SMA 5/12, 30 seconds. Its trade percentage and per-entry limit are preserved. A 0.5 SOL daily allowance is raised to 1 SOL for this paper preset. Live settings and other strategies are unchanged. The daily entry limit counts buys only; sells do not consume it. No trade is forced: entries still require a fresh crossover and ten warm-up samples.
