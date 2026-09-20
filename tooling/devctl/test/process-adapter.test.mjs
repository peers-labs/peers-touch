import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DevctlError, ERROR_CODES } from '../errors.mjs';
import {
  inspectManagedProcess,
  inspectProcess,
  isPortListening,
  spawnManaged,
  stopManagedProcess,
} from '../process-adapter.mjs';
import { writeRuntimeState } from '../runtime-state.mjs';

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-process-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('spawns, identifies, and stops an owned process tree', async (t) => {
  const directory = temporaryDirectory(t);
  const marker = `devctl-owned-${Date.now()}`;
  const record = spawnManaged({
    stateDirectory: directory,
    service: 'fixture',
    profile: 'test',
    worktreeId: 'fixture',
    command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)', marker],
    cwd: directory,
    environment: process.env,
    logPath: path.join(directory, 'fixture.log'),
    identityTokens: [marker],
  });
  t.after(() => {
    if (inspectProcess(record.pid)) {
      try {
        stopManagedProcess(directory, 'fixture');
      } catch {
        // The assertion below reports ownership failures.
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(inspectManagedProcess(directory, 'fixture').status, 'running');
  assert.equal(stopManagedProcess(directory, 'fixture').status, 'stopped');
  assert.equal(inspectProcess(record.pid), undefined);
});

test('refuses to stop a live process with mismatched identity', (t) => {
  const directory = temporaryDirectory(t);
  writeRuntimeState(directory, {
    service: 'foreign',
    profile: 'test',
    worktreeId: 'fixture',
    pid: process.pid,
    command: process.execPath,
    args: [],
    commandFingerprint: 'foreign',
    identityTokens: ['definitely-not-in-this-command-line'],
    ports: [],
    startedAt: new Date().toISOString(),
    logPath: path.join(directory, 'foreign.log'),
  });

  assert.throws(
    () => stopManagedProcess(directory, 'foreign'),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
  );
  assert.ok(inspectProcess(process.pid));
});

test('reports an unused local port as not listening', async () => {
  assert.equal(await isPortListening(9), false);
});
