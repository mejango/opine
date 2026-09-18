# Opine

What do you think the price will be? Buy or sell the option that says it.

> I think ‹ETH› will be ‹above› ‹$3,000› by ‹Mar 26, 2027›.  **Yes $41.20** / **No $39.80**

A one-sentence front end for buying and selling options on [Derive V3](https://derive.xyz).
Yes buys the option at the ask; No sells it at the bid. `above` → calls, `below` → puts.

- Static site, no server: `@derivexyz/derive-ts` runs in the browser over WebSocket.
- Log in with X, email or a wallet (Privy). X handles label the feed. Your wallet signs twice, ever: login, and a 30-day trade-only session key kept in `localStorage`.
- No Derive account yet? The page shows a USDC deposit address that creates one.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # sentence mapping + EIP-712 signing equivalence
npm run build    # dist/
```

Env (see `.env.example`): `VITE_DERIVE_NETWORK` (`testnet` default, or `mainnet`), `VITE_PRIVY_APP_ID`, `VITE_REFERRAL_CODE`; server-side `PRIVY_APP_ID` + `PRIVY_APP_SECRET` power the `/who` handle lookup.
Testnet USDC: connect at https://testnet.app.derive.xyz/developers and click Mint.
