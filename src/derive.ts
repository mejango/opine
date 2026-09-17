// Derive V3 in the browser: the SDK over WebSocket, the user's wallet only for two signatures.
import { DeriveClient, ProtocolScopeCode, OffchainScope, loginParams, resolveNetwork, type NetworkName } from '@derivexyz/derive-ts'
import { encodeSetSessionKeyActionData } from '@derivexyz/derive-ts/codecs'
import { Wallet } from 'ethers'
import { createWalletClient, custom, type Address, type WalletClient } from 'viem'
import { mainnet, sepolia } from 'viem/chains'
import { ACTION_TYPES, MATCHING } from './eip712'

export const NETWORK = (import.meta.env.VITE_DERIVE_NETWORK ?? 'testnet') as NetworkName
export const net = resolveNetwork(NETWORK)
export const CHAIN_LABEL = NETWORK === 'mainnet' ? 'Ethereum' : 'Sepolia'

export const publicClient = new DeriveClient({ network: NETWORK })
export const ready = publicClient.connect()

export const spot = (currency: string) =>
  publicClient.marketData.getTicker(`${currency}-PERP`).then((t: any) => Number(t.I)).catch(() => 0)

export type Tape = { trade_id: string; instrument_name: string; timestamp: number; trade_price: string; trade_amount: string; direction: 'buy' | 'sell'; wallet: string; liquidity_role: 'maker' | 'taker' }

/** Recent option fills, taker side only — the side that had the opinion. */
export async function recentOpines(): Promise<Tape[]> {
  await ready
  const r: any = await publicClient.marketData.getPublicTradeHistory({ instrumentType: 'option', pageSize: 60 })
  return (r.trades as Tape[]).filter((t) => t.liquidity_role === 'taker')
}

/** Every live option across currencies; the API pages at 1000. */
export async function allOptions() {
  await ready
  const page = (n: number) => publicClient.marketData.getInstruments({ instrumentType: 'option', expired: false, pageSize: 1000, page: n }) as Promise<any>
  const first = await page(1)
  const rest = await Promise.all(Array.from({ length: first.pagination.num_pages - 1 }, (_, i) => page(i + 2)))
  return [first, ...rest].flatMap((r) => r.instruments) as import('./sentence').Instrument[]
}

// ---- wallet -------------------------------------------------------------
declare global { interface Window { ethereum?: any } }

export type WalletOption = { name: string; icon?: string; provider?: any }

// Shown even when not installed; a click then goes through WalletConnect (mobile app, Safe, Ambire web…). rdns is the EIP-6963 id.
export const KNOWN_WALLETS = [
  { rdns: 'io.metamask', name: 'MetaMask', icon: '/wallets/metamask.svg' },
  { rdns: 'com.coinbase.wallet', name: 'Coinbase Wallet', icon: '/wallets/coinbase.svg' },
  { rdns: 'io.rabby', name: 'Rabby', icon: '/wallets/rabby.svg' },
  { rdns: 'app.phantom', name: 'Phantom', icon: '/wallets/phantom.svg' },
  { rdns: 'com.ambire.wallet', name: 'Ambire', icon: '/wallets/ambire.png' },
  { rdns: 'global.safe', name: 'Safe', icon: '/wallets/safe.svg' },
]

/** WalletConnect session (QR / deep link). Loaded on demand — it's a big dependency. */
export async function walletConnect() {
  const projectId = import.meta.env.VITE_WC_PROJECT_ID
  if (!projectId) throw new Error('WalletConnect is not configured: set VITE_WC_PROJECT_ID (free at cloud.reown.com).')
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider')
  const p = await EthereumProvider.init({
    projectId,
    chains: [net.chainId],
    showQrModal: true,
    methods: ['personal_sign', 'eth_signTypedData_v4'],
    metadata: { name: 'Opine', description: 'Options in a sentence', url: location.origin, icons: [`${location.origin}/favicon.svg`] },
  })
  await p.enable()
  return p
}

/** Installed wallets via EIP-6963 announcements; falls back to the legacy window.ethereum. */
export function discoverWallets(): Promise<WalletOption[]> {
  return new Promise((resolve) => {
    const found: (WalletOption & { rdns?: string })[] = []
    const on = (e: any) => {
      const { info, provider } = e.detail
      if (!found.some((w) => w.name === info.name)) found.push({ name: info.name, icon: info.icon, provider, rdns: info.rdns })
    }
    window.addEventListener('eip6963:announceProvider', on)
    window.dispatchEvent(new Event('eip6963:requestProvider'))
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', on)
      if (!found.length && window.ethereum) found.push({ name: 'Browser wallet', provider: window.ethereum })
      const missing = KNOWN_WALLETS.filter((k) => !found.some((f) => f.rdns === k.rdns || f.name.startsWith(k.name)))
      resolve([...found, ...missing])
    }, 200)
  })
}

export const chain = NETWORK === 'mainnet' ? mainnet : sepolia

export async function connectWallet(provider: any): Promise<{ wallet: WalletClient; address: Address }> {
  const wallet = createWalletClient({ chain, transport: custom(provider) })
  const [address] = await wallet.requestAddresses()
  // Wallets refuse typed-data signatures whose domain.chainId isn't the active chain, so line it up now.
  if ((await wallet.getChainId()) !== chain.id) {
    try { await wallet.switchChain({ id: chain.id }) }
    catch { await wallet.addChain({ chain }); await wallet.switchChain({ id: chain.id }) }
  }
  provider.on?.('accountsChanged', () => location.reload()) // ponytail: state is per-address; a reload is the honest reset
  provider.on?.('chainChanged', () => location.reload())
  return { wallet, address }
}

