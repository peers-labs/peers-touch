import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const devServerPort = Number(process.env.VITE_DEV_SERVER_PORT ?? 5173);
const embeddedBuildIdentity = process.env.PT_MOBILE_BUILD_IDENTITY_JSON ?? null;
const buildIdentityAssetName = 'build-identity.json';

if (embeddedBuildIdentity !== null) {
  const parsedIdentity = JSON.parse(embeddedBuildIdentity) as unknown;
  if (JSON.stringify(parsedIdentity) !== embeddedBuildIdentity) {
    throw new Error('mobile.buildIdentity.nonCanonical');
  }
}

export default defineConfig({
  define: {
    __PEERS_MOBILE_BUILD_IDENTITY__: JSON.stringify(embeddedBuildIdentity),
  },
  plugins: [
    {
      name: 'peers-mobile-build-identity',
      apply: 'build',
      generateBundle() {
        if (embeddedBuildIdentity !== null) {
          this.emitFile({
            type: 'asset',
            fileName: buildIdentityAssetName,
            source: embeddedBuildIdentity,
          });
        }
      },
    },
    react(),
  ],
  server: {
    host: '0.0.0.0',
    port: devServerPort,
    strictPort: true,
  },
});
