import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';

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

export function principalKey(principal) {
  return `${principal.issuer}\u0000${principal.keyId}\u0000${principal.subject}`;
}

export function samePrincipal(left, right) {
  return principalKey(left) === principalKey(right);
}

export function equalStringSets(left, right) {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((value, index) => value === rightSorted[index]);
}

export function verifySignedDigest(attestation, registry, context) {
  const key = registry.keys.get(
    `${attestation.principal.issuer}\u0000${attestation.principal.keyId}`,
  );
  if (key === undefined) {
    fail('ED-CONTRACT-001', `${context} uses an untrusted issuer key`, {
      issuer: attestation.principal.issuer,
      keyId: attestation.principal.keyId,
    });
  }
  if (!key.allowedSubjects.has(attestation.principal.subject)) {
    fail('ED-CONTRACT-001', `${context} subject is not allowed by issuer key`, {
      subject: attestation.principal.subject,
    });
  }

  let signature;
  try {
    signature = Buffer.from(attestation.signature, 'base64');
  } catch {
    fail('ED-CONTRACT-001', `${context}.signature is not valid base64`);
  }
  let verified = false;
  try {
    verified = verifySignature(
      null,
      Buffer.from(attestation.digest, 'utf8'),
      createPublicKey(key.publicKeyPem),
      signature,
    );
  } catch (error) {
    fail('ED-CONTRACT-001', `${context} public key or signature is invalid`, {
      reason: error.message,
    });
  }
  if (!verified) {
    fail('ED-CONTRACT-001', `${context} signature does not verify`);
  }
}
