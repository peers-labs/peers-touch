import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  developmentWorkLedgerPath,
  machineLeasePath,
  workspaceIdForRoot,
} from '../lib/machine-dev-paths.mjs';
import {
  WorkspacePlanBindingError,
  advanceWorkspacePlan,
  bindWorkspacePlan,
  digestWorkspacePlanBinding,
  resolveWorkspacePlanBinding,
  workspacePlanBindingHistoryPath,
  workspacePlanBindingPath,
} from './workspace-plan-binding.mjs';

const leaseCli = fileURLToPath(
  new URL('../local-dev/machine-dev-lease.py', import.meta.url),
);
const bindingCli = fileURLToPath(
  new URL('./workspace-plan-binding.mjs', import.meta.url),
);

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

function planDocument({
  branch,
  head,
  planId,
  workspaceId,
  status = 'active',
}) {
  const taskStatus = status === 'completed' ? 'done' : 'in_progress';
  const manifest = {
    kind: 'peers-touch-plan-package',
    planId,
    status,
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
        status: taskStatus,
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
    closures: {
      C1: [],
    },
    completion: [],
    full: [],
  };
  return [
    `# ${planId}`,
    '',
    `> **Status**: ${status}`,
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

function writePlan(
  root,
  planId,
  directoryName,
  workspaceId = workspaceIdForRoot(root),
  status = 'active',
) {
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
      status,
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
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50,
      });
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

function planPair(scope) {
  return {
    current: writePlan(
      scope.workspaceA,
      'PLAN-A',
      'plan-a',
      workspaceIdForRoot(scope.workspaceA),
      'completed',
    ),
    next: writePlan(scope.workspaceA, 'PLAN-B', 'plan-b'),
  };
}

async function bindCompletedPlan(scope, now = new Date('2026-09-18T00:00:00.000Z')) {
  const plans = planPair(scope);
  const binding = await bindWorkspacePlan({
    repoRoot: scope.workspaceA,
    home: scope.home,
    plan: plans.current,
    owner: 'owner@example.invalid',
    now,
  });
  return { ...plans, binding };
}

async function writeLiveDeclaration(scope, state = 'ACTIVE') {
  const { LEDGER_KIND, SCHEMA_VERSION, digestDeclaration } = await import(
    '../local-dev/dev-work-schema.mjs'
  );
  const workspaceId = workspaceIdForRoot(scope.workspaceA);
  const timestamp = '2026-09-18T00:00:00.000Z';
  const declaration = {
    declarationId: `work-a-${workspaceId}`,
    workItemId: 'work-a',
    sessionId: 'session-a',
    planPath: null,
    planId: null,
    taskId: null,
    workspaceId,
    branch: git(scope.workspaceA, 'branch', '--show-current'),
    sourceHead: git(scope.workspaceA, 'rev-parse', 'HEAD'),
    owner: 'owner@example.invalid',
    purpose: 'block Plan generation advance',
    journeyId: null,
    state,
    createdAt: timestamp,
    heartbeatAt: timestamp,
    expiresAt: '2099-09-19T00:00:00.000Z',
    sourceClaims: [{ pathPrefix: 'README.md', mode: 'exclusive-write' }],
    runtimeClaims: [],
  };
  declaration.declarationDigest = digestDeclaration(declaration);
  const file = developmentWorkLedgerPath(scope.home);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(
    file,
    `${JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      kind: LEDGER_KIND,
      updatedAt: timestamp,
      declarations: {
        [declaration.declarationId]: declaration,
      },
    })}\n`,
    { mode: 0o600 },
  );
}

async function writeActiveWork(scope, binding) {
  const { updateActiveWorkRecord } = await import(
    '../local-dev/active-work-store.mjs'
  );
  const head = git(scope.workspaceA, 'rev-parse', 'HEAD');
  updateActiveWorkRecord(
    {
      workspaceId: workspaceIdForRoot(scope.workspaceA),
      workItemId: 'work-a',
      planId: binding.planId,
      planPath: binding.planPath,
      planStatus: 'completed',
      currentTaskId: 'T1',
      currentTaskPath: 'tasks/T1.md',
      taskStatus: 'done',
      sessionId: 'session-a',
      journeyId: 'DWF-J18',
      devState: null,
      branch: git(scope.workspaceA, 'branch', '--show-current'),
      initialHead: head,
      expectedHead: head,
    },
    {
      home: scope.home,
      workspaceRoot: scope.workspaceA,
    },
  );
}

async function waitForFile(file, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(existsSync(file), `timed out waiting for ${file}`);
}

async function startWorkspaceLease(scope) {
  const marker = path.join(scope.root, 'lease-ready');
  const leaseFile = machineLeasePath('local.slot', '7', scope.home);
  const child = spawn(
    'python3',
    [
      leaseCli,
      'run',
      '--lease-file',
      leaseFile,
      '--resource-kind',
      'local.slot',
      '--resource-id',
      '7',
      '--workspace-id',
      workspaceIdForRoot(scope.workspaceA),
      '--budget-seconds',
      '30',
      '--validation-command-json',
      JSON.stringify([process.execPath, '-e', 'process.exit(0)']),
      '--',
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready'); setInterval(() => {}, 1000);`,
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  await waitForFile(marker);
  return {
    child,
    stderr: () => stderr,
    close: async () => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
      }
      await new Promise((resolve) => child.once('close', resolve));
    },
  };
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
    assert.equal(first.schemaVersion, 2);
    assert.equal(first.generation, 1);
    assert.match(first.recordDigest, /^[0-9a-f]{64}$/);
    assert.equal(resolved.planId, 'PLAN-A');
    assert.equal(resolved.planPath, path.relative(scope.workspaceA, plan));
    assert.equal(resolved.planStatus, 'active');
    const stored = JSON.parse(
      readFileSync(
        workspacePlanBindingPath({
          home: scope.home,
          repoRoot: scope.workspaceA,
        }),
        'utf8',
      ),
    );
    const history = JSON.parse(
      readFileSync(
        workspacePlanBindingHistoryPath({
          home: scope.home,
          repoRoot: scope.workspaceA,
          generation: 1,
        }),
        'utf8',
      ),
    );
    assert.equal(stored.planId, 'PLAN-A');
    assert.equal(stored.recordDigest, digestWorkspacePlanBinding(stored));
    assert.deepEqual(history, stored);
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
    rmSync(path.dirname(plan), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });

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

test('advances a completed Plan through the CLI and preserves immutable history', async () => {
  const scope = fixture();
  try {
    const { binding, current, next } = await bindCompletedPlan(scope);
    const output = JSON.parse(
      execFileSync(
        process.execPath,
        [
          bindingCli,
          'advance',
          '--repo-root',
          scope.workspaceA,
          '--home',
          scope.home,
          '--plan',
          next,
          '--owner',
          'next-owner@example.invalid',
          '--expected-generation',
          '1',
        ],
        { encoding: 'utf8' },
      ),
    );
    const resolved = await resolveWorkspacePlanBinding({
      repoRoot: scope.workspaceA,
      home: scope.home,
    });
    const firstHistory = JSON.parse(
      readFileSync(
        workspacePlanBindingHistoryPath({
          home: scope.home,
          repoRoot: scope.workspaceA,
          generation: 1,
        }),
        'utf8',
      ),
    );
    const secondHistory = JSON.parse(
      readFileSync(
        workspacePlanBindingHistoryPath({
          home: scope.home,
          repoRoot: scope.workspaceA,
          generation: 2,
        }),
        'utf8',
      ),
    );

    assert.equal(output.ok, true);
    assert.equal(output.binding.previousGeneration, 1);
    assert.equal(output.binding.generation, 2);
    assert.equal(resolved.planId, 'PLAN-B');
    assert.equal(resolved.planStatus, 'active');
    assert.equal(firstHistory.planId, 'PLAN-A');
    assert.equal(firstHistory.planPath, path.relative(scope.workspaceA, current));
    assert.equal(firstHistory.recordDigest, digestWorkspacePlanBinding(firstHistory));
    assert.equal(secondHistory.planId, 'PLAN-B');
    assert.equal(secondHistory.recordDigest, digestWorkspacePlanBinding(secondHistory));
    assert.deepEqual(
      JSON.parse(readFileSync(binding.bindingFile, 'utf8')),
      secondHistory,
    );
  } finally {
    scope.close();
  }
});

test('generation advance publishes no orphan next history and retry repairs pointer-first interruption', async () => {
  const beforePointerScope = fixture();
  try {
    const { binding, next } = await bindCompletedPlan(beforePointerScope);
    await assert.rejects(
      advanceWorkspacePlan({
        repoRoot: beforePointerScope.workspaceA,
        home: beforePointerScope.home,
        plan: next,
        owner: 'next-owner@example.invalid',
        expectedGeneration: 1,
        failpoint(name) {
          if (name === 'before-generation-pointer-publish') {
            throw new Error('interrupt before pointer publish');
          }
        },
      }),
      /interrupt before pointer publish/,
    );
    assert.equal(
      JSON.parse(readFileSync(binding.bindingFile, 'utf8')).generation,
      1,
    );
    assert.equal(
      existsSync(
        workspacePlanBindingHistoryPath({
          home: beforePointerScope.home,
          repoRoot: beforePointerScope.workspaceA,
          generation: 2,
        }),
      ),
      false,
    );
  } finally {
    beforePointerScope.close();
  }

  const afterPointerScope = fixture();
  try {
    const { binding, next } = await bindCompletedPlan(afterPointerScope);
    const nextHistory = workspacePlanBindingHistoryPath({
      home: afterPointerScope.home,
      repoRoot: afterPointerScope.workspaceA,
      generation: 2,
    });
    await assert.rejects(
      advanceWorkspacePlan({
        repoRoot: afterPointerScope.workspaceA,
        home: afterPointerScope.home,
        plan: next,
        owner: 'next-owner@example.invalid',
        expectedGeneration: 1,
        failpoint(name) {
          if (name === 'after-generation-pointer-published') {
            throw new Error('interrupt after pointer publish');
          }
        },
      }),
      /interrupt after pointer publish/,
    );
    assert.equal(
      JSON.parse(readFileSync(binding.bindingFile, 'utf8')).generation,
      2,
    );
    assert.equal(existsSync(nextHistory), false);
    await expectCode('WORKSPACE_PLAN_BINDING_HISTORY_INVALID', () =>
      resolveWorkspacePlanBinding({
        repoRoot: afterPointerScope.workspaceA,
        home: afterPointerScope.home,
      }),
    );

    const recovered = await advanceWorkspacePlan({
      repoRoot: afterPointerScope.workspaceA,
      home: afterPointerScope.home,
      plan: next,
      owner: 'next-owner@example.invalid',
      expectedGeneration: 1,
    });
    assert.equal(recovered.generation, 2);
    assert.equal(recovered.recovered, true);
    assert.equal(existsSync(nextHistory), true);
    assert.equal(
      (await resolveWorkspacePlanBinding({
        repoRoot: afterPointerScope.workspaceA,
        home: afterPointerScope.home,
      })).planId,
      'PLAN-B',
    );
  } finally {
    afterPointerScope.close();
  }
});

test('advance rejects an active current Plan and stale generation CAS', async () => {
  const activeScope = fixture();
  try {
    const current = writePlan(activeScope.workspaceA, 'PLAN-A', 'plan-a');
    const next = writePlan(activeScope.workspaceA, 'PLAN-B', 'plan-b');
    await bindWorkspacePlan({
      repoRoot: activeScope.workspaceA,
      home: activeScope.home,
      plan: current,
      owner: 'owner@example.invalid',
    });
    await expectCode('WORKSPACE_PLAN_ADVANCE_NOT_COMPLETED', () =>
      advanceWorkspacePlan({
        repoRoot: activeScope.workspaceA,
        home: activeScope.home,
        plan: next,
        owner: 'owner@example.invalid',
        expectedGeneration: 1,
      }),
    );
  } finally {
    activeScope.close();
  }

  const casScope = fixture();
  try {
    const { next } = await bindCompletedPlan(casScope);
    await advanceWorkspacePlan({
      repoRoot: casScope.workspaceA,
      home: casScope.home,
      plan: next,
      owner: 'owner@example.invalid',
      expectedGeneration: 1,
    });
    const third = writePlan(casScope.workspaceA, 'PLAN-C', 'plan-c');
    await expectCode('WORKSPACE_PLAN_GENERATION_MISMATCH', () =>
      advanceWorkspacePlan({
        repoRoot: casScope.workspaceA,
        home: casScope.home,
        plan: third,
        owner: 'owner@example.invalid',
        expectedGeneration: 1,
      }),
    );
  } finally {
    casScope.close();
  }
});

test('advance rejects unreleased declaration, active-work, and OS lease resources', async (t) => {
  await t.test('live declaration', async () => {
    const scope = fixture();
    try {
      const { next } = await bindCompletedPlan(scope);
      for (const state of ['DECLARED', 'ACTIVE', 'RELEASING']) {
        await writeLiveDeclaration(scope, state);
        await expectCode('WORKSPACE_PLAN_ADVANCE_RESOURCES_LIVE', () =>
          advanceWorkspacePlan({
            repoRoot: scope.workspaceA,
            home: scope.home,
            plan: next,
            owner: 'owner@example.invalid',
            expectedGeneration: 1,
          }),
        );
      }
    } finally {
      scope.close();
    }
  });

  await t.test('active-work', async () => {
    const scope = fixture();
    try {
      const { binding, next } = await bindCompletedPlan(scope);
      await writeActiveWork(scope, binding);
      await expectCode('WORKSPACE_PLAN_ADVANCE_RESOURCES_LIVE', () =>
        advanceWorkspacePlan({
          repoRoot: scope.workspaceA,
          home: scope.home,
          plan: next,
          owner: 'owner@example.invalid',
          expectedGeneration: 1,
        }),
      );
    } finally {
      scope.close();
    }
  });

  await t.test('OS lease', async () => {
    const scope = fixture();
    let lease;
    try {
      const { next } = await bindCompletedPlan(scope);
      lease = await startWorkspaceLease(scope);
      await expectCode('WORKSPACE_PLAN_ADVANCE_RESOURCES_LIVE', () =>
        advanceWorkspacePlan({
          repoRoot: scope.workspaceA,
          home: scope.home,
          plan: next,
          owner: 'owner@example.invalid',
          expectedGeneration: 1,
        }),
      );
    } finally {
      if (lease) await lease.close();
      scope.close();
    }
  });
});

test('concurrent advance admits exactly one generation switch', async () => {
  const scope = fixture();
  try {
    const { next } = await bindCompletedPlan(scope);
    const results = await Promise.allSettled([
      advanceWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan: next,
        owner: 'owner-a@example.invalid',
        expectedGeneration: 1,
      }),
      advanceWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan: next,
        owner: 'owner-b@example.invalid',
        expectedGeneration: 1,
      }),
    ]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    assert.equal(fulfilled.length, 1);
    assert.equal(fulfilled[0].value.generation, 2);
    assert.equal(rejected.length, 1);
    assert.ok(rejected[0].reason instanceof WorkspacePlanBindingError);
    assert.equal(
      rejected[0].reason.code,
      'WORKSPACE_PLAN_GENERATION_MISMATCH',
    );
  } finally {
    scope.close();
  }
});

