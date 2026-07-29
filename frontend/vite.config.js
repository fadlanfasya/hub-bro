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
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
