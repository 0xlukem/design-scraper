/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

export default defineConfig(({ mode, isPreview }) => {
  let builtApi: string | undefined
  if (isPreview) {
    try {
      builtApi = readFileSync(new URL('./dist/_headers', import.meta.url), 'utf8').match(/connect-src 'self' (https:\/\/[^;\s]+);/)?.[1]
    } catch { /* Vite reports a missing build before serving the preview. */ }
  }
  const api = process.env.VITE_API_URL || loadEnv(mode, process.cwd(), 'VITE_').VITE_API_URL || builtApi
  const publicApi = api && new URL(api).protocol === 'https:' && new URL(api).origin === api && !new URL(api).username ? api : undefined
  return {
    plugins: [react()],
    build: {
      rolldownOptions: {
        input: { landing: 'index.html', app: 'app/index.html', legacy: 'demo/index.html' },
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        }
      }
    },
    preview: {
      host: '127.0.0.1',
      // Only the public counter is proxied. No analysis or credential endpoints.
      proxy: publicApi ? { '^/api/quotas(?:\\?.*)?$': { target: publicApi, changeOrigin: true } } : {},
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./tests/setup.ts'],
      server: {
        hmr: false,
      },
    },
  }
})