test('resolves legacy v1 read-only and migrates it on first advance', async () => {
  const scope = fixture();
  try {
    const { current, next } = planPair(scope);
    const bindingFile = workspacePlanBindingPath({
      home: scope.home,
      repoRoot: scope.workspaceA,
    });
    const legacy = {
      schemaVersion: 1,
      kind: 'peers-touch-workspace-plan-binding',
      workspaceId: workspaceIdForRoot(scope.workspaceA),
      canonicalRoot: realpathSync(scope.workspaceA),
      planId: 'PLAN-A',
      planPath: path.relative(scope.workspaceA, current),
      boundAt: '2026-09-18T00:00:00.000Z',
      boundBy: 'legacy-owner@example.invalid',
    };
    mkdirSync(path.dirname(bindingFile), { recursive: true, mode: 0o700 });
    writeFileSync(bindingFile, `${JSON.stringify(legacy, null, 2)}\n`, {
      mode: 0o600,
    });
    const before = readFileSync(bindingFile, 'utf8');
    const resolved = await resolveWorkspacePlanBinding({
      repoRoot: scope.workspaceA,
      home: scope.home,
    });

    assert.equal(resolved.schemaVersion, 2);
    assert.equal(resolved.generation, 1);
    assert.equal(
      resolved.recordDigest,
      digestWorkspacePlanBinding(
        Object.fromEntries(
          Object.entries(resolved).filter(
            ([key]) => !['bindingFile', 'planStatus', 'branch'].includes(key),
          ),
        ),
      ),
    );
    assert.equal(readFileSync(bindingFile, 'utf8'), before);
    assert.equal(
      existsSync(
        workspacePlanBindingHistoryPath({
          home: scope.home,
          repoRoot: scope.workspaceA,
          generation: 1,
        }),
      ),
      false,
    );

    const advanced = await advanceWorkspacePlan({
      repoRoot: scope.workspaceA,
      home: scope.home,
      plan: next,
      owner: 'next-owner@example.invalid',
      expectedGeneration: 1,
    });
    const migrated = JSON.parse(readFileSync(bindingFile, 'utf8'));
    const firstHistory = JSON.parse(
      readFileSync(
        workspacePlanBindingHistoryPath({
          home: scope.home,
          repoRoot: scope.workspaceA,
          generation: 1,
        }),
        'utf8',
      ),
    );

    assert.equal(advanced.schemaVersion, 2);
    assert.equal(advanced.generation, 2);
    assert.equal(migrated.schemaVersion, 2);
    assert.equal(firstHistory.schemaVersion, 2);
    assert.equal(firstHistory.generation, 1);
    assert.equal(firstHistory.planId, 'PLAN-A');
    assert.equal(firstHistory.recordDigest, digestWorkspacePlanBinding(firstHistory));
  } finally {
    scope.close();
  }
});

