import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from './experience-design.mjs';
import { completeReviewFixture } from './fixtures/positive/complete-review.mjs';
import { minorOnlyBoundaryFixture } from './fixtures/boundary/minor-only.mjs';
import { digestReviewResult } from './validator.mjs';
import { createFixtureBundle } from './test-fixture.mjs';
import { loadGrammar, loadRuleCatalog, validateExperienceCaseValue } from './schema.mjs';

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

function sourceBoundFixture(root, result = completeReviewFixture()) {
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
  for (const relative of [inputs.casePath, inputs.rubricPath]) {
    const bytes = Buffer.from(`${relative}\n`, 'utf8');
    write(root, relative, bytes);
    const field = {
      [inputs.casePath]: 'caseDigest',
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
  const binding = result.evaluationBinding;
  const manifest = {
    kind: 'peers-touch-experience-review-manifest',
    schemaVersion: 1,
    packageId: binding.packageId,
    sourceHead: binding.sourceHead,
    sourceBlobAlgorithm: binding.sourceBlobAlgorithm,
    cases: [{
      id: 'case.fixture',
      path: inputs.casePath,
      format: 'source-backed-markdown',
      digest: binding.caseDigest,
      sourceBlobs: binding.sourceBlobs,
    }],
  };
  binding.manifestDigest = sha256(Buffer.from(`${JSON.stringify(manifest)}\n`));
  write(root, inputs.manifestPath, `${JSON.stringify(manifest)}\n`);
  const envelope = {
    kind: 'peers-touch-experience-review-envelope',
    schemaVersion: 1,
    packageId: binding.packageId,
    sourceHead: binding.sourceHead,
    manifest: { path: inputs.manifestPath, digest: binding.manifestDigest },
    rubric: { path: inputs.rubricPath, digest: binding.rubricDigest },
    cases: [{ id: 'case.fixture', path: inputs.casePath, digest: binding.caseDigest }],
  };
  write(root, inputs.runEnvelopePath, `${JSON.stringify(envelope)}\n`);
  binding.runEnvelopeDigest = sha256(Buffer.from(`${JSON.stringify(envelope)}\n`));
  const resultPath = write(
    root,
    'review-result.json',
    `${JSON.stringify(result, null, 2)}\n`,
  );
  return { inputs, result, resultPath };
}

function bindingOptions(root, inputs) {
  return [
    '--repo-root', root,
    '--package-root', root,
    '--run-envelope', inputs.runEnvelopePath,
    '--case', inputs.casePath,
    '--manifest', inputs.manifestPath,
    '--rubric', inputs.rubricPath,
  ];
}

test('admission requires current inputs and rejects drift after verification', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-admission-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inputs, result, resultPath } = sourceBoundFixture(root, minorOnlyBoundaryFixture());
  const decisionPath = write(root, 'decision.json', JSON.stringify({
    resultDigest: digestReviewResult(result),
    reviewerId: 'agent.independent',
    decision: 'accepted',
    findingCandidateIds: result.minorObservations.map((finding) => finding.candidateId),
    reviewNotes: [],
  }));
  const args = ['review-admission', resultPath, decisionPath];
  assert.throws(() => runCli(args), (error) => error.code === 'EDX_BINDING_INVALID');
  assert.equal(runCli([...args, ...bindingOptions(root, inputs)]).admitted, true);
  runCli(['review-verify', resultPath, ...bindingOptions(root, inputs)]);
  fs.appendFileSync(path.join(root, inputs.casePath), 'drift\n');
  assert.throws(
    () => runCli([...args, ...bindingOptions(root, inputs)]),
    (error) => error.code === 'EDX_BINDING_INVALID',
  );
});

test('source fence rejects independently hashed but unrelated envelope and manifest', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-links-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inputs, result, resultPath } = sourceBoundFixture(root);
  const originalResult = structuredClone(result);
  const originalEnvelope = fs.readFileSync(path.join(root, inputs.runEnvelopePath));
  const originalManifest = fs.readFileSync(path.join(root, inputs.manifestPath));
  for (const target of ['envelope-package', 'envelope-case', 'manifest-source']) {
    Object.assign(result, structuredClone(originalResult));
    write(root, inputs.runEnvelopePath, originalEnvelope);
    write(root, inputs.manifestPath, originalManifest);
    const envelopePath = path.join(root, inputs.runEnvelopePath);
    const envelope = JSON.parse(fs.readFileSync(envelopePath));
    if (target === 'envelope-package') envelope.packageId = 'package.other';
    if (target === 'envelope-case') envelope.cases[0].digest = `sha256:${'f'.repeat(64)}`;
    if (target === 'manifest-source') {
      const manifestPath = path.join(root, inputs.manifestPath);
      const manifest = JSON.parse(fs.readFileSync(manifestPath));
      manifest.cases[0].sourceBlobs = [];
      write(root, inputs.manifestPath, JSON.stringify(manifest));
      result.evaluationBinding.manifestDigest = sha256(fs.readFileSync(manifestPath));
      envelope.manifest.digest = result.evaluationBinding.manifestDigest;
    }
    write(root, inputs.runEnvelopePath, JSON.stringify(envelope));
    result.evaluationBinding.runEnvelopeDigest = sha256(fs.readFileSync(envelopePath));
    write(root, 'review-result.json', JSON.stringify(result));
    assert.throws(
      () => runCli(['review-verify', resultPath, ...bindingOptions(root, inputs)]),
      (error) => error.code === 'EDX_BINDING_INVALID',
    );
  }
});

