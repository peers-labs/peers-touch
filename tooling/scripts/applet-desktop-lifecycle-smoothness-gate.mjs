#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const evidenceDir = path.join(repoRoot, 'applet-readiness-evidence', 'desktop', 'lifecycle-smoothness-gate');
const evidenceJsonPath = path.join(evidenceDir, 'lifecycle-smoothness-gate.json');
const evidenceMdPath = path.join(evidenceDir, 'lifecycle-smoothness-gate.md');
const outputPath = path.join(repoRoot, 'applet-readiness-evidence', 'desktop', 'lifecycle-smoothness-gate-output.txt');

function read(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function assertCheck(checks, id, passed, message) {
  checks.push({ id, status: passed ? 'PASS' : 'FAIL', message });
  if (!passed) throw new Error(`${id}: ${message}`);
}

function run(command, args) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
}

function main() {
  mkdirSync(evidenceDir, { recursive: true });

  const checks = [];
  const pageRuntimeLease = read('apps/desktop/src/kernel/pageRuntimeLease.ts');
  const appletRuntimePage = read('apps/desktop/src/pages/AppletRuntimePage.tsx');
  const appletsPage = read('apps/desktop/src/pages/AppletsPage.tsx');
  const pageRuntimeLeaseTest = read('apps/desktop/src/kernel/pageRuntimeLease.test.ts');
  const appletsRuntimeTest = read('apps/desktop/src/runtimes/appletsRuntime.test.ts');

  assertCheck(
    checks,
    'explicit-close-release-deferred',
    pageRuntimeLease.includes('requestAnimationFrame(run)') && pageRuntimeLease.includes('setTimeout(run, 0)'),
    '`requestPageRuntimeRelease` must defer explicit close release until after the navigation frame.',
  );
  assertCheck(
    checks,
    'close-navigates-before-release',
    /navigation\.navigateTo\('applets'\);[\s\S]*requestPageRuntimeRelease\(pageId, 'explicit-close'\)/.test(appletRuntimePage),
    '`AppletRuntimePage` close must navigate home before requesting runtime release.',
  );
  assertCheck(
    checks,
    'launcher-refresh-keeps-content',
    appletsPage.includes('loading && applets.length === 0'),
    '`AppletsPage` must only show fullscreen loading during empty initial load, not refresh/wakeup with existing content.',
  );
  assertCheck(
    checks,
    'page-lease-test-covers-defer',
    pageRuntimeLeaseTest.includes("requestPageRuntimeRelease('applet:peers.note', 'explicit-close')")
      && pageRuntimeLeaseTest.includes("not.toHaveBeenCalledWith('applet:peers.note', 'explicit-close')"),
    '`pageRuntimeLease.test.ts` must assert explicit close release is deferred.',
  );
  assertCheck(
    checks,
    'runtime-test-covers-switch-lru',
    appletsRuntimeTest.includes('keeps the previous LRU applet alive while switching to another applet page')
      && appletsRuntimeTest.includes("releasePage?.('applet:generic-complex-applet', 'explicit-close')")
      && appletsRuntimeTest.includes("releasePage?.('applet:peers.note', 'evict')"),
    '`appletsRuntime.test.ts` must cover A->B switch, close B, and evict A lease semantics.',
  );

  const vitest = run('pnpm', [
    '--dir',
    'apps/desktop',
    'exec',
    'vitest',
    'run',
    'src/kernel/pageRuntimeLease.test.ts',
    'src/runtimes/appletsRuntime.test.ts',
  ]);
  assertCheck(
    checks,
    'desktop-lifecycle-vitest',
    vitest.status === 0,
    'Targeted Desktop runtime lease tests must pass.',
  );

  const evidence = {
    status: 'PASS',
    evidenceClass: 'LOCAL_ACCEPTANCE_GATE',
    gate: 'applet-desktop-lifecycle-smoothness',
    checks,
    commands: [{
      command: 'pnpm --dir apps/desktop exec vitest run src/kernel/pageRuntimeLease.test.ts src/runtimes/appletsRuntime.test.ts',
      status: vitest.status === 0 ? 'PASS' : 'FAIL',
    }],
    provenScope: [
      'A->B applet runtime switch acquires the second applet without releasing the previous LRU applet.',
      'Explicit close releases only the closed applet page after navigation has already moved to launcher.',
      'LRU eviction remains the release path for the previous hidden applet.',
      'Launcher wakeup/refresh with existing applets does not fall back to fullscreen loading.',
    ],
    unprovenScope: [
      'This local acceptance gate is not a packaged Desktop product-window browser E2E.',
      'Full visual A->B switching with two installed applet cards still requires a product-window harness with two catalog entries.',
    ],
  };

  const markdown = [
    '# Applet Desktop Lifecycle Smoothness Gate',
    '',
    '> Evidence class: LOCAL_ACCEPTANCE_GATE',
    '> Gate: `applet-desktop-lifecycle-smoothness`',
    '',
    '## Checks',
    '',
    ...checks.map((check) => `- ${check.id}: ${check.status}`),
    '',
    '## Proven Scope',
    '',
    ...evidence.provenScope.map((item) => `- ${item}`),
    '',
    '## Not Proven',
    '',
    ...evidence.unprovenScope.map((item) => `- ${item}`),
  ].join('\n');

  writeFileSync(evidenceJsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
  writeFileSync(evidenceMdPath, `${markdown}\n`);
  const output = [
    'PASS Applet Desktop lifecycle smoothness gate',
    `Evidence: ${path.relative(repoRoot, evidenceJsonPath)}`,
    `Markdown: ${path.relative(repoRoot, evidenceMdPath)}`,
    vitest.stdout.trim(),
    vitest.stderr.trim(),
  ].filter(Boolean).join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stdout.write(`${output}\n`);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const output = [
    'FAIL Applet Desktop lifecycle smoothness gate',
    message,
  ].join('\n');
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${output}\n`);
  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
}
