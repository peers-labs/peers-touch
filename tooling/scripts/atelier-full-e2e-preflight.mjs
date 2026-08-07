#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  runtimeInputs,
  sanitizeRuntimeInputStatus,
  validateRuntimeInput,
} from './atelier-full-e2e-runtime-inputs.mjs';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = process.env.PEERS_ATELIER_FULL_E2E_PREFLIGHT_EVIDENCE_PATH
  ? path.resolve(process.env.PEERS_ATELIER_FULL_E2E_PREFLIGHT_EVIDENCE_PATH)
  : path.join(evidenceDir, 'atelier-full-e2e-preflight.json');
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

const requiredScripts = [
  'atelier:controlled-gates',
  'atelier:real-product-gates',
  'atelier:completion-readiness-audit',
  'atelier:full-e2e',
];

const sourceArtifacts = [
  'apps/applets/atelier/applet.manifest.json',
  'apps/applets/atelier/service.manifest.json',
  'apps/applets/atelier/frontend/package.json',
  'apps/applets/atelier/contracts/atelier-projection.contract.json',
];

const sourceInstrumentationRequirements = [
  {
    id: 'post-ready-workspace-open-action-producer',
    proofObligationId: 'post-ready-applet-ui-actions',
    path: 'apps/desktop/src-tauri/src/application/applets/mod.rs',
    owner: 'desktop_host',
    requiredAnchors: [
      'PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE',
      'record_atelier_full_e2e_workspace_open',
      'workspace_open_intent',
      'realIdeLaunchProven\": false',
    ],
    requiredEvidencePath: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-workspace-open.json',
  },
  {
    id: 'real-ide-launch-side-evidence-producer',
    proofObligationId: 'real-ide-launch',
    path: 'apps/desktop/src-tauri/src/application/applets/mod.rs',
    owner: 'desktop_host',
    requiredAnchors: [
      'PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE',
      'realIdeLaunchProven\": true',
    ],
    requiredEvidencePath: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-ide-launch.json',
  },
  {
    id: 'provider-runtime-side-evidence-producer',
    proofObligationId: 'production-provider-runtime-quality',
    path: 'apps/station/app/subserver/agent/service/atelier_projection.go',
    owner: 'station',
    requiredAnchors: [
      'PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE',
      'providerRuntimeProven',
    ],
    requiredEvidencePath: 'tooling/acceptance/evidence/applets/official-applet/atelier-full-e2e-provider-runtime.json',
  },
];

const expectedEvidence = [
  'tooling/acceptance/evidence/applets/official-applet/atelier-real-product-gates-aggregate.json',
  'tooling/acceptance/evidence/applets/official-applet/atelier-projection-contract-gate.json',
];

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'final E2E run prerequisites are machine-audited before attempting a readiness claim',
    'required Atelier controlled, real-product, and completion readiness gate scripts are present',
    'required current evidence files are present and preserve NOT_READY readiness boundaries',
    'missing real runtime inputs and final proof obligations are explicit and fail-closed for readiness',
    'authenticated Station route checks are required to go through Desktop Host service binding rather than a runner-visible bearer token',
    'final side evidence source instrumentation gaps are machine-audited before full E2E runtime handoff',
  ],
  doesNotProve: [
    'full Host + Station + applet E2E',
    'real IDE launch',
    'production provider/model/runtime quality',
    'global Atelier readiness',
  ],
};

function readEvidence(relativePath) {
  assert.ok(existsSync(relativePath), `missing evidence: ${relativePath}`);
  const document = JSON.parse(readFileSync(relativePath, 'utf8'));
  const passed = document.ok === true || document.status === 'PASS';
  assert.equal(passed, true, `${relativePath} must be ok=true or status=PASS`);
  const readiness = document.claimBoundary?.readiness ?? document.readiness;
  assert.equal(readiness, 'NOT_READY', `${relativePath} must preserve NOT_READY readiness`);
  return {
    path: relativePath,
    ok: document.ok,
    status: document.status,
    readiness,
    evidenceClass: document.evidenceClass,
  };
}

