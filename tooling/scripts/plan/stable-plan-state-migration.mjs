#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import {
  developmentWorkLedgerPath,
  developmentWorkLockPath,
  isDirectInvocation,
  machineDevRoot,
} from '../lib/machine-dev-paths.mjs';
import { digestDeclaration } from '../local-dev/dev-work-schema.mjs';
import { atomicReplaceFile } from './plan-package.mjs';
import { planMountLockPath } from './plan-mount.mjs';

const LIVE_DECLARATION_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);

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

async function acquireLock(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  try {
    const handle = await fsp.open(file, 'wx', 0o600);
    await handle.writeFile(
      `${JSON.stringify({
        kind: 'peers-touch-stable-plan-migration-lock',
        pid: process.pid,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (error.code === 'EEXIST') {
      fail(
        'PLAN_STATE_MIGRATION_BUSY',
        'machine workflow state is being modified',
        { lock: file },
      );
    }
    throw error;
  }
  return async () => {
    await fsp.rm(file, { force: true });
  };
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
  const releases = [];
  try {
    for (const lockFile of [
      developmentWorkLockPath(home),
      planMountLockPath({ home }),
    ].sort()) {
      releases.push(await acquireLock(lockFile));
    }
    const work = readJson(workFile);
    const mounts = readJson(mountFile);

    const liveDeclarations = Object.values(work?.value?.declarations ?? {})
      .filter((declaration) => LIVE_DECLARATION_STATES.has(declaration?.state))
      .map((declaration) => declaration.declarationId);
    const liveMounts = Object.values(
      mounts?.value?.liveMountsByWorkspace ?? {},
    );
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
        await atomicReplaceFile(
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
      await atomicReplaceFile(
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
    for (const release of releases.reverse()) await release();
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
