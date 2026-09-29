import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  TASK_SLICES_COLLECTION,
  assertPlanDiscoveryFenceUnchanged,
  assertPlanDiscoveryReadable,
  discoverPlanPackages,
  loadPlanPackage,
  renderPlanDocument,
  summarizePlanProgress,
} from './plan-package.mjs';
import {
  commitPlanMigration,
  getPlanMigrationPaths,
  preparePlanMigration,
  processIdentityForPid,
  readPlanMigrationJournal,
  recoverPlanMigration,
  sha256,
  validatePlanMigrationJournal,
} from './plan-migration.mjs';
import { advancePlan } from './planctl.mjs';
import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  createSessionStore,
  sessionStorePaths,
  transitionSessionStore,
} from '../local-dev/dev-session-store.mjs';
import { createInitialSessionState } from '../local-dev/dev-session-schema.mjs';

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PLANCTL = path.join(TEST_DIRECTORY, 'planctl.mjs');
const INITIAL_HEAD = '3d4e858ce0c8e28969e01a736e2b238269aedb3b';
const EXPECTED_HEAD = '771605c8d768ea3ef73a1b9b1a63befae354292f';
const WORKSPACE_ID = 'b0a926025d2b25b9';
const FIXED_TIME = '2026-09-16T00:00:00.000Z';
const SOURCE_WORKSPACE_DIGEST = `sha256:${'a'.repeat(64)}`;
const ACTIVE_WORK_REGISTRY_REF =
  'context://memory/projects/planctl-test/project_memory.md';
const EMPTY_ACTIVE_WORK_REGISTRY = '# Project Memory\n';

function taskEntry(id, workstreamId, dependsOn, status) {
  return {
    id,
    workstreamId,
    path: `tasks/${id}.md`,
    dependsOn,
    status,
    blocker:
      status === 'blocked'
        ? {
            code: 'OWNER_INPUT_REQUIRED',
            owner: 'architecture',
            evidenceRef: `evidence/${id}.json`,
          }
        : null,
  };
}

function manifestForStatus(status) {
  const statuses = {
    active: ['in_progress', 'pending'],
    prepared: ['pending', 'pending'],
    blocked: ['blocked', 'pending'],
    completed: ['done', 'done'],
    superseded: ['pending', 'pending'],
  };
  const selected = statuses[status];
  if (!selected) throw new Error(`unsupported fixture status ${status}`);
  return {
    kind: 'peers-touch-plan-package',
    planId: 'DWF-TEST',
    status,
    binding: {
      branch: 'merge-desktop-prototype',
      workspaceId: WORKSPACE_ID,
      initialHead: INITIAL_HEAD,
    },
    workClass: 'infrastructure',
    architecture: {
      sources: ['docs/architecture/development-workflow/design.md'],
      decisions: ['DWF-D13'],
    },
    scope: {
      sourceClaims: [
        {
          pathPrefix: 'tooling/scripts/plan',
          mode: 'exclusive-write',
        },
        {
          pathPrefix: 'docs/architecture/development-workflow',
          mode: 'shared-read',
        },
      ],
      nonGoals: ['Mobile product changes'],
    },
    tasks: [
      taskEntry('task-a', 'DWF-B1', [], selected[0]),
      taskEntry('task-b', 'DWF-B2', ['task-a'], selected[1]),
    ],
    exhaustion:
      status === 'blocked'
        ? {
            recordedAt: FIXED_TIME,
            blockedTaskIds: ['task-a'],
            decisionRefs: ['DWF-D13'],
            evidenceRefs: ['evidence/task-a.json'],
          }
        : null,
    authorization: {
      checkpoint: {
        localCommit: 'denied',
        amend: 'denied',
      },
      delivery: {
        push: 'denied',
        pullRequest: 'denied',
      },
      runtime: {
        deployProfiles: [],
        destructiveResetScopes: [],
      },
      history: {
        rewrite: 'denied',
      },
    },
  };
}

function taskSliceFor(entry) {
  return {
    kind: 'peers-touch-task-slice',
    planId: 'DWF-TEST',
    taskId: entry.id,
    workstreamId: entry.workstreamId,
    title: `Task ${entry.id}`,
    workClass: 'infrastructure',
    completionClass: 'functional',
    executionMode: 'build',
    closureId: `closure-${entry.id}`,
    journeyId: `journey-${entry.id}`,
    runtimeClass: 'source-only',
    writeSet: [`tooling/scripts/plan/${entry.id}.mjs`],
    readSet: ['docs/architecture/development-workflow/design.md'],
    budgets: {
      focusedCheckSeconds: 30,
      functionalRunSeconds: 60,
      cleanupSeconds: 10,
    },
    checks: [
      {
        id: `check-${entry.id}`,
        command: `node --check tooling/scripts/plan/${entry.id}.mjs`,
        verificationClass: 'SOURCE_CHECK',
      },
      {
        id: `functional-${entry.id}`,
        command: `node --test tooling/scripts/plan/${entry.id}.test.mjs`,
        verificationClass: 'FUNCTIONAL_CHECK',
      },
      {
        id: `acceptance-${entry.id}`,
        command: `node --test tooling/scripts/plan/${entry.id}.test.mjs`,
        verificationClass: 'ACCEPTANCE_PROOF',
      },
    ],
    doneWhen: ['Focused checks pass'],
    failureBehavior: ['Stop on the first typed failure'],
    updatedAt: FIXED_TIME,
    durableEvidence: [],
  };
}

function runtimeReuseContract() {
  return {
    scope: 'suite',
    entryCheckId: 'functional-task-a',
    scenarioIds: ['scenario-a', 'scenario-b'],
    maxProvisioningRuns: 1,
    maxClientLaunches: 2,
    minWarmReuseRate: 0.5,
    requireAttachOnlyScenarios: true,
    requireReceiverVisibleProof: true,
    allowClientReplacement: false,
  };
}

function acceptanceForTasks(tasks) {
  const closures = {};
  const gates = [];
  for (const entry of tasks) {
    const closureId = `closure-${entry.id}`;
    const gateId = `gate-${entry.id}`;
    closures[closureId] = [gateId];
    gates.push(gateId);
  }
  return {
    closures,
    completion: gates,
    full: [...gates, 'release-gate'],
  };
}

function progressPackage(statuses, { status = 'active', dependsOn = {} } = {}) {
  const tasks = statuses.map((taskStatus, index) => {
    const id = `task-${index + 1}`;
    return {
      id,
      status: taskStatus,
      dependsOn: dependsOn[id] ?? [],
    };
  });
  return {
    manifest: { status, tasks },
    taskSlices: new Map(
      tasks.map((task) => [task.id, { title: `Task ${task.id}` }]),
    ),
  };
}

function planMarkdown(manifest, acceptance, suffix = '') {
  return `# Test Plan

> **Status**: ${manifest.status}
> **Branch**: ${manifest.binding.branch}
> **Workspace ID**: ${manifest.binding.workspaceId}
> **Initial HEAD**: ${manifest.binding.initialHead}

## Plan Package

\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

## Acceptance Execution

\`\`\`json
${JSON.stringify(acceptance, null, 2)}
\`\`\`

## Goal

Exercise the bounded workflow control plane.
${suffix}`;
}

function taskMarkdown(task, suffix = '') {
  return `# ${task.title}

## Task Slice

\`\`\`json
${JSON.stringify(task, null, 2)}
\`\`\`

## Objective

Implement ${task.taskId}.

## Current Snapshot

- State is deterministic.
${suffix}`;
}

async function makeFixture(
  t,
  {
    status = 'active',
    mutateManifest,
    mutateAcceptance,
    mutateTaskSlices,
    planSuffix = '',
    taskSuffix = {},
  } = {},
) {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'planctl-test-'));
  const root = await fsp.realpath(temporaryRoot);
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await fsp.mkdir(path.join(root, '.git'));
  await fsp.mkdir(path.join(root, 'tooling/scripts/plan'), { recursive: true });
  await fsp.mkdir(path.join(root, 'docs/architecture/development-workflow'), {
    recursive: true,
  });
  await fsp.writeFile(
    path.join(root, 'docs/architecture/development-workflow/design.md'),
    '# Design\n',
  );

  const packageRelative = 'docs/architecture/test/execution-plans/sample';
  const packageDirectory = path.join(root, ...packageRelative.split('/'));
  const tasksDirectory = path.join(packageDirectory, 'tasks');
  await fsp.mkdir(tasksDirectory, { recursive: true });

  const manifest = manifestForStatus(status);
  if (mutateManifest) mutateManifest(manifest);
  const taskSlices = new Map(
    manifest.tasks.map((entry) => [entry.id, taskSliceFor(entry)]),
  );
  if (mutateTaskSlices) mutateTaskSlices(taskSlices, manifest);
  const acceptance = acceptanceForTasks(manifest.tasks);
  if (mutateAcceptance) mutateAcceptance(acceptance, manifest, taskSlices);

  for (const entry of manifest.tasks) {
    const task = taskSlices.get(entry.id) ?? taskSliceFor(entry);
    await fsp.writeFile(
      path.join(packageDirectory, ...entry.path.split('/')),
      taskMarkdown(task, taskSuffix[entry.id] ?? ''),
    );
  }
  const planPath = path.join(packageDirectory, 'plan.md');
  await fsp.writeFile(planPath, planMarkdown(manifest, acceptance, planSuffix));
  return {
    root,
    packageRelative,
    packageDirectory,
    planPath,
    manifest,
    acceptance,
    taskSlices,
  };
}

function blockedSessionFor(fixture, evidenceRef = 'evidence/task-a.json') {
  const home = path.join(fixture.root, 'home');
  const workItemId = 'DWF-TEST-WORK';
  const initial = createInitialSessionState(
    {
      sessionId: 'DWF-TEST-SESSION',
      workItemId,
      planId: fixture.manifest.planId,
      taskId: 'task-a',
      workspaceId: fixture.manifest.binding.workspaceId,
      branch: fixture.manifest.binding.branch,
      journeyId: fixture.taskSlices.get('task-a').journeyId,
      executionMode: fixture.taskSlices.get('task-a').executionMode,
    },
    FIXED_TIME,
  );
  const options = {
    home,
    workspaceRoot: fixture.root,
    workspaceId: fixture.manifest.binding.workspaceId,
    workItemId,
    now: FIXED_TIME,
    expected: {
      sessionId: initial.sessionId,
      workItemId,
      planId: initial.planId,
      taskId: initial.taskId,
      workspaceId: initial.workspaceId,
      branch: initial.branch,
    },
  };
  createSessionStore(initial, {
    ...options,
    reason: 'start blocked handoff fixture',
  });
  transitionSessionStore({
    ...options,
    now: '2026-09-16T00:00:01.000Z',
    context: {
      task: fixture.taskSlices.get('task-a'),
      acceptance: fixture.acceptance,
      authorization: fixture.manifest.authorization,
    },
    to: 'BLOCKED',
    reason: 'host capability unavailable',
    updates: {
      failure: {
        kind: 'SOURCE_CHECK_FAILED',
        stage: 'BOUND',
        owner: 'source',
        summary: 'blocked handoff fixture',
        retryable: false,
        diagnosticRef: evidenceRef,
      },
    },
  });
  return sessionStorePaths(options).session;
}

function createSessionFixture(
  fixture,
  {
    taskId = 'task-a',
    sessionId = `DWF-TEST-${taskId}-SESSION`,
    workItemId = `DWF-TEST-${taskId}-WORK`,
  } = {},
) {
  const home = path.join(fixture.root, 'home');
  const task = fixture.taskSlices.get(taskId);
  const initial = createInitialSessionState(
    {
      sessionId,
      workItemId,
      planId: fixture.manifest.planId,
      taskId,
      workspaceId: fixture.manifest.binding.workspaceId,
      branch: fixture.manifest.binding.branch,
      journeyId: task.journeyId,
      executionMode: task.executionMode,
    },
    FIXED_TIME,
  );
  let tick = 0;
  const options = {
    home,
    workspaceRoot: fixture.root,
    workspaceId: fixture.manifest.binding.workspaceId,
    workItemId,
    expected: {
      sessionId,
      workItemId,
      planId: initial.planId,
      taskId,
      workspaceId: initial.workspaceId,
      branch: initial.branch,
    },
  };
  const context = {
    task,
    acceptance: fixture.acceptance,
    authorization: fixture.manifest.authorization,
  };
  createSessionStore(initial, {
    ...options,
    now: FIXED_TIME,
    reason: 'start Plan handoff fixture',
  });

  function transition(to, updates = {}) {
    tick += 1;
    return transitionSessionStore({
      ...options,
      now: new Date(Date.parse(FIXED_TIME) + tick * 1_000).toISOString(),
      context,
      to,
      reason: `advance fixture to ${to}`,
      updates,
    });
  }

  function verification(verificationClass, result = 'PASS') {
    return {
      id: `${taskId}-${verificationClass.toLowerCase()}`,
      verificationClass,
      result,
      startedAt: FIXED_TIME,
      durationMs: 10,
      artifactRefs: [],
    };
  }

  function sourceCheckpoint() {
    return {
      commit: INITIAL_HEAD,
      tree: '8'.repeat(40),
      branch: fixture.manifest.binding.branch,
      clean: true,
      createdAt: FIXED_TIME,
      purpose: 'development-runtime',
    };
  }

  function complete() {
    if (task.executionMode === 'fix') {
      transition('REPRODUCING');
      transition('REPRODUCED', {
        verification: verification('FUNCTIONAL_CHECK', 'FAIL'),
        failure: {
          kind: 'SOURCE_CHECK_FAILED',
          stage: 'REPRODUCING',
          owner: 'source',
          summary: 'deterministic reproduction',
          retryable: true,
        },
      });
    }
    transition('IMPLEMENTING', task.executionMode === 'fix' ? { failure: null } : {});
    transition('FOCUSED_CHECKING');
    transition('FOCUSED_PASS', {
      verification: verification('SOURCE_CHECK'),
    });
    if (task.completionClass === 'source') {
      transition('SOURCE_READY');
      return;
    }
    if (task.completionClass === 'functional') {
      transition('FUNCTIONAL_RUNNING');
      transition('FUNCTIONAL_PASS', {
        verification: verification('FUNCTIONAL_CHECK'),
      });
      if (fixture.acceptance.closures[task.closureId].length === 0) {
        transition('DELIVERY_READY');
        return;
      }
      transition('ACCEPTANCE_READY');
      transition('FINAL_CHECKPOINTED', { source: sourceCheckpoint() });
    }
    transition('ACCEPTANCE_RUNNING');
    transition('ACCEPTANCE_PASS', {
      verification: verification('ACCEPTANCE_PROOF'),
    });
    transition('DELIVERY_READY');
  }

  function cancel() {
    transition('CLEANING');
    transition('CANCELLED');
  }

  return {
    path: sessionStorePaths(options).session,
    complete,
    cancel,
  };
}

