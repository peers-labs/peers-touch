#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  developmentWorkLockPath,
  isDirectInvocation,
} from '../lib/machine-dev-paths.mjs';
import {
  acquireDevelopmentWorkLedgerLock,
} from '../local-dev/dev-work-ledger.mjs';
import {
  LEDGER_KIND as DEVELOPMENT_LEDGER_KIND,
  SCHEMA_VERSION as DEVELOPMENT_SCHEMA_VERSION,
  digestDeclaration,
  validateDeclaration,
} from '../local-dev/dev-work-schema.mjs';
import {
  acquireWorkspaceLifecycleLock,
} from '../local-dev/workspace-lifecycle-lock.mjs';
import {
  atomicReplaceFile,
  digestNorthStar,
  digestPlan,
  digestPlanContent,
} from './plan-package.mjs';
import {
  PLAN_MOUNT_LEDGER_KIND,
  acquirePlanMountLedgerLock,
  digestExecutionRun,
  digestExecutionSnapshot,
  digestPlanMountRecord,
  executionRunPaths,
  executionSnapshotPath,
  planMountLedgerPath,
  planMountRecordPath,
  planMountRootPath,
  releasePlanMountLedgerLock,
  validateExecutionRun,
  validateExecutionSnapshot,
  validatePlanMountLedger,
  validatePlanMountRecord,
} from './plan-mount.mjs';

const SHA1 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WORK_LEDGER_KEYS = new Set([
  'schemaVersion',
  'kind',
  'updatedAt',
  'declarations',
]);
const LEGACY_MOUNT_LEDGER_KEYS = new Set([
  'kind',
  'revision',
  'liveMountsByWorkspace',
  'liveMountsByPlanVersion',
  'runsByMount',
  'recordDigest',
]);
const STABLE_MOUNT_LEDGER_KEYS = new Set([
  'kind',
  'revision',
  'liveMountsByWorkspace',
  'liveMountsByPlan',
  'runsByMount',
  'recordDigest',
]);
const MIXED_MOUNT_LEDGER_KEYS = new Set([
  ...LEGACY_MOUNT_LEDGER_KEYS,
  'liveMountsByPlan',
]);
const LEGACY_MOUNT_KEYS = new Set([
  'kind',
  'mountId',
  'projectId',
  'planId',
  'planVersionId',
  'planVersionDigest',
  'planPath',
  'workspaceId',
  'canonicalRoot',
  'state',
  'mountedAt',
  'mountedBy',
  'releasedAt',
  'releaseReason',
  'recordDigest',
]);
const LEGACY_SNAPSHOT_KEYS = new Set([
  'kind',
  'snapshotId',
  'capturedAt',
  'planId',
  'planVersionId',
  'planVersionDigest',
  'planPath',
  'plan',
  'tasks',
  'acceptance',
  'executionBinding',
  'recordDigest',
]);

export class StablePlanMigrationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'StablePlanMigrationError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      ok: false,
      error: {
        type: this.name,
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function fail(code, message, details) {
  throw new StablePlanMigrationError(code, message, details);
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

function digestRecord(record) {
  const unsigned = { ...record };
  delete unsigned.recordDigest;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return {
      raw,
      value: JSON.parse(raw),
    };
  } catch (error) {
    fail('PLAN_STATE_MIGRATION_INVALID', 'machine state is not valid JSON', {
      file,
      cause: String(error),
    });
  }
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.size &&
    Object.keys(value).every((key) => keys.has(key))
  );
}

function validTimestamp(value) {
  return (
    typeof value === 'string' &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validStringMap(value, keyPattern, valuePattern) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        keyPattern.test(key) &&
        typeof item === 'string' &&
        valuePattern.test(item),
    )
  );
}

function planIndexKey(projectId, planId) {
  return crypto
    .createHash('sha256')
    .update(`${projectId}\0${planId}`)
    .digest('hex');
}

