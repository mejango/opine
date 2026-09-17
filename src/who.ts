// Who is behind an address: X handle via our server (Privy users), else ENS name. Cached for the session.
import { useEffect, useState } from 'react'
import { createPublicClient, http, type Address } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

export type Who = { x?: string; ens?: string }
const cache = new Map<string, Who>()
let xMap: Promise<Record<string, string>> | undefined
const ens = createPublicClient({ chain: mainnet, transport: http() }) // ENS lives on mainnet whatever Derive trades on

async function lookup(addr: string): Promise<Who> {
  const hit = cache.get(addr)
  if (hit) return hit
  xMap ??= fetch('/who').then((r) => r.json()).catch(() => ({}))
  const x = (await xMap)[addr]
  let ensName: string | undefined
  if (!x) {
    ensName = (await ens.getEnsName({ address: addr as Address }).catch(() => null)) ?? undefined
    if (ensName) { // an ENS profile can carry the handle too
      const t = await ens.getEnsText({ name: normalize(ensName), key: 'com.twitter' }).catch(() => null)
      if (t) return remember(addr, { x: t.replace(/^@|^https?:\/\/(x|twitter)\.com\//, ''), ens: ensName })
    }
  }
  return remember(addr, { x, ens: ensName })
}
const remember = (addr: string, w: Who) => (cache.set(addr, w), w)

export function useWho(addresses: string[]) {
  const [who, setWho] = useState<Record<string, Who>>({})
  const key = addresses.map((a) => a.toLowerCase()).filter((a, i, all) => all.indexOf(a) === i).join(',')
  useEffect(() => {
    let live = true
    Promise.all(key.split(',').filter(Boolean).map(async (a) => [a, await lookup(a)] as const)).then((pairs) => live && setWho(Object.fromEntries(pairs)))
    return () => { live = false }
  }, [key])
  return who
}