test('canonical JSON review packages bind byte and canonical projection digests', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-canonical-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inputs, result, resultPath } = sourceBoundFixture(root);
  const repo = path.resolve(import.meta.dirname, '../../..');
  for (const relative of [
    'docs/architecture/engineering/experience-design/rules.json',
    'docs/client/common/ui-identity/grammar-bindings.json',
  ]) write(root, relative, fs.readFileSync(path.join(repo, relative)));
  const bundle = createFixtureBundle();
  const loaded = validateExperienceCaseValue(bundle.experienceCase, {
    ruleCatalog: loadRuleCatalog(path.join(root, 'docs/architecture/engineering/experience-design/rules.json')),
    grammar: loadGrammar(path.join(root, 'docs/client/common/ui-identity/grammar-bindings.json')),
  });
  inputs.casePath = 'inputs/case.json';
  write(root, inputs.casePath, JSON.stringify(bundle.experienceCase));
  result.evaluationBinding.caseDigest = sha256(fs.readFileSync(path.join(root, inputs.casePath)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, inputs.manifestPath)));
  Object.assign(manifest.cases[0], {
    id: bundle.experienceCase.id, path: inputs.casePath,
    format: 'experience-case-json', digest: result.evaluationBinding.caseDigest,
    canonicalDigests: Object.fromEntries(['case', 'contract', 'candidate'].map((key) => [key, loaded.digests[key]])),
  });
  function bind() {
    write(root, inputs.manifestPath, JSON.stringify(manifest));
    result.evaluationBinding.manifestDigest = sha256(fs.readFileSync(path.join(root, inputs.manifestPath)));
    const envelope = JSON.parse(fs.readFileSync(path.join(root, inputs.runEnvelopePath)));
    envelope.manifest.digest = result.evaluationBinding.manifestDigest;
    envelope.cases = [{ id: manifest.cases[0].id, path: inputs.casePath, digest: result.evaluationBinding.caseDigest }];
    write(root, inputs.runEnvelopePath, JSON.stringify(envelope));
    result.evaluationBinding.runEnvelopeDigest = sha256(fs.readFileSync(path.join(root, inputs.runEnvelopePath)));
    write(root, 'review-result.json', JSON.stringify(result));
  }
  bind();
  assert.equal(runCli(['review-verify', resultPath, ...bindingOptions(root, inputs)]).ok, true);
  const changed = structuredClone(bundle.experienceCase);
  changed.title = `${changed.title} changed`;
  const changedLoaded = validateExperienceCaseValue(changed, {
    ruleCatalog: loadRuleCatalog(path.join(root, 'docs/architecture/engineering/experience-design/rules.json')),
    grammar: loadGrammar(path.join(root, 'docs/client/common/ui-identity/grammar-bindings.json')),
  });
  manifest.cases[0].canonicalDigests.case = changedLoaded.digests.case;
  bind();
  const originalRead = fs.readFileSync;
  let caseReads = 0;
  context.mock.method(fs, 'readFileSync', function read(file, ...args) {
    if (String(file) === path.join(fs.realpathSync(root), inputs.casePath) && ++caseReads > 1) {
      return args[0] === 'utf8' ? JSON.stringify(changed) : Buffer.from(JSON.stringify(changed));
    }
    return originalRead.call(fs, file, ...args);
  });
  assert.throws(() => runCli(['review-verify', resultPath, ...bindingOptions(root, inputs)]),
    (error) => error.code === 'EDX_BINDING_INVALID');
  assert.equal(caseReads, 1);
  context.mock.restoreAll();
  manifest.cases[0].canonicalDigests.candidate = `sha256:${'f'.repeat(64)}`;
  bind();
  assert.throws(() => runCli(['review-verify', resultPath, ...bindingOptions(root, inputs)]),
    (error) => error.code === 'EDX_BINDING_INVALID');
});

test('every declared case has contained paths and typed source bindings', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'edx-inventory-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { inputs, result, resultPath } = sourceBoundFixture(root);
  const originalManifest = JSON.parse(fs.readFileSync(path.join(root, inputs.manifestPath)));
  const originalEnvelope = JSON.parse(fs.readFileSync(path.join(root, inputs.runEnvelopePath)));
  write(root, 'inputs/second.md', 'second case');
  fs.symlinkSync(os.tmpdir(), path.join(root, 'inputs/outside-link'));
  for (const change of [
    { path: '../outside.md' },
    { path: '/outside.md' },
    { path: 'inputs/outside-link' },
    { id: 'invalid stable id' },
    { digest: 7 },
    { sourceBlobs: null },
  ]) {
    const manifest = structuredClone(originalManifest);
    const envelope = structuredClone(originalEnvelope);
    const entry = { ...structuredClone(manifest.cases[0]), id: 'case.second', path: 'inputs/second.md', ...change };
    manifest.cases.push(entry);
    envelope.cases.push({ id: entry.id, path: entry.path, digest: entry.digest });
    write(root, inputs.manifestPath, JSON.stringify(manifest));
    result.evaluationBinding.manifestDigest = sha256(fs.readFileSync(path.join(root, inputs.manifestPath)));
    envelope.manifest.digest = result.evaluationBinding.manifestDigest;
    write(root, inputs.runEnvelopePath, JSON.stringify(envelope));
    result.evaluationBinding.runEnvelopeDigest = sha256(fs.readFileSync(path.join(root, inputs.runEnvelopePath)));
    write(root, 'review-result.json', JSON.stringify(result));
    assert.throws(() => runCli(['review-verify', resultPath, ...bindingOptions(root, inputs)]),
      (error) => ['EDX_BINDING_INVALID', 'EDX_RESULT_INVALID'].includes(error.code));
  }
});

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
