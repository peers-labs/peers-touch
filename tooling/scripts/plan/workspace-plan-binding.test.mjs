import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import {
  WorkspacePlanBindingError,
  bindWorkspacePlan,
  resolveWorkspacePlanBinding,
  workspacePlanBindingPath,
} from './workspace-plan-binding.mjs';

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeRepository(root, branch = 'feat/shared-pr') {
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-b', branch], { cwd: root });
  git(root, 'config', 'user.email', 'plan-binding-test@example.invalid');
  git(root, 'config', 'user.name', 'Plan Binding Test');
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'test: initialize fixture');
}

function planDocument({ branch, head, planId, workspaceId }) {
  const manifest = {
    schemaVersion: 2,
    kind: 'peers-touch-plan-package',
    planId,
    status: 'active',
    binding: {
      branch,
      workspaceId,
      initialHead: head,
    },
    workClass: 'infrastructure',
    architecture: {
      sources: ['README.md'],
      decisions: ['DWF-D18'],
    },
    scope: {
      sourceClaims: [
        {
          pathPrefix: 'README.md',
          mode: 'exclusive-write',
        },
      ],
      nonGoals: ['Product behavior'],
    },
    tasks: [
      {
        id: 'T1',
        workstreamId: 'W1',
        path: 'tasks/T1.md',
        dependsOn: [],
        status: 'in_progress',
        blocker: null,
      },
    ],
    exhaustion: null,
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
  const acceptance = {
    schemaVersion: 1,
    closures: {
      C1: [],
    },
    completion: [],
    full: [],
  };
  return [
    `# ${planId}`,
    '',
    '> **Status**: active',
    `> **Branch**: ${branch}`,
    `> **Workspace ID**: ${workspaceId}`,
    `> **Initial HEAD**: ${head}`,
    '',
    '## Plan Package',
    '',
    '```json',
    JSON.stringify(manifest, null, 2),
    '```',
    '',
    '## Acceptance Execution',
    '',
    '```json',
    JSON.stringify(acceptance, null, 2),
    '```',
    '',
  ].join('\n');
}

function taskDocument(planId) {
  const task = {
    schemaVersion: 1,
    kind: 'peers-touch-task-slice',
    planId,
    taskId: 'T1',
    workstreamId: 'W1',
    title: 'Test immutable binding',
    workClass: 'infrastructure',
    completionClass: 'functional',
    executionMode: 'fix',
    closureId: 'C1',
    journeyId: 'DWF-J18',
    runtimeClass: 'source-only',
    writeSet: ['README.md'],
    readSet: [],
    budgets: {
      focusedCheckSeconds: 10,
      functionalRunSeconds: 10,
      cleanupSeconds: 10,
    },
    checks: [
      {
        id: 'source',
        command: 'true',
        verificationClass: 'STRUCTURAL_CHECK',
      },
      {
        id: 'functional',
        command: 'true',
        verificationClass: 'FUNCTIONAL_CHECK',
      },
    ],
    doneWhen: ['Binding resolves'],
    failureBehavior: ['Fail closed'],
    updatedAt: '2026-09-18T00:00:00.000Z',
    durableEvidence: [],
  };
  return [
    '# Test immutable binding',
    '',
    '## Task Slice',
    '',
    '```json',
    JSON.stringify(task, null, 2),
    '```',
    '',
    '## Current Snapshot',
    '',
    '- State: implementing',
    '',
  ].join('\n');
}

function writePlan(root, planId, directoryName, workspaceId = workspaceIdForRoot(root)) {
  const directory = path.join(
    root,
    'docs',
    'architecture',
    'test',
    'execution-plans',
    directoryName,
  );
  const tasks = path.join(directory, 'tasks');
  mkdirSync(tasks, { recursive: true });
  const plan = path.join(directory, 'plan.md');
  writeFileSync(
    plan,
    planDocument({
      branch: git(root, 'branch', '--show-current'),
      head: git(root, 'rev-parse', 'HEAD'),
      planId,
      workspaceId,
    }),
  );
  writeFileSync(path.join(tasks, 'T1.md'), taskDocument(planId));
  return plan;
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-plan-binding-'));
  const home = path.join(root, 'home');
  const workspaceA = path.join(root, 'workspace-a');
  const workspaceB = path.join(root, 'workspace-b');
  initializeRepository(workspaceA);
  initializeRepository(workspaceB);
  return {
    root,
    home,
    workspaceA,
    workspaceB,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function expectCode(code, operation) {
  return assert.rejects(operation, (error) => {
    assert.ok(error instanceof WorkspacePlanBindingError);
    assert.equal(error.code, code);
    return true;
  });
}

test('binds once and resolves the same Plan idempotently', async () => {
  const scope = fixture();
  try {
    const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
    const first = await bindWorkspacePlan({
      repoRoot: scope.workspaceA,
      home: scope.home,
      plan,
      owner: 'owner@example.invalid',
      now: new Date('2026-09-18T00:00:00.000Z'),
    });
    const second = await bindWorkspacePlan({
      repoRoot: scope.workspaceA,
      home: scope.home,
      plan,
      owner: 'another-owner@example.invalid',
    });
    const resolved = await resolveWorkspacePlanBinding({
      repoRoot: scope.workspaceA,
      home: scope.home,
    });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.boundAt, first.boundAt);
    assert.equal(resolved.planId, 'PLAN-A');
    assert.equal(resolved.planPath, path.relative(scope.workspaceA, plan));
    assert.equal(resolved.planStatus, 'active');
    assert.deepEqual(
      JSON.parse(
        readFileSync(
          workspacePlanBindingPath({
            home: scope.home,
            repoRoot: scope.workspaceA,
          }),
          'utf8',
        ),
      ).planId,
      'PLAN-A',
    );
  } finally {
    scope.close();
  }
});

test('rejects rebind and leaves the original bytes unchanged', async () => {
  const scope = fixture();
  try {
    const firstPlan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
    const secondPlan = writePlan(scope.workspaceA, 'PLAN-B', 'plan-b');
    await bindWorkspacePlan({
      repoRoot: scope.workspaceA,
      home: scope.home,
      plan: firstPlan,
      owner: 'owner@example.invalid',
    });
    const bindingFile = workspacePlanBindingPath({
      home: scope.home,
      repoRoot: scope.workspaceA,
    });
    const before = readFileSync(bindingFile, 'utf8');

    await expectCode('WORKSPACE_PLAN_REBIND_DENIED', () =>
      bindWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan: secondPlan,
        owner: 'owner@example.invalid',
      }),
    );

    assert.equal(readFileSync(bindingFile, 'utf8'), before);
  } finally {
    scope.close();
  }
});

