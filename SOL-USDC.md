# SOL TRADER — SOL/USDC

Buy spends USDC to acquire SOL. Sell and Close Open Positions sell only the SOL tracked by this strategy for USDC. Deposit native USDC for entries and keep native SOL for network fees.

USDC mint (6 decimals): `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`. Official source: https://developers.circle.com/stablecoins/usdc-contract-addresses

Prices, realized returns, trade sizes and entry limits are denominated in USDC. Defaults: trade size 0.25 USDC, maximum entry 1 USDC, daily entry limit 5 USDC. Configure these in Strategy or with TRADE_SIZE_USDC, MAX_TRADE_USDC and MAX_DAILY_USDC. Old SOL-denominated limits are not reused as USDC limits.

Paper mode starts with 1 USDC and 1 SOL. Opening the stopped app or starting a new run resets available paper USDC to 1. Existing paper SOL holdings remain. Live balances are never reset. Recent transactions clear when the Mini App opens or Start bot succeeds; history stays persisted.

Old DOGE paper data is preserved separately. A legacy live position or unsettled DOGE transaction blocks migration until closed or reconciled using the previous deployment. Existing funds are not automatically converted. The wallet and encryption key stay unchanged. Deployments start stopped.
