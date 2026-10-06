import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { developmentWorkLedgerPath, machineDevRoot } from '../lib/machine-dev-paths.mjs';
import { readLedger } from '../local-dev/dev-work-ledger.mjs';
import {
  StablePlanMigrationError,
  migrateStablePlanState,
} from './stable-plan-state-migration.mjs';

function scope(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-plan-migration-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return {
    home,
    workFile: developmentWorkLedgerPath(home),
    mountFile: path.join(machineDevRoot(home), 'plan-mounts', 'ledger.json'),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function legacyDeclaration(state = 'RELEASED') {
  return {
    declarationId: 'task-0123456789abcdef',
    workItemId: 'task',
    sessionId: 'session',
    workspaceId: '0123456789abcdef',
    branch: 'test',
    sourceHead: 'a'.repeat(40),
    owner: 'test@example.invalid',
    purpose: 'test migration',
    journeyId: null,
    state,
    createdAt: '2026-10-06T00:00:00.000Z',
    heartbeatAt: '2026-10-06T00:00:00.000Z',
    expiresAt: '2026-10-06T01:00:00.000Z',
    sourceClaims: [{ pathPrefix: 'docs', mode: 'exclusive-write' }],
    runtimeClaims: [],
    planPath: null,
    planId: null,
    planVersionDigest: null,
    mountId: null,
    runId: null,
    taskId: null,
    declarationDigest: 'legacy',
  };
}

test('migrates idle declaration and mount ledgers without dual-read state', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration();
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  writeJson(fixture.mountFile, {
    kind: 'peers-touch-plan-mount-ledger',
    revision: 3,
    liveMountsByWorkspace: {},
    liveMountsByPlanVersion: {},
    runsByMount: {},
    recordDigest: 'legacy',
  });

  const result = await migrateStablePlanState({ home: fixture.home });
  const migratedWork = readLedger(fixture.workFile);
  const migratedMount = JSON.parse(fs.readFileSync(fixture.mountFile, 'utf8'));

  assert.equal(result.migratedDeclarations, 1);
  assert.equal(result.migratedMountLedger, true);
  assert.equal(
    Object.hasOwn(
      migratedWork.declarations[declaration.declarationId],
      'planVersionDigest',
    ),
    false,
  );
  assert.equal(
    migratedWork.declarations[declaration.declarationId].planDigest,
    null,
  );
  assert.deepEqual(migratedMount.liveMountsByPlan, {});
  assert.equal(Object.hasOwn(migratedMount, 'liveMountsByPlanVersion'), false);
});

test('rejects migration while any declaration or Plan mount is live', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration('ACTIVE');
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  writeJson(fixture.mountFile, {
    kind: 'peers-touch-plan-mount-ledger',
    revision: 3,
    liveMountsByWorkspace: {
      '0123456789abcdef': 'mount-1',
    },
    liveMountsByPlanVersion: {
      ['a'.repeat(64)]: 'mount-1',
    },
    runsByMount: {
      'mount-1': 'run-1',
    },
    recordDigest: 'legacy',
  });

  await assert.rejects(
    migrateStablePlanState({ home: fixture.home }),
    (error) =>
      error instanceof StablePlanMigrationError &&
      error.code === 'PLAN_STATE_MIGRATION_REQUIRES_IDLE',
  );
});