function planLockRecord(planPath, {
  pid,
  processIdentity,
  ownerToken,
} = {}) {
  return {
    kind: 'peers-touch-plan-lock',
    planPath,
    ownerToken: ownerToken ?? 'a'.repeat(64),
    pid: pid ?? 2_147_483_647,
    processIdentity: processIdentity ?? '0'.repeat(64),
    createdAt: FIXED_TIME,
  };
}

async function expectPlanError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

function invokeCli(args, executable = PLANCTL, environment = process.env) {
  return spawnSync(process.execPath, [executable, ...args], {
    encoding: 'utf8',
    env: environment,
  });
}

function parseCliSuccess(result) {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

function parseCliFailure(result) {
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  return JSON.parse(result.stderr);
}

for (const status of ['active', 'prepared', 'blocked', 'completed']) {
  test(`loads a valid ${status} Plan Package`, async (t) => {
    const fixture = await makeFixture(t, { status });
    const result = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
    });
    assert.equal(result.manifest.status, status);
    assert.equal(result.manifest.binding.initialHead, INITIAL_HEAD);
    assert.equal(TASK_SLICES_COLLECTION, 'Map');
    assert.ok(result.taskSlices instanceof Map);
    if (status === 'active') {
      assert.equal(result.currentTask.taskId, 'task-a');
      assert.deepEqual(result.readyTasks, []);
    } else {
      assert.equal(result.currentTask, null);
    }
  });
}

test('rejects closed-schema additions, duplicate IDs, cycles, current, and exhaustion errors', async (t) => {
  await t.test('unknown manifest field', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.extra = true;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('workflow version labels are rejected as unknown fields', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.workflowVersion = 1;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('Plan Package schemaVersion is rejected', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.schemaVersion = 1;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('Task Slice schemaVersion is rejected', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').schemaVersion = 1;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('functional Task accepts a closed runtime reuse contract', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.runtimeClass = 'native-desktop';
        task.runtimeReuse = runtimeReuseContract();
      },
    });
    const planPackage = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
    });
    assert.deepEqual(
      planPackage.taskSlices.get('task-a').runtimeReuse,
      runtimeReuseContract(),
    );
  });

  await t.test('runtime reuse rejects scenario scope', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.runtimeClass = 'native-desktop';
        task.runtimeReuse = runtimeReuseContract();
        task.runtimeReuse.scope = 'scenario';
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('runtime reuse rejects duplicate scenarios', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.runtimeClass = 'native-desktop';
        task.runtimeReuse = runtimeReuseContract();
        task.runtimeReuse.scenarioIds = ['scenario-a', 'scenario-a'];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_DUPLICATE',
    );
  });

  await t.test('runtime reuse rejects source-only runtime', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').runtimeReuse = runtimeReuseContract();
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_RUNTIME_INVALID',
    );
  });

  await t.test('Acceptance Execution schemaVersion is rejected', async (t) => {
    const fixture = await makeFixture(t, {
      mutateAcceptance(acceptance) {
        acceptance.schemaVersion = 1;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('obsolete advancing HEAD field', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.binding.expectedHead = EXPECTED_HEAD;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('obsolete sibling worktree digest field', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.binding.worktreeSetDigest = 'c'.repeat(64);
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('duplicate task ID', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.tasks[1].id = 'task-a';
        manifest.tasks[1].path = 'tasks/task-a.md';
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_DUPLICATE',
    );
  });

  await t.test('DAG cycle', async (t) => {
    const fixture = await makeFixture(t, {
      status: 'prepared',
      mutateManifest(manifest) {
        manifest.tasks[0].dependsOn = ['task-b'];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_DAG_INVALID',
    );
  });

  await t.test('active without current', async (t) => {
    const fixture = await makeFixture(t, {
      mutateManifest(manifest) {
        manifest.tasks[0].status = 'pending';
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_STATE_INVALID',
    );
  });

  await t.test('blocked package with ready work', async (t) => {
    const fixture = await makeFixture(t, {
      status: 'blocked',
      mutateManifest(manifest) {
        manifest.tasks[1].dependsOn = [];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_STATE_INVALID',
    );
  });

  await t.test('blocked package with stale exhaustion', async (t) => {
    const fixture = await makeFixture(t, {
      status: 'blocked',
      mutateManifest(manifest) {
        manifest.exhaustion.blockedTaskIds = ['task-b'];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_STATE_INVALID',
    );
  });
});

test('enforces manifest, task, snapshot, and history bounds', async (t) => {
  await t.test('manifest line bound', async (t) => {
    const fixture = await makeFixture(t, {
      planSuffix: `\n${'plain state\n'.repeat(310)}`,
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_BOUNDS_EXCEEDED',
    );
  });

  await t.test('task byte bound', async (t) => {
    const fixture = await makeFixture(t, {
      taskSuffix: {
        'task-a': `\n${'x'.repeat(13 * 1024)}`,
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_BOUNDS_EXCEEDED',
    );
  });

  await t.test('snapshot line bound', async (t) => {
    const fixture = await makeFixture(t, {
      taskSuffix: {
        'task-a': `\n${'- snapshot row\n'.repeat(31)}`,
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SNAPSHOT_INVALID',
    );
  });

  for (const heading of ['Context Anchor', 'Appendix', 'Raw Command Output', 'Run-ID List']) {
    await t.test(`forbidden ${heading}`, async (t) => {
      const fixture = await makeFixture(t, {
        planSuffix: `\n## ${heading}\n\n- forbidden\n`,
      });
      await expectPlanError(
        loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
        'PLAN_FORBIDDEN_SECTION',
      );
    });
  }
});

test('renderPlanDocument falls back to bounded compact JSON for a large manifest', () => {
  const manifest = manifestForStatus('prepared');
  manifest.tasks = Array.from({ length: 20 }, (_, index) =>
    taskEntry(`task-${index}`, `W${index}`, [], 'pending'),
  );
  const acceptance = acceptanceForTasks(manifest.tasks);
  const compactSource = planMarkdown(manifest, acceptance).replace(
    JSON.stringify(manifest, null, 2),
    JSON.stringify(manifest),
  );

  const rendered = renderPlanDocument(compactSource, manifest);
  assert.ok(rendered.split('\n').length <= 300);
  assert.ok(rendered.includes(JSON.stringify(manifest.tasks[19])));
});

test('renderPlanDocument removes obsolete sibling worktree metadata', () => {
  const manifest = manifestForStatus('prepared');
  const acceptance = acceptanceForTasks(manifest.tasks);
  const source = planMarkdown(manifest, acceptance).replace(
    `> **Initial HEAD**: ${manifest.binding.initialHead}`,
    [
      `> **Initial HEAD**: ${manifest.binding.initialHead}`,
      `> **Worktree-set Digest**: ${'c'.repeat(64)}`,
    ].join('\n'),
  );

  const rendered = renderPlanDocument(source, manifest);
  assert.equal(rendered.includes('Worktree-set Digest'), false);
});

test('renderPlanDocument rejects obsolete Expected HEAD metadata', () => {
  const manifest = manifestForStatus('prepared');
  const acceptance = acceptanceForTasks(manifest.tasks);
  const source = planMarkdown(manifest, acceptance).replace(
    `> **Initial HEAD**: ${manifest.binding.initialHead}`,
    [
      `> **Initial HEAD**: ${manifest.binding.initialHead}`,
      `> **Expected HEAD**: ${EXPECTED_HEAD}`,
    ].join('\n'),
  );

  assert.throws(
    () => renderPlanDocument(source, manifest),
    (error) => error.code === 'PLAN_METADATA_MISMATCH',
  );
});

test('rejects metadata and task/Acceptance crosswalk mismatches', async (t) => {
  await t.test('Task work class may differ from the package classification', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.workClass = 'product-behavior';
        task.runtimeClass = 'native-mobile';
      },
    });
    const planPackage = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
    });
    assert.equal(planPackage.manifest.workClass, 'infrastructure');
    assert.equal(planPackage.taskSlices.get('task-a').workClass, 'product-behavior');
  });

  await t.test('source-only runtime rejects a product behavior Task', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').workClass = 'product-behavior';
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_RUNTIME_INVALID',
    );
  });

  await t.test('missing completion class fails closed', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        delete taskSlices.get('task-a').completionClass;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCHEMA_INVALID',
    );
  });

  await t.test('product source Task has one direct functional successor', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices, manifest) {
        const source = taskSlices.get('task-a');
        source.workClass = 'product-behavior';
        source.completionClass = 'source';
        source.checks = source.checks.filter(
          (check) => check.verificationClass === 'SOURCE_CHECK',
        );
        const proof = taskSlices.get('task-b');
        proof.workstreamId = source.workstreamId;
        manifest.tasks[1].workstreamId = source.workstreamId;
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    const planPackage = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
    });
    assert.equal(
      planPackage.taskSlices.get('task-a').completionClass,
      'source',
    );
  });

  await t.test('source Task rejects a formal Gate', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices, manifest) {
        const source = taskSlices.get('task-a');
        source.completionClass = 'source';
        source.checks = source.checks.filter(
          (check) => check.verificationClass === 'SOURCE_CHECK',
        );
        taskSlices.get('task-b').workstreamId = source.workstreamId;
        manifest.tasks[1].workstreamId = source.workstreamId;
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_ACCEPTANCE_MISMATCH',
    );
  });

  await t.test('source Task rejects a functional check', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const source = taskSlices.get('task-a');
        source.completionClass = 'source';
        source.checks = source.checks.filter(
          (check) => check.verificationClass !== 'ACCEPTANCE_PROOF',
        );
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_CHECK_INVALID',
    );
  });

  await t.test('source Task requires source-only runtime', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices, manifest) {
        const source = taskSlices.get('task-a');
        source.completionClass = 'source';
        source.runtimeClass = 'native-mobile';
        source.checks = source.checks.filter(
          (check) => check.verificationClass === 'SOURCE_CHECK',
        );
        taskSlices.get('task-b').workstreamId = source.workstreamId;
        manifest.tasks[1].workstreamId = source.workstreamId;
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_RUNTIME_INVALID',
    );
  });

  await t.test('source Task rejects functional durable evidence', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices, manifest) {
        const source = taskSlices.get('task-a');
        source.completionClass = 'source';
        source.checks = source.checks.filter(
          (check) => check.verificationClass === 'SOURCE_CHECK',
        );
        source.durableEvidence = [
          {
            verificationClass: 'FUNCTIONAL_CHECK',
            result: 'PASS',
            ref: 'development://invalid-functional-claim',
          },
        ];
        taskSlices.get('task-b').workstreamId = source.workstreamId;
        manifest.tasks[1].workstreamId = source.workstreamId;
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_EVIDENCE_INVALID',
    );
  });

  await t.test('source Task requires a direct same-workstream proof', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const source = taskSlices.get('task-a');
        source.completionClass = 'source';
        source.checks = source.checks.filter(
          (check) => check.verificationClass === 'SOURCE_CHECK',
        );
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_SUCCESSOR_INVALID',
    );
  });

  await t.test('functional Task with Gates requires proof check', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'ACCEPTANCE_PROOF',
        );
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_ACCEPTANCE_MISMATCH',
    );
  });

  await t.test('acceptance aggregate owns proof without functional checks', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-b');
        task.completionClass = 'acceptance-aggregate';
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'FUNCTIONAL_CHECK',
        );
      },
    });
    const planPackage = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
    });
    assert.equal(
      planPackage.taskSlices.get('task-b').completionClass,
      'acceptance-aggregate',
    );
  });

  await t.test('acceptance aggregate requires a functional predecessor', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.completionClass = 'acceptance-aggregate';
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'FUNCTIONAL_CHECK',
        );
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_ACCEPTANCE_DEPENDENCY_INVALID',
    );
  });

  await t.test('acceptance aggregate rejects a functional check', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').completionClass = 'acceptance-aggregate';
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_CHECK_INVALID',
    );
  });

  await t.test('acceptance aggregate requires source-only orchestration', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.completionClass = 'acceptance-aggregate';
        task.runtimeClass = 'native-mobile';
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'FUNCTIONAL_CHECK',
        );
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_RUNTIME_INVALID',
    );
  });

  await t.test('acceptance aggregate requires a formal Gate', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.completionClass = 'acceptance-aggregate';
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'FUNCTIONAL_CHECK',
        );
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_ACCEPTANCE_MISMATCH',
    );
  });

  await t.test('manifest metadata mismatch', async (t) => {
    const fixture = await makeFixture(t);
    const markdown = await fsp.readFile(fixture.planPath, 'utf8');
    await fsp.writeFile(
      fixture.planPath,
      markdown.replace(`> **Initial HEAD**: ${INITIAL_HEAD}`, `> **Initial HEAD**: ${EXPECTED_HEAD}`),
    );
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_METADATA_MISMATCH',
    );
  });

  await t.test('obsolete sibling worktree metadata', async (t) => {
    const fixture = await makeFixture(t);
    const markdown = await fsp.readFile(fixture.planPath, 'utf8');
    await fsp.writeFile(
      fixture.planPath,
      markdown.replace(
        `> **Initial HEAD**: ${INITIAL_HEAD}`,
        [
          `> **Initial HEAD**: ${INITIAL_HEAD}`,
          `> **Expected HEAD**: ${EXPECTED_HEAD}`,
          `> **Worktree-set Digest**: ${'c'.repeat(64)}`,
        ].join('\n'),
      ),
    );
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_METADATA_MISMATCH',
    );
  });

  await t.test('task identity mismatch', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').planId = 'OTHER-PLAN';
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_MISMATCH',
    );
  });

  await t.test('missing focused check', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'SOURCE_CHECK',
        );
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_CHECK_INVALID',
    );
  });

  await t.test('missing functional check', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.checks = task.checks.filter(
          (check) => check.verificationClass !== 'FUNCTIONAL_CHECK',
        );
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_TASK_CHECK_INVALID',
    );
  });

  await t.test('documentation may omit a functional check', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        const task = taskSlices.get('task-a');
        task.workClass = 'documentation';
        task.completionClass = 'source';
        task.checks = task.checks.filter(
          (check) =>
            !['FUNCTIONAL_CHECK', 'ACCEPTANCE_PROOF'].includes(
              check.verificationClass,
            ),
        );
      },
      mutateAcceptance(acceptance) {
        acceptance.closures['closure-task-a'] = [];
      },
    });
    const planPackage = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
    });
    assert.equal(planPackage.taskSlices.get('task-a').workClass, 'documentation');
  });

  await t.test('missing Acceptance closure', async (t) => {
    const fixture = await makeFixture(t, {
      mutateAcceptance(acceptance) {
        delete acceptance.closures['closure-task-b'];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_ACCEPTANCE_MISMATCH',
    );
  });
});

