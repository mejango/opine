import { test } from 'node:test'
import assert from 'node:assert/strict'
import { payoff, stats, liquidationPrice } from '../src/payoff.ts'

test('long call: lose premium below strike, unlimited above', () => {
  const l = { type: 'C' as const, strike: 2500, premium: 217.5, n: 2, long: true }
  assert.equal(payoff(l, 2000), -435)
  assert.equal(payoff(l, 3000), (500 - 217.5) * 2)
  assert.deepEqual(stats(l), { maxLoss: 435, breakEven: 2717.5, maxProfit: Infinity })
})
test('short put: keep premium above strike, lose down to zero', () => {
  const l = { type: 'P' as const, strike: 2500, premium: 200, n: 1, long: false }
  assert.equal(payoff(l, 3000), 200)
  assert.equal(payoff(l, 0), -2300)
  assert.deepEqual(stats(l), { maxLoss: 2300, breakEven: 2300, maxProfit: 200 })
})
test('long put and short call mirror', () => {
  const lp = { type: 'P' as const, strike: 100, premium: 5, n: 1, long: true }
  const sc = { type: 'C' as const, strike: 100, premium: 5, n: 1, long: false }
  assert.equal(payoff(lp, 80), 15); assert.equal(payoff(lp, 120), -5)
  assert.equal(payoff(sc, 80), 5); assert.equal(payoff(sc, 120), -15)
  assert.equal(stats(lp).maxProfit, 95); assert.equal(stats(sc).maxLoss, Infinity)
})

test('liquidation price moves out with more collateral', () => {
  const l = { type: 'C' as const, strike: 2500, premium: 200, n: 1, long: false }
  assert.equal(liquidationPrice(l, 700, 700), 2700)   // no buffer: gone once the premium is eaten
  assert.equal(liquidationPrice(l, 1700, 700), 3700)  // $1000 buffer → $1000 further
  assert.equal(liquidationPrice({ ...l, type: 'P' }, 1700, 700), 1300)
  assert.equal(liquidationPrice({ ...l, long: true }, 0, 0), undefined)
})
