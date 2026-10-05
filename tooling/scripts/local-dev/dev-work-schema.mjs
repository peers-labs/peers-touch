import { createHash } from 'node:crypto';
import {
  existsSync,
  realpathSync,
} from 'node:fs';
import path from 'node:path';

export const LEDGER_KIND = 'peers-touch-development-work-ledger';
export const SCHEMA_VERSION = 1;
export const DEFAULT_EXPIRES_MINUTES = 480;
export const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
export const SOURCE_MODES = new Set(['shared-read', 'exclusive-write']);
export const RUNTIME_MODES = new Set(['shared', 'exclusive']);
export const RUNTIME_KINDS = new Set([
  'profile',
  'local.slot',
  'station.connect',
  'station.deploy',
  'station.reset',
  'relay.connect',
  'relay.deploy',
  'database',
  'service',
  'account',
  'client',
  'device',
  'client.storage',
  'fixture',
  'automation.session',
  'resource.plan',
]);
export const LIVE_STATES = new Set(['DECLARED', 'ACTIVE', 'RELEASING']);
export const DECLARATION_STATES = new Set([
  ...LIVE_STATES,
  'RELEASED',
  'STALE',
]);

const DECLARATION_KEYS = new Set([
  'declarationId',
  'workItemId',
  'sessionId',
  'workspaceId',
  'branch',
  'sourceHead',
  'owner',
  'purpose',
  'journeyId',
  'state',
  'createdAt',
  'heartbeatAt',
  'expiresAt',
  'sourceClaims',
  'runtimeClaims',
  'declarationDigest',
  'planPath',
  'planId',
  'planVersionDigest',
  'mountId',
  'runId',
  'taskId',
]);
const SOURCE_CLAIM_KEYS = new Set(['pathPrefix', 'mode']);
const RUNTIME_CLAIM_KEYS = new Set(['kind', 'resourceId', 'mode']);

export class DevWorkError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DevWorkError';
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, message, detail = {}) {
  throw new DevWorkError(code, message, detail);
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function hasExactKeys(value, keys) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.size && actual.every((key) => keys.has(key))
  );
}

export function digestDeclaration(declaration) {
  const unsigned = { ...declaration };
  delete unsigned.declarationDigest;
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(unsigned)))
    .digest('hex');
}

export function requiredText(value, field, maxLength = 512) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('INVALID_DECLARATION', `${field} must be a non-empty string`, { field });
  }
  const normalized = value.trim();
  if (normalized.length > maxLength || normalized.includes('\0')) {
    fail('INVALID_DECLARATION', `${field} is invalid`, { field });
  }
  return normalized;
}

export function requiredIdentifier(value, field) {
  const normalized = requiredText(value, field, 128);
  if (!IDENTIFIER.test(normalized)) {
    fail('INVALID_DECLARATION', `${field} has an invalid identifier`, { field });
  }
  return normalized;
}

export function normalizeSourcePath(value) {
  const text = requiredText(value, 'source claim path', 1024).replaceAll(
    '\\',
    '/',
  );
  const segments = text.split('/');
  if (
    text.startsWith('/') ||
    /^[a-z]:\//i.test(text) ||
    segments.includes('.') ||
    segments.includes('..')
  ) {
    fail('INVALID_SOURCE_CLAIM', 'source claim must be repository-relative', {
      pathPrefix: text,
    });
  }
  const normalized = path.posix.normalize(text).replace(/\/+$/, '');
  if (!normalized || normalized === '.') {
    fail('INVALID_SOURCE_CLAIM', 'source claim must name a repository path', {
      pathPrefix: text,
    });
  }
  return normalized;
}

export function normalizePlanPath(value) {
  const normalized = normalizeSourcePath(value);
  if (!normalized.endsWith('.md')) {
    fail('INVALID_PLAN_LOCATOR', 'planPath must name a Markdown file', {
      planPath: normalized,
    });
  }
  return normalized;
}

export function validateSourcePathContainment(root, pathPrefix) {
  let canonicalRoot;
  try {
    canonicalRoot = realpathSync(root);
  } catch (error) {
    fail('WORKTREE_IDENTITY_UNAVAILABLE', 'workspace root cannot be resolved', {
      root,
      cause: String(error),
    });
  }
  const target = path.resolve(canonicalRoot, ...pathPrefix.split('/'));
  const relativeTarget = path.relative(canonicalRoot, target);
  if (
    relativeTarget === '..' ||
    relativeTarget.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeTarget)
  ) {
    fail('INVALID_SOURCE_CLAIM', 'source claim escapes the repository', {
      pathPrefix,
    });
  }
  let existing = target;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) {
      fail('INVALID_SOURCE_CLAIM', 'source claim has no repository parent', {
        pathPrefix,
      });
    }
    existing = parent;
  }
  const canonicalExisting = realpathSync(existing);
  const relativeExisting = path.relative(canonicalRoot, canonicalExisting);
  if (
    relativeExisting === '..' ||
    relativeExisting.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeExisting)
  ) {
    fail('INVALID_SOURCE_CLAIM', 'source claim resolves outside the repository', {
      pathPrefix,
    });
  }
}

