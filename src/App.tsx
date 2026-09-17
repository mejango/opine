import { useEffect, useRef, useState } from 'react'
import type { DeriveClient } from '@derivexyz/derive-ts'
import type { Address, WalletClient } from 'viem'
import { buildMenu, expiryLabel, instrumentFor, pick, resolve, type Instrument, type Menu, type Sentence, type Ticker } from './sentence'
import * as d from './derive'

/** A word in the sentence. Click cycles to the next option; press and hold opens the native picker. */
function Toggle({ value, options, onChange, className }: { value: string; options: [string, string][]; onChange: (v: string) => void; className?: string }) {
  const sel = useRef<HTMLSelectElement>(null)
  const hold = useRef<{ timer: number; fired: boolean }>()
  const label = options.find(([v]) => v === value)?.[1] ?? value
  const cycle = () => onChange(options[(options.findIndex(([v]) => v === value) + 1) % options.length][0])
  const down = () => {
    const h = { timer: 0, fired: false }
    h.timer = window.setTimeout(() => {
      h.fired = true
      const el = sel.current as any
      if (el?.showPicker) el.showPicker() // ponytail: older browsers just cycle
      else cycle()
    }, 400)
    hold.current = h
  }
  const up = () => {
    if (!hold.current) return
    clearTimeout(hold.current.timer)
    if (!hold.current.fired) cycle()
    hold.current = undefined
  }
  return (
    <span className={`tog ${className ?? ''}`}>
      <button type="button" onPointerDown={down} onPointerUp={up} onPointerLeave={up} onPointerCancel={up} onContextMenu={(e) => e.preventDefault()}>
        {label}
      </button>
      <select ref={sel} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} tabIndex={-1}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </span>
  )
}

