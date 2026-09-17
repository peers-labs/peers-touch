import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^react$/,
        replacement: fileURLToPath(
          new URL('./node_modules/react/index.js', import.meta.url),
        ),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: fileURLToPath(
          new URL('./node_modules/react/jsx-runtime.js', import.meta.url),
        ),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: fileURLToPath(
          new URL('./node_modules/react/jsx-dev-runtime.js', import.meta.url),
        ),
      },
      {
        find: /^react-dom$/,
        replacement: fileURLToPath(
          new URL('./node_modules/react-dom/index.js', import.meta.url),
        ),
      },
      {
        find: /^antd$/,
        replacement: fileURLToPath(
          new URL('./node_modules/antd/es/index.js', import.meta.url),
        ),
      },
      {
        find: /^@lobehub\/ui$/,
        replacement: fileURLToPath(
          new URL('./node_modules/@lobehub/ui/es/index.mjs', import.meta.url),
        ),
      },
      {
        find: /^@lobehub\/icons$/,
        replacement: fileURLToPath(
          new URL('./node_modules/@lobehub/icons/es/index.js', import.meta.url),
        ),
      },
      {
        find: /^react-layout-kit$/,
        replacement: fileURLToPath(
          new URL('./node_modules/react-layout-kit/es/index.js', import.meta.url),
        ),
      },
      {
        find: /^lucide-react$/,
        replacement: fileURLToPath(
          new URL(
            './node_modules/lucide-react/dist/esm/lucide-react.js',
            import.meta.url,
          ),
        ),
      },
    ],
  },
  server: { port: 3107, strictPort: false },
});
