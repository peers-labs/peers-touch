import {
  canonicalDigest,
  equalStringSets,
  isPlainObject,
} from './canonical.mjs';
import {
  evaluateExperienceCase,
} from './evaluator.mjs';
import {
  assertComparativeDigest,
  assertComparativeStableId,
  comparativeFail,
  readComparativeArtifact,
  validateArtifactRef,
} from './comparative-schema.mjs';
import { validateReviewReceipt } from './review-receipt.mjs';
import { loadExperienceCase } from './schema.mjs';

export const BLINDED_REPORT_KIND =
  'peers-touch-blinded-delta-report';
export const BLIND_REVIEW_KIND =
  'peers-touch-comparison-blind-review';
export const IDENTITY_MAP_KIND =
  'peers-touch-comparison-identity-map';
export const CAUSAL_REPORT_KIND =
  'peers-touch-causal-delta-report';
export const DISPOSITION_REVIEW_KIND =
  'peers-touch-comparison-disposition-review';
export const TARGET_PROJECTION_KIND =
  'peers-touch-target-contract-projection';

const SCHEMA_VERSION = 1;
const STABLE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONFIDENCES = ['high', 'medium', 'low'];
const BLIND_CAUSAL_STATUS = [
  'differential-observed',
  'mechanism-supported',
  'unproven',
];
const CAUSAL_STATUS = [
  ...BLIND_CAUSAL_STATUS,
  'intervention-confirmed',
];
const DELTA_KINDS = [
  'product-contract-absence',
  'product-contract-underfit',
  'candidate-drift',
  'execution-gap',
  'platform-adaptation-gap',
  'benchmark-liability',
  'evidence-gap',
];
const DISPOSITIONS = ['adopt', 'adapt', 'reject', 'defer'];
const JOURNEY_FREQUENCIES = ['frequent', 'periodic', 'rare'];
const USER_WORK_RISKS = ['high', 'medium', 'low', 'none'];
const CRITICALITY_RANK = new Map([
  ['safety', 0],
  ['blocking', 1],
  ['required', 2],
  ['quality', 3],
]);
const FREQUENCY_RANK = new Map(
  JOURNEY_FREQUENCIES.map((value, index) => [value, index]),
);
const WORK_RISK_RANK = new Map(
  USER_WORK_RISKS.map((value, index) => [value, index]),
);
const CAUSAL_RANK = new Map([
  ['mechanism-supported', 0],
  ['differential-observed', 1],
]);
const CONFIDENCE_RANK = new Map(
  CONFIDENCES.map((value, index) => [value, index]),
);
const TRUST_RECOVERY_KINDS = new Set([
  'failure',
  'unknown-outcome',
  'recovery',
  'offline',
  'degraded',
  'restored',
]);

