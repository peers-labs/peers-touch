#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const rootDir = process.cwd();
const evidenceRoot = path.resolve('.artifacts/applet-readiness');
const evidenceDir = path.join(evidenceRoot, 'external-producer');
const outputPath = path.join(evidenceDir, 'certification-output.txt');
const allowRepoPackage = process.argv.includes('--allow-repo-package');
const productAppMode = process.argv.includes('--product-app');
const expectTextArg = process.argv.find((arg) => arg.startsWith('--expect-text='));
const packageArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const productGateArgs = productAppMode
  ? ['--product-app', expectTextArg].filter(Boolean)
  : [];

mkdirSync(evidenceDir, { recursive: true });

function writeOutput(lines) {
  writeFileSync(outputPath, `${lines.filter(Boolean).join('\n')}\n`);
}

function fail(message, details = []) {
  const output = ['FAIL external producer applet certification', message, ...details];
  writeOutput(output);
  process.stderr.write(`${output.join('\n')}\n`);
  process.exit(1);
}

function runStep(label, command, args) {
  process.stdout.write(`[external-certification] ${label}\n`);
  const startedAt = new Date().toISOString();
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return {
    label,
    command: [command, ...args].join(' '),
    startedAt,
    finishedAt: new Date().toISOString(),
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function isInsideRoot(candidate) {
  const relative = path.relative(rootDir, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

if (!packageArg) {
  fail('usage: pnpm applet:external-producer-certification-gate <external-package-dir> [--allow-repo-package]');
}

const packageDir = path.resolve(packageArg);
if (!existsSync(packageDir)) {
  fail(`package directory does not exist: ${packageDir}`);
}
const manifestPath = path.join(packageDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  fail(`external package manifest is missing: ${manifestPath}`);
}
if (!allowRepoPackage && isInsideRoot(packageDir)) {
  fail(
    'external certification requires a package directory outside this repository',
    [
      `Package: ${packageDir}`,
      'Use --allow-repo-package only for local dry-runs; such runs must not be reported as independent external producer certification.',
    ],
  );
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (typeof manifest.id !== 'string' || !manifest.id.trim()) {
  fail('external package manifest.id must be a non-empty string');
}
if (manifest.id === 'generic-complex-applet') {
  fail('external certification package must not use the generic fixture applet id');
}
if (!manifest.load?.desktop || manifest.load.desktop.type !== 'lynx-web') {
  fail('external certification package must target Desktop with load.desktop.type = lynx-web');
}

const steps = [
  ['Validate canonical package', 'pnpm', ['applet:validate', packageDir]],
  ['Desktop Lynx runtime gate', 'pnpm', ['applet:desktop-runtime-gate', packageDir, ...productGateArgs]],
  ['Desktop product Host gate', 'pnpm', ['applet:desktop-product-host-gate', packageDir, ...productGateArgs]],
  ['Desktop product Host real Gateway gate', 'pnpm', ['applet:desktop-product-host-real-gateway-gate', packageDir, ...productGateArgs]],
  ['Desktop product shell real Gateway gate', 'pnpm', ['applet:desktop-product-shell-real-gateway-gate', packageDir, ...productGateArgs]],
  ['Packaged product-window gate', 'node', ['tooling/scripts/applet-desktop-product-window-gate.mjs', packageDir, ...productGateArgs]],
  ['Desktop live E2E gate', 'pnpm', ['applet:desktop-e2e', packageDir]],
];

const results = [];
for (const [label, command, args] of steps) {
  const result = runStep(label, command, args);
  results.push(result);
  if (result.status !== 0) break;
}

const failed = results.find((result) => result.status !== 0);
const output = [
  failed ? 'FAIL external producer applet certification' : 'PASS external producer applet certification',
  `Package: ${packageDir}`,
  `Manifest id: ${manifest.id}`,
  `Product app mode: ${productAppMode ? 'enabled' : 'disabled'}`,
  expectTextArg ? `Expected product text: ${expectTextArg.slice('--expect-text='.length)}` : '',
  `Independent package path: ${allowRepoPackage ? 'NOT ENFORCED (--allow-repo-package)' : 'enforced outside repository'}`,
  ...results.flatMap((result) => [
    '',
    `Step: ${result.label}`,
    `Command: ${result.command}`,
    `Started: ${result.startedAt}`,
    `Finished: ${result.finishedAt}`,
    `Status: ${result.status === 0 ? 'PASS' : 'FAIL'}`,
    result.stdout ? `stdout:\n${result.stdout.trim()}` : '',
    result.stderr ? `stderr:\n${result.stderr.trim()}` : '',
  ]),
];
writeOutput(output);

if (failed) {
  process.stderr.write(`FAIL external producer applet certification; evidence: ${outputPath}\n`);
  process.exit(failed.status);
}

process.stdout.write(`PASS external producer applet certification; evidence: ${outputPath}\n`);
