#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-completion-readiness-audit-controlled-gate.json');
const sharedFullE2EEvidencePath = path.join(evidenceDir, 'atelier-full-e2e.json');
const sharedCompletionAuditEvidencePath = path.join(evidenceDir, 'atelier-completion-readiness-audit.json');
const completionAuditScript = path.resolve('tooling/scripts/atelier-completion-readiness-audit.mjs');
const controlledWorkDir = path.resolve('tmp/atelier-completion-readiness-audit-controlled-gate');
const isolatedEvidenceRoot = path.join(controlledWorkDir, 'evidence-root');
const isolatedEvidenceDir = path.join(isolatedEvidenceRoot, 'applet-readiness-evidence/official-applet');
const isolatedFullE2EEvidencePath = path.join(controlledWorkDir, 'atelier-full-e2e.fixture.json');
const isolatedCompletionAuditEvidencePath = path.join(controlledWorkDir, 'atelier-completion-readiness-audit.fixture.json');
const independentIdeLaunchEvidencePath = 'applet-readiness-evidence/official-applet/atelier-full-e2e-ide-launch.json';
const independentProviderRuntimeEvidencePath = 'applet-readiness-evidence/official-applet/atelier-full-e2e-provider-runtime.json';

function controlledHash(value) {
  return `sha256:${createHash('sha256').update(String(value)).digest('hex')}`;
}

const completionAuditEnv = {
  ...process.env,
  PEERS_ATELIER_COMPLETION_READINESS_AUDIT_EVIDENCE_ROOT: isolatedEvidenceRoot,
  PEERS_ATELIER_COMPLETION_READINESS_AUDIT_FULL_E2E_PATH: isolatedFullE2EEvidencePath,
  PEERS_ATELIER_COMPLETION_READINESS_AUDIT_EVIDENCE_PATH: isolatedCompletionAuditEvidencePath,
};

const isolatedRequiredEvidencePaths = [
  'atelier-projection-contract-gate.json',
  'atelier-bridge-runtime-gate.json',
  'atelier-official-frontend-gate.json',
  'atelier-official-status-ui-gate.json',
  'atelier-sdk-lynx-bridge-unit-gate.json',
  'atelier-message-send-ingress-controlled-gate.json',
  'atelier-feedback-submit-ingress-controlled-gate.json',
  'atelier-confirmation-ingress-controlled-gate.json',
  'atelier-confirmation-outcome-controlled-gate.json',
  'atelier-feedback-memory-consumption-controlled-gate.json',
  'atelier-workspace-open-controlled-gate.json',
  'atelier-task-lifecycle-controlled-gate.json',
  'atelier-runtime-log-stream-controlled-gate.json',
  'atelier-artifact-renderer-controlled-gate.json',
  'atelier-artifact-renderer-live-controlled-gate.json',
  'atelier-artifact-body-fetch-controlled-gate.json',
  'atelier-host-storage-attachment-controlled-gate.json',
  'atelier-host-storage-attachment-browser-controlled-gate.json',
  'atelier-direct-run-execution-evidence-controlled-gate.json',
  'atelier-budget-surface-controlled-gate.json',
  'atelier-full-e2e-runtime-inputs-controlled-gate.json',
  'atelier-full-e2e-preflight-controlled-gate.json',
  'atelier-full-e2e-fail-closed-controlled-gate.json',
  'atelier-full-e2e-final-evidence-controlled-gate.json',
  'atelier-source-dist-integrity-policy-gate.json',
  'atelier-desktop-injection-gate.json',
  'atelier-real-product-gates-aggregate.json',
  'atelier-full-e2e-preflight.json',
  'atelier-real-product-gate.json',
  'atelier-product-window-gate.json',
  'atelier-product-window-failure-matrix-gate.json',
  'atelier-product-window-cross-restart-gate.json',
  'atelier-decision-product-window-gate.json',
  'atelier-live-resume-product-window-gate.json',
  'atelier-artifact-gate-product-window-gate.json',
  'atelier-artifact-body-fetch-product-window-gate.json',
  'atelier-artifact-gate-recovery-product-window-gate.json',
  'atelier-artifact-gate-recovery-accept-risk-product-window-gate.json',
  'atelier-artifact-gate-recovery-continue-product-window-gate.json',
  'atelier-artifact-gate-recovery-cancel-product-window-gate.json',
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'completion readiness audit preserves NOT_READY when full E2E evidence is missing or ok=false',
    'completion readiness audit can consume schema-valid ok=true full E2E evidence and mark final evidence PRESENT',
    'completion readiness audit rejects partial ok=true full E2E evidence instead of inferring READY',
    'completion readiness audit rejects shallow PASS child evidence when gate, evidenceClass, or semantic anchors drift',
    'completion readiness audit rejects shallow PASS real-product aggregate child evidence when gate, evidenceClass, or semantic anchors drift',
    'completion readiness audit validates final E2E controlled branch gate evidence coverage in both missing and ready branches',
    'completion readiness audit validates required real-product aggregate child gate coverage in both missing and ready branches',
    'completion readiness audit controlled ready branch is explicitly synthetic-only and cannot be reused as real environment readiness evidence',
    'completion readiness audit controlled fixtures do not mutate shared full E2E or completion audit evidence',
    'completion readiness audit branch behavior is repeatable without real Desktop/Station/provider runtime inputs',
  ],
  doesNotProve: [
    'real Desktop Host launch',
    'real Station service binding',
    'real applet UI actions',
    'real IDE launch',
    'production provider/model/runtime quality',
    'global Atelier readiness in the current environment',
  ],
};

const missingFinalEvidence = [
  {
    id: 'full-host-station-applet-e2e',
    status: 'MISSING',
    requiredEvidence: 'full Host + Station + applet E2E must be proven by real product path evidence',
  },
  {
    id: 'post-ready-applet-ui-actions',
    status: 'MISSING',
    requiredEvidence: 'post-ready applet UI actions must be proven by current-launch Host action evidence',
  },
  {
    id: 'real-ide-launch',
    status: 'MISSING',
    requiredEvidence: 'real IDE launch must be proven by independent Desktop Host evidence',
  },
  {
    id: 'production-provider-runtime-quality',
    status: 'MISSING',
    requiredEvidence: 'production provider/runtime quality must be proven by Station-owned runtime evidence',
  },
];

function runCompletionAudit() {
  const result = spawnSync(process.execPath, [completionAuditScript], {
    cwd: process.cwd(),
    env: completionAuditEnv,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `completion readiness audit failed: ${output}`);
  return {
    command: 'node tooling/scripts/atelier-completion-readiness-audit.mjs',
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-20),
    evidence: JSON.parse(readFileSync(isolatedCompletionAuditEvidencePath, 'utf8')),
  };
}

function prepareIsolatedEvidenceRoot() {
  mkdirSync(isolatedEvidenceDir, { recursive: true });
  for (const fileName of isolatedRequiredEvidencePaths) {
    copyFileSync(path.join(evidenceDir, fileName), path.join(isolatedEvidenceDir, fileName));
  }
}

function isolatedEvidencePath(fileName) {
  return path.join(isolatedEvidenceDir, fileName);
}

function mutateIsolatedEvidence(fileName, mutator) {
  const filePath = isolatedEvidencePath(fileName);
  const document = JSON.parse(readFileSync(filePath, 'utf8'));
  mutator(document);
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`);
}

function stableEvidenceText(filePath) {
  if (!existsSync(filePath)) {
    return '';
  }
  const document = JSON.parse(readFileSync(filePath, 'utf8'));
  for (const volatileKey of ['startedAt', 'completedAt', 'generatedAt', 'updatedAt']) {
    delete document[volatileKey];
  }
  return JSON.stringify(document);
}

function runCompletionAuditExpectFailure(fixtureName, expectedMessage) {
  const result = spawnSync(process.execPath, [completionAuditScript], {
    cwd: process.cwd(),
    env: completionAuditEnv,
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.notEqual(result.status, 0, `${fixtureName} must be rejected by completion readiness audit`);
  assert.ok(
    output.includes(expectedMessage),
    `${fixtureName} must fail with ${expectedMessage}; got: ${output}`,
  );
  return {
    command: 'node tooling/scripts/atelier-completion-readiness-audit.mjs',
    fixtureName,
    status: 'PASS',
    expectedMessage,
    outputTail: output.split(/\r?\n/).filter(Boolean).slice(-8),
  };
}

function writeMissingFullE2EFixture() {
  writeFileSync(
    isolatedFullE2EEvidencePath,
    `${JSON.stringify(
      {
        ok: false,
        evidenceClass: 'READINESS_AUDIT',
        gate: 'atelier:full-e2e',
        readiness: 'NOT_READY',
        globalReady: false,
        failureMode: 'MISSING_RUNTIME_INPUTS',
        missingRuntimeInputs: [
          {
            env: 'PEERS_ATELIER_FULL_E2E_STATION_URL',
            status: 'MISSING',
          },
        ],
        claimBoundary: {
          readiness: 'NOT_READY',
        },
        finalProofObligations: missingFinalEvidence,
        missingFinalEvidence,
      },
      null,
      2,
    )}\n`,
  );
}

function readyFullE2EFixture() {
  return {
    ok: true,
    evidenceClass: 'REAL_PRODUCT_PATH',
    gate: 'atelier:full-e2e',
    readiness: 'NOT_READY',
    globalReady: false,
    runtimeHandshakes: {
      stationWorkspace: { status: 'PASS' },
      providerCapabilities: { status: 'PASS' },
    },
    desktopLaunch: {
      status: 'PASS',
      readyEvidence: {
        launchId: 'controlled-launch',
        sessionId: 'controlled-session',
        stationUrlRedacted: true,
        stationUrlMatchesConfigured: true,
      },
    },
    postReadyActions: {
      workspaceOpen: {
        status: 'PASS',
        action: 'atelier.workspace.open',
        taskId: 'controlled-task',
        workspaceUri: 'pt-workspace://task/controlled-task?workspace=controlled-workspace',
        ideHintRedacted: true,
        ideTargetMatchesConfigured: true,
        mode: 'host_intent',
        accepted: true,
        opened: false,
        realIdeLaunchProven: false,
      },
    },
    ideLaunch: {
      path: independentIdeLaunchEvidencePath,
      status: 'PASS',
      ideTargetRedacted: true,
      ideTargetMatchesConfigured: true,
      resolver: 'controlled-workspace-resolver',
      launchOwner: 'desktop_host',
      realIdeLaunchProven: true,
    },
    providerRuntime: {
      path: independentProviderRuntimeEvidencePath,
      status: 'PASS',
      owner: 'station',
      scope: 'production-provider-runtime',
      providerProfileRefRedacted: true,
      providerProfileRefMatchesConfigured: true,
      providerRuntimeProven: true,
      providerModelQualityProven: true,
      streamingReplyUXProven: true,
      artifactPersistenceProven: true,
      traceCheckpointResumeProven: true,
    },
    claimBoundary: {
      readiness: 'NOT_READY',
      doesNotProve: ['global Atelier readiness'],
    },
    notCovered: ['global Atelier readiness'],
    doesNotProve: ['global Atelier readiness'],
  };
}

function independentIdeLaunchEvidence(fixture) {
  return {
    ok: true,
    launchId: fixture.desktopLaunch.readyEvidence.launchId,
    appletId: 'peers.atelier',
    sessionId: fixture.desktopLaunch.readyEvidence.sessionId,
    action: 'atelier.workspace.open',
    taskId: fixture.postReadyActions.workspaceOpen.taskId,
    workspaceUri: fixture.postReadyActions.workspaceOpen.workspaceUri,
    ideTargetRedacted: true,
    ideTargetHash: controlledHash('controlled-ide-target'),
    realIdeLaunchProven: true,
    launchOwner: 'desktop_host',
    resolver: 'controlled-workspace-resolver',
    launchCommand: 'controlled-ide-launch',
    appletFileShellExecuteExposed: false,
    appletOpenExternalUrlExposed: false,
    completedAt: '2026-07-08T00:00:00.000Z',
  };
}

function independentProviderRuntimeEvidence(fixture) {
  return {
    ok: true,
    launchId: fixture.desktopLaunch.readyEvidence.launchId,
    appletId: 'peers.atelier',
    sessionId: fixture.desktopLaunch.readyEvidence.sessionId,
    owner: 'station',
    scope: 'production-provider-runtime',
    providerProfileRefRedacted: true,
    providerProfileRefHash: controlledHash('controlled-provider-profile'),
    providerRuntimeProven: true,
    providerModelQualityProven: true,
    streamingReplyUXProven: true,
    artifactPersistenceProven: true,
    traceCheckpointResumeProven: true,
    appletProviderInvokeExposed: false,
    appletRuntimeExecuteExposed: false,
    appletArtifactWriteExposed: false,
    appletTraceCheckpointResumeExposed: false,
    completedAt: '2026-07-08T00:00:00.000Z',
  };
}

function writeIndependentEvidence(relativePath, document) {
  const absolutePath = path.join(isolatedEvidenceRoot, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(document, null, 2)}\n`);
}

