#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const evidenceDir = path.join(repoRoot, 'tooling/acceptance/evidence/applets', 'official-applet');
const evidencePath = path.join(evidenceDir, 'note-reload-persistence-gate.json');

function startGateServer() {
  return new Promise((resolve, reject) => {
    const child = spawn('go', ['run', './subserver/official_applets/note_gate_server'], {
      cwd: path.join(repoRoot, 'apps', 'station', 'app'),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateProcessGroup(child);
      reject(new Error('Timed out waiting for Note reload persistence gate server'));
    }, Number(process.env.PEERS_NOTE_RELOAD_PERSISTENCE_GATE_STARTUP_TIMEOUT_MS ?? 60_000));

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const line = stdout.split(/\r?\n/).find((candidate) => candidate.trim().startsWith('{'));
      if (!line || settled) return;
      try {
        const ready = JSON.parse(line);
        if (!ready.baseUrl || !ready.token) {
          throw new Error('ready payload must include baseUrl and token');
        }
        settled = true;
        clearTimeout(timeout);
        resolve({ child, ready });
      } catch (error) {
        settled = true;
        clearTimeout(timeout);
        terminateProcessGroup(child);
        reject(error);
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`Note gate server exited before readiness with ${code}: ${stderr}`));
    });
  });
}

function terminateProcessGroup(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function stopGateServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) {
      resolve();
      return;
    }
    const timeout = setTimeout(resolve, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    terminateProcessGroup(child);
  });
}

async function requestNote(baseUrl, token, pathSuffix, options = {}) {
  const response = await fetch(`${baseUrl}/applets/note${pathSuffix}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Note request ${options.method ?? 'GET'} ${pathSuffix} failed with ${response.status}: ${text}`);
  }
  return body;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getItems(page) {
  return Array.isArray(page.items) ? page.items : [];
}

function findNote(page, noteId) {
  return getItems(page).find((note) => note.noteId === noteId);
}

async function runPersistenceFlow(baseUrl, token) {
  const marker = `reload-${Date.now()}`;
  const createTitle = `Reload Gate ${marker}`;
  const createContent = `Created content ${marker}`;
  const updatedTitle = `Reload Gate Updated ${marker}`;
  const updatedContent = `Updated content ${marker}`;

  const created = await requestNote(baseUrl, token, '/v1/notes', {
    method: 'POST',
    body: { title: createTitle, content: createContent },
  });
  const noteId = created.item?.noteId;
  assert(typeof noteId === 'string' && noteId.length > 0, 'create response must include item.noteId');
  assert(created.item.title === createTitle, 'create response title must match input');
  assert(created.item.content === createContent, 'create response content must match input');

  const listAfterCreate = await requestNote(baseUrl, token, '/v1/notes');
  assert(Boolean(findNote(listAfterCreate, noteId)), 'created note must survive list reload');

  const updated = await requestNote(baseUrl, token, `/v1/notes/${noteId}`, {
    method: 'PATCH',
    body: { title: updatedTitle, content: updatedContent },
  });
  assert(updated.item?.title === updatedTitle, 'update response title must match input');
  assert(updated.item?.content === updatedContent, 'update response content must match input');

  const listAfterUpdate = await requestNote(baseUrl, token, '/v1/notes');
  const reloadedUpdated = findNote(listAfterUpdate, noteId);
  assert(reloadedUpdated?.title === updatedTitle, 'updated title must survive list reload');
  assert(reloadedUpdated?.content === updatedContent, 'updated content must survive list reload');

  const searchAfterUpdate = await requestNote(baseUrl, token, `/v1/notes:search?q=${encodeURIComponent('Updated')}`);
  assert(Boolean(findNote(searchAfterUpdate, noteId)), 'updated note must be discoverable through search reload');

  await requestNote(baseUrl, token, `/v1/notes/${noteId}`, { method: 'DELETE' });
  const listAfterDelete = await requestNote(baseUrl, token, '/v1/notes');
  assert(!findNote(listAfterDelete, noteId), 'deleted note must be absent from normal list reload');

  const deletedList = await requestNote(baseUrl, token, '/v1/notes?include_deleted=true');
  const deletedNote = findNote(deletedList, noteId);
  assert(Boolean(deletedNote?.deletedAt), 'deleted note must appear with deletedAt when include_deleted=true');

  const restored = await requestNote(baseUrl, token, `/v1/notes/${noteId}:restore`, { method: 'POST' });
  assert(restored.item?.noteId === noteId, 'restore response must return the restored note');
  assert(!restored.item?.deletedAt, 'restore response must clear deletedAt');

  const listAfterRestore = await requestNote(baseUrl, token, '/v1/notes');
  const restoredNote = findNote(listAfterRestore, noteId);
  assert(restoredNote?.title === updatedTitle, 'restored note title must survive list reload');
  assert(restoredNote?.content === updatedContent, 'restored note content must survive list reload');

  return {
    noteId,
    marker,
    checks: [
      'create response includes persisted note',
      'created note survives list reload',
      'edit response includes updated note',
      'updated note survives list reload',
      'updated note is discoverable through search reload',
      'deleted note is absent from normal list reload',
      'deleted note is present with include_deleted reload',
      'restore response returns active note',
      'restored note survives list reload',
    ],
  };
}

function writeEvidence(report) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (report.status === 'PASS') {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
}

async function main() {
  const startedAt = new Date().toISOString();
  const server = await startGateServer();
  try {
    const flow = await runPersistenceFlow(server.ready.baseUrl, server.ready.token);
    writeEvidence({
      status: 'PASS',
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.note',
      service: 'note',
      productPath: 'Station-bundled Note service HTTP mapping -> SQLite/GORM persistence',
      command: 'pnpm applet:note-reload-persistence-gate',
      ...flow,
      startedAt,
      completedAt: new Date().toISOString(),
    });
  } finally {
    await stopGateServer(server.child);
  }
}

main().catch((error) => {
  writeEvidence({
    status: 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.note',
    service: 'note',
    error: String(error?.message ?? error),
    completedAt: new Date().toISOString(),
  });
  process.exit(1);
});
