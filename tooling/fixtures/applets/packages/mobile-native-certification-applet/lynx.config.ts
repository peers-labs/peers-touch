import path from 'node:path';
import { defineConfig } from '@lynx-js/rspeedy';
import { pluginReactLynx } from '@lynx-js/react-rsbuild-plugin';

const repoRoot = process.env.PT_REPO_ROOT;
if (!repoRoot) throw new Error('PT_REPO_ROOT is required for Applet fixture builds');

export default defineConfig({
  resolve: { alias: { '@peers-touch/applet-sdk': path.join(repoRoot, 'packages/applet-sdk/dist/index.js') } },
  plugins: [pluginReactLynx()],
  environments: {
    web: {},
  },
  source: {
    entry: './src/index.tsx',
  },
  output: {
    distPath: {
      root: './dist',
    },
    filename: 'main.lynx.bundle',
    filenameHash: false,
  },
});
