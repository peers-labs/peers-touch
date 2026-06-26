import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devServerPort = Number(process.env.VITE_DEV_SERVER_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: devServerPort,
    strictPort: true,
  },
});