function assertObject(value, required, optional, context, code) {
  if (!isPlainObject(value)) {
    comparativeFail(code, `${context} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key)).sort();
  const unknown = Object.keys(value)
    .filter((key) => !allowed.has(key))
    .sort();
  if (missing.length > 0 || unknown.length > 0) {
    comparativeFail(code, `${context} has an invalid field set`, {
      missing,
      unknown,
    });
  }
}

function assertArray(value, context, code, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    comparativeFail(
      code,
      `${context} must be an array with at least ${min} item(s)`,
    );
  }
}

function assertString(value, context, code, pattern = null) {
  if (
    typeof value !== 'string'
    || value.trim() === ''
    || (pattern !== null && !pattern.test(value))
  ) {
    comparativeFail(code, `${context} must be a valid non-empty string`);
  }
}

function assertTimestamp(value, context, code) {
  if (
    typeof value !== 'string'
    || !TIMESTAMP.test(value)
    || new Date(value).toISOString() !== value
  ) {
    comparativeFail(code, `${context} must be a canonical UTC timestamp`);
  }
}

function assertEnum(value, values, context, code) {
  if (!values.includes(value)) {
    comparativeFail(code, `${context} must be one of ${values.join(', ')}`);
  }
}

function assertUniqueStrings(
  value,
  context,
  code,
  { min = 0, stableIds = false, digests = false } = {},
) {
  assertArray(value, context, code, { min });
  value.forEach((item, index) => {
    if (stableIds) {
      assertComparativeStableId(item, `${context}[${index}]`, code);
    } else if (digests) {
      assertComparativeDigest(item, `${context}[${index}]`, code);
    } else {
      assertString(item, `${context}[${index}]`, code);
    }
  });
  if (new Set(value).size !== value.length) {
    comparativeFail(code, `${context} must contain unique values`);
  }
}

function indexById(values, context, code) {
  const result = new Map();
  values.forEach((value, index) => {
    assertComparativeStableId(value?.id, `${context}[${index}].id`, code);
    if (result.has(value.id)) {
      comparativeFail(code, `${context} contains duplicate id ${value.id}`);
    }
    result.set(value.id, value);
  });
  return result;
}

function assertKind(value, kind, context, code) {
  if (value.kind !== kind || value.schemaVersion !== SCHEMA_VERSION) {
    comparativeFail(code, `${context} kind or schemaVersion is unsupported`);
  }
}

function assertExactSet(actual, expected, context, code) {
  if (!equalStringSets(actual, expected)) {
    comparativeFail(code, `${context} does not match the required set`, {
      expected: [...expected].sort(),
      actual: [...actual].sort(),
    });
  }
}

function validateReviewerFinding(value, context, code) {
  assertObject(
    value,
    ['id', 'severity', 'observed', 'correction'],
    [],
    context,
    code,
  );
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertEnum(
    value.severity,
    ['blocking', 'warning'],
    `${context}.severity`,
    code,
  );
  assertString(value.observed, `${context}.observed`, code);
  assertString(value.correction, `${context}.correction`, code);
}

export function comparativePriorityTuple(delta, differential) {
  const outcomeBlocked = [differential.AResult, differential.BResult]
    .includes('not-met')
    && [differential.AResult, differential.BResult].includes('met');
  const trustOrRecoveryImpact =
    differential.criticality === 'safety'
    || differential.observableStateKinds.some((kind) =>
      TRUST_RECOVERY_KINDS.has(kind));
  return [
    CRITICALITY_RANK.get(differential.criticality),
    outcomeBlocked ? 0 : 1,
    trustOrRecoveryImpact ? 0 : 1,
    differential.earliestDivergentOrdinal,
    FREQUENCY_RANK.get(delta.journeyFrequency),
    WORK_RISK_RANK.get(delta.userWorkAtRisk),
    CAUSAL_RANK.get(delta.causalStatus),
    CONFIDENCE_RANK.get(delta.confidence),
    delta.id,
  ];
}

function compareTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue;
    if (typeof left[index] === 'string') {
      return left[index].localeCompare(right[index]);
    }
    return left[index] - right[index];
  }
  return 0;
}

function assertPriorityTuple(value, expected, context, code) {
  assertArray(value, context, code, { min: 9 });
  if (
    value.length !== expected.length
    || value.some((item, index) => item !== expected[index])
  ) {
    comparativeFail(code, `${context} is not the recomputed priority tuple`, {
      expected,
      actual: value,
    });
  }
}

export function validateBlindedDeltaReport(
  value,
  evaluation,
  context = 'BlindedDeltaReport',
) {
  const code = 'EDX_COMPARE_CAUSAL_OVERCLAIM';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'authorId',
      'comparisonEvaluationDigest',
      'identityLeakage',
      'deltas',
      'unprovenAssertionIds',
    ],
    [],
    context,
    code,
  );
  assertKind(value, BLINDED_REPORT_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.authorId, `${context}.authorId`, code);
  if (evaluation.authorIds.includes(value.authorId)) {
    comparativeFail(
      'EDX_COMPARE_REVIEW_REQUIRED',
      `${context}.authorId overlaps a paired-case author or reviewer`,
    );
  }
  assertComparativeDigest(
    value.comparisonEvaluationDigest,
    `${context}.comparisonEvaluationDigest`,
    code,
  );
  if (value.comparisonEvaluationDigest !== canonicalDigest(evaluation)) {
    comparativeFail(
      'EDX_COMPARE_PAIR_STALE',
      `${context} does not bind the current comparison evaluation`,
    );
  }
  assertEnum(
    value.identityLeakage,
    ['none', 'visible'],
    `${context}.identityLeakage`,
    code,
  );
  assertArray(value.deltas, `${context}.deltas`, code);
  indexById(value.deltas, `${context}.deltas`, code);
  const differentialById = new Map(
    evaluation.assertionDifferentials.map((item) => [item.id, item]),
  );
  value.deltas.forEach((delta, index) => {
    const item = `${context}.deltas[${index}]`;
    assertObject(
      delta,
      [
        'id',
        'differentialId',
        'oracleAssertionId',
        'earliestDivergentStateRefs',
        'causalStatus',
        'pairedFactIds',
        'mechanism',
        'userConsequence',
        'falsifier',
        'confidence',
        'journeyFrequency',
        'userWorkAtRisk',
        'priorityTuple',
      ],
      [],
      item,
      code,
    );
    assertComparativeStableId(delta.id, `${item}.id`, code);
    assertComparativeStableId(
      delta.differentialId,
      `${item}.differentialId`,
      code,
    );
    const differential = differentialById.get(delta.differentialId);
    if (
      differential === undefined
      || differential.classification !== 'result-difference'
      || differential.oracleAssertionId !== delta.oracleAssertionId
    ) {
      comparativeFail(
        code,
        `${item} must bind one material assertion differential`,
      );
    }
    assertComparativeStableId(
      delta.oracleAssertionId,
      `${item}.oracleAssertionId`,
      code,
    );
    assertObject(
      delta.earliestDivergentStateRefs,
      ['A', 'B'],
      [],
      `${item}.earliestDivergentStateRefs`,
      code,
    );
    for (const alias of ['A', 'B']) {
      assertComparativeStableId(
        delta.earliestDivergentStateRefs[alias],
        `${item}.earliestDivergentStateRefs.${alias}`,
        code,
      );
      if (
        delta.earliestDivergentStateRefs[alias]
        !== differential.earliestDivergentStateRefs[alias]
      ) {
        comparativeFail(
          code,
          `${item}.earliestDivergentStateRefs.${alias} is stale`,
        );
      }
    }
    assertEnum(
      delta.causalStatus,
      BLIND_CAUSAL_STATUS,
      `${item}.causalStatus`,
      code,
    );
    if (delta.causalStatus === 'unproven') {
      comparativeFail(
        code,
        `${item} cannot represent a material delta as causalStatus=unproven`,
      );
    }
    assertObject(
      delta.pairedFactIds,
      ['A', 'B'],
      [],
      `${item}.pairedFactIds`,
      code,
    );
    for (const alias of ['A', 'B']) {
      assertUniqueStrings(
        delta.pairedFactIds[alias],
        `${item}.pairedFactIds.${alias}`,
        code,
        { min: 1, stableIds: true },
      );
      const allowed = new Set(differential[`${alias}FactIds`]);
      if (delta.pairedFactIds[alias].some((id) => !allowed.has(id))) {
        comparativeFail(
          code,
          `${item}.pairedFactIds.${alias} contains unsupported facts`,
        );
      }
    }
    [
      'mechanism',
      'userConsequence',
      'falsifier',
    ].forEach((field) => assertString(delta[field], `${item}.${field}`, code));
    assertEnum(delta.confidence, CONFIDENCES, `${item}.confidence`, code);
    assertEnum(
      delta.journeyFrequency,
      JOURNEY_FREQUENCIES,
      `${item}.journeyFrequency`,
      code,
    );
    assertEnum(
      delta.userWorkAtRisk,
      USER_WORK_RISKS,
      `${item}.userWorkAtRisk`,
      code,
    );
    assertPriorityTuple(
      delta.priorityTuple,
      comparativePriorityTuple(delta, differential),
      `${item}.priorityTuple`,
      code,
    );
  });
  assertExactSet(
    value.deltas.map((delta) => delta.differentialId),
    evaluation.materialDifferentialIds,
    `${context}.differentials`,
    code,
  );
  const sorted = [...value.deltas].sort((left, right) =>
    compareTuples(left.priorityTuple, right.priorityTuple));
  if (sorted.some((delta, index) => delta.id !== value.deltas[index].id)) {
    comparativeFail(
      code,
      `${context}.deltas must follow deterministic priority order`,
    );
  }
  assertUniqueStrings(
    value.unprovenAssertionIds,
    `${context}.unprovenAssertionIds`,
    code,
    { stableIds: true },
  );
  assertExactSet(
    value.unprovenAssertionIds,
    evaluation.unprovenAssertionIds,
    `${context}.unprovenAssertionIds`,
    code,
  );
  return value;
}

export function validateBlindReview(
  value,
  evaluation,
  report,
  context = 'BlindReview',
) {
  const code = 'EDX_COMPARE_REVIEW_REQUIRED';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'reportDigest',
      'reviewerId',
      'reviewedAt',
      'decision',
      'deltaIds',
      'reviewNotes',
      'reviewerFindings',
    ],
    [],
    context,
    code,
  );
  assertKind(value, BLIND_REVIEW_KIND, context, code);
  assertComparativeDigest(value.reportDigest, `${context}.reportDigest`, code);
  if (value.reportDigest !== canonicalDigest(report)) {
    comparativeFail(
      'EDX_COMPARE_PAIR_STALE',
      `${context} does not bind the current blinded report`,
    );
  }
  assertComparativeStableId(value.reviewerId, `${context}.reviewerId`, code);
  assertTimestamp(value.reviewedAt, `${context}.reviewedAt`, code);
  assertEnum(
    value.decision,
    ['accepted', 'changes-required', 'unproven'],
    `${context}.decision`,
    code,
  );
  assertUniqueStrings(value.deltaIds, `${context}.deltaIds`, code, {
    stableIds: true,
  });
  assertExactSet(
    value.deltaIds,
    report.deltas.map((delta) => delta.id),
    `${context}.deltaIds`,
    code,
  );
  assertUniqueStrings(value.reviewNotes, `${context}.reviewNotes`, code);
  assertArray(value.reviewerFindings, `${context}.reviewerFindings`, code);
  indexById(value.reviewerFindings, `${context}.reviewerFindings`, code);
  value.reviewerFindings.forEach((finding, index) =>
    validateReviewerFinding(
      finding,
      `${context}.reviewerFindings[${index}]`,
      code,
    ));
  const forbiddenAuthors = new Set([...evaluation.authorIds, report.authorId]);
  if (forbiddenAuthors.has(value.reviewerId)) {
    comparativeFail(code, `${context}.reviewerId overlaps an input author`);
  }
  const hasBlocking = value.reviewerFindings.some(
    (finding) => finding.severity === 'blocking',
  );
  const expected = hasBlocking
    ? 'changes-required'
    : report.identityLeakage === 'visible'
      || evaluation.disposition === 'unproven'
      ? 'unproven'
      : 'accepted';
  if (value.decision !== expected) {
    comparativeFail(code, `${context}.decision is incompatible`, {
      expected,
      actual: value.decision,
    });
  }
  return value;
}

export function validateIdentityMap(
  value,
  {
    pairDigest,
    evaluationDigest,
    reportDigest,
    blindReviewDigest,
    blindReview,
    forbiddenAuthorIds,
  },
  context = 'IdentityMap',
) {
  const code = 'EDX_COMPARE_REVIEW_REQUIRED';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'pairedCaseDigest',
      'comparisonEvaluationDigest',
      'blindedDeltaDigest',
      'blindReviewDigest',
      'roles',
      'revealedById',
      'revealedAt',
      'peersBinding',
    ],
    [],
    context,
    code,
  );
  assertKind(value, IDENTITY_MAP_KIND, context, code);
  const bindings = {
    pairedCaseDigest: pairDigest,
    comparisonEvaluationDigest: evaluationDigest,
    blindedDeltaDigest: reportDigest,
    blindReviewDigest,
  };
  for (const [field, expected] of Object.entries(bindings)) {
    assertComparativeDigest(value[field], `${context}.${field}`, code);
    if (value[field] !== expected) {
      comparativeFail(
        'EDX_COMPARE_PAIR_STALE',
        `${context}.${field} is stale`,
      );
    }
  }
  if (blindReview.decision !== 'accepted') {
    comparativeFail(
      code,
      `${context} requires an accepted blind review before reveal`,
    );
  }
  assertObject(value.roles, ['A', 'B'], [], `${context}.roles`, code);
  assertEnum(value.roles.A, ['peers', 'reference'], `${context}.roles.A`, code);
  assertEnum(value.roles.B, ['peers', 'reference'], `${context}.roles.B`, code);
  if (value.roles.A === value.roles.B) {
    comparativeFail(code, `${context}.roles must map one Peers and one reference`);
  }
  assertComparativeStableId(
    value.revealedById,
    `${context}.revealedById`,
    code,
  );
  if (new Set(forbiddenAuthorIds).has(value.revealedById)) {
    comparativeFail(code, `${context}.revealedById overlaps a prior author`);
  }
  assertTimestamp(value.revealedAt, `${context}.revealedAt`, code);
  assertObject(
    value.peersBinding,
    ['legAlias', 'experienceCase', 'evaluationResult', 'reviewReceipt'],
    [],
    `${context}.peersBinding`,
    code,
  );
  assertEnum(
    value.peersBinding.legAlias,
    ['A', 'B'],
    `${context}.peersBinding.legAlias`,
    code,
  );
  if (value.roles[value.peersBinding.legAlias] !== 'peers') {
    comparativeFail(code, `${context}.peersBinding must bind the Peers leg`);
  }
  for (const field of ['experienceCase', 'evaluationResult', 'reviewReceipt']) {
    validateArtifactRef(
      value.peersBinding[field],
      `${context}.peersBinding.${field}`,
      code,
    );
  }
  return value;
}

function noOpValidator() {}

export function validateCurrentPeersBinding(
  identityMap,
  {
    packageRoot,
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot,
  },
) {
  const refs = identityMap.peersBinding;
  const caseArtifact = readComparativeArtifact(
    packageRoot,
    refs.experienceCase,
    'IdentityMap.peersBinding.experienceCase',
    noOpValidator,
    'EDX_COMPARE_LEG_INVALID',
  );
  const resultArtifact = readComparativeArtifact(
    packageRoot,
    refs.evaluationResult,
    'IdentityMap.peersBinding.evaluationResult',
    noOpValidator,
    'EDX_COMPARE_LEG_INVALID',
  );
  const receiptArtifact = readComparativeArtifact(
    packageRoot,
    refs.reviewReceipt,
    'IdentityMap.peersBinding.reviewReceipt',
    noOpValidator,
    'EDX_COMPARE_LEG_INVALID',
  );
  const loadedCase = loadExperienceCase(caseArtifact.absolute, {
    ruleCatalog,
    grammar,
  });
  const expectedResult = evaluateExperienceCase(loadedCase, {
    ruleCatalog,
    grammar,
    evaluatorVersionDigest,
    repoRoot,
  });
  if (
    canonicalDigest(resultArtifact.value) !== canonicalDigest(expectedResult)
  ) {
    comparativeFail(
      'EDX_COMPARE_PAIR_STALE',
      'Peers EDX evaluation is not current for its case and sources',
    );
  }
  validateReviewReceipt(receiptArtifact.value, {
    loadedCase,
    result: resultArtifact.value,
  });
  return {
    legAlias: refs.legAlias,
    experienceCaseDigest: caseArtifact.digest,
    evaluationResultDigest: resultArtifact.digest,
    reviewReceiptDigest: receiptArtifact.digest,
    bindingDigest: canonicalDigest({
      case: caseArtifact.digest,
      result: resultArtifact.digest,
      receipt: receiptArtifact.digest,
    }),
  };
}

function validateTargetProposal(value, context, code) {
  assertObject(
    value,
    [
      'id',
      'targetOwner',
      'affectedCapabilityIds',
      'affectedJourneyIds',
      'affectedStateIds',
      'changedPromise',
      'requiredAcceptanceIds',
      'requiredEvidence',
      'nonAdoptedBenchmarkDetails',
    ],
    [],
    context,
    code,
  );
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertString(value.targetOwner, `${context}.targetOwner`, code);
  for (const field of [
    'affectedCapabilityIds',
    'affectedJourneyIds',
    'affectedStateIds',
    'requiredAcceptanceIds',
  ]) {
    assertUniqueStrings(value[field], `${context}.${field}`, code, {
      min: 1,
      stableIds: true,
    });
  }
  assertString(value.changedPromise, `${context}.changedPromise`, code);
  assertUniqueStrings(
    value.requiredEvidence,
    `${context}.requiredEvidence`,
    code,
    { min: 1 },
  );
  assertUniqueStrings(
    value.nonAdoptedBenchmarkDetails,
    `${context}.nonAdoptedBenchmarkDetails`,
    code,
  );
}

export function validateCausalDeltaReport(
  value,
  {
    blindedReport,
    blindReview,
    identityMap,
    peersBinding,
    forbiddenAuthorIds = [],
  },
  context = 'CausalDeltaReport',
) {
  const code = 'EDX_COMPARE_CAUSAL_OVERCLAIM';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'authorId',
      'blindedDeltaDigest',
      'blindReviewDigest',
      'identityMapDigest',
      'peersBindingDigest',
      'deltas',
    ],
    [],
    context,
    code,
  );
  assertKind(value, CAUSAL_REPORT_KIND, context, code);
  assertComparativeStableId(value.id, `${context}.id`, code);
  assertComparativeStableId(value.authorId, `${context}.authorId`, code);
  if (new Set(forbiddenAuthorIds).has(value.authorId)) {
    comparativeFail(
      'EDX_COMPARE_REVIEW_REQUIRED',
      `${context}.authorId overlaps a blind-stage author or reviewer`,
    );
  }
  const expectedBindings = {
    blindedDeltaDigest: canonicalDigest(blindedReport),
    blindReviewDigest: canonicalDigest(blindReview),
    identityMapDigest: canonicalDigest(identityMap),
    peersBindingDigest: peersBinding.bindingDigest,
  };
  for (const [field, expected] of Object.entries(expectedBindings)) {
    assertComparativeDigest(value[field], `${context}.${field}`, code);
    if (value[field] !== expected) {
      comparativeFail('EDX_COMPARE_PAIR_STALE', `${context}.${field} is stale`);
    }
  }
  assertArray(value.deltas, `${context}.deltas`, code);
  indexById(value.deltas, `${context}.deltas`, code);
  assertExactSet(
    value.deltas.map((delta) => delta.blindedDeltaId),
    blindedReport.deltas.map((delta) => delta.id),
    `${context}.deltas`,
    code,
  );
  const blindedById = new Map(
    blindedReport.deltas.map((delta) => [delta.id, delta]),
  );
  value.deltas.forEach((delta, index) => {
    const item = `${context}.deltas[${index}]`;
    assertObject(
      delta,
      [
        'id',
        'blindedDeltaId',
        'revealedRoles',
        'kind',
        'ownerLayer',
        'proposedDisposition',
        'causalStatus',
        'interventionEvidenceDigests',
      ],
      ['targetProposal'],
      item,
      code,
    );
    assertComparativeStableId(delta.id, `${item}.id`, code);
    assertComparativeStableId(
      delta.blindedDeltaId,
      `${item}.blindedDeltaId`,
      code,
    );
    const blinded = blindedById.get(delta.blindedDeltaId);
    assertObject(
      delta.revealedRoles,
      ['A', 'B'],
      [],
      `${item}.revealedRoles`,
      code,
    );
    if (
      delta.revealedRoles.A !== identityMap.roles.A
      || delta.revealedRoles.B !== identityMap.roles.B
    ) {
      comparativeFail(code, `${item}.revealedRoles contradict IdentityMap`);
    }
    assertEnum(delta.kind, DELTA_KINDS, `${item}.kind`, code);
    assertString(delta.ownerLayer, `${item}.ownerLayer`, code);
    assertEnum(
      delta.proposedDisposition,
      DISPOSITIONS,
      `${item}.proposedDisposition`,
      code,
    );
    assertEnum(delta.causalStatus, CAUSAL_STATUS, `${item}.causalStatus`, code);
    assertUniqueStrings(
      delta.interventionEvidenceDigests,
      `${item}.interventionEvidenceDigests`,
      code,
      { digests: true },
    );
    if (
      delta.causalStatus === 'intervention-confirmed'
      && delta.interventionEvidenceDigests.length === 0
    ) {
      comparativeFail(
        code,
        `${item} requires intervention evidence for confirmed causality`,
      );
    }
    if (
      delta.causalStatus !== 'intervention-confirmed'
      && delta.causalStatus !== blinded.causalStatus
    ) {
      comparativeFail(
        code,
        `${item}.causalStatus may only preserve blind status or add intervention proof`,
      );
    }
    const needsTarget = ['adopt', 'adapt'].includes(
      delta.proposedDisposition,
    );
    if (needsTarget && delta.targetProposal === undefined) {
      comparativeFail(code, `${item}.targetProposal is required`);
    }
    if (!needsTarget && delta.targetProposal !== undefined) {
      comparativeFail(
        code,
        `${item}.targetProposal is forbidden for reject/defer`,
      );
    }
    if (delta.targetProposal !== undefined) {
      validateTargetProposal(
        delta.targetProposal,
        `${item}.targetProposal`,
        code,
      );
    }
  });
  const targetIds = value.deltas
    .filter((delta) => delta.targetProposal !== undefined)
    .map((delta) => delta.targetProposal.id);
  if (new Set(targetIds).size !== targetIds.length) {
    comparativeFail(code, `${context} contains duplicate target proposal IDs`);
  }
  return value;
}

export function validateDispositionReview(
  value,
  {
    causalReport,
    forbiddenAuthorIds,
  },
  context = 'DispositionReview',
) {
  const code = 'EDX_COMPARE_REVIEW_REQUIRED';
  assertObject(
    value,
    [
      'kind',
      'schemaVersion',
      'causalDeltaDigest',
      'reviewerId',
      'reviewedAt',
      'decision',
      'deltaDecisions',
      'reviewNotes',
      'reviewerFindings',
    ],
    [],
    context,
    code,
  );
  assertKind(value, DISPOSITION_REVIEW_KIND, context, code);
  assertComparativeDigest(
    value.causalDeltaDigest,
    `${context}.causalDeltaDigest`,
    code,
  );
  if (value.causalDeltaDigest !== canonicalDigest(causalReport)) {
    comparativeFail(
      'EDX_COMPARE_PAIR_STALE',
      `${context} does not bind the current CausalDeltaReport`,
    );
  }
  assertComparativeStableId(value.reviewerId, `${context}.reviewerId`, code);
  if (new Set([...forbiddenAuthorIds, causalReport.authorId]).has(value.reviewerId)) {
    comparativeFail(code, `${context}.reviewerId overlaps a prior author`);
  }
  assertTimestamp(value.reviewedAt, `${context}.reviewedAt`, code);
  assertEnum(
    value.decision,
    ['accepted', 'changes-required', 'unproven'],
    `${context}.decision`,
    code,
  );
  assertArray(value.deltaDecisions, `${context}.deltaDecisions`, code);
  indexById(value.deltaDecisions, `${context}.deltaDecisions`, code);
  assertExactSet(
    value.deltaDecisions.map((decision) => decision.deltaId),
    causalReport.deltas.map((delta) => delta.id),
    `${context}.deltaDecisions`,
    code,
  );
  value.deltaDecisions.forEach((decision, index) => {
    const item = `${context}.deltaDecisions[${index}]`;
    assertObject(
      decision,
      ['id', 'deltaId', 'decision', 'rationale'],
      [],
      item,
      code,
    );
    assertComparativeStableId(decision.deltaId, `${item}.deltaId`, code);
    assertEnum(
      decision.decision,
      ['accepted', 'rejected', 'deferred'],
      `${item}.decision`,
      code,
    );
    assertString(decision.rationale, `${item}.rationale`, code);
  });
  assertUniqueStrings(value.reviewNotes, `${context}.reviewNotes`, code);
  assertArray(value.reviewerFindings, `${context}.reviewerFindings`, code);
  indexById(value.reviewerFindings, `${context}.reviewerFindings`, code);
  value.reviewerFindings.forEach((finding, index) =>
    validateReviewerFinding(
      finding,
      `${context}.reviewerFindings[${index}]`,
      code,
    ));
  const hasBlocking = value.reviewerFindings.some(
    (finding) => finding.severity === 'blocking',
  );
  const hasUnproven = causalReport.deltas.some(
    (delta) => delta.causalStatus === 'unproven',
  );
  const expected = hasBlocking
    ? 'changes-required'
    : hasUnproven
      ? 'unproven'
      : 'accepted';
  if (value.decision !== expected) {
    comparativeFail(code, `${context}.decision is incompatible`, {
      expected,
      actual: value.decision,
    });
  }
  return value;
}

export function projectTargetContracts(
  causalReport,
  dispositionReview,
  { forbiddenAuthorIds = [] } = {},
) {
  validateDispositionReview(dispositionReview, {
    causalReport,
    forbiddenAuthorIds,
  });
  if (dispositionReview.decision !== 'accepted') {
    comparativeFail(
      'EDX_COMPARE_TARGET_UNAUTHORIZED',
      'Target projection requires an accepted disposition review',
    );
  }
  const reviewByDelta = new Map(
    dispositionReview.deltaDecisions.map((item) => [item.deltaId, item]),
  );
  const proposals = [];
  for (const delta of causalReport.deltas) {
    const reviewed = reviewByDelta.get(delta.id);
    if (
      reviewed.decision !== 'accepted'
      || !['adopt', 'adapt'].includes(delta.proposedDisposition)
    ) continue;
    if (delta.targetProposal === undefined) {
      comparativeFail(
        'EDX_COMPARE_TARGET_UNAUTHORIZED',
        `delta ${delta.id} has no accepted target proposal`,
      );
    }
    proposals.push({
      ...structuredClone(delta.targetProposal),
      causalDeltaId: delta.id,
      acceptedDisposition: delta.proposedDisposition,
    });
  }
  return {
    kind: TARGET_PROJECTION_KIND,
    schemaVersion: SCHEMA_VERSION,
    causalDeltaDigest: canonicalDigest(causalReport),
    dispositionReviewDigest: canonicalDigest(dispositionReview),
    proposals,
    nonClaims: [
      'Target proposals do not mutate active Product or Client contracts.',
      'Source validation does not prove framework incremental value.',
    ],
  };
}
