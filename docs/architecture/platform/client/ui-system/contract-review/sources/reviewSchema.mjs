export const REVIEW_RESULT_KIND = 'peers-touch-experience-review-result';
export const REVIEW_RESULT_SCHEMA_VERSION = 1;

export const VERDICTS = Object.freeze([
  'FINDINGS',
  'NO_BLOCKING_FINDING',
]);
export const SEVERITIES = Object.freeze(['blocking', 'major', 'minor']);
export const CONFIDENCES = Object.freeze(['high', 'medium', 'low']);
export const CONTRACT_AUTHORITIES = Object.freeze([
  'accepted-product',
  'accepted-client',
  'rubric',
]);
export const CASE_COVERAGE = Object.freeze(['explicit', 'supporting']);
export const STATE_ORIGINS = Object.freeze([
  'starting',
  'explicit',
  'derived',
]);
export const RECOVERY_DISTANCES = Object.freeze([
  'same-surface',
  'named-adjacent',
  'implicit',
]);
export const RETURN_TARGET_KINDS = Object.freeze([
  'keyboard-focus',
  'touch-anchor',
  'navigation',
]);
export const EXIT_AND_RETRY_KINDS = Object.freeze([
  'exit',
  'retry',
  'recovery',
]);
export const EVIDENCE_LEVELS = Object.freeze([
  'L1_CONTRACT',
  'L2_VISUAL',
  'L3_DYNAMIC',
  'L4_RUNTIME',
]);
export const ADMISSION_STAGES = Object.freeze([
  'review',
  'high-fidelity',
  'production',
]);
export const IMPACT_CLASSES = Object.freeze([
  'unsafe-trust-or-data-loss',
  'outcome-blocked',
  'recovery-absent',
  'visible-contradiction',
  'material-ambiguity',
  'accessibility-or-platform-parity',
  'implementation-risk',
  'polish',
]);

export const INELIGIBLE_REASONS = Object.freeze([
  'out-of-scope',
  'unreachable',
  'visible-action-missing',
  'visible-response-missing',
  'accepted-support-missing',
  'reference-invalid',
]);

const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const GIT_SHA1_PATTERN = /^[0-9a-f]{40}$/u;
const SHA256_BLOB_PATTERN = /^[0-9a-f]{64}$/u;
const SOURCE_HEAD_PATTERN = /^[0-9a-f]{40}$/u;

export class ExperienceReviewError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ExperienceReviewError';
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

export function fail(code, message, details) {
  throw new ExperienceReviewError(code, message, details);
}

export function isPlainObject(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function assertClosedObject(value, keys, context) {
  if (!isPlainObject(value)) {
    fail('EDX_RESULT_INVALID', `${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'EDX_RESULT_INVALID',
      `${context} has an invalid field set`,
      { actual, expected },
    );
  }
}

export function assertObjectShape(
  value,
  requiredKeys,
  optionalKeys,
  context,
) {
  if (!isPlainObject(value)) {
    fail('EDX_RESULT_INVALID', `${context} must be an object`);
  }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const unknown = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort();
  const missing = requiredKeys
    .filter((key) => !Object.hasOwn(value, key))
    .sort();
  if (unknown.length > 0 || missing.length > 0) {
    fail(
      'EDX_RESULT_INVALID',
      `${context} has an invalid field set`,
      { missing, unknown },
    );
  }
}

export function assertArray(value, context, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail(
      'EDX_RESULT_INVALID',
      `${context} must be an array with at least ${min} item(s)`,
    );
  }
  return value;
}

export function assertString(value, context, { pattern = null } = {}) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || (pattern !== null && !pattern.test(value))
  ) {
    fail('EDX_RESULT_INVALID', `${context} must be a valid non-empty string`);
  }
  return value;
}

export function assertOptionalString(value, context) {
  if (value !== undefined) assertString(value, context);
}

export function assertStableId(value, context) {
  return assertString(value, context, { pattern: STABLE_ID_PATTERN });
}

export function assertBoolean(value, context) {
  if (typeof value !== 'boolean') {
    fail('EDX_RESULT_INVALID', `${context} must be a boolean`);
  }
  return value;
}

export function assertInteger(
  value,
  context,
  { min = Number.MIN_SAFE_INTEGER } = {},
) {
  if (!Number.isSafeInteger(value) || value < min) {
    fail(
      'EDX_RESULT_INVALID',
      `${context} must be an integer greater than or equal to ${min}`,
    );
  }
  return value;
}

export function assertEnum(value, allowed, context) {
  if (!allowed.includes(value)) {
    fail(
      'EDX_RESULT_INVALID',
      `${context} must be one of ${allowed.join(', ')}`,
    );
  }
  return value;
}

export function assertUniqueStrings(
  value,
  context,
  { min = 0, stableIds = false } = {},
) {
  assertArray(value, context, { min });
  value.forEach((item, index) => {
    if (stableIds) {
      assertStableId(item, `${context}[${index}]`);
    } else {
      assertString(item, `${context}[${index}]`);
    }
  });
  if (new Set(value).size !== value.length) {
    fail('EDX_REFERENCE_INVALID', `${context} must contain unique values`);
  }
  return value;
}

export function assertUniqueIds(value, context) {
  const seen = new Set();
  value.forEach((item, index) => {
    const id = assertStableId(item?.id, `${context}[${index}].id`);
    if (seen.has(id)) {
      fail('EDX_REFERENCE_INVALID', `${context} contains duplicate id ${id}`);
    }
    seen.add(id);
  });
}

export function assertSha256Digest(value, context) {
  return assertString(value, context, { pattern: SHA256_DIGEST_PATTERN });
}

export function assertSourceHead(value, context) {
  return assertString(value, context, { pattern: SOURCE_HEAD_PATTERN });
}

export function assertSourceBlobDigest(value, algorithm, context) {
  const pattern = algorithm === 'git-sha1'
    ? GIT_SHA1_PATTERN
    : SHA256_BLOB_PATTERN;
  return assertString(value, context, { pattern });
}

export function assertSourceLocation(value, context) {
  assertObjectShape(
    value,
    ['path', 'lineStart', 'lineEnd'],
    ['symbol'],
    context,
  );
  assertString(value.path, `${context}.path`);
  assertInteger(value.lineStart, `${context}.lineStart`, { min: 1 });
  assertInteger(value.lineEnd, `${context}.lineEnd`, {
    min: value.lineStart,
  });
  assertOptionalString(value.symbol, `${context}.symbol`);
  return value;
}

export function indexById(values, context) {
  assertUniqueIds(values, context);
  return new Map(values.map((value) => [value.id, value]));
}

export function requireReference(index, id, context) {
  if (!index.has(id)) {
    fail('EDX_REFERENCE_INVALID', `${context} references unknown id ${id}`);
  }
  return index.get(id);
}

export function requireReferences(index, ids, context, options = {}) {
  assertUniqueStrings(ids, context, { ...options, stableIds: true });
  return ids.map((id) => requireReference(index, id, context));
}
