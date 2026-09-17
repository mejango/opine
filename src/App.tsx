import { useEffect, useRef, useState } from 'react'
import type { DeriveClient } from '@derivexyz/derive-ts'
import type { Address, WalletClient } from 'viem'
import { buildMenu, expiryLabel, instrumentFor, parseInstrument, pick, resolve, type Instrument, type Menu, type Sentence, type Ticker } from './sentence'
import * as d from './derive'
import { payoff, stats, type Leg } from './payoff'

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


const money = (x: number) => (x === Infinity ? 'Uncapped' : `$${x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
const kfmt = (x: number) => (x >= 1000 ? `$${(x / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : `$${x.toLocaleString('en-US', { maximumFractionDigits: 2 })}`)

/** Payoff at expiry: headline figures plus a hoverable line over ±40 % of strike. */
function Payoff({ leg, spot, currency }: { leg: Leg; spot?: number; currency: string }) {
  const [hover, setHover] = useState<number>()
  const st = stats(leg)
  const W = 360, H = 180, L = 46, R = 8, T = 10, B = 22
  const lo = leg.strike * 0.6, hi = leg.strike * 1.4
  const ys = [payoff(leg, lo), payoff(leg, hi), payoff(leg, leg.strike), 0]
  const yMin = Math.min(...ys), yMax = Math.max(...ys), pad = (yMax - yMin) * 0.15 || 1
  const x = (p: number) => L + ((p - lo) / (hi - lo)) * (W - L - R)
  const y = (v: number) => T + ((yMax + pad - v) / (yMax - yMin + 2 * pad)) * (H - T - B)
  const pts = [lo, leg.strike, hi].map((p) => `${x(p)},${y(payoff(leg, p))}`).join(' ')
  const zero = y(0)
  const ticks = [0.75, 1, 1.25].map((m) => leg.strike * m)
  const yTicks = [yMin, 0, yMax].filter((v, i, a) => a.indexOf(v) === i)
  const hp = hover != null ? lo + (hover / (W - L - R)) * (hi - lo) : undefined
  return (
    <div className="payoff">
      <div className="pstats">
        <span>Max loss<b className="loss">{money(st.maxLoss)}</b></span>
        <span>Break even<b>{money(st.breakEven)}</b></span>
        <span>Max profit<b className="gain">{money(st.maxProfit)}</b></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Profit or loss at expiry by price"
        onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(W - L - R, ((e.clientX - r.left) / r.width) * W - L))) }}
        onPointerLeave={() => setHover(undefined)}>
        <defs><clipPath id="above"><rect x={L} y={0} width={W - L - R} height={zero} /></clipPath><clipPath id="below"><rect x={L} y={zero} width={W - L - R} height={H - zero} /></clipPath></defs>
        <polygon points={`${x(lo)},${zero} ${pts} ${x(hi)},${zero}`} className="gain" clipPath="url(#above)" />
        <polygon points={`${x(lo)},${zero} ${pts} ${x(hi)},${zero}`} className="loss" clipPath="url(#below)" />
        <line x1={L} x2={W - R} y1={zero} y2={zero} className="axis" />
        {yTicks.map((v) => <text key={v} x={L - 6} y={y(v)} className="tick" textAnchor="end" dominantBaseline="middle">{v === 0 ? '$0' : (v < 0 ? '−' : '') + kfmt(Math.abs(v))}</text>)}
        {ticks.map((p) => <text key={p} x={x(p)} y={H - 6} className="tick" textAnchor="middle">{kfmt(p)}</text>)}
        {spot && spot > lo && spot < hi && <>
          <line x1={x(spot)} x2={x(spot)} y1={T} y2={H - B} className="spot" />
          <text x={x(spot)} y={T + 8} className="tick" textAnchor={spot > leg.strike ? 'end' : 'start'} dx={spot > leg.strike ? -4 : 4}>{currency} {money(spot)}</text>
        </>}
        <polyline points={pts} className="line" />
        {hp != null && <>
          <line x1={x(hp)} x2={x(hp)} y1={T} y2={H - B} className="cross" />
          <circle cx={x(hp)} cy={y(payoff(leg, hp))} r={4} className="dot" />
          <text x={x(hp)} y={H - B - 6} className="tip" textAnchor={hp > (lo + hi) / 2 ? 'end' : 'start'} dx={hp > (lo + hi) / 2 ? -6 : 6}>
            {currency} at {kfmt(hp)} → {payoff(leg, hp) < 0 ? '−' : '+'}{money(Math.abs(payoff(leg, hp)))}
          </text>
        </>}
      </svg>
    </div>
  )
}