function validateWorkLedgerForMigration(ledger) {
  if (
    !exactKeys(ledger, WORK_LEDGER_KEYS) ||
    ledger.schemaVersion !== DEVELOPMENT_SCHEMA_VERSION ||
    ledger.kind !== DEVELOPMENT_LEDGER_KIND ||
    !validTimestamp(ledger.updatedAt) ||
    ledger.declarations === null ||
    typeof ledger.declarations !== 'object' ||
    Array.isArray(ledger.declarations)
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Development work ledger is invalid',
    );
  }
  for (const [id, declaration] of Object.entries(ledger.declarations)) {
    if (id !== declaration?.declarationId) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'Development declaration index is inconsistent',
        { id },
      );
    }
    if (Object.hasOwn(declaration, 'planVersionDigest')) {
      if (
        Object.hasOwn(declaration, 'planDigest') ||
        !SHA256.test(declaration.declarationDigest ?? '') ||
        digestDeclaration(declaration) !== declaration.declarationDigest
      ) {
        fail(
          'PLAN_STATE_MIGRATION_INVALID',
          'legacy Development declaration is invalid',
          { id },
        );
      }
    } else {
      try {
        validateDeclaration(declaration);
      } catch (error) {
        fail(
          'PLAN_STATE_MIGRATION_INVALID',
          'stable Development declaration is invalid',
          { id, cause: String(error) },
        );
      }
    }
  }
  return ledger;
}

function validateMountLedgerForMigration(ledger) {
  if (
    ledger === null ||
    typeof ledger !== 'object' ||
    Array.isArray(ledger)
  ) {
    fail('PLAN_STATE_MIGRATION_INVALID', 'Plan mount ledger is invalid');
  }
  if (exactKeys(ledger, STABLE_MOUNT_LEDGER_KEYS)) {
    try {
      return validatePlanMountLedger(ledger);
    } catch (error) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'stable Plan mount ledger is invalid',
        { cause: String(error) },
      );
    }
  }
  if (
    !exactKeys(ledger, LEGACY_MOUNT_LEDGER_KEYS) &&
    !exactKeys(ledger, MIXED_MOUNT_LEDGER_KEYS)
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Plan mount ledger shape is not migratable',
    );
  }
  if (
    ledger.kind !== PLAN_MOUNT_LEDGER_KIND ||
    !Number.isInteger(ledger.revision) ||
    ledger.revision < 0 ||
    !SHA256.test(ledger.recordDigest ?? '') ||
    digestRecord(ledger) !== ledger.recordDigest ||
    !validStringMap(
      ledger.liveMountsByWorkspace,
      WORKSPACE_ID,
      IDENTIFIER,
    ) ||
    !validStringMap(
      ledger.liveMountsByPlanVersion,
      SHA256,
      IDENTIFIER,
    ) ||
    (Object.hasOwn(ledger, 'liveMountsByPlan') &&
      !validStringMap(ledger.liveMountsByPlan, SHA256, IDENTIFIER)) ||
    !validStringMap(ledger.runsByMount, IDENTIFIER, IDENTIFIER)
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'legacy or mixed Plan mount ledger is invalid',
    );
  }
  const workspaceMountIds = new Set(
    Object.values(ledger.liveMountsByWorkspace),
  );
  const indexedMountIds = new Set([
    ...Object.values(ledger.liveMountsByPlanVersion),
    ...Object.values(ledger.liveMountsByPlan ?? {}),
  ]);
  if (
    [...workspaceMountIds].some(
      (mountId) =>
        !indexedMountIds.has(mountId) ||
        !Object.hasOwn(ledger.runsByMount, mountId),
    ) ||
    [...indexedMountIds].some(
      (mountId) => !workspaceMountIds.has(mountId),
    )
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Plan mount live indexes are inconsistent',
    );
  }
  return ledger;
}

function validateLegacyMount(record, file) {
  if (
    !exactKeys(record, LEGACY_MOUNT_KEYS) ||
    record.kind !== 'peers-touch-plan-mount' ||
    !IDENTIFIER.test(record.mountId ?? '') ||
    !IDENTIFIER.test(record.projectId ?? '') ||
    !IDENTIFIER.test(record.planId ?? '') ||
    !IDENTIFIER.test(record.planVersionId ?? '') ||
    !SHA256.test(record.planVersionDigest ?? '') ||
    !WORKSPACE_ID.test(record.workspaceId ?? '') ||
    !path.isAbsolute(record.canonicalRoot ?? '') ||
    !['mounted', 'released'].includes(record.state) ||
    !SHA256.test(record.recordDigest ?? '') ||
    digestRecord(record) !== record.recordDigest ||
    !validTimestamp(record.mountedAt)
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'legacy Plan mount record is invalid',
      { file },
    );
  }
  return record;
}