function evaluateSourceInstrumentation(requirement) {
  const source = existsSync(requirement.path) ? readFileSync(requirement.path, 'utf8') : '';
  const missingAnchors = requirement.requiredAnchors.filter((anchor) => !source.includes(anchor));
  return {
    id: requirement.id,
    proofObligationId: requirement.proofObligationId,
    path: requirement.path,
    owner: requirement.owner,
    requiredEvidencePath: requirement.requiredEvidencePath,
    status: missingAnchors.length === 0 ? 'PRESENT' : 'MISSING',
    missingAnchors,
  };
}

function main() {
  const missingScripts = requiredScripts.filter((script) => typeof packageJson.scripts?.[script] !== 'string');
  assert.deepEqual(missingScripts, [], `missing required scripts: ${missingScripts.join(', ')}`);

  const missingSourceArtifacts = sourceArtifacts.filter((artifact) => !existsSync(artifact));
  const sourceInstrumentation = sourceInstrumentationRequirements.map(evaluateSourceInstrumentation);
  const sourceInstrumentationGaps = sourceInstrumentation.filter((requirement) => requirement.status !== 'PRESENT');
  const validatedEvidence = expectedEvidence.map(readEvidence);
  const runtimeInputStatus = runtimeInputs.map((input) => sanitizeRuntimeInputStatus(validateRuntimeInput(input)));
  const missingRuntimeInputs = runtimeInputStatus.filter((input) => input.status === 'MISSING');
  const invalidRuntimeInputs = runtimeInputStatus.filter((input) => input.status === 'INVALID');
  const presentRuntimeInputs = runtimeInputStatus.filter((input) => input.status === 'PRESENT');

  const finalProofObligations = [
    {
      id: 'full-host-station-applet-e2e',
      status: 'MISSING',
      requiredEvidence:
        'Run the official peers.atelier package through the real Desktop Host product shell/window against a real Station service binding and record task creation, projection replay, decision resolve, artifact/body/preview, cleanup, and auth/error behavior. Authenticated read-only handshakes must use Desktop Host applets_invoke service binding, not exported bearer tokens.',
    },
    {
      id: 'post-ready-applet-ui-actions',
      status: 'MISSING',
      requiredEvidence:
        'After Desktop ready evidence, prove current-launch applet UI actions reached Desktop Host, starting with atelier.workspace.open action evidence bound to launchId/sessionId/taskId/workspaceUri/IDE target.',
    },
    {
      id: 'real-ide-launch',
      status: 'MISSING',
      requiredEvidence:
        'Run atelier.workspace.open through the real Desktop Host workspace resolver and produce independent atelier-full-e2e-ide-launch.json evidence proving the IDE launch target without exposing file/shell/execute/openExternalUrl capability to the applet.',
    },
    {
      id: 'production-provider-runtime-quality',
      status: 'MISSING',
      requiredEvidence:
        'Produce independent atelier-full-e2e-provider-runtime.json Station-owned evidence for the configured provider profileRef, proving provider runtime, model quality, streaming UX, artifact persistence, and trace/checkpoint/resume without exposing provider/runtime/artifact/trace controls to the applet.',
    },
  ];

  const document = {
    ok: true,
    evidenceClass: 'READINESS_AUDIT',
    gate: 'atelier:full-e2e-preflight',
    readiness: 'NOT_READY',
    globalReady: false,
    validatedScripts: requiredScripts.map((script) => ({ script, command: packageJson.scripts[script] })),
    sourceArtifacts: sourceArtifacts.map((artifact) => ({
      path: artifact,
      status: missingSourceArtifacts.includes(artifact) ? 'MISSING' : 'PRESENT',
    })),
    validatedEvidence,
    presentRuntimeInputs,
    missingRuntimeInputs,
    invalidRuntimeInputs,
    sourceInstrumentation,
    sourceInstrumentationGaps,
    finalProofObligations,
    runOrder: [
      'pnpm run atelier:controlled-gates',
      'pnpm run atelier:real-product-gates',
      'pnpm run atelier:full-e2e-preflight',
      'pnpm run atelier:full-e2e with the runtime inputs listed above',
      'rerun pnpm run atelier:completion-readiness-audit after final evidence is wired',
    ],
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
  };

  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
}

main();
