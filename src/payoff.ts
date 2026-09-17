// Payoff at expiry for one option leg. All amounts in quote currency (USDC), for `n` contracts.

export interface Leg { type: 'C' | 'P'; strike: number; premium: number; n: number; long: boolean }

export function payoff(l: Leg, spot: number) {
  const intrinsic = l.type === 'C' ? Math.max(spot - l.strike, 0) : Math.max(l.strike - spot, 0)
  return (l.long ? intrinsic - l.premium : l.premium - intrinsic) * l.n
}

/** Headline figures. `Infinity` means uncapped. */
export function stats(l: Leg) {
  const prem = l.premium * l.n
  const breakEven = l.type === 'C' ? l.strike + l.premium : l.strike - l.premium
  const capped = (l.strike - l.premium) * l.n // a put's most it can pay: spot → 0
  return l.long
    ? { maxLoss: prem, breakEven, maxProfit: l.type === 'C' ? Infinity : capped }
    : { maxLoss: l.type === 'C' ? Infinity : capped, breakEven, maxProfit: prem }
}

/** Rough liquidation price for a short leg backed by `collateral` USDC: where expiry loss eats the buffer above the
 *  maintenance requirement (`req`). Real liquidation comes a little earlier — marks move before intrinsic does. */
export function liquidationPrice(l: Leg, collateral: number, req: number) {
  if (l.long) return undefined
  const room = Math.max(0, collateral - req) / l.n + l.premium
  return l.type === 'C' ? l.strike + room : Math.max(0, l.strike - room)
}
