#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  developmentWorkLockPath,
  isDirectInvocation,
  machineDevRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  acquireDevelopmentWorkLedgerLock,
} from '../local-dev/dev-work-ledger.mjs';
import {
  resolveWorkflowOwnerCommandContext,
} from '../local-dev/workflow-owner-context.mjs';
import {
  LEDGER_KIND as DEVELOPMENT_LEDGER_KIND,
  SCHEMA_VERSION as DEVELOPMENT_SCHEMA_VERSION,
  digestDeclaration,
  validateDeclaration,
} from '../local-dev/dev-work-schema.mjs';
import { atomicReplaceFile } from './plan-package.mjs';
import {
  PLAN_MOUNT_LEDGER_KIND,
  acquirePlanMountLedgerLock,
  releasePlanMountLedgerLock,
  validatePlanMountLedger,
} from './plan-mount.mjs';

const LIVE_DECLARATION_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);
const SHA256 = /^[0-9a-f]{64}$/;
const WORKSPACE_ID = /^[0-9a-f]{16}$/;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LEGACY_MOUNT_LEDGER_KEYS = new Set([
  'kind',
  'revision',
  'liveMountsByWorkspace',
  'liveMountsByPlanVersion',
  'runsByMount',
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

function validateLegacyMountLedger(ledger) {
  if (
    !exactKeys(ledger, LEGACY_MOUNT_LEDGER_KEYS) ||
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
    !validStringMap(ledger.runsByMount, IDENTIFIER, IDENTIFIER)
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'legacy Plan mount ledger is invalid',
    );
  }
  const workspaceMountIds = [
    ...new Set(Object.values(ledger.liveMountsByWorkspace)),
  ].sort();
  const planMountIds = [
    ...new Set(Object.values(ledger.liveMountsByPlanVersion)),
  ].sort();
  if (
    workspaceMountIds.join('\0') !== planMountIds.join('\0') ||
    workspaceMountIds.some(
      (mountId) => !Object.hasOwn(ledger.runsByMount, mountId),
    )
  ) {
    fail(
      'PLAN_STATE_MIGRATION_INVALID',
      'legacy Plan mount indexes are inconsistent',
    );
  }
  return ledger;
}

function validateWorkLedger(ledger) {
  if (
    ledger === null ||
    !exactKeys(
      ledger,
      new Set(['schemaVersion', 'kind', 'updatedAt', 'declarations']),
    ) ||
    ledger.schemaVersion !== DEVELOPMENT_SCHEMA_VERSION ||
    ledger.kind !== DEVELOPMENT_LEDGER_KIND ||
    !Number.isFinite(Date.parse(ledger.updatedAt)) ||
    new Date(ledger.updatedAt).toISOString() !== ledger.updatedAt ||
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
          'legacy Development declaration digest is invalid',
          { id },
        );
      }
      const migrated = migrateDeclaration(declaration);
      validateDeclaration(migrated);
    } else {
      validateDeclaration(declaration);
    }
  }
  return ledger;
}

function migrateDeclaration(declaration) {
  if (!Object.hasOwn(declaration, 'planVersionDigest')) return declaration;
  const migrated = { ...declaration, planDigest: declaration.planVersionDigest };
  delete migrated.planVersionDigest;
  migrated.declarationDigest = digestDeclaration(migrated);
  return migrated;
}

export async function migrateStablePlanState(options = {}) {
  const home = options.home ?? homedir();
  const workFile = developmentWorkLedgerPath(home);
  const mountFile = path.join(machineDevRoot(home), 'plan-mounts', 'ledger.json');
  let releaseWork = null;
  let planLease = null;
  const replaceFile = options.atomicReplaceFile ?? atomicReplaceFile;
  try {
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
    if (work !== null) validateWorkLedger(work.value);
    if (mounts !== null) {
      if (Object.hasOwn(mounts.value, 'liveMountsByPlanVersion')) {
        validateLegacyMountLedger(mounts.value);
      } else {
        validatePlanMountLedger(mounts.value);
      }
    }

    const liveDeclarations = Object.values(work?.value?.declarations ?? {})
      .filter((declaration) => LIVE_DECLARATION_STATES.has(declaration?.state))
      .map((declaration) => declaration.declarationId);
    const liveMounts = [
      ...Object.values(mounts?.value?.liveMountsByWorkspace ?? {}),
      ...Object.values(mounts?.value?.liveMountsByPlanVersion ?? {}),
      ...Object.values(mounts?.value?.liveMountsByPlan ?? {}),
    ];
    if (liveDeclarations.length > 0 || liveMounts.length > 0) {
      fail(
        'PLAN_STATE_MIGRATION_REQUIRES_IDLE',
        'stable Plan state migration requires all Development Runs to be closed',
        { liveDeclarations, liveMounts },
      );
    }

    let migratedDeclarations = 0;
    if (work !== null) {
      const declarations = Object.fromEntries(
        Object.entries(work.value.declarations ?? {}).map(
          ([id, declaration]) => {
            const migrated = migrateDeclaration(declaration);
            if (migrated !== declaration) migratedDeclarations += 1;
            return [id, migrated];
          },
        ),
      );
      if (migratedDeclarations > 0) {
        await replaceFile(
          workFile,
          `${JSON.stringify({ ...work.value, declarations }, null, 2)}\n`,
          { expectedContent: work.raw },
        );
      }
    }

    let migratedMountLedger = false;
    if (
      mounts !== null &&
      Object.hasOwn(mounts.value, 'liveMountsByPlanVersion')
    ) {
      const migrated = {
        ...mounts.value,
        revision: mounts.value.revision + 1,
        liveMountsByPlan: {},
      };
      delete migrated.liveMountsByPlanVersion;
      migrated.recordDigest = digestRecord(migrated);
      validatePlanMountLedger(migrated);
      await replaceFile(
        mountFile,
        `${JSON.stringify(migrated, null, 2)}\n`,
        { expectedContent: mounts.raw },
      );
      migratedMountLedger = true;
    }

    return {
      ok: true,
      migratedDeclarations,
      migratedMountLedger,
    };
  } finally {
    if (planLease !== null) await releasePlanMountLedgerLock(planLease);
    if (releaseWork !== null) releaseWork();
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
    const options = parseArguments(process.argv.slice(2));
    resolveWorkflowOwnerCommandContext('migration', 'migrate', {
      home: options.home,
      workspaceRoot: process.cwd(),
    });
    process.stdout.write(
      `${JSON.stringify(
        await migrateStablePlanState(options),
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
