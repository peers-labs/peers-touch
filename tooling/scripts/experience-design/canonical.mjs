import { createHash } from 'node:crypto';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CANONICAL_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export class ExperienceDesignError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ExperienceDesignError';
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
  throw new ExperienceDesignError(code, message, details);
}

export function isPlainObject(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function canonicalDigest(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex')}`;
}

export function assertDigest(value, context) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    fail('ED-CONTRACT-001', `${context} must be a sha256 digest`);
  }
  return value;
}

export function assertCanonicalTimestamp(value, context) {
  if (
    typeof value !== 'string'
    || !CANONICAL_TIMESTAMP_PATTERN.test(value)
    || new Date(value).toISOString() !== value
  ) {
    fail(
      'ED-CONTRACT-001',
      `${context} must be a canonical UTC millisecond timestamp`,
    );
  }
  return value;
}

export function equalStringSets(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}