/** Log the public connection in as the owner (one wallet popup). */
export async function ownerLogin(wallet: WalletClient, address: Address) {
  await ready
  const params = await loginParams({
    ownerAddress: address,
    signer: { signMessage: (message) => wallet.signMessage({ account: address, message }) },
  })
  return publicClient.send('public/login', params)
}

export const NO_ACCOUNT = 14000 // public/login error code for a wallet that has never deposited

export const pendingDeposits = (address: Address) =>
  publicClient.send('public/get_pending_deposits', { wallet: address }).then((r: any) => r.pending_deposits as { status: string; amount: string; deposit_type: string }[])

export const listSubaccounts = (address: Address) =>
  publicClient.send('private/get_subaccounts', { wallet: address }).then((r: any) => r.subaccount_ids as number[])

// ---- onboarding ---------------------------------------------------------
export async function depositAddress(address: Address) {
  await ready
  // ponytail: SDK's getRiskUniverses() sends null params, which the WS transport rejects
  const universes: any[] = await publicClient.send('public/get_risk_universes', {} as any)
  const manager = universes.flatMap((u: any) => u.managers)
    .find((m: any) => m.instruments.includes('ETH-OPTION') && m.collaterals.some((c: any) => c.name === 'USDC'))
  if (!manager) throw new Error('No USDC/ETH-option manager on this network')
  const r = await publicClient.deposits.depositAddress.register({ wallet: address, managerId: manager.manager_id, depositType: 'instant' })
  // ponytail: the SDK's bundled USDC address can go stale after a testnet reset — trust the exchange's answer
  const token = manager.collaterals.find((c: any) => c.name === 'USDC').erc20.underlying_erc20 as string
  return { address: r.deposit_address as string, token }
}

// ---- session key ----------------------------------------------------------
const keyStore = (owner: Address) => `opine:sessionKey:${NETWORK}:${owner.toLowerCase()}`
export const storedSessionKey = (owner: Address) => localStorage.getItem(keyStore(owner))
export const forgetSessionKey = (owner: Address) => localStorage.removeItem(keyStore(owner))

/** Mint a 30-day trade-only session key, authorised by one EIP-712 wallet signature. Requires ownerLogin first. */
export async function mintSessionKey(wallet: WalletClient, owner: Address) {
  const key = Wallet.createRandom()
  const expirySec = Math.floor(Date.now() / 1000) + 30 * 24 * 3600
  const scopes = [ProtocolScopeCode.TradeOrderbookAll]
  const fields = {
    subaccountId: 0n,
    nonce: BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1e6)),
    module: net.modules.setSessionKey as Address,
    data: encodeSetSessionKeyActionData({ sessionKey: key.address, expirySec, scopes, subaccountIds: [] }) as `0x${string}`,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 600),
    owner,
    signer: owner,
  }
  // Same digest the SDK's SignedAction builds: EIP-712 Action under the Matching domain.
  const signature = await wallet.signTypedData({
    account: owner,
    domain: { name: 'Matching', version: '1.0', chainId: net.chainId, verifyingContract: MATCHING },
    types: ACTION_TYPES,
    primaryType: 'Action',
    message: fields,
  })
  await publicClient.send('private/set_session_key', {
    wallet: owner,
    public_session_key: key.address,
    expiry_sec: expirySec,
    subaccount_ids: null,
    nonce: fields.nonce.toString(),
    signer: owner,
    signature,
    signature_expiry_sec: Number(fields.expiry),
    protocol_scopes: ['trade:orderbook:all'],
    offchain_scopes: [OffchainScope.AccountInfo],
    label: 'opine',
  })
  localStorage.setItem(keyStore(owner), key.privateKey)
  return key.privateKey
}

// ---- trading client (session key) ----------------------------------------
export async function tradingClient(owner: Address, sessionKey: string) {
  const c = new DeriveClient({ network: NETWORK, sessionKey, ownerAddress: owner })
  await c.connect()
  await c.login()
  return c
}

// Opine's cut: a builder fee Derive collects on the order and credits to our referral code. Per contract, in USDC.
export const OPINE_FEE_RATE = 0.01 // of the option premium
export const opineFee = (premium: number) => Math.round(premium * OPINE_FEE_RATE * 100) / 100
const REFERRAL_CODE = import.meta.env.VITE_REFERRAL_CODE as string | undefined

/** Market order (limit = the slippage cap Derive requires, quote ± 1 %), or a GTC limit at the named price. */
export async function placeOpinion(c: DeriveClient, p: { subaccountId: number; instrument: string; direction: 'buy' | 'sell'; price: number; amount: number; tickSize: number; limit?: number; takerCost: number }) {
  const raw = p.limit ?? (p.direction === 'buy' ? p.price * 1.01 : p.price * 0.99)
  const limitPrice = (Math.round(raw / p.tickSize) * p.tickSize).toFixed(Math.max(0, -Math.floor(Math.log10(p.tickSize))))
  const fee = opineFee(p.limit ?? p.price)
  return c.orders.place({
    // ceiling only — the exchange charges its real rate; must cover our extra fee too
    maxFee: (p.takerCost * 3 + fee).toFixed(6),
    subaccountId: p.subaccountId,
    instrumentName: p.instrument,
    direction: p.direction,
    amount: p.amount,
    limitPrice,
    orderType: p.limit ? 'limit' : 'market',
    timeInForce: p.limit ? 'gtc' : 'ioc',
    label: 'opine',
    extraFee: fee,
    referralCode: REFERRAL_CODE,
  }) as Promise<any>
}
