import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.GW_API ?? `http://localhost:${process.env.PORT ?? 8787}`;

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': api,
      '/img': api,
      '/admin': api,
      '/health': api,
      '/stream': { target: api, changeOrigin: true },
    },
  },
  build: { chunkSizeWarningLimit: 3500 },
});
