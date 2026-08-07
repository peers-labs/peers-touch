#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const stationAppDir = path.join(repoRoot, 'apps', 'station', 'app');
const evidenceDir = path.join(repoRoot, 'tooling/acceptance/evidence/applets', 'station-backed-launch');
const storeDir = path.join(repoRoot, '.artifacts', 'applet-readiness', 'station-store');
const dbPath = path.join(storeDir, 'store.sqlite');
const storagePath = path.join(storeDir, 'bundles');

const targets = [
  {
    label: 'third-party',
    appletId: 'big-a',
    channel: 'dev',
    packageDir: path.join(repoRoot, 'apps', 'desktop', 'applets-dist', 'big-a'),
  },
  {
    label: 'internal',
    appletId: 'peers.note',
    channel: 'dev',
    packageDir: path.join(repoRoot, 'apps', 'desktop', 'applets-dist', 'peers.note'),
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    env: { ...process.env, ...(options.env ?? {}) },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return result;
}

function runStoreCli(args) {
  return run('go', [
    'run',
    './subserver/applet_store/cmd/store_cli',
    '--repo-root',
    repoRoot,
    '--db',
    dbPath,
    '--storage',
    storagePath,
    ...args,
  ], { cwd: stationAppDir });
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function sha256(file) {
  return `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyPackageMaterialization(target) {
  const manifest = readJson(path.join(target.packageDir, 'manifest.json'));
  assert(manifest.id === target.appletId, `${target.label} manifest id must be ${target.appletId}`);
  const files = manifest.integrity?.files ?? {};
  assert(Object.keys(files).length > 0, `${target.appletId} must declare integrity files`);

  for (const [relativePath, expected] of Object.entries(files)) {
    const sourcePath = path.join(target.packageDir, relativePath);
    const storedPath = path.join(storagePath, target.appletId, manifest.version, relativePath);
    assert(existsSync(sourcePath), `${target.appletId} source asset missing: ${relativePath}`);
    assert(existsSync(storedPath), `${target.appletId} stored asset missing: ${relativePath}`);
    assert(sha256(sourcePath) === expected, `${target.appletId} source asset digest mismatch: ${relativePath}`);
    assert(sha256(storedPath) === expected, `${target.appletId} stored asset digest mismatch: ${relativePath}`);
  }

  return {
    appletId: target.appletId,
    version: manifest.version,
    assetCount: Object.keys(files).length,
    entry: manifest.load?.desktop?.entry ?? manifest.entries?.lynx,
  };
}

function main() {
  mkdirSync(evidenceDir, { recursive: true });
  rmSync(storeDir, { recursive: true, force: true });
  mkdirSync(storeDir, { recursive: true });

  run('pnpm', ['applets:build'], {
    env: {
      PEERS_TOUCH_EXTERNAL_LYNX_APPLETS: path.resolve(repoRoot, '../my-peers-applets/applets'),
    },
  });

  const results = [];
  for (const target of targets) {
    assert(existsSync(path.join(target.packageDir, 'manifest.json')), `${target.appletId} package must exist`);
    const publish = runStoreCli(['publish', '--channel', target.channel, '--owner', target.label, target.packageDir]);
    const install = runStoreCli(['install', '--channel', target.channel, '--actor', `${target.label}-actor`, '--device', 'desktop-gate', target.appletId]);
    const materialized = verifyPackageMaterialization(target);
    results.push({
      ...materialized,
      label: target.label,
      publish: JSON.parse(publish.stdout),
      install: JSON.parse(install.stdout),
    });
  }

  const markdown = [
    '# Station-backed Launch Gate',
    '',
    '> Evidence class: CONTROLLED_LOCAL_UPSTREAM',
    '> Third-party validation applet: `big-a`',
    '> Internal validation applet: `peers.note`',
    '',
    '## Checks',
    '',
    ...results.flatMap((item) => [
      `- ${item.label} \`${item.appletId}\`: PASS`,
      `- ${item.label} \`${item.appletId}\` version: \`${item.version}\``,
      `- ${item.label} \`${item.appletId}\` entry: \`${item.entry}\``,
      `- ${item.label} \`${item.appletId}\` stored assets: ${item.assetCount}`,
      `- ${item.label} \`${item.appletId}\` install status: \`${item.install.state?.status ?? 'unknown'}\``,
    ]),
    '',
    '## Scope',
    '',
    '- Publishes packages through Station Store typed publish.',
    '- Installs packages through Station Store install state.',
    '- Verifies every manifest integrity file is saved in Store bundle storage.',
    '- Uses `big-a` for third-party validation and `peers.note` for internal validation.',
    '',
    '## Not Covered',
    '',
    '- This gate does not start the full Desktop product window.',
    '- Gateway policy runtime enforcement and audit flush are separate gates.',
    '- Evidence remains local controlled upstream, not a live authenticated Station deployment.',
  ].join('\n');

  writeFileSync(path.join(evidenceDir, 'station-backed-launch-gate.json'), `${JSON.stringify({ status: 'PASS', results }, null, 2)}\n`);
  writeFileSync(path.join(evidenceDir, 'station-backed-launch-gate.md'), `${markdown}\n`);
  process.stdout.write(`PASS station-backed launch gate evidence written to ${path.relative(repoRoot, evidenceDir)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`FAIL ${error.message}\n`);
  process.exit(1);
}