test('enforces segment-aware Plan scope and supplied declaration claims', async (t) => {
  await t.test('raw-prefix write escape', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').writeSet = ['tooling/scripts/plan-old/escape.mjs'];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
      'PLAN_SCOPE_MISMATCH',
    );
  });

  await t.test('declaration adds scope', async (t) => {
    const fixture = await makeFixture(t);
    await expectPlanError(
      loadPlanPackage(fixture.planPath, {
        repoRoot: fixture.root,
        declarationClaims: [
          {
            pathPrefix: 'apps/mobile',
            mode: 'exclusive-write',
          },
        ],
      }),
      'PLAN_SCOPE_MISMATCH',
    );
  });

  await t.test('narrow declaration covers only the current task sets', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').writeSet = [
          'tooling/scripts/plan/lane-a/task-a.mjs',
        ];
        taskSlices.get('task-b').writeSet = [
          'tooling/scripts/plan/lane-b/task-b.mjs',
        ];
      },
    });
    const result = await loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
      declarationClaims: [
        {
          pathPrefix: 'tooling/scripts/plan/lane-a',
          mode: 'exclusive-write',
        },
        {
          pathPrefix: 'docs/architecture/development-workflow',
          mode: 'shared-read',
        },
      ],
    });
    assert.equal(result.currentTask.taskId, 'task-a');
  });

  await t.test('narrow declaration rejects the current task sets', async (t) => {
    const fixture = await makeFixture(t, {
      mutateTaskSlices(taskSlices) {
        taskSlices.get('task-a').writeSet = [
          'tooling/scripts/plan/lane-a/task-a.mjs',
        ];
      },
    });
    await expectPlanError(
      loadPlanPackage(fixture.planPath, {
        repoRoot: fixture.root,
        declarationClaims: [
          {
            pathPrefix: 'tooling/scripts/plan/lane-b',
            mode: 'exclusive-write',
          },
        ],
      }),
      'PLAN_SCOPE_MISMATCH',
    );
  });
});

test('rejects a task write path that resolves through an escaping symlink', async (t) => {
  const fixture = await makeFixture(t, {
    mutateTaskSlices(taskSlices) {
      taskSlices.get('task-a').writeSet = ['tooling/scripts/plan/escape/file.mjs'];
    },
  });
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'planctl-outside-'));
  t.after(() => fsp.rm(outside, { recursive: true, force: true }));
  await fsp.symlink(outside, path.join(fixture.root, 'tooling/scripts/plan/escape'));
  await expectPlanError(
    loadPlanPackage(fixture.planPath, { repoRoot: fixture.root }),
    'PLAN_PATH_ESCAPE',
  );
});

test('discovery excludes archive content', async (t) => {
  const fixture = await makeFixture(t);
  const archived = path.join(
    fixture.packageDirectory,
    'archive',
    'historical-package',
    'plan.md',
  );
  await fsp.mkdir(path.dirname(archived), { recursive: true });
  await fsp.writeFile(
    archived,
    '## Plan Package\n```json\n{"this":"would fail if discovered"}\n```\n',
  );
  const packages = await discoverPlanPackages(
    path.join(fixture.root, 'docs/architecture/test/execution-plans'),
    { repoRoot: fixture.root },
  );
  assert.equal(packages.length, 1);
  assert.equal(packages[0].path, fixture.planPath);
});

test('plan discovery fence rejects migration state changes across a read window', async (t) => {
  const fixture = await makeFixture(t);
  const journalPath = path.join(fixture.root, '.machine', 'migration.json');
  const lockPath = path.join(fixture.root, '.machine', 'migration.lock');
  await fsp.mkdir(path.dirname(journalPath), { recursive: true });
  const options = {
    migrationJournalPath: journalPath,
    migrationLockPath: lockPath,
  };
  const identity = { repoRoot: fixture.root };
  const fence = await assertPlanDiscoveryReadable(options, identity);

  await fsp.writeFile(
    journalPath,
    `${JSON.stringify({ phase: 'PREPARED', revision: 1 })}\n`,
  );

  await expectPlanError(
    assertPlanDiscoveryFenceUnchanged(fence, options, identity),
    'PLAN_MIGRATION_IN_PROGRESS',
  );
});

test('planctl validate/current/next/status emit structured JSON through direct and symlink invocation', async (t) => {
  const fixture = await makeFixture(t);
  const common = ['--plan', fixture.planPath, '--repo-root', fixture.root];

  const validation = parseCliSuccess(invokeCli(['validate', ...common]));
  assert.equal(validation.ok, true);
  assert.equal(validation.taskCount, 2);

  const current = parseCliSuccess(invokeCli(['current', ...common]));
  assert.equal(current.currentTask.id, 'task-a');
  assert.equal(current.currentTask.closureId, 'closure-task-a');
  assert.equal(current.currentTask.completionClass, 'functional');

  const next = parseCliSuccess(invokeCli(['next', ...common]));
  assert.deepEqual(next.readyTasks, []);

  const status = parseCliSuccess(invokeCli(['status', ...common]));
  assert.equal(status.ok, true);
  assert.equal(status.plan, fixture.planPath);
  assert.equal(status.planId, 'DWF-TEST');
  assert.equal(status.status, 'active');
  assert.equal(status.branch, 'merge-desktop-prototype');
  assert.equal(status.workspaceId, WORKSPACE_ID);
  assert.equal(status.initialHead, INITIAL_HEAD);
  assert.deepEqual(status.taskStatuses, {
    'task-a': 'in_progress',
    'task-b': 'pending',
  });
  assert.deepEqual(status.progress, {
    unit: 'task-closure',
    completed: 0,
    total: 2,
    percentage: 0,
    currentTaskId: 'task-a',
    nextProgressBoundary: {
      taskId: 'task-a',
      title: 'Task task-a',
      transition: 'in_progress->done',
      completedDelta: 1,
      completedAfter: 1,
      percentageAfter: 50,
      percentagePointDelta: 50,
      unlocksTaskIds: ['task-b'],
    },
  });
  assert.equal(status.currentTaskId, 'task-a');
  assert.equal(status.currentTaskPath, 'tasks/task-a.md');
  assert.equal(status.currentClosure, 'closure-task-a');
  assert.deepEqual(status.acceptance, fixture.acceptance);
  assert.deepEqual(status.closureStatuses, {
    'closure-task-a': 'in_progress',
    'closure-task-b': 'pending',
  });
  assert.deepEqual(status.closures, status.closureStatuses);
  assert.deepEqual(status.completion, fixture.acceptance.completion);
  assert.deepEqual(status.full, fixture.acceptance.full);
  assert.deepEqual(status.allDeclaredGateIds, [
    'gate-task-a',
    'gate-task-b',
    'release-gate',
  ]);

  const symlinkPath = path.join(fixture.root, 'planctl-link.mjs');
  await fsp.symlink(PLANCTL, symlinkPath);
  const symlinkStatus = parseCliSuccess(invokeCli(['status', ...common], symlinkPath));
  assert.equal(symlinkStatus.currentTaskId, 'task-a');

  const failure = parseCliFailure(invokeCli(['unknown', ...common]));
  assert.equal(failure.ok, false);
  assert.equal(failure.error.type, 'PlanPackageError');
  assert.equal(failure.error.code, 'PLAN_CLI_USAGE');
});

test('progress projection exposes the exact post-Next target from integer task counts', () => {
  const statuses = Array(42).fill('pending');
  statuses.fill('done', 0, 29);
  statuses[29] = 'in_progress';

  const progress = summarizePlanProgress(progressPackage(statuses));

  assert.equal(progress.completed, 29);
  assert.equal(progress.total, 42);
  assert.equal(progress.percentage, 69.05);
  assert.equal(progress.nextProgressBoundary.completedDelta, 1);
  assert.equal(progress.nextProgressBoundary.completedAfter, 30);
  assert.equal(progress.nextProgressBoundary.percentageAfter, 71.43);
  assert.equal(progress.nextProgressBoundary.percentagePointDelta, 2.38);
});

test('progress projection handles the first and final task boundaries', () => {
  const first = summarizePlanProgress(
    progressPackage(['in_progress', 'pending', 'pending']),
  );
  assert.deepEqual(
    {
      completedAfter: first.nextProgressBoundary.completedAfter,
      percentageAfter: first.nextProgressBoundary.percentageAfter,
      percentagePointDelta: first.nextProgressBoundary.percentagePointDelta,
    },
    {
      completedAfter: 1,
      percentageAfter: 33.33,
      percentagePointDelta: 33.33,
    },
  );

  const final = summarizePlanProgress(
    progressPackage(['done', 'done', 'in_progress']),
  );
  assert.deepEqual(
    {
      completedAfter: final.nextProgressBoundary.completedAfter,
      percentageAfter: final.nextProgressBoundary.percentageAfter,
      percentagePointDelta: final.nextProgressBoundary.percentagePointDelta,
      unlocksTaskIds: final.nextProgressBoundary.unlocksTaskIds,
    },
    {
      completedAfter: 3,
      percentageAfter: 100,
      percentagePointDelta: 33.33,
      unlocksTaskIds: [],
    },
  );
});

test('progress projection reports newly unlocked tasks without counting them complete', () => {
  const progress = summarizePlanProgress(
    progressPackage(
      ['done', 'in_progress', 'pending', 'pending', 'pending'],
      {
        dependsOn: {
          'task-3': [],
          'task-4': ['task-2'],
          'task-5': ['task-2', 'task-3'],
        },
      },
    ),
  );

  assert.equal(progress.nextProgressBoundary.completedAfter, 2);
  assert.deepEqual(progress.nextProgressBoundary.unlocksTaskIds, ['task-4']);
});

test('progress projection derives each percentage endpoint before rounding the delta', () => {
  const progress = summarizePlanProgress(
    progressPackage([
      'done',
      'in_progress',
      'pending',
      'pending',
      'pending',
      'pending',
    ]),
  );

  assert.equal(progress.percentage, 16.67);
  assert.equal(progress.nextProgressBoundary.percentageAfter, 33.33);
  assert.equal(progress.nextProgressBoundary.percentagePointDelta, 16.66);
});

test('progress projection has no post-Next target without an active current task', () => {
  for (const [status, statuses] of [
    ['draft', ['pending', 'pending']],
    ['prepared', ['pending', 'pending']],
    ['blocked', ['blocked', 'pending']],
    ['completed', ['done', 'done']],
    ['superseded', ['pending', 'pending']],
  ]) {
    const progress = summarizePlanProgress(
      progressPackage(statuses, { status }),
    );
    assert.equal(progress.currentTaskId, null, status);
    assert.equal(progress.nextProgressBoundary, null, status);
  }
});

test('planctl activate selects one explicit ready Task atomically', async (t) => {
  const fixture = await makeFixture(t, { status: 'prepared' });
  const original = await fsp.readFile(fixture.planPath);

  const rejected = parseCliFailure(
    invokeCli([
      'activate',
      '--plan',
      fixture.planPath,
      '--repo-root',
      fixture.root,
      '--task',
      'missing',
    ]),
  );
  assert.equal(rejected.error.code, 'PLAN_ACTIVATE_INVALID');
  assert.deepEqual(await fsp.readFile(fixture.planPath), original);

  const activated = parseCliSuccess(
    invokeCli([
      'activate',
      '--plan',
      fixture.planPath,
      '--repo-root',
      fixture.root,
      '--task',
      'task-a',
    ]),
  );
  assert.equal(activated.status, 'active');
  assert.equal(activated.currentTaskId, 'task-a');
  assert.equal(activated.initialHead, INITIAL_HEAD);

  const repeated = parseCliFailure(
    invokeCli([
      'activate',
      '--plan',
      fixture.planPath,
      '--repo-root',
      fixture.root,
      '--task',
      'task-a',
    ]),
  );
  assert.equal(repeated.error.code, 'PLAN_ACTIVATE_INVALID');
});

test('planctl advance atomically hands off and completes with successful Sessions', async (t) => {
  const fixture = await makeFixture(t);
  const taskASession = createSessionFixture(fixture);
  taskASession.complete();
  const common = ['--plan', fixture.planPath, '--repo-root', fixture.root];
  const original = await fsp.readFile(fixture.planPath);

  for (const session of [
    undefined,
    'NONE',
    path.join(fixture.root, 'missing', 'session.json'),
  ]) {
    const sessionArguments =
      session === undefined ? [] : ['--session', session];
    const missingSession = parseCliFailure(
      invokeCli([
        'advance',
        ...common,
        ...sessionArguments,
        '--task',
        'task-a',
        '--to',
        'done',
        '--next',
        'task-b',
      ]),
    );
    assert.equal(missingSession.error.code, 'PLAN_ADVANCE_INVALID');
    assert.deepEqual(await fsp.readFile(fixture.planPath), original);
  }

  const rejected = parseCliFailure(
    invokeCli([
      'advance',
      ...common,
      '--session',
      taskASession.path,
      '--task',
      'task-a',
      '--to',
      'done',
      '--next',
      'missing',
    ]),
  );
  assert.equal(rejected.error.code, 'PLAN_ADVANCE_INVALID');
  assert.deepEqual(await fsp.readFile(fixture.planPath), original);

  const handedOff = parseCliSuccess(
    invokeCli([
      'advance',
      ...common,
      '--session',
      taskASession.path,
      '--task',
      'task-a',
      '--to',
      'done',
      '--next',
      'task-b',
    ]),
  );
  assert.equal(handedOff.status, 'active');
  assert.equal(handedOff.currentTaskId, 'task-b');
  assert.equal(handedOff.initialHead, INITIAL_HEAD);
  assert.equal(handedOff.closureObservation.taskId, 'task-a');
  assert.equal(
    handedOff.closureObservation.terminalState,
    'DELIVERY_READY',
  );
  assert.equal(
    handedOff.closureObservation.evidence.FUNCTIONAL_CHECK,
    'PASS',
  );
  assert.ok(handedOff.closureObservation.timing.elapsedMs > 0);
  assert.equal(handedOff.closureObservation.tokens, null);

  const taskBSession = createSessionFixture(fixture, { taskId: 'task-b' });
  taskBSession.complete();
  const completed = parseCliSuccess(
    invokeCli([
      'advance',
      ...common,
      '--session',
      taskBSession.path,
      '--task',
      'task-b',
      '--to',
      'done',
    ]),
  );
  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentTaskId, null);
  const loaded = await loadPlanPackage(fixture.planPath, { repoRoot: fixture.root });
  assert.ok(loaded.manifest.tasks.every((task) => task.status === 'done'));
});