function migrateMountRecord(record) {
  if (!Object.hasOwn(record, 'planVersionDigest')) return record;
  const migrated = { ...record };
  delete migrated.planVersionId;
  delete migrated.planVersionDigest;
  migrated.recordDigest = digestPlanMountRecord(migrated);
  try {
    validatePlanMountRecord(migrated);
  } catch (error) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'migrated Plan mount record is invalid',
      { mountId: record.mountId, cause: String(error) },
    );
  }
  return migrated;
}

function validateLegacySnapshot(snapshot, mount, file) {
  if (
    !exactKeys(snapshot, LEGACY_SNAPSHOT_KEYS) ||
    snapshot.kind !== 'peers-touch-execution-plan-snapshot' ||
    !IDENTIFIER.test(snapshot.snapshotId ?? '') ||
    !IDENTIFIER.test(snapshot.planId ?? '') ||
    !IDENTIFIER.test(snapshot.planVersionId ?? '') ||
    !SHA256.test(snapshot.planVersionDigest ?? '') ||
    !Array.isArray(snapshot.tasks) ||
    snapshot.plan?.kind !== 'peers-touch-plan-version' ||
    snapshot.plan?.planId !== snapshot.planId ||
    snapshot.plan?.versionId !== snapshot.planVersionId ||
    snapshot.executionBinding?.mountId !== mount.mountId ||
    snapshot.executionBinding?.workspaceId !== mount.workspaceId ||
    !path.isAbsolute(snapshot.executionBinding?.canonicalRoot ?? '') ||
    !SHA1.test(snapshot.executionBinding?.initialHead ?? '') ||
    !validTimestamp(snapshot.capturedAt) ||
    !SHA256.test(snapshot.recordDigest ?? '') ||
    digestRecord(snapshot) !== snapshot.recordDigest
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'legacy Execution Plan snapshot is invalid',
      { file, mountId: mount.mountId },
    );
  }
  return snapshot;
}

function migrateLegacyPlan(snapshot) {
  const taskIds = snapshot.plan.tasks.map((task) => task.id);
  const taskSlices = new Map(
    snapshot.tasks.map((task) => [task.taskId, task]),
  );
  const closureIds = [
    ...new Set(
      taskIds
        .map((taskId) => taskSlices.get(taskId)?.closureId)
        .filter(Boolean),
    ),
  ].sort();
  const gateIds = [
    ...new Set(
      closureIds.flatMap(
        (closureId) => snapshot.acceptance?.closures?.[closureId] ?? [],
      ),
    ),
  ].sort();
  const plan = {
    ...snapshot.plan,
    kind: 'peers-touch-plan',
    northStar: {
      objective:
        `Preserve and complete the accepted execution scope captured by ` +
        `${snapshot.planVersionId}.`,
      successCriteria: [
        {
          id: 'LEGACY-SCOPE',
          statement:
            'Complete every Task and Acceptance closure captured by the ' +
            'legacy immutable Plan snapshot.',
          sourceRefs: [snapshot.planVersionId],
        },
      ],
    },
    amendments: [],
    northStarApproval: null,
    criterionCoverage: [
      {
        criterionId: 'LEGACY-SCOPE',
        taskIds,
        closureIds,
        gateIds,
      },
    ],
  };
  delete plan.versionId;
  plan.northStarApproval = {
    northStarDigest: digestNorthStar(plan),
    approvedBy: 'legacy-plan-state-migration',
    approvedAt: validTimestamp(plan.createdAt)
      ? plan.createdAt
      : snapshot.capturedAt,
    decisionRef: `legacy-plan-version:${snapshot.planVersionId}`,
  };
  return plan;
}

