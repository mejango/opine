import { useEffect, useRef, useState } from 'react'
import type { DeriveClient } from '@derivexyz/derive-ts'
import type { Address, WalletClient } from 'viem'
import { buildMenu, expiryLabel, instrumentFor, pick, resolve, type Instrument, type Menu, type Sentence, type Ticker } from './sentence'
import * as d from './derive'

type Stage = 'browsing' | 'noAccount' | 'ready'

/** A word in the sentence that opens a native dropdown: underlined label with an invisible <select> on top. */
function Toggle({ value, options, onChange, className }: { value: string; options: [string, string][]; onChange: (v: string) => void; className?: string }) {
  const label = options.find(([v]) => v === value)?.[1] ?? value
  return (
    <span className={`tog ${className ?? ''}`}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
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
  const [stage, setStage] = useState<Stage>('browsing')
  const [subaccountId, setSubaccountId] = useState<number>()
  const [depositAddr, setDepositAddr] = useState<string>()
  const [positions, setPositions] = useState<any[]>([])
  const [msg, setMsg] = useState<{ text: string; err?: boolean }>()
  const [busy, setBusy] = useState(false)
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
      .catch((e) => setMsg({ text: String(e), err: true }))
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

  // Onboarding: show deposit progress while waiting. Login needs an account, so the user re-connects once it lands.
  const [pending, setPending] = useState<{ status: string; amount: string }[]>([])
  useEffect(() => {
    if (stage !== 'noAccount' || !wallet) return
    const poll = () => d.pendingDeposits(wallet.address).then(setPending).catch(() => {})
    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [stage, wallet])

  const refreshPositions = async () => {
    if (!trader.current || subaccountId == null) return
    const r: any = await trader.current.subaccounts.getPositions(subaccountId)
    setPositions(r.positions.filter((p: any) => Number(p.amount) !== 0))
  }

  const connect = async () => {
    const w = wallet ?? (await d.connectWallet())
    setWallet(w)
    try {
      await d.ownerLogin(w.wallet, w.address)
    } catch (e: any) {
      if (e?.code !== d.NO_ACCOUNT) throw e
      setDepositAddr(await d.depositAddress(w.address)); setStage('noAccount')
      return w
    }
    const ids = await d.listSubaccounts(w.address)
    setSubaccountId(ids[0]); setStage('ready')
    return w
  }

  const ensureTrader = async (w: { wallet: WalletClient; address: Address }) => {
    if (trader.current) return trader.current
    let key = d.storedSessionKey(w.address)
    if (key) {
      try { trader.current = await d.tradingClient(w.address, key); return trader.current }
      catch { d.forgetSessionKey(w.address) } // expired or unknown key — mint a fresh one
    }
    key = await d.mintSessionKey(w.wallet, w.address)
    trader.current = await d.tradingClient(w.address, key)
    return trader.current
  }

  const answer = async () => {
    const yes = stance === 'do'
    if (!menu || !s || !ticker || !inst) return
    setBusy(true); setMsg(undefined)
    try {
      const w = wallet ?? (await connect())
      if (!wallet || stage !== 'ready') return // first click just connects / onboards
      const c = await ensureTrader(w)
      await refreshPositions()
      const r = resolve(menu, s, yes ? 'yes' : 'no', ticker)!
      const res = await d.placeOpinion(c, { subaccountId: subaccountId!, ...r, amount: Number(amount), tickSize: Number(inst.tick_size ?? '0.1') })
      const filled = Number(res.order?.filled_amount ?? 0)
      setMsg(filled === 0
        ? { text: 'Nothing filled — the book moved. Try again.', err: true }
        : { text: `${r.direction === 'buy' ? 'Bought' : 'Sold'} ${filled} × ${r.instrument} at ~$${res.order.average_price ?? r.price}` })
      await refreshPositions()
    } catch (e: any) {
      setMsg({ text: e?.message ?? String(e), err: true })
    } finally { setBusy(false) }
  }

  if (!menu || !s) return <main><h1>Opine</h1><p>{msg?.text ?? 'Loading markets…'}</p></main>

  const set = async (patch: Partial<Sentence>) => {
    if (patch.currency) patch.strike = await d.spot(patch.currency) // new coin, new price scale
    setS((cur) => pick(menu, { ...cur!, ...patch }))
  }
  const px = ticker ? Number(stance === 'do' ? ticker.a : ticker.b) : undefined
  const n = Number(amount) || 0
  const cta = !wallet ? 'Connect wallet' : stage === 'noAccount' ? 'Waiting for deposit…' : undefined
  const minAmt = Number(inst?.minimum_amount ?? 0.1), stepAmt = Number(inst?.amount_step ?? 0.01)
  const step = (dir: 1 | -1) => setAmount(String(Math.max(minAmt, Math.round((n + dir) * 100) / 100)))
  const usd = (x?: number) => (x ? `$${(x * n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—')

  return (
    <main>
      <h1>Opine</h1>
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
          <button onClick={() => step(-1)} aria-label="fewer">−</button>
          <input type="number" min={minAmt} step={stepAmt} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button onClick={() => step(1)} aria-label="more">+</button>
        </div>
        <button className="main" disabled={busy || !px} onClick={answer}>
          <b>{stance === 'do' ? 'Pay' : 'Receive'} {usd(px)}</b>
          <small>{cta ?? `${stance === 'do' ? 'Buy' : 'Sell'} ${n} ${inst?.instrument_name}`}</small>
        </button>
      </div>
      <div className="row">
        <span>{d.NETWORK}{wallet ? ` · ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : ''}{subaccountId != null ? ` · #${subaccountId}` : ''}</span>
      </div>

      {msg && <div className={`msg${msg.err ? ' err' : ''}`}>{msg.text}</div>}

      {stage === 'noAccount' && (
        <div className="panel">
          <p>No Derive account yet. Send USDC on <b>{d.CHAIN_LABEL}</b> to open one:</p>
          <p><code>{depositAddr}</code></p>
          <p>Only USDC, only on {d.CHAIN_LABEL}. Credits in a minute or two.</p>
          {pending.map((p, i) => <p key={i}>Deposit of {(Number(p.amount) / 1e6).toFixed(2)} USDC: <b>{p.status}</b></p>)}
          <button disabled={busy} onClick={() => { setBusy(true); connect().catch((e) => setMsg({ text: e.message, err: true })).finally(() => setBusy(false)) }}>
            I've deposited — continue
          </button>
        </div>
      )}

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
