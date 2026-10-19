import fs from 'node:fs';
import path from 'node:path';

import {
  assertDigest,
  canonicalDigest,
  equalStringSets,
  fail,
  isPlainObject,
  principalKey,
  samePrincipal,
  verifySignedDigest,
} from './canonical.mjs';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const CALIBRATIONS = new Set(['positive', 'negative', 'boundary', 'blind']);
const CLAIMS = new Set(['wireflow', 'prototype', 'production']);
const PLATFORMS = new Set(['desktop', 'mobile', 'browser', 'dashboard']);
const COPY_ROLES = new Set([
  'brand',
  'title',
  'subtitle',
  'section-heading',
  'field-label',
  'helper',
  'status',
  'action',
  'error',
  'accessible-name',
]);
const REGION_ROLES = new Set([
  'content',
  'action',
  'trust',
  'floating',
  'recovery',
  'navigation',
]);
const STATE_KINDS = new Set([
  'entry',
  'empty',
  'loading',
  'waiting',
  'pending',
  'partial-success',
  'success',
  'failure',
  'unknown-outcome',
  'recovery',
  'cancelled',
  'offline',
  'degraded',
  'restored',
  'long-content',
  'narrow',
]);
const EVIDENCE_LEVELS = new Set([
  'L1_CONTRACT',
  'L2_VISUAL',
  'L3_DYNAMIC',
  'L4_RUNTIME',
]);
const INPUT_MODES = new Set([
  'source',
  'pointer',
  'keyboard',
  'touch',
  'assistive-technology',
  'reduced-motion',
]);
const CONTENT_MODES = new Set([
  'default',
  'empty',
  'long',
  'localization-expansion',
  'failure',
  'recovery',
]);
const EXCEPTION_REASONS = new Set([
  'accessibility',
  'safety',
  'separate-navigation-context',
]);
const RISKS = new Set(['routine', 'sensitive', 'destructive']);
const PATH_RISKS = new Set(['low', 'medium', 'high']);
const FREQUENCIES = new Set(['frequent', 'periodic', 'rare']);
const MUTATIONS = new Set([
  'none',
  'local',
  'external-reversible',
  'external-irreversible',
]);
const OPTION_CARDINALITIES = new Set(['none', 'binary', 'multiple', 'numeric']);
const INTERRUPTIONS = new Set([
  'none',
  'permission',
  'authentication',
  'setup',
]);
const CONFIRMATION_POLICIES = new Set([
  'none',
  'required',
  'required-when-irreversible',
  'server-authoritative',
]);
const CANDIDATE_CONFIRMATIONS = new Set([
  'none',
  'user-confirmed',
  'server-authorized',
]);
const EVIDENCE_STATUSES = new Set(['observed', 'unproven']);
const THEMES = new Set(['light', 'dark']);
const REQUESTED_THEMES = new Set(['light', 'dark', 'system']);
const COMPARATORS = new Set(['<=', '>=']);
const PERCENTILES = new Set(['p50', 'p75', 'p95', 'p99', 'single']);
const DISPOSITIONS = new Set([
  'changes-required',
  'ready-for-independent-review',
  'unproven',
]);
const RULE_SEVERITIES = new Set(['blocking', 'unproven', 'warning']);
const RULE_OWNERS = new Set([
  'product',
  'content',
  'information-architecture',
  'journey',
  'state',
  'ui-identity',
  'prototype',
  'platform',
  'implementation',
  'evidence',
]);

function assertClosedObject(value, required, optional, context) {
  if (!isPlainObject(value)) {
    fail('ED-CONTRACT-001', `${context} must be an object`);
  }
  const allowed = new Set([...required, ...optional]);
  const missing = required.filter((key) => !Object.hasOwn(value, key));
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail('ED-CONTRACT-001', `${context} has unknown or missing fields`, {
      missing,
      unknown,
    });
  }
  return value;
}

function assertArray(value, context, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min) {
    fail(
      'ED-CONTRACT-001',
      `${context} must be an array with at least ${min} item(s)`,
    );
  }
  return value;
}

function assertString(value, context, { allowEmpty = false } = {}) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || (!allowEmpty && value.length === 0)
  ) {
    fail('ED-CONTRACT-001', `${context} must be a valid string`);
  }
  return value;
}

function assertId(value, context) {
  assertString(value, context);
  if (!ID_PATTERN.test(value)) {
    fail('ED-CONTRACT-001', `${context} must be a stable ID`);
  }
  return value;
}

function assertEnum(value, allowed, context) {
  if (!allowed.has(value)) {
    fail('ED-CONTRACT-001', `${context} has an unsupported value`, {
      value,
      allowed: [...allowed],
    });
  }
  return value;
}

function assertBoolean(value, context) {
  if (typeof value !== 'boolean') {
    fail('ED-CONTRACT-001', `${context} must be boolean`);
  }
  return value;
}

function assertNumber(value, context, { min = 0, integer = false } = {}) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < min
    || (integer && !Number.isInteger(value))
  ) {
    fail('ED-CONTRACT-001', `${context} must be a valid number >= ${min}`);
  }
  return value;
}

function assertUnique(values, key, context) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    const candidate = key(value);
    if (seen.has(candidate)) {
      fail('ED-CONTRACT-001', `${context} contains a duplicate`, {
        index,
        value: candidate,
      });
    }
    seen.add(candidate);
  }
  return seen;
}

function assertStringArray(
  value,
  context,
  { min = 0, ids = false, allowed = null } = {},
) {
  const result = assertArray(value, context, { min });
  result.forEach((item, index) => {
    if (ids) assertId(item, `${context}[${index}]`);
    else assertString(item, `${context}[${index}]`);
    if (allowed !== null) assertEnum(item, allowed, `${context}[${index}]`);
  });
  assertUnique(result, (item) => item, context);
  return result;
}

function assertReference(value, targetSet, context) {
  assertId(value, context);
  if (!targetSet.has(value)) {
    fail('ED-CONTRACT-001', `${context} does not resolve`, { value });
  }
}

function assertReferenceArray(value, targetSet, context, { min = 0 } = {}) {
  assertStringArray(value, context, { min, ids: true });
  value.forEach((item, index) =>
    assertReference(item, targetSet, `${context}[${index}]`));
}

function assertExactCoverage(actual, expected, context) {
  if (!equalStringSets(actual, expected)) {
    fail('ED-CONTRACT-001', `${context} must exactly cover its contract`, {
      actual: [...actual].sort(),
      expected: [...expected].sort(),
    });
  }
}

function readJson(sourcePath, context) {
  let text;
  try {
    text = fs.readFileSync(sourcePath, 'utf8');
  } catch (error) {
    fail('ED-CONTRACT-001', `${context} is unreadable`, {
      path: sourcePath,
      reason: error.message,
    });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    fail('ED-CONTRACT-001', `${context} is not valid JSON`, {
      path: sourcePath,
      reason: error.message,
    });
  }
}

function validatePrincipal(value, context) {
  assertClosedObject(value, ['issuer', 'keyId', 'subject'], [], context);
  assertId(value.issuer, `${context}.issuer`);
  assertId(value.keyId, `${context}.keyId`);
  assertId(value.subject, `${context}.subject`);
}

function validateSignedDigest(value, context) {
  assertClosedObject(
    value,
    ['digest', 'principal', 'algorithm', 'signature'],
    [],
    context,
  );
  assertDigest(value.digest, `${context}.digest`);
  validatePrincipal(value.principal, `${context}.principal`);
  assertEnum(value.algorithm, new Set(['ed25519']), `${context}.algorithm`);
  assertString(value.signature, `${context}.signature`);
}

function validateMetric(value, context, { observation = false } = {}) {
  const fields = [
    'name',
    observation ? 'value' : 'comparator',
    observation ? null : 'threshold',
    'unit',
    'environment',
    'workload',
    'measurementMethod',
    'samplePolicy',
    'percentile',
  ].filter(Boolean);
  assertClosedObject(value, fields, [], context);
  assertId(value.name, `${context}.name`);
  if (observation) {
    assertNumber(value.value, `${context}.value`, { min: 0 });
  } else {
    assertEnum(value.comparator, COMPARATORS, `${context}.comparator`);
    assertNumber(value.threshold, `${context}.threshold`, { min: 0 });
  }
  for (const key of [
    'unit',
    'environment',
    'workload',
    'measurementMethod',
    'samplePolicy',
  ]) {
    assertString(value[key], `${context}.${key}`);
  }
  assertEnum(value.percentile, PERCENTILES, `${context}.percentile`);
}

