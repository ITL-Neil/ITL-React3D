import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@component': path.resolve(__dirname, '../../component/frontend'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: ['..', '../..'],
    },
  },
});
