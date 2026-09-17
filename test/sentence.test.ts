import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMenu, pick, resolve, expiryLabel, parseInstrument, type Instrument } from '../src/sentence.ts'

const inst = (name: string, active = true): Instrument => {
  const [cur, ymd, strike, type] = name.split('-')
  const expiry = Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8), 8) / 1000
  return { instrument_name: name, base_currency: cur, is_active: active, option_details: { expiry, strike, option_type: type as 'C' | 'P' } }
}
const all = [
  inst('ETH-20270326-3000-C'), inst('ETH-20270326-3000-P'),
  inst('ETH-20270326-3500-C'), inst('ETH-20270326-3500-P'),
  inst('ETH-20261225-3000-C'), inst('ETH-20261225-3000-P'),
  inst('BTC-20270326-100000-C'), inst('BTC-20270326-100000-P'),
  inst('ETH-20270326-9000-C', false), // inactive: must not appear
]

test('menu lists currencies, expiries, strikes from active instruments only', () => {
  const m = buildMenu(all)
  assert.deepEqual(m.currencies, ['BTC', 'ETH'])
  assert.deepEqual(m.expiries('ETH').map(expiryLabel), ['Dec 25, 2026', 'Mar 26, 2027'])
  assert.deepEqual(m.strikes('ETH', m.expiries('ETH')[1]), [3000, 3500])
})

test('pick keeps a valid sentence when a toggle changes', () => {
  const m = buildMenu(all)
  const s = pick(m, { currency: 'BTC', expiry: m.expiries('ETH')[0], strike: 3000, side: 'above' })
  assert.equal(s.currency, 'BTC')
  assert.equal(s.expiry, m.expiries('BTC')[0]) // ETH-only expiry replaced with a BTC one
  assert.equal(s.strike, 100000) // nearest BTC strike
})

test('resolve maps sentence × yes/no to instrument, direction and price', () => {
  const m = buildMenu(all)
  const s = pick(m, { currency: 'ETH', expiry: m.expiries('ETH')[1], strike: 3000, side: 'above' })
  const t = { a: '41.2', b: '39.8' }
  assert.deepEqual(resolve(m, s, 'yes', t), { instrument: 'ETH-20270326-3000-C', direction: 'buy', price: 41.2 })
  assert.deepEqual(resolve(m, s, 'no', t), { instrument: 'ETH-20270326-3000-C', direction: 'sell', price: 39.8 })
  assert.deepEqual(resolve(m, { ...s, side: 'below' }, 'yes', t), { instrument: 'ETH-20270326-3000-P', direction: 'buy', price: 41.2 })
  assert.deepEqual(resolve(m, { ...s, side: 'below' }, 'no', t), { instrument: 'ETH-20270326-3000-P', direction: 'sell', price: 39.8 })
})

test('parseInstrument round-trips a Derive option name', () => {
  const p = parseInstrument('ETH-20270326-3000-P')
  assert.equal(p.currency, 'ETH'); assert.equal(p.strike, 3000); assert.equal(p.side, 'below')
  assert.equal(p.expiry, inst('ETH-20270326-3000-P').option_details.expiry)
})