export default function App() {
  const [menu, setMenu] = useState<Menu>()
  const [s, setS] = useState<Sentence>()
  const [stance, setStance] = useState<'do' | 'dont'>('do') // do = buy the option, don't = sell it
  const [ticker, setTicker] = useState<Ticker>()
  const [amount, setAmount] = useState('1')
  const [limit, setLimit] = useState<string>() // set = user named a price → GTC limit instead of market
  const [wallet, setWallet] = useState<{ wallet: WalletClient; address: Address }>()
  const [subaccountId, setSubaccountId] = useState<number>()
  const [depositAddr, setDepositAddr] = useState<{ address: string; token: string }>()
  // ?demo shows a sample position so the column can be styled without a funded account.
  const demo = new URLSearchParams(location.search).has('demo')
  const [positions, setPositions] = useState<any[]>(demo ? [
    { instrument_name: 'ETH-20261127-2500-C', amount: '2', average_price: '213.90', mark_price: '231.40', unrealized_pnl: '35.00' },
    { instrument_name: 'BTC-20261225-100000-P', amount: '-0.5', average_price: '4120.00', mark_price: '4388.50', unrealized_pnl: '-134.25' },
  ] : [])
  const [loadError, setLoadError] = useState<string>()
  // The modal: what the click is doing right now.
  const [step, setStep] = useState<{ kind: 'connecting' | 'choose' | 'deposit' | 'signing' | 'placing' | 'done' | 'error'; text?: string }>()
  const [wallets, setWallets] = useState<d.WalletOption[]>([])
  const [order, setOrder] = useState<{ instrument: string; direction: 'buy' | 'sell'; price: number; amount: number; sentence: Sentence; stance: 'do' | 'dont'; limit?: number }>()
  const dialog = useRef<HTMLDialogElement>(null)
  const trader = useRef<DeriveClient>()
  const [feed, setFeed] = useState<d.Tape[]>([])
  const [tab, setTab] = useState<'latest' | 'mine'>('latest') // mobile only: the two columns become tabs
  const copying = useRef(false) // a copied opine opens the modal as soon as its price lands

  // Recent opines: the public option tape, every 15 s.
  useEffect(() => {
    const load = () => d.recentOpines().then(setFeed).catch(() => {})
    load()
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [])

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
    setTicker(undefined)
    const tick = () => d.publicClient.marketData.getTicker(inst.instrument_name).then((t: any) => live && setTicker(t)).catch(() => {})
    tick()
    const id = setInterval(tick, 3000)
    return () => { live = false; clearInterval(id) }
  }, [inst?.instrument_name])

  // Positions refresh every 10 s while signed in (marks and P&L move).
  useEffect(() => {
    if (!trader.current || subaccountId == null) return
    const id = setInterval(() => refreshPositions(trader.current!, subaccountId).catch(() => {}), 10_000)
    return () => clearInterval(id)
  }, [subaccountId, trader.current])

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
  const connect = async (provider?: any) => {
    setStep({ kind: 'connecting' })
    let w = wallet
    if (!w) {
      if (provider === 'wc') provider = await d.walletConnect()
      if (!provider) {
        const found = await d.discoverWallets()
        const installed = found.filter((f) => f.provider)
        if (!installed.length) { setWallets(found); setStep({ kind: 'choose' }); return } // nothing installed: show what works
        if (installed.length > 1) { setWallets(found); setStep({ kind: 'choose' }); return } // let them pick
        provider = installed[0].provider
      }
      w = await d.connectWallet(provider)
      setWallet(w)
    }
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

  /** Just sign in (for the positions column): connect, onboard if needed, mint key, load positions. */
  const signIn = async (provider?: any) => {
    if (!dialog.current?.open) dialog.current?.showModal()
    try {
      const acct = await connect(provider)
      if (!acct) return
      const c = await ensureTrader(acct.w)
      await refreshPositions(c, acct.id)
      dialog.current?.close()
    } catch (e: any) {
      setStep({ kind: 'error', text: e?.details || e?.shortMessage || e?.message || String(e) })
    }
  }

  /** The whole flow behind one click: connect, onboard if needed, sign once, place, report.
   *  `override` places against an existing position (unwind / double down) instead of the sentence. */
  const go = async (provider?: any, override?: { instrument: string; direction: 'buy' | 'sell'; amount: number }) => {
    if (!menu || !s) return
    let o
    if (override) {
      const t: Ticker = await d.publicClient.marketData.getTicker(override.instrument) as any
      const ps = parseInstrument(override.instrument)
      o = { instrument: override.instrument, direction: override.direction, price: Number(override.direction === 'buy' ? t.a : t.b), amount: override.amount,
        sentence: { currency: ps.currency, expiry: ps.expiry, strike: ps.strike, side: ps.side }, stance: (override.direction === 'buy' ? 'do' : 'dont') as 'do' | 'dont', limit: undefined }
    } else {
      if (!ticker || !inst) return
      o = { ...resolve(menu, s, stance === 'do' ? 'yes' : 'no', ticker)!, amount: Number(amount), sentence: { ...s }, stance, limit: limit ? Number(limit) : undefined }
    }
    setOrder(o)
    if (!dialog.current?.open) dialog.current?.showModal()
    try {
      const acct = await connect(provider)
      if (!acct) return
      const c = await ensureTrader(acct.w)
      setStep({ kind: 'placing' })
      const tickSize = Number((override ? menu.byName.get(o.instrument)?.tick_size : inst?.tick_size) ?? '0.1')
      const res = await d.placeOpinion(c, { subaccountId: acct.id, ...o, tickSize })
      const filled = Number(res.order?.filled_amount ?? 0)
      setStep(filled === 0
        ? o.limit
          ? { kind: 'done', text: `Resting on the book at $${o.limit.toFixed(2)} until it fills. Manage it at ${d.NETWORK === 'mainnet' ? 'app' : 'testnet.app'}.derive.xyz.` }
          : { kind: 'error', text: 'Nothing filled — the book moved. Try again.' }
        : { kind: 'done', text: `${o.direction === 'buy' ? 'Bought' : 'Sold'} ${filled} at ~$${res.order.average_price ?? o.price}${filled < o.amount ? `, the rest rests on the book` : ''}` })
      await refreshPositions(c, acct.id)
    } catch (e: any) {
      setStep({ kind: 'error', text: e?.details || e?.shortMessage || e?.message || String(e) }) // viem errors carry a tidy `details`
    }
  }

  useEffect(() => { if (ticker && copying.current) { copying.current = false; go() } }, [ticker])

  /** Load someone's trade into the sentence and open the order. */
  const copy = (t: d.Tape) => {
    const p = parseInstrument(t.instrument_name)
    const target = pick(menu!, p)
    if (target.strike !== p.strike || target.expiry !== p.expiry) return // no longer listed
    setStance(t.direction === 'buy' ? 'do' : 'dont')
    setAmount(t.trade_amount)
    setS(target)
    copying.current = true
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!menu || !s) return (
    <main>
      <h1><span className="logo">⌥</span><span>Opine<small>on <a href="https://derive.xyz" target="_blank" rel="noreferrer">Derive</a></small></span></h1>
      {loadError ? <p className="err">{loadError}</p> : (
        <>
          <p className="sentence ghost" aria-busy="true" aria-label="Loading markets">
            I <i style={{ width: '1.4em' }} /> think <i style={{ width: '2.3em' }} /> will be <i style={{ width: '3.2em' }} /> <i style={{ width: '3.6em' }} /> by <i style={{ width: '7.2em' }} />.
          </p>
          <div className="card ghost"><div className="qty"><i style={{ width: '3em', height: '1em' }} /></div><i className="main" /></div>
        </>
      )}
    </main>
  )

  const set = async (patch: Partial<Sentence>) => {
    if (patch.currency) patch.strike = await d.spot(patch.currency) // new coin, new price scale
    setS((cur) => pick(menu, { ...cur!, ...patch }))
  }
  const quote = ticker ? Number(stance === 'do' ? ticker.a : ticker.b) : undefined
  const px = limit ? Number(limit) || undefined : quote
  const n = Number(amount) || 0
  const minAmt = Number(inst?.minimum_amount ?? 0.1), stepAmt = Number(inst?.amount_step ?? 0.01)
  const step_ = (dir: 1 | -1) => setAmount(String(Math.max(minAmt, Math.round((n + dir) * 100) / 100)))
  const usd = (x?: number) => (x ? `$${(x * n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—')
  const busy = step && !['done', 'error', 'deposit', 'choose'].includes(step.kind)

  return (
    <main>
      <h1><span className="logo">⌥</span><span>Opine<small>on <a href="https://derive.xyz" target="_blank" rel="noreferrer">Derive</a></small></span></h1>
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
        <button className="main" disabled={busy || !px} onClick={() => go()}>
          <b>{limit ? 'Offer' : stance === 'do' ? 'Pay' : 'Receive'} {px ? usd(px) : <i className="ghost" style={{ width: '4em' }} />}</b>
        </button>
        <div className="limit">
          {limit == null
            ? <button className="text" onClick={() => setLimit(quote?.toFixed(2) ?? '')}>Or, name your price.</button>
            : <label>
                $<input type="text" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: `${Math.max(1, limit.length) + 0.5}ch` }} autoFocus /> each, waits for someone to {stance === 'do' ? 'sell' : 'buy'}.
                <button className="text" onClick={() => setLimit(undefined)}>{stance === 'do' ? 'Buy' : 'Sell'} now instead.</button>
              </label>}
        </div>
      </div>

      <dialog ref={dialog} onClose={() => setStep(undefined)}>
        <form method="dialog" className="x"><button disabled={busy} aria-label="Close">×</button></form>
        {order && (
          <p className="order">
            <b>You {order.stance === 'do' ? 'think' : "don't think"} {order.sentence.currency} will be {order.sentence.side} ${order.sentence.strike.toLocaleString()}<br />by {expiryLabel(order.sentence.expiry)}.</b>
            <small>
              {order.limit ? (order.direction === 'buy' ? 'Offering to buy' : 'Offering to sell') : order.direction === 'buy' ? 'Buying' : 'Selling'} {order.amount} {order.sentence.currency} {order.sentence.side === 'above' ? 'call' : 'put'}{order.amount === 1 ? '' : 's'} at ${(order.limit ?? order.price).toFixed(2)} each{order.limit ? ' (limit)' : ''} on Derive {d.NETWORK}
              {wallet ? ` from ${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : ''}{subaccountId != null ? ` (subaccount ${subaccountId})` : ''}.
            </small>
          </p>
        )}
        {order && (
          <Payoff currency={order.sentence.currency} spot={ticker?.I ? Number(ticker.I) : undefined}
            leg={{ type: order.sentence.side === 'above' ? 'C' : 'P', strike: order.sentence.strike, premium: order.limit ?? order.price, n: order.amount, long: order.direction === 'buy' }} />
        )}
        {step?.kind === 'connecting' && <p>Connecting wallet…</p>}
        {step?.kind === 'choose' && (
          <div className="wallets">
            <p>Connect with</p>
            <div>
              {wallets.map((w) => w.provider
                ? <button key={w.name} title={w.name} aria-label={w.name} onClick={() => go(w.provider)}>{w.icon ? <img src={w.icon} alt="" /> : <span>{w.name[0]}</span>}</button>
                : <button key={w.name} className="missing" title={`${w.name} via WalletConnect`} aria-label={`${w.name} via WalletConnect`} onClick={() => go('wc')}><img src={w.icon} alt="" /></button>)}
            </div>
          </div>
        )}
        {step?.kind === 'signing' && <p>Sign once to authorise a 30-day trading key. Trades after this need no signature.</p>}
        {step?.kind === 'placing' && <p>Placing…</p>}
        {step?.kind === 'done' && <p className="ok">{step.text}</p>}
        {step?.kind === 'error' && <p className="err">{step.text}</p>}
        {step?.kind === 'deposit' && (
          <div>
            <p>No Derive account yet. Send USDC on <b>{d.CHAIN_LABEL}</b> to open one:</p>
            <p><code>{depositAddr?.address}</code></p>
            <p>Only this USDC, only on {d.CHAIN_LABEL}: <code>{depositAddr?.token}</code>. Credits in a minute or two.</p>
            {pending.map((p, i) => <p key={i}>Deposit of {(Number(p.amount) / 1e6).toFixed(2)} USDC: <b>{p.status}</b></p>)}
            <button onClick={() => (order ? go() : signIn())}>I've deposited — continue</button>
          </div>
        )}
      </dialog>

      <nav className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'latest'} onClick={() => setTab('latest')}>Latest opinions</button>
        <button role="tab" aria-selected={tab === 'mine'} onClick={() => setTab('mine')}>Your opinions</button>
      </nav>
      <div className={`cols ${tab}`}>
      {feed.length > 0 && (
        <section className="feed">
          <h2>Latest opinions</h2>
          <ul>
            {feed.map((t) => {
              const p = parseInstrument(t.instrument_name)
              const ago = Math.max(1, Math.round((Date.now() - t.timestamp) / 60000))
              return (
                <li key={t.trade_id}>
                  <header>
                    <b>{t.wallet.slice(0, 6)}…{t.wallet.slice(-4)}</b>
                    <time dateTime={new Date(t.timestamp).toISOString()}>{ago < 60 ? `${ago}m` : ago < 1440 ? `${Math.round(ago / 60)}h` : `${Math.round(ago / 1440)}d`} ago</time>
                  </header>
                  <p>{t.direction === 'buy' ? 'Thinks' : "Doesn't think"} {p.currency} will be {p.side} ${p.strike.toLocaleString()}<br />by {expiryLabel(p.expiry)}.</p>
                  <small>{Number(t.trade_amount)} contract{Number(t.trade_amount) === 1 ? '' : 's'} at ${Number(t.trade_price).toFixed(2)}</small>
                  <footer><button className="text" onClick={() => copy(t)}>Copy trade</button></footer>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      <section className="mine">
        <h2>Your opinions</h2>
        {!trader.current && !demo ? (
          <p className="muted"><button className="text" onClick={() => signIn()}>Connect</button></p>
        ) : positions.length === 0 ? (
          <p className="muted">No opinions yet. Say one above.</p>
        ) : (
          <ul>
            {positions.map((p) => {
              const ps = parseInstrument(p.instrument_name)
              const n = Number(p.amount), long = n > 0, size = Math.abs(n)
              const pnl = Number(p.unrealized_pnl), avg = Number(p.average_price), mark = Number(p.mark_price)
              return (
                <li key={p.instrument_name}>
                  <p>You {long ? 'think' : "don't think"} {ps.currency} will be {ps.side} ${ps.strike.toLocaleString()}<br />by {expiryLabel(ps.expiry)}.</p>
                  <small>{size} contract{size === 1 ? '' : 's'}, {long ? 'paid' : 'received'} ${avg.toFixed(2)} each, now ${mark.toFixed(2)}</small>
                  <b className={pnl >= 0 ? 'gain' : 'loss'}>{pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}</b>
                  <footer>
                    <button className="text" onClick={() => go(undefined, { instrument: p.instrument_name, direction: long ? 'sell' : 'buy', amount: size })}>{pnl >= 0 ? 'Take profits' : 'Take losses'}</button>
                    <button className="text" onClick={() => go(undefined, { instrument: p.instrument_name, direction: long ? 'buy' : 'sell', amount: size })}>Double down</button>
                  </footer>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      </div>
    </main>
  )
}