test('planctl completes when remaining Tasks are explicitly descoped', async (t) => {
  const fixture = await makeFixture(t, {
    mutateManifest(manifest) {
      manifest.tasks[1].status = 'descoped';
      manifest.tasks[1].blocker = {
        code: 'USER_DESCOPED',
        owner: 'user',
      };
    },
  });
  const session = createSessionFixture(fixture);
  session.complete();

  const completed = parseCliSuccess(
    invokeCli([
      'advance',
      '--plan',
      fixture.planPath,
      '--repo-root',
      fixture.root,
      '--session',
      session.path,
      '--task',
      'task-a',
      '--to',
      'done',
    ]),
  );

  assert.equal(completed.status, 'completed');
  assert.equal(completed.currentTaskId, null);
  const loaded = await loadPlanPackage(fixture.planPath, {
    repoRoot: fixture.root,
  });
  assert.deepEqual(
    loaded.manifest.tasks.map((task) => task.status),
    ['done', 'descoped'],
  );
});

test('planctl advance validates Session terminal state against completion class', async (t) => {
  const sourceFixture = await makeFixture(t, {
    mutateTaskSlices(taskSlices, manifest) {
      const source = taskSlices.get('task-a');
      source.completionClass = 'source';
      source.checks = source.checks.filter(
        (check) => check.verificationClass === 'SOURCE_CHECK',
      );
      const proof = taskSlices.get('task-b');
      proof.workstreamId = source.workstreamId;
      manifest.tasks[1].workstreamId = source.workstreamId;
    },
    mutateAcceptance(acceptance) {
      acceptance.closures['closure-task-a'] = [];
    },
  });
  const sourceSession = createSessionFixture(sourceFixture);
  sourceSession.complete();
  const sourceAdvance = parseCliSuccess(
    invokeCli([
      'advance',
      '--plan',
      sourceFixture.planPath,
      '--repo-root',
      sourceFixture.root,
      '--session',
      sourceSession.path,
      '--task',
      'task-a',
      '--to',
      'done',
      '--next',
      'task-b',
    ]),
  );
  assert.equal(sourceAdvance.currentTaskId, 'task-b');
  assert.equal(sourceAdvance.closureObservation.taskId, 'task-a');
  assert.equal(sourceAdvance.closureObservation.terminalState, 'SOURCE_READY');
  assert.equal(
    sourceAdvance.closureObservation.evidence.SOURCE_CHECK,
    'PASS',
  );

  const functionalFixture = await makeFixture(t);
  const cancelledSession = createSessionFixture(functionalFixture);
  cancelledSession.cancel();
  const rejected = parseCliFailure(
    invokeCli([
      'advance',
      '--plan',
      functionalFixture.planPath,
      '--repo-root',
      functionalFixture.root,
      '--session',
      cancelledSession.path,
      '--task',
      'task-a',
      '--to',
      'done',
      '--next',
      'task-b',
    ]),
  );
  assert.equal(rejected.error.code, 'PLAN_ADVANCE_INVALID');
  assert.equal(
    rejected.error.details.state,
    'CANCELLED',
  );

  const blockedFixture = await makeFixture(t, {
    mutateManifest(manifest) {
      manifest.tasks[1].dependsOn = [];
    },
  });
  const blockedSession = blockedSessionFor(blockedFixture);
  for (const session of ['NONE', path.join(blockedFixture.root, 'missing-session.json')]) {
    const rejectedBlockedHandoff = parseCliFailure(
      invokeCli([
        'advance',
        '--plan',
        blockedFixture.planPath,
        '--repo-root',
        blockedFixture.root,
        '--session',
        session,
        '--task',
        'task-a',
        '--to',
        'blocked',
        '--next',
        'task-b',
        '--blocker-code',
        'SOURCE_CHECK_FAILED',
        '--blocker-owner',
        'source',
        '--blocker-evidence-ref',
        'evidence/task-a.json',
      ]),
    );
    assert.equal(rejectedBlockedHandoff.error.code, 'PLAN_ADVANCE_INVALID');
  }
  const mismatchedBlocker = parseCliFailure(
    invokeCli([
      'advance',
      '--plan',
      blockedFixture.planPath,
      '--repo-root',
      blockedFixture.root,
      '--session',
      blockedSession,
      '--task',
      'task-a',
      '--to',
      'blocked',
      '--next',
      'task-b',
      '--blocker-code',
      'WRONG_BLOCKER',
      '--blocker-owner',
      'source',
      '--blocker-evidence-ref',
      'evidence/task-a.json',
    ]),
  );
  assert.equal(mismatchedBlocker.error.code, 'PLAN_ADVANCE_INVALID');
  const parked = parseCliSuccess(
    invokeCli([
      'advance',
      '--plan',
      blockedFixture.planPath,
      '--repo-root',
      blockedFixture.root,
      '--session',
      blockedSession,
      '--task',
      'task-a',
      '--to',
      'blocked',
      '--next',
      'task-b',
      '--blocker-code',
      'SOURCE_CHECK_FAILED',
      '--blocker-owner',
      'source',
      '--blocker-evidence-ref',
      'evidence/task-a.json',
    ]),
  );
  assert.equal(parked.currentTaskId, 'task-b');
  const parkedPlan = await loadPlanPackage(blockedFixture.planPath, {
    repoRoot: blockedFixture.root,
  });
  assert.equal(
    lifecycleTask(parkedPlan.manifest.tasks, 'task-a').status,
    'blocked',
  );
});

test('planctl advance accepts source-evidence for source-class Tasks without a Session', async (t) => {
  const fixture = await makeFixture(t, {
    mutateTaskSlices(taskSlices, manifest) {
      const source = taskSlices.get('task-a');
      source.completionClass = 'source';
      source.checks = source.checks.filter(
        (check) => check.verificationClass === 'SOURCE_CHECK',
      );
      const proof = taskSlices.get('task-b');
      proof.workstreamId = source.workstreamId;
      manifest.tasks[1].workstreamId = source.workstreamId;
    },
    mutateAcceptance(acceptance) {
      acceptance.closures['closure-task-a'] = [];
    },
  });
  const evidencePath = path.join(fixture.root, 'source-evidence.json');
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      planId: fixture.manifest.planId,
      taskId: 'task-a',
      workspaceId: fixture.manifest.binding.workspaceId,
      branch: fixture.manifest.binding.branch,
      verifications: [
        {
          verificationClass: 'SOURCE_CHECK',
          result: 'PASS',
        },
      ],
    }),
  );

  const advanced = await advancePlan(fixture.planPath, {
    'repo-root': fixture.root,
    'source-evidence': evidencePath,
    task: 'task-a',
    to: 'done',
    next: 'task-b',
  });

  assert.equal(advanced.manifest.status, 'active');
  assert.equal(advanced.currentTask.taskId, 'task-b');
  assert.equal(advanced.closureObservation.taskId, 'task-a');
  assert.equal(advanced.closureObservation.sessionId, null);
  assert.equal(advanced.closureObservation.timing, null);
  assert.equal(advanced.closureObservation.evidence.SOURCE_CHECK, 'PASS');
  assert.equal(
    advanced.closureObservation.evidence.STRUCTURAL_CHECK,
    'UNPROVEN',
  );
  assert.equal(advanced.closureObservation.evidence.UX_REVIEW, 'UNPROVEN');
});

test('planctl advance rejects source-evidence for non-source-class Tasks', async (t) => {
  const fixture = await makeFixture(t);
  const evidencePath = path.join(fixture.root, 'source-evidence.json');
  fs.writeFileSync(
    evidencePath,
    JSON.stringify({
      planId: fixture.manifest.planId,
      taskId: 'task-a',
      workspaceId: fixture.manifest.binding.workspaceId,
      branch: fixture.manifest.binding.branch,
      verifications: [
        { verificationClass: 'SOURCE_CHECK', result: 'PASS' },
      ],
    }),
  );

  await assert.rejects(
    advancePlan(fixture.planPath, {
      'repo-root': fixture.root,
      'source-evidence': evidencePath,
      task: 'task-a',
      to: 'done',
      next: 'task-b',
    }),
    (error) => {
      assert.equal(error.code, 'PLAN_ADVANCE_INVALID');
      assert.match(error.message, /source-class/i);
      return true;
    },
  );
});

test('planctl advance validates the successful Session after acquiring the Plan lock', async (t) => {
  const fixture = await makeFixture(t, {
    mutateTaskSlices(taskSlices, manifest) {
      const source = taskSlices.get('task-a');
      source.completionClass = 'source';
      source.checks = source.checks.filter(
        (check) => check.verificationClass === 'SOURCE_CHECK',
      );
      const proof = taskSlices.get('task-b');
      proof.workstreamId = source.workstreamId;
      manifest.tasks[1].workstreamId = source.workstreamId;
    },
    mutateAcceptance(acceptance) {
      acceptance.closures['closure-task-a'] = [];
    },
  });
  const session = createSessionFixture(fixture);
  let completedInsideLock = false;

  const advanced = await advancePlan(fixture.planPath, {
    'repo-root': fixture.root,
    session: session.path,
    task: 'task-a',
    to: 'done',
    next: 'task-b',
    async failpoint(name) {
      if (name === 'after-plan-lock-acquired') {
        session.complete();
        completedInsideLock = true;
      }
    },
  });

  assert.equal(completedInsideLock, true);
  assert.equal(advanced.manifest.status, 'active');
  assert.equal(advanced.currentTask.taskId, 'task-b');
});

test('planctl recovers an abandoned Plan lock before advancing', async (t) => {
  const fixture = await makeFixture(t);
  const session = createSessionFixture(fixture);
  session.complete();
  const lockPath = `${fixture.planPath}.lock`;
  await fsp.writeFile(
    lockPath,
    `${JSON.stringify(planLockRecord(fixture.planPath))}\n`,
  );

  const advanced = await advancePlan(fixture.planPath, {
    'repo-root': fixture.root,
    session: session.path,
    task: 'task-a',
    to: 'done',
    next: 'task-b',
  });

  assert.equal(advanced.currentTask.taskId, 'task-b');
  await assert.rejects(fsp.stat(lockPath), { code: 'ENOENT' });
  await assert.rejects(fsp.stat(`${lockPath}.recovery`), { code: 'ENOENT' });
});

test('stale Plan lock recovery preserves a replacement live owner', async (t) => {
  const fixture = await makeFixture(t);
  const session = createSessionFixture(fixture);
  session.complete();
  const lockPath = `${fixture.planPath}.lock`;
  const originalPlan = await fsp.readFile(fixture.planPath);
  const stale = planLockRecord(fixture.planPath);
  const liveIdentity = processIdentityForPid(process.pid);
  assert.match(liveIdentity, /^[0-9a-f]{64}$/);
  const live = planLockRecord(fixture.planPath, {
    pid: process.pid,
    processIdentity: liveIdentity,
    ownerToken: 'b'.repeat(64),
  });
  await fsp.writeFile(lockPath, `${JSON.stringify(stale)}\n`);

  await expectPlanError(
    advancePlan(fixture.planPath, {
      'repo-root': fixture.root,
      session: session.path,
      task: 'task-a',
      to: 'done',
      next: 'task-b',
      async failpoint(name) {
        if (name === 'after-stale-plan-lock-observed') {
          await fsp.writeFile(lockPath, `${JSON.stringify(live)}\n`);
        }
      },
    }),
    'PLAN_ADVANCE_LOCKED',
  );

  assert.deepEqual(
    JSON.parse(await fsp.readFile(lockPath, 'utf8')),
    live,
  );
  assert.deepEqual(await fsp.readFile(fixture.planPath), originalPlan);
  await assert.rejects(fsp.stat(`${lockPath}.recovery`), { code: 'ENOENT' });
  await fsp.rm(lockPath);
});

test('planctl advance records typed exhaustion and can reactivate an explicit blocked Task', async (t) => {
  const fixture = await makeFixture(t);
  const blockedSession = blockedSessionFor(fixture);
  const common = [
    '--plan',
    fixture.planPath,
    '--repo-root',
    fixture.root,
    '--session',
    blockedSession,
  ];
  const blocked = parseCliSuccess(
    invokeCli([
      'advance',
      ...common,
      '--task',
      'task-a',
      '--to',
      'blocked',
      '--blocker-code',
      'SOURCE_CHECK_FAILED',
      '--blocker-owner',
      'source',
      '--blocker-evidence-ref',
      'evidence/task-a.json',
      '--recorded-at',
      FIXED_TIME,
      '--exhaustion-decision-ref',
      'DWF-D13',
      '--exhaustion-evidence-ref',
      'evidence/task-a.json',
    ]),
  );
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.currentTaskId, null);

  const reactivated = parseCliSuccess(
    invokeCli([
      'advance',
      '--plan',
      fixture.planPath,
      '--repo-root',
      fixture.root,
      '--to',
      'reactivate',
      '--next',
      'task-a',
    ]),
  );
  assert.equal(reactivated.status, 'active');
  assert.equal(reactivated.currentTaskId, 'task-a');
  const loaded = await loadPlanPackage(fixture.planPath, { repoRoot: fixture.root });
  assert.equal(loaded.manifest.exhaustion, null);
  assert.equal(lifecycleTask(loaded.manifest.tasks, 'task-a').blocker, null);
});