function validateViewport(value, context) {
  assertClosedObject(
    value,
    ['widthCssPx', 'heightCssPx', 'devicePixelRatio'],
    [],
    context,
  );
  assertNumber(value.widthCssPx, `${context}.widthCssPx`, {
    min: 1,
    integer: true,
  });
  assertNumber(value.heightCssPx, `${context}.heightCssPx`, {
    min: 1,
    integer: true,
  });
  assertNumber(value.devicePixelRatio, `${context}.devicePixelRatio`, {
    min: 0.1,
  });
}

function validateRuleCatalogValue(value) {
  assertClosedObject(
    value,
    [
      'kind',
      'schemaVersion',
      'rules',
      'precedence',
      'readyDisposition',
      'readyExitCode',
    ],
    [],
    'ruleCatalog',
  );
  if (
    value.kind !== 'peers-touch-experience-rule-catalog'
    || value.schemaVersion !== 1
  ) {
    fail('ED-CONTRACT-001', 'ruleCatalog identity is unsupported');
  }
  assertArray(value.rules, 'ruleCatalog.rules', { min: 1 });
  const ids = assertUnique(value.rules, (item) => item?.id, 'ruleCatalog.rules');
  value.rules.forEach((rule, index) => {
    const context = `ruleCatalog.rules[${index}]`;
    assertClosedObject(
      rule,
      ['id', 'severity', 'disposition', 'exitCode', 'owner', 'condition'],
      [],
      context,
    );
    assertId(rule.id, `${context}.id`);
    assertEnum(rule.severity, RULE_SEVERITIES, `${context}.severity`);
    assertEnum(rule.disposition, DISPOSITIONS, `${context}.disposition`);
    assertNumber(rule.exitCode, `${context}.exitCode`, {
      min: 0,
      integer: true,
    });
    assertEnum(rule.owner, RULE_OWNERS, `${context}.owner`);
    assertString(rule.condition, `${context}.condition`);
  });
  assertStringArray(value.precedence, 'ruleCatalog.precedence', {
    min: 3,
    allowed: RULE_SEVERITIES,
  });
  if (!equalStringSets(value.precedence, [...RULE_SEVERITIES])) {
    fail('ED-CONTRACT-001', 'ruleCatalog.precedence must cover all severities');
  }
  assertEnum(
    value.readyDisposition,
    DISPOSITIONS,
    'ruleCatalog.readyDisposition',
  );
  assertNumber(value.readyExitCode, 'ruleCatalog.readyExitCode', {
    min: 0,
    integer: true,
  });
  return {
    value,
    rules: new Map(value.rules.map((rule) => [rule.id, rule])),
    ids,
    digest: canonicalDigest(value),
  };
}

export function loadRuleCatalog(sourcePath) {
  return validateRuleCatalogValue(readJson(sourcePath, 'rule catalog'));
}

function validateGrammarValue(value) {
  assertClosedObject(
    value,
    [
      'kind',
      'schemaVersion',
      'sourceDocuments',
      'actionRoles',
      'regionRoles',
      'stateRoles',
    ],
    [],
    'grammar',
  );
  if (value.kind !== 'peers-touch-ui-grammar-bindings' || value.schemaVersion !== 1) {
    fail('ED-CONTRACT-001', 'grammar identity is unsupported');
  }
  assertStringArray(value.sourceDocuments, 'grammar.sourceDocuments', {
    min: 1,
  });
  for (const [roleId, role] of Object.entries(value.actionRoles)) {
    assertId(roleId, `grammar.actionRoles.${roleId}`);
    const context = `grammar.actionRoles.${roleId}`;
    assertClosedObject(
      role,
      [
        'representations',
        'maxPerSurface',
        'allowedMutations',
        'allowedOptionCardinality',
        'confirmation',
        'desktopAdapters',
        'mobileAdapters',
        'browserAdapters',
        'dashboardAdapters',
      ],
      [],
      context,
    );
    if (!isPlainObject(role.representations) || Object.keys(role.representations).length === 0) {
      fail('ED-CONTRACT-001', `${context}.representations must be non-empty`);
    }
    for (const [representationId, representation] of Object.entries(
      role.representations,
    )) {
      assertId(representationId, `${context}.representations.${representationId}`);
      const representationContext =
        `${context}.representations.${representationId}`;
      assertClosedObject(
        representation,
        [
          'iconOnly',
          'accessibleLabel',
          'tooltip',
          'canonicalIconMeaning',
          'repeatedTool',
        ],
        [],
        representationContext,
      );
      Object.entries(representation).forEach(([key, candidate]) =>
        assertBoolean(candidate, `${representationContext}.${key}`));
    }
    if (role.maxPerSurface !== null) {
      assertNumber(role.maxPerSurface, `${context}.maxPerSurface`, {
        min: 1,
        integer: true,
      });
    }
    assertStringArray(role.allowedMutations, `${context}.allowedMutations`, {
      min: 1,
      allowed: MUTATIONS,
    });
    assertStringArray(
      role.allowedOptionCardinality,
      `${context}.allowedOptionCardinality`,
      { min: 1, allowed: OPTION_CARDINALITIES },
    );
    assertEnum(
      role.confirmation,
      new Set([...CONFIRMATION_POLICIES, 'contract-owned']),
      `${context}.confirmation`,
    );
    for (const platform of PLATFORMS) {
      assertStringArray(
        role[`${platform}Adapters`],
        `${context}.${platform}Adapters`,
        { min: 1, ids: true },
      );
    }
  }
  if (Object.keys(value.actionRoles).length === 0) {
    fail('ED-CONTRACT-001', 'grammar.actionRoles must be non-empty');
  }
  for (const [roleId, role] of Object.entries(value.regionRoles)) {
    assertEnum(roleId, REGION_ROLES, `grammar.regionRoles.${roleId}`);
    assertClosedObject(
      role,
      ['requiresSubject'],
      [],
      `grammar.regionRoles.${roleId}`,
    );
    assertBoolean(
      role.requiresSubject,
      `grammar.regionRoles.${roleId}.requiresSubject`,
    );
  }
  if (!equalStringSets(Object.keys(value.regionRoles), [...REGION_ROLES])) {
    fail('ED-CONTRACT-001', 'grammar.regionRoles must cover the closed taxonomy');
  }
  for (const [roleId, role] of Object.entries(value.stateRoles)) {
    assertEnum(roleId, STATE_KINDS, `grammar.stateRoles.${roleId}`);
    assertClosedObject(
      role,
      ['requiresVisibleMeaning'],
      [],
      `grammar.stateRoles.${roleId}`,
    );
    assertBoolean(
      role.requiresVisibleMeaning,
      `grammar.stateRoles.${roleId}.requiresVisibleMeaning`,
    );
  }
  if (!equalStringSets(Object.keys(value.stateRoles), [...STATE_KINDS])) {
    fail('ED-CONTRACT-001', 'grammar.stateRoles must cover the closed taxonomy');
  }
  return {
    value,
    digest: canonicalDigest(value),
    actionRoles: new Map(Object.entries(value.actionRoles)),
  };
}

export function loadGrammar(sourcePath) {
  return validateGrammarValue(readJson(sourcePath, 'UI grammar'));
}

function validateIssuerRegistryValue(value) {
  assertClosedObject(
    value,
    ['kind', 'schemaVersion', 'issuers'],
    [],
    'trustedIssuers',
  );
  if (
    value.kind !== 'peers-touch-experience-review-issuers'
    || value.schemaVersion !== 1
  ) {
    fail('ED-CONTRACT-001', 'trusted issuer registry identity is unsupported');
  }
  assertArray(value.issuers, 'trustedIssuers.issuers', { min: 1 });
  const keys = new Map();
  value.issuers.forEach((issuer, index) => {
    const context = `trustedIssuers.issuers[${index}]`;
    assertClosedObject(
      issuer,
      ['issuer', 'keyId', 'publicKeyPem', 'allowedSubjects'],
      [],
      context,
    );
    assertId(issuer.issuer, `${context}.issuer`);
    assertId(issuer.keyId, `${context}.keyId`);
    if (
      typeof issuer.publicKeyPem !== 'string'
      || !issuer.publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n')
      || !issuer.publicKeyPem.endsWith('-----END PUBLIC KEY-----\n')
    ) {
      fail('ED-CONTRACT-001', `${context}.publicKeyPem must be a public PEM`);
    }
    assertStringArray(issuer.allowedSubjects, `${context}.allowedSubjects`, {
      min: 1,
      ids: true,
    });
    const key = `${issuer.issuer}\u0000${issuer.keyId}`;
    if (keys.has(key)) {
      fail('ED-CONTRACT-001', 'trusted issuer registry contains duplicate key', {
        issuer: issuer.issuer,
        keyId: issuer.keyId,
      });
    }
    keys.set(key, {
      publicKeyPem: issuer.publicKeyPem,
      allowedSubjects: new Set(issuer.allowedSubjects),
    });
  });
  return { value, keys, digest: canonicalDigest(value) };
}

