import {
  canonicalDigest,
  equalStringSets,
  fail,
  isPlainObject,
  principalKey,
  samePrincipal,
  verifySignedDigest,
} from './canonical.mjs';

const REVIEW_CATEGORIES = new Set([
  'product',
  'content',
  'information-architecture',
  'journey',
  'state',
  'ui-identity',
  'accessibility',
  'performance',
  'evidence',
]);
const REVIEW_SEVERITIES = new Set(['blocking', 'warning']);
const REVIEW_DECISIONS = new Set([
  'accepted',
  'changes-required',
  'unproven',
]);

function assertClosed(value, required, optional, context) {
  if (!isPlainObject(value)) {
    fail('INDEPENDENT_REVIEW_REQUIRED', `${context} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      `${context} has unknown or missing fields`,
      { missing, unknown },
    );
  }
}

function assertString(value, context) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
  ) {
    fail('INDEPENDENT_REVIEW_REQUIRED', `${context} must be a valid string`);
  }
}

function assertReviewDigest(value, context) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      `${context} must be a sha256 digest`,
    );
  }
}

function assertReviewTimestamp(value, context) {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || new Date(value).toISOString() !== value
  ) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      `${context} must be a canonical UTC timestamp`,
    );
  }
}

function assertStringArray(value, context) {
  if (!Array.isArray(value)) {
    fail('INDEPENDENT_REVIEW_REQUIRED', `${context} must be an array`);
  }
  const seen = new Set();
  value.forEach((item, index) => {
    assertString(item, `${context}[${index}]`);
    if (seen.has(item)) {
      fail('INDEPENDENT_REVIEW_REQUIRED', `${context} contains a duplicate`, {
        value: item,
      });
    }
    seen.add(item);
  });
}

function validatePrincipal(principal, context) {
  assertClosed(principal, ['issuer', 'keyId', 'subject'], [], context);
  for (const key of ['issuer', 'keyId', 'subject']) {
    assertString(principal[key], `${context}.${key}`);
  }
}

function validateAttestation(attestation, context) {
  assertClosed(
    attestation,
    ['digest', 'principal', 'algorithm', 'signature'],
    [],
    context,
  );
  assertReviewDigest(attestation.digest, `${context}.digest`);
  validatePrincipal(attestation.principal, `${context}.principal`);
  if (attestation.algorithm !== 'ed25519') {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      `${context}.algorithm must be ed25519`,
    );
  }
  assertString(attestation.signature, `${context}.signature`);
}

function validateReviewerFinding(finding, context) {
  assertClosed(
    finding,
    [
      'id',
      'category',
      'severity',
      'location',
      'evidence',
      'observed',
      'consequence',
      'correction',
    ],
    [],
    context,
  );
  for (const key of [
    'id',
    'location',
    'evidence',
    'observed',
    'consequence',
    'correction',
  ]) {
    assertString(finding[key], `${context}.${key}`);
  }
  if (!REVIEW_CATEGORIES.has(finding.category)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      `${context}.category is unsupported`,
    );
  }
  if (!REVIEW_SEVERITIES.has(finding.severity)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      `${context}.severity is unsupported`,
    );
  }
}

function legalDecision(result, reviewerFindings) {
  const hasBlocking = reviewerFindings.some(
    (finding) => finding.severity === 'blocking',
  );
  if (hasBlocking) return 'changes-required';
  if (result.disposition === 'ready-for-independent-review') return 'accepted';
  if (result.disposition === 'changes-required') return 'changes-required';
  return 'unproven';
}

function inputAuthorKeys(experienceCase) {
  return new Set(
    [
      experienceCase.authorship.contractAuthor,
      experienceCase.authorship.candidateAuthor,
      ...experienceCase.authorship.evidenceAuthors,
      ...(experienceCase.authorship.expectationAuthor === undefined
        ? []
        : [experienceCase.authorship.expectationAuthor]),
      ...experienceCase.candidate.evidence
        .filter((record) => record.inspectedBy !== undefined)
        .map((record) => record.inspectedBy),
    ].map(principalKey),
  );
}

export function reviewReceiptPayload(receipt) {
  const payload = structuredClone(receipt);
  delete payload.attestation;
  return payload;
}

export function validateReviewReceipt(
  receipt,
  { loadedCase, result, trustedIssuers },
) {
  assertClosed(
    receipt,
    [
      'kind',
      'schemaVersion',
      'caseId',
      'caseDigest',
      'contractDigest',
      'candidateDigest',
      'resultDigest',
      'reviewer',
      'reviewedAt',
      'decision',
      'findingIds',
      'reviewerFindings',
      'attestation',
    ],
    [],
    'reviewReceipt',
  );
  if (
    receipt.kind !== 'peers-touch-experience-review'
    || receipt.schemaVersion !== 1
  ) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'review receipt identity is unsupported',
    );
  }
  assertString(receipt.caseId, 'reviewReceipt.caseId');
  for (const key of [
    'caseDigest',
    'contractDigest',
    'candidateDigest',
    'resultDigest',
  ]) {
    assertReviewDigest(receipt[key], `reviewReceipt.${key}`);
  }
  validatePrincipal(receipt.reviewer, 'reviewReceipt.reviewer');
  assertReviewTimestamp(receipt.reviewedAt, 'reviewReceipt.reviewedAt');
  if (!REVIEW_DECISIONS.has(receipt.decision)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'reviewReceipt.decision is unsupported',
    );
  }
  assertStringArray(receipt.findingIds, 'reviewReceipt.findingIds');
  if (!Array.isArray(receipt.reviewerFindings)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'reviewReceipt.reviewerFindings must be an array',
    );
  }
  receipt.reviewerFindings.forEach((finding, index) =>
    validateReviewerFinding(
      finding,
      `reviewReceipt.reviewerFindings[${index}]`,
    ));
  const reviewerFindingIds = receipt.reviewerFindings.map(
    (finding) => finding.id,
  );
  if (new Set(reviewerFindingIds).size !== reviewerFindingIds.length) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'reviewReceipt.reviewerFindings contains duplicate IDs',
    );
  }
  validateAttestation(receipt.attestation, 'reviewReceipt.attestation');

  const expectedResultDigest = canonicalDigest(result);
  const stale = [];
  if (receipt.caseId !== loadedCase.case.id) stale.push('caseId');
  if (receipt.caseDigest !== loadedCase.digests.case) stale.push('caseDigest');
  if (receipt.contractDigest !== loadedCase.digests.contract) {
    stale.push('contractDigest');
  }
  if (receipt.candidateDigest !== loadedCase.digests.candidate) {
    stale.push('candidateDigest');
  }
  if (receipt.resultDigest !== expectedResultDigest) stale.push('resultDigest');
  if (stale.length > 0) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'review receipt is stale for current immutable inputs',
      { stale },
    );
  }
  if (
    inputAuthorKeys(loadedCase.case).has(principalKey(receipt.reviewer))
  ) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'reviewer must be independent of all input authors and inspectors',
    );
  }
  const resultFindingIds = result.findings.map((finding) => finding.id);
  if (!equalStringSets(receipt.findingIds, resultFindingIds)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'receipt finding IDs do not exactly bind evaluator findings',
      {
        expected: [...resultFindingIds].sort(),
        actual: [...receipt.findingIds].sort(),
      },
    );
  }
  const expectedDecision = legalDecision(result, receipt.reviewerFindings);
  if (receipt.decision !== expectedDecision) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'review decision is incompatible with findings and evaluator disposition',
      { expected: expectedDecision, actual: receipt.decision },
    );
  }
  if (!samePrincipal(receipt.attestation.principal, receipt.reviewer)) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'review attestation principal must equal reviewer',
    );
  }
  const payloadDigest = canonicalDigest(reviewReceiptPayload(receipt));
  if (receipt.attestation.digest !== payloadDigest) {
    fail(
      'INDEPENDENT_REVIEW_REQUIRED',
      'review attestation digest is stale',
      { expected: payloadDigest, actual: receipt.attestation.digest },
    );
  }
  verifySignedDigest(
    receipt.attestation,
    trustedIssuers,
    'reviewReceipt.attestation',
  );
  return {
    valid: true,
    decision: receipt.decision,
    receiptDigest: canonicalDigest(receipt),
  };
}
