import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  COMPLETION_REVIEW_CHECK_IDS,
  CompletionReviewError,
  completionReviewPaths,
  completionReviewState,
  inspectForbiddenPathInventory,
  prepareCompletionReview,
  readCompletionReview,
  requireCurrentCompletionReview,
  resolveCompletionReviewBinding,
  runCompletionReviewCli,
  runCompletionReviewSelfTest,
  submitCompletionReview,
} from './completion-review.mjs';
import { workspaceIdForRoot } from '../lib/machine-dev-paths.mjs';
import { DevSessionError } from './dev-session-schema.mjs';
import { inspectGitWorkspace } from './git-workspace.mjs';
import { bindConversation } from './workflow-conversation-binding.mjs';

const FIXED_TIME = '2026-09-26T00:00:00.000Z';
const EXECUTOR_DIGEST = 'a'.repeat(64);
const REVIEWER_DIGEST = 'b'.repeat(64);

function taskEntry(id, status, dependsOn = []) {
  return {
    id,
    workstreamId: `workstream-${id}`,
    path: `tasks/${id}.md`,
    dependsOn,
    status,
    blocker: null,
  };
}

function taskSlice(id) {
  return {
    kind: 'peers-touch-task-slice',
    planId: 'DWF-REVIEW-TEST',
    taskId: id,
    workstreamId: `workstream-${id}`,
    title: `Task ${id}`,
    workClass: 'infrastructure',
    completionClass: 'functional',
    executionMode: 'fix',
    closureId: `closure-${id}`,
    journeyId: `journey-${id}`,
    runtimeClass: 'source-only',
    writeSet: ['tooling/scripts/local-dev'],
    readSet: ['docs/architecture/development-workflow'],
    budgets: {
      focusedCheckSeconds: 30,
      functionalRunSeconds: 60,
      cleanupSeconds: 10,
    },
    checks: [
      {
        id: `source-${id}`,
        command: 'node --check example.mjs',
        verificationClass: 'SOURCE_CHECK',
      },
      {
        id: `functional-${id}`,
        command: 'node --test example.test.mjs',
        verificationClass: 'FUNCTIONAL_CHECK',
      },
    ],
    doneWhen: ['The completion boundary is real'],
    failureBehavior: ['Fail closed'],
    updatedAt: FIXED_TIME,
    durableEvidence: [],
  };
}

function assessment(openFindingId = null) {
  return {
    schemaVersion: 1,
    kind: 'peers-touch-completion-review-assessment',
    findings: COMPLETION_REVIEW_CHECK_IDS.map((id) => ({
      id,
      blocking: true,
      status: id === openFindingId ? 'OPEN' : 'RESOLVED',
      evidenceRefs: [`test://${id}`],
    })),
  };
}

