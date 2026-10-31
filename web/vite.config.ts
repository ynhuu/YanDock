import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import packageInfo from './package.json' with { type: 'json' }

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageInfo.version),
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        ws: true,
        changeOrigin: false,
      },
    },
  },
  test: { include: ['src/**/*.test.ts'] },
})
