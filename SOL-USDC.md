# SOL TRADER — SOL-funded USDC trading

This uses the same direction as the original SOL/DOGE bot, with USDC replacing DOGE:

- Start with SOL. Buy spends SOL to acquire USDC.
- Sell and Close Open Positions sell only the USDC tracked by this strategy back to SOL.
- The EMA signal observes the price of one USDC in SOL, exactly as the original strategy observed DOGE in SOL.
- Prices, realized returns, trade sizes and limits are denominated in SOL.

Defaults: trade size 0.025 SOL, maximum entry 0.1 SOL, daily entry limit 0.5 SOL. Change these in Strategy or with TRADE_SIZE_SOL, MAX_TRADE_SOL and MAX_DAILY_SOL.

Paper mode starts with 1 SOL and 0 USDC. Use Edit amount under Available to trade while stopped to set the paper SOL balance. The amount is saved on the server. Opening the stopped app or starting a new run resets paper SOL to your saved amount (1 SOL initially). Existing USDC positions remain. Live balances never reset. Recent transactions clear when the Mini App opens or Start bot succeeds; history stays persisted.

Deposit native SOL on Solana to fund buys and network fees. Native USDC mint (6 decimals): EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v.

Old DOGE and the previous reverse-direction paper data remain stored separately. A live position or unsettled transaction in another direction blocks migration until closed or reconciled using its previous deployment. Existing funds are not automatically converted. Wallet and encryption key remain unchanged. Deployments start stopped.