export function loadTrustedIssuers(sourcePath) {
  return validateIssuerRegistryValue(readJson(sourcePath, 'trusted issuers'));
}

function validateProductIntent(value, context) {
  assertClosedObject(
    value,
    [
      'capabilityIds',
      'journeyIds',
      'visibleStateIds',
      'acceptanceIds',
      'actor',
      'startingContext',
      'promisedOutcome',
      'firstUsefulResult',
      'recurringValue',
      'trustConstraints',
      'privacyConstraints',
      'authorityConstraints',
      'nonGoals',
    ],
    [],
    context,
  );
  for (const key of [
    'capabilityIds',
    'journeyIds',
    'visibleStateIds',
    'acceptanceIds',
  ]) {
    assertStringArray(value[key], `${context}.${key}`, { min: 1, ids: true });
  }
  for (const key of [
    'actor',
    'startingContext',
    'promisedOutcome',
    'firstUsefulResult',
    'recurringValue',
  ]) {
    assertString(value[key], `${context}.${key}`);
  }
  for (const key of [
    'trustConstraints',
    'privacyConstraints',
    'authorityConstraints',
    'nonGoals',
  ]) {
    assertStringArray(value[key], `${context}.${key}`, { min: 1 });
  }
}

function validatePathCost(value, context) {
  assertClosedObject(
    value,
    [
      'commitments',
      'contextSwitches',
      'decisionLoad',
      'interruptions',
      'recoveryDebt',
    ],
    [],
    context,
  );
  Object.entries(value).forEach(([key, candidate]) =>
    assertNumber(candidate, `${context}.${key}`, { min: 0, integer: true }));
}