function parseDelimited(value) {
  if (value === undefined || value === null || value === '') return [];
  return String(value)
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseSourceClaims(value) {
  const claims = parseDelimited(value).map((entry) => {
    const separator = entry.indexOf(':');
    if (separator <= 0) {
      fail('INVALID_SOURCE_CLAIM', 'source claim must be <mode>:<path>', {
        claim: entry,
      });
    }
    const mode = entry.slice(0, separator);
    if (!SOURCE_MODES.has(mode)) {
      fail('INVALID_SOURCE_CLAIM', `unsupported source claim mode: ${mode}`, {
        claim: entry,
      });
    }
    return {
      pathPrefix: normalizeSourcePath(entry.slice(separator + 1)),
      mode,
    };
  });
  const deduped = new Map();
  for (const claim of claims) {
    const current = deduped.get(claim.pathPrefix);
    if (!current || claim.mode === 'exclusive-write') {
      deduped.set(claim.pathPrefix, claim);
    }
  }
  return [...deduped.values()].sort((left, right) =>
    left.pathPrefix.localeCompare(right.pathPrefix),
  );
}

export function parseRuntimeClaims(value) {
  const claims = parseDelimited(value).map((entry) => {
    const [mode, kind, ...resourceParts] = entry.split(':');
    const resourceId = resourceParts.join(':');
    if (!RUNTIME_MODES.has(mode) || !RUNTIME_KINDS.has(kind) || !resourceId) {
      fail(
        'INVALID_RUNTIME_CLAIM',
        'runtime claim must be <mode>:<kind>:<resource-id>',
        { claim: entry },
      );
    }
    return {
      kind,
      resourceId: requiredText(resourceId, 'runtime resource id', 512),
      mode,
    };
  });
  const deduped = new Map();
  for (const claim of claims) {
    const key = `${claim.kind}:${claim.resourceId}`;
    const current = deduped.get(key);
    if (!current || claim.mode === 'exclusive') deduped.set(key, claim);
  }
  return [...deduped.values()].sort((left, right) =>
    `${left.kind}:${left.resourceId}`.localeCompare(
      `${right.kind}:${right.resourceId}`,
    ),
  );
}

function validateClaimArrays(declaration) {
  if (
    !Array.isArray(declaration.sourceClaims) ||
    (LIVE_STATES.has(declaration.state) &&
      declaration.sourceClaims.length === 0)
  ) {
    fail(
      'MACHINE_WORK_LEDGER_INVALID',
      'live sourceClaims must be a non-empty array',
    );
  }
  if (!Array.isArray(declaration.runtimeClaims)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'runtimeClaims must be an array');
  }
  for (const claim of declaration.sourceClaims) {
    if (
      !isObject(claim) ||
      !hasExactKeys(claim, SOURCE_CLAIM_KEYS) ||
      !SOURCE_MODES.has(claim.mode)
    ) {
      fail('MACHINE_WORK_LEDGER_INVALID', 'invalid source claim');
    }
    let normalized;
    try {
      normalized = normalizeSourcePath(claim.pathPrefix);
    } catch {
      fail('MACHINE_WORK_LEDGER_INVALID', 'invalid source claim');
    }
    if (normalized !== claim.pathPrefix) {
      fail('MACHINE_WORK_LEDGER_INVALID', 'source claim is not canonical');
    }
  }
  for (const claim of declaration.runtimeClaims) {
    if (
      !isObject(claim) ||
      !hasExactKeys(claim, RUNTIME_CLAIM_KEYS) ||
      !RUNTIME_MODES.has(claim.mode) ||
      !RUNTIME_KINDS.has(claim.kind)
    ) {
      fail('MACHINE_WORK_LEDGER_INVALID', 'invalid runtime claim');
    }
    let normalized;
    try {
      normalized = requiredText(claim.resourceId, 'runtime resource id', 512);
    } catch {
      fail('MACHINE_WORK_LEDGER_INVALID', 'invalid runtime claim');
    }
    if (normalized !== claim.resourceId) {
      fail('MACHINE_WORK_LEDGER_INVALID', 'runtime claim is not canonical');
    }
  }
  let canonicalSourceClaims;
  let canonicalRuntimeClaims;
  try {
    canonicalSourceClaims = parseSourceClaims(
      declaration.sourceClaims
        .map((claim) => `${claim.mode}:${claim.pathPrefix}`)
        .join(';'),
    );
    canonicalRuntimeClaims = parseRuntimeClaims(
      declaration.runtimeClaims
        .map((claim) => `${claim.mode}:${claim.kind}:${claim.resourceId}`)
        .join(';'),
    );
  } catch {
    fail('MACHINE_WORK_LEDGER_INVALID', 'claim arrays are invalid');
  }
  if (
    JSON.stringify(canonicalize(canonicalSourceClaims)) !==
      JSON.stringify(canonicalize(declaration.sourceClaims)) ||
    JSON.stringify(canonicalize(canonicalRuntimeClaims)) !==
      JSON.stringify(canonicalize(declaration.runtimeClaims))
  ) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'claim arrays are not canonical');
  }
}