function migrateSnapshot(snapshot) {
  const plan = migrateLegacyPlan(snapshot);
  const sourceInvalidationPolicy = null;
  const planContentDigest = digestPlanContent({
    plan,
    tasks: snapshot.tasks,
    acceptance: snapshot.acceptance,
    sourceInvalidationPolicy,
  });
  const planDigest = digestPlan({
    plan,
    tasks: snapshot.tasks,
    acceptance: snapshot.acceptance,
    sourceInvalidationPolicy,
  });
  const migrated = {
    kind: snapshot.kind,
    snapshotId: snapshot.snapshotId,
    capturedAt: snapshot.capturedAt,
    planId: snapshot.planId,
    planDigest,
    planContentDigest,
    amendmentCount: 0,
    planPath: snapshot.planPath,
    plan,
    tasks: snapshot.tasks,
    acceptance: snapshot.acceptance,
    sourceInvalidationPolicy,
    executionBinding: snapshot.executionBinding,
  };
  migrated.recordDigest = digestExecutionSnapshot(migrated);
  try {
    validateExecutionSnapshot(migrated);
  } catch (error) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'migrated Execution Plan snapshot is invalid',
      { snapshotId: snapshot.snapshotId, cause: String(error) },
    );
  }
  return migrated;
}

function validateRunEnvelope(run, mount, snapshot, file) {
  if (
    run?.kind !== 'peers-touch-execution-run' ||
    !IDENTIFIER.test(run.runId ?? '') ||
    run.snapshotId !== snapshot.snapshotId ||
    run.mountId !== mount.mountId ||
    !SHA256.test(run.snapshotDigest ?? '') ||
    !SHA256.test(run.recordDigest ?? '') ||
    digestRecord(run) !== run.recordDigest
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Execution Run is invalid',
      { file, mountId: mount.mountId },
    );
  }
  return run;
}

function migrateRun(run, snapshot) {
  if (run.snapshotDigest === snapshot.recordDigest) {
    try {
      validateExecutionRun(run, snapshot);
    } catch (error) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'stable Execution Run is invalid',
        { runId: run.runId, cause: String(error) },
      );
    }
    return run;
  }
  const migrated = {
    ...run,
    snapshotDigest: snapshot.recordDigest,
  };
  migrated.recordDigest = digestExecutionRun(migrated);
  try {
    validateExecutionRun(migrated, snapshot);
  } catch (error) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'migrated Execution Run is invalid',
      { runId: run.runId, cause: String(error) },
    );
  }
  return migrated;
}

function migrateDeclaration(declaration, planDigestByMount, digestMap) {
  if (!Object.hasOwn(declaration, 'planVersionDigest')) return declaration;
  const mappedByMount =
    declaration.mountId === null
      ? undefined
      : planDigestByMount.get(declaration.mountId);
  const mappedByDigest =
    declaration.planVersionDigest === null
      ? null
      : digestMap.get(declaration.planVersionDigest);
  const migrated = {
    ...declaration,
    planDigest:
      mappedByMount ??
      mappedByDigest ??
      declaration.planVersionDigest,
  };
  delete migrated.planVersionDigest;
  migrated.declarationDigest = digestDeclaration(migrated);
  try {
    validateDeclaration(migrated);
  } catch (error) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'migrated Development declaration is invalid',
      { declarationId: declaration.declarationId, cause: String(error) },
    );
  }
  return migrated;
}

function listMountFiles(home) {
  const directory = path.join(planMountRootPath({ home }), 'mounts');
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(directory, entry.name))
    .sort();
}

function readMountRecordsForMigration(home) {
  const records = [];
  for (const file of listMountFiles(home)) {
    const source = readJson(file);
    const record = source.value;
    const expectedName = `${record?.mountId}.json`;
    if (path.basename(file) !== expectedName) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'Plan mount record filename does not match mountId',
        { file, mountId: record?.mountId ?? null },
      );
    }
    let migrated;
    if (Object.hasOwn(record, 'planVersionDigest')) {
      validateLegacyMount(record, file);
      migrated = migrateMountRecord(record);
    } else {
      try {
        validatePlanMountRecord(record);
      } catch (error) {
        fail(
          'PLAN_STATE_MIGRATION_INVALID',
          'stable Plan mount record is invalid',
          { file, cause: String(error) },
        );
      }
      migrated = record;
    }
    records.push({
      file,
      raw: source.raw,
      original: record,
      migrated,
      changed: migrated !== record,
    });
  }
  return records;
}