test('planctl invalidate-source reopens the declared owner and resets its closure', async (t) => {
  const fixture = await makeFixture(t, {
    mutateManifest(manifest) {
      manifest.tasks[0].status = 'done';
      manifest.tasks[1].status = 'in_progress';
    },
    planSuffix: `

## Source Invalidation Policy

\`\`\`json
{"kind":"peers-touch-source-invalidation-policy","sourceOwnerTaskId":"task-a","rootTaskIds":["task-b"]}
\`\`\`
`,
  });
  const home = path.join(fixture.root, 'home');
  const invalidated = parseCliSuccess(
    invokeCli([
      'invalidate-source',
      '--plan',
      fixture.planPath,
      '--repo-root',
      fixture.root,
      '--task',
      'task-b',
      '--first-failure-ref',
      'evidence/task-b-source-drift.json',
      '--home',
      home,
    ]),
  );

  assert.equal(invalidated.status, 'active');
  assert.equal(invalidated.currentTaskId, 'task-a');
  assert.equal(invalidated.invalidationProof.proofDigest.length, 64);
  assert.equal(
    fs.existsSync(invalidated.invalidationProof.proofPath),
    true,
  );

  const loaded = await loadPlanPackage(fixture.planPath, {
    repoRoot: fixture.root,
  });
  assert.equal(lifecycleTask(loaded.manifest.tasks, 'task-a').status, 'in_progress');
  assert.equal(lifecycleTask(loaded.manifest.tasks, 'task-b').status, 'pending');
});

function lifecycleTask(tasks, taskId) {
  return tasks.find((task) => task.id === taskId);
}

async function makeMigrationFixture(t, { targetStatus = 'active' } = {}) {
  const fixture = await makeFixture(t, { status: 'prepared' });
  const workspaceId = workspaceIdForRoot(fixture.root);
  const legacyRelative = 'docs/architecture/test/execution-plans/legacy-plan.md';
  const legacyPath = path.join(fixture.root, ...legacyRelative.split('/'));
  const legacyBytes = Buffer.from('# Legacy plan\n\nEvery byte must survive.\n');
  await fsp.writeFile(legacyPath, legacyBytes);
  const liveReferenceRelative = 'docs/architecture/test/live-reference.md';
  const liveReferencePath = path.join(
    fixture.root,
    ...liveReferenceRelative.split('/'),
  );
  await fsp.writeFile(liveReferencePath, `Plan: ${legacyRelative}\n`);

  const preparedPackage = await loadPlanPackage(fixture.planPath, {
    repoRoot: fixture.root,
  });
  const reboundManifest = structuredClone(preparedPackage.manifest);
  reboundManifest.binding.workspaceId = workspaceId;
  await fsp.writeFile(
    fixture.planPath,
    renderPlanDocument(
      await fsp.readFile(fixture.planPath, 'utf8'),
      reboundManifest,
    ),
  );
  const finalManifest = structuredClone(reboundManifest);
  finalManifest.status = targetStatus;
  if (targetStatus === 'active') {
    finalManifest.tasks[0].status = 'in_progress';
  } else if (targetStatus === 'blocked') {
    finalManifest.tasks[0].status = 'blocked';
    finalManifest.tasks[0].blocker = {
      code: 'OWNER_INPUT_REQUIRED',
      owner: 'architecture',
      evidenceRef: 'evidence/task-a.json',
    };
    finalManifest.exhaustion = {
      recordedAt: FIXED_TIME,
      blockedTaskIds: ['task-a'],
      decisionRefs: ['DWF-D13'],
      evidenceRefs: ['evidence/task-a.json'],
    };
  } else {
    throw new Error(`unsupported migration target status: ${targetStatus}`);
  }
  const currentDocument = await fsp.readFile(fixture.planPath, 'utf8');
  const finalDocument = renderPlanDocument(currentDocument, finalManifest);
  const finalRelative = `${fixture.packageRelative}/prepared-final.md`;
  const finalPath = path.join(fixture.root, ...finalRelative.split('/'));
  await fsp.writeFile(finalPath, finalDocument);
  const preparedReferenceRelative =
    `${fixture.packageRelative}/prepared-live-reference.md`;
  await fsp.writeFile(
    path.join(fixture.root, ...preparedReferenceRelative.split('/')),
    `Plan: ${fixture.packageRelative}/plan.md\n`,
  );

  const backupRelative = `${fixture.packageRelative}/migration-backups/plan.backup.md`;
  const referenceBackupRelative =
    `${fixture.packageRelative}/migration-backups/live-reference.backup.md`;
  const crosswalkRelative = `${fixture.packageRelative}/migration-crosswalk.json`;
  const crosswalk = {
    legacyPlan: legacyRelative,
    packagePlan: `${fixture.packageRelative}/plan.md`,
    liveReferences: [
      {
        path: liveReferenceRelative,
        replacement: 'package plan',
      },
    ],
  };
  const crosswalkBytes = Buffer.from(`${JSON.stringify(crosswalk, null, 2)}\n`);
  await fsp.writeFile(
    path.join(fixture.root, ...crosswalkRelative.split('/')),
    crosswalkBytes,
  );
  const machineHome = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'planctl-machine-home-'),
  );
  t.after(() => fsp.rm(machineHome, { recursive: true, force: true }));
  const machineRoot = path.join(machineHome, '.peers-touch', 'dev');
  const { journalPath, lockPath } = getPlanMigrationPaths(
    machineRoot,
    workspaceId,
  );
  const migrationOptions = {
    repoRoot: fixture.root,
    journalPath,
    lockPath,
    legacyPlan: legacyRelative,
    packagePlan: `${fixture.packageRelative}/plan.md`,
    workspaceId,
    migrationId: 'migration-test',
    crosswalkPath: crosswalkRelative,
    crosswalkDigest: sha256(crosswalkBytes),
    sourceIdentity: {
      commit: EXPECTED_HEAD,
      workspaceDigest: SOURCE_WORKSPACE_DIGEST,
      canonicalWorktreeHash: workspaceId,
    },
    activeWorkRegistry: ACTIVE_WORK_REGISTRY_REF,
    async readActiveWorkRegistry() {
      return EMPTY_ACTIVE_WORK_REGISTRY;
    },
    async verifyBinding() {
      return {
        branch: 'merge-desktop-prototype',
        workspaceId,
        head: EXPECTED_HEAD,
      };
    },
    async captureSourceIdentity() {
      return {
        commit: EXPECTED_HEAD,
        workspaceDigest: SOURCE_WORKSPACE_DIGEST,
        canonicalWorktreeHash: workspaceId,
      };
    },
    replacements: [
      {
        path: `${fixture.packageRelative}/plan.md`,
        preparedPath: finalRelative,
        backupPath: backupRelative,
      },
      {
        path: liveReferenceRelative,
        preparedPath: preparedReferenceRelative,
        backupPath: referenceBackupRelative,
      },
    ],
    clock: () => new Date(FIXED_TIME),
    discoveryRoot: 'docs/architecture/test/execution-plans',
    expectedActivePlanCount: 1,
    expectedPackageStatus: targetStatus,
    expectedCurrentTaskId: targetStatus === 'active' ? 'task-a' : null,
  };
  return {
    ...fixture,
    legacyRelative,
    legacyPath,
    legacyBytes,
    liveReferenceRelative,
    liveReferencePath,
    finalRelative,
    backupRelative,
    referenceBackupRelative,
    crosswalkRelative,
    machineHome,
    machineRoot,
    workspaceId,
    journalPath,
    lockPath,
    migrationOptions,
  };
}

async function prepareReviewedMigration(fixture, options = fixture.migrationOptions) {
  const prepared = await preparePlanMigration(options);
  const digest = sha256(await fsp.readFile(fixture.journalPath));
  options.reviewedJournalDigest = digest;
  fixture.migrationOptions.reviewedJournalDigest = digest;
  return prepared;
}

test('migration preserves review lineage while removing the obsolete binding digest', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await preparePlanMigration(fixture.migrationOptions);
  const legacyJournal = JSON.parse(
    await fsp.readFile(fixture.journalPath, 'utf8'),
  );
  legacyJournal.binding.worktreeSetDigest = 'c'.repeat(64);
  const legacyBytes = Buffer.from(`${JSON.stringify(legacyJournal, null, 2)}\n`);
  await fsp.writeFile(fixture.journalPath, legacyBytes);
  fixture.migrationOptions.reviewedJournalDigest = sha256(legacyBytes);

  await commitPlanMigration(fixture.migrationOptions);

  const committed = JSON.parse(await fsp.readFile(fixture.journalPath, 'utf8'));
  assert.equal(Object.hasOwn(committed.binding, 'worktreeSetDigest'), false);
  const reviewed = JSON.parse(
    await fsp.readFile(`${fixture.journalPath}.reviewed`, 'utf8'),
  );
  assert.equal(reviewed.binding.worktreeSetDigest, 'c'.repeat(64));
});

test('migration PREPARED is non-blocking and interrupted commit completes idempotently', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const prepared = await prepareReviewedMigration(fixture);
  assert.equal(prepared.phase, 'PREPARED');
  assert.equal(prepared.legacySha256, sha256(fixture.legacyBytes));
  const archivePath = path.join(fixture.packageDirectory, 'archive/legacy-plan.md');
  assert.deepEqual(await fsp.readFile(archivePath), fixture.legacyBytes);

  const readable = await discoverPlanPackages(
    path.join(fixture.root, 'docs/architecture/test/execution-plans'),
    {
      repoRoot: fixture.root,
      migrationJournalPath: fixture.journalPath,
      migrationLockPath: fixture.lockPath,
    },
  );
  assert.equal(readable.length, 1);
  assert.equal(readable[0].manifest.status, 'prepared');

  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name.startsWith('after-replacement:')) throw new Error('simulated interruption');
      },
    }),
    /simulated interruption/,
  );
  assert.equal(await fsp.stat(fixture.lockPath).then(() => true), true);
  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'APPLYING');
  await expectPlanError(
    discoverPlanPackages(path.join(fixture.root, 'docs/architecture/test/execution-plans'), {
      repoRoot: fixture.root,
      migrationJournalPath: fixture.journalPath,
      migrationLockPath: fixture.lockPath,
    }),
    'PLAN_MIGRATION_IN_PROGRESS',
  );
  await expectPlanError(
    loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
      migrationJournalPath: fixture.journalPath,
      migrationLockPath: fixture.lockPath,
    }),
    'PLAN_MIGRATION_IN_PROGRESS',
  );
  for (const command of ['validate', 'current', 'next', 'status']) {
    const failure = parseCliFailure(
      invokeCli([
        command,
        '--plan',
        fixture.planPath,
        '--repo-root',
        fixture.root,
      ], PLANCTL, { ...process.env, HOME: fixture.machineHome }),
    );
    assert.equal(failure.error.code, 'PLAN_MIGRATION_IN_PROGRESS');
  }

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'complete',
  });
  assert.equal(recovered.phase, 'COMMITTED');
  assert.equal(recovered.activeWorkProjection.disposition, 'assert-absent');
  assert.equal(recovered.activeWorkProjection.before, 'NONE');
  assert.equal(recovered.activeWorkProjection.after, 'NONE');
  assert.equal(recovered.activeWorkProjection.applied, true);
  await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  await assert.rejects(fsp.stat(fixture.legacyPath), { code: 'ENOENT' });
  await assert.rejects(
    fsp.stat(path.join(fixture.root, ...fixture.backupRelative.split('/'))),
    { code: 'ENOENT' },
  );
  const active = await loadPlanPackage(fixture.planPath, { repoRoot: fixture.root });
  assert.equal(active.manifest.status, 'active');
  assert.equal(active.currentTask.taskId, 'task-a');
});

test('recovery completes a replacement interrupted after intent persistence', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  const operationFailpoint =
    `after-file-operation-intent:apply-replacement:${fixture.packageRelative}/plan.md`;

  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name === operationFailpoint) {
          throw new Error('interrupt after replacement intent');
        }
      },
    }),
    /interrupt after replacement intent/,
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'APPLYING');
  assert.equal(interrupted.pendingOperation.purpose, 'apply-replacement');
  assert.equal(interrupted.replacements[0].applied, false);

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'complete',
  });
  assert.equal(recovered.phase, 'COMMITTED');
  assert.equal(recovered.pendingOperation, null);
  assert.equal(recovered.cleanup.state, 'DONE');
});

test('recovery adopts a replacement interrupted after the atomic syscall', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  const operationFailpoint =
    `after-replacement-operation-before-validation:${fixture.packageRelative}/plan.md`;

  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name === operationFailpoint) {
          throw new Error('interrupt after replacement exchange');
        }
      },
    }),
    /interrupt after replacement exchange/,
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'APPLYING');
  assert.equal(interrupted.pendingOperation.purpose, 'apply-replacement');
  assert.equal(
    sha256(await fsp.readFile(fixture.planPath)),
    interrupted.replacements[0].afterSha256,
  );

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'complete',
  });
  assert.equal(recovered.phase, 'COMMITTED');
  assert.equal(recovered.pendingOperation, null);
  assert.equal(recovered.cleanup.state, 'DONE');
});

test('recovery never swaps a mutated post-syscall carrier into the live target', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const beforeBytes = await fsp.readFile(fixture.planPath);
  await prepareReviewedMigration(fixture);
  const operationFailpoint =
    `after-replacement-operation-before-validation:${fixture.packageRelative}/plan.md`;
  const backupPath = path.join(
    fixture.root,
    ...fixture.backupRelative.split('/'),
  );
  const concurrentCarrier = Buffer.concat([
    beforeBytes,
    Buffer.from('\nCONCURRENT_CARRIER_WRITE\n'),
  ]);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === operationFailpoint) {
          await fsp.appendFile(backupPath, '\nCONCURRENT_CARRIER_WRITE\n');
        }
      },
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  let interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'APPLYING');
  assert.equal(interrupted.pendingOperation.purpose, 'apply-replacement');
  assert.equal(interrupted.replacements[0].applied, false);
  assert.equal(
    sha256(await fsp.readFile(fixture.planPath)),
    interrupted.replacements[0].afterSha256,
  );
  assert.deepEqual(await fsp.readFile(backupPath), concurrentCarrier);

  await expectPlanError(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'complete',
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.pendingOperation.purpose, 'apply-replacement');
  assert.equal(
    sha256(await fsp.readFile(fixture.planPath)),
    interrupted.replacements[0].afterSha256,
  );
  assert.deepEqual(await fsp.readFile(backupPath), concurrentCarrier);
});