function writeFullE2EFixture(fixture) {
  const skipIdeLaunchEvidence = fixture.__skipIdeLaunchEvidence === true;
  const skipProviderRuntimeEvidence = fixture.__skipProviderRuntimeEvidence === true;
  const ideLaunchEvidenceMutator = fixture.__ideLaunchEvidenceMutator;
  const providerRuntimeEvidenceMutator = fixture.__providerRuntimeEvidenceMutator;
  const fullE2EFixture = JSON.parse(JSON.stringify(fixture));
  delete fullE2EFixture.__skipIdeLaunchEvidence;
  delete fullE2EFixture.__skipProviderRuntimeEvidence;
  delete fullE2EFixture.__ideLaunchEvidenceMutator;
  delete fullE2EFixture.__providerRuntimeEvidenceMutator;

  rmSync(path.join(isolatedEvidenceRoot, independentIdeLaunchEvidencePath), { force: true });
  rmSync(path.join(isolatedEvidenceRoot, independentProviderRuntimeEvidencePath), { force: true });
  if (fullE2EFixture.ok === true && fullE2EFixture.ideLaunch?.path && !skipIdeLaunchEvidence) {
    const document = independentIdeLaunchEvidence(fullE2EFixture);
    if (typeof ideLaunchEvidenceMutator === 'function') {
      ideLaunchEvidenceMutator(document);
    }
    writeIndependentEvidence(fullE2EFixture.ideLaunch.path, document);
  }
  if (fullE2EFixture.ok === true && fullE2EFixture.providerRuntime?.path && !skipProviderRuntimeEvidence) {
    const document = independentProviderRuntimeEvidence(fullE2EFixture);
    if (typeof providerRuntimeEvidenceMutator === 'function') {
      providerRuntimeEvidenceMutator(document);
    }
    writeIndependentEvidence(fullE2EFixture.providerRuntime.path, document);
  }

  writeFileSync(
    isolatedFullE2EEvidencePath,
    `${JSON.stringify(fullE2EFixture, null, 2)}\n`,
  );
}

function writeReadyFullE2EFixture() {
  writeFullE2EFixture(readyFullE2EFixture());
}

function writePartialOkTrueFullE2EFixture(mutator) {
  const fixture = JSON.parse(JSON.stringify(readyFullE2EFixture()));
  mutator(fixture);
  writeFullE2EFixture(fixture);
}

function assertMissingBranch(audit) {
  assert.equal(audit.ok, true, 'completion audit missing branch must keep ok=true');
  assert.equal(audit.readiness, 'NOT_READY', 'completion audit missing branch must keep readiness=NOT_READY');
  assert.equal(audit.globalReady, false, 'completion audit missing branch must keep globalReady=false');
  assert.equal(audit.fullE2EFinalEvidence?.status, 'NOT_READY', 'missing branch must classify full E2E as NOT_READY');
  assert.equal(audit.fullE2EFinalEvidence?.failureMode, 'MISSING_RUNTIME_INPUTS', 'missing branch must preserve full E2E failureMode');
  assert.ok(audit.missingFinalEvidence?.length > 0, 'missing branch must keep final evidence obligations missing');
  assertMissingFinalEvidenceOperatorActions(audit.missingFinalEvidence, 'missing branch');
}

function assertReadyBranch(audit) {
  assert.equal(audit.ok, true, 'completion audit ready branch must keep ok=true');
  assert.equal(audit.readiness, 'READY', 'completion audit ready branch must mark readiness=READY');
  assert.equal(audit.globalReady, true, 'completion audit ready branch must mark globalReady=true');
  assert.equal(audit.fullE2EFinalEvidence?.status, 'PRESENT', 'ready branch must mark full E2E final evidence PRESENT');
  assert.equal(audit.missingFinalEvidence?.length, 0, 'ready branch must clear missing final evidence');
  assert.equal(audit.finalEvidence?.length, 4, 'ready branch must materialize all final evidence obligations');
}

function assertDescriptorSelfCheck(audit, label) {
  assert.equal(audit.descriptorSelfCheck?.status, 'PASS', `${label} descriptor self-check must pass`);
  assert.ok(
    audit.descriptorSelfCheck?.requiredEvidenceDescriptorCount > 0,
    `${label} descriptor self-check must count required evidence descriptors`,
  );
  assert.ok(
    audit.descriptorSelfCheck?.requiredRealProductAggregateDescriptorCount > 0,
    `${label} descriptor self-check must count real-product aggregate descriptors`,
  );
  assert.deepEqual(
    audit.descriptorSelfCheck?.zeroRequiredDescriptors,
    [],
    `${label} descriptor self-check must reject zero-required evidence descriptors`,
  );
  assert.deepEqual(
    audit.descriptorSelfCheck?.zeroRequiredAggregateDescriptors,
    [],
    `${label} descriptor self-check must reject zero-required aggregate descriptors`,
  );
  return audit.descriptorSelfCheck;
}

const expectedOperatorNextActions = {
  'full-host-station-applet-e2e': {
    primaryCommand: 'pnpm run atelier:full-e2e',
    prerequisiteCommands: [
      'pnpm run atelier:controlled-gates',
      'pnpm run atelier:real-product-gates',
      'pnpm run atelier:full-e2e-preflight',
    ],
    requiredRuntimeInputs: [
      'PEERS_ATELIER_FULL_E2E_STATION_URL',
      'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
      'PEERS_ATELIER_FULL_E2E_IDE',
      'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
    ],
    expectedEvidencePaths: [
      'applet-readiness-evidence/official-applet/atelier-full-e2e.json',
    ],
    acceptanceCriteriaIncludes: [
      'evidenceClass=REAL_PRODUCT_PATH',
      'Desktop Host, Station handshakes, post-ready applet action, real IDE launch, and provider/runtime quality',
    ],
  },
  'post-ready-applet-ui-actions': {
    primaryCommand: 'pnpm run atelier:full-e2e',
    prerequisiteCommands: ['pnpm run atelier:full-e2e-preflight'],
    requiredRuntimeInputs: [
      'PEERS_ATELIER_FULL_E2E_STATION_URL',
      'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
      'PEERS_ATELIER_FULL_E2E_IDE',
    ],
    expectedEvidencePaths: [
      'applet-readiness-evidence/official-applet/atelier-full-e2e-desktop-ready.json',
      'applet-readiness-evidence/official-applet/atelier-full-e2e-workspace-open.json',
    ],
    acceptanceCriteriaIncludes: [
      'launchId/sessionId match Desktop ready evidence',
      'workspace.open remains Host intent',
    ],
  },
  'real-ide-launch': {
    primaryCommand: 'pnpm run atelier:full-e2e',
    prerequisiteCommands: ['pnpm run atelier:full-e2e-preflight'],
    requiredRuntimeInputs: [
      'PEERS_ATELIER_FULL_E2E_DESKTOP_APP',
      'PEERS_ATELIER_FULL_E2E_IDE',
    ],
    expectedEvidencePaths: [
      'applet-readiness-evidence/official-applet/atelier-full-e2e-ide-launch.json',
    ],
    acceptanceCriteriaIncludes: [
      'independent current-launch Desktop Host evidence',
      'launchOwner=desktop_host',
    ],
  },
  'production-provider-runtime-quality': {
    primaryCommand: 'pnpm run atelier:full-e2e',
    prerequisiteCommands: ['pnpm run atelier:full-e2e-preflight'],
    requiredRuntimeInputs: [
      'PEERS_ATELIER_FULL_E2E_STATION_URL',
      'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE',
    ],
    expectedEvidencePaths: [
      'applet-readiness-evidence/official-applet/atelier-full-e2e-provider-runtime.json',
    ],
    acceptanceCriteriaIncludes: [
      'Station-owned and bound to the configured providerProfileRef',
      'provider runtime, model quality, streaming UX, artifact persistence, and trace/checkpoint/resume',
    ],
  },
};

