import { createHash } from 'node:crypto';
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
  'client.storage',
  'fixture',
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
]);

export class DevWorkError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'DevWorkError';
    this.code = code;
    this.detail = detail;
  }
}

export function fail(code, message, detail) {
  throw new DevWorkError(code, message, detail);
}

export function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
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

function normalizeSourcePath(value) {
  const text = requiredText(value, 'source claim path', 1024).replaceAll('\\', '/');
  if (text.startsWith('/') || text.split('/').includes('..')) {
    fail('INVALID_SOURCE_CLAIM', 'source claim must be repository-relative', {
      pathPrefix: text,
    });
  }
  const normalized = path.posix.normalize(text.replace(/^\.\//, ''));
  if (normalized === '..' || normalized.startsWith('../')) {
    fail('INVALID_SOURCE_CLAIM', 'source claim escapes the repository', {
      pathPrefix: text,
    });
  }
  return normalized.replace(/\/+$/, '') || '.';
}

function parseDelimited(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
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
    if (!current || claim.mode === 'exclusive') {
      deduped.set(key, claim);
    }
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
    declaration.sourceClaims.length === 0
  ) {
    fail(
      'MACHINE_WORK_LEDGER_INVALID',
      'sourceClaims must be a non-empty array',
    );
  }
  if (!Array.isArray(declaration.runtimeClaims)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'runtimeClaims must be an array');
  }
  for (const claim of declaration.sourceClaims) {
    if (
      !isObject(claim) ||
      Object.keys(claim).some((key) => !['pathPrefix', 'mode'].includes(key)) ||
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
      Object.keys(claim).some(
        (key) => !['kind', 'resourceId', 'mode'].includes(key),
      ) ||
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

export function validateDeclaration(declaration) {
  if (!isObject(declaration)) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration must be an object');
  }
  if (
    Object.keys(declaration).length !== DECLARATION_KEYS.size ||
    Object.keys(declaration).some((key) => !DECLARATION_KEYS.has(key))
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
  for (const field of [
    'workItemId',
    'sessionId',
  ]) {
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
    const milliseconds = Date.parse(declaration[field]);
    if (
      !Number.isFinite(milliseconds) ||
      new Date(milliseconds).toISOString() !== declaration[field]
    ) {
      fail('MACHINE_WORK_LEDGER_INVALID', `${field} is invalid`);
    }
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
  if (digestDeclaration(declaration) !== declaration.declarationDigest) {
    fail('MACHINE_WORK_LEDGER_INVALID', 'declaration digest mismatch', {
      declarationId: declaration.declarationId,
    });
  }
}
