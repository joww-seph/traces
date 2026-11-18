import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      // pdf.js's legacy build carries polyfills (e.g. Map.getOrInsertComputed) that phone browsers such as Samsung Internet still lack
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      { find: /^pdfjs-dist\/web\/pdf_viewer\.mjs$/, replacement: 'pdfjs-dist/legacy/web/pdf_viewer.mjs' },
    ],
  },
  server: {
    host: true, // reachable from phones on the same network
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: true, // fail loudly instead of drifting to another port that APP_ORIGIN does not list
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
})