function assertMissingFinalEvidenceOperatorActions(items, label) {
  assert.ok(Array.isArray(items), `${label} missing final evidence must be an array`);
  for (const item of items) {
    const expected = expectedOperatorNextActions[item?.id];
    assert.ok(expected, `${label} ${item?.id} must have expected operator action semantics`);
    const action = item.operatorNextAction;
    assert.equal(action?.primaryCommand, expected.primaryCommand, `${label} ${item.id} primaryCommand must run full E2E`);
    assert.deepEqual(
      action.prerequisiteCommands,
      expected.prerequisiteCommands,
      `${label} ${item.id} prerequisiteCommands must stay executable and ordered`,
    );
    assert.deepEqual(
      action.requiredRuntimeInputs,
      expected.requiredRuntimeInputs,
      `${label} ${item.id} requiredRuntimeInputs must match final evidence obligation`,
    );
    assert.deepEqual(
      action.expectedEvidencePaths,
      expected.expectedEvidencePaths,
      `${label} ${item.id} expectedEvidencePaths must match final evidence obligation`,
    );
    assert.ok(
      Array.isArray(action.acceptanceCriteria),
      `${label} ${item.id} must include acceptanceCriteria`,
    );
    for (const expectedCriterion of expected.acceptanceCriteriaIncludes) {
      assert.ok(
        action.acceptanceCriteria.some((criterion) => typeof criterion === 'string' && criterion.includes(expectedCriterion)),
        `${label} ${item.id} acceptanceCriteria must include ${expectedCriterion}`,
      );
    }
  }
}

function evidenceIds(items, label) {
  assert.ok(Array.isArray(items), `${label} must be an array`);
  return items.map((item) => {
    assert.equal(typeof item?.id, 'string', `${label} entries must include id`);
    assert.ok(item.id.trim(), `${label} entries must include non-empty id`);
    return item.id;
  });
}

function assertRealProductAggregateCoverage(audit, label) {
  assert.ok(Array.isArray(audit.realProductAggregateCoverage), `${label} must include realProductAggregateCoverage array`);
  const scripts = audit.realProductAggregateCoverage.map((entry) => entry?.script);
  for (const script of [
    'applet:atelier-real-product-gate',
    'applet:atelier-product-window-gate',
    'applet:atelier-product-window-failure-matrix-gate',
    'applet:atelier-product-window-cross-restart-gate',
    'applet:atelier-decision-product-window-gate',
    'applet:atelier-live-resume-product-window-gate',
    'applet:atelier-artifact-gate-product-window-gate',
    'applet:atelier-artifact-body-fetch-product-window-gate',
    'applet:atelier-artifact-gate-recovery-product-window-gate',
    'applet:atelier-artifact-gate-recovery-variants-product-window-gate',
  ]) {
    assert.ok(scripts.includes(script), `${label} realProductAggregateCoverage must include ${script}`);
  }
  return scripts;
}

function assertValidatedEvidenceCoverage(audit, label) {
  assert.ok(Array.isArray(audit.validatedEvidence), `${label} must include validatedEvidence array`);
  const paths = audit.validatedEvidence.map((entry) => entry?.path).filter(Boolean);
  for (const requiredPath of [
    'applet-readiness-evidence/official-applet/atelier-full-e2e-runtime-inputs-controlled-gate.json',
    'applet-readiness-evidence/official-applet/atelier-full-e2e-preflight-controlled-gate.json',
    'applet-readiness-evidence/official-applet/atelier-full-e2e-fail-closed-controlled-gate.json',
    'applet-readiness-evidence/official-applet/atelier-full-e2e-final-evidence-controlled-gate.json',
  ]) {
    assert.ok(paths.includes(requiredPath), `${label} validatedEvidence must include ${requiredPath}`);
  }
  return paths;
}

const partialOkTrueRejectionFixtures = [
  {
    id: 'partial-ok-true-desktop-ready-station-url-mismatch',
    mutate: (fixture) => {
      fixture.desktopLaunch.readyEvidence.stationUrlMatchesConfigured = false;
    },
    expectedMessage: 'Desktop ready aggregate must prove Station URL matched configured input',
  },
  {
    id: 'partial-ok-true-workspace-open',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.status = 'PARTIAL';
    },
    expectedMessage: 'must prove post-ready applet workspace action',
  },
  {
    id: 'partial-ok-true-workspace-open-wrong-action',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.action = 'provider.invoke';
    },
    expectedMessage: 'workspace open aggregate must prove atelier.workspace.open action',
  },
  {
    id: 'partial-ok-true-workspace-open-native-launch-mode',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.mode = 'native_launch';
    },
    expectedMessage: 'workspace open aggregate must remain a Host intent',
  },
  {
    id: 'partial-ok-true-workspace-open-not-accepted',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.accepted = false;
    },
    expectedMessage: 'workspace open aggregate must be accepted by Host intent',
  },
  {
    id: 'partial-ok-true-workspace-open-claims-opened',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.opened = true;
    },
    expectedMessage: 'workspace open aggregate must not claim IDE opened',
  },
  {
    id: 'partial-ok-true-workspace-open-claims-real-ide-launch',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.realIdeLaunchProven = true;
    },
    expectedMessage: 'workspace open aggregate must not claim real IDE launch',
  },
  {
    id: 'partial-ok-true-workspace-open-ide-target-mismatch',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.ideTargetMatchesConfigured = false;
    },
    expectedMessage: 'workspace open aggregate must prove IDE target matched configured input',
  },
  {
    id: 'partial-ok-true-workspace-open-file-url',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.workspaceUri = 'file:///tmp/workspace';
    },
    expectedMessage: 'workspace open aggregate must use pt-workspace URI',
  },
  {
    id: 'partial-ok-true-workspace-open-task-mismatch',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.workspaceUri = 'pt-workspace://task/other-task?workspace=controlled-workspace';
    },
    expectedMessage: 'workspace open aggregate task path must match taskId',
  },
  {
    id: 'partial-ok-true-workspace-open-missing-workspace-query',
    mutate: (fixture) => {
      fixture.postReadyActions.workspaceOpen.workspaceUri = 'pt-workspace://task/controlled-task';
    },
    expectedMessage: 'workspace open aggregate must include one workspace query',
  },
  {
    id: 'partial-ok-true-real-ide-launch',
    mutate: (fixture) => {
      fixture.ideLaunch.realIdeLaunchProven = false;
    },
    expectedMessage: 'must prove real IDE launch',
  },
  {
    id: 'partial-ok-true-provider-runtime',
    mutate: (fixture) => {
      fixture.providerRuntime.providerRuntimeProven = false;
    },
    expectedMessage: 'must prove provider runtime',
  },
  {
    id: 'partial-ok-true-provider-model-quality',
    mutate: (fixture) => {
      fixture.providerRuntime.providerModelQualityProven = false;
    },
    expectedMessage: 'must prove provider model quality',
  },
  {
    id: 'partial-ok-true-streaming-ux',
    mutate: (fixture) => {
      fixture.providerRuntime.streamingReplyUXProven = false;
    },
    expectedMessage: 'must prove streaming reply UX',
  },
  {
    id: 'partial-ok-true-artifact-persistence',
    mutate: (fixture) => {
      fixture.providerRuntime.artifactPersistenceProven = false;
    },
    expectedMessage: 'must prove artifact persistence',
  },
  {
    id: 'partial-ok-true-trace-checkpoint-resume',
    mutate: (fixture) => {
      fixture.providerRuntime.traceCheckpointResumeProven = false;
    },
    expectedMessage: 'must prove trace/checkpoint/resume',
  },
  {
    id: 'partial-ok-true-real-ide-launch-missing-evidence-path',
    mutate: (fixture) => {
      delete fixture.ideLaunch.path;
    },
    expectedMessage: 'real IDE launch evidence path must be a string',
  },
  {
    id: 'partial-ok-true-real-ide-launch-missing-evidence-file',
    mutate: (fixture) => {
      fixture.__skipIdeLaunchEvidence = true;
    },
    expectedMessage: `missing evidence: ${independentIdeLaunchEvidencePath}`,
  },
  {
    id: 'partial-ok-true-real-ide-launch-wrong-evidence-path',
    mutate: (fixture) => {
      fixture.ideLaunch.path = 'applet-readiness-evidence/official-applet/atelier-full-e2e-ide-launch-copy.json';
    },
    expectedMessage: `real IDE launch evidence path must be ${independentIdeLaunchEvidencePath}`,
  },
  {
    id: 'partial-ok-true-real-ide-launch-synthetic-side-evidence',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        evidence.syntheticOnly = true;
      };
    },
    expectedMessage: 'must not be syntheticOnly',
  },
  {
    id: 'partial-ok-true-real-ide-launch-controlled-side-evidence',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        evidence.controlledOnly = true;
        evidence.controlledFixture = true;
        evidence.evidenceClass = 'CONTROLLED_LOCAL_UPSTREAM';
        evidence.readiness = 'controlled_local_upstream';
      };
    },
    expectedMessage: 'must not be controlledOnly',
  },
  {
    id: 'partial-ok-true-real-ide-launch-missing-ide-target-hash',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        delete evidence.ideTargetHash;
      };
    },
    expectedMessage: 'must include ideTargetHash',
  },
  {
    id: 'partial-ok-true-real-ide-launch-missing-resolver',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        delete evidence.resolver;
      };
    },
    expectedMessage: 'must include workspace resolver',
  },
  {
    id: 'partial-ok-true-real-ide-launch-missing-launch-command',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        delete evidence.launchCommand;
      };
    },
    expectedMessage: 'must include launch command identifier',
  },
  {
    id: 'partial-ok-true-real-ide-launch-missing-completed-at',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        delete evidence.completedAt;
      };
    },
    expectedMessage: 'must include completedAt timestamp',
  },
  {
    id: 'partial-ok-true-real-ide-launch-aggregate-ide-target-mismatch',
    mutate: (fixture) => {
      fixture.ideLaunch.ideTargetMatchesConfigured = false;
    },
    expectedMessage: 'IDE launch aggregate must prove IDE target matched configured input',
  },
  {
    id: 'partial-ok-true-real-ide-launch-aggregate-resolver-mismatch',
    mutate: (fixture) => {
      fixture.ideLaunch.resolver = 'other-workspace-resolver';
    },
    expectedMessage: 'resolver must match final evidence',
  },
  {
    id: 'partial-ok-true-real-ide-launch-aggregate-owner-mismatch',
    mutate: (fixture) => {
      fixture.ideLaunch.launchOwner = 'applet';
    },
    expectedMessage: 'launchOwner must match final evidence',
  },
  {
    id: 'partial-ok-true-real-ide-launch-stale-session',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        evidence.sessionId = 'stale-session';
      };
    },
    expectedMessage: 'sessionId must match Desktop launch evidence',
  },
  {
    id: 'partial-ok-true-real-ide-launch-workspace-mismatch',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        evidence.workspaceUri = 'pt-workspace://task/other-task?workspace=other-workspace';
      };
    },
    expectedMessage: 'workspaceUri must match workspace open evidence',
  },
  {
    id: 'partial-ok-true-real-ide-launch-exposes-shell',
    mutate: (fixture) => {
      fixture.__ideLaunchEvidenceMutator = (evidence) => {
        evidence.appletFileShellExecuteExposed = true;
      };
    },
    expectedMessage: 'must not expose file/shell/execute to applet',
  },
  {
    id: 'partial-ok-true-provider-runtime-missing-evidence-path',
    mutate: (fixture) => {
      delete fixture.providerRuntime.path;
    },
    expectedMessage: 'provider/runtime quality evidence path must be a string',
  },
  {
    id: 'partial-ok-true-provider-runtime-missing-evidence-file',
    mutate: (fixture) => {
      fixture.__skipProviderRuntimeEvidence = true;
    },
    expectedMessage: `missing evidence: ${independentProviderRuntimeEvidencePath}`,
  },
  {
    id: 'partial-ok-true-provider-runtime-wrong-evidence-path',
    mutate: (fixture) => {
      fixture.providerRuntime.path = 'applet-readiness-evidence/official-applet/atelier-full-e2e-provider-runtime-copy.json';
    },
    expectedMessage: `provider/runtime quality evidence path must be ${independentProviderRuntimeEvidencePath}`,
  },
  {
    id: 'partial-ok-true-provider-runtime-synthetic-side-evidence',
    mutate: (fixture) => {
      fixture.__providerRuntimeEvidenceMutator = (evidence) => {
        evidence.syntheticOnly = true;
      };
    },
    expectedMessage: 'must not be syntheticOnly',
  },
  {
    id: 'partial-ok-true-provider-runtime-controlled-side-evidence',
    mutate: (fixture) => {
      fixture.__providerRuntimeEvidenceMutator = (evidence) => {
        evidence.controlledOnly = true;
        evidence.controlledFixture = true;
        evidence.evidenceClass = 'CONTROLLED_LOCAL_UPSTREAM';
        evidence.readiness = 'controlled_local_upstream';
      };
    },
    expectedMessage: 'must not be controlledOnly',
  },
  {
    id: 'partial-ok-true-provider-runtime-missing-completed-at',
    mutate: (fixture) => {
      fixture.__providerRuntimeEvidenceMutator = (evidence) => {
        delete evidence.completedAt;
      };
    },
    expectedMessage: 'must include completedAt timestamp',
  },
  {
    id: 'partial-ok-true-provider-runtime-aggregate-owner-mismatch',
    mutate: (fixture) => {
      fixture.providerRuntime.owner = 'applet';
    },
    expectedMessage: 'owner must match final evidence',
  },
  {
    id: 'partial-ok-true-provider-runtime-aggregate-scope-mismatch',
    mutate: (fixture) => {
      fixture.providerRuntime.scope = 'applet-provider-runtime';
    },
    expectedMessage: 'scope must match final evidence',
  },
  {
    id: 'partial-ok-true-provider-runtime-stale-session',
    mutate: (fixture) => {
      fixture.__providerRuntimeEvidenceMutator = (evidence) => {
        evidence.sessionId = 'stale-session';
      };
    },
    expectedMessage: 'sessionId must match Desktop launch evidence',
  },
  {
    id: 'partial-ok-true-provider-runtime-profile-mismatch',
    mutate: (fixture) => {
      fixture.providerRuntime.providerProfileRefMatchesConfigured = false;
    },
    expectedMessage: 'final aggregate must prove providerProfileRef matched configured input',
  },
  {
    id: 'partial-ok-true-provider-runtime-exposes-invoke',
    mutate: (fixture) => {
      fixture.__providerRuntimeEvidenceMutator = (evidence) => {
        evidence.appletProviderInvokeExposed = true;
      };
    },
    expectedMessage: 'must not expose provider invoke to applet',
  },
];