test('replacement intent rejects a same-byte inode substitution', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  const originalBytes = await fsp.readFile(fixture.planPath);
  const originalIdentity = await fsp.stat(fixture.planPath);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (
          name ===
          `before-replacement-exchange:${fixture.packageRelative}/plan.md`
        ) {
          const substitute = `${fixture.planPath}.same-bytes`;
          await fsp.writeFile(substitute, originalBytes);
          await fsp.rename(substitute, fixture.planPath);
        }
      },
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  const currentIdentity = await fsp.stat(fixture.planPath);
  assert.notEqual(currentIdentity.ino, originalIdentity.ino);
  assert.deepEqual(await fsp.readFile(fixture.planPath), originalBytes);
  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'APPLYING');
  assert.equal(interrupted.replacements[0].applied, false);
});

test('recovery completes legacy removal interrupted after intent persistence', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const prepared = await prepareReviewedMigration(fixture);

  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (
          name ===
          `after-file-operation-intent:remove-legacy:${prepared.legacyBackupPath}`
        ) {
          throw new Error('interrupt after legacy intent');
        }
      },
    }),
    /interrupt after legacy intent/,
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'APPLYING');
  assert.equal(interrupted.pendingOperation.purpose, 'remove-legacy');
  await fsp.access(fixture.legacyPath);

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'complete',
  });
  assert.equal(recovered.phase, 'COMMITTED');
  assert.equal(recovered.pendingOperation, null);
  await assert.rejects(fsp.stat(fixture.legacyPath), { code: 'ENOENT' });
});

test('atomic rename preflight fails before lock and phase mutation', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);

  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async atomicRenamePreflight() {
        throw new Error('atomic rename unsupported');
      },
    }),
    /atomic rename unsupported/,
  );

  const journal = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(journal.phase, 'PREPARED');
  assert.equal(journal.pendingOperation, null);
  assert.equal(journal.cleanup, null);
  await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  await assert.rejects(
    fsp.stat(`${fixture.journalPath}.reviewed`),
    { code: 'ENOENT' },
  );
});

test('public plan commands cannot override the canonical migration locator', async (t) => {
  const fixture = await makeFixture(t);
  const overrideCases = [
    ['--machine-root', path.join(fixture.root, 'other-machine-root')],
    ['--work-item-id', 'other-migration'],
    [
      '--migration-journal',
      path.join(fixture.root, 'other-migration.json'),
      '--migration-lock',
      path.join(fixture.root, 'other-migration.lock'),
    ],
  ];
  for (const command of ['validate', 'current', 'next', 'status', 'advance']) {
    for (const override of overrideCases) {
      const failure = parseCliFailure(
        invokeCli([
          command,
          '--plan',
          fixture.planPath,
          '--repo-root',
          fixture.root,
          ...override,
        ]),
      );
      assert.equal(failure.error.code, 'PLAN_CLI_USAGE');
    }
  }
});

test('library plan readers ignore caller-selected machine homes', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await fsp.mkdir(path.dirname(fixture.lockPath), { recursive: true });
  await fsp.writeFile(
    fixture.lockPath,
    `${JSON.stringify({
      schemaVersion: 1,
      kind: 'peers-touch-plan-migration-lock',
      migrationId: 'redirected-lock',
      workspaceId: WORKSPACE_ID,
      ownerToken: 'a'.repeat(64),
      pid: process.pid,
      startedAt: FIXED_TIME,
    })}\n`,
  );

  const loaded = await loadPlanPackage(fixture.planPath, {
    repoRoot: fixture.root,
    home: fixture.machineHome,
  });
  assert.equal(loaded.manifest.status, 'prepared');
});

test('public plan readers reject an unknown canonical migration phase', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await fsp.mkdir(path.dirname(fixture.journalPath), { recursive: true });
  await fsp.writeFile(
    fixture.journalPath,
    `${JSON.stringify({ phase: 'APPLYNG' })}\n`,
  );
  await expectPlanError(
    loadPlanPackage(fixture.planPath, {
      repoRoot: fixture.root,
      migrationJournalPath: fixture.journalPath,
      migrationLockPath: fixture.lockPath,
    }),
    'PLAN_MIGRATION_JOURNAL_INVALID',
  );
  const failure = parseCliFailure(
    invokeCli(
      [
        'validate',
        '--plan',
        fixture.planPath,
        '--repo-root',
        fixture.root,
      ],
      PLANCTL,
      { ...process.env, HOME: fixture.machineHome },
    ),
  );
  assert.equal(failure.error.code, 'PLAN_MIGRATION_JOURNAL_INVALID');
});

test('migration rejects cross-role replacement path aliasing', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const aliased = structuredClone(fixture.migrationOptions.replacements);
  aliased[1].path = aliased[0].backupPath;

  await expectPlanError(
    preparePlanMigration({
      ...fixture.migrationOptions,
      replacements: aliased,
    }),
    'PLAN_MIGRATION_INVALID',
  );
  await assert.rejects(fsp.stat(fixture.journalPath), { code: 'ENOENT' });

  await prepareReviewedMigration(fixture);
  const journal = JSON.parse(await fsp.readFile(fixture.journalPath, 'utf8'));
  journal.replacements[1].backupPath = journal.replacements[0].path;
  assert.throws(
    () => validatePlanMigrationJournal(journal),
    (error) => error.code === 'PLAN_MIGRATION_JOURNAL_INVALID',
  );
});

test('replacement write rejects drift after capturing the before-image', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const preparedAfterImage = await fsp.readFile(
    path.join(fixture.root, ...fixture.finalRelative.split('/')),
  );
  await prepareReviewedMigration(fixture);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (
          name ===
          `before-replacement-exchange:${fixture.packageRelative}/plan.md`
        ) {
          await fsp.appendFile(fixture.planPath, '\nCONCURRENT_REPLACEMENT_WRITE\n');
        }
      },
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  const journal = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(journal.phase, 'APPLYING');
  assert.equal(journal.replacements[0].applied, false);
  assert.deepEqual(
    await fsp.readFile(
      path.join(fixture.root, ...fixture.backupRelative.split('/')),
    ),
    preparedAfterImage,
  );
  assert.match(await fsp.readFile(fixture.planPath, 'utf8'), /CONCURRENT_REPLACEMENT_WRITE/);
});

test('replacement creation rejects a target that appears before install', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const createdRelative = `${fixture.packageRelative}/created-by-migration.md`;
  const preparedRelative =
    `${fixture.packageRelative}/prepared-created-by-migration.md`;
  const backupRelative =
    `${fixture.packageRelative}/migration-backups/created-by-migration.backup.md`;
  await fsp.writeFile(
    path.join(fixture.root, ...preparedRelative.split('/')),
    'MIGRATION CONTENT\n',
  );
  fixture.migrationOptions.replacements.push({
    path: createdRelative,
    preparedPath: preparedRelative,
    backupPath: backupRelative,
  });
  await prepareReviewedMigration(fixture);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === `after-replacement-before-image:${createdRelative}`) {
          await fsp.writeFile(
            path.join(fixture.root, ...createdRelative.split('/')),
            'CONCURRENT CREATION\n',
          );
        }
      },
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  assert.equal(
    await fsp.readFile(
      path.join(fixture.root, ...createdRelative.split('/')),
      'utf8',
    ),
    'CONCURRENT CREATION\n',
  );
  assert.equal(
    await fsp.readFile(
      path.join(fixture.root, ...backupRelative.split('/')),
      'utf8',
    ),
    'MIGRATION CONTENT\n',
  );
});

test('legacy removal rejects drift after capturing the before-image', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === 'after-legacy-before-image') {
          await fsp.appendFile(fixture.legacyPath, '\nCONCURRENT_LEGACY_WRITE\n');
        }
      },
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  const journal = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(journal.phase, 'APPLYING');
  assert.match(await fsp.readFile(fixture.legacyPath, 'utf8'), /CONCURRENT_LEGACY_WRITE/);
  await assert.rejects(
    fsp.stat(path.join(fixture.root, ...journal.legacyBackupPath.split('/'))),
    { code: 'ENOENT' },
  );
  assert.deepEqual(
    await fsp.readFile(
      path.join(fixture.packageDirectory, 'archive/legacy-plan.md'),
    ),
    fixture.legacyBytes,
  );
});

test('migration recovery can roll back after legacy removal', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const originalPlan = await fsp.readFile(fixture.planPath);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name === 'after-legacy-removal') throw new Error('stop after removal');
      },
    }),
    /stop after removal/,
  );
  await assert.rejects(fsp.stat(fixture.legacyPath), { code: 'ENOENT' });

  const rolledBack = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'rollback',
  });
  assert.equal(rolledBack.phase, 'ROLLED_BACK');
  assert.equal(rolledBack.activeWorkProjection.applied, false);
  assert.deepEqual(await fsp.readFile(fixture.legacyPath), fixture.legacyBytes);
  assert.deepEqual(await fsp.readFile(fixture.planPath), originalPlan);
  const prepared = await loadPlanPackage(fixture.planPath, { repoRoot: fixture.root });
  assert.equal(prepared.manifest.status, 'prepared');
  await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
});

test('rollback recovery adopts an exchange interrupted after the atomic syscall', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const originalPlan = await fsp.readFile(fixture.planPath);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name.startsWith('after-replacement:')) {
          throw new Error('interrupt before rollback operation');
        }
      },
    }),
    /interrupt before rollback operation/,
  );

  await assert.rejects(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'rollback',
      failpoint(name) {
        if (name.startsWith('after-rollback-operation-before-validation:')) {
          throw new Error('interrupt after rollback exchange');
        }
      },
    }),
    /interrupt after rollback exchange/,
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'ROLLING_BACK');
  assert.equal(interrupted.pendingOperation.purpose, 'rollback-replacement');

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'rollback',
  });
  assert.equal(recovered.phase, 'ROLLED_BACK');
  assert.equal(recovered.pendingOperation, null);
  assert.equal(recovered.cleanup.state, 'DONE');
  assert.deepEqual(await fsp.readFile(fixture.planPath), originalPlan);
});

test('rollback rehashes restored targets before deleting backups', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name === 'after-legacy-removal') {
          throw new Error('interrupt before committed-state verification');
        }
      },
    }),
    /interrupt before committed-state verification/,
  );

  await expectPlanError(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'rollback',
      async failpoint(name) {
        if (name === `after-rollback:${fixture.packageRelative}/plan.md`) {
          await fsp.appendFile(fixture.planPath, '\nPOST_ROLLBACK_DRIFT\n');
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'ROLLING_BACK');
  await fsp.access(
    path.join(fixture.root, ...fixture.backupRelative.split('/')),
  );
  await fsp.access(
    path.join(fixture.root, ...fixture.referenceBackupRelative.split('/')),
  );
});

test('rollback compare-and-swap preserves a concurrently changed target', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name.startsWith('after-replacement:')) {
          throw new Error('interrupt before rollback race');
        }
      },
    }),
    /interrupt before rollback race/,
  );

  await expectPlanError(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'rollback',
      async failpoint(name) {
        if (
          name ===
          `before-rollback-exchange:${fixture.packageRelative}/plan.md`
        ) {
          await fsp.appendFile(fixture.planPath, '\nCONCURRENT_ROLLBACK_WRITE\n');
        }
      },
    }),
    'PLAN_CONCURRENT_MODIFICATION',
  );

  assert.match(await fsp.readFile(fixture.planPath, 'utf8'), /CONCURRENT_ROLLBACK_WRITE/);
  await fsp.access(
    path.join(fixture.root, ...fixture.backupRelative.split('/')),
  );
  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'ROLLING_BACK',
  );
});

test('rollback backup cleanup preserves late backup drift', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name.startsWith('after-replacement:')) {
          throw new Error('interrupt before rollback cleanup race');
        }
      },
    }),
    /interrupt before rollback cleanup race/,
  );

  await expectPlanError(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'rollback',
      async failpoint(name) {
        if (
          name ===
          `before-rollback-backup-cleanup:${fixture.packageRelative}/plan.md`
        ) {
          await fsp.appendFile(
            path.join(fixture.root, ...fixture.backupRelative.split('/')),
            '\nCONCURRENT_BACKUP_WRITE\n',
          );
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );

  assert.match(
    await fsp.readFile(
      path.join(fixture.root, ...fixture.backupRelative.split('/')),
      'utf8',
    ),
    /CONCURRENT_BACKUP_WRITE/,
  );
  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'ROLLED_BACK',
  );
});

test('rollback backup cleanup revalidates restored targets', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name.startsWith('after-replacement:')) {
          throw new Error('interrupt before rollback target cleanup race');
        }
      },
    }),
    /interrupt before rollback target cleanup race/,
  );

  await expectPlanError(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'rollback',
      async failpoint(name) {
        if (
          name ===
          `before-rollback-backup-cleanup:${fixture.packageRelative}/plan.md`
        ) {
          await fsp.appendFile(fixture.planPath, '\nLATE_ROLLBACK_TARGET_DRIFT\n');
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );

  assert.match(await fsp.readFile(fixture.planPath, 'utf8'), /LATE_ROLLBACK_TARGET_DRIFT/);
  await fsp.access(
    path.join(fixture.root, ...fixture.backupRelative.split('/')),
  );
  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'ROLLED_BACK',
  );
});

test('archive mutation cannot commit and rollback restores original bytes', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const archivePath = path.join(
    fixture.packageDirectory,
    'archive/legacy-plan.md',
  );
  await prepareReviewedMigration(fixture);
  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === 'after-legacy-removal') {
          await fsp.writeFile(archivePath, 'CORRUPTED ARCHIVE\n');
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );
  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'VERIFYING');
  await fsp.access(
    path.join(fixture.root, ...interrupted.legacyBackupPath.split('/')),
  );
  await assert.rejects(fsp.stat(fixture.legacyPath), { code: 'ENOENT' });

  await expectPlanError(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'auto',
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );
  const rollback = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(rollback.phase, 'ROLLING_BACK');
  assert.deepEqual(await fsp.readFile(fixture.legacyPath), fixture.legacyBytes);
  assert.equal(await fsp.readFile(archivePath, 'utf8'), 'CORRUPTED ARCHIVE\n');
  await fsp.access(fixture.lockPath);
});

test('post-write replacement drift cannot reach COMMITTED or delete backups', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === 'after-legacy-removal') {
          await fsp.appendFile(
            fixture.liveReferencePath,
            '\nPOST_WRITE_DRIFT\n',
          );
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );
  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'VERIFYING');
  await fsp.access(
    path.join(
      fixture.root,
      ...fixture.referenceBackupRelative.split('/'),
    ),
  );
});

