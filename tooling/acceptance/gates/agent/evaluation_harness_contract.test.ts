import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { resolve } from 'node:path';

const harness = readFileSync(
  resolve(
    process.cwd(),
    'apps/desktop/src/acceptance/agent/harness.ts',
  ),
  'utf8',
);
const navigation = readFileSync(
  resolve(process.cwd(), 'apps/desktop/src/hooks/useNavigation.ts'),
  'utf8',
);
const evaluationPage = [
  'apps/desktop/src/pages/EvaluationPage.tsx',
  'apps/desktop/src/pages/evaluation/RunList.tsx',
  'apps/desktop/src/pages/evaluation/RunDetail.tsx',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');
const httpGateway = readFileSync(
  resolve(
    process.cwd(),
    'apps/desktop/src-tauri/src/interface/http_gateway/mod.rs',
  ),
  'utf8',
);

const canonicalSelectors = [
  'data-pt-evaluation-page',
  'data-pt-evaluation-tab',
  'data-pt-evaluation-create-run',
  'data-pt-evaluation-target-agent',
  'data-pt-evaluation-dataset',
  'data-pt-evaluation-create-run-submit',
  'data-pt-evaluation-run',
  'data-pt-evaluation-start-run',
  'data-pt-evaluation-cancel-run',
  'data-pt-evaluation-retry-run',
  'data-pt-evaluation-result',
  'data-pt-evaluation-back-to-runs',
] as const;

test('J06 harness uses production Evaluation commands and native selectors', () => {
  for (const command of [
    'agent_evaluation_benchmark_create',
    'agent_evaluation_dataset_create',
    'agent_evaluation_case_create',
    'agent_evaluation_run_create',
    'agent_evaluation_run_start',
    'agent_evaluation_run_cancel',
    'agent_evaluation_run_retry',
    'agent_evaluation_run_get',
    'agent_evaluation_run_list',
    'agent_evaluation_run_events_list',
    'agent_evaluation_run_delete',
  ]) {
    assert.match(harness, new RegExp(`['"]${command}['"]`));
  }
  for (const selector of canonicalSelectors) {
    assert.match(harness, new RegExp(selector));
  }
});

test('J06 harness selector contract matches the production page', () => {
  for (const selector of canonicalSelectors) {
    assert.match(evaluationPage, new RegExp(selector));
  }
  for (const staleSelector of [
    'data-pt-evaluation-lab',
    'data-pt-evaluation-run-open',
    'data-pt-evaluation-run-start',
    'data-pt-evaluation-run-cancel',
    'data-pt-evaluation-retry-failed',
  ]) {
    assert.doesNotMatch(harness, new RegExp(staleSelector));
  }
});

test('J06 harness exposes phased recovery, isolation, and cleanup', () => {
  assert.match(harness, /runEvaluationDevelopment/);
  assert.match(harness, /case 'prepare'/);
  assert.match(harness, /case 'recover'/);
  assert.match(harness, /case 'isolate'/);
  assert.match(harness, /case 'cleanup'/);
  assert.match(harness, /retentionConflictObserved/);
  assert.match(harness, /cancellationAcknowledged/);
  assert.match(harness, /sourceAttemptId/);
  assert.match(harness, /sourceResultId/);
  assert.match(harness, /schedulerClaim/);
  assert.match(
    harness,
    /deleteFoundationDisposableRuntimeFixture\(\{\s*providerId: state\.providerId,\s*modelId: state\.modelId,/,
  );
});

test('J06 waits for persisted turn traces before attestation', () => {
  assert.match(harness, /async function waitForEvaluationTurnTrace\(/);
  assert.equal(
    [...harness.matchAll(/waitForEvaluationTurnTrace\(attempt\.turnId\)/g)].length,
    2,
  );
  assert.match(
    harness,
    /evidenceField\([\s\S]*?['"]traceId['"],\s*['"]trace_id['"]/,
  );
});

test('J06 AS-08 cancellation retries only refreshed revision conflicts', () => {
  const scenarioStart = harness.indexOf(
    'async function runEvaluationScenarioCell',
  );
  const as08Start = harness.indexOf(
    "if (input.cell === 'AS-08')",
    scenarioStart,
  );
  const as08End = harness.indexOf(
    '\n  const run = await createEvaluationScenarioRun(fixture);',
    as08Start + 1,
  );
  const as08 = harness.slice(as08Start, as08End);
  assert.match(as08, /for \(let attempt = 0; attempt < 12; attempt \+= 1\)/);
  assert.match(as08, /const current = await getEvaluationRun\(run\.runId\)/);
  assert.match(as08, /expectedRevision: current\.run\.revision/);
  assert.match(
    as08,
    /evaluationRevisionMutationKey\(\s*['"]run:cancel['"],\s*run\.runId,\s*current\.run\.revision/,
  );
  assert.match(
    as08,
    /if \(observedErrorCode\(error\) !== ['"]VERSION_CONFLICT['"]\) throw error/,
  );
});

test('J06 ERR-E04 creates a retryable partial parent before idempotency conflict', () => {
  const definitionsStart = harness.indexOf(
    'function evaluationScenarioCaseDefinitions',
  );
  const scenarioStart = harness.indexOf(
    'async function runEvaluationScenarioCell',
    definitionsStart,
  );
  const definitions = harness.slice(definitionsStart, scenarioStart);
  const errE04Start = definitions.indexOf("if (cell === 'ERR-E04')");
  const errE04End = definitions.indexOf('\n  return [{', errE04Start);
  const errE04 = definitions.slice(errE04Start, errE04End);

  assert.match(errE04, /input: ['"]J06_FAIL_ONCE_CASE['"]/);
  assert.match(errE04, /input: ['"]J06_PASS_CASE['"]/);
  assert.doesNotMatch(errE04, /never-match/);
  assert.match(
    harness,
    /terminal\.run\.status !== EvaluationRunStatus\.FAILED[\s\S]*?terminal\.run\.status !== EvaluationRunStatus\.PARTIAL/,
  );
});

test('J06 browser gateway exposes the scenario clock-advance command', () => {
  assert.match(
    httpGateway,
    /"agent_capability_acceptance_scenario_clock_advance"\s*=>/,
  );
  assert.match(
    httpGateway,
    /app_capability_authority::advance_acceptance_scenario_clock\(/,
  );
});

test('J06 R-09 completion-first ordering expects stale cancellation revision', () => {
  const scenarioStart = harness.indexOf(
    'async function runEvaluationScenarioCell',
  );
  const orderingBStart = harness.indexOf(
    "input.cell === 'R-09' && input.ordering === 'B'",
    scenarioStart,
  );
  const orderingBEnd = harness.indexOf('\n  const terminal =', orderingBStart);
  const orderingB = harness.slice(orderingBStart, orderingBEnd);

  assert.match(orderingB, /expectedRevision: startedRun\.revision/);
  assert.match(
    orderingB,
    /const cancellation = expectEvaluationScenarioError\(\s*\(\) => invokeEvaluationProto\(/,
  );
  assert.match(
    orderingB,
    /['"]VERSION_CONFLICT['"],\s*\);\s*await waitForEvaluationScenarioBarrier/,
  );
  assert.match(
    orderingB,
    /completionFirstCancellationError = await cancellation/,
  );
  assert.doesNotMatch(
    orderingB,
    /EVALUATION_ERROR_CODE_RUN_NOT_CANCELLABLE/,
  );
  assert.match(
    harness,
    /completionWon[\s\S]*?\? ['"]VERSION_CONFLICT['"][\s\S]*?completionFirstCancellationError\?\.code/,
  );
  assert.match(
    harness,
    /detailCode === ['"]AGENT_4009['"]\s*\?\s*['"]VERSION_CONFLICT['"]/,
  );
});

test('J06 station readback omits secret-bearing idempotency fields', () => {
  assert.match(
    harness,
    /EVALUATION_EVIDENCE_OMITTED_KEYS = new Set\(\[\s*['"]idempotencyKey['"],\s*['"]idempotency_key['"],\s*\]\)/,
  );
  assert.match(
    harness,
    /facts: evaluationEvidenceValue\(outcome\.controlState\)/,
  );
});

test('shared Station binding returns the canonical active peer identity', () => {
  assert.match(harness, /const activeStationPeerId = \(/);
  assert.match(harness, /activeStationPeerId,/);
  assert.match(harness, /peerIdAvailable: Boolean\(activeStationPeerId\)/);
});

test('shared harness exposes Station-accepted capability session evidence', () => {
  assert.match(harness, /async waitForCapabilitySession\(\)/);
  assert.match(harness, /return waitForCapabilitySessionEvidence\(\)/);
});

test('J06 native navigation reaches the production Evaluation page', () => {
  assert.match(
    harness,
    /EVENT\.NAVIGATION_REQUESTED,\s*\{\s*resource:\s*['"]evaluation['"]\s*\}/,
  );
  assert.match(
    navigation,
    /case\s+['"]evaluation['"]:\s*router\.setPage\(['"]evaluation['"]\)/,
  );
});

test('J06 selects the Ant Design Segmented input behind the stable tab marker', () => {
  const openRunsStart = harness.indexOf('async function openEvaluationRunsTab');
  const openRunsEnd = harness.indexOf(
    'async function closeEvaluationRunDetail',
    openRunsStart,
  );
  const openRuns = harness.slice(openRunsStart, openRunsEnd);
  assert.match(
    harness,
    /clickEvaluationTab\(EVALUATION_SELECTORS\.runsTab\)/,
  );
  assert.match(
    harness,
    /\.closest<HTMLLabelElement>\(['"]label['"]\)/,
  );
  assert.match(
    harness,
    /\.querySelector<HTMLInputElement>\(['"]input['"]\)/,
  );
  assert.match(harness, /input\.click\(\)/);
  assert.match(openRuns, /'Evaluation runs tab'/);
  assert.ok(
    openRuns.indexOf("'Evaluation runs tab'")
      < openRuns.indexOf('clickEvaluationTab(EVALUATION_SELECTORS.runsTab)'),
  );
});

test('J06 refreshes Station-owned Evaluation projection before driving run UI', () => {
  assert.match(
    harness,
    /await refreshEvaluationTargetProjection\(state\.agentId,\s*\{\s*clientCapabilitySessionId:\s*capabilitySession\.capabilitySessionId/,
  );
  assert.match(
    harness,
    /Boolean\(control\?\.getClientRects\(\)\.length\) && !control\?\.disabled/,
  );
  assert.match(
    harness,
    /`Evaluation control \$\{selector\}`/,
  );
  assert.match(harness, /\.ant-select-selector/);
  assert.match(harness, /\['mousedown', 'mouseup', 'click'\]/);
});

test('J06 Acceptance does not use the legacy Evaluation store', () => {
  const j06Start = harness.indexOf('const EVALUATION_SELECTORS');
  const j06End = harness.indexOf(
    'async function runGovernedToolDevelopmentJourney',
    j06Start,
  );
  assert.notEqual(j06Start, -1);
  assert.notEqual(j06End, -1);
  const j06 = harness.slice(j06Start, j06End);
  assert.doesNotMatch(j06, /useEvaluationStore/);
  assert.doesNotMatch(j06, /localStorage/);
  assert.doesNotMatch(j06, /quickCompletion/);
});