export default function App() {
  const [menu, setMenu] = useState<Menu>()
  const [s, setS] = useState<Sentence>()
  const [stance, setStance] = useState<'do' | 'dont'>('do') // do = buy the option, don't = sell it
  const [ticker, setTicker] = useState<Ticker>()
  const [amount, setAmount] = useState('1')
  const [wallet, setWallet] = useState<{ wallet: WalletClient; address: Address }>()
  const [subaccountId, setSubaccountId] = useState<number>()
  const [depositAddr, setDepositAddr] = useState<string>()
  const [positions, setPositions] = useState<any[]>([])
  const [loadError, setLoadError] = useState<string>()
  // The modal: what the click is doing right now.
  const [step, setStep] = useState<{ kind: 'connecting' | 'deposit' | 'signing' | 'placing' | 'done' | 'error'; text?: string }>()
  const [order, setOrder] = useState<{ instrument: string; direction: 'buy' | 'sell'; price: number; amount: number }>()
  const dialog = useRef<HTMLDialogElement>(null)
  const trader = useRef<DeriveClient>()

  // Instruments once; ticker for the current instrument every 3 s.
  useEffect(() => {
    d.allOptions()
      .then(async (instruments) => {
        const m = buildMenu(instruments)
        const currency = m.currencies.includes('ETH') ? 'ETH' : m.currencies[0]
        setMenu(m)
        // Open on a round bet: near-the-money strike, ~2 months out.
        setS(pick(m, { currency, expiry: Date.now() / 1000 + 60 * 86400, strike: await d.spot(currency), side: 'above' }))
      })
      .catch((e) => setLoadError(String(e)))
  }, [])
  const inst = menu && s ? instrumentFor(menu, s) : undefined
  useEffect(() => {
    if (!inst) return
    let live = true
    const tick = () => d.publicClient.marketData.getTicker(inst.instrument_name).then((t: any) => live && setTicker(t)).catch(() => {})
    tick()
    const id = setInterval(tick, 3000)
    return () => { live = false; clearInterval(id) }
  }, [inst?.instrument_name])

  // Onboarding: show deposit progress while waiting. Login needs an account, so the user retries once it lands.
  const [pending, setPending] = useState<{ status: string; amount: string }[]>([])
  useEffect(() => {
    if (step?.kind !== 'deposit' || !wallet) return
    const poll = () => d.pendingDeposits(wallet.address).then(setPending).catch(() => {})
    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [step?.kind, wallet])

  const refreshPositions = async (c: DeriveClient, id: number) => {
    const r: any = await c.subaccounts.getPositions(id)
    setPositions(r.positions.filter((p: any) => Number(p.amount) !== 0))
  }

  /** Wallet → login → subaccount. Returns undefined when the wallet has no Derive account yet (modal shows deposit). */
  const connect = async () => {
    setStep({ kind: 'connecting' })
    const w = wallet ?? (await d.connectWallet())
    setWallet(w)
    if (subaccountId != null) return { w, id: subaccountId }
    try {
      await d.ownerLogin(w.wallet, w.address)
    } catch (e: any) {
      if (e?.code !== d.NO_ACCOUNT) throw e
      setDepositAddr(await d.depositAddress(w.address)); setStep({ kind: 'deposit' })
      return
    }
    const ids = await d.listSubaccounts(w.address)
    setSubaccountId(ids[0])
    return { w, id: ids[0] }
  }

  const ensureTrader = async (w: { wallet: WalletClient; address: Address }) => {
    if (trader.current) return trader.current
    let key = d.storedSessionKey(w.address)
    if (key) {
      try { trader.current = await d.tradingClient(w.address, key); return trader.current }
      catch { d.forgetSessionKey(w.address) } // expired or unknown key — mint a fresh one
    }
    setStep({ kind: 'signing' })
    key = await d.mintSessionKey(w.wallet, w.address)
    trader.current = await d.tradingClient(w.address, key)
    return trader.current
  }

  /** The whole flow behind one click: connect, onboard if needed, sign once, place, report. */
  const go = async () => {
    if (!menu || !s || !ticker || !inst) return
    const o = { ...resolve(menu, s, stance === 'do' ? 'yes' : 'no', ticker)!, amount: Number(amount) }
    setOrder(o)
    dialog.current?.showModal()
    try {
      const acct = await connect()
      if (!acct) return
      const c = await ensureTrader(acct.w)
      setStep({ kind: 'placing' })
      const res = await d.placeOpinion(c, { subaccountId: acct.id, ...o, tickSize: Number(inst.tick_size ?? '0.1') })
      const filled = Number(res.order?.filled_amount ?? 0)
      setStep(filled === 0
        ? { kind: 'error', text: 'Nothing filled — the book moved. Try again.' }
        : { kind: 'done', text: `${o.direction === 'buy' ? 'Bought' : 'Sold'} ${filled} at ~$${res.order.average_price ?? o.price}` })
      await refreshPositions(c, acct.id)
    } catch (e: any) {
      setStep({ kind: 'error', text: e?.message ?? String(e) })
    }
  }

  if (!menu || !s) return <main><h1><span className="logo">⌥</span> Opine</h1><p>{loadError ?? 'Loading markets…'}</p></main>

  const set = async (patch: Partial<Sentence>) => {
    if (patch.currency) patch.strike = await d.spot(patch.currency) // new coin, new price scale
    setS((cur) => pick(menu, { ...cur!, ...patch }))
  }
  const px = ticker ? Number(stance === 'do' ? ticker.a : ticker.b) : undefined
  const n = Number(amount) || 0
  const minAmt = Number(inst?.minimum_amount ?? 0.1), stepAmt = Number(inst?.amount_step ?? 0.01)
  const step_ = (dir: 1 | -1) => setAmount(String(Math.max(minAmt, Math.round((n + dir) * 100) / 100)))
  const usd = (x?: number) => (x ? `$${(x * n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—')
  const busy = step && !['done', 'error', 'deposit'].includes(step.kind)

  return (
    <main>
      <h1><span className="logo">⌥</span> Opine</h1>
      <p className="sentence">
        I{' '}
        <Toggle value={stance} options={[['do', 'do'], ['dont', "don't"]]} onChange={(v) => setStance(v as 'do' | 'dont')} className={stance} />{' '}
        think{' '}
        <Toggle value={s.currency} options={menu.currencies.map((c) => [c, c])} onChange={(v) => set({ currency: v })} />{' '}
        will be{' '}
        <Toggle value={s.side} options={[['above', 'above'], ['below', 'below']]} onChange={(v) => set({ side: v as Sentence['side'] })} />{' '}
        <Toggle value={String(s.strike)} options={menu.strikes(s.currency, s.expiry).map((k) => [String(k), `$${k.toLocaleString()}`])} onChange={(v) => set({ strike: Number(v) })} />{' '}
        by{' '}
        <Toggle value={String(s.expiry)} options={menu.expiries(s.currency).map((x) => [String(x), expiryLabel(x)])} onChange={(v) => set({ expiry: Number(v) })} />.
      </p>

      <div className={`card ${stance}`}>
        <div className="qty">
          <button onClick={() => step_(-1)} aria-label="fewer">−</button>
          <input type="number" min={minAmt} step={stepAmt} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button onClick={() => step_(1)} aria-label="more">+</button>
        </div>
        <button className="main" disabled={busy || !px} onClick={go}>
          <b>{stance === 'do' ? 'Pay' : 'Receive'} {usd(px)}</b>
        </button>
      </div>

      <dialog ref={dialog} onClose={() => setStep(undefined)}>
        {order && (
          <p className="order">
            <b>{order.direction === 'buy' ? 'Buy' : 'Sell'} {order.amount} × {order.instrument}</b>
            <small>${order.price.toFixed(2)} each · {d.NETWORK}{wallet ? ` · ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : ''}{subaccountId != null ? ` · #${subaccountId}` : ''}</small>
          </p>
        )}
        {step?.kind === 'connecting' && <p>Connecting wallet…</p>}
        {step?.kind === 'signing' && <p>Sign once to authorise a 30-day trading key. Trades after this need no signature.</p>}
        {step?.kind === 'placing' && <p>Placing…</p>}
        {step?.kind === 'done' && <p className="ok">{step.text}</p>}
        {step?.kind === 'error' && <p className="err">{step.text}</p>}
        {step?.kind === 'deposit' && (
          <div>
            <p>No Derive account yet. Send USDC on <b>{d.CHAIN_LABEL}</b> to open one:</p>
            <p><code>{depositAddr}</code></p>
            <p>Only USDC, only on {d.CHAIN_LABEL}. Credits in a minute or two.</p>
            {pending.map((p, i) => <p key={i}>Deposit of {(Number(p.amount) / 1e6).toFixed(2)} USDC: <b>{p.status}</b></p>)}
            <button onClick={go}>I've deposited — continue</button>
          </div>
        )}
        <form method="dialog"><button disabled={busy}>Close</button></form>
      </dialog>

      {positions.length > 0 && (
        <ul className="positions">
          {positions.map((p) => {
            const [cur, ymd, strike, type] = p.instrument_name.split('-')
            const long = Number(p.amount) > 0
            const side = type === 'C' ? 'above' : 'below'
            const when = expiryLabel(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8)) / 1000)
            return (
              <li key={p.instrument_name}>
                You think {cur} will {long ? '' : 'not '}be {side} ${Number(strike).toLocaleString()} by {when}.
                <small>{Math.abs(Number(p.amount))} contracts · mark ${Number(p.mark_price).toFixed(2)} · {p.instrument_name}</small>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
