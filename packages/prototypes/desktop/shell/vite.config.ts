import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(new URL('../../../..', import.meta.url)),
  encoding: 'utf8',
}).trim();

export default defineConfig({
  plugins: [react()],
  define: { __PT_PROTOTYPE_SOURCE_COMMIT__: JSON.stringify(sourceCommit) },
  resolve: {
    alias: [
      { find: /^react$/, replacement: fileURLToPath(new URL('./node_modules/react/index.js', import.meta.url)) },
      { find: /^react\/jsx-runtime$/, replacement: fileURLToPath(new URL('./node_modules/react/jsx-runtime.js', import.meta.url)) },
      { find: /^react\/jsx-dev-runtime$/, replacement: fileURLToPath(new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url)) },
      { find: /^lucide-react$/, replacement: fileURLToPath(new URL('./node_modules/lucide-react/dist/esm/lucide-react.js', import.meta.url)) },
      { find: /^antd$/, replacement: fileURLToPath(new URL('./node_modules/antd/es/index.js', import.meta.url)) },
      { find: /^@lobehub\/ui$/, replacement: fileURLToPath(new URL('./node_modules/@lobehub/ui/es/index.mjs', import.meta.url)) },
      { find: /^@lobehub\/icons$/, replacement: fileURLToPath(new URL('./node_modules/@lobehub/icons/es/index.js', import.meta.url)) },
      { find: /^react-layout-kit$/, replacement: fileURLToPath(new URL('./node_modules/react-layout-kit/es/index.js', import.meta.url)) },
    ],
  },
  server: {
    port: 3105,
    strictPort: false,
  },
});
