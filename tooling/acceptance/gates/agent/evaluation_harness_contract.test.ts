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
const evaluationPage = [
  'apps/desktop/src/pages/EvaluationPage.tsx',
  'apps/desktop/src/pages/evaluation/RunList.tsx',
  'apps/desktop/src/pages/evaluation/RunDetail.tsx',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

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
