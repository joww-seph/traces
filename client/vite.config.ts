import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
      { find: /^pdfjs-dist$/, replacement: 'pdfjs-dist/legacy/build/pdf.mjs' },
      { find: /^pdfjs-dist\/web\/pdf_viewer\.mjs$/, replacement: 'pdfjs-dist/legacy/web/pdf_viewer.mjs' },
    ],
  },
  server: {
    host: true,
    port: Number(process.env.CLIENT_PORT ?? 5173),
    strictPort: true,
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:3000', changeOrigin: false } },
  },
})
