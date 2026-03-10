import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyDirFirst: true,
    rollupOptions: {
      input: {
        'background/service-worker': resolve(__dirname, 'src/background/service-worker.ts'),
        'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
        'sidepanel/sidepanel': resolve(__dirname, 'src/sidepanel/sidepanel.ts'),
        'content/content-script': resolve(__dirname, 'src/content/content-script.ts'),
        'offscreen/offscreen': resolve(__dirname, 'src/offscreen/offscreen.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        format: 'es',
      },
    },
    target: 'esnext',
    minify: false,
    sourcemap: true,
  },
  publicDir: 'public',
});
