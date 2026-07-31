import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // some libraries reference the Node global `process.env` in browser code
  define: { 'process.env': {} },
  test: {
    setupFiles: ['./vitest.setup.js'],
  },
  server: {
    port: 5173,
    // Vite rejects requests whose Host header it doesn't recognise, which blocks
    // Cloudflare quick tunnels. Allowing the tunnel domains lets you share the
    // dev server; production serves from the backend and isn't affected.
    allowedHosts: ['.trycloudflare.com', '.cfargotunnel.com', 'localhost'],
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
