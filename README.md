# Opine

> I think ‹ETH› will be ‹above› ‹$3,000› by ‹Mar 26, 2027›.  **Yes $41.20** / **No $39.80**

A one-sentence front end for buying and selling options on [Derive V3](https://derive.xyz).
Yes buys the option at the ask; No sells it at the bid. `above` → calls, `below` → puts.

- Static site, no server: `@derivexyz/derive-ts` runs in the browser over WebSocket.
- Your wallet signs twice, ever: login, and a 30-day trade-only session key kept in `localStorage`.
- No Derive account yet? The page shows a USDC deposit address that creates one.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # sentence mapping + EIP-712 signing equivalence
npm run build    # dist/
```

`VITE_DERIVE_NETWORK=testnet` (default, Sepolia USDC) or `mainnet` once Derive V3 ships it.
Testnet USDC: connect at https://testnet.app.derive.xyz/developers and click Mint.