test('rejects a foreign branch before creating an immutable binding', async () => {
  const scope = fixture();
  try {
    const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
    writeFileSync(
      plan,
      readFileSync(plan, 'utf8').replaceAll(
        'feat/shared-pr',
        'feat/foreign-branch',
      ),
    );

    await expectCode('WORKSPACE_PLAN_BINDING_MISMATCH', () =>
      bindWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan,
        owner: 'owner@example.invalid',
      }),
    );
    assert.throws(
      () =>
        readFileSync(
          workspacePlanBindingPath({
            home: scope.home,
            repoRoot: scope.workspaceA,
          }),
          'utf8',
        ),
      { code: 'ENOENT' },
    );
  } finally {
    scope.close();
  }
});

test('two worktrees on one branch resolve only their own bindings', async () => {
  const scope = fixture();
  try {
    const planA = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
    const planB = writePlan(scope.workspaceB, 'PLAN-B', 'plan-b');
    writePlan(
      scope.workspaceA,
      'FOREIGN-PLAN-B',
      'synchronized-foreign-plan',
      workspaceIdForRoot(scope.workspaceB),
    );
    await bindWorkspacePlan({
      repoRoot: scope.workspaceA,
      home: scope.home,
      plan: planA,
      owner: 'owner@example.invalid',
    });
    await bindWorkspacePlan({
      repoRoot: scope.workspaceB,
      home: scope.home,
      plan: planB,
      owner: 'owner@example.invalid',
    });

    const resolvedA = await resolveWorkspacePlanBinding({
      repoRoot: scope.workspaceA,
      home: scope.home,
    });
    const resolvedB = await resolveWorkspacePlanBinding({
      repoRoot: scope.workspaceB,
      home: scope.home,
    });

    assert.equal(resolvedA.planId, 'PLAN-A');
    assert.equal(resolvedB.planId, 'PLAN-B');
  } finally {
    scope.close();
  }
});

test('missing binding and missing bound Plan fail closed', async () => {
  const scope = fixture();
  try {
    await expectCode('WORKSPACE_PLAN_BINDING_REQUIRED', () =>
      resolveWorkspacePlanBinding({
        repoRoot: scope.workspaceA,
        home: scope.home,
      }),
    );

    const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
    await bindWorkspacePlan({
      repoRoot: scope.workspaceA,
      home: scope.home,
      plan,
      owner: 'owner@example.invalid',
    });
    rmSync(path.dirname(plan), { recursive: true, force: true });

    await expectCode('WORKSPACE_BOUND_PLAN_UNAVAILABLE', () =>
      resolveWorkspacePlanBinding({
        repoRoot: scope.workspaceA,
        home: scope.home,
      }),
    );
  } finally {
    scope.close();
  }
});

test('rejects a symlinked binding file', async () => {
  const scope = fixture();
  try {
    const bindingFile = workspacePlanBindingPath({
      home: scope.home,
      repoRoot: scope.workspaceA,
    });
    const external = path.join(scope.root, 'external-binding.json');
    mkdirSync(path.dirname(bindingFile), { recursive: true });
    writeFileSync(external, '{}\n');
    symlinkSync(external, bindingFile);

    await expectCode('WORKSPACE_PLAN_BINDING_INVALID', () =>
      resolveWorkspacePlanBinding({
        repoRoot: scope.workspaceA,
        home: scope.home,
      }),
    );
  } finally {
    scope.close();
  }
});