async function makeFixture(t, { finalTask = false } = {}) {
  const root = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'completion-review-test-')),
  );
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const machineRoot = path.join(root, 'machine');
  const planPath = path.join(root, 'plan.md');
  const workspaceId = workspaceIdForRoot(root);

  const tasks = finalTask
    ? [
        taskEntry('task-a', 'done'),
        taskEntry('task-b', 'in_progress', ['task-a']),
      ]
    : [
        taskEntry('task-a', 'in_progress'),
        taskEntry('task-b', 'pending', ['task-a']),
      ];
  const slices = new Map(tasks.map((entry) => [entry.id, taskSlice(entry.id)]));
  const current = tasks.find((entry) => entry.status === 'in_progress');
  const planPackage = {
    repoRoot: root,
    path: planPath,
    manifest: {
      kind: 'peers-touch-plan-package',
      planId: 'DWF-REVIEW-TEST',
      status: 'active',
      binding: {
        branch: 'feat/review-test',
        workspaceId,
        initialHead: '1'.repeat(40),
      },
      workClass: 'infrastructure',
      architecture: {
        sources: ['docs/architecture/development-workflow/design.md'],
        decisions: ['DWF-D28'],
      },
      scope: {
        sourceClaims: [
          {
            pathPrefix: 'tooling/scripts/local-dev',
            mode: 'exclusive-write',
          },
        ],
        nonGoals: ['business injection'],
      },
      tasks,
      exhaustion: null,
      authorization: {
        checkpoint: { localCommit: 'denied', amend: 'denied' },
        delivery: { push: 'denied', pullRequest: 'denied' },
        runtime: { deployProfiles: [], destructiveResetScopes: [] },
        history: { rewrite: 'denied' },
      },
    },
    taskSlices: slices,
    currentTask: slices.get(current.id),
    acceptance: {
      closures: Object.fromEntries(
        tasks.map((entry) => [`closure-${entry.id}`, []]),
      ),
      completion: [],
      full: [],
    },
  };
  await fsp.writeFile(
    planPath,
    [
      '# Review candidate',
      '',
      '> **Status**: active',
      '> **Branch**: feat/review-test',
      `> **Workspace ID**: ${workspaceId}`,
      `> **Initial HEAD**: ${'1'.repeat(40)}`,
      '',
      '## Plan Package',
      '',
      '```json',
      JSON.stringify(planPackage.manifest, null, 2),
      '```',
      '',
      '## Acceptance Execution',
      '',
      '```json',
      JSON.stringify(planPackage.acceptance, null, 2),
      '```',
      '',
    ].join('\n'),
  );
  const session = {
    schemaVersion: 1,
    kind: 'peers-touch-development-session',
    state: {
      sessionId: `session-${current.id}`,
      workItemId: 'DWF-REVIEW-WORK',
      planId: planPackage.manifest.planId,
      taskId: current.id,
      workspaceId,
      branch: planPackage.manifest.binding.branch,
      journeyId: `journey-${current.id}`,
      executionMode: 'fix',
      state: 'DELIVERY_READY',
      source: null,
      runtimeBindingRef: null,
      currentFailure: null,
      lastVerification: null,
      startedAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    },
    eventCount: 8,
    eventDigest: '2'.repeat(64),
  };
  const source = {
    workspaceId,
    branch: planPackage.manifest.binding.branch,
    commit: '3'.repeat(40),
    tree: '4'.repeat(40),
    clean: false,
    stable: true,
    workspaceDigest: `sha256:${'5'.repeat(64)}`,
  };
  let activeBinding = {
    digest: EXECUTOR_DIGEST,
    executionRoot: root,
    workspaceId,
  };
  const dependencies = {
    machineRoot,
    workspaceId,
    reviewId: 'review-fixed',
    clock: () => new Date(FIXED_TIME),
    async loadPlanContext() {
      return planPackage;
    },
    async loadSession() {
      return session;
    },
    inspectWorkspace() {
      return source;
    },
    resolveConversationBinding({ excludedDigests }) {
      assert.equal(excludedDigests.includes(activeBinding.digest), false);
      return activeBinding;
    },
  };
  return {
    root,
    machineRoot,
    workspaceId,
    planPackage,
    session,
    source,
    dependencies,
    useExecutor() {
      activeBinding = {
        digest: EXECUTOR_DIGEST,
        executionRoot: root,
        workspaceId,
      };
    },
    useReviewer() {
      activeBinding = {
        digest: REVIEWER_DIGEST,
        executionRoot: root,
        workspaceId,
      };
    },
  };
}

async function expectReviewError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CompletionReviewError);
    assert.equal(error.code, code);
    return true;
  });
}

test('stores immutable task request and independent PASS receipt', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
      scope: 'task',
    },
    fixture.dependencies,
  );
  assert.equal(prepared.request.taskId, 'task-a');
  assert.deepEqual(prepared.request.executorContextDigests, [EXECUTOR_DIGEST]);

  fixture.useReviewer();
  const submitted = await submitCompletionReview(
    {
      repoRoot: fixture.root,
      reviewId: prepared.request.reviewId,
      verdict: 'PASS',
    },
    {
      ...fixture.dependencies,
      assessment: assessment(),
      clock: () => new Date('2026-09-26T00:00:01.000Z'),
    },
  );
  assert.equal(submitted.receipt.verdict, 'PASS');
  assert.equal(submitted.receipt.reviewerContextDigest, REVIEWER_DIGEST);

  const current = await requireCurrentCompletionReview(
    {
      repoRoot: fixture.root,
      planPackage: fixture.planPackage,
      session: fixture.session,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  assert.equal(current.state, 'PASS');

  const before = await fsp.readFile(submitted.paths.receipt);
  await expectReviewError(
    submitCompletionReview(
      {
        repoRoot: fixture.root,
        reviewId: prepared.request.reviewId,
        verdict: 'FAIL',
      },
      {
        ...fixture.dependencies,
        assessment: assessment('forbidden-reference-inventory'),
      },
    ),
    'COMPLETION_REVIEW_IMMUTABLE',
  );
  assert.deepEqual(await fsp.readFile(submitted.paths.receipt), before);
});

