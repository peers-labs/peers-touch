import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url)) },
      { find: /^react\/jsx-runtime$/, replacement: fileURLToPath(new URL('./node_modules/react/jsx-runtime.js', import.meta.url)) },
      { find: /^react\/jsx-dev-runtime$/, replacement: fileURLToPath(new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url)) },
      { find: /^lucide-react$/, replacement: fileURLToPath(new URL('./node_modules/lucide-react/dist/esm/lucide-react.js', import.meta.url)) },
      { find: '@peers-touch/prototype-agent-canvas', replacement: fileURLToPath(new URL('../agent-canvas/src/AgentCanvasPage.tsx', import.meta.url)) },
      { find: '@peers-touch/prototype-desktop-atelier', replacement: fileURLToPath(new URL('../desktop/applets/atelier/src/Page.tsx', import.meta.url)) },
      { find: '@peers-touch/prototype-desktop-shell', replacement: fileURLToPath(new URL('../desktop/shell/src/Shell.tsx', import.meta.url)) },
    ],
  },
  server: {
    port: Number(process.env.VITE_PROTOTYPE_PORT ?? 3200),
    strictPort: false,
  },
});
