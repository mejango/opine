// The SDK signs a raw digest; browser wallets need the equivalent EIP-712 typed data.
export const MATCHING = '0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD' as const // SDK's constant verifying contract
export const ACTION_TYPES = {
  Action: [
    { name: 'subaccountId', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'module', type: 'address' }, { name: 'data', type: 'bytes' },
    { name: 'expiry', type: 'uint256' }, { name: 'owner', type: 'address' }, { name: 'signer', type: 'address' },
  ],
} as const
