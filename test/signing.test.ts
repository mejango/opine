import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SignedAction, domainSeparator, resolveNetwork } from '@derivexyz/derive-ts'
import { encodeSetSessionKeyActionData } from '@derivexyz/derive-ts/codecs'
import { Wallet } from 'ethers'
import { privateKeyToAccount } from 'viem/accounts'
import { ACTION_TYPES, MATCHING } from '../src/eip712.ts'

test('viem signTypedData over the Action struct equals the SDK raw-digest signature', async () => {
  const net = resolveNetwork('testnet')
  const owner = Wallet.createRandom()
  const acct = privateKeyToAccount(owner.privateKey as `0x${string}`)
  const data = encodeSetSessionKeyActionData({ sessionKey: Wallet.createRandom().address, expirySec: 2_000_000_000, scopes: [3], subaccountIds: [] })
  const fields = { subaccountId: 0n, nonce: 1789647836598000123n, module: net.modules.setSessionKey, data, expiry: 1_800_000_000n, owner: owner.address, signer: owner.address }

  const sdk = new SignedAction(
    { subaccountId: 0, nonce: fields.nonce.toString(), module: fields.module, data, expirySec: Number(fields.expiry), owner: owner.address, signer: owner.address },
    domainSeparator(net),
  ).sign(owner)

  const mine = await acct.signTypedData({
    domain: { name: 'Matching', version: '1.0', chainId: net.chainId, verifyingContract: MATCHING },
    types: ACTION_TYPES, primaryType: 'Action', message: fields as any,
  })
  assert.equal(mine, sdk.signature)
})
