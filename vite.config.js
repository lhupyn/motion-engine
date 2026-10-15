import { defineConfig } from 'vite';

export default defineConfig({
  root: 'demo',
  base: '/motion-engine/',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: { external: ['three', 'talkinghead'] },
  },
  // TalkingHead loads its lip-sync modules relative to itself; prebundling breaks those paths.
  optimizeDeps: { exclude: ['talkinghead'] },
});
