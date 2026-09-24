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
