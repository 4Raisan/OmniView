import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../app', import.meta.url)),
  base: './',
  server: {
    port: 5173,
    open: false,
    cors: true
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    chunkSizeWarningLimit: 1500
  },
  optimizeDeps: {
    include: ['xlsx', 'docx-preview', 'pdfjs-dist', 'marked', 'highlight.js', 'jszip']
  }
});