function sameCanonicalValue(left, right) {
  return (
    JSON.stringify(canonicalize(left)) ===
    JSON.stringify(canonicalize(right))
  );
}

function prepareExecutionMigration(entry, ledger, home) {
  const runId = ledger.runsByMount[entry.original.mountId];
  if (runId === undefined) {
    if (entry.original.state === 'mounted') {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'live Plan mount has no Execution Run',
        { mountId: entry.original.mountId },
      );
    }
    return null;
  }
  const paths = executionRunPaths(runId, {
    home,
    workspaceId: entry.original.workspaceId,
  });
  const runSource = readJson(paths.run);
  if (runSource === null) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Execution Run cannot be read',
      { mountId: entry.original.mountId, runId, file: paths.run },
    );
  }
  const run = runSource.value;
  const legacySnapshotFile = path.join(
    paths.root,
    'execution-plan-snapshot.json',
  );
  const stableSnapshotFile = executionSnapshotPath(
    runId,
    run.snapshotId,
    {
      home,
      workspaceId: entry.original.workspaceId,
    },
  );
  const legacySource = readJson(legacySnapshotFile);
  const stableSource = readJson(stableSnapshotFile);
  let migratedSnapshot;
  let legacyDigest = null;
  if (legacySource !== null) {
    validateLegacySnapshot(
      legacySource.value,
      entry.original,
      legacySnapshotFile,
    );
    validateRunEnvelope(
      run,
      entry.original,
      legacySource.value,
      paths.run,
    );
    migratedSnapshot = migrateSnapshot(legacySource.value);
    legacyDigest = legacySource.value.planVersionDigest;
    if (
      stableSource !== null &&
      !sameCanonicalValue(stableSource.value, migratedSnapshot)
    ) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'stable snapshot path conflicts with the legacy migration result',
        { file: stableSnapshotFile },
      );
    }
  } else if (stableSource !== null) {
    migratedSnapshot = stableSource.value;
    try {
      validateExecutionSnapshot(migratedSnapshot);
    } catch (error) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'stable Execution Plan snapshot is invalid',
        { file: stableSnapshotFile, cause: String(error) },
      );
    }
  } else {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Execution Plan snapshot cannot be read',
      {
        mountId: entry.original.mountId,
        legacySnapshotFile,
        stableSnapshotFile,
      },
    );
  }
  const validSnapshotDigests = new Set([
    migratedSnapshot.recordDigest,
    ...(legacySource === null
      ? []
      : [legacySource.value.recordDigest]),
  ]);
  if (!validSnapshotDigests.has(run.snapshotDigest)) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'Execution Run references an unknown snapshot digest',
      { runId, snapshotDigest: run.snapshotDigest },
    );
  }
  const migratedRun = migrateRun(run, migratedSnapshot);
  return {
    runFile: paths.run,
    runRaw: runSource.raw,
    run,
    migratedRun,
    stableSnapshotFile,
    stableSnapshotExists: stableSource !== null,
    migratedSnapshot,
    legacySnapshotFile,
    removeLegacySnapshot: legacySource !== null,
    legacyDigest,
  };
}

