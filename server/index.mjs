// Serves dist/ and, because a shared link *is* an opinion, renders per-link unfurl metadata and a 1200×630 image.
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { Resvg } from '@resvg/resvg-js'

const DIST = new URL('../dist/', import.meta.url).pathname
const NETWORK = process.env.VITE_DERIVE_NETWORK ?? 'testnet'
const API = NETWORK === 'mainnet' ? 'https://api.derive.xyz/v3' : 'https://testnet.api.derive.xyz/v3'
const fonts = [500, 600].map((w) => new URL(`./Inter-${w}.ttf`, import.meta.url).pathname)
const indexHtml = readFileSync(join(DIST, 'index.html'), 'utf8')
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.html': 'text/html', '.json': 'application/json', '.woff2': 'font/woff2' }

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const money = (x) => `$${Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dateLabel = (ymd) => new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** ?i=ETH-20261127-2500-C&s=dont&n=2&p=250 → the sentence and its numbers. */
function opinion(q) {
  const m = /^([A-Z0-9]+)-(\d{8})-(\d+(?:\.\d+)?)-([CP])$/.exec(q.get('i') ?? '')
  if (!m) return null
  const [, cur, ymd, strike, type] = m
  return { instrument: q.get('i'), cur, strike: Number(strike), side: type === 'C' ? 'above' : 'below', when: dateLabel(ymd),
    dont: q.get('s') === 'dont', n: Number(q.get('n') ?? 1) || 1, limit: q.get('p') ? Number(q.get('p')) : undefined }
}
const sentence = (o) => `I ${o.dont ? "don't" : 'do'} think ${o.cur} will be ${o.side} $${o.strike.toLocaleString()} by ${o.when}.`

const tickers = new Map() // instrument → { t, at }
async function quote(o) {
  const c = tickers.get(o.instrument)
  if (c && Date.now() - c.at < 15_000) return c.t
  const r = await fetch(`${API}/public/get_ticker`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'opine-og' }, body: JSON.stringify({ instrument_name: o.instrument }), signal: AbortSignal.timeout(4000) }).then((r) => r.json()).catch(() => null)
  const t = r?.result ?? null
  tickers.set(o.instrument, { t, at: Date.now() })
  return t
}
const priceLine = (o, t) => {
  const each = o.limit ?? (t ? Number(o.dont ? t.b : t.a) : undefined)
  if (!each) return null
  return `${o.limit ? 'Offer' : o.dont ? 'Receive' : 'Pay'} ${money(each * o.n)}`
}

function svg(o, pay) {
  const green = '#34d399', red = '#f87171', orange = '#f2a14c', teal = '#2dd4bf', fg = '#eee', bg = '#111', muted = '#999'
  const stance = o.dont ? "don't" : 'do'
  const u = (txt, color = fg) => `<tspan fill="${color}" text-decoration="underline">${esc(txt)}</tspan>`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${bg}"/>
  <text x="56" y="76" font-family="Inter" font-weight="600" font-size="26" fill="${orange}" letter-spacing="3">⌥  OPINE</text>
  <text x="102" y="102" font-family="Inter" font-weight="500" font-size="15" fill="${muted}">on Derive</text>
  <g font-family="Inter" font-weight="600" font-size="84" fill="${fg}">
    <text x="56" y="250">I ${u(stance, o.dont ? red : green)} think ${u(o.cur)} will be</text>
    <text x="56" y="358">${u(o.side)} ${u('$' + o.strike.toLocaleString())} by</text>
    <text x="56" y="466">${u(o.when)}.</text>
  </g>
  ${pay ? `<rect x="56" y="520" width="${Math.max(260, pay.length * 20 + 56)}" height="72" fill="${teal}"/>
  <text x="84" y="568" font-family="Inter" font-weight="600" font-size="34" fill="#111">${esc(pay)}</text>` : ''}
</svg>`
}

