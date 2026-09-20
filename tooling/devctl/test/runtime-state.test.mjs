import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DevctlError, ERROR_CODES } from '../errors.mjs';
import {
  readRuntimeState,
  removeRuntimeState,
  stateFile,
  writeRuntimeState,
} from '../runtime-state.mjs';

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devctl-state-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function record() {
  return {
    service: 'fixture',
    profile: 'test',
    worktreeId: 'fixture-root',
    pid: process.pid,
    command: process.execPath,
    args: [],
    commandFingerprint: 'fixture',
    identityTokens: ['node'],
    ports: [],
    startedAt: new Date().toISOString(),
    logPath: 'fixture.log',
  };
}

test('writes, reads, and removes an atomic runtime record', (t) => {
  const directory = temporaryDirectory(t);

  writeRuntimeState(directory, record());
  assert.equal(readRuntimeState(directory, 'fixture').schemaVersion, 1);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    [],
  );

  removeRuntimeState(directory, 'fixture');
  assert.equal(fs.existsSync(stateFile(directory, 'fixture')), false);
});

test('rejects malformed runtime state', (t) => {
  const directory = temporaryDirectory(t);
  fs.writeFileSync(stateFile(directory, 'fixture'), '{"schemaVersion":0}');

  assert.throws(
    () => readRuntimeState(directory, 'fixture'),
    (error) =>
      error instanceof DevctlError
      && error.code === ERROR_CODES.PROCESS_IDENTITY_MISMATCH,
  );
});
