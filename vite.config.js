import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  server: {
    port: 5173,
    open: false
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true
  }
});
