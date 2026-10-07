#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const inventoryPath = path.join(
  repoRoot,
  'tooling/acceptance/gates/mobile/whole_product_surface_inventory.json',
);
const evidenceRole = 'mobile-surface-evidence';

function fail(message) {
  process.stderr.write(`FAIL: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') {
    return { surfaceSet: '', mode: 'self-test' };
  }
  const options = { surfaceSet: '', mode: 'review' };
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--surface-set' && value) options.surfaceSet = value;
    else if (flag === '--mode' && value) options.mode = value;
    else fail(`unsupported argument ${flag ?? '<missing>'}`);
  }
  if (!options.surfaceSet) fail('--surface-set is required');
  if (!['functional', 'review', 'record-review'].includes(options.mode)) {
    fail('--mode must be functional, review, or record-review');
  }
  return options;
}

export function collectScreenshotRefs(result, surfaceIds) {
  return Object.fromEntries(
    surfaceIds.map((surfaceId) => {
      const cells = result?.surfaceEvidence?.[surfaceId]?.cells;
      if (!cells || typeof cells !== 'object') {
        fail(`surface ${surfaceId} has no viewport cells`);
      }
      return [
        surfaceId,
        Object.fromEntries(
          Object.entries(cells).map(([cellId, cell]) => {
            const screenshot = cell?.evidence?.screenshot;
            if (!screenshot || typeof screenshot !== 'object') {
              fail(`surface ${surfaceId} cell ${cellId} has no screenshot`);
            }
            return [cellId, screenshot];
          }),
        ),
      ];
    }),
  );
}

function selfTest() {
  const screenshots = collectScreenshotRefs(
    {
      surfaceEvidence: {
        'shell.chat-tab': {
          cells: {
            'portrait-normal': {
              evidence: { screenshot: { path: 'chat/portrait.png' } },
            },
            'landscape-normal': {
              evidence: { screenshot: { path: 'chat/landscape.png' } },
            },
          },
        },
      },
    },
    ['shell.chat-tab'],
  );
  if (
    screenshots['shell.chat-tab']['portrait-normal'].path
      !== 'chat/portrait.png'
    || screenshots['shell.chat-tab']['landscape-normal'].path
      !== 'chat/landscape.png'
  ) {
    fail('screenshot projection self-test failed');
  }
  process.stdout.write('PASS: review-mobile-surfaces self-test\n');
}

function loadInventory() {
  const value = JSON.parse(readFileSync(inventoryPath, 'utf8'));
  if (
    value?.schemaVersion !== 1
    || value?.contractId !== 'mobile-whole-product-surface-inventory-v1'
    || typeof value.surfaceSets !== 'object'
  ) {
    fail('surface inventory contract is invalid');
  }
  return value;
}

function requiredSurfaceIds(inventory, surfaceSet) {
  if (surfaceSet === 'all') {
    return Object.values(inventory.surfaceSets)
      .flat()
      .map((entry) => entry.id);
  }
  const entries = inventory.surfaceSets[surfaceSet];
  if (!Array.isArray(entries) || entries.length === 0) {
    fail(`unknown or empty surface set ${surfaceSet}`);
  }
  return entries.map((entry) => entry.id);
}

function runFunctional(surfaceSet, gateId) {
  spawnSync('open', ['-a', 'Simulator'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  const result = spawnSync(
    'python3',
    [
      'tooling/scripts/acceptance-run.py',
      '--execution-policy',
      'development',
      '--gate',
      gateId,
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PT_MOBILE_FOREGROUND_REQUIRED: '1',
        PT_MOBILE_SURFACE_SET: surfaceSet,
      },
      stdio: 'inherit',
    },
  );
  if (result.error) fail(result.error.message);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readLatestResult(gateId) {
  const output = execFileSync(
    'python3',
    [
      'tooling/scripts/acceptance-artifact.py',
      'cat',
      '--gate',
      gateId,
      '--role',
      evidenceRole,
    ],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  return JSON.parse(output);
}

function validateLatest(result, surfaceSet, requireVisualReview) {
  const args = [
    '-m',
    'tooling.acceptance.gates.mobile.simulator_whole_product_usability_e2e',
    '--validate-evidence',
    '--surface-set',
    surfaceSet,
  ];
  if (!requireVisualReview) args.push('--without-visual-review');
  const validation = spawnSync(
    'python3',
    args,
    {
      cwd: repoRoot,
      input: JSON.stringify(result),
      encoding: 'utf8',
    },
  );
  if (validation.error) fail(validation.error.message);
  if (validation.status !== 0) {
    fail(validation.stderr.trim() || 'surface evidence validation failed');
  }
}

function recordReview(surfaceSet) {
  const decision = readFileSync(0, 'utf8').trim();
  if (!decision) fail('visual review decision JSON is required on stdin');
  const recording = spawnSync(
    'python3',
    [
      '-m',
      'tooling.acceptance.gates.mobile.simulator_whole_product_usability_e2e',
      '--record-visual-review',
      '--surface-set',
      surfaceSet,
    ],
    {
      cwd: repoRoot,
      input: decision,
      encoding: 'utf8',
    },
  );
  if (recording.error) fail(recording.error.message);
  if (recording.status !== 0) {
    fail(recording.stderr.trim() || 'visual review recording failed');
  }
  process.stdout.write(recording.stdout);
}

const options = parseArgs(process.argv.slice(2));
if (options.mode === 'self-test') {
  selfTest();
  process.exit(0);
}
const inventory = loadInventory();
const surfaceIds = requiredSurfaceIds(inventory, options.surfaceSet);
if (options.mode === 'record-review') {
  recordReview(options.surfaceSet);
  process.exit(0);
}
const gateId = inventory.functionalGates?.[options.surfaceSet];
if (typeof gateId !== 'string' || !gateId) {
  fail(`surface set ${options.surfaceSet} has no functional Gate`);
}

if (options.mode === 'functional') runFunctional(options.surfaceSet, gateId);
const result = readLatestResult(gateId);
validateLatest(result, options.surfaceSet, false);
if (options.mode === 'review') {
  const screenshots = collectScreenshotRefs(result, surfaceIds);
  process.stdout.write(
    `${JSON.stringify({ surfaceSet: options.surfaceSet, screenshots })}\n`,
  );
  validateLatest(result, options.surfaceSet, true);
}

process.stdout.write(
  `PASS: ${options.surfaceSet} ${options.mode} (${surfaceIds.length} surfaces)\n`,
);
