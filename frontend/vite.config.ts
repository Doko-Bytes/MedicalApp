import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

// The browser only ever talks to this origin: /api and /media are proxied to
// Django, so the session and CSRF cookies are first-party and there is no CORS
// anywhere. VITE_API_TARGET points at the container when run under compose.
const target = process.env.VITE_API_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': { target, changeOrigin: false },
      '/media': { target, changeOrigin: false },
    },
  },
})