function validateContract(value, context) {
  assertClosedObject(
    value,
    [
      'productIntent',
      'semantics',
      'informationArchitecture',
      'actions',
      'platformDifferences',
      'pathBudgets',
      'stateRequirements',
      'acceptedTrace',
      'requiredEvidence',
      'performanceBudgets',
    ],
    [],
    context,
  );
  validateProductIntent(value.productIntent, `${context}.productIntent`);
  const intent = value.productIntent;
  const capabilityIds = new Set(intent.capabilityIds);
  const journeyIds = new Set(intent.journeyIds);
  const visibleStateIds = new Set(intent.visibleStateIds);
  const acceptanceIds = new Set(intent.acceptanceIds);

  assertClosedObject(
    value.semantics,
    ['concepts'],
    [],
    `${context}.semantics`,
  );
  assertArray(value.semantics.concepts, `${context}.semantics.concepts`, {
    min: 1,
  });
  const conceptIds = assertUnique(
    value.semantics.concepts,
    (item) => item?.id,
    `${context}.semantics.concepts`,
  );
  value.semantics.concepts.forEach((concept, index) => {
    const itemContext = `${context}.semantics.concepts[${index}]`;
    assertClosedObject(
      concept,
      [
        'id',
        'meaning',
        'scope',
        'maxOccurrences',
        'allowedRoles',
        'exceptionReasons',
      ],
      [],
      itemContext,
    );
    assertId(concept.id, `${itemContext}.id`);
    assertString(concept.meaning, `${itemContext}.meaning`);
    assertId(concept.scope, `${itemContext}.scope`);
    assertNumber(concept.maxOccurrences, `${itemContext}.maxOccurrences`, {
      min: 0,
      integer: true,
    });
    assertStringArray(concept.allowedRoles, `${itemContext}.allowedRoles`, {
      min: 1,
      allowed: COPY_ROLES,
    });
    assertStringArray(
      concept.exceptionReasons,
      `${itemContext}.exceptionReasons`,
      { allowed: EXCEPTION_REASONS },
    );
  });

  assertClosedObject(
    value.informationArchitecture,
    ['surfaces'],
    [],
    `${context}.informationArchitecture`,
  );
  assertArray(
    value.informationArchitecture.surfaces,
    `${context}.informationArchitecture.surfaces`,
    { min: 1 },
  );
  const surfaceIds = assertUnique(
    value.informationArchitecture.surfaces,
    (item) => item?.id,
    `${context}.informationArchitecture.surfaces`,
  );
  value.informationArchitecture.surfaces.forEach((surface, index) => {
    const itemContext =
      `${context}.informationArchitecture.surfaces[${index}]`;
    assertClosedObject(
      surface,
      ['id', 'contextId', 'mainSubjectId', 'allowedRegionRoles'],
      [],
      itemContext,
    );
    assertId(surface.id, `${itemContext}.id`);
    assertId(surface.contextId, `${itemContext}.contextId`);
    assertId(surface.mainSubjectId, `${itemContext}.mainSubjectId`);
    assertStringArray(
      surface.allowedRegionRoles,
      `${itemContext}.allowedRegionRoles`,
      { min: 1, allowed: REGION_ROLES },
    );
  });

  assertArray(value.actions, `${context}.actions`, { min: 1 });
  const actionIds = assertUnique(
    value.actions,
    (item) => item?.id,
    `${context}.actions`,
  );
  value.actions.forEach((action, index) => {
    const itemContext = `${context}.actions[${index}]`;
    assertClosedObject(
      action,
      [
        'id',
        'intent',
        'risk',
        'frequency',
        'mutation',
        'optionCardinality',
        'canonicalIconMeaning',
        'repeatedTool',
        'reversible',
        'decisionCost',
        'interruption',
        'confirmationPolicy',
        'grammarRole',
        'allowedPlatformAdapters',
        'equivalentSurfaceIds',
      ],
      [
        'authoritativeOwner',
        'readbackContract',
        'expectedAuthorityResultId',
      ],
      itemContext,
    );
    assertId(action.id, `${itemContext}.id`);
    assertString(action.intent, `${itemContext}.intent`);
    assertEnum(action.risk, RISKS, `${itemContext}.risk`);
    assertEnum(action.frequency, FREQUENCIES, `${itemContext}.frequency`);
    assertEnum(action.mutation, MUTATIONS, `${itemContext}.mutation`);
    assertEnum(
      action.optionCardinality,
      OPTION_CARDINALITIES,
      `${itemContext}.optionCardinality`,
    );
    assertBoolean(
      action.canonicalIconMeaning,
      `${itemContext}.canonicalIconMeaning`,
    );
    assertBoolean(action.repeatedTool, `${itemContext}.repeatedTool`);
    assertBoolean(action.reversible, `${itemContext}.reversible`);
    assertEnum(action.decisionCost, new Set([0, 1, 2]), `${itemContext}.decisionCost`);
    assertEnum(action.interruption, INTERRUPTIONS, `${itemContext}.interruption`);
    assertEnum(
      action.confirmationPolicy,
      CONFIRMATION_POLICIES,
      `${itemContext}.confirmationPolicy`,
    );
    assertId(action.grammarRole, `${itemContext}.grammarRole`);
    assertClosedObject(
      action.allowedPlatformAdapters,
      [...PLATFORMS],
      [],
      `${itemContext}.allowedPlatformAdapters`,
    );
    for (const platform of PLATFORMS) {
      assertStringArray(
        action.allowedPlatformAdapters[platform],
        `${itemContext}.allowedPlatformAdapters.${platform}`,
        { min: 1, ids: true },
      );
    }
    assertReferenceArray(
      action.equivalentSurfaceIds,
      surfaceIds,
      `${itemContext}.equivalentSurfaceIds`,
      { min: 1 },
    );
    const authorityKeys = [
      'authoritativeOwner',
      'readbackContract',
      'expectedAuthorityResultId',
    ];
    const authorityCount = authorityKeys.filter((key) =>
      Object.hasOwn(action, key)).length;
    if (authorityCount !== 0 && authorityCount !== authorityKeys.length) {
      fail(
        'ED-CONTRACT-001',
        `${itemContext} authority fields must be all present or all absent`,
      );
    }
    if (authorityCount > 0) {
      assertId(action.authoritativeOwner, `${itemContext}.authoritativeOwner`);
      assertString(action.readbackContract, `${itemContext}.readbackContract`);
      assertId(
        action.expectedAuthorityResultId,
        `${itemContext}.expectedAuthorityResultId`,
      );
    }
  });

  assertArray(value.platformDifferences, `${context}.platformDifferences`);
  assertUnique(
    value.platformDifferences,
    (item) =>
      `${item?.actionContractId}\u0000${item?.left?.platform}`
      + `\u0000${item?.right?.platform}`,
    `${context}.platformDifferences`,
  );
  value.platformDifferences.forEach((difference, index) => {
    const itemContext = `${context}.platformDifferences[${index}]`;
    assertClosedObject(
      difference,
      ['actionContractId', 'left', 'right', 'rationale'],
      [],
      itemContext,
    );
    assertReference(
      difference.actionContractId,
      actionIds,
      `${itemContext}.actionContractId`,
    );
    for (const side of ['left', 'right']) {
      assertClosedObject(
        difference[side],
        ['platform', 'surfaceId', 'representation', 'adapter'],
        [],
        `${itemContext}.${side}`,
      );
      assertEnum(
        difference[side].platform,
        PLATFORMS,
        `${itemContext}.${side}.platform`,
      );
      assertReference(
        difference[side].surfaceId,
        surfaceIds,
        `${itemContext}.${side}.surfaceId`,
      );
      assertId(
        difference[side].representation,
        `${itemContext}.${side}.representation`,
      );
      assertId(difference[side].adapter, `${itemContext}.${side}.adapter`);
    }
    if (difference.left.platform === difference.right.platform) {
      fail('ED-CONTRACT-001', `${itemContext} must compare two platforms`);
    }
    assertString(difference.rationale, `${itemContext}.rationale`);
  });

  assertArray(value.pathBudgets, `${context}.pathBudgets`, { min: 1 });
  assertUnique(
    value.pathBudgets,
    (item) => item?.journeyId,
    `${context}.pathBudgets`,
  );
  value.pathBudgets.forEach((budget, index) => {
    const itemContext = `${context}.pathBudgets[${index}]`;
    assertClosedObject(
      budget,
      ['journeyId', 'frequency', 'risk', 'max'],
      [],
      itemContext,
    );
    assertReference(budget.journeyId, journeyIds, `${itemContext}.journeyId`);
    assertEnum(budget.frequency, FREQUENCIES, `${itemContext}.frequency`);
    assertEnum(budget.risk, PATH_RISKS, `${itemContext}.risk`);
    validatePathCost(budget.max, `${itemContext}.max`);
  });

  assertArray(value.stateRequirements, `${context}.stateRequirements`, {
    min: 1,
  });
  assertUnique(
    value.stateRequirements,
    (item) => item?.journeyId,
    `${context}.stateRequirements`,
  );
  value.stateRequirements.forEach((requirement, index) => {
    const itemContext = `${context}.stateRequirements[${index}]`;
    assertClosedObject(
      requirement,
      [
        'journeyId',
        'productStateIds',
        'requiredKinds',
        'preserveOnFailure',
        'authoritativeReadbackOnUnknown',
        'recoveryRequirements',
      ],
      [],
      itemContext,
    );
    assertReference(
      requirement.journeyId,
      journeyIds,
      `${itemContext}.journeyId`,
    );
    assertReferenceArray(
      requirement.productStateIds,
      visibleStateIds,
      `${itemContext}.productStateIds`,
      { min: 1 },
    );
    assertStringArray(
      requirement.requiredKinds,
      `${itemContext}.requiredKinds`,
      { min: 1, allowed: STATE_KINDS },
    );
    if (!requirement.requiredKinds.includes('entry')) {
      fail('ED-CONTRACT-001', `${itemContext}.requiredKinds must include entry`);
    }
    assertStringArray(
      requirement.preserveOnFailure,
      `${itemContext}.preserveOnFailure`,
      { ids: true },
    );
    assertBoolean(
      requirement.authoritativeReadbackOnUnknown,
      `${itemContext}.authoritativeReadbackOnUnknown`,
    );
    assertArray(
      requirement.recoveryRequirements,
      `${itemContext}.recoveryRequirements`,
    );
    assertUnique(
      requirement.recoveryRequirements,
      (item) => item?.sourceKind,
      `${itemContext}.recoveryRequirements`,
    );
    requirement.recoveryRequirements.forEach((recovery, recoveryIndex) => {
      const recoveryContext =
        `${itemContext}.recoveryRequirements[${recoveryIndex}]`;
      assertClosedObject(
        recovery,
        [
          'sourceKind',
          'allowedRecoveryActionContractIds',
          'requiredFocusTargetId',
          'allowedReturnKinds',
          'requiresAuthorityReconciliation',
        ],
        [],
        recoveryContext,
      );
      assertEnum(
        recovery.sourceKind,
        new Set(['failure', 'unknown-outcome']),
        `${recoveryContext}.sourceKind`,
      );
      assertReferenceArray(
        recovery.allowedRecoveryActionContractIds,
        actionIds,
        `${recoveryContext}.allowedRecoveryActionContractIds`,
        { min: 1 },
      );
      assertId(
        recovery.requiredFocusTargetId,
        `${recoveryContext}.requiredFocusTargetId`,
      );
      assertStringArray(
        recovery.allowedReturnKinds,
        `${recoveryContext}.allowedReturnKinds`,
        { min: 1, allowed: STATE_KINDS },
      );
      assertBoolean(
        recovery.requiresAuthorityReconciliation,
        `${recoveryContext}.requiresAuthorityReconciliation`,
      );
    });
  });

  assertArray(value.acceptedTrace, `${context}.acceptedTrace`, { min: 1 });
  assertUnique(
    value.acceptedTrace,
    (item) => item?.journeyId,
    `${context}.acceptedTrace`,
  );
  value.acceptedTrace.forEach((trace, index) => {
    const itemContext = `${context}.acceptedTrace[${index}]`;
    assertClosedObject(
      trace,
      [
        'capabilityId',
        'journeyId',
        'productStateIds',
        'acceptanceIds',
        'orderedStateKinds',
        'requiredActionIds',
      ],
      [],
      itemContext,
    );
    assertReference(
      trace.capabilityId,
      capabilityIds,
      `${itemContext}.capabilityId`,
    );
    assertReference(trace.journeyId, journeyIds, `${itemContext}.journeyId`);
    assertReferenceArray(
      trace.productStateIds,
      visibleStateIds,
      `${itemContext}.productStateIds`,
      { min: 1 },
    );
    assertReferenceArray(
      trace.acceptanceIds,
      acceptanceIds,
      `${itemContext}.acceptanceIds`,
      { min: 1 },
    );
    assertStringArray(
      trace.orderedStateKinds,
      `${itemContext}.orderedStateKinds`,
      { min: 2, allowed: STATE_KINDS },
    );
    assertReferenceArray(
      trace.requiredActionIds,
      actionIds,
      `${itemContext}.requiredActionIds`,
      { min: 1 },
    );
  });

  assertArray(value.requiredEvidence, `${context}.requiredEvidence`, {
    min: 1,
  });
  const evidenceRequirementIds = assertUnique(
    value.requiredEvidence,
    (item) => item?.id,
    `${context}.requiredEvidence`,
  );
  value.requiredEvidence.forEach((requirement, index) => {
    const itemContext = `${context}.requiredEvidence[${index}]`;
    assertClosedObject(
      requirement,
      [
        'id',
        'claimId',
        'level',
        'platform',
        'runtimeProfile',
        'inputMode',
        'locale',
        'viewport',
        'resolvedTheme',
        'contentMode',
        'stateIds',
        'assertionIds',
      ],
      ['metric'],
      itemContext,
    );
    assertId(requirement.id, `${itemContext}.id`);
    assertReference(requirement.claimId, acceptanceIds, `${itemContext}.claimId`);
    assertEnum(requirement.level, EVIDENCE_LEVELS, `${itemContext}.level`);
    assertEnum(requirement.platform, PLATFORMS, `${itemContext}.platform`);
    assertString(requirement.runtimeProfile, `${itemContext}.runtimeProfile`);
    assertEnum(requirement.inputMode, INPUT_MODES, `${itemContext}.inputMode`);
    assertString(requirement.locale, `${itemContext}.locale`);
    validateViewport(requirement.viewport, `${itemContext}.viewport`);
    assertEnum(requirement.resolvedTheme, THEMES, `${itemContext}.resolvedTheme`);
    assertEnum(requirement.contentMode, CONTENT_MODES, `${itemContext}.contentMode`);
    assertStringArray(requirement.stateIds, `${itemContext}.stateIds`, {
      min: 1,
      ids: true,
    });
    assertStringArray(requirement.assertionIds, `${itemContext}.assertionIds`, {
      min: 1,
      ids: true,
    });
    if (requirement.metric !== undefined) {
      validateMetric(requirement.metric, `${itemContext}.metric`);
    }
  });

  assertArray(value.performanceBudgets, `${context}.performanceBudgets`);
  const performanceBudgetIds = assertUnique(
    value.performanceBudgets,
    (item) => item?.id,
    `${context}.performanceBudgets`,
  );
  value.performanceBudgets.forEach((budget, index) => {
    const itemContext = `${context}.performanceBudgets[${index}]`;
    assertClosedObject(
      budget,
      ['id', 'claimId', 'platform', 'runtimeProfile', 'metric', 'evidenceRequirementId'],
      [],
      itemContext,
    );
    assertId(budget.id, `${itemContext}.id`);
    assertReference(budget.claimId, acceptanceIds, `${itemContext}.claimId`);
    assertEnum(budget.platform, PLATFORMS, `${itemContext}.platform`);
    assertString(budget.runtimeProfile, `${itemContext}.runtimeProfile`);
    validateMetric(budget.metric, `${itemContext}.metric`);
    assertReference(
      budget.evidenceRequirementId,
      evidenceRequirementIds,
      `${itemContext}.evidenceRequirementId`,
    );
    const evidenceRequirement = value.requiredEvidence.find(
      (item) => item.id === budget.evidenceRequirementId,
    );
    if (
      evidenceRequirement.metric === undefined
      || evidenceRequirement.claimId !== budget.claimId
      || evidenceRequirement.platform !== budget.platform
      || evidenceRequirement.runtimeProfile !== budget.runtimeProfile
      || canonicalDigest(evidenceRequirement.metric) !== canonicalDigest(budget.metric)
    ) {
      fail(
        'ED-CONTRACT-001',
        `${itemContext} must match its metric evidence requirement`,
      );
    }
  });

  assertExactCoverage(
    value.pathBudgets.map((item) => item.journeyId),
    intent.journeyIds,
    `${context}.pathBudgets journey coverage`,
  );
  assertExactCoverage(
    value.stateRequirements.map((item) => item.journeyId),
    intent.journeyIds,
    `${context}.stateRequirements journey coverage`,
  );
  assertExactCoverage(
    value.acceptedTrace.map((item) => item.journeyId),
    intent.journeyIds,
    `${context}.acceptedTrace journey coverage`,
  );
  const stateOwners = value.stateRequirements.flatMap(
    (item) => item.productStateIds,
  );
  assertExactCoverage(
    stateOwners,
    intent.visibleStateIds,
    `${context}.stateRequirements visible-state coverage`,
  );
  const traceStates = value.acceptedTrace.flatMap((item) => item.productStateIds);
  assertExactCoverage(
    traceStates,
    intent.visibleStateIds,
    `${context}.acceptedTrace visible-state coverage`,
  );
  const traceAcceptances = value.acceptedTrace.flatMap(
    (item) => item.acceptanceIds,
  );
  assertExactCoverage(
    traceAcceptances,
    intent.acceptanceIds,
    `${context}.acceptedTrace acceptance coverage`,
  );
  const evidenceClaims = new Set(
    value.requiredEvidence.map((item) => item.claimId),
  );
  assertExactCoverage(
    [...evidenceClaims],
    intent.acceptanceIds,
    `${context}.requiredEvidence acceptance coverage`,
  );

  return {
    capabilityIds,
    journeyIds,
    visibleStateIds,
    acceptanceIds,
    conceptIds,
    surfaceIds,
    actionIds,
    evidenceRequirementIds,
    performanceBudgetIds,
  };
}

