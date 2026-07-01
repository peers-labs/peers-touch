import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@peers-touch/applet-sdk': new URL('../../../../applet-sdk/src/index.ts', import.meta.url).pathname,
      '@peers-touch/applet-contract': new URL('../../../../applet-contract/src/index.ts', import.meta.url).pathname,
    },
  },
  server: {
    port: 3102,
    strictPort: false,
  },
});
