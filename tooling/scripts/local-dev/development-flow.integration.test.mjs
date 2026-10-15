import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assessStandaloneCompletionReview,
  prepareStandaloneCompletionReview,
} from './completion-review.mjs';
import {
  closeTaskProgress,
  createTaskProgress,
  inspectTaskProgressList,
  readTaskProgress,
  taskProgressPaths,
  TaskProgressError,
  updateTaskProgress,
} from './task-progress-store.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';
import { buildStandaloneWorkflowSnapshot } from './workflow-snapshot.mjs';
import { evaluateWorkflowEvent } from './workflow-kernel.mjs';
import {
  normalizeHostPayload,
  renderHostFailure,
  renderHostResponse,
} from './workflow-host-adapters.mjs';
import { inspectDevelopmentFlowResidue } from './development-flow-residue.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  '..',
);

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fixture(prefix = 'pt-development-flow-') {
  const base = mkdtempSync(path.join(tmpdir(), prefix));
  const root = path.join(base, 'workspace');
  mkdirSync(root);
  execFileSync('git', ['init', '-b', 'test/development-flow'], {
    cwd: root,
    stdio: 'ignore',
  });
  git(root, 'config', 'user.email', 'flow@example.invalid');
  git(root, 'config', 'user.name', 'Development Flow');
  git(root, 'config', 'core.hooksPath', '/dev/null');
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'fixture');
  return {
    base,
    root,
    close() {
      rmSync(base, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    },
  };
}

function taskInput(scope, taskId, overrides = {}) {
  return {
    workspaceRoot: scope.root,
    taskId,
    northStarRef: 'docs/global/workflow.md',
    contribution: `Observable contribution for ${taskId}.`,
    goal: `Complete ${taskId}.`,
    ...overrides,
  };
}

function expectTaskCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof TaskProgressError);
    assert.equal(error.code, code);
    return true;
  });
}

let agentIntegrationSuiteResult;
function agentIntegrationSuite() {
  if (!agentIntegrationSuiteResult) {
    agentIntegrationSuiteResult = spawnSync(
      'python3',
      ['-m', 'unittest', 'tooling/scripts/agent-integration-audit-test.py'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      },
    );
  }
  return agentIntegrationSuiteResult;
}

let machineAdmissionSuiteResult;
function machineAdmissionSuite() {
  if (!machineAdmissionSuiteResult) {
    const environment = { ...process.env };
    delete environment.NODE_TEST_CONTEXT;
    machineAdmissionSuiteResult = spawnSync(
      process.execPath,
      [
        '--test',
        '--test-name-pattern=FLOW-A1[123]',
        'tooling/scripts/local-dev/machine-dev.test.mjs',
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: environment,
        timeout: 120_000,
      },
    );
  }
  return machineAdmissionSuiteResult;
}

test('FLOW-A01 ordinary authorized work completes without Hook or workflow state', () => {
  const scope = fixture();
  try {
    writeFileSync(path.join(scope.root, 'result.txt'), 'north-star-result\n');
    execFileSync('git', ['diff', '--check'], { cwd: scope.root });
    assert.equal(
      readFileSync(path.join(scope.root, 'result.txt'), 'utf8'),
      'north-star-result\n',
    );
    assert.equal(existsSync(path.join(scope.root, '.dev-workflow')), false);
  } finally {
    scope.close();
  }
});

test('FLOW-A02 unrelated corrupt history does not block a new explicit task', () => {
  const scope = fixture();
  try {
    const corrupt = path.join(scope.root, '.dev-workflow/tasks/BAD');
    mkdirSync(corrupt, { recursive: true });
    writeFileSync(path.join(corrupt, 'task.json'), '{"bad":true}\n');
    const good = createTaskProgress(taskInput(scope, 'GOOD'));
    const status = inspectTaskProgressList({ workspaceRoot: scope.root });
    assert.equal(good.state, 'active');
    assert.deepEqual(status.tasks.map((item) => item.taskId), ['GOOD']);
    assert.deepEqual(status.invalid.map((item) => item.taskId), ['BAD']);
  } finally {
    scope.close();
  }
});

test('FLOW-A03 installed Hook command survives spaces and restricted PATH', () => {
  const result = agentIntegrationSuite();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran \d+ tests/u);
  assert.match(result.stderr, /OK/u);
});

test('FLOW-A04 malformed, unidentified, and failing Hook input stays neutral', async () => {
  const malformed = normalizeHostPayload(null, {
    host: 'trae',
    event: 'unknown',
  });
  const result = await evaluateWorkflowEvent(malformed);
  const response = renderHostResponse('trae', result, malformed);
  const failure = renderHostFailure(
    'trae',
    'PreToolUse',
    new Error('internal'),
  );
  assert.notEqual(response?.hookSpecificOutput?.permissionDecision, 'deny');
  assert.notEqual(failure?.hookSpecificOutput?.permissionDecision, 'deny');
  assert.deepEqual(failure, {});
  assert.equal(result.executionRoot, null);
});

