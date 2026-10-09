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
import {
  digestExecutionRun,
  executionRunPaths,
  executionSnapshotPath,
  planMountRecordPath,
  resolvePlanMountByIdentity,
} from './plan-mount.mjs';
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
    workFile: developmentWorkLedgerPath(home),
    mountFile: path.join(machineDevRoot(home), 'plan-mounts', 'ledger.json'),
  };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
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

function digestRecord(value) {
  const unsigned = { ...value };
  delete unsigned.recordDigest;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

function planIndexKey(projectId, planId) {
  return crypto
    .createHash('sha256')
    .update(`${projectId}\0${planId}`)
    .digest('hex');
}

function legacyDeclaration(overrides = {}) {
  const declaration = {
    declarationId: 'legacy-task-0123456789abcdef',
    workItemId: 'legacy-task',
    sessionId: 'session',
    workspaceId: '0123456789abcdef',
    branch: 'test',
    sourceHead: 'a'.repeat(40),
    owner: 'test@example.invalid',
    purpose: 'test migration',
    journeyId: null,
    state: 'ACTIVE',
    createdAt: '2026-10-06T00:00:00.000Z',
    heartbeatAt: '2026-10-06T00:00:00.000Z',
    expiresAt: '2026-10-07T00:00:00.000Z',
    sourceClaims: [{ pathPrefix: 'docs', mode: 'exclusive-write' }],
    runtimeClaims: [],
    planPath: 'docs/legacy-plan.md',
    planId: 'legacy-plan',
    planVersionDigest: 'b'.repeat(64),
    mountId: 'mount-legacy',
    runId: 'run-legacy',
    taskId: 'LEGACY-TASK',
    declarationDigest: null,
    ...overrides,
  };
  declaration.declarationDigest = digestDeclaration(declaration);
  return declaration;
}

function legacyMount() {
  const record = {
    kind: 'peers-touch-plan-mount',
    mountId: 'mount-legacy',
    projectId: 'peers-touch',
    planId: 'legacy-plan',
    planVersionId: 'legacy-plan-v1',
    planVersionDigest: 'b'.repeat(64),
    planPath: 'docs/legacy-plan.md',
    workspaceId: '0123456789abcdef',
    canonicalRoot: '/tmp/legacy-worktree',
    state: 'mounted',
    mountedAt: '2026-10-06T00:00:00.000Z',
    mountedBy: 'test@example.invalid',
    releasedAt: null,
    releaseReason: null,
    recordDigest: null,
  };
  record.recordDigest = digestRecord(record);
  return record;
}

function legacySnapshot() {
  const snapshot = {
    kind: 'peers-touch-execution-plan-snapshot',
    snapshotId: 'snapshot-legacy',
    capturedAt: '2026-10-06T00:00:00.000Z',
    planId: 'legacy-plan',
    planVersionId: 'legacy-plan-v1',
    planVersionDigest: 'b'.repeat(64),
    planPath: 'docs/legacy-plan.md',
    plan: {
      kind: 'peers-touch-plan-version',
      planId: 'legacy-plan',
      versionId: 'legacy-plan-v1',
      createdAt: '2026-10-06T00:00:00.000Z',
      workClass: 'product-behavior',
      architecture: { sources: ['docs/design.md'], decisions: ['D-1'] },
      scope: {
        sourceClaims: [
          { pathPrefix: 'docs', mode: 'exclusive-write' },
        ],
        nonGoals: [],
      },
      tasks: [
        {
          id: 'LEGACY-TASK',
          workstreamId: 'LEGACY',
          path: 'tasks/LEGACY-TASK.md',
          dependsOn: [],
        },
      ],
      authorization: {
        checkpoint: { localCommit: 'allowed', amend: 'denied' },
        delivery: { push: 'denied', pullRequest: 'denied' },
      },
    },
    tasks: [
      {
        taskId: 'LEGACY-TASK',
        closureId: 'legacy-closure',
      },
    ],
    acceptance: {
      closures: { 'legacy-closure': [] },
    },
    executionBinding: {
      mountId: 'mount-legacy',
      workspaceId: '0123456789abcdef',
      canonicalRoot: '/tmp/legacy-worktree',
      branch: 'test',
      initialHead: 'a'.repeat(40),
    },
    recordDigest: null,
  };
  snapshot.recordDigest = digestRecord(snapshot);
  return snapshot;
}

function legacyRun(snapshot) {
  const run = {
    kind: 'peers-touch-execution-run',
    runId: 'run-legacy',
    snapshotId: snapshot.snapshotId,
    snapshotDigest: snapshot.recordDigest,
    mountId: 'mount-legacy',
    state: 'active',
    taskStates: {
      'LEGACY-TASK': { state: 'in_progress', blocker: null },
    },
    exhaustion: null,
    currentTaskId: 'LEGACY-TASK',
    updatedAt: '2026-10-06T00:00:00.000Z',
    revision: 1,
    recordDigest: null,
  };
  run.recordDigest = digestExecutionRun(run);
  return run;
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

function writeLegacyLiveState(fixture, options = {}) {
  const declaration = legacyDeclaration();
  const mount = legacyMount();
  const snapshot = legacySnapshot();
  const run = legacyRun(snapshot);
  const workLedger = {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  };
  const mountLedger = legacyMountLedger({
    liveMountsByWorkspace: {
      [mount.workspaceId]: mount.mountId,
    },
    liveMountsByPlanVersion: {
      [mount.planVersionDigest]: mount.mountId,
    },
    ...(options.mixed === true
      ? {
          liveMountsByPlan: {
            [planIndexKey(mount.projectId, mount.planId)]: mount.mountId,
          },
        }
      : {}),
    runsByMount: {
      [mount.mountId]: run.runId,
    },
  });
  writeJson(fixture.workFile, workLedger);
  writeJson(fixture.mountFile, mountLedger);
  writeJson(planMountRecordPath(mount.mountId, { home: fixture.home }), mount);
  const runPaths = executionRunPaths(run.runId, {
    home: fixture.home,
    workspaceId: mount.workspaceId,
  });
  writeJson(runPaths.run, run);
  const legacySnapshotFile = path.join(
    runPaths.root,
    'execution-plan-snapshot.json',
  );
  writeJson(legacySnapshotFile, snapshot);
  return {
    declaration,
    mount,
    snapshot,
    run,
    workLedger,
    mountLedger,
    runPaths,
    legacySnapshotFile,
  };
}

test('migrates idle declaration and mount ledgers without dual-read state', async (t) => {
  const fixture = scope(t);
  const declaration = legacyDeclaration({
    state: 'RELEASED',
    planPath: null,
    planId: null,
    planVersionDigest: null,
    mountId: null,
    runId: null,
    taskId: null,
  });
  writeJson(fixture.workFile, {
    schemaVersion: 1,
    kind: 'peers-touch-development-work-ledger',
    updatedAt: '2026-10-06T00:00:00.000Z',
    declarations: { [declaration.declarationId]: declaration },
  });
  writeJson(fixture.mountFile, legacyMountLedger());

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

test('migrates live declarations, mounts, snapshots, runs, and mixed indexes', async (t) => {
  const fixture = scope(t);
  const state = writeLegacyLiveState(fixture, { mixed: true });

  const result = await migrateStablePlanState({ home: fixture.home });
  const resolved = resolvePlanMountByIdentity({
    home: fixture.home,
    workspaceId: state.mount.workspaceId,
  });
  const migratedWork = readLedger(fixture.workFile);
  const migratedDeclaration =
    migratedWork.declarations[state.declaration.declarationId];
  const migratedMount = JSON.parse(
    fs.readFileSync(
      planMountRecordPath(state.mount.mountId, { home: fixture.home }),
      'utf8',
    ),
  );
  const migratedLedger = JSON.parse(
    fs.readFileSync(fixture.mountFile, 'utf8'),
  );
  const stableSnapshotFile = executionSnapshotPath(
    state.run.runId,
    state.snapshot.snapshotId,
    {
      home: fixture.home,
      workspaceId: state.mount.workspaceId,
    },
  );

  assert.equal(result.migratedDeclarations, 1);
  assert.equal(result.migratedMountRecords, 1);
  assert.equal(result.migratedSnapshots, 1);
  assert.equal(result.migratedRuns, 1);
  assert.equal(result.removedLegacySnapshots, 1);
  assert.equal(result.migratedMountLedger, true);
  assert.equal(fs.existsSync(state.legacySnapshotFile), false);
  assert.equal(fs.existsSync(stableSnapshotFile), true);
  assert.equal(Object.hasOwn(migratedMount, 'planVersionId'), false);
  assert.equal(Object.hasOwn(migratedMount, 'planVersionDigest'), false);
  assert.equal(
    Object.hasOwn(migratedDeclaration, 'planVersionDigest'),
    false,
  );
  assert.equal(migratedDeclaration.planDigest, resolved.snapshot.planDigest);
  assert.equal(
    migratedLedger.liveMountsByPlan[
      planIndexKey(state.mount.projectId, state.mount.planId)
    ],
    state.mount.mountId,
  );
  assert.equal(
    Object.hasOwn(migratedLedger, 'liveMountsByPlanVersion'),
    false,
  );
  assert.equal(resolved.run.snapshotDigest, resolved.snapshot.recordDigest);
  assert.equal(resolved.snapshot.plan.kind, 'peers-touch-plan');
  assert.equal(resolved.snapshot.plan.amendments.length, 0);

  assert.deepEqual(
    await migrateStablePlanState({ home: fixture.home }),
    {
      ok: true,
      migratedDeclarations: 0,
      migratedMountRecords: 0,
      migratedSnapshots: 0,
      migratedRuns: 0,
      removedLegacySnapshots: 0,
      migratedMountLedger: false,
    },
  );
});

test('rejects tampered input before rewriting either ledger', async (t) => {
  const fixture = scope(t);
  const state = writeLegacyLiveState(fixture);
  const tamperedMount = JSON.parse(
    fs.readFileSync(
      planMountRecordPath(state.mount.mountId, { home: fixture.home }),
      'utf8',
    ),
  );
  tamperedMount.planId = 'tampered';
  writeJson(
    planMountRecordPath(state.mount.mountId, { home: fixture.home }),
    tamperedMount,
  );

  await assert.rejects(
    migrateStablePlanState({ home: fixture.home }),
    (error) =>
      error instanceof StablePlanMigrationError &&
      error.code === 'PLAN_STATE_MIGRATION_INVALID',
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fixture.workFile, 'utf8')),
    state.workLedger,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fixture.mountFile, 'utf8')),
    state.mountLedger,
  );
});

test('retries after interruption while live state is partially migrated', async (t) => {
  const fixture = scope(t);
  const state = writeLegacyLiveState(fixture);
  let writes = 0;

  await assert.rejects(
    migrateStablePlanState({
      home: fixture.home,
      async atomicReplaceFile(file, content, options) {
        writes += 1;
        if (writes === 2) throw new Error('simulated interruption');
        await atomicReplaceFile(file, content, options);
      },
    }),
    /simulated interruption/,
  );
  assert.equal(fs.existsSync(state.legacySnapshotFile), true);

  const result = await migrateStablePlanState({ home: fixture.home });
  assert.equal(result.migratedSnapshots, 0);
  assert.equal(result.migratedRuns, 1);
  assert.equal(result.removedLegacySnapshots, 1);
  assert.equal(
    resolvePlanMountByIdentity({
      home: fixture.home,
      workspaceId: state.mount.workspaceId,
    }).run.snapshotId,
    state.snapshot.snapshotId,
  );
});
