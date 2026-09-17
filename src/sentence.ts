// Pure mapping between the sentence's toggles and Derive option instruments.

export interface Instrument {
  instrument_name: string
  base_currency: string
  is_active: boolean
  tick_size?: string
  minimum_amount?: string
  amount_step?: string
  option_details: { expiry: number; strike: string; option_type: 'C' | 'P' }
}

export interface Sentence {
  currency: string
  expiry: number // unix seconds
  strike: number
  side: 'above' | 'below'
}

export type Ticker = { a: string; b: string; I?: string } // best ask / best bid / index price, as the API sends them

export function buildMenu(instruments: Instrument[]) {
  const live = instruments.filter((i) => i.is_active)
  const byName = new Map(live.map((i) => [i.instrument_name, i]))
  const uniqSorted = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y)
  return {
    currencies: [...new Set(live.map((i) => i.base_currency))].sort(),
    expiries: (currency: string) =>
      uniqSorted(live.filter((i) => i.base_currency === currency).map((i) => i.option_details.expiry)),
    strikes: (currency: string, expiry: number) =>
      uniqSorted(
        live
          .filter((i) => i.base_currency === currency && i.option_details.expiry === expiry)
          .map((i) => Number(i.option_details.strike)),
      ),
    find: (currency: string, expiry: number, strike: number, type: 'C' | 'P') =>
      live.find(
        (i) =>
          i.base_currency === currency &&
          i.option_details.expiry === expiry &&
          Number(i.option_details.strike) === strike &&
          i.option_details.option_type === type,
      ),
    byName,
  }
}
export type Menu = ReturnType<typeof buildMenu>

const nearest = (xs: number[], x: number) =>
  xs.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) ? v : best), xs[0])

/** Snap a possibly-invalid sentence (after a toggle change) to real instruments. */
export function pick(menu: Menu, want: Sentence): Sentence {
  const currency = menu.currencies.includes(want.currency) ? want.currency : menu.currencies[0]
  const expiries = menu.expiries(currency)
  const expiry = expiries.includes(want.expiry) ? want.expiry : nearest(expiries, want.expiry)
  const strike = nearest(menu.strikes(currency, expiry), want.strike)
  return { currency, expiry, strike, side: want.side }
}

export function instrumentFor(menu: Menu, s: Sentence) {
  return menu.find(s.currency, s.expiry, s.strike, s.side === 'above' ? 'C' : 'P')
}

/** Yes buys at the ask, No sells at the bid — the strict negation of the sentence. */
export function resolve(menu: Menu, s: Sentence, answer: 'yes' | 'no', t: Ticker) {
  const inst = instrumentFor(menu, s)
  if (!inst) return null
  return answer === 'yes'
    ? { instrument: inst.instrument_name, direction: 'buy' as const, price: Number(t.a) }
    : { instrument: inst.instrument_name, direction: 'sell' as const, price: Number(t.b) }
}

export const expiryLabel = (unixSec: number) =>
  new Date(unixSec * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** ETH-20261225-3000-C → the sentence it expresses (expiry = 08:00 UTC that day, as Derive lists it). */
export function parseInstrument(name: string): Sentence & { type: 'C' | 'P' } {
  const [currency, ymd, strike, type] = name.split('-')
  const expiry = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 8) / 1000
  return { currency, expiry, strike: Number(strike), side: type === 'C' ? 'above' : 'below', type: type as 'C' | 'P' }
}
