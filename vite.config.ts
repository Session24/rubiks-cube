import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: '/rubiks-cube/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // three.js goes into its own chunk (rolldown wants the function form)
        manualChunks(id: string) {
          return id.includes('node_modules/three/') ? 'three' : undefined;
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
  worker: {
    format: 'es',
  },
});