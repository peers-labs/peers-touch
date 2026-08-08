#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-workspace-open-controlled-gate.json');
const contractPath = 'apps/applets/atelier/contracts/atelier-projection.contract.json';
const rustGatewayPath = 'apps/desktop/src-tauri/src/application/applets/mod.rs';

const rustTestPattern = 'atelier_workspace_open_';

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'Desktop gateway accepts only canonical pt-workspace://task/<taskId>?workspace=<workspaceId> workspace open intents',
    'Desktop gateway rejects non-contract workspace URI shapes before native resolver or IDE launch',
    'Desktop gateway response remains Host-intent-only and does not expose file, shell, execute, run, or openExternalUrl fields',
    'Atelier applet workspace.open remains a Host UI intent rather than provider/runtime execution',
  ],
  doesNotProve: [
    'real IDE launch',
    'real workspace resolver',
    'real sandbox runtime',
    'real Desktop product window UI',
    'complete Host + Station + applet E2E',
  ],
};

mkdirSync(evidenceDir, { recursive: true });

function runRustTests() {
  const result = spawnSync('cargo', ['test', rustTestPattern], {
    cwd: path.resolve('apps/desktop/src-tauri'),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `cargo test ${rustTestPattern} failed: ${output}`);
  assert(output.includes('atelier_workspace_open_accepts_host_intent_only_canonical_uri'));
  assert(output.includes('atelier_workspace_open_rejects_non_contract_uri_shapes'));
  assert(output.includes('atelier_workspace_open_writes_full_e2e_action_evidence'));
  return output.split(/\r?\n/).filter(Boolean).slice(-40);
}

function assertContractMetadata() {
  const contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  const workspaceOpen = contract.methodPayloads?.['atelier.workspace.open']?.controlledEvidence;
  assert.equal(workspaceOpen?.desktopGatewayUriShapeProven, true);
  assert.equal(workspaceOpen?.desktopGatewayRejectsNonContractUriProven, true);
  assert.equal(workspaceOpen?.desktopGatewayNoNativeLaunchProven, true);
  assert.equal(workspaceOpen?.realIdeLaunchProven, false);
  assert.equal(workspaceOpen?.realWorkspaceResolverProven, false);
  assert.equal(workspaceOpen?.realSandboxRuntimeProven, false);
  assert(workspaceOpen.gates.includes('atelier:workspace-open-controlled-gate'));
  assert(workspaceOpen.evidenceFiles.includes('tooling/acceptance/evidence/applets/official-applet/atelier-workspace-open-controlled-gate.json'));
}

function assertRustAnchors() {
  const rustGateway = readFileSync(rustGatewayPath, 'utf8');
  for (const anchor of [
    'validate_atelier_workspace_open_uri(task_id, workspace_uri)?',
    'Url::parse(workspace_uri)',
    'parsed.scheme() != "pt-workspace"',
    'parsed.host_str() != Some("task")',
    'task_segments[0] != task_id',
    'query_pairs.len() != 1',
    'query_pairs[0].0 != "workspace"',
    'opened": false',
    'mode": "host_intent"',
    'native IDE launch is gated for real E2E',
  ]) {
    assert(rustGateway.includes(anchor), `missing Desktop gateway workspace open anchor: ${anchor}`);
  }
  for (const forbidden of [
    '"localPath"',
    '"filePath"',
    '"command"',
    '"shell"',
    '"execute"',
    '"run"',
    '"openExternalUrl"',
  ]) {
    assert(!rustGateway.includes(`${forbidden}: workspace_uri`), `workspace open must not expose ${forbidden}`);
  }
}

function assertCurrentLaunchWorkspaceOpenActionEvidence(evidence, { launchId, sessionId, ideHint }) {
  assert.equal(typeof evidence, 'object', 'workspace.open action evidence must be an object');
  assert.notEqual(evidence, null, 'workspace.open action evidence must be present');
  assert.equal(Array.isArray(evidence), false, 'workspace.open action evidence must not be an array');
  assert.equal(evidence.ok, true);
  assert.equal(evidence.launchId, launchId, 'workspace.open action evidence must match current launchId');
  assert.equal(evidence.appletId, 'peers.atelier');
  assert.equal(evidence.sessionId, sessionId, 'workspace.open action evidence must match current sessionId');
  assert.equal(evidence.action, 'atelier.workspace.open');
  assert.equal(evidence.accepted, true);
  assert.equal(evidence.mode, 'host_intent');
  assert.equal(evidence.hostSideEffect, 'workspace_open_intent');
  assert.equal(evidence.realIdeLaunchProven, false);
  assert.equal(evidence.ideHint, ideHint);
  assert.equal(evidence.taskId, 'task-controlled');
  assert.equal(evidence.workspaceUri, 'pt-workspace://task/task-controlled?workspace=workspace-controlled');
  assert.equal(evidence.completedAt, '2026-07-09T00:00:00Z');

  const parsed = new URL(evidence.workspaceUri);
  assert.equal(parsed.protocol, 'pt-workspace:');
  assert.equal(parsed.hostname, 'task');
  assert.equal(parsed.pathname, `/${encodeURIComponent(evidence.taskId)}`);
  assert.equal(parsed.searchParams.getAll('workspace').length, 1);
  assert.equal(parsed.searchParams.get('workspace'), 'workspace-controlled');
  assert.equal(JSON.stringify(evidence).includes('file://'), false);
  assert.equal(JSON.stringify(evidence).includes('"shell"'), false);
  assert.equal(JSON.stringify(evidence).includes('"openExternalUrl"'), false);
  assert.equal(JSON.stringify(evidence).includes('"input_snapshot"'), false);
}

function assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, mutation, reason) {
  assert.throws(
    () => assertCurrentLaunchWorkspaceOpenActionEvidence({ ...baseEvidence, ...mutation }, context),
    undefined,
    `workspace.open action evidence mutation must be rejected: ${reason}`,
  );
}

