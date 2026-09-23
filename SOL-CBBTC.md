# SOL TRADER — SOL/cbBTC

Buy spends SOL to acquire Coinbase Wrapped BTC (cbBTC). Sell and Close Open Positions sell only the cbBTC tracked by this strategy back to SOL. This is wrapped BTC on Solana, not native Bitcoin.

Approved Solana mint: cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij (8 decimals, standard SPL token).
Issuer source: https://www.coinbase.com/cbbtc

Deposit SOL on Solana to fund trades and network fees. Do not send native BTC to this Solana address.

Prices, entry costs, returns, limits and TP/SL lines use SOL. Default trade size is 0.025 SOL, maximum entry 0.1 SOL, daily entry limit 0.5 SOL. Configure these in Strategy or TRADE_SIZE_SOL, MAX_TRADE_SOL and MAX_DAILY_SOL.

Paper trading starts with 1 SOL and zero cbBTC. Edit amount under Available to trade changes the saved paper SOL amount while stopped; reopening or starting resets it to that saved amount. Live wallet balances cannot be edited. USDC-market SOL strategy settings and saved paper balance amounts carry forward; old holdings and history remain stored separately. A position or unsettled transaction in another live market must be closed/reconciled in its previous deployment before migrating. No funds are automatically swapped.

Buy/sell triangles and labeled TP/SL lines remain on the chart. Wallet keys are still entered in the app. Deployment leaves the bot stopped.
