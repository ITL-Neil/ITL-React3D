import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // three/addons -> three/examples/jsm
      'three/addons': path.resolve('./node_modules/three/examples/jsm'),
    },
  },
})
