import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.VITE_PROTOTYPE_PORT ?? 3200),
    strictPort: false,
  },
});