test('automatic recovery resumes an interrupted rollback', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const originalPlan = await fsp.readFile(fixture.planPath);
  const originalReference = await fsp.readFile(fixture.liveReferencePath);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name.startsWith('after-replacement:')) {
          throw new Error('interrupt apply before rollback');
        }
      },
    }),
    /interrupt apply before rollback/,
  );
  await assert.rejects(
    recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'rollback',
      failpoint(name) {
        if (name.startsWith('after-rollback:')) {
          throw new Error('interrupt rollback');
        }
      },
    }),
    /interrupt rollback/,
  );
  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'ROLLING_BACK',
  );

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'auto',
  });
  assert.equal(recovered.phase, 'ROLLED_BACK');
  assert.deepEqual(await fsp.readFile(fixture.planPath), originalPlan);
  assert.deepEqual(
    await fsp.readFile(fixture.liveReferencePath),
    originalReference,
  );
  await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
});

test('migration treats one blocked package as one live plan', async (t) => {
  const fixture = await makeMigrationFixture(t, { targetStatus: 'blocked' });
  await prepareReviewedMigration(fixture);
  const committed = await commitPlanMigration(fixture.migrationOptions);
  assert.equal(committed.phase, 'COMMITTED');
  const blocked = await loadPlanPackage(fixture.planPath, {
    repoRoot: fixture.root,
  });
  assert.equal(blocked.manifest.status, 'blocked');
  assert.equal(blocked.currentTask, null);
});

test('migration rejects missing or contradictory active_work projection state', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const missing = { ...fixture.migrationOptions };
  delete missing.readActiveWorkRegistry;
  await expectPlanError(
    preparePlanMigration(missing),
    'PLAN_MIGRATION_ACTIVE_WORK_CONTEXT_REQUIRED',
  );
  await assert.rejects(fsp.stat(fixture.journalPath), { code: 'ENOENT' });

  await expectPlanError(
    preparePlanMigration({
      ...fixture.migrationOptions,
      async readActiveWorkRegistry() {
        return [
          '## active_work',
          '',
          '| id | plan |',
          '|---|---|',
          '| 1 | docs/plan.md |',
          '',
        ].join('\n');
      },
    }),
    'PLAN_MIGRATION_ACTIVE_WORK_CONFLICT',
  );
  await assert.rejects(fsp.stat(fixture.journalPath), { code: 'ENOENT' });

  const prepared = await prepareReviewedMigration(fixture);
  assert.deepEqual(prepared.activeWorkProjection, {
    disposition: 'assert-absent',
    registryRef: ACTIVE_WORK_REGISTRY_REF,
    observedSha256: sha256(Buffer.from('ABSENT\n')),
    before: 'NONE',
    after: 'NONE',
    applied: false,
  });
  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async readActiveWorkRegistry() {
        return [
          '## active_work',
          '',
          '| id | plan |',
          '|---|---|',
          '| 1 | docs/plan.md |',
          '',
        ].join('\n');
      },
    }),
    'PLAN_MIGRATION_ACTIVE_WORK_CONFLICT',
  );
  assert.equal((await readPlanMigrationJournal(fixture.journalPath)).phase, 'PREPARED');
  await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
});

test('migration binds commit to reviewed journal and exact source identity', async (t) => {
  await t.test('reviewed journal digest is mandatory', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    const options = { ...fixture.migrationOptions };
    delete options.reviewedJournalDigest;
    await expectPlanError(
      commitPlanMigration(options),
      'PLAN_MIGRATION_REVIEW_REQUIRED',
    );
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('journal mutation invalidates independent review', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    const journal = JSON.parse(await fsp.readFile(fixture.journalPath, 'utf8'));
    journal.updatedAt = '2026-09-16T00:00:01.000Z';
    await fsp.writeFile(
      fixture.journalPath,
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await expectPlanError(
      commitPlanMigration(fixture.migrationOptions),
      'PLAN_MIGRATION_REVIEW_MISMATCH',
    );
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('journal mutation after lock acquisition fails compare-and-swap', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    let injected = false;
    await expectPlanError(
      commitPlanMigration({
        ...fixture.migrationOptions,
        async beforeJournalAtomicCommit() {
          if (injected) return;
          injected = true;
          await fsp.appendFile(fixture.journalPath, '\n');
        },
      }),
      'PLAN_CONCURRENT_MODIFICATION',
    );
    assert.equal(injected, true);
    assert.deepEqual(await fsp.readFile(fixture.legacyPath), fixture.legacyBytes);
    await assert.rejects(
      fsp.stat(
        path.join(fixture.root, ...fixture.backupRelative.split('/')),
      ),
      { code: 'ENOENT' },
    );
  });

  await t.test('branch or worktree binding drift fails before lock', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await expectPlanError(
      commitPlanMigration({
        ...fixture.migrationOptions,
        async verifyBinding() {
          return {
            branch: 'unexpected-branch',
            workspaceId: WORKSPACE_ID,
            head: EXPECTED_HEAD,
          };
        },
      }),
      'WORKTREE_IDENTITY_MISMATCH',
    );
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('workspace digest drift fails before lock', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await expectPlanError(
      commitPlanMigration({
        ...fixture.migrationOptions,
        async captureSourceIdentity() {
          return {
            commit: EXPECTED_HEAD,
            workspaceDigest: `sha256:${'b'.repeat(64)}`,
            canonicalWorktreeHash: WORKSPACE_ID,
          };
        },
      }),
      'PLAN_MIGRATION_SOURCE_DRIFT',
    );
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });
});

test('migration journals mandatory one-live-package verification', async (t) => {
  for (const option of [
    'discoveryRoot',
    'expectedActivePlanCount',
    'expectedPackageStatus',
    'expectedCurrentTaskId',
  ]) {
    const fixture = await makeMigrationFixture(t);
    const invalid = { ...fixture.migrationOptions };
    delete invalid[option];
    await expectPlanError(
      preparePlanMigration(invalid),
      'PLAN_MIGRATION_INVALID',
    );
    await assert.rejects(fsp.stat(fixture.journalPath), { code: 'ENOENT' });
  }

  const fixture = await makeMigrationFixture(t, { targetStatus: 'blocked' });
  const prepared = await prepareReviewedMigration(fixture);
  assert.deepEqual(prepared.verification, {
    discoveryRoot: 'docs/architecture/test/execution-plans',
    expectedActivePlanCount: 1,
    expectedPackageStatus: 'blocked',
    expectedCurrentTaskId: null,
  });

  const mismatchedCurrent = await makeMigrationFixture(t);
  mismatchedCurrent.migrationOptions.expectedCurrentTaskId = 'different-task';
  await expectPlanError(
    preparePlanMigration(mismatchedCurrent.migrationOptions),
    'PLAN_MIGRATION_INVALID',
  );
  await assert.rejects(
    fsp.stat(mismatchedCurrent.journalPath),
    { code: 'ENOENT' },
  );

  const duplicateDirectory = path.join(
    fixture.root,
    'docs/architecture/test/execution-plans/duplicate',
  );
  await fsp.mkdir(duplicateDirectory, { recursive: true });
  await fsp.cp(
    path.join(fixture.packageDirectory, 'tasks'),
    path.join(duplicateDirectory, 'tasks'),
    { recursive: true },
  );
  await fsp.copyFile(
    path.join(fixture.root, ...fixture.finalRelative.split('/')),
    path.join(duplicateDirectory, 'plan.md'),
  );

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
    }),
    'PLAN_MIGRATION_VERIFY_FAILED',
  );
  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'VERIFYING',
  );
});

test('migration revalidates crosswalk and old-path inventory immediately before lock', async (t) => {
  await t.test('repository-local generated metadata is excluded from live references', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    for (const directory of ['.machine', '.tmp']) {
      await fsp.mkdir(path.join(fixture.root, directory), { recursive: true });
      await fsp.writeFile(
        path.join(fixture.root, directory, 'diagnostic.json'),
        `${JSON.stringify({ legacyPlan: fixture.legacyRelative })}\n`,
      );
    }
    const committed = await commitPlanMigration(fixture.migrationOptions);
    assert.equal(committed.phase, 'COMMITTED');
  });

  await t.test('crosswalk mutation', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await fsp.appendFile(
      path.join(fixture.root, ...fixture.crosswalkRelative.split('/')),
      '\n',
    );
    await expectPlanError(
      commitPlanMigration(fixture.migrationOptions),
      'PLAN_MIGRATION_CROSSWALK_MISMATCH',
    );
    assert.equal((await readPlanMigrationJournal(fixture.journalPath)).phase, 'PREPARED');
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('new old-path reference', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await fsp.writeFile(
      path.join(fixture.root, 'new-live-reference.md'),
      `Unexpected: ${fixture.legacyRelative}\n`,
    );
    await expectPlanError(
      commitPlanMigration(fixture.migrationOptions),
      'PLAN_MIGRATION_REFERENCE_INVENTORY_CHANGED',
    );
    assert.equal((await readPlanMigrationJournal(fixture.journalPath)).phase, 'PREPARED');
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('new old-path reference before recovery', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await assert.rejects(
      commitPlanMigration({
        ...fixture.migrationOptions,
        failpoint(name) {
          if (name.startsWith('after-replacement:')) {
            throw new Error('interrupt before recovery inventory check');
          }
        },
      }),
      /interrupt before recovery inventory check/,
    );
    await fsp.writeFile(
      path.join(fixture.root, 'new-recovery-reference.md'),
      `Unexpected: ${fixture.legacyRelative}\n`,
    );
    await expectPlanError(
      recoverPlanMigration({
        ...fixture.migrationOptions,
        strategy: 'complete',
      }),
      'PLAN_MIGRATION_REFERENCE_INVENTORY_CHANGED',
    );
    assert.equal((await readPlanMigrationJournal(fixture.journalPath)).phase, 'APPLYING');
  });

  await t.test('stale legacy plan fails before any replacement write', async (t) => {
    const fixture = await makeMigrationFixture(t);
    const originalPlan = await fsp.readFile(fixture.planPath);
    await prepareReviewedMigration(fixture);
    await fsp.appendFile(fixture.legacyPath, '\nSTALE_LEGACY\n');
    await expectPlanError(
      commitPlanMigration(fixture.migrationOptions),
      'PLAN_MIGRATION_HASH_MISMATCH',
    );
    const journal = await readPlanMigrationJournal(fixture.journalPath);
    assert.equal(journal.phase, 'PREPARED');
    assert.equal(
      journal.replacements.filter((replacement) => replacement.applied).length,
      0,
    );
    assert.deepEqual(await fsp.readFile(fixture.planPath), originalPlan);
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('unjournaled after-state requires a valid rollback backup', async (t) => {
    const fixture = await makeMigrationFixture(t);
    const originalReference = await fsp.readFile(fixture.liveReferencePath);
    await prepareReviewedMigration(fixture);
    await fsp.copyFile(
      path.join(fixture.root, ...fixture.finalRelative.split('/')),
      fixture.planPath,
    );
    await expectPlanError(
      commitPlanMigration(fixture.migrationOptions),
      'PLAN_MIGRATION_HASH_MISMATCH',
    );
    const journal = await readPlanMigrationJournal(fixture.journalPath);
    assert.equal(journal.phase, 'PREPARED');
    assert.equal(
      journal.replacements.filter((replacement) => replacement.applied).length,
      0,
    );
    assert.deepEqual(
      await fsp.readFile(fixture.liveReferencePath),
      originalReference,
    );
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('late stale replacement target fails before any write', async (t) => {
    const fixture = await makeMigrationFixture(t);
    const originalPlan = await fsp.readFile(fixture.planPath);
    await prepareReviewedMigration(fixture);
    await fsp.appendFile(fixture.liveReferencePath, '\nSTALE_TARGET\n');
    await expectPlanError(
      commitPlanMigration(fixture.migrationOptions),
      'PLAN_MIGRATION_HASH_MISMATCH',
    );
    const journal = await readPlanMigrationJournal(fixture.journalPath);
    assert.equal(journal.phase, 'PREPARED');
    assert.equal(
      journal.replacements.filter((replacement) => replacement.applied).length,
      0,
    );
    assert.deepEqual(await fsp.readFile(fixture.planPath), originalPlan);
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });
});

test('only one recovery owns the migration lock and release checks its token', async (t) => {
  await t.test('opposing recoveries cannot both mutate', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await assert.rejects(
      commitPlanMigration({
        ...fixture.migrationOptions,
        failpoint(name) {
          if (name.startsWith('after-replacement:')) {
            throw new Error('interrupt for concurrent recovery');
          }
        },
      }),
      /interrupt for concurrent recovery/,
    );

    let enterRecovery;
    let resumeRecovery;
    const entered = new Promise((resolve) => {
      enterRecovery = resolve;
    });
    const resume = new Promise((resolve) => {
      resumeRecovery = resolve;
    });
    const first = recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'complete',
      async failpoint(name) {
        if (name === 'after-recovery-lock') {
          enterRecovery();
          await resume;
        }
      },
    });
    await entered;
    try {
      await expectPlanError(
        recoverPlanMigration({
          ...fixture.migrationOptions,
          strategy: 'rollback',
        }),
        'PLAN_MIGRATION_LOCKED',
      );
    } finally {
      resumeRecovery();
    }
    assert.equal((await first).phase, 'COMMITTED');
  });

  await t.test('stale recovery-claim takeover preserves a new live claimant', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await assert.rejects(
      commitPlanMigration({
        ...fixture.migrationOptions,
        failpoint(name) {
          if (name.startsWith('after-replacement:')) {
            throw new Error('interrupt for stale recovery claim');
          }
        },
      }),
      /interrupt for stale recovery claim/,
    );
    const journal = await readPlanMigrationJournal(fixture.journalPath);
    const claimPath = `${fixture.lockPath}.recovery`;
    const staleClaim = {
      migrationId: journal.migrationId,
      workspaceId: journal.workspaceId,
      ownerToken: 'b'.repeat(64),
      pid: 99999999,
      processIdentity: 'e'.repeat(64),
      phase: journal.phase,
    };
    const initProcessIdentity = processIdentityForPid(1);
    assert.notEqual(initProcessIdentity, null);
    const liveClaim = {
      ...staleClaim,
      ownerToken: 'c'.repeat(64),
      pid: 1,
      processIdentity: initProcessIdentity,
    };
    await fsp.writeFile(claimPath, `${JSON.stringify(staleClaim)}\n`);

    await expectPlanError(
      recoverPlanMigration({
        ...fixture.migrationOptions,
        strategy: 'complete',
        async failpoint(name) {
          if (name === 'after-stale-recovery-claim-observed') {
            await fsp.writeFile(claimPath, `${JSON.stringify(liveClaim)}\n`);
          }
        },
      }),
      'PLAN_MIGRATION_LOCKED',
    );
    assert.deepEqual(
      JSON.parse(await fsp.readFile(claimPath, 'utf8')),
      liveClaim,
    );
  });

  await t.test('stale migration-lock takeover preserves a new live owner', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await assert.rejects(
      commitPlanMigration({
        ...fixture.migrationOptions,
        failpoint(name) {
          if (name.startsWith('after-replacement:')) {
            throw new Error('interrupt for stale migration lock');
          }
        },
      }),
      /interrupt for stale migration lock/,
    );
    const staleLock = JSON.parse(await fsp.readFile(fixture.lockPath, 'utf8'));
    const initProcessIdentity = processIdentityForPid(1);
    assert.notEqual(initProcessIdentity, null);
    const liveLock = {
      ...staleLock,
      ownerToken: 'd'.repeat(64),
      pid: 1,
      processIdentity: initProcessIdentity,
    };

    await expectPlanError(
      recoverPlanMigration({
        ...fixture.migrationOptions,
        strategy: 'complete',
        async failpoint(name) {
          if (name === 'after-stale-migration-lock-observed') {
            await fsp.writeFile(fixture.lockPath, `${JSON.stringify(liveLock)}\n`);
          }
        },
      }),
      'PLAN_MIGRATION_LOCKED',
    );
    assert.deepEqual(
      JSON.parse(await fsp.readFile(fixture.lockPath, 'utf8')),
      liveLock,
    );
    await assert.rejects(
      fsp.stat(`${fixture.lockPath}.recovery`),
      { code: 'ENOENT' },
    );
  });

  await t.test('PID reuse with a different process identity does not block recovery', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await assert.rejects(
      commitPlanMigration({
        ...fixture.migrationOptions,
        failpoint(name) {
          if (name.startsWith('after-replacement:')) {
            throw new Error('interrupt before PID reuse recovery');
          }
        },
      }),
      /interrupt before PID reuse recovery/,
    );
    const lock = JSON.parse(await fsp.readFile(fixture.lockPath, 'utf8'));
    lock.pid = 1;
    lock.processIdentity = '0'.repeat(64);
    await fsp.writeFile(fixture.lockPath, `${JSON.stringify(lock)}\n`);

    const recovered = await recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'complete',
    });
    assert.equal(recovered.phase, 'COMMITTED');
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });

  await t.test('release refuses a replaced owner token', async (t) => {
    const fixture = await makeMigrationFixture(t);
    await prepareReviewedMigration(fixture);
    await expectPlanError(
      commitPlanMigration({
        ...fixture.migrationOptions,
        async failpoint(name) {
          if (name === 'before-lock-release') {
            const lock = JSON.parse(await fsp.readFile(fixture.lockPath, 'utf8'));
            lock.ownerToken = 'f'.repeat(64);
            await fsp.writeFile(fixture.lockPath, `${JSON.stringify(lock)}\n`);
          }
        },
      }),
      'PLAN_MIGRATION_LOCK_OWNERSHIP_MISMATCH',
    );
    assert.equal((await readPlanMigrationJournal(fixture.journalPath)).phase, 'COMMITTED');
    await fsp.access(fixture.lockPath);
    const recovered = await recoverPlanMigration({
      ...fixture.migrationOptions,
      strategy: 'complete',
    });
    assert.equal(recovered.phase, 'COMMITTED');
    await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
  });
});

