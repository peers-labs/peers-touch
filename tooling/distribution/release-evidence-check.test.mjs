import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SCENARIOS, sha256, verifyRun, verifyReport } from './release-evidence-check.mjs';

const expected = { repo: 'peers-labs/peers-touch', runId: '123', attempt: '2', source: 'a'.repeat(40),
  tag: 'v0.1.0', phase: 'candidate', task: 'RD-T03' };
const goodRun = () => ({
  databaseId: 123, attempt: 2, headSha: expected.source, headBranch: expected.tag, event: 'push',
  workflowName: 'Release', status: 'completed', conclusion: 'success',
  jobs: [{ name: 'verify-candidate-station', status: 'completed', conclusion: 'success',
    steps: ['Run release Suite', 'Upload release evidence'].map((name) => ({ name, status: 'completed', conclusion: 'success' })) }],
});

test('complete run JSON is required and each identity, job and step is checked', () => {
  verifyRun(goodRun(), expected);
  assert.throws(() => verifyRun('success', expected), /JSON_REQUIRED/u);
  for (const [key, value] of [['attempt', 1], ['headSha', 'b'.repeat(40)], ['headBranch', 'v9.0.0'],
    ['status', 'in_progress'], ['conclusion', 'failure']]) {
    assert.throws(() => verifyRun({ ...goodRun(), [key]: value }, expected), /RD_/u);
  }
  const missing = goodRun();
  missing.jobs[0].steps.pop();
  assert.throws(() => verifyRun(missing, expected), /STEP_MISSING/u);
  missing.jobs = [];
  assert.throws(() => verifyRun(missing, expected), /JOB_MISSING/u);
});

test('Suite proof binds receiver files, downloaded bytes, scenarios and cleanup', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.writeFileSync(path.join(root, 'assets', 'install.sh'), 'actual bytes');
  fs.writeFileSync(path.join(root, 'receiver.json'), '{"observed":true}');
  const report = {
    ...expected, result: 'FUNCTIONAL_PASS', sourceDigest: expected.source, suiteRuntimeId: 'suite-123',
    target: 'isolated-linux-amd64', fixtureEpoch: 'epoch-123', cleanup: { result: 'PASS' },
    scenarios: SCENARIOS[expected.task].map((id) => ({ id, result: 'FUNCTIONAL_PASS', action: 'real product action',
      receiver: { observed: true, evidence: 'receiver.json', sha256: sha256(fs.readFileSync(path.join(root, 'receiver.json'))) } })),
    assets: [{ name: 'install.sh', sha256: sha256('actual bytes') }], imageDigest: `sha256:${'c'.repeat(64)}`,
  };
  verifyReport(report, expected, root);
  assert.throws(() => verifyReport({ ...report, cleanup: { result: 'FAIL' } }, expected, root), /UNPROVEN/u);
  assert.throws(() => verifyReport({ ...report, attempt: 1 }, expected, root), /ATTEMPT_MISMATCH/u);
  assert.throws(() => verifyReport({ ...report, scenarios: report.scenarios.slice(1) }, expected, root), /SCENARIO_UNPROVEN/u);
  fs.writeFileSync(path.join(root, 'assets', 'install.sh'), 'tampered');
  assert.throws(() => verifyReport(report, expected, root), /ASSET_DIGEST_MISMATCH/u);
  fs.writeFileSync(path.join(root, 'receiver.json'), 'tampered');
  assert.throws(() => verifyReport(report, expected, root), /RECEIVER_EVIDENCE_MISMATCH/u);
});

test('candidate lifecycle proof binds the real baseline release assets', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-baseline-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'baseline-assets'));
  fs.writeFileSync(path.join(root, 'assets', 'install.sh'), 'candidate');
  fs.writeFileSync(path.join(root, 'baseline-assets', 'install.sh'), 'baseline');
  fs.writeFileSync(path.join(root, 'receiver.json'), '{"observed":true}');
  const lifecycleExpected = {
    ...expected, task: 'RD-T04', fromTag: 'v0.0.9',
  };
  const receiver = {
    observed: true,
    evidence: 'receiver.json',
    sha256: sha256(fs.readFileSync(path.join(root, 'receiver.json'))),
  };
  const report = {
    ...lifecycleExpected,
    result: 'FUNCTIONAL_PASS',
    sourceDigest: lifecycleExpected.source,
    suiteRuntimeId: 'suite-lifecycle',
    target: 'linux-x86_64',
    fixtureEpoch: 'epoch-lifecycle',
    cleanup: { result: 'PASS' },
    scenarios: SCENARIOS['RD-T04'].map((id) => ({
      id, action: 'real lifecycle action', result: 'FUNCTIONAL_PASS', receiver,
    })),
    assets: [{ name: 'install.sh', sha256: sha256('candidate') }],
    baselineAssets: [{ name: 'install.sh', sha256: sha256('baseline') }],
    imageDigest: `sha256:${'d'.repeat(64)}`,
  };
  const compatibility = {
    result: 'FUNCTIONAL_PASS',
    from: { tag: lifecycleExpected.tag },
    to: { tag: lifecycleExpected.fromTag },
    schema: 'e'.repeat(64),
    cleanup: { result: 'PASS' },
    readWrite: { existingProductReadback: true, oldProgramWriteReadback: true },
  };
  fs.writeFileSync(path.join(root, 'compatibility-report.json'), JSON.stringify(compatibility));
  fs.writeFileSync(path.join(root, 'compatibility.json'), JSON.stringify({
    from: compatibility.from,
    to: compatibility.to,
    schema: compatibility.schema,
    result: 'FUNCTIONAL_PASS',
    readWriteVerified: true,
    suiteReport: 'compatibility-report.json',
    suiteReportDigest: sha256(fs.readFileSync(path.join(root, 'compatibility-report.json'))),
  }));
  verifyReport(report, lifecycleExpected, root);
  fs.writeFileSync(path.join(root, 'baseline-assets', 'install.sh'), 'tampered');
  assert.throws(() => verifyReport(report, lifecycleExpected, root), /BASELINE_ASSET_DIGEST_MISMATCH/u);
  fs.writeFileSync(path.join(root, 'baseline-assets', 'install.sh'), 'baseline');
  fs.writeFileSync(path.join(root, 'compatibility-report.json'), 'tampered');
  assert.throws(() => verifyReport(report, lifecycleExpected, root), /COMPATIBILITY_EVIDENCE_MISSING/u);
});
