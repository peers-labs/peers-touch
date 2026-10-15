import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  realpathSync,
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
import { inspectGitWorkspace } from './git-workspace.mjs';

function fixture(t) {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'completion-review-')),
  );
  t.after(() =>
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    }));
  execFileSync('git', ['init', '-b', 'feat/review'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'review@example.invalid'], {
    cwd: root,
  });
  execFileSync('git', ['config', 'user.name', 'Review Test'], { cwd: root });
  execFileSync('git', ['config', 'core.hooksPath', '/dev/null'], { cwd: root });
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-m', 'test: initialize fixture'], {
    cwd: root,
  });
  return root;
}

function evidence(root) {
  const source = inspectGitWorkspace(root, {
    excludePaths: ['.dev-workflow'],
  });
  return {
    kind: 'SOURCE_CHECK',
    result: 'PASS',
    ref: 'evidence://source',
    source: {
      commit: source.commit,
      workspaceDigest: source.workspaceDigest,
    },
  };
}

test('FLOW-A16 standalone review uses explicit obligations and current source', async (t) => {
  const root = fixture(t);
  const review = await prepareStandaloneCompletionReview({
    repoRoot: root,
    obligations: [{ id: 'scope', text: 'Review current source.' }],
    evidenceRefs: [evidence(root)],
    scopePaths: ['README.md'],
  });
  assert.equal(review.reviewable, true);
  assert.equal(review.material.source.branch, 'feat/review');
  assert.equal(Object.hasOwn(review.material, 'sessionId'), false);
  assert.equal(Object.hasOwn(review.material, 'planMount'), false);
});

test('FLOW-A16 stale evidence fails closed', async (t) => {
  const root = fixture(t);
  await assert.rejects(
    prepareStandaloneCompletionReview({
      repoRoot: root,
      obligations: ['Review current source.'],
      evidenceRefs: [
        {
          kind: 'SOURCE_CHECK',
          result: 'PASS',
          ref: 'evidence://stale',
          source: {
            commit: '1'.repeat(40),
            workspaceDigest: 'clean',
          },
        },
      ],
    }),
    (error) => {
      assert.equal(error.code, 'COMPLETION_REVIEW_EVIDENCE_STALE');
      return true;
    },
  );
});

test('FLOW-A16 non-passing evidence remains unreviewable', async (t) => {
  const root = fixture(t);
  const current = evidence(root);
  const review = await prepareStandaloneCompletionReview({
    repoRoot: root,
    obligations: ['Review current source.'],
    evidenceRefs: [{ ...current, result: 'UNPROVEN' }],
  });
  assert.equal(review.reviewable, false);
});

test('FLOW-A16 out-of-scope changes and blocking findings derive FAIL', async (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'outside.txt'), 'change\n');
  const assessed = await assessStandaloneCompletionReview({
    repoRoot: root,
    obligations: ['Review current source.'],
    evidenceRefs: [evidence(root)],
    scopePaths: ['README.md'],
    findings: [
      {
        severity: 'P1',
        title: 'Required path is outside scope',
        status: 'OPEN',
        evidenceRefs: ['source://outside.txt'],
      },
    ],
  });
  assert.deepEqual(assessed.material.outOfScope, ['outside.txt']);
  assert.equal(assessed.verdict, 'FAIL');
});

test('FLOW-A16 resolved findings and current evidence derive PASS', async (t) => {
  const root = fixture(t);
  const assessed = await assessStandaloneCompletionReview({
    repoRoot: root,
    obligations: ['Review current source.'],
    evidenceRefs: [evidence(root)],
    findings: [
      {
        severity: 'P2',
        title: 'Non-blocking note',
        status: 'OPEN',
        evidenceRefs: ['source://README.md'],
      },
    ],
  });
  assert.equal(assessed.verdict, 'PASS');
});