function prepareMountLedgerMigration(ledger, mountEntries) {
  const mountsById = new Map(
    mountEntries.map((entry) => [entry.migrated.mountId, entry.migrated]),
  );
  const liveMountsByPlan = {};
  for (const [workspaceId, mountId] of Object.entries(
    ledger.liveMountsByWorkspace,
  )) {
    const mount = mountsById.get(mountId);
    if (
      mount === undefined ||
      mount.workspaceId !== workspaceId ||
      mount.state !== 'mounted'
    ) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'live workspace index does not resolve to a mounted Plan record',
        { workspaceId, mountId },
      );
    }
    if (!Object.hasOwn(ledger.runsByMount, mountId)) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'live Plan mount has no run index',
        { workspaceId, mountId },
      );
    }
    const key = planIndexKey(mount.projectId, mount.planId);
    if (
      Object.hasOwn(liveMountsByPlan, key) &&
      liveMountsByPlan[key] !== mountId
    ) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'two live mounts claim the same stable Plan identity',
        { key, mountIds: [liveMountsByPlan[key], mountId] },
      );
    }
    liveMountsByPlan[key] = mountId;
  }
  const legacyShape = Object.hasOwn(ledger, 'liveMountsByPlanVersion');
  if (
    !legacyShape &&
    !sameCanonicalValue(ledger.liveMountsByPlan, liveMountsByPlan)
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'stable Plan mount index disagrees with immutable mount records',
    );
  }
  if (
    !legacyShape &&
    sameCanonicalValue(ledger.liveMountsByPlan, liveMountsByPlan)
  ) {
    return { value: ledger, changed: false };
  }
  const migrated = {
    kind: ledger.kind,
    revision: ledger.revision + 1,
    liveMountsByWorkspace: ledger.liveMountsByWorkspace,
    liveMountsByPlan,
    runsByMount: ledger.runsByMount,
  };
  migrated.recordDigest = digestRecord(migrated);
  try {
    validatePlanMountLedger(migrated);
  } catch (error) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'migrated Plan mount ledger is invalid',
      { cause: String(error) },
    );
  }
  return { value: migrated, changed: true };
}

async function writePreparedJson(
  file,
  value,
  expectedContent,
  replaceFile,
) {
  await replaceFile(
    file,
    `${JSON.stringify(value, null, 2)}\n`,
    expectedContent === undefined ? {} : { expectedContent },
  );
  fs.chmodSync(file, 0o600);
}