test('rejects self-review and caller-supplied reviewer identity', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  fixture.dependencies.resolveConversationBinding = () => ({
    digest: EXECUTOR_DIGEST,
    executionRoot: fixture.root,
    workspaceId: fixture.workspaceId,
  });
  await expectReviewError(
    submitCompletionReview(
      {
        repoRoot: fixture.root,
        reviewId: prepared.request.reviewId,
        verdict: 'PASS',
      },
      {
        ...fixture.dependencies,
        assessment: assessment(),
      },
    ),
    'COMPLETION_REVIEW_SELF_REVIEW',
  );

  await expectReviewError(
    runCompletionReviewCli([
      'submit',
      '--repo-root',
      fixture.root,
      '--review',
      prepared.request.reviewId,
      '--verdict',
      'PASS',
      '--assessment',
      path.join(fixture.root, 'assessment.json'),
      '--reviewer-context',
      REVIEWER_DIGEST,
    ]),
    'COMPLETION_REVIEW_USAGE',
  );
});

test('default binding resolver selects the independent active conversation', async (t) => {
  const fixture = await makeFixture(t);
  const executor = bindConversation(
    'trae',
    'executor-default-path',
    fixture.root,
    {
      machineRoot: fixture.machineRoot,
      now: new Date(FIXED_TIME),
    },
  ).binding;
  const dependencies = { ...fixture.dependencies };
  delete dependencies.resolveConversationBinding;
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    dependencies,
  );
  assert.deepEqual(prepared.request.executorContextDigests, [executor.digest]);

  const reviewer = bindConversation(
    'trae',
    'reviewer-default-path',
    fixture.root,
    {
      machineRoot: fixture.machineRoot,
      now: new Date('2026-09-26T00:00:01.000Z'),
    },
  ).binding;
  const submitted = await submitCompletionReview(
    {
      repoRoot: fixture.root,
      reviewId: prepared.request.reviewId,
      verdict: 'PASS',
    },
    {
      ...dependencies,
      assessment: assessment(),
    },
  );
  assert.equal(submitted.receipt.reviewerContextDigest, reviewer.digest);
});

test('mandatory findings cannot be downgraded to non-blocking', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  fixture.useReviewer();
  const weakened = assessment('forbidden-reference-inventory');
  weakened.findings.find(
    (finding) => finding.id === 'forbidden-reference-inventory',
  ).blocking = false;
  await expectReviewError(
    submitCompletionReview(
      {
        repoRoot: fixture.root,
        reviewId: prepared.request.reviewId,
        verdict: 'PASS',
      },
      {
        ...fixture.dependencies,
        assessment: weakened,
      },
    ),
    'COMPLETION_REVIEW_INCOMPLETE',
  );
});

test('concurrent equivalent receipt submissions converge on one immutable winner', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  fixture.useReviewer();
  let tick = 0;
  const dependencies = {
    ...fixture.dependencies,
    assessment: assessment(),
    clock: () =>
      new Date(Date.parse(FIXED_TIME) + ++tick * 1_000),
  };
  const submissions = await Promise.all([
    submitCompletionReview(
      {
        repoRoot: fixture.root,
        reviewId: prepared.request.reviewId,
        verdict: 'PASS',
      },
      dependencies,
    ),
    submitCompletionReview(
      {
        repoRoot: fixture.root,
        reviewId: prepared.request.reviewId,
        verdict: 'PASS',
      },
      dependencies,
    ),
  ]);
  assert.equal(
    submissions.filter((submission) => submission.created).length,
    1,
  );
  assert.equal(
    submissions[0].receipt.receiptDigest,
    submissions[1].receipt.receiptDigest,
  );
});