test('FLOW-A06 two fixed repositories remain isolated and never invoke worktree creation', () => {
  const first = fixture('pt-flow-first-');
  const second = fixture('pt-flow-second-');
  try {
    const bin = path.join(first.base, 'bin');
    const log = path.join(first.base, 'git.log');
    mkdirSync(bin);
    const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    const wrapper = path.join(bin, 'git');
    writeFileSync(
      wrapper,
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "${log}"\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 },
    );
    const script = path.join(
      REPO_ROOT,
      'tooling/scripts/local-dev/dev-work.mjs',
    );
    const environment = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
    for (const [scope, taskId] of [
      [first, 'FIRST'],
      [second, 'SECOND'],
    ]) {
      const result = spawnSync(
        process.execPath,
        [
          script,
          'start',
          '--workspace-root',
          scope.root,
          '--task',
          taskId,
          '--goal',
          `Goal ${taskId}`,
          '--contribution',
          `Contribution ${taskId}`,
        ],
        { cwd: scope.root, env: environment, encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
    }
    const firstTask = readTaskProgress({
      workspaceRoot: first.root,
      taskId: 'FIRST',
    });
    closeTaskProgress({
      workspaceRoot: first.root,
      taskId: 'FIRST',
      expectedRevision: firstTask.revision,
      state: 'completed',
      evidenceRefs: [{ kind: 'FUNCTIONAL_CHECK', ref: 'evidence://first' }],
    });
    const next = createTaskProgress(taskInput(first, 'FIRST-NEXT'));
    assert.equal(next.state, 'active');
    assert.equal(
      existsSync(path.join(second.root, '.dev-workflow/tasks/FIRST-NEXT')),
      false,
    );
    assert.doesNotMatch(readFileSync(log, 'utf8'), /worktree\s+add/u);
  } finally {
    first.close();
    second.close();
  }
});

test('FLOW-A07 multiple tasks require explicit selection and keep independent locks', () => {
  const scope = fixture();
  try {
    createTaskProgress(taskInput(scope, 'TASK-ONE'));
    createTaskProgress(taskInput(scope, 'TASK-TWO'));
    expectTaskCode('TASK_PROGRESS_INVALID', () =>
      readTaskProgress({ workspaceRoot: scope.root }),
    );
    const one = taskProgressPaths({
      workspaceRoot: scope.root,
      taskId: 'TASK-ONE',
    });
    const two = taskProgressPaths({
      workspaceRoot: scope.root,
      taskId: 'TASK-TWO',
    });
    assert.notEqual(one.lock, two.lock);
  } finally {
    scope.close();
  }
});

test('FLOW-A08 one atomic snapshot detects corruption without synthetic recovery', () => {
  const scope = fixture();
  try {
    const current = createTaskProgress(taskInput(scope, 'RECOVER'));
    const paths = taskProgressPaths({
      workspaceRoot: scope.root,
      taskId: 'RECOVER',
    });
    writeFileSync(
      paths.snapshot,
      `${JSON.stringify({ ...current, revision: 2 })}\n`,
    );
    expectTaskCode('TASK_PROGRESS_CHECKSUM_INVALID', () =>
      readTaskProgress({
        workspaceRoot: scope.root,
        taskId: 'RECOVER',
      }),
    );
  } finally {
    scope.close();
  }
});

test('FLOW-A09 source change invalidates old task evidence', () => {
  const scope = fixture();
  try {
    const started = createTaskProgress(
      taskInput(scope, 'FRESHNESS', {
        evidenceRefs: [{ kind: 'SOURCE_CHECK', ref: 'evidence://old' }],
      }),
    );
    writeFileSync(path.join(scope.root, 'source.txt'), 'changed\n');
    git(scope.root, 'add', 'source.txt');
    git(scope.root, 'commit', '-m', 'change source');
    const updated = updateTaskProgress({
      workspaceRoot: scope.root,
      taskId: started.taskId,
      expectedRevision: started.revision,
      reason: 'Refresh current source.',
    });
    assert.notEqual(updated.currentSource, started.currentSource);
    assert.deepEqual(updated.evidenceRefs, []);
  } finally {
    scope.close();
  }
});

test('FLOW-A10 unknown operation outcome parks only its selected task', () => {
  const scope = fixture();
  try {
    const selected = createTaskProgress(taskInput(scope, 'UNKNOWN'));
    const independent = createTaskProgress(taskInput(scope, 'INDEPENDENT'));
    const parked = updateTaskProgress({
      workspaceRoot: scope.root,
      taskId: selected.taskId,
      expectedRevision: selected.revision,
      state: 'blocked',
      blocker: {
        action: 'inspect-operation',
        reason: 'Outcome is unknown.',
      },
      reason: 'Park unknown result without retry.',
    });
    assert.equal(parked.state, 'blocked');
    assert.equal(
      readTaskProgress({
        workspaceRoot: scope.root,
        taskId: independent.taskId,
      }).state,
      'active',
    );
    const resumed = updateTaskProgress({
      workspaceRoot: scope.root,
      taskId: selected.taskId,
      expectedRevision: parked.revision,
      state: 'active',
      blocker: null,
      reason: 'Authoritative readback resolved the outcome.',
    });
    assert.equal(resumed.state, 'active');
    assert.equal(resumed.revision, 3);
  } finally {
    scope.close();
  }
});

for (const scenario of ['FLOW-A11', 'FLOW-A12', 'FLOW-A13']) {
  test(`${scenario} runtime authority remains in binding, policy, and OS leases`, () => {
    const result = machineAdmissionSuite();
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(scenario, 'u'));
  });
}