function validateCandidate(value, context, contractRefs) {
  assertClosedObject(
    value,
    [
      'platform',
      'copyNodes',
      'surfaces',
      'actions',
      'authorityAssertions',
      'states',
      'transitions',
      'recoveryBranches',
      'journeys',
      'traces',
      'evidence',
    ],
    [],
    context,
  );
  assertEnum(value.platform, PLATFORMS, `${context}.platform`);

  assertArray(value.copyNodes, `${context}.copyNodes`, { min: 1 });
  const copyNodeIds = assertUnique(
    value.copyNodes,
    (item) => item?.id,
    `${context}.copyNodes`,
  );
  value.copyNodes.forEach((copy, index) => {
    const itemContext = `${context}.copyNodes[${index}]`;
    assertClosedObject(
      copy,
      ['id', 'surfaceId', 'scope', 'conceptId', 'role', 'text'],
      ['exceptionReason'],
      itemContext,
    );
    assertId(copy.id, `${itemContext}.id`);
    assertReference(copy.surfaceId, contractRefs.surfaceIds, `${itemContext}.surfaceId`);
    assertId(copy.scope, `${itemContext}.scope`);
    assertReference(copy.conceptId, contractRefs.conceptIds, `${itemContext}.conceptId`);
    assertEnum(copy.role, COPY_ROLES, `${itemContext}.role`);
    assertString(copy.text, `${itemContext}.text`);
    if (copy.exceptionReason !== undefined) {
      assertEnum(
        copy.exceptionReason,
        EXCEPTION_REASONS,
        `${itemContext}.exceptionReason`,
      );
    }
  });

  assertArray(value.surfaces, `${context}.surfaces`, { min: 1 });
  const surfaceIds = assertUnique(
    value.surfaces,
    (item) => item?.id,
    `${context}.surfaces`,
  );
  value.surfaces.forEach((surface, index) => {
    const itemContext = `${context}.surfaces[${index}]`;
    assertClosedObject(
      surface,
      ['id', 'contextId', 'mainSubjectIds', 'regions'],
      [],
      itemContext,
    );
    assertReference(surface.id, contractRefs.surfaceIds, `${itemContext}.id`);
    assertId(surface.contextId, `${itemContext}.contextId`);
    assertStringArray(surface.mainSubjectIds, `${itemContext}.mainSubjectIds`, {
      min: 1,
      ids: true,
    });
    assertArray(surface.regions, `${itemContext}.regions`, { min: 1 });
    assertUnique(surface.regions, (item) => item?.id, `${itemContext}.regions`);
    surface.regions.forEach((region, regionIndex) => {
      const regionContext = `${itemContext}.regions[${regionIndex}]`;
      assertClosedObject(
        region,
        ['id', 'role'],
        ['supportsSubjectId'],
        regionContext,
      );
      assertId(region.id, `${regionContext}.id`);
      assertEnum(region.role, REGION_ROLES, `${regionContext}.role`);
      if (region.supportsSubjectId !== undefined) {
        assertId(region.supportsSubjectId, `${regionContext}.supportsSubjectId`);
      }
    });
  });
  assertExactCoverage(
    [...surfaceIds],
    [...contractRefs.surfaceIds],
    `${context}.surfaces contract coverage`,
  );

  assertArray(value.actions, `${context}.actions`, { min: 1 });
  const actionIds = assertUnique(
    value.actions,
    (item) => item?.id,
    `${context}.actions`,
  );
  value.actions.forEach((action, index) => {
    const itemContext = `${context}.actions[${index}]`;
    assertClosedObject(
      action,
      [
        'id',
        'contractActionId',
        'surfaceId',
        'grammarRole',
        'representation',
        'platformAdapter',
        'primary',
        'confirmation',
      ],
      ['accessibleLabel', 'tooltip'],
      itemContext,
    );
    assertId(action.id, `${itemContext}.id`);
    assertReference(
      action.contractActionId,
      contractRefs.actionIds,
      `${itemContext}.contractActionId`,
    );
    assertReference(action.surfaceId, surfaceIds, `${itemContext}.surfaceId`);
    assertId(action.grammarRole, `${itemContext}.grammarRole`);
    assertId(action.representation, `${itemContext}.representation`);
    assertId(action.platformAdapter, `${itemContext}.platformAdapter`);
    assertBoolean(action.primary, `${itemContext}.primary`);
    assertEnum(
      action.confirmation,
      CANDIDATE_CONFIRMATIONS,
      `${itemContext}.confirmation`,
    );
    if (action.accessibleLabel !== undefined) {
      assertString(action.accessibleLabel, `${itemContext}.accessibleLabel`);
    }
    if (action.tooltip !== undefined) {
      assertString(action.tooltip, `${itemContext}.tooltip`);
    }
  });
  const candidateActionContracts = value.actions.map(
    (item) => item.contractActionId,
  );
  const candidateActionContractSet = new Set(candidateActionContracts);
  assertExactCoverage(
    [...candidateActionContractSet],
    [...contractRefs.actionIds],
    `${context}.actions contract coverage`,
  );

  assertArray(value.states, `${context}.states`, { min: 1 });
  const stateIds = assertUnique(
    value.states,
    (item) => item?.id,
    `${context}.states`,
  );
  value.states.forEach((state, index) => {
    const itemContext = `${context}.states[${index}]`;
    assertClosedObject(
      state,
      ['id', 'journeyId', 'surfaceId', 'kind', 'visibleMeaning'],
      [],
      itemContext,
    );
    assertId(state.id, `${itemContext}.id`);
    assertReference(
      state.journeyId,
      contractRefs.journeyIds,
      `${itemContext}.journeyId`,
    );
    assertReference(state.surfaceId, surfaceIds, `${itemContext}.surfaceId`);
    assertEnum(state.kind, STATE_KINDS, `${itemContext}.kind`);
    assertString(state.visibleMeaning, `${itemContext}.visibleMeaning`);
  });

  assertArray(value.transitions, `${context}.transitions`, { min: 1 });
  const transitionIds = assertUnique(
    value.transitions,
    (item) => item?.id,
    `${context}.transitions`,
  );
  value.transitions.forEach((transition, index) => {
    const itemContext = `${context}.transitions[${index}]`;
    assertClosedObject(
      transition,
      [
        'id',
        'journeyId',
        'fromStateId',
        'toStateId',
        'candidateActionId',
        'preserves',
        'authoritativeReadback',
      ],
      [],
      itemContext,
    );
    assertId(transition.id, `${itemContext}.id`);
    assertReference(
      transition.journeyId,
      contractRefs.journeyIds,
      `${itemContext}.journeyId`,
    );
    assertReference(transition.fromStateId, stateIds, `${itemContext}.fromStateId`);
    assertReference(transition.toStateId, stateIds, `${itemContext}.toStateId`);
    assertReference(
      transition.candidateActionId,
      actionIds,
      `${itemContext}.candidateActionId`,
    );
    assertStringArray(transition.preserves, `${itemContext}.preserves`, {
      ids: true,
    });
    assertBoolean(
      transition.authoritativeReadback,
      `${itemContext}.authoritativeReadback`,
    );
  });

  assertArray(value.authorityAssertions, `${context}.authorityAssertions`);
  const authorityAssertionIds = assertUnique(
    value.authorityAssertions,
    (item) => item?.id,
    `${context}.authorityAssertions`,
  );
  value.authorityAssertions.forEach((assertion, index) => {
    const itemContext = `${context}.authorityAssertions[${index}]`;
    assertClosedObject(
      assertion,
      [
        'id',
        'actionCandidateId',
        'transitionId',
        'authoritativeOwner',
        'readbackContract',
        'expectedAuthorityResultId',
        'evidenceRequirementId',
        'minimumEvidenceLevel',
      ],
      [],
      itemContext,
    );
    assertId(assertion.id, `${itemContext}.id`);
    assertReference(
      assertion.actionCandidateId,
      actionIds,
      `${itemContext}.actionCandidateId`,
    );
    assertReference(
      assertion.transitionId,
      transitionIds,
      `${itemContext}.transitionId`,
    );
    assertId(assertion.authoritativeOwner, `${itemContext}.authoritativeOwner`);
    assertString(assertion.readbackContract, `${itemContext}.readbackContract`);
    assertId(
      assertion.expectedAuthorityResultId,
      `${itemContext}.expectedAuthorityResultId`,
    );
    assertReference(
      assertion.evidenceRequirementId,
      contractRefs.evidenceRequirementIds,
      `${itemContext}.evidenceRequirementId`,
    );
    assertEnum(
      assertion.minimumEvidenceLevel,
      new Set(['L3_DYNAMIC', 'L4_RUNTIME']),
      `${itemContext}.minimumEvidenceLevel`,
    );
  });

  assertArray(value.recoveryBranches, `${context}.recoveryBranches`);
  assertUnique(
    value.recoveryBranches,
    (item) => item?.sourceStateId,
    `${context}.recoveryBranches`,
  );
  value.recoveryBranches.forEach((branch, index) => {
    const itemContext = `${context}.recoveryBranches[${index}]`;
    assertClosedObject(
      branch,
      [
        'sourceStateId',
        'recoveryTransitionId',
        'recoveryActionCandidateId',
        'preserves',
        'focusTargetId',
        'returnStateId',
      ],
      ['authorityAssertionId'],
      itemContext,
    );
    assertReference(branch.sourceStateId, stateIds, `${itemContext}.sourceStateId`);
    assertReference(
      branch.recoveryTransitionId,
      transitionIds,
      `${itemContext}.recoveryTransitionId`,
    );
    assertReference(
      branch.recoveryActionCandidateId,
      actionIds,
      `${itemContext}.recoveryActionCandidateId`,
    );
    assertStringArray(branch.preserves, `${itemContext}.preserves`, { ids: true });
    assertId(branch.focusTargetId, `${itemContext}.focusTargetId`);
    assertReference(branch.returnStateId, stateIds, `${itemContext}.returnStateId`);
    if (branch.authorityAssertionId !== undefined) {
      assertReference(
        branch.authorityAssertionId,
        authorityAssertionIds,
        `${itemContext}.authorityAssertionId`,
      );
    }
  });

  assertArray(value.journeys, `${context}.journeys`, { min: 1 });
  assertUnique(
    value.journeys,
    (item) => item?.journeyId,
    `${context}.journeys`,
  );
  value.journeys.forEach((journey, index) => {
    const itemContext = `${context}.journeys[${index}]`;
    assertClosedObject(
      journey,
      ['journeyId', 'startStateId', 'successStateId', 'steps'],
      [],
      itemContext,
    );
    assertReference(
      journey.journeyId,
      contractRefs.journeyIds,
      `${itemContext}.journeyId`,
    );
    assertReference(journey.startStateId, stateIds, `${itemContext}.startStateId`);
    assertReference(
      journey.successStateId,
      stateIds,
      `${itemContext}.successStateId`,
    );
    assertArray(journey.steps, `${itemContext}.steps`, { min: 1 });
    assertUnique(journey.steps, (item) => item?.id, `${itemContext}.steps`);
    assertUnique(
      journey.steps,
      (item) => item?.transitionId,
      `${itemContext}.steps transition use`,
    );
    journey.steps.forEach((step, stepIndex) => {
      const stepContext = `${itemContext}.steps[${stepIndex}]`;
      assertClosedObject(step, ['id', 'transitionId'], [], stepContext);
      assertId(step.id, `${stepContext}.id`);
      assertReference(
        step.transitionId,
        transitionIds,
        `${stepContext}.transitionId`,
      );
    });
  });
  assertExactCoverage(
    value.journeys.map((item) => item.journeyId),
    [...contractRefs.journeyIds],
    `${context}.journeys contract coverage`,
  );

  assertArray(value.traces, `${context}.traces`, { min: 1 });
  assertUnique(value.traces, (item) => item?.journeyId, `${context}.traces`);
  value.traces.forEach((trace, index) => {
    const itemContext = `${context}.traces[${index}]`;
    assertClosedObject(
      trace,
      [
        'capabilityId',
        'journeyId',
        'surfaceIds',
        'stateIds',
        'actionIds',
        'wireflowNodeIds',
        'evidenceIds',
      ],
      [],
      itemContext,
    );
    assertReference(
      trace.capabilityId,
      contractRefs.capabilityIds,
      `${itemContext}.capabilityId`,
    );
    assertReference(trace.journeyId, contractRefs.journeyIds, `${itemContext}.journeyId`);
    assertReferenceArray(trace.surfaceIds, surfaceIds, `${itemContext}.surfaceIds`, {
      min: 1,
    });
    assertReferenceArray(trace.stateIds, stateIds, `${itemContext}.stateIds`, {
      min: 1,
    });
    assertReferenceArray(trace.actionIds, actionIds, `${itemContext}.actionIds`, {
      min: 1,
    });
    assertStringArray(trace.wireflowNodeIds, `${itemContext}.wireflowNodeIds`, {
      min: 1,
      ids: true,
    });
    assertStringArray(trace.evidenceIds, `${itemContext}.evidenceIds`, {
      min: 1,
      ids: true,
    });
  });
  assertExactCoverage(
    value.traces.map((item) => item.journeyId),
    [...contractRefs.journeyIds],
    `${context}.traces contract coverage`,
  );
  const tracedSurfaceIds = new Set(value.traces.flatMap((item) => item.surfaceIds));
  assertExactCoverage(
    [...tracedSurfaceIds],
    [...surfaceIds],
    `${context}.traces surface coverage`,
  );
  const tracedActionIds = new Set(value.traces.flatMap((item) => item.actionIds));
  assertExactCoverage(
    [...tracedActionIds],
    [...actionIds],
    `${context}.traces action coverage`,
  );
  const tracedStateIds = new Set(value.traces.flatMap((item) => item.stateIds));
  assertExactCoverage(
    [...tracedStateIds],
    [...stateIds],
    `${context}.traces state coverage`,
  );

  assertArray(value.evidence, `${context}.evidence`);
  const evidenceIds = assertUnique(
    value.evidence,
    (item) => item?.id,
    `${context}.evidence`,
  );
  value.evidence.forEach((evidence, index) => {
    const itemContext = `${context}.evidence[${index}]`;
    assertClosedObject(
      evidence,
      [
        'id',
        'requirementId',
        'level',
        'status',
        'sourceDigest',
        'platform',
        'runtimeProfile',
        'inputMode',
        'locale',
        'viewport',
        'requestedTheme',
        'resolvedTheme',
        'contentMode',
        'stateIds',
        'assertionIds',
      ],
      [
        'artifact',
        'artifactDigest',
        'inspectedBy',
        'observedAt',
        'metricObservation',
      ],
      itemContext,
    );
    assertId(evidence.id, `${itemContext}.id`);
    assertReference(
      evidence.requirementId,
      contractRefs.evidenceRequirementIds,
      `${itemContext}.requirementId`,
    );
    assertEnum(evidence.level, EVIDENCE_LEVELS, `${itemContext}.level`);
    assertEnum(evidence.status, EVIDENCE_STATUSES, `${itemContext}.status`);
    assertDigest(evidence.sourceDigest, `${itemContext}.sourceDigest`);
    assertEnum(evidence.platform, PLATFORMS, `${itemContext}.platform`);
    assertString(evidence.runtimeProfile, `${itemContext}.runtimeProfile`);
    assertEnum(evidence.inputMode, INPUT_MODES, `${itemContext}.inputMode`);
    assertString(evidence.locale, `${itemContext}.locale`);
    validateViewport(evidence.viewport, `${itemContext}.viewport`);
    assertEnum(
      evidence.requestedTheme,
      REQUESTED_THEMES,
      `${itemContext}.requestedTheme`,
    );
    assertEnum(evidence.resolvedTheme, THEMES, `${itemContext}.resolvedTheme`);
    assertEnum(evidence.contentMode, CONTENT_MODES, `${itemContext}.contentMode`);
    assertStringArray(evidence.stateIds, `${itemContext}.stateIds`, {
      min: 1,
      ids: true,
    });
    assertStringArray(evidence.assertionIds, `${itemContext}.assertionIds`, {
      min: 1,
      ids: true,
    });
    if (evidence.artifact !== undefined) {
      assertString(evidence.artifact, `${itemContext}.artifact`);
      if (
        path.isAbsolute(evidence.artifact)
        || evidence.artifact.includes('\\')
        || evidence.artifact !== path.posix.normalize(evidence.artifact)
        || evidence.artifact === '.'
        || evidence.artifact.startsWith('../')
      ) {
        fail(
          'ED-CONTRACT-001',
          `${itemContext}.artifact must be a normalized repository-relative path`,
        );
      }
    }
    if (evidence.artifactDigest !== undefined) {
      assertDigest(evidence.artifactDigest, `${itemContext}.artifactDigest`);
    }
    if (evidence.inspectedBy !== undefined) {
      validatePrincipal(evidence.inspectedBy, `${itemContext}.inspectedBy`);
    }
    if (evidence.observedAt !== undefined) {
      const timestampPattern =
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
      if (
        !timestampPattern.test(evidence.observedAt)
        || new Date(evidence.observedAt).toISOString() !== evidence.observedAt
      ) {
        fail('ED-CONTRACT-001', `${itemContext}.observedAt must be canonical`);
      }
    }
    if (evidence.metricObservation !== undefined) {
      validateMetric(
        evidence.metricObservation,
        `${itemContext}.metricObservation`,
        { observation: true },
      );
    }
    if (evidence.status === 'observed' && evidence.level !== 'L1_CONTRACT') {
      for (const key of [
        'artifact',
        'artifactDigest',
        'inspectedBy',
        'observedAt',
      ]) {
        if (!Object.hasOwn(evidence, key)) {
          fail(
            'ED-CONTRACT-001',
            `${itemContext}.${key} is required for observed ${evidence.level}`,
          );
        }
      }
    }
  });

  for (const trace of value.traces) {
    assertReferenceArray(
      trace.evidenceIds,
      evidenceIds,
      `${context}.trace(${trace.journeyId}).evidenceIds`,
      { min: 1 },
    );
  }

  return {
    copyNodeIds,
    surfaceIds,
    actionIds,
    stateIds,
    transitionIds,
    authorityAssertionIds,
    evidenceIds,
  };
}

