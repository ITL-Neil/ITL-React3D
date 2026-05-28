import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import dts from 'vite-plugin-dts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [
        react(),
        dts({
          include: ['component'],
          outDir: 'dist',
        }),
      ],
      build: {
        lib: {
          entry: resolve(__dirname, 'component/index.ts'),
          name: 'ITL3D',
          fileName: (format) => `index.${format === 'es' ? 'mjs' : 'js'}`,
          formats: ['es', 'cjs'],
        },
        rollupOptions: {
          external: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
          output: {
            globals: {
              react: 'React',
              'react-dom': 'ReactDOM',
              three: 'THREE',
              '@react-three/fiber': 'ReactThreeFiber',
              '@react-three/drei': 'Drei',
            },
          },
        },
        outDir: 'dist',
        emptyOutDir: true,
      },
      resolve: {
        dedupe: ['react', 'react-dom', '@react-three/fiber', '@react-three/drei'],
      },
    }
  }

  // 开发模式配置
  return {
    plugins: [react()],
    resolve: {
      dedupe: ['react', 'react-dom', '@react-three/fiber', '@react-three/drei'],
      alias: {
        react: resolve(__dirname, 'node_modules/react'),
        'react-dom': resolve(__dirname, 'node_modules/react-dom'),
        'react/jsx-runtime': resolve(__dirname, 'node_modules/react/jsx-runtime.js'),
        'react/jsx-dev-runtime': resolve(__dirname, 'node_modules/react/jsx-dev-runtime.js'),
      },
    },
    server: {
      fs: {
        allow: [resolve(__dirname, '..')],
      },
    },
  }
})