test('FLOW-A14 Suite provisioning reuses reviewed actors without reset', () => {
  const result = spawnSync(
    'python3',
    [
      '-m',
      'unittest',
      'tooling.acceptance.tests.test_provisioner_runtime.ProvisionerBlockingTests.test_agent_v2_binding_reuses_profile_two_actors_without_reset',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /OK/u);
});

test('FLOW-A15 close is task-local and unsettled resources remain blocking', () => {
  const scope = fixture();
  try {
    const task = createTaskProgress(
      taskInput(scope, 'CLOSE', {
        resourceRefs: [{ resourceKey: 'device:one', state: 'running' }],
      }),
    );
    expectTaskCode('TASK_PROGRESS_RESOURCE_UNSETTLED', () =>
      closeTaskProgress({
        workspaceRoot: scope.root,
        taskId: task.taskId,
        expectedRevision: task.revision,
        state: 'completed',
        evidenceRefs: [{ kind: 'FUNCTIONAL_CHECK', ref: 'evidence://close' }],
      }),
    );
    const next = createTaskProgress(taskInput(scope, 'UNRELATED'));
    assert.equal(next.state, 'active');
  } finally {
    scope.close();
  }
});

test('FLOW-A16 standalone completion review rejects missing and stale evidence', async () => {
  const scope = fixture();
  try {
    const obligations = [{ id: 'result', expected: 'observable' }];
    const missing = await prepareStandaloneCompletionReview({
      repoRoot: scope.root,
      obligations,
    });
    assert.equal(missing.reviewable, false);
    await assert.rejects(
      () =>
        prepareStandaloneCompletionReview({
          repoRoot: scope.root,
          obligations,
          evidenceRefs: [
            {
              kind: 'FUNCTIONAL_CHECK',
              result: 'PASS',
              ref: 'caller://pass',
              source: {
                commit: '0'.repeat(40),
                workspaceDigest: '0'.repeat(64),
              },
            },
          ],
        }),
      (error) => error.code === 'COMPLETION_REVIEW_EVIDENCE_STALE',
    );
    const source = inspectGitWorkspace(scope.root, {
      excludePaths: ['.dev-workflow'],
    });
    const accepted = await assessStandaloneCompletionReview({
      repoRoot: scope.root,
      obligations,
      evidenceRefs: [
        {
          kind: 'FUNCTIONAL_CHECK',
          result: 'PASS',
          ref: 'evidence://current',
          source,
        },
      ],
      findings: [],
    });
    assert.equal(accepted.verdict, 'PASS');
  } finally {
    scope.close();
  }
});

test('FLOW-A17 formal Acceptance derives proof instead of trusting caller PASS', () => {
  const result = spawnSync(
    'python3',
    [
      'tooling/scripts/acceptance-run-test.py',
      'AcceptanceRunTest.test_candidate_artifacts_are_required_only_after_gate_success',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', timeout: 120_000 },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /OK/u);
});

test('FLOW-A18 status is one-shot read-only and creates no optional task state', async () => {
  const scope = fixture();
  try {
    assert.equal(existsSync(path.join(scope.root, '.dev-workflow')), false);
    const snapshot = await buildStandaloneWorkflowSnapshot({
      workspaceRoots: [scope.root],
      now: new Date('2026-10-13T00:00:00.000Z'),
    });
    assert.equal(snapshot.worktrees.length, 1);
    assert.deepEqual(snapshot.worktrees[0].tasks, []);
    assert.equal(existsSync(path.join(scope.root, '.dev-workflow')), false);
  } finally {
    scope.close();
  }
});

test('FLOW-A19 consumers preserve north-star outcome and zero retired references', () => {
  const scope = fixture();
  try {
    const task = createTaskProgress(
      taskInput(scope, 'NORTH-STAR', {
        northStarRef: 'docs/global/workflow.md',
        contribution: 'Deliver a current-source observable result.',
      }),
    );
    const residue = inspectDevelopmentFlowResidue({ repoRoot: REPO_ROOT });
    assert.equal(task.northStarRef, 'docs/global/workflow.md');
    assert.equal(
      task.contribution,
      'Deliver a current-source observable result.',
    );
    assert.equal(residue.status, 'PASS');
    assert.deepEqual(residue.findings, []);
  } finally {
    scope.close();
  }
});

test('FLOW-A20 selected-root Hook removal preserves Skills and unrelated config', () => {
  const result = agentIntegrationSuite();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, /Ran \d+ tests/u);
});