function validateExpected(value, context, ruleCatalog) {
  assertClosedObject(
    value,
    ['disposition', 'expectedRuleIds', 'expectedFindingIds'],
    [],
    context,
  );
  assertEnum(value.disposition, DISPOSITIONS, `${context}.disposition`);
  assertStringArray(value.expectedRuleIds, `${context}.expectedRuleIds`, {
    ids: true,
  });
  value.expectedRuleIds.forEach((ruleId, index) => {
    if (!ruleCatalog.rules.has(ruleId)) {
      fail('ED-CONTRACT-001', `${context}.expectedRuleIds[${index}] is unknown`, {
        ruleId,
      });
    }
  });
  assertStringArray(value.expectedFindingIds, `${context}.expectedFindingIds`, {
    ids: true,
  });
}

function validatePromotedFromBlind(value, context) {
  assertClosedObject(
    value,
    ['holdoutId', 'caseDigest', 'firstResultDigest', 'reviewReceiptDigest'],
    [],
    context,
  );
  assertId(value.holdoutId, `${context}.holdoutId`);
  assertDigest(value.caseDigest, `${context}.caseDigest`);
  assertDigest(value.firstResultDigest, `${context}.firstResultDigest`);
  assertDigest(value.reviewReceiptDigest, `${context}.reviewReceiptDigest`);
}