const pngCache = new Map()
async function ogPng(o) {
  const t = await quote(o)
  const pay = priceLine(o, t)
  const key = JSON.stringify([o, pay])
  const hit = pngCache.get(key)
  if (hit) return hit
  const png = new Resvg(svg(o, pay), { fitTo: { mode: 'width', value: 1200 }, font: { fontFiles: fonts, loadSystemFonts: false, defaultFontFamily: 'Inter' } }).render().asPng()
  if (pngCache.size > 200) pngCache.clear()
  pngCache.set(key, png)
  return png
}

function page(url) {
  const o = opinion(url.searchParams)
  const site = `${url.protocol}//${url.host}`
  const title = o ? sentence(o) : 'Opine — What do you think the price will be?'
  const desc = o ? `Agree or disagree on Derive. Copy this opinion or take the other side.` : 'Buy or sell the option that says it.'
  const img = `${site}/og.png${o ? url.search : ''}`
  const tags = `<meta property="og:title" content="${esc(title)}"/><meta property="og:description" content="${esc(desc)}"/><meta property="og:image" content="${esc(img)}"/><meta property="og:image:width" content="1200"/><meta property="og:image:height" content="630"/><meta property="og:url" content="${esc(site + url.pathname + url.search)}"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${esc(title)}"/><meta name="twitter:image" content="${esc(img)}"/>`
  return indexHtml.replace('</head>', `<meta name="description" content="${esc(desc)}"/>${tags}</head>`).replace('<title>Opine</title>', `<title>${esc(title)}</title>`)
}

// address → X handle, from Privy's user list (server-side only: needs the app secret). Empty when not configured.
const PRIVY_ID = process.env.PRIVY_APP_ID, PRIVY_SECRET = process.env.PRIVY_APP_SECRET
let who = { at: 0, map: {} }
async function whoMap() {
  if (!PRIVY_ID || !PRIVY_SECRET) return {}
  if (Date.now() - who.at < 60_000) return who.map
  const map = {}
  let cursor
  for (let page = 0; page < 20; page++) { // ponytail: 2k users; paginate smarter when that's a problem
    const r = await fetch(`https://auth.privy.io/api/v1/users?limit=100${cursor ? `&cursor=${cursor}` : ''}`, {
      headers: { authorization: 'Basic ' + Buffer.from(`${PRIVY_ID}:${PRIVY_SECRET}`).toString('base64'), 'privy-app-id': PRIVY_ID },
      signal: AbortSignal.timeout(8000),
    }).then((r) => r.json()).catch(() => null)
    if (!r?.data) break
    for (const u of r.data) {
      const x = u.linked_accounts?.find((a) => a.type === 'twitter_oauth')?.username
      if (!x) continue
      for (const a of u.linked_accounts) if (a.type === 'wallet' && a.address) map[a.address.toLowerCase()] = x
    }
    cursor = r.next_cursor
    if (!cursor) break
  }
  who = { at: Date.now(), map }
  return map
}

createServer(async (req, res) => {
  const url = new URL(req.url, `https://${req.headers.host ?? 'opine.money'}`)
  try {
    if (url.pathname === '/who') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' }).end(JSON.stringify(await whoMap()))
      return
    }
    if (url.pathname === '/og.png') {
      const o = opinion(url.searchParams) ?? opinion(new URLSearchParams('i=ETH-20261127-2500-C'))
      const png = await ogPng(o)
      res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=60' }).end(png)
      return
    }
    const file = normalize(join(DIST, url.pathname))
    if (url.pathname !== '/' && file.startsWith(DIST) && existsSync(file) && !file.endsWith('/')) {
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': url.pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=300' })
      res.end(readFileSync(file))
      return
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }).end(page(url))
  } catch (e) {
    res.writeHead(500).end(String(e))
  }
}).listen(process.env.PORT ?? 8080, '::', () => console.log('opine on', process.env.PORT ?? 8080))
