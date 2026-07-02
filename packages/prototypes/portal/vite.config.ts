import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';

const REGISTRY_DIR = join(process.env.TMPDIR ?? tmpdir(), 'peers-touch-prototype-portals');

type PortalRecord = {
  ref: string;
  branch: string;
  worktreePath: string;
  port: number;
  url: string;
  pid: number;
  updatedAt: number;
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readRegistry(): PortalRecord[] {
  let files: string[] = [];
  try {
    files = readdirSync(REGISTRY_DIR).filter((name) => name.endsWith('.json'));
  } catch {
    return [];
  }
  const records: PortalRecord[] = [];
  for (const file of files) {
    const path = join(REGISTRY_DIR, file);
    try {
      const record = JSON.parse(readFileSync(path, 'utf8')) as PortalRecord;
      if (pidAlive(record.pid)) {
        records.push(record);
      } else {
        rmSync(path, { force: true });
      }
    } catch {
      rmSync(path, { force: true });
    }
  }
  return records;
}

/**
 * Self-registers this running portal into a shared registry and serves a
 * discovery endpoint so the portal UI can switch between the worktrees that
 * actually have a portal running right now. One portal per worktree; other
 * worktrees are previewed via iframe (never imported).
 */
function prototypeRegistryPlugin(): Plugin {
  const branch = process.env.VITE_PROTOTYPE_BRANCH ?? 'current';
  const worktreePath = process.env.VITE_PROTOTYPE_WORKTREE_PATH ?? process.cwd();
  const ref = createHash('sha256').update(worktreePath).digest('hex').slice(0, 16);
  const recordPath = join(REGISTRY_DIR, `${ref}.json`);
  let registered = false;

  const unregister = () => {
    if (registered) {
      rmSync(recordPath, { force: true });
      registered = false;
    }
  };

  return {
    name: 'prototype-worktree-registry',
    configureServer(server) {
      server.middlewares.use('/__prototype/worktrees', (_req, res) => {
        const records = readRegistry();
        const payload = records
          .map((record) => ({
            ref: record.ref,
            branch: record.branch,
            worktreePath: record.worktreePath,
            portalUrl: record.url,
            self: record.pid === process.pid,
          }))
          .sort((a, b) => (a.self === b.self ? a.branch.localeCompare(b.branch) : a.self ? -1 : 1));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(payload));
      });

      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address() as AddressInfo | null;
        if (!address) {
          return;
        }
        const record: PortalRecord = {
          ref,
          branch,
          worktreePath,
          port: address.port,
          url: `http://localhost:${address.port}/`,
          pid: process.pid,
          updatedAt: Date.now(),
        };
        mkdirSync(REGISTRY_DIR, { recursive: true });
        writeFileSync(recordPath, JSON.stringify(record));
        registered = true;
      });

      const cleanup = () => unregister();
      server.httpServer?.once('close', cleanup);
      process.once('exit', cleanup);
      process.once('SIGINT', () => {
        cleanup();
        process.exit(0);
      });
      process.once('SIGTERM', () => {
        cleanup();
        process.exit(0);
      });
    },
    closeBundle: unregister,
  };
}

export default defineConfig({
  plugins: [react(), prototypeRegistryPlugin()],
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
