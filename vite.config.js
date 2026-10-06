import { defineConfig } from 'vite';

export default defineConfig({
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
