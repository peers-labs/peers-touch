import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { canonicalDigest } from './canonical.mjs';
import {
  loadPairedExperienceCase,
} from './comparative-schema.mjs';
import {
  createComparativeFixture,
  writeComparativePackage,
} from './comparative-test-fixture.mjs';

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-schema-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture(options);
  const casePath = writeComparativePackage(root, bundle);
  return { root, bundle, casePath };
}

function writeJson(sourcePath, value) {
  fs.writeFileSync(sourcePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('loads one closed identity-neutral paired package', (t) => {
  const { root, casePath } = fixture(t);
  const loaded = loadPairedExperienceCase(casePath, root);
  assert.equal(loaded.pair.id, 'pair.compare');
  assert.deepEqual(
    loaded.legs.map((leg) => leg.descriptor.blindedAlias).sort(),
    ['A', 'B'],
  );
  assert.equal(
    Object.hasOwn(loaded.pair.legs[0], 'peersBinding'),
    false,
  );
});

test('rejects a stale leg artifact digest', (t) => {
  const { root, casePath } = fixture(t);
  const observationPath = path.join(
    root,
    'legs/A/journey-observation.json',
  );
  const observation = JSON.parse(fs.readFileSync(observationPath));
  observation.states[0].visibleMeaning = 'Changed after pair freeze';
  writeJson(observationPath, observation);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects a context binding mismatch even with refreshed file digests', (t) => {
  const { root, bundle } = fixture(t);
  const observation = bundle.observations.A;
  observation.contextDigest = `sha256:${'f'.repeat(64)}`;
  const observationPath = path.join(
    root,
    'legs/A/journey-observation.json',
  );
  writeJson(observationPath, observation);
  bundle.pair.legs[0].observation.digest = canonicalDigest(observation);
  const casePath = path.join(root, 'paired-case.json');
  writeJson(casePath, bundle.pair);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects reviewer overlap with Oracle and leg authors', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-overlap-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture();
  bundle.legReviews.A.reviewerId = bundle.oracle.authoredById;
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});

test('accepts an independently reviewed unproven leg', (t) => {
  const { root, casePath } = fixture(t, { unprovenA: true });
  const loaded = loadPairedExperienceCase(casePath, root);
  assert.equal(loaded.legs[0].review.decision, 'unproven');
});

test('rejects a package symlink that escapes the package root', (t) => {
  const { root, casePath } = fixture(t);
  const observationPath = path.join(
    root,
    'legs/A/journey-observation.json',
  );
  const outside = path.join(os.tmpdir(), `cer-outside-${process.pid}.json`);
  fs.copyFileSync(observationPath, outside);
  t.after(() => fs.rmSync(outside, { force: true }));
  fs.rmSync(observationPath);
  fs.symlinkSync(outside, observationPath);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects graph facts that do not bind edge endpoints', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-graph-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture();
  bundle.observations.A.edges[0].actionFactId = 'fact.A.fail';
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects met results without an observable satisfying state', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-state-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture({ successfulA: true });
  bundle.observations.A.states[1].kind = 'waiting';
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects unreachable in-scope observation states', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-reachability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture();
  bundle.observations.A.states.push({
    id: 'state.A.orphan',
    kind: 'waiting',
    contextId: 'context.task',
    ordinal: 2,
    visibleMeaning: 'An orphan state',
    inScope: true,
  });
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects evidence that is bound to another Oracle claim', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-claim-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture();
  bundle.evidenceLedgers.B.records[1].claimIds = ['outcome.complete'];
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_LEG_INVALID',
  );
});

test('rejects Oracle authors that also author a comparison leg', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-oracle-author-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture();
  bundle.observations.A.authoredById = bundle.oracle.authoredById;
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});

test('rejects a leg reviewer who authors the other leg', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cer-cross-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = createComparativeFixture();
  bundle.legReviews.A.reviewerId = bundle.observations.B.authoredById;
  const casePath = writeComparativePackage(root, bundle);
  assert.throws(
    () => loadPairedExperienceCase(casePath, root),
    (error) => error.code === 'EDX_COMPARE_REVIEW_REQUIRED',
  );
});
