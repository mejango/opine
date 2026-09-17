import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // ponytail: the SDK only imports "ws" when globalThis.WebSocket is missing; never in a browser
  resolve: { alias: { ws: fileURLToPath(new URL('./src/empty.ts', import.meta.url)) } },
  server: { proxy: { '/who': 'http://localhost:8081' } }, // the OG/who server, when running locally
})
