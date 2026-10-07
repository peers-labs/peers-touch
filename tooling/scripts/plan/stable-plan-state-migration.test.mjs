import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  developmentWorkLedgerPath,
  machineDevRoot,
} from '../lib/machine-dev-paths.mjs';
import { readLedger } from '../local-dev/dev-work-ledger.mjs';
import { digestDeclaration } from '../local-dev/dev-work-schema.mjs';
import { atomicReplaceFile } from './plan-package.mjs';
import {
  StablePlanMigrationError,
  migrateStablePlanState,
} from './stable-plan-state-migration.mjs';

function scope(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'stable-plan-migration-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return {
    home,
    workspaceId: '0123456789abcdef',
    foreignWorkspaceId: 'fedcba9876543210',
    workFile: developmentWorkLedgerPath(home),
    mountFile: path.join(machineDevRoot(home), 'plan-mounts', 'ledger.json'),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function digestRecord(value) {
  const unsigned = { ...value };
  delete unsigned.recordDigest;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function legacyDeclaration(
  state = 'RELEASED',
  workspaceId = '0123456789abcdef',
  workItemId = 'task',
) {
  const declaration = {
    declarationId: `${workItemId}-${workspaceId}`,
    workItemId,
    sessionId: 'session',
    workspaceId,
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
    declarationDigest: null,
  };
  declaration.declarationDigest = digestDeclaration(declaration);
  return declaration;
}

function legacyMountLedger(overrides = {}) {
  const ledger = {
    kind: 'peers-touch-plan-mount-ledger',
    revision: 3,
    liveMountsByWorkspace: {},
    liveMountsByPlanVersion: {},
    runsByMount: {},
    recordDigest: null,
    ...overrides,
  };
  ledger.recordDigest = digestRecord(ledger);
  return ledger;
}

test('migrates the selected idle workspace and finalizes an empty mount ledger', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration();
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  writeJson(fixture.mountFile, legacyMountLedger());

  const result = await migrateStablePlanState({
    home: fixture.home,
    workspaceId: fixture.workspaceId,
  });
  const migratedWork = readLedger(fixture.workFile);
  const migratedMount = JSON.parse(fs.readFileSync(fixture.mountFile, 'utf8'));

  assert.equal(result.migratedDeclarations, 1);
  assert.equal(result.migratedMountLedger, true);
  assert.equal(result.mountLedgerMode, 'stable');
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

test('foreign live work remains valid and does not block workspace migration', async (t) => {
  const fixture = scope(t);
  const own = legacyDeclaration();
  const foreign = legacyDeclaration(
    'ACTIVE',
    fixture.foreignWorkspaceId,
    'foreign-task',
  );
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: {
      [own.declarationId]: own,
      [foreign.declarationId]: foreign,
    },
  });
  writeJson(
    fixture.mountFile,
    legacyMountLedger({
      liveMountsByWorkspace: {
        [fixture.foreignWorkspaceId]: 'mount-foreign',
      },
      liveMountsByPlanVersion: {
        ['a'.repeat(64)]: 'mount-foreign',
      },
      runsByMount: {
        'mount-foreign': 'run-foreign',
      },
    }),
  );

  const result = await migrateStablePlanState({
    home: fixture.home,
    workspaceId: fixture.workspaceId,
  });
  const work = readLedger(fixture.workFile);
  const mounts = JSON.parse(fs.readFileSync(fixture.mountFile, 'utf8'));

  assert.equal(result.migratedDeclarations, 1);
  assert.equal(result.migratedMountLedger, true);
  assert.equal(result.mountLedgerMode, 'mixed');
  assert.deepEqual(work.declarations[foreign.declarationId], foreign);
  assert.equal(
    Object.hasOwn(work.declarations[own.declarationId], 'planVersionDigest'),
    false,
  );
  assert.deepEqual(mounts.liveMountsByWorkspace, {
    [fixture.foreignWorkspaceId]: 'mount-foreign',
  });
  assert.deepEqual(mounts.liveMountsByPlanVersion, {
    ['a'.repeat(64)]: 'mount-foreign',
  });
  assert.deepEqual(mounts.liveMountsByPlan, {});
});

test('migrates a selected live declaration without changing its lifecycle', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration('ACTIVE');
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });

  const result = await migrateStablePlanState({
    home: fixture.home,
    workspaceId: fixture.workspaceId,
  });
  const migrated = readLedger(fixture.workFile)
    .declarations[declaration.declarationId];

  assert.equal(result.migratedDeclarations, 1);
  assert.equal(migrated.state, 'ACTIVE');
  assert.equal(migrated.heartbeatAt, declaration.heartbeatAt);
  assert.equal(
    Object.hasOwn(migrated, 'planVersionDigest'),
    false,
  );
});

