import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // For GitHub Pages: set base to repo name, e.g. '/jousting-mvp/'
  // For root domain or Vercel/Netlify: use '/'
  base: './',
  build: {
    outDir: 'dist',
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/__test_tmp_*/**',
    ],
  },
})
