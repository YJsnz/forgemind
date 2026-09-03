import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Only the desktop WebView2 bundle may opt into the Unity render surface.
  // Regular web deployments must stay WebGL even if a browser injects a
  // similarly named bridge object.
  define: {
    'import.meta.env.FORGEMIND_DESKTOP': JSON.stringify(process.env.FORGEMIND_DESKTOP === '1'),
  },
  // The desktop host loads the exact same build from a local WebView2 file
  // root. Browser deployments retain absolute /assets URLs.
  base: process.env.FORGEMIND_DESKTOP === '1' ? './' : '/',
  server: {
    port: Number(process.env.PORT) || 5173,
    open: false,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        inspection: resolve(__dirname, 'inspection.html'),
      },
    },
  },
})