test('source, obligation, candidate, and evidence drift make PASS stale', async (t) => {
  for (const drift of ['source', 'obligations', 'candidate', 'evidence']) {
    await t.test(drift, async (t) => {
      const fixture = await makeFixture(t);
      const prepared = await prepareCompletionReview(
        {
          repoRoot: fixture.root,
          workItemId: 'DWF-REVIEW-WORK',
        },
        fixture.dependencies,
      );
      fixture.useReviewer();
      const submitted = await submitCompletionReview(
        {
          repoRoot: fixture.root,
          reviewId: prepared.request.reviewId,
          verdict: 'PASS',
        },
        {
          ...fixture.dependencies,
          assessment: assessment(),
        },
      );

      if (drift === 'source') {
        fixture.source.workspaceDigest = `sha256:${'6'.repeat(64)}`;
      } else if (drift === 'obligations') {
        fixture.planPackage.taskSlices
          .get('task-a')
          .doneWhen.push('A new obligation');
      } else if (drift === 'candidate') {
        await fsp.appendFile(fixture.planPackage.path, '\nchanged\n');
      } else {
        fixture.session.eventDigest = '7'.repeat(64);
      }

      const material = {
        source: {
          branch: fixture.source.branch,
          commit: fixture.source.commit,
          tree: fixture.source.tree,
          workspaceDigest: fixture.source.workspaceDigest,
        },
        obligationsDigest: prepared.request.obligationsDigest,
        candidatePlanDigest: prepared.request.candidatePlanDigest,
        evidenceDigest: prepared.request.evidenceDigest,
      };
      if (drift === 'obligations') {
        material.obligationsDigest = '8'.repeat(64);
      }
      if (drift === 'candidate') {
        material.candidatePlanDigest = '9'.repeat(64);
      }
      if (drift === 'evidence') material.evidenceDigest = '0'.repeat(64);
      assert.equal(completionReviewState(submitted, material), 'STALE');
      await expectReviewError(
        requireCurrentCompletionReview(
          {
            repoRoot: fixture.root,
            planPackage: fixture.planPackage,
            session: fixture.session,
            workItemId: 'DWF-REVIEW-WORK',
          },
          fixture.dependencies,
        ),
        'COMPLETION_REVIEW_REQUIRED',
      );
    });
  }
});

test('a pending request becomes STALE when its source drifts', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  const record = await readCompletionReview(
    fixture.workspaceId,
    prepared.request.reviewId,
    fixture.dependencies,
  );
  assert.equal(record.receipt, null);
  assert.equal(
    completionReviewState(record, {
      source: {
        ...prepared.request.source,
        workspaceDigest: `sha256:${'6'.repeat(64)}`,
      },
      obligationsDigest: prepared.request.obligationsDigest,
      candidatePlanDigest: prepared.request.candidatePlanDigest,
      evidenceDigest: prepared.request.evidenceDigest,
    }),
    'STALE',
  );
});

test('status prefers the latest pending request over older stale history', async (t) => {
  const fixture = await makeFixture(t);
  await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    {
      ...fixture.dependencies,
      reviewId: 'review-old',
      clock: () => new Date('2026-09-26T00:00:00.000Z'),
    },
  );
  fixture.source.workspaceDigest = `sha256:${'6'.repeat(64)}`;
  await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    {
      ...fixture.dependencies,
      reviewId: 'review-new',
      clock: () => new Date('2026-09-26T00:00:01.000Z'),
    },
  );
  const result = await runCompletionReviewCli(
    [
      'status',
      '--repo-root',
      fixture.root,
      '--work-item',
      'DWF-REVIEW-WORK',
    ],
    fixture.dependencies,
  );
  assert.equal(result.state, 'PENDING');
  assert.deepEqual(
    result.reviews.map((review) => [review.reviewId, review.state]),
    [
      ['review-new', 'PENDING'],
      ['review-old', 'STALE'],
    ],
  );
});