test('binding and history tampering fail closed', async (t) => {
  await t.test('owner-only mode', async () => {
    const scope = fixture();
    try {
      const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
      const binding = await bindWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan,
        owner: 'owner@example.invalid',
      });
      chmodSync(binding.bindingFile, 0o644);
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

  await t.test('closed schema and digest', async () => {
    const scope = fixture();
    try {
      const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
      const binding = await bindWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan,
        owner: 'owner@example.invalid',
      });
      const record = JSON.parse(readFileSync(binding.bindingFile, 'utf8'));
      record.unexpected = true;
      writeFileSync(binding.bindingFile, `${JSON.stringify(record)}\n`, {
        mode: 0o600,
      });
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

  await t.test('history digest', async () => {
    const scope = fixture();
    try {
      const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
      await bindWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan,
        owner: 'owner@example.invalid',
      });
      const history = workspacePlanBindingHistoryPath({
        home: scope.home,
        repoRoot: scope.workspaceA,
        generation: 1,
      });
      const record = JSON.parse(readFileSync(history, 'utf8'));
      record.boundBy = 'tampered@example.invalid';
      writeFileSync(history, `${JSON.stringify(record)}\n`, { mode: 0o600 });
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

  await t.test('symlinked history', async () => {
    const scope = fixture();
    try {
      const plan = writePlan(scope.workspaceA, 'PLAN-A', 'plan-a');
      await bindWorkspacePlan({
        repoRoot: scope.workspaceA,
        home: scope.home,
        plan,
        owner: 'owner@example.invalid',
      });
      const history = workspacePlanBindingHistoryPath({
        home: scope.home,
        repoRoot: scope.workspaceA,
        generation: 1,
      });
      const external = path.join(scope.root, 'external-history.json');
      writeFileSync(external, readFileSync(history));
      rmSync(history);
      symlinkSync(external, history);
      await expectCode('WORKSPACE_PLAN_BINDING_HISTORY_INVALID', () =>
        resolveWorkspacePlanBinding({
          repoRoot: scope.workspaceA,
          home: scope.home,
        }),
      );
    } finally {
      scope.close();
    }
  });
});
