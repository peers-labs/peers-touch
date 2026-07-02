import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@peers-touch/prototype-agent-canvas': fileURLToPath(new URL('../agent-canvas/src/AgentCanvasPage.tsx', import.meta.url)),
      '@peers-touch/prototype-desktop-atelier': fileURLToPath(new URL('../desktop/applets/atelier/src/Page.tsx', import.meta.url)),
      '@peers-touch/prototype-desktop-shell': fileURLToPath(new URL('../desktop/shell/src/Shell.tsx', import.meta.url)),
    },
  },
  server: {
    port: Number(process.env.VITE_PROTOTYPE_PORT ?? 3200),
    strictPort: false,
  },
});
