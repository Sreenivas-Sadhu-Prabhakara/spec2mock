import { defineConfig } from 'vite'

// Relative base so the built site works under any GitHub Pages project subpath
// (e.g. https://user.github.io/spec2mock/) without hardcoding the repo name.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
})
