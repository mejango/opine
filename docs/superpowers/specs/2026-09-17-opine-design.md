# Opine — design

One-page site for buying and selling Derive V3 options through a sentence.

## The sentence

> I think ‹ETH› will be ‹above | below› ‹$3000› by ‹March 2027›.   [ Yes $X ] [ No $Y ]

| toggle | Yes | No |
|---|---|---|
| above | buy call at best ask | sell call at best bid |
| below | buy put at best ask | sell put at best bid |

Every toggle value comes from `public/get_instruments` (`instrument_type: option`, `expired: false`), so the sentence can only name a real instrument. Each button shows a subtitle: `Buy 1 ETH-20270326-3000-C · pay $41.20` / `Sell 1 … · receive $39.80`. Size is an editable number (default 1). Prices come from `public/get_ticker` (`best_ask`/`best_bid`) and refresh every few seconds while the sentence is stable.

## States

1. **Browsing** (no wallet): sentence + live prices. Yes/No → "Connect wallet".
2. **Connected, no Derive account**: `private/get_subaccounts` returns none → show a deposit address from `public/register_deposit_address` (`deposit_type: instant`, `manager_id` = the manager that lists `ETH-OPTION` and USDC collateral, from `public/get_risk_universes`) with chain name. Poll `get_subaccounts` every 10 s until an id appears.
3. **Ready**: Yes/No places a limit order at ask/bid padded by 1 % (IOC), size as entered. Result toast: filled / partial / nothing filled. Below the sentence, "Your opinions": open positions from `private/get_positions` rendered as sentences (`You think ETH will be above $3000 by March 2027 · 1 contract · mark $43`).

## Auth

- Wallet: `window.ethereum` via `viem` (`createWalletClient` + `custom(window.ethereum)`). Extension wallets only.
- First private call: wallet signs login (EIP-191 over ms timestamp, via SDK `loginParams` with the viem client as `AuthSigner`) and a `set_session_key` action (EIP-712 `Action` struct, domain `Matching/1.0/chainId/verifyingContract`, data from `encodeSetSessionKeyActionData`) for a fresh random key. Scope: `trade:orderbook:all` + `account_info`, expiry 30 days, all subaccounts.
- Session key private key lives in `localStorage` keyed by owner address. `DeriveClient({ network, sessionKey, ownerAddress })` runs in the browser over WebSocket; `connect()` + `login()` on load when a key exists. Expired/rejected key → drop it and re-prompt.

## Transport

`@derivexyz/derive-ts` in the browser. Derive's HTTP API has a CORS allowlist; its WebSocket accepts any origin and the SDK routes every call over WS once connected. No server. Static build.

## Stack & layout

Vite + React + TypeScript, `viem`, `@derivexyz/derive-ts`, `ethers` (SDK peer dep). Files:

```
src/main.tsx          mount
src/App.tsx           the page: sentence, buttons, positions, deposit panel
src/derive.ts         client singleton, session-key mint, order placement, polling helpers
src/sentence.ts       pure: instruments → toggle options; (toggles, yes/no) → {instrument, direction, price}
test/sentence.test.ts node:test over sentence.ts
```

`VITE_DERIVE_NETWORK` = `testnet` (default) | `mainnet`.

## Errors

- WS drop: SDK reconnects and re-logins; buttons disable while disconnected.
- Order rejected (margin, min size, geo): show the RPC error message verbatim under the button.
- Session key expiry / 401-ish: clear localStorage key, back to state 1 with wallet still connected.

## Out of scope (v1)

Order history, cancel, PnL, closing positions from the UI (No on an existing Yes does it), multiple subaccounts, WalletConnect/mobile, withdrawals.
