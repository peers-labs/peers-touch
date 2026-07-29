import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = dirname(fileURLToPath(import.meta.url));

function findUp(relativePath: string): string | null {
  let dir = configDir;
  while (true) {
    const candidate = join(dir, relativePath);
    if (existsSync(candidate)) return candidate;

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveWorkspaceDependency(packageKey: string, packageName: string, filePath: string): string {
  const direct = findUp(join('node_modules', packageName, filePath));
  if (direct) return direct;

  const pnpmStore = findUp('node_modules/.pnpm');
  if (!pnpmStore) {
    throw new Error(`Cannot resolve ${packageName}/${filePath}: node_modules/.pnpm not found`);
  }

  const entries = readdirSync(pnpmStore)
    .filter((entry) => entry.startsWith(packageKey))
    .sort()
    .reverse();

  for (const entry of entries) {
    const candidate = join(pnpmStore, entry, 'node_modules', packageName, filePath);
    if (existsSync(candidate)) return candidate;
  }

  throw new Error(`Cannot resolve ${packageName}/${filePath} from ${pnpmStore}`);
}

const reactIndex = resolveWorkspaceDependency('react@', 'react', 'index.js');
const reactJsxRuntime = resolveWorkspaceDependency('react@', 'react', 'jsx-runtime.js');
const reactJsxDevRuntime = resolveWorkspaceDependency('react@', 'react', 'jsx-dev-runtime.js');
const reactDomIndex = resolveWorkspaceDependency('react-dom@', 'react-dom', 'index.js');
const reactDomClient = resolveWorkspaceDependency('react-dom@', 'react-dom', 'client.js');
const lucideReact = resolveWorkspaceDependency('lucide-react@', 'lucide-react', 'dist/esm/lucide-react.js');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^react$/, replacement: reactIndex },
      { find: /^react\/jsx-runtime$/, replacement: reactJsxRuntime },
      { find: /^react\/jsx-dev-runtime$/, replacement: reactJsxDevRuntime },
      { find: /^react-dom$/, replacement: reactDomIndex },
      { find: /^react-dom\/client$/, replacement: reactDomClient },
      { find: /^lucide-react$/, replacement: lucideReact },
    ],
  },
  server: { port: 3108, strictPort: false },
});
