import { createRoot } from 'react-dom/client'
import { PrivyProvider } from '@privy-io/react-auth'
import App from './App'
import { chain } from './derive'
import './style.css'

// App ids are public; the secret stays on the server (see server/index.mjs).
const appId = import.meta.env.VITE_PRIVY_APP_ID ?? 'cmu5mxmqm003g0clbc5ftlylj'
const dark = matchMedia('(prefers-color-scheme: dark)').matches

createRoot(document.getElementById('root')!).render(
  <PrivyProvider
    appId={appId}
    config={{
      loginMethods: ['twitter', 'wallet', 'email'],
      embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
      defaultChain: chain,
      supportedChains: [chain],
      appearance: { theme: dark ? 'dark' : 'light', accentColor: dark ? '#2dd4bf' : '#0e7c86', logo: '/favicon.svg' },
    }}
  >
    <App />
  </PrivyProvider>,
)
