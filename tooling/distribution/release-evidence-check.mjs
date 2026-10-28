import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const SCENARIOS = {
  'RD-T03': ['rd-station-start', 'rd-station-build-identity'],
  'RD-T04': ['rd-install', 'rd-install-idempotent', 'rd-checksum-reject', 'rd-backup', 'rd-upgrade', 'rd-rollback-compatible', 'rd-rollback-reject', 'rd-backup-restore', 'rd-uninstall'],
  'RD-T05': ['rd-desktop-install', 'rd-updater-discovery', 'rd-updater-signature-reject', 'rd-updater-apply'],
};
const requireFact = (condition, code) => { if (!condition) throw new Error(code); };
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function verifyRun(run, expected) {
  requireFact(run && typeof run === 'object' && !Array.isArray(run), 'RD_RUN_JSON_REQUIRED');
  requireFact(run.databaseId === Number(expected.runId) && run.attempt === Number(expected.attempt), 'RD_RUN_IDENTITY_MISMATCH');
  requireFact(run.headSha === expected.source && run.headBranch === expected.tag && run.event === 'push'
    && run.workflowName === 'Release', 'RD_RUN_SOURCE_MISMATCH');
  requireFact(run.status === 'completed' && run.conclusion === 'success', 'RD_RUN_NOT_SUCCESSFUL');
  const lane = expected.task === 'RD-T05' ? 'native' : 'station';
  const job = run.jobs?.find((entry) => entry.name === `verify-${expected.phase}-${lane}`);
  requireFact(job?.status === 'completed' && job.conclusion === 'success', 'RD_SUITE_JOB_MISSING');
  const steps = lane === 'station'
    ? ['Run release Suite', 'Upload release evidence']
    : ['Run native updater Suite', 'Upload native updater evidence'];
  for (const name of steps) {
    const step = job.steps?.find((entry) => entry.name === name);
    requireFact(step?.status === 'completed' && step.conclusion === 'success', 'RD_REQUIRED_STEP_MISSING');
  }
}