function validIsoTimestamp(value) {
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString() === value
  );
}

export function validateDeclaration(declaration) {
  if (
    !isObject(declaration) ||
    !hasExactKeys(declaration, DECLARATION_KEYS)
  ) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration fields are invalid');
  }
  for (const [field, maxLength] of [
    ['declarationId', 1024],
    ['branch', 1024],
    ['sourceHead', 1024],
    ['owner', 256],
    ['purpose', 1024],
    ['state', 1024],
    ['createdAt', 1024],
    ['heartbeatAt', 1024],
    ['expiresAt', 1024],
    ['declarationDigest', 1024],
  ]) {
    let normalized;
    try {
      normalized = requiredText(declaration[field], field, maxLength);
    } catch {
      fail('MACHINE_WORK_LEDGER_INVALID', `${field} is invalid`);
    }
    if (normalized !== declaration[field]) {
      fail('MACHINE_WORK_LEDGER_INVALID', `${field} is not canonical`);
    }
  }
  for (const field of ['workItemId', 'sessionId']) {
    let normalized;
    try {
      normalized = requiredIdentifier(declaration[field], field);
    } catch {
      fail('MACHINE_WORK_LEDGER_INVALID', `${field} is invalid`);
    }
    if (normalized !== declaration[field]) {
      fail('MACHINE_WORK_LEDGER_INVALID', `${field} is not canonical`);
    }
  }
  const locatorFields = [
    'planPath',
    'planId',
    'planVersionDigest',
    'mountId',
    'runId',
    'taskId',
  ];
  const locatorValues = locatorFields.map((field) => declaration[field]);
  const allNull = locatorValues.every((value) => value === null);
  const allPresent = locatorValues.every(
    (value) => typeof value === 'string' && value.length > 0,
  );
  if (!allNull && !allPresent) {
    fail(
      'MACHINE_WORK_LEDGER_INVALID',
      'Plan locator fields must be all null or all present',
    );
  }
  if (allPresent) {
    let normalizedPath;
    try {
      normalizedPath = normalizePlanPath(declaration.planPath);
    } catch {
      fail('MACHINE_WORK_LEDGER_INVALID', 'planPath is invalid');
    }
    if (normalizedPath !== declaration.planPath) {
      fail('MACHINE_WORK_LEDGER_INVALID', 'planPath is not canonical');
    }
    for (const field of ['planId', 'mountId', 'runId', 'taskId']) {
      let normalized;
      try {
        normalized = requiredIdentifier(declaration[field], field);
      } catch {
        fail('MACHINE_WORK_LEDGER_INVALID', `${field} is invalid`);
      }
      if (normalized !== declaration[field]) {
        fail('MACHINE_WORK_LEDGER_INVALID', `${field} is not canonical`);
      }
    }
    if (!/^[0-9a-f]{64}$/.test(declaration.planVersionDigest)) {
      fail(
        'MACHINE_WORK_LEDGER_INVALID',
        'planVersionDigest is invalid',
      );
    }
  }
  if (!/^[0-9a-f]{16}$/.test(declaration.workspaceId)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'workspaceId is invalid');
  }
  if (!/^[0-9a-f]{40,64}$/.test(declaration.sourceHead)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'sourceHead is invalid');
  }
  if (
    declaration.declarationId !==
    `${declaration.workItemId}-${declaration.workspaceId}`
  ) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declarationId is not canonical');
  }
  if (!DECLARATION_STATES.has(declaration.state)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration state is invalid');
  }
  for (const field of ['createdAt', 'heartbeatAt', 'expiresAt']) {
    if (!validIsoTimestamp(declaration[field])) {
      fail('MACHINE_WORK_LEDGER_INVALID', `${field} is invalid`);
    }
  }
  if (
    Date.parse(declaration.createdAt) > Date.parse(declaration.heartbeatAt) ||
    Date.parse(declaration.heartbeatAt) > Date.parse(declaration.expiresAt)
  ) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration timestamps are out of order');
  }
  if (declaration.journeyId !== null) {
    let normalized;
    try {
      normalized = requiredIdentifier(declaration.journeyId, 'journeyId');
    } catch {
      fail('MACHINE_WORK_LEDGER_INVALID', 'journeyId is invalid');
    }
    if (normalized !== declaration.journeyId) {
      fail('MACHINE_WORK_LEDGER_INVALID', 'journeyId is not canonical');
    }
  }
  validateClaimArrays(declaration);
  if (!/^[0-9a-f]{64}$/.test(declaration.declarationDigest)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration digest is invalid');
  }
  if (digestDeclaration(declaration) !== declaration.declarationDigest) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration digest mismatch', {
      declarationId: declaration.declarationId,
    });
  }
  return declaration;
}
