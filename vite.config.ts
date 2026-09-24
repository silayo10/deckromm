import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

// Relative base so dist/ works from the app:// protocol inside the AppImage.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  build: {
    target: 'chrome130', // Electron 44 ships a much newer Chromium; no legacy transpile needed
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    // `npm run dev` serves on port 3000 (what Google AI Studio's preview expects);
    // `npm run dev:electron` passes --port 5173 itself.
    // AI Studio sets DISABLE_HMR=true while its agent edits files.
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
  },
});
