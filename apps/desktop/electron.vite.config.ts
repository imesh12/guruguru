import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      lib: {
        entry: resolve(__dirname, 'electron/main.ts'),
        formats: ['es'],
        fileName: () => 'main.js',
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.cjs',
      },
    },
  },
  renderer: {
    root: '.',
    base: './',
    plugins: [react(), tailwindcss()],
    server: {
      watch: {
        ignored: ['**/runtime/**', '**/logs/**', '**/electron-cache/**', '**/electron-user-data/**'],
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'index.html'),
      },
    },
  },
});