export async function migrateStablePlanState(options = {}) {
  const home = options.home ?? homedir();
  const workFile = developmentWorkLedgerPath(home);
  const mountFile = planMountLedgerPath({ home });
  const replaceFile = options.atomicReplaceFile ?? atomicReplaceFile;
  const removeFile =
    options.removeFile ??
    ((file) => fs.rmSync(file, { force: true }));
  const workspaceLocks = [];
  let releaseWork = null;
  let planLease = null;
  try {
    const initialMounts = readMountRecordsForMigration(home);
    const workspaceIds = [
      ...new Set(initialMounts.map((entry) => entry.original.workspaceId)),
    ].sort();
    for (const workspaceId of workspaceIds) {
      workspaceLocks.push(
        await acquireWorkspaceLifecycleLock({
          home,
          workspaceId,
          lockTimeoutMs: options.lockTimeoutMs,
        }),
      );
    }
    releaseWork = acquireDevelopmentWorkLedgerLock({
      home,
      lockPath: developmentWorkLockPath(home),
      lockTimeoutMs: options.lockTimeoutMs,
      now: options.now,
    });
    planLease = await acquirePlanMountLedgerLock({
      home,
      lockTimeoutMs: options.lockTimeoutMs,
      now: options.now,
    });

    const work = readJson(workFile);
    const mounts = readJson(mountFile);
    if (work !== null) validateWorkLedgerForMigration(work.value);
    if (mounts !== null) validateMountLedgerForMigration(mounts.value);
    const mountEntries = readMountRecordsForMigration(home);
    const lockedWorkspaceIds = new Set(workspaceIds);
    const lateWorkspaceIds = mountEntries
      .map((entry) => entry.original.workspaceId)
      .filter((workspaceId) => !lockedWorkspaceIds.has(workspaceId));
    if (lateWorkspaceIds.length > 0) {
      fail(
        'PLAN_STATE_MIGRATION_BUSY',
        'Plan mount set changed while workspace locks were being acquired',
        { workspaceIds: [...new Set(lateWorkspaceIds)].sort() },
      );
    }

    const planDigestByMount = new Map();
    const digestMap = new Map();
    const executions = [];
    if (mounts !== null) {
      for (const entry of mountEntries) {
        const execution = prepareExecutionMigration(
          entry,
          mounts.value,
          home,
        );
        if (execution === null) continue;
        executions.push(execution);
        planDigestByMount.set(
          entry.original.mountId,
          execution.migratedSnapshot.planDigest,
        );
        if (execution.legacyDigest !== null) {
          const existing = digestMap.get(execution.legacyDigest);
          if (
            existing !== undefined &&
            existing !== execution.migratedSnapshot.planDigest
          ) {
            fail(
              'PLAN_STATE_MIGRATION_INVALID',
              'one legacy Plan digest maps to conflicting stable Plan digests',
              { legacyDigest: execution.legacyDigest },
            );
          }
          digestMap.set(
            execution.legacyDigest,
            execution.migratedSnapshot.planDigest,
          );
        }
      }
    } else if (mountEntries.length > 0) {
      fail(
        'PLAN_STATE_MIGRATION_INVALID',
        'Plan mount records exist without a mount ledger',
      );
    }

    let migratedDeclarations = 0;
    let migratedWorkLedger = null;
    if (work !== null) {
      const declarations = Object.fromEntries(
        Object.entries(work.value.declarations).map(([id, declaration]) => {
          const migrated = migrateDeclaration(
            declaration,
            planDigestByMount,
            digestMap,
          );
          if (migrated !== declaration) migratedDeclarations += 1;
          return [id, migrated];
        }),
      );
      migratedWorkLedger = {
        ...work.value,
        declarations,
      };
    }

    const migratedMountLedger =
      mounts === null
        ? null
        : prepareMountLedgerMigration(mounts.value, mountEntries);

    let migratedSnapshots = 0;
    let migratedRuns = 0;
    let removedLegacySnapshots = 0;
    for (const execution of executions) {
      if (!execution.stableSnapshotExists) {
        await writePreparedJson(
          execution.stableSnapshotFile,
          execution.migratedSnapshot,
          undefined,
          replaceFile,
        );
        migratedSnapshots += 1;
      }
      if (execution.migratedRun !== execution.run) {
        await writePreparedJson(
          execution.runFile,
          execution.migratedRun,
          execution.runRaw,
          replaceFile,
        );
        migratedRuns += 1;
      }
      if (execution.removeLegacySnapshot) {
        await removeFile(execution.legacySnapshotFile);
        removedLegacySnapshots += 1;
      }
    }

    let migratedMountRecords = 0;
    for (const entry of mountEntries) {
      if (!entry.changed) continue;
      await writePreparedJson(
        entry.file,
        entry.migrated,
        entry.raw,
        replaceFile,
      );
      migratedMountRecords += 1;
    }

    if (work !== null && migratedDeclarations > 0) {
      await writePreparedJson(
        workFile,
        migratedWorkLedger,
        work.raw,
        replaceFile,
      );
    }

    if (migratedMountLedger?.changed === true) {
      await writePreparedJson(
        mountFile,
        migratedMountLedger.value,
        mounts.raw,
        replaceFile,
      );
    }

    return {
      ok: true,
      migratedDeclarations,
      migratedMountRecords,
      migratedSnapshots,
      migratedRuns,
      removedLegacySnapshots,
      migratedMountLedger: migratedMountLedger?.changed ?? false,
    };
  } finally {
    if (planLease !== null) await releasePlanMountLedgerLock(planLease);
    if (releaseWork !== null) releaseWork();
    for (const acquired of workspaceLocks.reverse()) acquired.release();
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = argv[index + 1];
    if (token !== '--home' || value === undefined || value.startsWith('--')) {
      fail('PLAN_STATE_MIGRATION_USAGE', `invalid option: ${token}`);
    }
    options.home = value;
    index += 1;
  }
  return options;
}

if (isDirectInvocation(import.meta.url)) {
  try {
    process.stdout.write(
      `${JSON.stringify(
        await migrateStablePlanState(parseArguments(process.argv.slice(2))),
        null,
        2,
      )}\n`,
    );
  } catch (error) {
    const normalized =
      error instanceof StablePlanMigrationError
        ? error
        : new StablePlanMigrationError(
            error?.code ?? 'PLAN_STATE_MIGRATION_FAILED',
            error?.message ?? String(error),
            error?.details ?? error?.detail,
          );
    process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
    process.exitCode = 2;
  }
}
