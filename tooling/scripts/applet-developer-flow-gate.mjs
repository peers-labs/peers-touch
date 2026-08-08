#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const evidenceRoot = path.resolve('.artifacts/applet-readiness');
const packageDir = path.join(evidenceRoot, 'packages/generic-complex-applet');
mkdirSync(path.join(evidenceRoot, 'developer-flow'), { recursive: true });

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error([`Command failed: ${command} ${args.join(' ')}`, result.stdout, result.stderr].join('\n'));
  }
  return result;
}

run('node', ['tooling/scripts/create-generic-complex-applet.mjs', packageDir]);
const fixtureBuild = run('pnpm', ['--dir', packageDir, 'run', 'build']);
const validation = run('pnpm', ['applet:validate', packageDir]);

const manifest = JSON.parse(readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
const source = readFileSync(path.join(packageDir, 'src/main.ts'), 'utf8');
const bundleBytes = readFileSync(path.join(packageDir, manifest.entries.lynx));
const bundleText = bundleBytes.toString('utf8');
const bundleMagic = bundleBytes.subarray(0, 8).toString('ascii');

assert.equal(manifest.bridge.protocol, 'peers-touch.applet.bridge');
assert.deepEqual(manifest.load.desktop, { type: 'lynx-web', entry: 'main.lynx.bundle' });
assert.match(source, /from '@peers-touch\/applet-sdk'/);
for (const sdkCall of [
  'sdk.app.getContext',
  'sdk.app.getLaunchOptions',
  'sdk.events.on',
  'sdk.events.subscribe',
  'sdk.events.unsubscribe',
  'sdk.lifecycle.onShow',
  'sdk.lifecycle.onHide',
  'sdk.lifecycle.onPause',
  'sdk.lifecycle.onResume',
  'sdk.lifecycle.reportReady',
  'sdk.ui.setNavigationBar',
  'sdk.ui.showToast',
  'sdk.device.getSafeArea',
  'sdk.device.getWindowInfo',
  'sdk.device.vibrate',
  'sdk.clipboard.setText',
  'sdk.clipboard.getText',
  'sdk.file.write',
  'sdk.file.read',
  'sdk.file.list',
  'sdk.file.getInfo',
  'sdk.storage.set',
  'sdk.storage.keys',
  'sdk.network.request',
  'sdk.network.upload',
  'sdk.network.download',
  'sdk.skills.register',
  'sdk.tasks.start',
  'sdk.agent.stream',
  'sdk.ai.chat',
  'sdk.telemetry.track',
]) {
  assert.match(source, new RegExp(sdkCall.replaceAll('.', '\\.')));
}
assert.doesNotMatch(source, /StandaloneBridgeAdapter/);
assert.doesNotMatch(source, /applets_action|search_query/);
assert.doesNotMatch(source, /https?:\/\//);
assert.doesNotMatch(source, /\bmock\b/i);
assert.match(source, /taskType:\s*'network'/);
assert.match(source, /taskType:\s*'agent'/);
assert.match(source, /service:\s*'primary-api'/);
assert.match(source, /path:\s*'\/api\/v1\/e2e\/echo'/);
assert.match(source, /sdk\.skills\.invoke/);
assert.match(source, /message:\s*'skill-network'/);
assert.match(source, /executor:\s*\{\s*type:\s*'agent'\s*\}/);
assert.match(source, /message:\s*'skill-agent'/);
assert.match(source, /message:\s*'task-agent'/);

assert.ok(bundleMagic === 'SDRAWROF' || bundleText.trimStart().startsWith('{') || bundleText.includes('"use strict"'));
assert.doesNotMatch(bundleText, /from ['"]@peers-touch\/applet-sdk['"]/);
assert.doesNotMatch(bundleText, /export async function runAppletReadinessFlow/);
assert.doesNotMatch(bundleText, /import\s+\{\s*sdk\s*\}\s+from/);
assert.doesNotMatch(bundleText, /\bmock\b/i);

write('developer-flow/sdk-package-flow-output.txt', [
  'PASS generated developer package includes canonical manifest.json.',
  'PASS generated developer package build script rebuilds main.lynx.bundle.',
  'PASS generated developer source imports @peers-touch/applet-sdk.',
  'PASS generated developer source uses high-level SDK capability APIs.',
  'PASS generated developer source requires Host event bridge callback delivery.',
  'PASS generated developer source uses Gateway-governed network task executor input.',
  'PASS generated developer source uses Gateway-governed agent task executor input.',
  'PASS generated developer source uses Gateway-governed network skill executor input.',
  'PASS generated developer source uses Gateway-governed agent skill executor input.',
  'PASS generated Lynx bundle is a built JavaScript artifact, not raw TypeScript source.',
  'PASS generated developer source avoids legacy applets_action/search_query/raw URL/standalone mock paths.',
  fixtureBuild.stdout,
  validation.stdout,
].join('\n'));

process.stdout.write('PASS applet developer flow gate\n');