function assertWorkspaceOpenActionEvidenceContract() {
  const context = {
    launchId: 'launch-controlled',
    sessionId: 'session-controlled',
    ideHint: 'cursor',
  };
  const baseEvidence = {
    ok: true,
    launchId: context.launchId,
    appletId: 'peers.atelier',
    sessionId: context.sessionId,
    action: 'atelier.workspace.open',
    accepted: true,
    mode: 'host_intent',
    hostSideEffect: 'workspace_open_intent',
    realIdeLaunchProven: false,
    ideHint: context.ideHint,
    taskId: 'task-controlled',
    workspaceUri: 'pt-workspace://task/task-controlled?workspace=workspace-controlled',
    completedAt: '2026-07-09T00:00:00Z',
  };

  assertCurrentLaunchWorkspaceOpenActionEvidence(baseEvidence, context);
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { launchId: 'stale-launch' }, 'stale launchId');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { sessionId: 'stale-session' }, 'stale sessionId');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { action: 'provider.invoke' }, 'non-workspace action');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { mode: 'native_launch' }, 'native launch mode');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { realIdeLaunchProven: true }, 'real IDE launch overclaim');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { hostSideEffect: 'shell_execute' }, 'shell side effect');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { workspaceUri: 'file:///tmp/workspace' }, 'file URL workspace');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { workspaceUri: 'pt-workspace://task/other-task?workspace=workspace-controlled' }, 'task mismatch');
  assertRejectsWorkspaceOpenActionEvidenceMutation(baseEvidence, context, { workspaceUri: 'pt-workspace://task/task-controlled?workspace=other-workspace' }, 'workspace mismatch');

  return {
    currentLaunchScoped: true,
    acceptsCanonicalHostIntentEvidence: true,
    rejectsStaleLaunchEvidence: true,
    rejectsStaleSessionEvidence: true,
    rejectsNonWorkspaceActionEvidence: true,
    rejectsNativeLaunchOverclaim: true,
    rejectsFileShellOpenExternalPayload: true,
  };
}

function runGate() {
  const outputTail = runRustTests();
  assertContractMetadata();
  assertRustAnchors();
  const currentLaunchActionEvidence = assertWorkspaceOpenActionEvidenceContract();
  return {
    ok: true,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-workspace-open-controlled-gate',
    source: 'desktop_gateway_workspace_open_host_intent_tests',
    command: `cargo test ${rustTestPattern}`,
    tests: [
      'atelier_workspace_open_accepts_host_intent_only_canonical_uri',
      'atelier_workspace_open_rejects_non_contract_uri_shapes',
    ],
    desktopGatewayWorkspaceOpen: {
      desktopGatewayUriShapeProven: true,
      desktopGatewayRejectsNonContractUriProven: true,
      desktopGatewayNoNativeLaunchProven: true,
      realIdeLaunchProven: false,
      realWorkspaceResolverProven: false,
      realSandboxRuntimeProven: false,
    },
    currentLaunchActionEvidence,
    claimBoundary,
    notCovered: claimBoundary.doesNotProve,
    outputTail,
  };
}

try {
  const evidence = runGate();
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`PASS Atelier workspace open controlled gate: ${evidencePath}\n`);
} catch (error) {
  const evidence = {
    ok: false,
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    gate: 'atelier-workspace-open-controlled-gate',
    claimBoundary,
    error: error instanceof Error ? error.message : String(error),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.error(`FAIL Atelier workspace open controlled gate: ${evidence.error}`);
  process.exitCode = 1;
}
