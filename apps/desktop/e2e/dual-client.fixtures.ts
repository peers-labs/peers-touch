import {
  createTauriTest,
  type TauriTestConfig,
} from '@srsholmes/tauri-playwright';
import * as path from 'node:path';

function worktreeName(): string {
  const root = path.resolve(__dirname, '../../../..');
  return path.basename(root);
}

const localSocket = `/tmp/tauri-playwright-${worktreeName()}.sock`;
const peerSocket =
  process.env.PEER_SOCKET || `/tmp/tauri-playwright-peer.sock`;

const localConfig: TauriTestConfig = {
  mcpSocket: process.env.PLAYWRIGHT_SOCKET || localSocket,
};

const peerConfig: TauriTestConfig = {
  mcpSocket: peerSocket,
};

export const local = createTauriTest(localConfig);
export const peer = createTauriTest(peerConfig);

export const { test, expect } = local;