test('recovery of COMMITTED journal removes retained backups', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (name === 'after-commit-journal') {
          throw new Error('interrupt after commit journal');
        }
      },
    }),
    /interrupt after commit journal/,
  );
  assert.equal((await readPlanMigrationJournal(fixture.journalPath)).phase, 'COMMITTED');
  await fsp.access(
    path.join(fixture.root, ...fixture.backupRelative.split('/')),
  );
  await fsp.access(
    path.join(fixture.root, ...fixture.referenceBackupRelative.split('/')),
  );

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'complete',
  });
  assert.equal(recovered.phase, 'COMMITTED');
  for (const backup of [
    fixture.backupRelative,
    fixture.referenceBackupRelative,
  ]) {
    await assert.rejects(
      fsp.stat(path.join(fixture.root, ...backup.split('/'))),
      { code: 'ENOENT' },
    );
  }
});

test('committed cleanup recovers after backup capture but before journal progress', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);

  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      failpoint(name) {
        if (
          name ===
          `after-cleanup-backup-capture-before-journal:commit:${fixture.backupRelative}`
        ) {
          throw new Error('interrupt after cleanup capture');
        }
      },
    }),
    /interrupt after cleanup capture/,
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'COMMITTED');
  assert.equal(interrupted.cleanup.state, 'CAPTURING');
  const firstCapture = interrupted.cleanup.captures[0];
  assert.equal(firstCapture.state, 'pending');
  await assert.rejects(
    fsp.stat(path.join(fixture.root, ...firstCapture.sourcePath.split('/'))),
    { code: 'ENOENT' },
  );
  await fsp.access(
    path.join(fixture.root, ...firstCapture.capturedPath.split('/')),
  );

  const recovered = await recoverPlanMigration({
    ...fixture.migrationOptions,
    strategy: 'complete',
  });
  assert.equal(recovered.phase, 'COMMITTED');
  assert.equal(recovered.cleanup.state, 'DONE');
  await assert.rejects(fsp.stat(fixture.lockPath), { code: 'ENOENT' });
});

test('committed cleanup restores every backup when a target drifts after capture', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === 'after-cleanup-backups-captured:commit') {
          await fsp.appendFile(
            fixture.planPath,
            '\nPOST_CAPTURE_TARGET_DRIFT\n',
          );
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );

  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'COMMITTED');
  assert.equal(interrupted.cleanup, null);
  for (const backup of [
    fixture.backupRelative,
    fixture.referenceBackupRelative,
    interrupted.legacyBackupPath,
  ]) {
    await fsp.access(path.join(fixture.root, ...backup.split('/')));
    await assert.rejects(
      fsp.stat(
        path.join(
          fixture.root,
          ...`${backup}.cleanup-${interrupted.migrationId}`.split('/'),
        ),
      ),
      { code: 'ENOENT' },
    );
  }
  await fsp.access(fixture.lockPath);
});

test('committed backup cleanup preserves late backup drift', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (
          name ===
          `before-commit-backup-cleanup:${fixture.packageRelative}/plan.md`
        ) {
          await fsp.appendFile(
            path.join(fixture.root, ...fixture.backupRelative.split('/')),
            '\nCONCURRENT_BACKUP_WRITE\n',
          );
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );

  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'COMMITTED',
  );
  assert.match(
    await fsp.readFile(
      path.join(fixture.root, ...fixture.backupRelative.split('/')),
      'utf8',
    ),
    /CONCURRENT_BACKUP_WRITE/,
  );
  await fsp.access(fixture.lockPath);
});

test('committed backup cleanup revalidates live targets', async (t) => {
  const fixture = await makeMigrationFixture(t);
  await prepareReviewedMigration(fixture);

  await expectPlanError(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (
          name ===
          `before-commit-backup-cleanup:${fixture.packageRelative}/plan.md`
        ) {
          await fsp.appendFile(fixture.planPath, '\nLATE_COMMITTED_TARGET_DRIFT\n');
        }
      },
    }),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );

  assert.equal(
    (await readPlanMigrationJournal(fixture.journalPath)).phase,
    'COMMITTED',
  );
  assert.match(await fsp.readFile(fixture.planPath, 'utf8'), /LATE_COMMITTED_TARGET_DRIFT/);
  await fsp.access(
    path.join(fixture.root, ...fixture.backupRelative.split('/')),
  );
  await fsp.access(fixture.lockPath);
});

test('commit replay rejects archive corruption after the COMMITTED journal write', async (t) => {
  const fixture = await makeMigrationFixture(t);
  const archivePath = path.join(
    fixture.packageDirectory,
    'archive/legacy-plan.md',
  );
  await prepareReviewedMigration(fixture);
  await assert.rejects(
    commitPlanMigration({
      ...fixture.migrationOptions,
      async failpoint(name) {
        if (name === 'after-commit-journal') {
          await fsp.writeFile(archivePath, 'CORRUPTED AFTER COMMIT\n');
          throw new Error('interrupt after committed archive corruption');
        }
      },
    }),
    /interrupt after committed archive corruption/,
  );
  const interrupted = await readPlanMigrationJournal(fixture.journalPath);
  assert.equal(interrupted.phase, 'COMMITTED');
  await fsp.access(
    path.join(fixture.root, ...interrupted.legacyBackupPath.split('/')),
  );

  await expectPlanError(
    commitPlanMigration(fixture.migrationOptions),
    'PLAN_MIGRATION_HASH_MISMATCH',
  );
  assert.equal(
    await fsp.readFile(archivePath, 'utf8'),
    'CORRUPTED AFTER COMMIT\n',
  );
  await fsp.access(
    path.join(fixture.root, ...interrupted.legacyBackupPath.split('/')),
  );
  await fsp.access(fixture.lockPath);
});

test('planctl migrate emits structured PREPARED JSON without locking discovery', async (t) => {
  const fixture = await makeFixture(t, { status: 'prepared' });
  const workspaceId = workspaceIdForRoot(fixture.root);
  const packageBefore = await loadPlanPackage(fixture.planPath, {
    repoRoot: fixture.root,
  });
  const reboundManifest = structuredClone(packageBefore.manifest);
  reboundManifest.binding.workspaceId = workspaceId;
  await fsp.writeFile(
    fixture.planPath,
    renderPlanDocument(
      await fsp.readFile(fixture.planPath, 'utf8'),
      reboundManifest,
    ),
  );
  const targetManifest = structuredClone(reboundManifest);
  targetManifest.status = 'active';
  targetManifest.tasks[0].status = 'in_progress';
  const preparedTargetRelative = `${fixture.packageRelative}/prepared-cli.md`;
  await fsp.writeFile(
    path.join(fixture.root, ...preparedTargetRelative.split('/')),
    renderPlanDocument(
      await fsp.readFile(fixture.planPath, 'utf8'),
      targetManifest,
    ),
  );
  const legacyRelative = 'docs/architecture/test/execution-plans/legacy-cli.md';
  await fsp.writeFile(path.join(fixture.root, ...legacyRelative.split('/')), '# Legacy CLI\n');
  const machineHome = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'planctl-cli-machine-home-'),
  );
  t.after(() => fsp.rm(machineHome, { recursive: true, force: true }));
  const { journalPath, lockPath } = getPlanMigrationPaths(
    path.join(machineHome, '.peers-touch', 'dev'),
    workspaceId,
  );
  const machineRoot = path.dirname(journalPath);
  await fsp.mkdir(machineRoot, { recursive: true });
  const activeWorkRegistryPath = path.join(machineRoot, 'project-memory.md');
  await fsp.writeFile(activeWorkRegistryPath, EMPTY_ACTIVE_WORK_REGISTRY);
  const crosswalkRelative = `${fixture.packageRelative}/migration-crosswalk.json`;
  const crosswalkBytes = Buffer.from(
    `${JSON.stringify({
      legacyPlan: legacyRelative,
      packagePlan: `${fixture.packageRelative}/plan.md`,
      liveReferences: [],
    })}\n`,
  );
  await fsp.writeFile(
    path.join(fixture.root, ...crosswalkRelative.split('/')),
    crosswalkBytes,
  );
  const result = parseCliSuccess(
    invokeCli([
      'migrate',
      '--action',
      'prepare',
      '--repo-root',
      fixture.root,
      '--legacy-plan',
      legacyRelative,
      '--package',
      `${fixture.packageRelative}/plan.md`,
      '--workspace-id',
      workspaceId,
      '--migration-id',
      'migration-cli',
      '--crosswalk-path',
      crosswalkRelative,
      '--crosswalk-digest',
      sha256(crosswalkBytes),
      '--active-work-registry',
      activeWorkRegistryPath,
      '--source-commit',
      EXPECTED_HEAD,
      '--source-workspace-digest',
      SOURCE_WORKSPACE_DIGEST,
      '--discovery-root',
      'docs/architecture/test/execution-plans',
      '--expected-active-plan-count',
      '1',
      '--expected-package-status',
      'active',
      '--expected-current-task',
      'task-a',
      '--replacement',
      JSON.stringify({
        path: `${fixture.packageRelative}/plan.md`,
        preparedPath: preparedTargetRelative,
        backupPath: `${fixture.packageRelative}/migration-backups/plan-cli.backup.md`,
      }),
    ], PLANCTL, { ...process.env, HOME: machineHome }),
  );
  assert.equal(result.ok, true);
  assert.equal(result.migration.phase, 'PREPARED');
  assert.equal(result.reviewedJournalDigest, sha256(await fsp.readFile(journalPath)));
  await assert.rejects(fsp.stat(lockPath), { code: 'ENOENT' });
});

test('planctl migrate rejects a caller-selected workspace before journal access', async (t) => {
  const fixture = await makeFixture(t, { status: 'prepared' });
  const machineHome = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'planctl-cli-wrong-workspace-home-'),
  );
  t.after(() => fsp.rm(machineHome, { recursive: true, force: true }));
  const actualWorkspaceId = workspaceIdForRoot(fixture.root);
  const wrongWorkspaceId =
    actualWorkspaceId === 'f'.repeat(16) ? 'e'.repeat(16) : 'f'.repeat(16);
  const wrongPaths = getPlanMigrationPaths(
    path.join(machineHome, '.peers-touch', 'dev'),
    wrongWorkspaceId,
  );
  await fsp.mkdir(path.dirname(wrongPaths.journalPath), { recursive: true });
  await fsp.writeFile(wrongPaths.journalPath, '{not-json\n');

  const failure = parseCliFailure(
    invokeCli(
      [
        'migrate',
        '--action',
        'commit',
        '--repo-root',
        fixture.root,
        '--workspace-id',
        wrongWorkspaceId,
        '--active-work-registry',
        path.join(machineHome, 'project-memory.md'),
        '--reviewed-journal-digest',
        'a'.repeat(64),
      ],
      PLANCTL,
      { ...process.env, HOME: machineHome },
    ),
  );
  assert.equal(failure.error.code, 'WORKTREE_IDENTITY_MISMATCH');
  assert.equal(await fsp.readFile(wrongPaths.journalPath, 'utf8'), '{not-json\n');
  await assert.rejects(fsp.stat(wrongPaths.lockPath), { code: 'ENOENT' });
});