const finalEvidenceClaimBoundaryRejectionFixtures = [
  {
    id: 'final-evidence-synthetic-only',
    mutate: (fixture) => {
      fixture.syntheticOnly = true;
    },
    expectedMessage: 'ok=true evidence must not be syntheticOnly',
  },
  {
    id: 'final-evidence-missing-claim-boundary',
    mutate: (fixture) => {
      delete fixture.claimBoundary;
    },
    expectedMessage: 'ok=true evidence must keep claimBoundary.readiness=NOT_READY',
  },
  {
    id: 'final-evidence-missing-global-readiness-boundary',
    mutate: (fixture) => {
      fixture.claimBoundary.doesNotProve = [];
      fixture.notCovered = [];
      fixture.doesNotProve = [];
    },
    expectedMessage: 'must include final E2E required doesNotProve anchor',
  },
];

function removeSemanticAnchor(document, requiredAnchor) {
  if (Array.isArray(document.claimBoundary?.proves)) {
    document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
  }
  if (Array.isArray(document.proves)) {
    document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
  }
  if (Array.isArray(document.coveredPaths)) {
    document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
  }
}

function removeDoesNotProveAnchor(document, requiredAnchor) {
  if (Array.isArray(document.claimBoundary?.doesNotProve)) {
    document.claimBoundary.doesNotProve = document.claimBoundary.doesNotProve.filter((entry) => entry !== requiredAnchor);
  }
  if (Array.isArray(document.doesNotProve)) {
    document.doesNotProve = document.doesNotProve.filter((entry) => entry !== requiredAnchor);
  }
  if (Array.isArray(document.notCovered)) {
    document.notCovered = document.notCovered.filter((entry) => entry !== requiredAnchor);
  }
}

