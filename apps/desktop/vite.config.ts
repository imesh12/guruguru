import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    watch: {
      ignored: ['**/runtime/**', '**/logs/**', '**/electron-cache/**', '**/electron-user-data/**'],
    },
  },
});
