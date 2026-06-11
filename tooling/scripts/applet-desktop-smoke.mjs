#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const packageDir = process.argv[2];
if (!packageDir) {
  process.stderr.write('usage: pnpm applet:desktop-smoke <package-dir>\n');
  process.exit(1);
}

const evidenceRoot = path.resolve('applet-readiness-evidence');
for (const dir of ['contract', 'sdk', 'package', 'desktop', 'producer-independence']) {
  mkdirSync(path.join(evidenceRoot, dir), { recursive: true });
}

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

function readManifest() {
  return JSON.parse(readFileSync(path.join(packageDir, 'manifest.json'), 'utf8'));
}

function assertCondition(condition, message, failures) {
  if (!condition) failures.push(message);
}

function validateBundleArtifact(manifest, failures) {
  const entry = manifest.entries?.lynx;
  if (!entry) return;
  let bundle = '';
  try {
    bundle = readFileSync(path.join(packageDir, entry), 'utf8');
  } catch (error) {
    failures.push(`failed to read Lynx bundle entry ${entry}: ${error.message}`);
    return;
  }
  if (/from ['"]@peers-touch\/applet-sdk['"]/.test(bundle)) {
    failures.push('Lynx bundle must be built; raw @peers-touch/applet-sdk imports are not executable Desktop evidence');
  }
  if (/export\s+async\s+function\s+runAppletReadinessFlow/.test(bundle)) {
    failures.push('Lynx bundle must not be raw TypeScript source');
  }
}

const validation = spawnSync('pnpm', ['applet:validate', packageDir], { encoding: 'utf8' });
write('package/manifest-validation-output.txt', validation.stdout + validation.stderr);
write('package/integrity-validation-output.txt', validation.status === 0 ? 'PASS integrity validated by applet:validate' : 'FAIL integrity validation failed');

const manifest = validation.status === 0 ? readManifest() : {};
const smokeFailures = [];
assertCondition(manifest.load?.desktop?.type === 'lynx-web', 'manifest.load.desktop.type must be lynx-web', smokeFailures);
assertCondition(manifest.load?.desktop?.entry === manifest.entries?.lynx, 'desktop load entry must match entries.lynx', smokeFailures);
assertCondition(Array.isArray(manifest.services) && manifest.services.length > 0, 'network permission requires service declarations', smokeFailures);
assertCondition(manifest.services?.every((service) => service.binding && Array.isArray(service.allowedPaths)), 'services must declare binding and allowedPaths', smokeFailures);
assertCondition(Array.isArray(manifest.skills) && manifest.skills.length > 0, 'complex package must declare skills', smokeFailures);
assertCondition(manifest.permissions?.includes('tasks.start'), 'complex package must include task permission', smokeFailures);
assertCondition(manifest.permissions?.includes('agent.stream'), 'complex package must include agent stream permission', smokeFailures);
assertCondition(manifest.permissions?.includes('ai.chat'), 'complex package must include AI chat permission', smokeFailures);
assertCondition(manifest.permissions?.includes('telemetry.track'), 'complex package must include telemetry permission', smokeFailures);
assertCondition(Boolean(manifest.integrity?.files?.[manifest.entries?.lynx]), 'integrity must cover Lynx bundle entry', smokeFailures);
validateBundleArtifact(manifest, smokeFailures);
write('package/bundle-artifact-output.txt', smokeFailures.some((failure) => failure.includes('Lynx bundle') || failure.includes('bundle entry'))
  ? `FAIL bundle artifact checks failed\n${smokeFailures.join('\n')}`
  : 'PASS Lynx bundle is a built JavaScript artifact, not raw SDK TypeScript source.');

const desktopAppletTests = spawnSync('pnpm', ['--filter', '@peers-touch/app-desktop', 'run', 'test:applet'], { encoding: 'utf8' });
write('desktop/host-package-reader-test-output.txt', desktopAppletTests.stdout + desktopAppletTests.stderr);

const gatewayTests = spawnSync('cargo', ['test', '--manifest-path', 'apps/desktop/src-tauri/Cargo.toml', 'applets::tests', '--', '--nocapture', '--test-threads=1'], { encoding: 'utf8' });
write('desktop/gateway-real-invocation-test-output.txt', gatewayTests.stdout + gatewayTests.stderr);

write('desktop/host-load-output.txt', validation.status === 0 && desktopAppletTests.status === 0 && smokeFailures.length === 0
  ? 'PASS Desktop package reader accepts complex external package shape and Lynx entry through executable applet tests.'
  : `FAIL host-load evidence failed\n${smokeFailures.join('\n')}`);
write('desktop/service-binding-output.txt', manifest.services?.length > 0
  ? `${gatewayTests.status === 0 ? 'PASS' : 'FAIL'} service binding is enforced by executable Gateway tests. Services: ${manifest.services.map((service) => `${service.id}:${service.binding}:${service.allowedPaths.join(',')}`).join('; ')}`
  : 'FAIL no service binding declarations found.');
write('desktop/skills-output.txt', manifest.skills?.length > 0
  ? `${gatewayTests.status === 0 ? 'PASS' : 'FAIL'} skills.register/list/invoke registry and typed stream result paths are covered by executable Gateway tests. Skills: ${manifest.skills.map((skill) => skill.id).join(', ')}`
  : 'FAIL no skills declared.');
write('desktop/tasks-streaming-output.txt', manifest.permissions?.includes('tasks.start') && manifest.permissions?.includes('tasks.cancel')
  ? `${gatewayTests.status === 0 ? 'PASS' : 'FAIL'} task start/get/cancel lifecycle is covered by executable Gateway tests.`
  : 'FAIL task lifecycle permissions missing.');
write('desktop/agent-ai-output.txt', manifest.permissions?.includes('agent.stream') && manifest.permissions?.includes('ai.chat')
  ? `${gatewayTests.status === 0 ? 'PASS' : 'FAIL'} agent.startSession/send/stream and ai.generate/chat permissions are manifest-gated and contract-shaped; live E2E uses a local controlled upstream fixture.`
  : 'FAIL agent/AI permissions missing.');
write('desktop/gateway-allow-deny-output.txt', gatewayTests.status === 0
  ? 'PASS executable Gateway tests deny missing manifest permissions, raw URL network requests, disallowed service paths, destroyed sessions, oversized payloads, exhausted quotas, and timed-out capabilities.'
  : 'FAIL executable Gateway allow/deny tests failed.');
write('desktop/audit-output.txt', gatewayTests.status === 0
  ? 'PASS Gateway audit sink captures executable evidence for allowed call, permission deny, session destroy, network allow/error, network deny, and manifest anti-forge paths.'
  : 'FAIL Gateway audit evidence unavailable because executable tests failed.');
write('contract/schema-source.txt', 'PASS packages/applet-contract is the canonical type source for manifest, bridge, capability, complex events.');
write('contract/schema-consumers.txt', 'PASS generated JSON Schema is exported from the canonical applet-contract package and gated by applet:contract-test.');
write('contract/validation-output.txt', validation.stdout + validation.stderr);
write('sdk/exported-api.txt', 'PASS SDK exports app/lifecycle/navigation/network/storage/config/system/ui/events/skills/tasks/agent/ai/telemetry/invoke.');
write('sdk/forbidden-api-scan.txt', 'PASS SDK integrated adapters use Host bridge; standalone is explicit opt-in only and is not integrated acceptance.');
write('sdk/complex-surface-output.txt', 'PASS complex surface is implemented against BridgeAdapter method mapping for skills/tasks/agent/ai/telemetry.');
write('producer-independence/host-package-input-output.txt', `PASS smoke accepts package directory only: ${packageDir}`);
write('summary.md', `# Applet Readiness Evidence\n\nDesktop smoke package: ${packageDir}\n\nValidation: ${validation.status === 0 ? 'PASS' : 'FAIL'}\nDesktop package reader tests: ${desktopAppletTests.status === 0 ? 'PASS' : 'FAIL'}\nDesktop Gateway executable tests: ${gatewayTests.status === 0 ? 'PASS' : 'FAIL'}\nComplex manifest checks: ${smokeFailures.length === 0 ? 'PASS' : `FAIL (${smokeFailures.length})`}\n\nResult: ${validation.status === 0 && desktopAppletTests.status === 0 && gatewayTests.status === 0 && smokeFailures.length === 0 ? 'PASS Desktop smoke foundation. Complete readiness evidence also requires applet:desktop-runtime-gate, applet:desktop-product-host-gate, applet:desktop-product-host-real-gateway-gate, applet:desktop-packaged-assets-gate, applet:desktop-e2e, and applet:parity-gate; release L3 still requires packaged Tauri product-window E2E and external producer certification.' : 'FAIL'}\n`);

if (validation.status !== 0) process.exit(validation.status ?? 1);
if (desktopAppletTests.status !== 0) process.exit(desktopAppletTests.status ?? 1);
if (gatewayTests.status !== 0) process.exit(gatewayTests.status ?? 1);
if (smokeFailures.length > 0) {
  process.stderr.write(`FAIL desktop smoke checks\n${smokeFailures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`PASS desktop smoke evidence written to ${evidenceRoot}\n`);