const semanticChildEvidenceRejectionFixtures = [
  {
    id: 'child-evidence-wrong-gate',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.gate = 'atelier:projection-contract-gate-stale-copy';
    },
    expectedMessage: 'must use gate=atelier:projection-contract-gate',
  },
  {
    id: 'child-evidence-wrong-evidence-class',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      document.evidenceClass = 'REAL_PRODUCT_PATH';
    },
    expectedMessage: 'must use evidenceClass=CONTROLLED_LOCAL_UPSTREAM',
  },
  {
    id: 'child-evidence-missing-semantic-anchor',
    fileName: 'atelier-full-e2e-final-evidence-controlled-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'full E2E runner validates current-launch Desktop ready, workspace open, IDE launch, and provider runtime evidence before ok=true';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-taskgraph-evidence-ref-resolution-anchor',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'TaskGraph evidenceRefResolution contract metadata is generated and consumed before unresolved refs are displayed';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-p4-readiness-doc-sync-anchor',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'Atelier P4 readiness slice documentation and ledger entries remain synchronized with NOT_READY boundaries';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-p4-doc-sync-self-check',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      delete document.docSyncSelfCheck;
    },
    expectedMessage: 'docSyncSelfCheck.status must be PASS',
  },
  {
    id: 'child-evidence-failed-p4-doc-sync-self-check',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck = {
        ...(document.docSyncSelfCheck ?? {}),
        status: 'FAIL',
      };
    },
    expectedMessage: 'docSyncSelfCheck.status must be PASS',
  },
  {
    id: 'child-evidence-incomplete-p4-doc-sync-self-check',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck = {
        ...(document.docSyncSelfCheck ?? {}),
        sliceCount: 8,
        trackedSliceIds: ['P4-222', 'P4-223', 'P4-224', 'P4-225'],
      };
    },
    expectedMessage: 'docSyncSelfCheck.sliceCount must cover P4 documentation-ledger guards',
  },
  {
    id: 'child-evidence-missing-recent-p4-288-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-288');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-288',
  },
  {
    id: 'child-evidence-missing-latest-p4-298-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-298');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-298',
  },
  {
    id: 'child-evidence-missing-latest-p4-299-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-299');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-299',
  },
  {
    id: 'child-evidence-missing-latest-p4-300-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-300');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-300',
  },
  {
    id: 'child-evidence-missing-latest-p4-301-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-301');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-301',
  },
  {
    id: 'child-evidence-missing-latest-p4-302-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-302');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-302',
  },
  {
    id: 'child-evidence-missing-latest-p4-303-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-303');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-303',
  },
  {
    id: 'child-evidence-missing-latest-p4-304-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-304');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-304',
  },
  {
    id: 'child-evidence-missing-latest-p4-305-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-305');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-305',
  },
  {
    id: 'child-evidence-missing-latest-p4-306-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-306');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-306',
  },
  {
    id: 'child-evidence-missing-latest-p4-307-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-307');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-307',
  },
  {
    id: 'child-evidence-missing-latest-p4-308-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-308');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-308',
  },
  {
    id: 'child-evidence-missing-latest-p4-309-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-309');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-309',
  },
  {
    id: 'child-evidence-missing-latest-p4-310-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-310');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-310',
  },
  {
    id: 'child-evidence-missing-latest-p4-311-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-311');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-311',
  },
  {
    id: 'child-evidence-missing-latest-p4-312-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-312');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-312',
  },
  {
    id: 'child-evidence-missing-latest-p4-313-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-313');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-313',
  },
  {
    id: 'child-evidence-missing-latest-p4-314-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = document.docSyncSelfCheck.trackedSliceIds.filter((id) => id !== 'P4-314');
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must include P4-314',
  },
  {
    id: 'child-evidence-extra-unregistered-p4-doc-sync-tracking',
    fileName: 'atelier-projection-contract-gate.json',
    mutate: (document) => {
      document.docSyncSelfCheck.trackedSliceIds = [...document.docSyncSelfCheck.trackedSliceIds, 'P4-999'];
      document.docSyncSelfCheck.sliceCount = document.docSyncSelfCheck.trackedSliceIds.length;
    },
    expectedMessage: 'docSyncSelfCheck.trackedSliceIds must match projection contract registry',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-envelope-unit-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge unit matrix unwraps canonical object and string envelopes before applet capability consumers observe results',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-ui-generated-matrix-anchor',
    fileName: 'atelier-official-status-ui-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'official Atelier status UI unit matrix covers loading empty disconnected auth-denied error reconciling degraded and ready statuses from generated contract',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-ui-product-window-boundary',
    fileName: 'atelier-official-status-ui-gate.json',
    mutate: (document) => {
      removeDoesNotProveAnchor(document, 'real Desktop product window UI');
    },
    expectedMessage: 'must include required doesNotProve anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-legacy-string-envelope-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge unit matrix unwraps legacy bridge.call string envelopes before applet capability consumers observe results',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-legacy-sync-throw-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge unit matrix normalizes synchronous legacy bridge.call throws as AppletError before applet capability consumers observe failures',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-legacy-string-error-envelope-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge unit matrix preserves legacy bridge.call string error envelopes as AppletError before applet capability consumers observe failures',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-delayed-injection-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge unit matrix tolerates delayed Host bridge injection before readiness timeout',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-event-canonical-error-retry-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge event receiver retries events.subscribe after canonical Host error envelopes without dispatching invalid events',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-event-string-canonical-error-retry-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge event receiver retries events.subscribe after string canonical Host error envelopes without dispatching invalid events',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-destroy-event-teardown-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK destroy tears down bridge event subscription and clears local handlers before stale Host events can be retained',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-local-event-unsubscribe-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK local event unsubscribe removes topic handlers before stale Host events can be delivered',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-same-topic-unsubscribe-isolation-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK local event unsubscribe preserves sibling same-topic handlers for subsequent Host events',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-dispatch-self-unsubscribe-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK local event dispatch snapshots same-topic handlers so self-unsubscribe cannot skip sibling handlers',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-dispatch-new-handler-defer-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK local event dispatch snapshots same-topic handlers so newly registered handlers wait for subsequent Host events',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-pending-replay-reentrant-buffer-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK pending Host event replay snapshots queued events so reentrant unmatched Host events remain buffered',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-require-module-anchor',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'Applet SDK Lynx bridge unit matrix covers lynx.requireModule bridge injection fallback when NativeModules is absent',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-sdk-lynx-host-boundary',
    fileName: 'atelier-sdk-lynx-bridge-unit-gate.json',
    mutate: (document) => {
      removeDoesNotProveAnchor(document, 'real Desktop Host Lynx bridge injection');
    },
    expectedMessage: 'must include required doesNotProve anchor',
  },
  {
    id: 'child-evidence-missing-official-typed-recovery-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend classifies structured Host and service error codes through generated recovery taxonomy before legacy message fallback';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-projection-boundary-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend preserves projection-only forbidden capability boundaries for provider, shell, file, memory, artifact, gate, and attachment writes';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-capability-guard-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone fails closed for executable capability values, forbidden capability keys or paths, and circular projection references before JSON cloning',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-plain-object-guard-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone rejects non-plain projection objects before JSON cloning while preserving plain and null-prototype projection dictionaries',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-json-scalar-guard-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone rejects undefined array values and non-finite projection numbers before JSON cloning while preserving finite numbers and omittable optional object fields',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-optional-undefined-allowlist-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone only omits registered optional undefined object fields and rejects required or unregistered undefined object fields before JSON cloning',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-prototype-pollution-key-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone rejects prototype pollution keys before JSON cloning while preserving safe null-prototype projection dictionaries',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-sparse-array-hole-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone rejects sparse projection array holes before JSON cloning while preserving dense projection arrays',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-hidden-own-property-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone rejects symbol-keyed or non-enumerable own projection properties before JSON cloning',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-accessor-property-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone rejects accessor own projection properties before Object.entries or JSON cloning can invoke them',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-clone-source-mutation-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime snapshot clone isolates accepted projections from source snapshot mutations after cloning',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-mock-runtime-snapshot-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier mock runtime getSnapshot clones status and state so external snapshot mutations cannot pollute runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-mock-runtime-seed-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier mock runtime construction clones seed state so seed mutations cannot pollute runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-mock-runtime-async-return-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier mock runtime async action returns cloned snapshots so async return mutations cannot pollute runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-mock-runtime-transition-state-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier mock runtime transition state is cloned on ownership transfer so returned projection mutations cannot pollute runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-accepted-projection-ownership-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime clones accepted Host projections on ownership transfer so Host projection mutations cannot pollute runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-event-patch-ownership-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime clones accepted projection event patches on ownership transfer so event patch mutations cannot pollute runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-released-subscription-generation-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime ignores released projection subscription callbacks by subscription generation so released Host callbacks cannot mutate runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-pre-cleanup-subscription-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime ignores pre-cleanup projection subscription callbacks until cleanup contract is validated so malformed subscriptions cannot mutate runtime state',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-stale-projection-refresh-result-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime ignores stale projection refresh results after newer projection revisions so stale refresh failures cannot overwrite current runtime status',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-non-promise-refresh-settlement-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime guards non-promise projection refresh settlement so synchronous projection events keep current runtime status',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-subscription-recovery-refresh-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime guards subscription recovery status against stale projection refresh success so auth-denied surfaces remain fail-closed',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-subscription-setup-cleanup-refresh-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime guards subscription setup and cleanup recovery status against stale projection refresh success so disconnected surfaces remain fail-closed',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-non-snapshot-call-recovery-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime guards non-snapshot call status settlement against projection recovery revisions so auth-denied surfaces remain fail-closed',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-runtime-non-snapshot-call-failure-recovery-isolation-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier bridge runtime guards non-snapshot call failure settlement against projection recovery revisions so auth-denied surfaces remain fail-closed',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-page-surface-generated-matrix-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(
        document,
        'browser Atelier prototype page surface unit matrix covers every generated view status so loading empty disconnected and auth-denied states stay mutually exclusive',
      );
    },
    expectedMessage: 'must include required proves anchor',
  },
  ...[
    [
      'child-evidence-missing-message-send-text-only-anchor',
      'atelier-message-send-ingress-controlled-gate.json',
      'Station Atelier SendMessage persists only text user-message event metadata',
    ],
    [
      'child-evidence-missing-message-send-rejects-execution-anchor',
      'atelier-message-send-ingress-controlled-gate.json',
      'Station official Atelier /v1/messages ingress rejects run, attachments, inputSnapshot, and input_snapshot fields',
    ],
    [
      'child-evidence-missing-message-send-station-owned-anchor',
      'atelier-message-send-ingress-controlled-gate.json',
      'Atelier message send remains Station-owned message append intent and does not expose run/provider/runtime/input_snapshot actions',
    ],
    [
      'child-evidence-missing-feedback-submit-rejects-execution-anchor',
      'atelier-feedback-submit-ingress-controlled-gate.json',
      'Station official Atelier /v1/feedback/submit ingress rejects execution-shaped memory, rerun, provider, attachment, and input_snapshot fields',
    ],
    [
      'child-evidence-missing-feedback-submit-policy-anchor',
      'atelier-feedback-submit-ingress-controlled-gate.json',
      'Station Atelier SubmitFeedback persists Station-owned policy hint event metadata derived from allowed signal taxonomy',
    ],
    [
      'child-evidence-missing-feedback-submit-station-owned-anchor',
      'atelier-feedback-submit-ingress-controlled-gate.json',
      'Atelier feedback submit remains Station-owned review intent and does not expose memory.write, rerun execution, provider, runtime, or input_snapshot actions',
    ],
    [
      'child-evidence-missing-confirmation-ingress-rejects-execution-anchor',
      'atelier-confirmation-ingress-controlled-gate.json',
      'Station official Atelier memory and rerun confirmation ingress rejects execution-shaped fields',
    ],
    [
      'child-evidence-missing-confirmation-ingress-reference-only-anchor',
      'atelier-confirmation-ingress-controlled-gate.json',
      'Station confirmation requests remain reference-only taskId/feedbackId intents',
    ],
    [
      'child-evidence-missing-confirmation-ingress-station-owned-anchor',
      'atelier-confirmation-ingress-controlled-gate.json',
      'Station service tests keep memory writes and rerun creation Station-owned after durable feedback review lookup',
    ],
    [
      'child-evidence-missing-confirmation-outcome-memory-write-anchor',
      'atelier-confirmation-outcome-controlled-gate.json',
      'Station memory confirmation outcome writes review-derived long-term memory through MemoryService',
    ],
    [
      'child-evidence-missing-confirmation-outcome-memory-idempotent-anchor',
      'atelier-confirmation-outcome-controlled-gate.json',
      'Station memory confirmation outcome emits an audit event and is idempotent by feedbackId',
    ],
    [
      'child-evidence-missing-confirmation-outcome-rerun-task-anchor',
      'atelier-confirmation-outcome-controlled-gate.json',
      'Station rerun confirmation outcome creates a new Station-owned collaboration task from the durable feedback intent',
    ],
    [
      'child-evidence-missing-confirmation-outcome-rerun-idempotent-anchor',
      'atelier-confirmation-outcome-controlled-gate.json',
      'Station rerun confirmation outcome clones provider plan/nodes, emits an audit event, and is idempotent by feedbackId',
    ],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  ...[
    ['child-evidence-missing-message-send-real-e2e-boundary', 'atelier-message-send-ingress-controlled-gate.json', 'real Desktop Host + Station + applet message send E2E'],
    ['child-evidence-missing-feedback-submit-real-e2e-boundary', 'atelier-feedback-submit-ingress-controlled-gate.json', 'real Desktop Host + Station + applet feedback submit E2E'],
    ['child-evidence-missing-confirmation-ingress-complete-e2e-boundary', 'atelier-confirmation-ingress-controlled-gate.json', 'complete Host + Station + applet E2E'],
    ['child-evidence-missing-confirmation-outcome-executor-recovery-boundary', 'atelier-confirmation-outcome-controlled-gate.json', 'real executor/provider recovery for the confirmed rerun task'],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeDoesNotProveAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required doesNotProve anchor',
  })),
  ...[
    [
      'child-evidence-missing-feedback-memory-taxonomy-anchor',
      'atelier-feedback-memory-consumption-controlled-gate.json',
      'Station feedback policy records planner/risk/verifier feed taxonomy for memory candidates',
    ],
    [
      'child-evidence-missing-feedback-memory-search-anchor',
      'atelier-feedback-memory-consumption-controlled-gate.json',
      'Station confirmed Atelier feedback memory is retrievable by MemoryService search for planner/risk/verifier queries',
    ],
    [
      'child-evidence-missing-feedback-memory-prompt-snapshot-anchor',
      'atelier-feedback-memory-consumption-controlled-gate.json',
      'Station prompt memory snapshot includes the confirmed memory as a relevant item for consumer assembly',
    ],
    [
      'child-evidence-missing-feedback-memory-intent-only-anchor',
      'atelier-feedback-memory-consumption-controlled-gate.json',
      'Applet feedback and confirmation payloads remain intent/reference-only and do not write memory directly',
    ],
    [
      'child-evidence-missing-workspace-open-canonical-uri-anchor',
      'atelier-workspace-open-controlled-gate.json',
      'Desktop gateway accepts only canonical pt-workspace://task/<taskId>?workspace=<workspaceId> workspace open intents',
    ],
    [
      'child-evidence-missing-workspace-open-rejects-non-contract-anchor',
      'atelier-workspace-open-controlled-gate.json',
      'Desktop gateway rejects non-contract workspace URI shapes before native resolver or IDE launch',
    ],
    [
      'child-evidence-missing-workspace-open-host-intent-anchor',
      'atelier-workspace-open-controlled-gate.json',
      'Desktop gateway response remains Host-intent-only and does not expose file, shell, execute, run, or openExternalUrl fields',
    ],
    [
      'child-evidence-missing-workspace-open-no-provider-runtime-anchor',
      'atelier-workspace-open-controlled-gate.json',
      'Atelier applet workspace.open remains a Host UI intent rather than provider/runtime execution',
    ],
    [
      'child-evidence-missing-task-lifecycle-set-status-anchor',
      'atelier-task-lifecycle-controlled-gate.json',
      'Station Atelier SetTaskStatus persists workbench lifecycle status without mutating execution status',
    ],
    [
      'child-evidence-missing-task-lifecycle-rejects-nondeleted-purge-anchor',
      'atelier-task-lifecycle-controlled-gate.json',
      'Station Atelier PurgeTask rejects non-deleted tasks through the public service',
    ],
    [
      'child-evidence-missing-task-lifecycle-purge-indexes-anchor',
      'atelier-task-lifecycle-controlled-gate.json',
      'Station Atelier PurgeTask removes task-owned durable indexes through the public service',
    ],
    [
      'child-evidence-missing-task-lifecycle-station-owned-anchor',
      'atelier-task-lifecycle-controlled-gate.json',
      'Atelier task lifecycle remains Station-owned and does not expose applet execution actions',
    ],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  ...[
    ['child-evidence-missing-feedback-memory-live-model-boundary', 'atelier-feedback-memory-consumption-controlled-gate.json', 'real Planner/Risk/Verifier model consumption in a live provider run'],
    ['child-evidence-missing-feedback-memory-executor-recovery-boundary', 'atelier-feedback-memory-consumption-controlled-gate.json', 'real executor/provider recovery for confirmed rerun tasks'],
    ['child-evidence-missing-workspace-open-real-resolver-boundary', 'atelier-workspace-open-controlled-gate.json', 'real workspace resolver'],
    ['child-evidence-missing-workspace-open-sandbox-boundary', 'atelier-workspace-open-controlled-gate.json', 'real sandbox runtime'],
    ['child-evidence-missing-task-lifecycle-real-e2e-boundary', 'atelier-task-lifecycle-controlled-gate.json', 'real Desktop Host + Station + applet task lifecycle E2E'],
    ['child-evidence-missing-task-lifecycle-menu-boundary', 'atelier-task-lifecycle-controlled-gate.json', 'real product-window task menu interaction'],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeDoesNotProveAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required doesNotProve anchor',
  })),
  ...[
    [
      'child-evidence-missing-runtime-log-cdp-normalization-anchor',
      'atelier-runtime-log-stream-controlled-gate.json',
      'controlled Host sandbox CDP console capture normalization',
    ],
    [
      'child-evidence-missing-runtime-log-ordered-levels-anchor',
      'atelier-runtime-log-stream-controlled-gate.json',
      'ordered log/warn/error evidence from a local sandbox harness',
    ],
    [
      'child-evidence-missing-source-dist-integrity-truth-anchor',
      'atelier-source-dist-integrity-policy-gate.json',
      'Atelier desktop dist manifest remains the runtime integrity truth and matches generated main.lynx.bundle sha256',
    ],
    [
      'child-evidence-missing-artifact-renderer-descriptor-anchor',
      'atelier-artifact-renderer-controlled-gate.json',
      'Desktop Host adapter builds controlled host_sandbox_visual_surface descriptors for markdown/web/image/diff preview kinds',
    ],
    [
      'child-evidence-missing-artifact-renderer-policy-anchor',
      'atelier-artifact-renderer-controlled-gate.json',
      'Desktop Host artifact preview renderer policy keeps scripts, network, external navigation, file access, and patch apply disabled',
    ],
    [
      'child-evidence-missing-artifact-renderer-host-owned-anchor',
      'atelier-artifact-renderer-controlled-gate.json',
      'Desktop Host artifact preview renderer surfaces remain Host-owned and not applet-renderable',
    ],
    [
      'child-evidence-missing-artifact-live-sandbox-anchor',
      'atelier-artifact-renderer-live-controlled-gate.json',
      'controlled Host-owned live sandbox DOM render harness for markdown/web/image/diff preview kinds',
    ],
    [
      'child-evidence-missing-artifact-live-no-raw-anchor',
      'atelier-artifact-renderer-live-controlled-gate.json',
      'live sandbox renderer emits metadata-only evidence without raw body/html/diff/image bytes',
    ],
    [
      'child-evidence-missing-artifact-live-blocks-script-anchor',
      'atelier-artifact-renderer-live-controlled-gate.json',
      'live sandbox renderer blocks script, iframe, external URL, inline event handler, file access, and patch apply surfaces',
    ],
    [
      'child-evidence-missing-artifact-body-canonical-ref-anchor',
      'atelier-artifact-body-fetch-controlled-gate.json',
      'Station-owned Atelier artifact body fetch returns owned safe-text bodies through canonical artifact:// bodyRef',
    ],
    [
      'child-evidence-missing-artifact-body-scope-hash-anchor',
      'atelier-artifact-body-fetch-controlled-gate.json',
      'Station artifact body fetch enforces actor-owned task scope, canonical bodyRef, active retention, fetchable text kinds, and body hash checks',
    ],
    [
      'child-evidence-missing-artifact-body-safe-text-anchor',
      'atelier-artifact-body-fetch-controlled-gate.json',
      'Station artifact body fetch truncates safe text by maxBytes without exposing file/path/url/html/iframe/image execution channels',
    ],
    [
      'child-evidence-missing-host-storage-staging-anchor',
      'atelier-host-storage-attachment-controlled-gate.json',
      'controlled Host-owned attachment byte staging behind host-storage opaque refs',
    ],
    [
      'child-evidence-missing-host-storage-metadata-anchor',
      'atelier-host-storage-attachment-controlled-gate.json',
      'host-storage attachment metadata normalization with mime/size/sha256',
    ],
    [
      'child-evidence-missing-host-storage-no-raw-anchor',
      'atelier-host-storage-attachment-controlled-gate.json',
      'controlled host-storage ref readback without exposing raw path/url/body/base64 fields to applet evidence',
    ],
    [
      'child-evidence-missing-browser-attachment-intake-anchor',
      'atelier-host-storage-attachment-browser-controlled-gate.json',
      'controlled browser File API attachment intake metadata normalization',
    ],
    [
      'child-evidence-missing-browser-attachment-staging-anchor',
      'atelier-host-storage-attachment-browser-controlled-gate.json',
      'Host-owned staging converts browser attachment metadata into host-storage opaque refs',
    ],
    [
      'child-evidence-missing-browser-attachment-no-upload-anchor',
      'atelier-host-storage-attachment-browser-controlled-gate.json',
      'applet upload and input_snapshot write capabilities remain unexposed',
    ],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  ...[
    ['child-evidence-missing-runtime-log-real-run-boundary', 'atelier-runtime-log-stream-controlled-gate.json', 'real Run runtime stream'],
    ['child-evidence-missing-runtime-log-applet-capability-boundary', 'atelier-runtime-log-stream-controlled-gate.json', 'runtime.logs.subscribe applet capability'],
    ['child-evidence-missing-artifact-renderer-real-webview-boundary', 'atelier-artifact-renderer-controlled-gate.json', 'real iframe/image/html/diff rendering in a live Desktop webview'],
    ['child-evidence-missing-artifact-live-real-webview-boundary', 'atelier-artifact-renderer-live-controlled-gate.json', 'real Desktop product-window webview renderer'],
    ['child-evidence-missing-artifact-body-product-window-boundary', 'atelier-artifact-body-fetch-controlled-gate.json', 'real Desktop product-window artifact body fetch'],
    ['child-evidence-missing-host-storage-runtime-boundary', 'atelier-host-storage-attachment-controlled-gate.json', 'real Desktop Host Storage runtime'],
    ['child-evidence-missing-host-storage-input-snapshot-boundary', 'atelier-host-storage-attachment-controlled-gate.json', 'Run input_snapshot write capability from applet'],
    ['child-evidence-missing-browser-attachment-native-picker-boundary', 'atelier-host-storage-attachment-browser-controlled-gate.json', 'real native file picker integration'],
    ['child-evidence-missing-browser-attachment-provider-boundary', 'atelier-host-storage-attachment-browser-controlled-gate.json', 'real provider/executor consumption of Host Storage attachments'],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeDoesNotProveAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required doesNotProve anchor',
  })),
  ...[
    [
      'child-evidence-missing-direct-run-read-only-projection-anchor',
      'atelier-direct-run-execution-evidence-controlled-gate.json',
      'controlled DirectRun execution evidence remains a Station-owned read-only projection',
    ],
    [
      'child-evidence-missing-direct-run-canonical-refs-anchor',
      'atelier-direct-run-execution-evidence-controlled-gate.json',
      'controlled DirectRun evidence exposes only canonical evidence refs and status fields',
    ],
    [
      'child-evidence-missing-direct-run-durable-indexes-anchor',
      'atelier-direct-run-execution-evidence-controlled-gate.json',
      'Station service-level DirectRun evidence is derived from durable DirectRun/artifact/gate/budget indexes without raw input snapshot or artifact body fields',
    ],
    [
      'child-evidence-missing-direct-run-no-execution-actions-anchor',
      'atelier-direct-run-execution-evidence-controlled-gate.json',
      'official applet client and browser prototype runtime do not expose DirectRun execution/write actions',
    ],
    [
      'child-evidence-missing-budget-usage-aggregation-anchor',
      'atelier-budget-surface-controlled-gate.json',
      'Station DirectRun budget usage aggregation is backed by agent_task_budget_usages service-level tests',
    ],
    [
      'child-evidence-missing-budget-billing-reconciliation-anchor',
      'atelier-budget-surface-controlled-gate.json',
      'Station provider billing reconciliation is backed by BudgetUsageReconciler service-level tests',
    ],
    [
      'child-evidence-missing-budget-circuit-breaker-anchor',
      'atelier-budget-surface-controlled-gate.json',
      'Station budget circuit breaker blocks DirectRun before provider calls for time/token/money budget exhaustion',
    ],
    [
      'child-evidence-missing-budget-decision-card-anchor',
      'atelier-budget-surface-controlled-gate.json',
      'Station budget DecisionCard recovery resolves a reference-only human decision intent through Station orchestration',
    ],
    [
      'child-evidence-missing-budget-read-only-projection-anchor',
      'atelier-budget-surface-controlled-gate.json',
      'budgetSurface remains a read-only applet projection with no budget write/halt/resume surface',
    ],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  ...[
    ['child-evidence-missing-direct-run-coding-provider-boundary', 'atelier-direct-run-execution-evidence-controlled-gate.json', 'real Desktop CodingProvider worker execution'],
    ['child-evidence-missing-direct-run-provider-quality-boundary', 'atelier-direct-run-execution-evidence-controlled-gate.json', 'real provider/model quality'],
    ['child-evidence-missing-direct-run-streaming-ux-boundary', 'atelier-direct-run-execution-evidence-controlled-gate.json', 'real streaming reply UX'],
    ['child-evidence-missing-budget-external-billing-boundary', 'atelier-budget-surface-controlled-gate.json', 'real provider implementations populate external billing in production'],
    ['child-evidence-missing-budget-decision-card-real-e2e-boundary', 'atelier-budget-surface-controlled-gate.json', 'real DecisionCard budget recovery from Desktop Host + applet'],
    ['child-evidence-missing-budget-live-stream-boundary', 'atelier-budget-surface-controlled-gate.json', 'real provider/live stream behavior'],
  ].map(([id, fileName, requiredAnchor]) => ({
    id,
    fileName,
    mutate: (document) => {
      removeDoesNotProveAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required doesNotProve anchor',
  })),
  {
    id: 'child-evidence-missing-official-render-policy-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend render consumes status action policy for empty create-project and retry affordances';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-action-consistency-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend status action policy keeps primary action and visibility flags mutually consistent';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-action-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend status action policy matrix is exhaustive against generated view statuses and recovery kinds';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-page-surface-generated-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend page surface unit matrix covers every generated view status so loading empty disconnected and auth-denied states stay mutually exclusive';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
    {
      id: 'child-evidence-missing-official-single-column-recovery-layout-anchor',
      fileName: 'atelier-official-frontend-gate.json',
      mutate: (document) => {
        const requiredAnchor = 'official Atelier frontend single-column recovery-state layout keeps loading empty disconnected and auth-denied surfaces above the projection content rail without app-level side rails';
        if (Array.isArray(document.claimBoundary?.proves)) {
          document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
        }
        if (Array.isArray(document.proves)) {
          document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
        }
        if (Array.isArray(document.coveredPaths)) {
          document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
        }
      },
      expectedMessage: 'must include required proves anchor',
    },
  {
    id: 'child-evidence-missing-official-recovery-view-generated-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend recovery view unit matrix covers every generated recovery kind with contract-owned tone retry and label keys';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-pill-generated-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend status pill unit matrix covers every generated view status with contract-owned tone and label keys';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-notice-generated-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend status notice unit matrix covers every generated notice kind with contract-owned title and detail keys';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-centered-state-generated-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend centered state unit matrix covers loading and empty states with contract-owned title and detail keys';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-status-action-source-matrix-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend status action policy source unit matrix covers every generated view status and recovery kind without execution payload fields';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-projection-subscription-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend projection subscription source unit matrix covers rejected subscribe cleanup release idempotence and late payload isolation';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-projection-stream-subscribe-reject-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend projection stream subscribe reject source unit matrix covers Station stream cleanup late payload isolation and no unhandled rejection';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-active-typed-subscription-rejection-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend active typed subscription rejection source unit matrix covers recovery delivery cleanup idempotence and late event isolation';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-typed-subscription-rejection-code-taxonomy-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend typed subscription rejection code taxonomy source unit matrix covers auth-denied and disconnected recovery classification';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-malformed-typed-subscription-rejection-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend malformed typed subscription rejection source unit matrix covers fail-closed generic recovery and projection-event isolation';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-typed-subscription-rejection-sanitized-cause-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend typed subscription rejection sanitized cause source unit matrix preserves recovery code and strips execution-shaped fields';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-typed-subscription-rejection-reason-sanitization-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend typed subscription rejection reason diagnostic and warning sanitization source unit matrix strips execution-shaped fields';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-recovery-transition-transient-reset-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend recovery transitions clear every transient workbench action field before auth-denied disconnected or error surfaces';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-status-action-source-matrix-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype status action policy source unit matrix covers every generated view status without execution payload fields';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-recovery-view-source-matrix-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype recovery view source unit matrix covers generated severity symbol and retry taxonomy';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-non-snapshot-host-response-forbidden-field-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier applet bridge rejects execution-shaped fields in every non-snapshot Host typed response before runtime ownership can observe them';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-initial-subscribe-ack-settlement-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier bridge runtime keeps initial projection subscription reconciling until Host subscribe ack settles and maps rejected ack to typed recovery';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-stale-initial-subscribe-ack-settlement-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier bridge runtime ignores stale initial subscription ack resolve or rejection after subscription replacement';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-release-before-late-subscribe-reject-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier applet bridge ignores late subscribe rejections after release without listener delivery duplicate unsubscribe or unhandled rejection';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-release-before-late-subscribe-reject-source-unit-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier applet bridge release-before-late subscribe reject source unit matrix covers listener delivery duplicate unsubscribe and unhandled rejection isolation';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  ...[
    [
      'child-evidence-missing-official-service-binding-anchor',
      'official Atelier frontend uses service binding for Station-owned methods',
    ],
    [
      'child-evidence-missing-official-host-intent-boundary-anchor',
      'official Atelier frontend keeps workspace/artifact preview Host intents out of Station service binding',
    ],
    [
      'child-evidence-missing-official-malformed-client-fixture-anchor',
      'official Atelier frontend rejects malformed service and Host capability responses through executable public client fixtures',
    ],
    [
      'child-evidence-missing-official-unsafe-seq-anchor',
      'official Atelier frontend rejects decimal and unsafe projection event/replay sequence numbers before reducer or cursor use',
    ],
    [
      'child-evidence-missing-official-task-purge-anchor',
      'official Atelier frontend rejects task purge intents unless projected task status is deleted before service calls',
    ],
    [
      'child-evidence-missing-official-taskgraph-unresolved-ref-anchor',
      'official Atelier frontend marks unresolved TaskGraph artifact and gate evidence refs before display',
    ],
    [
      'child-evidence-missing-official-safe-artifact-preview-anchor',
      'official Atelier frontend keeps artifact preview metadata-only and safe-text bounded without raw iframe/image/html/diff rendering',
    ],
  ].map(([id, requiredAnchor]) => ({
    id,
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  ...[
    ['child-evidence-missing-official-host-producer-boundary', 'real Desktop Host capability producer behavior'],
    ['child-evidence-missing-official-station-stream-boundary', 'real Station projection stream failure matrix'],
    ['child-evidence-missing-official-auth-recovery-boundary', 'real auth recovery or reconnect behavior against Station'],
    ['child-evidence-missing-official-artifact-renderer-boundary', 'real artifact body fetch or Host sandbox renderer E2E'],
    ['child-evidence-missing-official-complete-e2e-boundary', 'complete Host + Station + applet E2E'],
  ].map(([id, requiredAnchor]) => ({
    id,
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      removeDoesNotProveAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required doesNotProve anchor',
  })),
  {
    id: 'child-evidence-missing-bridge-typed-recovery-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier bridge runtime maps current non-snapshot Host failures to auth-denied, disconnected, and generic error recovery without mutating projection state';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-official-typed-subscription-rejection-code-whitelist-source-unit-anchor',
    fileName: 'atelier-official-frontend-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'official Atelier frontend typed subscription rejection code whitelist source unit matrix keeps only known recovery codes in Error.cause';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-typed-subscription-rejection-sanitized-cause-source-unit-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype typed subscription rejection sanitized cause source unit matrix preserves recovery code and strips execution-shaped fields';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-projection-event-typed-subscription-rejection-reason-sanitization-source-unit-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype projection event typed subscription rejection reason sanitization source unit matrix strips execution-shaped reason text before message and cause construction';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-projection-event-typed-subscription-rejection-code-whitelist-source-unit-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype projection event typed subscription rejection code whitelist source unit matrix keeps only known recovery codes in Error.cause';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-applet-bridge-typed-subscription-rejection-reason-sanitization-source-unit-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier applet bridge typed subscription rejection reason and warning sanitization source unit matrix strips execution-shaped fields';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  ...[
    [
      'child-evidence-missing-bridge-stale-projection-anchor',
      'browser Atelier bridge runtime preserves last valid projection during stale seq, malformed patch, event apply failures, stale snapshot success/failure responses after fresher projection events or local model intents, and current snapshot failure typed recovery',
    ],
    [
      'child-evidence-missing-bridge-refreshed-subscribe-anchor',
      'browser Atelier bridge runtime keeps fresh snapshot responses reconciling until refreshed projection subscribe settles and maps rejected refreshed subscribe to typed recovery',
    ],
    [
      'child-evidence-missing-bridge-dedupe-anchor',
      'browser Atelier bridge runtime bounds dedupe cache and still rejects stale replay after eviction',
    ],
    [
      'child-evidence-missing-bridge-subscription-lifecycle-anchor',
      'browser Atelier bridge runtime manages projection subscription lifecycle, topic correlation, cleanup, release-before-reject cleanup, typed recovery mapping, and structured Host error-code recovery taxonomy',
    ],
    [
      'child-evidence-missing-bridge-malformed-non-snapshot-anchor',
      'browser Atelier applet bridge rejects malformed non-snapshot provider, feedback, memory, rerun, workspace, artifact body, and artifact preview responses',
    ],
    [
      'child-evidence-missing-bridge-unsafe-seq-anchor',
      'browser Atelier bridge runtime rejects decimal and unsafe projection event/replay sequence numbers before state or cursor use',
    ],
  ].map(([id, requiredAnchor]) => ({
    id,
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  {
    id: 'child-evidence-missing-bridge-complete-e2e-boundary',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeDoesNotProveAnchor(document, 'complete Host + Station + applet E2E');
    },
    expectedMessage: 'must include required doesNotProve anchor',
  },
  ...[
    [
      'child-evidence-missing-prototype-task-purge-anchor',
      'browser Atelier prototype rejects task purge intents unless projected task status is deleted before runtime calls',
    ],
    [
      'child-evidence-missing-prototype-taskgraph-unresolved-ref-anchor',
      'browser Atelier prototype marks unresolved TaskGraph artifact and gate evidence refs before display',
    ],
      [
        'child-evidence-missing-prototype-single-column-shell-sync-anchor',
        'browser Atelier prototype default shell is synced to the official single-column projection shape without app-level left or right rails',
      ],
  ].map(([id, requiredAnchor]) => ({
    id,
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeSemanticAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required proves anchor',
  })),
  ...[
    ['child-evidence-missing-bridge-host-stream-boundary', 'real Desktop Host event stream producer behavior'],
    ['child-evidence-missing-bridge-station-sse-boundary', 'real Station SSE network failure matrix'],
    ['child-evidence-missing-bridge-cross-restart-boundary', 'real cross-restart cursor recovery'],
    [
      'child-evidence-missing-bridge-backend-side-effects-boundary',
      'real provider, feedback, memory, rerun, workspace, artifact body, or artifact preview backend side effects',
    ],
  ].map(([id, requiredAnchor]) => ({
    id,
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      removeDoesNotProveAnchor(document, requiredAnchor);
    },
    expectedMessage: 'must include required doesNotProve anchor',
  })),
  {
    id: 'child-evidence-missing-prototype-render-policy-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype render consumes status action policy for empty create-project and retry affordances';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-status-action-consistency-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype status action policy keeps primary action and visibility flags mutually consistent';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-prototype-status-action-matrix-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype status action policy matrix is exhaustive against generated view statuses';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
  {
    id: 'child-evidence-missing-bridge-recovery-taxonomy-anchor',
    fileName: 'atelier-bridge-runtime-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'browser Atelier prototype recovery view matrix covers generated view status, retry, severity, and symbol taxonomy';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include required proves anchor',
  },
];

const aggregateChildEvidenceRejectionFixtures = [
  {
    id: 'aggregate-child-wrong-gate',
    fileName: 'atelier-product-window-gate.json',
    mutate: (document) => {
      document.gate = 'applet:atelier-product-window-gate-stale-copy';
    },
    expectedMessage: 'must use aggregate child gate=applet:atelier-product-window-gate',
  },
  {
    id: 'aggregate-child-wrong-evidence-class',
    fileName: 'atelier-product-window-gate.json',
    mutate: (document) => {
      document.evidenceClass = 'CONTROLLED_LOCAL_UPSTREAM';
    },
    expectedMessage: 'must use aggregate child evidenceClass=REAL_PRODUCT_PATH',
  },
  {
    id: 'aggregate-child-missing-semantic-anchor',
    fileName: 'atelier-product-window-gate.json',
    mutate: (document) => {
      const requiredAnchor = 'packaged peers.atelier renders inside the normal Desktop product shell';
      if (Array.isArray(document.claimBoundary?.proves)) {
        document.claimBoundary.proves = document.claimBoundary.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.proves)) {
        document.proves = document.proves.filter((entry) => entry !== requiredAnchor);
      }
      if (Array.isArray(document.coveredPaths)) {
        document.coveredPaths = document.coveredPaths.filter((entry) => entry !== requiredAnchor);
      }
    },
    expectedMessage: 'must include aggregate child required proves anchor',
  },
  {
    id: 'aggregate-child-failure-matrix-missing-auth-denied-scenario',
    fileName: 'atelier-product-window-failure-matrix-gate.json',
    mutate: (document) => {
      document.scenarios = document.scenarios.filter((scenario) => scenario.scenario !== 'auth-denied');
    },
    expectedMessage: 'must include auth-denied scenario',
  },
  {
    id: 'aggregate-child-failure-matrix-disconnected-retryable-drift',
    fileName: 'atelier-product-window-failure-matrix-gate.json',
    mutate: (document) => {
      const scenario = document.scenarios.find((candidate) => candidate.scenario === 'disconnected');
      scenario.expectedRetryable = false;
    },
    expectedMessage: 'disconnected scenario must preserve expectedRetryable',
  },
  {
    id: 'aggregate-child-failure-matrix-timeout-delay-drift',
    fileName: 'atelier-product-window-failure-matrix-gate.json',
    mutate: (document) => {
      const scenario = document.scenarios.find((candidate) => candidate.scenario === 'timeout');
      scenario.diagnostics.controllerRejection.properties.retryDelayMs = 1500;
    },
    expectedMessage: 'timeout controller diagnostic must preserve retryDelayMs',
  },
  {
    id: 'aggregate-child-failure-matrix-auth-denied-station-scenario-drift',
    fileName: 'atelier-product-window-failure-matrix-gate.json',
    mutate: (document) => {
      const scenario = document.scenarios.find((candidate) => candidate.scenario === 'auth-denied');
      scenario.stationGateServer.failureScenario = 'disconnected';
    },
    expectedMessage: 'auth-denied scenario must bind Station gate failureScenario',
  },
  {
    id: 'aggregate-child-failure-matrix-missing-client-diagnostic',
    fileName: 'atelier-product-window-failure-matrix-gate.json',
    mutate: (document) => {
      const scenario = document.scenarios.find((candidate) => candidate.scenario === 'disconnected');
      scenario.diagnostics.clientRejection.properties.stage = 'client.other-stage';
    },
    expectedMessage: 'disconnected scenario must include client.subscribe-rejected diagnostic',
  },
];

function runGate() {
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(controlledWorkDir, { recursive: true });
  const sharedFullE2EBefore = stableEvidenceText(sharedFullE2EEvidencePath);
  const sharedCompletionAuditBefore = stableEvidenceText(sharedCompletionAuditEvidencePath);

  prepareIsolatedEvidenceRoot();
  writeMissingFullE2EFixture();
  const missingRun = runCompletionAudit();
  assertMissingBranch(missingRun.evidence);
  const missingDescriptorSelfCheck = assertDescriptorSelfCheck(missingRun.evidence, 'missing branch');
  const missingValidatedEvidencePaths = assertValidatedEvidenceCoverage(missingRun.evidence, 'missing branch');
  const missingRealProductAggregateScripts = assertRealProductAggregateCoverage(missingRun.evidence, 'missing branch');

  writeReadyFullE2EFixture();
  const readyRun = runCompletionAudit();
  assertReadyBranch(readyRun.evidence);
  const readyDescriptorSelfCheck = assertDescriptorSelfCheck(readyRun.evidence, 'ready branch');
  const readyValidatedEvidencePaths = assertValidatedEvidenceCoverage(readyRun.evidence, 'ready branch');
  const readyRealProductAggregateScripts = assertRealProductAggregateCoverage(readyRun.evidence, 'ready branch');

  const partialOkTrueRejections = partialOkTrueRejectionFixtures.map((fixture) => {
    prepareIsolatedEvidenceRoot();
    writePartialOkTrueFullE2EFixture(fixture.mutate);
    return runCompletionAuditExpectFailure(fixture.id, fixture.expectedMessage);
  });

  const finalEvidenceClaimBoundaryRejections = finalEvidenceClaimBoundaryRejectionFixtures.map((fixture) => {
    prepareIsolatedEvidenceRoot();
    writePartialOkTrueFullE2EFixture(fixture.mutate);
    return runCompletionAuditExpectFailure(fixture.id, fixture.expectedMessage);
  });

  const semanticChildEvidenceRejections = semanticChildEvidenceRejectionFixtures.map((fixture) => {
    prepareIsolatedEvidenceRoot();
    writeReadyFullE2EFixture();
    mutateIsolatedEvidence(fixture.fileName, fixture.mutate);
    return runCompletionAuditExpectFailure(fixture.id, fixture.expectedMessage);
  });

  const aggregateChildEvidenceRejections = aggregateChildEvidenceRejectionFixtures.map((fixture) => {
    prepareIsolatedEvidenceRoot();
    writeReadyFullE2EFixture();
    mutateIsolatedEvidence(fixture.fileName, fixture.mutate);
    return runCompletionAuditExpectFailure(fixture.id, fixture.expectedMessage);
  });

  assert.equal(
    stableEvidenceText(sharedFullE2EEvidencePath),
    sharedFullE2EBefore,
    'completion readiness controlled gate must not mutate shared atelier-full-e2e.json',
  );
  assert.equal(
    stableEvidenceText(sharedCompletionAuditEvidencePath),
    sharedCompletionAuditBefore,
    'completion readiness controlled gate must not mutate shared atelier-completion-readiness-audit.json',
  );

  return {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier:completion-readiness-audit-controlled-gate',
    isolatedFixtures: {
      fullE2EEvidencePath: isolatedFullE2EEvidencePath,
      auditEvidencePath: isolatedCompletionAuditEvidencePath,
    },
    branches: {
      missingFullE2E: {
        status: 'PASS',
        failureMode: missingRun.evidence.fullE2EFinalEvidence.failureMode,
        readiness: missingRun.evidence.readiness,
        globalReady: missingRun.evidence.globalReady,
        missingFinalEvidenceIds: evidenceIds(missingRun.evidence.missingFinalEvidence, 'missing branch missingFinalEvidence'),
        descriptorSelfCheck: missingDescriptorSelfCheck,
        validatedEvidencePaths: missingValidatedEvidencePaths,
        realProductAggregateScripts: missingRealProductAggregateScripts,
      },
      readyFullE2E: {
        status: 'PASS',
        syntheticOnly: true,
        readiness: readyRun.evidence.readiness,
        globalReady: readyRun.evidence.globalReady,
        finalEvidenceCount: readyRun.evidence.finalEvidence.length,
        finalEvidenceIds: evidenceIds(readyRun.evidence.finalEvidence, 'ready branch finalEvidence'),
        descriptorSelfCheck: readyDescriptorSelfCheck,
        validatedEvidencePaths: readyValidatedEvidencePaths,
        realProductAggregateScripts: readyRealProductAggregateScripts,
        doesNotProve: [
          'real Desktop Host launch',
          'real Station service binding',
          'real applet UI actions',
          'real IDE launch',
          'production provider/model/runtime quality',
          'global Atelier readiness in the current environment',
        ],
      },
      partialOkTrueRejections: partialOkTrueRejections.map((fixture) => ({
        fixtureName: fixture.fixtureName,
        status: fixture.status,
        expectedMessage: fixture.expectedMessage,
      })),
      finalEvidenceClaimBoundaryRejections: finalEvidenceClaimBoundaryRejections.map((fixture) => ({
        fixtureName: fixture.fixtureName,
        status: fixture.status,
        expectedMessage: fixture.expectedMessage,
      })),
      semanticChildEvidenceRejections: semanticChildEvidenceRejections.map((fixture) => ({
        fixtureName: fixture.fixtureName,
        status: fixture.status,
        expectedMessage: fixture.expectedMessage,
      })),
      aggregateChildEvidenceRejections: aggregateChildEvidenceRejections.map((fixture) => ({
        fixtureName: fixture.fixtureName,
        status: fixture.status,
        expectedMessage: fixture.expectedMessage,
      })),
    },
    commands: [
      missingRun.command,
      readyRun.command,
      ...partialOkTrueRejections.map((fixture) => fixture.command),
      ...finalEvidenceClaimBoundaryRejections.map((fixture) => fixture.command),
      ...semanticChildEvidenceRejections.map((fixture) => fixture.command),
      ...aggregateChildEvidenceRejections.map((fixture) => fixture.command),
    ],
    outputTail: [
      ...missingRun.outputTail,
      ...readyRun.outputTail,
      ...partialOkTrueRejections.flatMap((fixture) => fixture.outputTail),
      ...finalEvidenceClaimBoundaryRejections.flatMap((fixture) => fixture.outputTail),
      ...semanticChildEvidenceRejections.flatMap((fixture) => fixture.outputTail),
      ...aggregateChildEvidenceRejections.flatMap((fixture) => fixture.outputTail),
    ].slice(-40),
    mutatesSharedFullE2EEvidence: false,
    mutatesSharedCompletionAuditEvidence: false,
    sharedEvidenceUnchanged: {
      fullE2E: true,
      completionReadinessAudit: true,
    },
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`PASS Atelier completion readiness audit controlled gate: ${evidencePath}`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier:completion-readiness-audit-controlled-gate',
    error: error instanceof Error ? error.message : String(error),
    claimBoundary,
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier completion readiness audit controlled gate: ${evidence.error}`);
  process.exit(1);
}