export function verifyReport(report, expected, directory) {
  requireFact(SCENARIOS[expected.task], 'RD_TASK_INVALID');
  for (const key of ['repo', 'runId', 'attempt', 'source', 'tag', 'phase']) {
    requireFact(String(report[key]) === String(expected[key]), `RD_REPORT_${key.toUpperCase()}_MISMATCH`);
  }
  requireFact(report.result === 'FUNCTIONAL_PASS' && report.cleanup?.result === 'PASS', 'RD_SUITE_UNPROVEN');
  requireFact(report.suiteRuntimeId && report.fixtureEpoch && report.target && report.sourceDigest === expected.source,
    'RD_SUITE_IDENTITY_MISSING');
  if (expected.phase === 'candidate' && expected.task !== 'RD-T03') {
    requireFact(expected.fromTag && report.fromTag === expected.fromTag, 'RD_VERSION_PAIR_MISSING');
  }
  const required = expected.phase === 'public' && expected.task === 'RD-T04'
    ? ['rd-install', 'rd-install-idempotent', 'rd-uninstall'] : SCENARIOS[expected.task];
  for (const id of required) {
    const scenario = report.scenarios?.find((entry) => entry.id === id);
    requireFact(scenario?.result === 'FUNCTIONAL_PASS' && scenario.action && scenario.receiver?.observed === true
      && typeof scenario.receiver.evidence === 'string', `RD_SCENARIO_UNPROVEN:${id}`);
    const file = path.resolve(directory, scenario.receiver.evidence);
    requireFact(file.startsWith(`${path.resolve(directory)}${path.sep}`)
      && sha256(fs.readFileSync(file)) === scenario.receiver.sha256, 'RD_RECEIVER_EVIDENCE_MISMATCH');
  }
  requireFact(Array.isArray(report.assets) && report.assets.length > 0, 'RD_ASSETS_MISSING');
  for (const asset of report.assets) {
    requireFact(/^[A-Za-z0-9_.-]+$/u.test(asset.name) && /^[a-f0-9]{64}$/u.test(asset.sha256), 'RD_ASSET_IDENTITY_INVALID');
    requireFact(sha256(fs.readFileSync(path.join(directory, 'assets', asset.name))) === asset.sha256, 'RD_ASSET_DIGEST_MISMATCH');
  }
  if (expected.phase === 'candidate' && expected.task === 'RD-T04') {
    requireFact(Array.isArray(report.baselineAssets) && report.baselineAssets.length > 0,
      'RD_BASELINE_ASSETS_MISSING');
    for (const asset of report.baselineAssets) {
      requireFact(/^[A-Za-z0-9_.-]+$/u.test(asset.name) && /^[a-f0-9]{64}$/u.test(asset.sha256),
        'RD_BASELINE_ASSET_IDENTITY_INVALID');
      requireFact(sha256(fs.readFileSync(path.join(directory, 'baseline-assets', asset.name))) === asset.sha256,
        'RD_BASELINE_ASSET_DIGEST_MISMATCH');
    }
    const proofFile = path.join(directory, 'compatibility.json');
    const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
    requireFact(proof.suiteReport === 'compatibility-report.json'
      && /^[a-f0-9]{64}$/u.test(proof.schema)
      && proof.from?.tag === expected.tag
      && proof.to?.tag === expected.fromTag
      && proof.result === 'FUNCTIONAL_PASS'
      && proof.readWriteVerified === true,
    'RD_SCHEMA_COMPATIBILITY_MISMATCH');
    const compatibilityFile = path.join(directory, proof.suiteReport);
    requireFact(sha256(fs.readFileSync(compatibilityFile)) === proof.suiteReportDigest,
      'RD_SCHEMA_COMPATIBILITY_EVIDENCE_MISSING');
    const compatibility = JSON.parse(fs.readFileSync(compatibilityFile, 'utf8'));
    requireFact(compatibility.result === 'FUNCTIONAL_PASS'
      && compatibility.from?.tag === expected.tag
      && compatibility.to?.tag === expected.fromTag
      && compatibility.schema === proof.schema
      && compatibility.cleanup?.result === 'PASS'
      && compatibility.readWrite?.existingProductReadback === true
      && compatibility.readWrite?.oldProgramWriteReadback === true,
    'RD_SCHEMA_COMPATIBILITY_MISMATCH');
  }
  requireFact(/^sha256:[a-f0-9]{64}$/u.test(report.imageDigest), 'RD_IMAGE_DIGEST_MISSING');
}

export function parseArguments(values) {
  const result = {};
  for (let i = 0; i < values.length; i += 2) {
    requireFact(values[i]?.startsWith('--') && values[i + 1] && !values[i + 1].startsWith('--'), 'RD_ARGUMENT_REQUIRED');
    result[values[i].slice(2).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())] = values[i + 1];
  }
  for (const key of ['repo', 'runId', 'attempt', 'tag', 'source', 'task', 'phase']) requireFact(result[key], `RD_${key.toUpperCase()}_REQUIRED`);
  requireFact(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/u.test(result.repo) && /^[0-9a-f]{40,64}$/u.test(result.source)
    && /^\d+$/u.test(result.runId) && Number(result.attempt) > 0
    && ['candidate', 'public'].includes(result.phase), 'RD_IDENTITY_INVALID');
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    const expected = parseArguments(process.argv.slice(2));
    const raw = execFileSync('gh', ['run', 'view', expected.runId, '--repo', expected.repo, '--attempt', expected.attempt,
      '--json', 'databaseId,attempt,headSha,headBranch,event,workflowName,status,conclusion,jobs'], { encoding: 'utf8' });
    verifyRun(JSON.parse(raw), expected);
    requireFact(expected.evidenceDir, 'RD_EVIDENCE_DIRECTORY_REQUIRED');
    const report = JSON.parse(fs.readFileSync(path.join(expected.evidenceDir, 'release-suite.json'), 'utf8'));
    verifyReport(report, expected, expected.evidenceDir);
    process.stdout.write('RD_EVIDENCE_VERIFIED\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