test('Social legacy omission fixture produces FAIL and cannot close work', async (t) => {
  const fixture = await makeFixture(t);
  const regression = JSON.parse(
    await fsp.readFile(
      new URL(
        './fixtures/completion-review-social.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  fixture.useReviewer();
  const socialAssessment = assessment(regression.expectedFindingId);
  for (const relative of regression.omittedLegacyPaths) {
    const target = path.join(fixture.root, ...relative.split('/'));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.writeFile(target, 'legacy\n');
  }
  const forbidden = await inspectForbiddenPathInventory(
    fixture.root,
    regression.omittedLegacyPaths,
  );
  socialAssessment.findings = socialAssessment.findings.map((finding) =>
    finding.id === forbidden.id ? forbidden : finding);
  const submitted = await submitCompletionReview(
    {
      repoRoot: fixture.root,
      reviewId: prepared.request.reviewId,
      verdict: regression.expectedVerdict,
    },
    {
      ...fixture.dependencies,
      assessment: socialAssessment,
    },
  );
  assert.equal(submitted.receipt.verdict, 'FAIL');
  assert.equal(
    completionReviewState(submitted, {
      source: {
        ...submitted.request.source,
        workspaceDigest: `sha256:${'f'.repeat(64)}`,
      },
      obligationsDigest: submitted.request.obligationsDigest,
      candidatePlanDigest: submitted.request.candidatePlanDigest,
      evidenceDigest: submitted.request.evidenceDigest,
    }),
    'STALE',
  );
  await expectReviewError(
    requireCurrentCompletionReview(
      {
        repoRoot: fixture.root,
        planPackage: fixture.planPackage,
        session: fixture.session,
        workItemId: 'DWF-REVIEW-WORK',
      },
      fixture.dependencies,
    ),
    'COMPLETION_REVIEW_REQUIRED',
  );
});

test('final Task requires a Plan-scoped review while owner action stays Task-bound', async (t) => {
  const fixture = await makeFixture(t, { finalTask: true });
  let ownerContext = null;
  const priorExecutor = 'c'.repeat(64);
  fixture.dependencies.resolveConversationBinding = ({ context }) => {
    ownerContext = context;
    return {
      digest: EXECUTOR_DIGEST,
      executionRoot: fixture.root,
      workspaceId: fixture.workspaceId,
    };
  };
  fixture.dependencies.planImplementationContexts = () => ({
    implementationSessionIds: ['session-task-a'],
    executorContextDigests: [priorExecutor],
  });
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
      scope: 'plan',
    },
    fixture.dependencies,
  );
  assert.equal(prepared.request.scope, 'plan');
  assert.equal(prepared.request.taskId, null);
  assert.deepEqual(prepared.request.implementationSessionIds, [
    'session-task-a',
    fixture.session.state.sessionId,
  ].sort());
  assert.deepEqual(prepared.request.executorContextDigests, [
    priorExecutor,
    EXECUTOR_DIGEST,
  ].sort());
  assert.equal(ownerContext.taskId, 'task-b');
});

test('status projects STALE when current review material is unavailable', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  fixture.useReviewer();
  await submitCompletionReview(
    {
      repoRoot: fixture.root,
      reviewId: prepared.request.reviewId,
      verdict: 'PASS',
    },
    {
      ...fixture.dependencies,
      assessment: assessment(),
    },
  );
  const result = await runCompletionReviewCli(
    [
      'status',
      '--repo-root',
      fixture.root,
      '--work-item',
      'DWF-REVIEW-WORK',
    ],
    {
      ...fixture.dependencies,
      async loadSession() {
        throw new DevSessionError(
          'SESSION_UNAVAILABLE',
          'session unavailable',
        );
      },
    },
  );
  assert.equal(result.state, 'STALE');
  assert.equal(result.materialError.code, 'SESSION_UNAVAILABLE');
});

test('review store rejects symlinked receipt paths', async (t) => {
  const fixture = await makeFixture(t);
  const prepared = await prepareCompletionReview(
    {
      repoRoot: fixture.root,
      workItemId: 'DWF-REVIEW-WORK',
    },
    fixture.dependencies,
  );
  const paths = completionReviewPaths(
    fixture.workspaceId,
    prepared.request.reviewId,
    fixture.dependencies,
  );
  const outside = path.join(fixture.root, 'outside.json');
  await fsp.writeFile(outside, '{}\n');
  await fsp.symlink(outside, paths.receipt);
  await expectReviewError(
    readCompletionReview(
      fixture.workspaceId,
      prepared.request.reviewId,
      fixture.dependencies,
    ),
    'COMPLETION_REVIEW_STORE_INVALID',
  );
});

