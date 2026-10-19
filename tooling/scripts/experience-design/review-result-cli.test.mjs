import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './experience-design.mjs';
import { completeReviewFixture } from './fixtures/positive/complete-review.mjs';

function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function gitBlobSha1(bytes) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${bytes.length}\0`, 'utf8'))
    .update(bytes)
    .digest('hex');
}

function write(root, relative, content) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return absolute;
}

function sourceBoundFixture(root) {
  const result = completeReviewFixture();
  for (const blob of result.evaluationBinding.sourceBlobs) {
    const bytes = Buffer.from(
      Array.from(
        { length: 100 },
        (_value, index) => `${index + 1}: ${blob.path}`,
      ).join('\n'),
      'utf8',
    );
    write(root, blob.path, bytes);
    blob.digest = gitBlobSha1(bytes);
  }
  const inputs = {
    runEnvelopePath: 'inputs/run-envelope.json',
    casePath: 'inputs/case.md',
    manifestPath: 'inputs/manifest.json',
    rubricPath: 'inputs/rubric.md',
  };
  for (const relative of Object.values(inputs)) {
    const bytes = Buffer.from(`${relative}\n`, 'utf8');
    write(root, relative, bytes);
    const field = {
      [inputs.runEnvelopePath]: 'runEnvelopeDigest',
      [inputs.casePath]: 'caseDigest',
      [inputs.manifestPath]: 'manifestDigest',
      [inputs.rubricPath]: 'rubricDigest',
    }[relative];
    result.evaluationBinding[field] = sha256(bytes);
  }
  const init = spawnSync('git', ['init', '--quiet'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);
  const add = spawnSync('git', ['add', 'docs', 'inputs'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(add.status, 0, add.stderr);
  const commit = spawnSync(
    'git',
    [
      '-c',
      'user.name=Experience Fixture',
      '-c',
      'user.email=experience-fixture@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(commit.status, 0, commit.stderr);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(head.status, 0, head.stderr);
  result.evaluationBinding.sourceHead = head.stdout.trim();
  const resultPath = write(
    root,
    'review-result.json',
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return { inputs, result, resultPath };
}

test('CLI validates and source-fences an explicit review package', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-review-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inputs, resultPath } = sourceBoundFixture(root);

  const validated = runCli(['review-validate', resultPath]);
  assert.equal(validated.ok, true);

  const verified = runCli([
    'review-verify',
    resultPath,
    '--repo-root',
    root,
    '--package-root',
    root,
    '--run-envelope',
    inputs.runEnvelopePath,
    '--case',
    inputs.casePath,
    '--manifest',
    inputs.manifestPath,
    '--rubric',
    inputs.rubricPath,
  ]);
  assert.equal(verified.sourceFence.sourceBlobCount, 2);
});

test('CLI rejects source drift after report freeze', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-review-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inputs, result, resultPath } = sourceBoundFixture(root);
  fs.appendFileSync(
    path.join(root, result.evaluationBinding.sourceBlobs[0].path),
    'drift\n',
  );

  assert.throws(
    () =>
      runCli([
        'review-verify',
        resultPath,
        '--repo-root',
        root,
        '--package-root',
        root,
        '--run-envelope',
        inputs.runEnvelopePath,
        '--case',
        inputs.casePath,
        '--manifest',
        inputs.manifestPath,
        '--rubric',
        inputs.rubricPath,
      ]),
    (error) => error.code === 'EDX_BINDING_INVALID',
  );
});