function validateAuthorship(value, context) {
  assertClosedObject(
    value,
    ['contractAuthor', 'candidateAuthor', 'evidenceAuthors'],
    ['expectationAuthor'],
    context,
  );
  validatePrincipal(value.contractAuthor, `${context}.contractAuthor`);
  validatePrincipal(value.candidateAuthor, `${context}.candidateAuthor`);
  assertArray(value.evidenceAuthors, `${context}.evidenceAuthors`, { min: 1 });
  value.evidenceAuthors.forEach((author, index) =>
    validatePrincipal(author, `${context}.evidenceAuthors[${index}]`));
  assertUnique(
    value.evidenceAuthors,
    principalKey,
    `${context}.evidenceAuthors`,
  );
  if (value.expectationAuthor !== undefined) {
    validatePrincipal(value.expectationAuthor, `${context}.expectationAuthor`);
  }
}

function validateSourceAttestations(value, context) {
  assertClosedObject(
    value,
    ['contract', 'candidate', 'evidence'],
    ['expectation'],
    context,
  );
  validateSignedDigest(value.contract, `${context}.contract`);
  validateSignedDigest(value.candidate, `${context}.candidate`);
  assertArray(value.evidence, `${context}.evidence`, { min: 1 });
  value.evidence.forEach((attestation, index) =>
    validateSignedDigest(attestation, `${context}.evidence[${index}]`));
  assertUnique(value.evidence, (item) => principalKey(item.principal), `${context}.evidence`);
  if (value.expectation !== undefined) {
    validateSignedDigest(value.expectation, `${context}.expectation`);
  }
}