test('adopts a close-only envelope while the selected workspace has a legacy mount', async (t) => {
  const fixture = scope(t);
  writeJson(
    fixture.mountFile,
    legacyMountLedger({
      liveMountsByWorkspace: {
        [fixture.workspaceId]: 'mount-current',
      },
      liveMountsByPlanVersion: {
        ['a'.repeat(64)]: 'mount-current',
      },
      runsByMount: {
        'mount-current': 'run-current',
      },
    }),
  );

  const result = await migrateStablePlanState({
    home: fixture.home,
    workspaceId: fixture.workspaceId,
  });
  const mounts = JSON.parse(fs.readFileSync(fixture.mountFile, 'utf8'));

  assert.equal(result.migratedMountLedger, true);
  assert.equal(result.mountLedgerMode, 'mixed');
  assert.equal(
    mounts.liveMountsByWorkspace[fixture.workspaceId],
    'mount-current',
  );
  assert.equal(
    mounts.liveMountsByPlanVersion['a'.repeat(64)],
    'mount-current',
  );
  assert.deepEqual(mounts.liveMountsByPlan, {});
});

test('rejects a one-sided legacy Plan index before migration', async (t) => {
  const fixture = scope(t);
  writeJson(
    fixture.mountFile,
    legacyMountLedger({
      liveMountsByPlanVersion: {
        ['a'.repeat(64)]: 'mount-1',
      },
      runsByMount: {
        'mount-1': 'run-1',
      },
    }),
  );

  await assert.rejects(
    migrateStablePlanState({
      home: fixture.home,
      workspaceId: fixture.workspaceId,
    }),
    (error) =>
      error instanceof StablePlanMigrationError &&
      error.code === 'PLAN_STATE_MIGRATION_INVALID',
  );
});

test('validates legacy digests before rewriting either ledger', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration();
  declaration.purpose = 'tampered';
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  const mountLedger = legacyMountLedger();
  writeJson(fixture.mountFile, mountLedger);

  await assert.rejects(
    migrateStablePlanState({
      home: fixture.home,
      workspaceId: fixture.workspaceId,
    }),
    (error) =>
      error instanceof StablePlanMigrationError &&
      error.code === 'PLAN_STATE_MIGRATION_INVALID',
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fixture.mountFile, 'utf8')),
    mountLedger,
  );
});

test('rejects a tampered legacy mount ledger before rewriting declarations', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration();
  const workLedger = {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  };
  writeJson(fixture.workFile, workLedger);
  const mountLedger = legacyMountLedger();
  mountLedger.revision += 1;
  writeJson(fixture.mountFile, mountLedger);

  await assert.rejects(
    migrateStablePlanState({
      home: fixture.home,
      workspaceId: fixture.workspaceId,
    }),
    (error) =>
      error instanceof StablePlanMigrationError &&
      error.code === 'PLAN_STATE_MIGRATION_INVALID',
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fixture.workFile, 'utf8')),
    workLedger,
  );
});

test('retries after an interruption between the two ledger writes', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration();
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  writeJson(fixture.mountFile, legacyMountLedger());
  let writes = 0;

  await assert.rejects(
    migrateStablePlanState({
      home: fixture.home,
      workspaceId: fixture.workspaceId,
      async atomicReplaceFile(file, content, options) {
        writes += 1;
        if (writes === 2) throw new Error('simulated interruption');
        const current = fs.readFileSync(file, 'utf8');
        assert.equal(current, options.expectedContent);
        fs.writeFileSync(file, content);
      },
    }),
    /simulated interruption/,
  );

  const result = await migrateStablePlanState({
    home: fixture.home,
    workspaceId: fixture.workspaceId,
  });
  assert.equal(result.migratedDeclarations, 0);
  assert.equal(result.migratedMountLedger, true);
  assert.equal(
    Object.hasOwn(
      readLedger(fixture.workFile).declarations[declaration.declarationId],
      'planVersionDigest',
    ),
    false,
  );
});

test('stale writers cannot replace a concurrently changed global ledger', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration();
  const foreign = legacyDeclaration(
    'RELEASED',
    fixture.foreignWorkspaceId,
    'foreign-task',
  );
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  let raced = false;

  await assert.rejects(
    migrateStablePlanState({
      home: fixture.home,
      workspaceId: fixture.workspaceId,
      async atomicReplaceFile(file, content, options) {
        if (!raced && file === fixture.workFile) {
          raced = true;
          const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
          ledger.declarations[foreign.declarationId] = foreign;
          fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
        }
        return atomicReplaceFile(file, content, options);
      },
    }),
    (error) => error?.code === 'PLAN_CONCURRENT_MODIFICATION',
  );

  const persisted = JSON.parse(fs.readFileSync(fixture.workFile, 'utf8'));
  assert.deepEqual(persisted.declarations[foreign.declarationId], foreign);
  assert.equal(
    Object.hasOwn(
      persisted.declarations[declaration.declarationId],
      'planVersionDigest',
    ),
    true,
  );
});
