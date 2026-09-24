# Selectable strategies

Open Strategy, select a strategy, configure its fields and press Save strategy. EMA remains the default for existing installations.

| Strategy | Entry | Strategy exit | Defaults |
|---|---|---|---|
| EMA crossover | Fast EMA crosses above slow EMA | Fast EMA below slow EMA | 5 / 12 samples |
| SMA crossover | Fast SMA crosses above slow SMA | Fast SMA below slow SMA | 5 / 12 samples |
| RSI recovery | Wilder RSI crosses above entry threshold from at or below it | RSI at or above exit threshold | 14 samples; 30 / 70 |
| Bollinger band recovery | Price returns to or above lower band after being below it | Price at or above middle SMA | 20 samples; 2 population standard deviations |

These are long-only signals: buys spend SOL on the selected token; sells close the bot position back to SOL. TP and trailing SL take priority over indicator exits. Periods are sample counts: at the default 15-second interval, 20 samples span approximately five minutes. These defaults are not performance guarantees.

## Change while running

Saving keeps the current running/stopped state. A save waits up to 15 seconds for an in-flight operation to finish; if still busy or an outcome is unknown, it fails without changing settings and can be retried after settlement. Submitted trades finish using their original settings. Switching asset or paper/live mode still requires stopping and satisfying existing position safeguards.

Changing signal parameters or the sample interval clears indicator history. Warm-up requires slow period + 1 samples for moving averages, RSI period + 2 for RSI, and band period + 1 for Bollinger. Existing holdings and trailing-high state remain intact. TP/SL checks continue before warm-up completes, at each configured sample while running. Risk-only edits do not reset history; new risk thresholds also apply to any open position. Saving does not place a trade immediately.

Settings persist separately per asset and paper/live mode. A server restart still leaves trading stopped. Quotes and chart display continue at their existing 5-second and 15-second cadences.

Indicator references: [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI) and [Fidelity Bollinger Bands](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/bollinger-bands).

## Independent buys and sells

Trade Size is now a percentage from 0.01% to 100% (two decimal places). A buy spends that fraction of currently available SOL. In live mode the Available to Trade display excludes MIN_SOL_RESERVE plus MAX_NETWORK_FEE_SOL; Wallet still shows the actual balance. A percentage exceeding maximum entry or remaining daily limits is rejected by the existing limits; it is not silently resized.

A buy signal can add another buy even while holdings are open. Ordinary sell signals sell the configured percentage of remaining bot-held tokens; consecutive sells are permitted. Ordinary sells consume oldest buy lots first and realize only the cost basis of tokens sold. Deposited tokens outside the bot's tracked buys are not automatically sold. There is no borrowing or short selling. Zero-sized orders after rounding are skipped.

Each buy retains its own entry cost and trailing high. TP or SL sells all remaining tokens of that particular buy, independently of the percentage setting. If several buys hit their exits on one sample, they are closed sequentially. Close Open Positions sells all bot-held tokens. Restart, partial sells and trade reconciliation retain the remaining buy lots and their cost basis.

The app lists each open buy with TP/SL values. Use **Chart TP/SL for** to choose which buy's levels appear on the chart. Existing positions migrate as one buy with their original cost and trailing high. Existing fixed-size settings are converted to a percentage of the former 1 SOL reference balance (for example 0.025 SOL becomes 2.5%), rounded to two percentage decimals and bounded to 0.01%-100%; review the new percentage in Strategy. The inverse legacy USDC-funded market uses a 1 USDC reference instead.

Signals retain their existing timing: crossover/recovery entries require a fresh crossing, while sell conditions are checked at each strategy sample. Multiple buys do not mean buying on every price refresh.
