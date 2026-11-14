import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    host: true, // reachable from phones on the same network
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: true, // fail loudly instead of drifting to another port that APP_ORIGIN does not list
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
})