function requiredLevelsForClaim(claim) {
  if (claim === 'wireflow') return ['L1_CONTRACT'];
  if (claim === 'prototype') {
    return ['L1_CONTRACT', 'L2_VISUAL', 'L3_DYNAMIC'];
  }
  return ['L1_CONTRACT', 'L2_VISUAL', 'L3_DYNAMIC', 'L4_RUNTIME'];
}

export function validateExperienceCaseValue(
  value,
  { ruleCatalog, grammar, trustedIssuers },
) {
  if (!ruleCatalog || !grammar || !trustedIssuers) {
    fail(
      'ED-CONTRACT-001',
      'case validation requires rule catalog, grammar, and trusted issuers',
    );
  }
  assertClosedObject(
    value,
    [
      'kind',
      'schemaVersion',
      'id',
      'title',
      'calibration',
      'claim',
      'authorship',
      'sourceAttestations',
      'contract',
      'candidate',
    ],
    ['expected', 'promotedFromBlind'],
    'case',
  );
  if (value.kind !== 'peers-touch-experience-case' || value.schemaVersion !== 1) {
    fail('ED-CONTRACT-001', 'case identity is unsupported');
  }
  assertId(value.id, 'case.id');
  assertString(value.title, 'case.title');
  assertEnum(value.calibration, CALIBRATIONS, 'case.calibration');
  assertEnum(value.claim, CLAIMS, 'case.claim');
  validateAuthorship(value.authorship, 'case.authorship');
  validateSourceAttestations(value.sourceAttestations, 'case.sourceAttestations');
  const contractRefs = validateContract(value.contract, 'case.contract');
  const candidateRefs = validateCandidate(
    value.candidate,
    'case.candidate',
    contractRefs,
  );

  const hasExpected = Object.hasOwn(value, 'expected');
  const hasExpectationAuthor = Object.hasOwn(
    value.authorship,
    'expectationAuthor',
  );
  const hasExpectationAttestation = Object.hasOwn(
    value.sourceAttestations,
    'expectation',
  );
  if (value.calibration === 'blind') {
    if (
      hasExpected
      || hasExpectationAuthor
      || hasExpectationAttestation
      || Object.hasOwn(value, 'promotedFromBlind')
    ) {
      fail(
        'ED-CONTRACT-001',
        'blind cases forbid expectations and promotion metadata',
      );
    }
  } else if (
    !hasExpected
    || !hasExpectationAuthor
    || !hasExpectationAttestation
  ) {
    fail(
      'ED-CONTRACT-001',
      'calibration cases require expected result and expectation attestation',
    );
  }
  if (hasExpected) {
    validateExpected(value.expected, 'case.expected', ruleCatalog);
  }
  if (value.promotedFromBlind !== undefined) {
    validatePromotedFromBlind(
      value.promotedFromBlind,
      'case.promotedFromBlind',
    );
  }

  const authors = [
    value.authorship.contractAuthor,
    value.authorship.candidateAuthor,
    ...value.authorship.evidenceAuthors,
  ];
  if (hasExpectationAuthor) {
    const expectationKey = principalKey(value.authorship.expectationAuthor);
    if (authors.some((author) => principalKey(author) === expectationKey)) {
      fail(
        'ED-CONTRACT-001',
        'expectation author must be independent of input authors',
      );
    }
  }
  if (
    !samePrincipal(
      value.sourceAttestations.contract.principal,
      value.authorship.contractAuthor,
    )
    || !samePrincipal(
      value.sourceAttestations.candidate.principal,
      value.authorship.candidateAuthor,
    )
  ) {
    fail(
      'ED-CONTRACT-001',
      'contract and candidate attestations must match declared authors',
    );
  }
  const evidenceAuthorKeys = value.authorship.evidenceAuthors.map(principalKey);
  const evidenceAttestationKeys = value.sourceAttestations.evidence.map(
    (item) => principalKey(item.principal),
  );
  assertExactCoverage(
    evidenceAttestationKeys,
    evidenceAuthorKeys,
    'case.sourceAttestations.evidence authors',
  );
  if (
    hasExpectationAuthor
    && !samePrincipal(
      value.sourceAttestations.expectation.principal,
      value.authorship.expectationAuthor,
    )
  ) {
    fail(
      'ED-CONTRACT-001',
      'expectation attestation must match declared expectation author',
    );
  }

  const candidateSource = {
    ...value.candidate,
    evidence: undefined,
  };
  delete candidateSource.evidence;
  const digests = {
    contract: canonicalDigest(value.contract),
    candidate: canonicalDigest(candidateSource),
    evidence: canonicalDigest(value.candidate.evidence),
    ...(hasExpected ? { expectation: canonicalDigest(value.expected) } : {}),
  };
  const attestationGroups = [
    ['contract', [value.sourceAttestations.contract]],
    ['candidate', [value.sourceAttestations.candidate]],
    ['evidence', value.sourceAttestations.evidence],
    ...(hasExpected
      ? [['expectation', [value.sourceAttestations.expectation]]]
      : []),
  ];
  for (const [name, attestations] of attestationGroups) {
    for (const [index, attestation] of attestations.entries()) {
      if (attestation.digest !== digests[name]) {
        fail('ED-CONTRACT-001', `${name} attestation digest is stale`, {
          expected: digests[name],
          actual: attestation.digest,
        });
      }
      verifySignedDigest(
        attestation,
        trustedIssuers,
        `case.sourceAttestations.${name}[${index}]`,
      );
    }
  }

  const evidenceAuthorSet = new Set(evidenceAuthorKeys);
  value.candidate.evidence.forEach((record, index) => {
    if (
      record.inspectedBy !== undefined
      && !evidenceAuthorSet.has(principalKey(record.inspectedBy))
    ) {
      fail(
        'ED-CONTRACT-001',
        `case.candidate.evidence[${index}].inspectedBy is not an evidence author`,
      );
    }
  });

  const requiredLevels = requiredLevelsForClaim(value.claim);
  const actualLevels = new Set(
    value.contract.requiredEvidence.map((item) => item.level),
  );
  for (const level of requiredLevels) {
    if (!actualLevels.has(level)) {
      fail(
        'ED-CONTRACT-001',
        `case.contract.requiredEvidence lacks ${level} for ${value.claim} claim`,
      );
    }
  }
  if (
    (value.claim === 'prototype' || value.claim === 'production')
    && value.contract.performanceBudgets.length === 0
  ) {
    fail(
      'ED-CONTRACT-001',
      `${value.claim} cases require a performance budget`,
    );
  }

  const traceContractSurfaceIds = new Set(
    value.candidate.traces.flatMap((trace) => trace.surfaceIds),
  );
  const traceContractActionIds = new Set(
    value.candidate.traces.flatMap((trace) =>
      trace.actionIds.map(
        (actionId) =>
          value.candidate.actions.find((item) => item.id === actionId)
            ?.contractActionId,
      )),
  );
  assertExactCoverage(
    [...traceContractSurfaceIds],
    [...contractRefs.surfaceIds],
    'candidate traces contract-surface coverage',
  );
  assertExactCoverage(
    [...traceContractActionIds],
    [...contractRefs.actionIds],
    'candidate traces contract-action coverage',
  );

  return {
    case: value,
    digests: {
      ...digests,
      case: canonicalDigest(value),
    },
    references: { contract: contractRefs, candidate: candidateRefs },
  };
}

export function loadExperienceCase(
  sourcePath,
  { ruleCatalog, grammar, trustedIssuers },
) {
  return validateExperienceCaseValue(readJson(sourcePath, 'experience case'), {
    ruleCatalog,
    grammar,
    trustedIssuers,
  });
}

export function validateSources({
  ruleCatalogPath,
  grammarPath,
  trustedIssuersPath,
}) {
  const ruleCatalog = loadRuleCatalog(ruleCatalogPath);
  const grammar = loadGrammar(grammarPath);
  const trustedIssuers = loadTrustedIssuers(trustedIssuersPath);
  return {
    ok: true,
    kind: 'peers-touch-experience-source-validation',
    schemaVersion: 1,
    digests: {
      rules: ruleCatalog.digest,
      grammar: grammar.digest,
      trustedIssuers: trustedIssuers.digest,
    },
  };
}

export const CLOSED_TAXONOMY = Object.freeze({
  calibrations: CALIBRATIONS,
  claims: CLAIMS,
  platforms: PLATFORMS,
  copyRoles: COPY_ROLES,
  regionRoles: REGION_ROLES,
  stateKinds: STATE_KINDS,
  evidenceLevels: EVIDENCE_LEVELS,
});
