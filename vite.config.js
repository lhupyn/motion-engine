import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'demo',
  base: '/motion-engine/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      external: ['three', 'talkinghead'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
});
