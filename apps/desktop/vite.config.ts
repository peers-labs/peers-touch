import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import { cpSync, existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const configDir = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

function appletDistPlugin() {
  const sourceDir = path.resolve(configDir, 'applets-dist')
  const targetDir = path.resolve(configDir, 'dist/applets-dist')
  const lynxClientPath = require.resolve('@lynx-js/web-core/client.prod.js')
  const lynxStaticSourceDir = path.resolve(path.dirname(lynxClientPath), '..')
  const lynxStaticTargetDir = path.resolve(configDir, 'dist/lynx-web-core/static')
  return {
    name: 'peers-touch-applet-dist',
    closeBundle() {
      if (!existsSync(path.join(sourceDir, 'index.json'))) {
        throw new Error('apps/desktop/applets-dist/index.json is missing; run pnpm applets:build before Desktop packaging')
      }
      rmSync(targetDir, { recursive: true, force: true })
      cpSync(sourceDir, targetDir, { recursive: true })
      rmSync(lynxStaticTargetDir, { recursive: true, force: true })
      cpSync(lynxStaticSourceDir, lynxStaticTargetDir, { recursive: true })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), wasm(), appletDistPlugin()],
  base: './',
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    port: 3210,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.PEERS_STATION_URL || 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
      '/sub-agent': {
        target: process.env.PEERS_STATION_URL || 'http://127.0.0.1:18080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined

          if (
            id.includes('/mermaid/') ||
            id.includes('/@mermaid-js/') ||
            id.includes('/cytoscape/') ||
            id.includes('/dagre-d3-es/')
          ) {
            return 'viz-markdown'
          }

          if (id.includes('/@shikijs/') || id.includes('/shiki/')) {
            return 'syntax-markdown'
          }

          if (
            id.includes('/react-markdown/') ||
            id.includes('/remark-') ||
            id.includes('/rehype-') ||
            id.includes('/hast-util-') ||
            id.includes('/mdast-util-') ||
            id.includes('/micromark')
          ) {
            return 'markdown-core'
          }

          if (id.includes('/antd/') || id.includes('/@ant-design/')) {
            return 'antd'
          }

          return undefined
        },
      },
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['tiktoken', '@lynx-js/web-core', '@lynx-js/web-elements'],
  },
})
