import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  matchEvidenceRequirements,
  recordMatchesRequirement,
} from './evidence.mjs';

const candidateDigest = `sha256:${'a'.repeat(64)}`;

function requirement(overrides = {}) {
  return {
    id: 'evidence.visual.default',
    claimId: 'acceptance.render',
    level: 'L2_VISUAL',
    platform: 'desktop',
    runtimeProfile: 'profile-two',
    inputMode: 'pointer',
    locale: 'en-US',
    viewport: {
      widthCssPx: 1280,
      heightCssPx: 800,
      devicePixelRatio: 2,
    },
    resolvedTheme: 'dark',
    contentMode: 'long',
    stateIds: ['state.entry', 'state.long'],
    assertionIds: ['assertion.hierarchy'],
    ...overrides,
  };
}

function observedRecord(root, overrides = {}) {
  const artifact = 'evidence/render.txt';
  const resolved = path.join(root, artifact);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, 'rendered evidence\n');
  const artifactDigest =
    `sha256:${createHash('sha256')
      .update(fs.readFileSync(resolved))
      .digest('hex')}`;
  return {
    id: 'record.visual.default',
    requirementId: 'evidence.visual.default',
    level: 'L2_VISUAL',
    status: 'observed',
    sourceDigest: candidateDigest,
    artifact,
    artifactDigest,
    inspectedById: 'evidence-author',
    observedAt: '2026-10-18T18:00:00.000Z',
    platform: 'desktop',
    runtimeProfile: 'profile-two',
    inputMode: 'pointer',
    locale: 'en-US',
    viewport: {
      widthCssPx: 1280,
      heightCssPx: 800,
      devicePixelRatio: 2,
    },
    requestedTheme: 'system',
    resolvedTheme: 'dark',
    contentMode: 'long',
    stateIds: ['state.long', 'state.entry'],
    assertionIds: ['assertion.hierarchy'],
    ...overrides,
  };
}

test('matches the complete exact evidence cell and current artifact', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(
    recordMatchesRequirement(requirement(), observedRecord(root), {
      candidateDigest,
      repoRoot: root,
    }),
    true,
  );
});

test('rejects every stale source or cell dimension', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const mutations = [
    { sourceDigest: `sha256:${'b'.repeat(64)}` },
    { platform: 'mobile' },
    { runtimeProfile: 'other-profile' },
    { inputMode: 'keyboard' },
    { locale: 'zh-CN' },
    {
      viewport: {
        widthCssPx: 1279,
        heightCssPx: 800,
        devicePixelRatio: 2,
      },
    },
    { resolvedTheme: 'light' },
    { contentMode: 'default' },
    { stateIds: ['state.entry'] },
    { assertionIds: ['assertion.other'] },
    { artifactDigest: `sha256:${'c'.repeat(64)}` },
    { status: 'unproven' },
  ];

  for (const mutation of mutations) {
    assert.equal(
      recordMatchesRequirement(
        requirement(),
        observedRecord(root, mutation),
        { candidateDigest, repoRoot: root },
      ),
      false,
      JSON.stringify(mutation),
    );
  }
});

test('performance evidence matches environment, workload, method and percentile', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const metric = {
    name: 'interaction-latency',
    comparator: '<=',
    threshold: 120,
    unit: 'ms',
    environment: 'macos-profile-two',
    workload: '100-row-list',
    measurementMethod: 'playwright-trace',
    samplePolicy: '20-warm-runs',
    percentile: 'p95',
  };
  const metricObservation = {
    name: 'interaction-latency',
    value: 118,
    unit: 'ms',
    environment: 'macos-profile-two',
    workload: '100-row-list',
    measurementMethod: 'playwright-trace',
    samplePolicy: '20-warm-runs',
    percentile: 'p95',
  };

  assert.equal(
    recordMatchesRequirement(
      requirement({ metric }),
      observedRecord(root, { metricObservation }),
      { candidateDigest, repoRoot: root },
    ),
    true,
  );
  assert.equal(
    recordMatchesRequirement(
      requirement({ metric }),
      observedRecord(root, {
        metricObservation: {
          ...metricObservation,
          environment: 'developer-laptop',
        },
      }),
      { candidateDigest, repoRoot: root },
    ),
    false,
  );
  assert.equal(
    recordMatchesRequirement(
      requirement({ metric }),
      observedRecord(root, {
        metricObservation: { ...metricObservation, value: 121 },
      }),
      { candidateDigest, repoRoot: root },
    ),
    false,
  );
});

test('matcher reports every requirement without an exact record', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = requirement();
  const second = requirement({ id: 'evidence.visual.failure' });
  const candidate = { evidence: [observedRecord(root)] };

  const result = matchEvidenceRequirements(
    { requiredEvidence: [first, second] },
    candidate,
    { candidateDigest, repoRoot: root },
  );

  assert.deepEqual(
    Object.fromEntries(result.matches),
    { 'evidence.visual.default': 'record.visual.default' },
  );
  assert.deepEqual(result.unmatched, ['evidence.visual.failure']);
});

test('rejects artifacts reached through a parent symlink outside repo root', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'experience-evidence-'));
  const outside = fs.mkdtempSync(
    path.join(os.tmpdir(), 'experience-evidence-outside-'),
  );
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(outside, 'render.txt'), 'outside evidence\n');
  fs.symlinkSync(outside, path.join(root, 'linked'));
  const bytes = fs.readFileSync(path.join(outside, 'render.txt'));
  const record = observedRecord(root, {
    artifact: 'linked/render.txt',
    artifactDigest:
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  });

  assert.equal(
    recordMatchesRequirement(requirement(), record, {
      candidateDigest,
      repoRoot: root,
    }),
    false,
  );
});
