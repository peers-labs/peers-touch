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
      { find: /^antd$/, replacement: fileURLToPath(new URL('./node_modules/antd/es/index.js', import.meta.url)) },
      { find: /^@lobehub\/ui$/, replacement: fileURLToPath(new URL('./node_modules/@lobehub/ui/es/index.mjs', import.meta.url)) },
      { find: /^react-layout-kit$/, replacement: fileURLToPath(new URL('./node_modules/react-layout-kit/es/index.js', import.meta.url)) },
      { find: '@peers-touch/applet-sdk', replacement: fileURLToPath(new URL('../../../../applet-sdk/src/index.ts', import.meta.url)) },
      { find: '@peers-touch/applet-contract', replacement: fileURLToPath(new URL('../../../../applet-contract/src/index.ts', import.meta.url)) },
    ],
  },
  server: {
    port: 3102,
    strictPort: false,
  },
});