test('self-test covers independent identity and Social omission', async () => {
  assert.deepEqual(await runCompletionReviewSelfTest(), {
    ok: true,
    checks: {
      requestDigest: 'PASS',
      independentReviewer: 'PASS',
      socialLegacyOmission: 'PASS',
      mandatoryChecklist: 'PASS',
    },
  });
});

test('source digest excludes the Plan lifecycle file but includes implementation drift', async (t) => {
  const root = await fsp.realpath(
    await fsp.mkdtemp(path.join(os.tmpdir(), 'completion-review-git-')),
  );
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init');
  git('config', 'user.name', 'Completion Review Test');
  git('config', 'user.email', 'completion-review@test.invalid');
  await fsp.mkdir(path.join(root, 'docs'), { recursive: true });
  await fsp.mkdir(path.join(root, 'src'), { recursive: true });
  await fsp.writeFile(path.join(root, 'docs/plan.md'), 'pending\n');
  await fsp.writeFile(
    path.join(root, 'src/feature.mjs'),
    'export const value = 1;\n',
  );
  git('add', '.');
  git('commit', '-m', 'test: baseline');

  await fsp.writeFile(path.join(root, 'docs/plan.md'), 'done\n');
  await fsp.writeFile(path.join(root, 'docs/plan.md.lock'), 'transient\n');
  assert.equal(inspectGitWorkspace(root).clean, false);
  assert.equal(
    inspectGitWorkspace(root, {
      excludePaths: ['docs/plan.md'],
      excludeGlobs: ['docs/plan.md.lock*'],
    }).clean,
    true,
  );

  await fsp.writeFile(
    path.join(root, 'src/feature.mjs'),
    'export const value = 2;\n',
  );
  const changed = inspectGitWorkspace(root, {
    excludePaths: ['docs/plan.md'],
    excludeGlobs: ['docs/plan.md.lock*'],
  });
  assert.equal(changed.clean, false);
  assert.match(changed.workspaceDigest, /^sha256:[0-9a-f]{64}$/);
});

test('owner action receipts disambiguate executor and reviewer bindings', () => {
  const executor = {
    executionRoot: '/workspace',
    workspaceId: '0123456789abcdef',
    digest: '1'.repeat(64),
  };
  const reviewer = {
    executionRoot: '/workspace',
    workspaceId: '0123456789abcdef',
    digest: '2'.repeat(64),
  };
  const binding = {
    workspaceId: '0123456789abcdef',
    workItemId: 'WORK-1',
    planId: 'PLAN-1',
    taskId: 'TASK-1',
    sessionId: 'SESSION-1',
  };
  const receipt = (actor, label, at) => ({
    actor: { bindingDigest: actor.digest, host: 'trae' },
    binding,
    operation: { family: 'OWNER_CONTROL', label, targetRef: null },
    result: 'RUNNING',
    at,
  });
  const dependencies = {
    clock: () => new Date('2026-09-26T00:01:00.000Z'),
    readWorkspaceActions: () => [
      receipt(
        executor,
        'completion-review-prepare',
        '2026-09-26T00:00:30.000Z',
      ),
      receipt(
        reviewer,
        'completion-review-submit',
        '2026-09-26T00:00:50.000Z',
      ),
    ],
    listActiveConversationBindings: () => [executor, reviewer],
  };
  const context = {
    ...binding,
    ownerCommand: 'completion-review-prepare',
  };
  assert.equal(
    resolveCompletionReviewBinding(
      '/workspace',
      [],
      dependencies,
      context,
    ).digest,
    executor.digest,
  );
  assert.equal(
    resolveCompletionReviewBinding(
      '/workspace',
      [executor.digest],
      dependencies,
      { ...context, ownerCommand: 'completion-review-submit' },
    ).digest,
    reviewer.digest,
  );
});
