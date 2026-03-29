import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const togglProxy = {
  target: 'https://api.track.toggl.com',
  changeOrigin: true,
  rewrite: (path: string) => path.replace(/^\/api\/toggl/, '/api'),
} as const

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/toggl': togglProxy,
    },
  },
  preview: {
    proxy: {
      '/api/toggl': togglProxy,
    },
  },
})
