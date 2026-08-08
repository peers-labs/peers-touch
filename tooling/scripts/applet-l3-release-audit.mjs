#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  appletArtifactRoot,
  appletEvidenceRoot,
  appletFixtureRoot,
} from './lib/applet-readiness-paths.mjs';

const rootDir = process.cwd();
const outputDir = path.join(appletArtifactRoot, 'release');
const outputPath = path.join(outputDir, 'l3-readiness-audit-output.txt');
const candidateOnly = process.argv.includes('--candidate-only');

mkdirSync(outputDir, { recursive: true });

function readEvidence(relativePath) {
  const absolutePath = path.join(appletArtifactRoot, relativePath);
  if (!relativePath || !existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
    return { absolutePath, content: null };
  }
  return { absolutePath, content: readFileSync(absolutePath, 'utf8') };
}

function hasAll(content, patterns) {
  return patterns.every((pattern) => pattern.test(content));
}

function hasNone(content, patterns) {
  return patterns.every((pattern) => !pattern.test(content));
}

function evidenceCheck({ name, path: relativePath, required = [], forbidden = [] }) {
  const evidence = readEvidence(relativePath);
  if (!evidence.content) {
    return {
      name,
      status: 'FAIL',
      evidence: relativePath,
      detail: `Missing evidence file: ${relativePath}`,
    };
  }
  if (!hasAll(evidence.content, required)) {
    return {
      name,
      status: 'FAIL',
      evidence: relativePath,
      detail: `Evidence file does not contain all required markers: ${required.map((item) => item.source).join(', ')}`,
    };
  }
  if (!hasNone(evidence.content, forbidden)) {
    return {
      name,
      status: 'FAIL',
      evidence: relativePath,
      detail: `Evidence file contains forbidden marker: ${forbidden.map((item) => item.source).join(', ')}`,
    };
  }
  return {
    name,
    status: 'PASS',
    evidence: relativePath,
    detail: 'Evidence markers are present.',
  };
}

function readJsonEvidence(relativePath) {
  const absolutePath = path.join(appletEvidenceRoot, relativePath);
  const evidence =
    relativePath && existsSync(absolutePath) && statSync(absolutePath).isFile()
      ? { absolutePath, content: readFileSync(absolutePath, 'utf8') }
      : { absolutePath, content: null };
  if (!evidence.content) {
    return { error: `Missing evidence file: ${relativePath}` };
  }
  try {
    return { data: JSON.parse(evidence.content) };
  } catch (error) {
    return { error: `Invalid JSON in ${relativePath}: ${error.message}` };
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseCanonicalTimestamp(value, label, failures) {
  if (!isNonEmptyString(value)) {
    failures.push(`${label} is required`);
    return null;
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || new Date(timestamp).toISOString() !== value) {
    failures.push(`${label} must be a canonical UTC ISO-8601 timestamp, for example 2026-06-09T00:00:00.000Z`);
    return null;
  }
  if (timestamp > Date.now() + 5 * 60 * 1000) {
    failures.push(`${label} must not be in the future`);
    return null;
  }
  return timestamp;
}

function isInsideRoot(candidate) {
  const relative = path.relative(rootDir, candidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function extractEvidenceLine(content, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^${escaped}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() ?? '';
}

function readJsonFile(filePath) {
  try {
    return { data: JSON.parse(readFileSync(filePath, 'utf8')) };
  } catch (error) {
    return { error: `Invalid JSON in ${filePath}: ${error.message}` };
  }
}

function isWithin(candidate, root) {
  const relative = path.relative(root, path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function containsText(content, needle) {
  return isNonEmptyString(needle) && content.toLowerCase().includes(needle.toLowerCase());
}

function isKnownSyntheticCertificationPackage(packagePath, manifest) {
  const syntheticAppletIds = new Set([
    'android-lynx-runtime-e2e-applet',
    'external-l3-cert-applet',
    'generic-complex-applet',
    'ios-lynx-runtime-e2e-applet',
    'mobile-native-certification-applet',
    'production-web-host-certification-applet',
    'web-host-certification-applet',
  ]);
  const syntheticBasenames = new Set([
    'android-lynx-runtime-e2e-applet',
    'external-certification-applet',
    'generic-complex-applet',
    'ios-lynx-runtime-e2e-applet',
    'mobile-native-certification-applet',
    'peers-touch-external-l3-cert',
    'production-web-host-certification-applet',
    'web-host-certification-applet',
  ]);
  return (
    syntheticAppletIds.has(manifest?.id) ||
    syntheticBasenames.has(path.basename(packagePath)) ||
    isWithin(packagePath, appletFixtureRoot) ||
    isWithin(packagePath, appletArtifactRoot)
  );
}

function newestMtimeMs(dir) {
  if (!existsSync(dir)) return 0;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtimeMs(absolute));
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(absolute).mtimeMs);
    }
  }
  return newest;
}

function newestInputMtimeMs(inputs, failures) {
  let newest = 0;
  for (const input of inputs) {
    const absolute = path.resolve(input);
    if (!existsSync(absolute)) {
      failures.push(`platform check input is missing: ${input}`);
      continue;
    }
    const stat = statSync(absolute);
    newest = Math.max(newest, stat.isDirectory() ? newestMtimeMs(absolute) : stat.mtimeMs);
  }
  return newest;
}

function currentPlatformCheckFreshnessCheck() {
  const evidence = readEvidence('checks/platform-check-output.txt');
  const failures = [];
  if (!evidence.content) {
    failures.push('Missing evidence file: checks/platform-check-output.txt');
  }
  const relevantInputs = [
    'package.json',
    'packages/applet-sdk/package.json',
    'packages/applet-sdk/tsconfig.json',
    'packages/applet-sdk/src',
    'apps/desktop/package.json',
    'apps/desktop/tsconfig.json',
    'apps/desktop/src',
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.lock',
    'apps/desktop/src-tauri/src',
    'apps/mobile/package.json',
    'apps/mobile/tsconfig.json',
    'apps/mobile/src',
    'apps/mobile/src-tauri/Cargo.toml',
    'apps/mobile/src-tauri/Cargo.lock',
    'apps/mobile/src-tauri/src',
  ];
  const newestInput = newestInputMtimeMs(relevantInputs, failures);
  if (evidence.content && newestInput > statSync(evidence.absolutePath).mtimeMs + 1000) {
    failures.push(`platform check evidence is older than relevant source inputs: evidence ${new Date(statSync(evidence.absolutePath).mtimeMs).toISOString()}, source newest ${new Date(newestInput).toISOString()}`);
  }
  return {
    name: 'Platform check current source freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'checks/platform-check-output.txt',
    detail:
      failures.length === 0
        ? 'Platform check evidence is current relative to SDK, Desktop, and Mobile source inputs.'
        : failures.join('; '),
  };
}

function currentSdkAdapterFreshnessCheck() {
  const evidence = readEvidence('sdk/adapter-test-output.txt');
  const failures = [];
  if (!evidence.content) {
    failures.push('Missing evidence file: sdk/adapter-test-output.txt');
  }
  const relevantInputs = [
    'packages/applet-contract/package.json',
    'packages/applet-contract/tsconfig.json',
    'packages/applet-contract/src',
    'packages/applet-sdk/package.json',
    'packages/applet-sdk/tsconfig.json',
    'packages/applet-sdk/src',
    'tooling/scripts/applet-sdk-adapter-test.mjs',
  ];
  const newestInput = newestInputMtimeMs(relevantInputs, failures);
  if (evidence.content && newestInput > statSync(evidence.absolutePath).mtimeMs + 1000) {
    failures.push(`SDK adapter evidence is older than relevant SDK inputs: evidence ${new Date(statSync(evidence.absolutePath).mtimeMs).toISOString()}, source newest ${new Date(newestInput).toISOString()}`);
  }
  return {
    name: 'SDK adapter current source freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'sdk/adapter-test-output.txt',
    detail:
      failures.length === 0
        ? 'SDK adapter evidence is current relative to contract, SDK, and adapter-test source inputs.'
        : failures.join('; '),
  };
}

function currentDeveloperFlowFreshnessCheck() {
  const evidence = readEvidence('developer-flow/sdk-package-flow-output.txt');
  const failures = [];
  if (!evidence.content) {
    failures.push('Missing evidence file: developer-flow/sdk-package-flow-output.txt');
  }
  const relevantInputs = [
    'packages/applet-contract/package.json',
    'packages/applet-contract/tsconfig.json',
    'packages/applet-contract/src',
    'packages/applet-sdk/package.json',
    'packages/applet-sdk/tsconfig.json',
    'packages/applet-sdk/src',
    'tooling/scripts/applet-developer-flow-gate.mjs',
    'tooling/scripts/create-generic-complex-applet.mjs',
    'tooling/fixtures/applets/packages/generic-complex-applet',
  ];
  const newestInput = newestInputMtimeMs(relevantInputs, failures);
  if (evidence.content && newestInput > statSync(evidence.absolutePath).mtimeMs + 1000) {
    failures.push(`developer-flow evidence is older than relevant SDK/package inputs: evidence ${new Date(statSync(evidence.absolutePath).mtimeMs).toISOString()}, source newest ${new Date(newestInput).toISOString()}`);
  }
  return {
    name: 'Developer SDK package flow current source freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'developer-flow/sdk-package-flow-output.txt',
    detail:
      failures.length === 0
        ? 'Developer SDK package flow evidence is current relative to contract, SDK, generator, and generated package inputs.'
        : failures.join('; '),
  };
}

function currentWebHostRuntimeFreshnessCheck() {
  const evidence = readEvidence('web/web-host-runtime-gate-output.txt');
  const failures = [];
  if (!evidence.content) {
    failures.push('Missing evidence file: web/web-host-runtime-gate-output.txt');
  }
  const relevantInputs = [
    'packages/applet-contract/package.json',
    'packages/applet-contract/tsconfig.json',
    'packages/applet-contract/src',
    'packages/applet-sdk/package.json',
    'packages/applet-sdk/tsconfig.json',
    'packages/applet-sdk/src',
    'tooling/scripts/applet-web-host-runtime-gate.mjs',
    'tooling/fixtures/applets/packages/web-host-certification-applet',
  ];
  const newestInput = newestInputMtimeMs(relevantInputs, failures);
  if (evidence.content && newestInput > statSync(evidence.absolutePath).mtimeMs + 1000) {
    failures.push(`Web Host runtime evidence is older than relevant Web Host inputs: evidence ${new Date(statSync(evidence.absolutePath).mtimeMs).toISOString()}, source newest ${new Date(newestInput).toISOString()}`);
  }
  return {
    name: 'Web Host runtime current source freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'web/web-host-runtime-gate-output.txt',
    detail:
      failures.length === 0
        ? 'Web Host runtime evidence is current relative to contract, SDK, gate, and generated package inputs.'
        : failures.join('; '),
  };
}

function currentProductionWebHostFreshnessCheck() {
  const evidence = readEvidence('web/production-web-host-runtime-output.txt');
  const failures = [];
  if (!evidence.content) {
    failures.push('Missing evidence file: web/production-web-host-runtime-output.txt');
  }
  const relevantInputs = [
    'packages/applet-contract/package.json',
    'packages/applet-contract/tsconfig.json',
    'packages/applet-contract/src',
    'packages/applet-sdk/package.json',
    'packages/applet-sdk/tsconfig.json',
    'packages/applet-sdk/src',
    'tooling/scripts/applet-production-web-host-gate.mjs',
    'tooling/fixtures/applets/packages/production-web-host-certification-applet',
  ];
  const newestInput = newestInputMtimeMs(relevantInputs, failures);
  if (evidence.content && newestInput > statSync(evidence.absolutePath).mtimeMs + 1000) {
    failures.push(`Production Web Host evidence is older than relevant production Web Host inputs: evidence ${new Date(statSync(evidence.absolutePath).mtimeMs).toISOString()}, source newest ${new Date(newestInput).toISOString()}`);
  }
  return {
    name: 'Production Web Host shell current source freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'web/production-web-host-runtime-output.txt',
    detail:
      failures.length === 0
        ? 'Production Web Host shell evidence is current relative to contract, SDK, gate, and generated package inputs.'
        : failures.join('; '),
  };
}

function currentMobileWebParityFreshnessCheck() {
  return {
    name: 'Mobile native plugin parity evidence',
    status: 'FAIL',
    evidence: 'NOT_IMPLEMENTED',
    detail: 'Old standalone Android/iOS parity gate was removed. Rebuild parity evidence against the Tauri Mobile native plugin host before claiming Mobile parity.',
  };
}

function currentMobileNativeManifestFreshnessCheck() {
  return {
    name: 'Mobile native manifest Tauri plugin evidence',
    status: 'FAIL',
    evidence: 'NOT_IMPLEMENTED',
    detail: 'Old standalone mobile native manifest gate was removed. Rebuild this gate against the Tauri Mobile native plugin target.',
  };
}

function currentAndroidRuntimeE2eFreshnessCheck() {
  return {
    name: 'Android Tauri plugin Lynx runtime E2E',
    status: 'FAIL',
    evidence: 'NOT_IMPLEMENTED',
    detail: 'Old standalone Android Lynx runtime E2E was removed. Rebuild against Tauri Android app/plugin before claiming Android runtime readiness.',
  };
}

function currentIosRuntimeE2eFreshnessCheck() {
  return {
    name: 'iOS Tauri plugin Lynx runtime E2E',
    status: 'FAIL',
    evidence: 'NOT_IMPLEMENTED',
    detail: 'Old standalone iOS Lynx runtime E2E was removed. Rebuild against Tauri iOS app/plugin before claiming iOS runtime readiness.',
  };
}

function findMacAppExecutable() {
  const macosDir = path.resolve('apps/desktop/src-tauri/target/release/bundle/macos');
  if (!existsSync(macosDir)) return '';
  const appDir = readdirSync(macosDir)
    .filter((entry) => entry.endsWith('.app'))
    .map((entry) => path.join(macosDir, entry))[0];
  if (!appDir) return '';
  const executableDir = path.join(appDir, 'Contents', 'MacOS');
  if (!existsSync(executableDir)) return '';
  return readdirSync(executableDir)
    .map((entry) => path.join(executableDir, entry))
    .filter((entryPath) => (statSync(entryPath).mode & 0o111) !== 0)[0] ?? '';
}

function currentDesktopPackagedAssetsCheck() {
  const sourceAppletRoot = path.resolve('apps/desktop/applets-dist');
  const distAppletRoot = path.resolve('apps/desktop/dist/applets-dist');
  const sourceIndexPath = path.join(sourceAppletRoot, 'index.json');
  const distIndexPath = path.join(distAppletRoot, 'index.json');
  const failures = [];
  if (!existsSync(sourceIndexPath)) failures.push('source applets-dist/index.json is missing');
  if (!existsSync(distIndexPath)) failures.push('Desktop dist applets-dist/index.json is missing');
  if (existsSync(sourceIndexPath) && existsSync(distIndexPath)) {
    const sourceIndex = readJsonFile(sourceIndexPath);
    const distIndex = readJsonFile(distIndexPath);
    if (sourceIndex.error) failures.push(sourceIndex.error);
    if (distIndex.error) failures.push(distIndex.error);
    if (sourceIndex.data && distIndex.data && JSON.stringify(sourceIndex.data.applets) !== JSON.stringify(distIndex.data.applets)) {
      failures.push('Desktop dist applet index differs from source applets-dist index');
    }
  }
  const sourceNewest = newestMtimeMs(sourceAppletRoot);
  const distNewest = newestMtimeMs(distAppletRoot);
  if (sourceNewest > distNewest + 1000) {
    failures.push(`Desktop dist applet assets are stale: source newest ${new Date(sourceNewest).toISOString()}, dist newest ${new Date(distNewest).toISOString()}`);
  }
  return {
    name: 'Desktop packaged assets current filesystem freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: 'apps/desktop/dist/applets-dist',
    detail: failures.length === 0 ? 'Desktop dist applet assets match current source applets-dist.' : failures.join('; '),
  };
}

function currentTauriBundleFreshnessCheck() {
  const executablePath = findMacAppExecutable();
  const distAppletRoot = path.resolve('apps/desktop/dist/applets-dist');
  const dmgDir = path.resolve('apps/desktop/src-tauri/target/release/bundle/dmg');
  const failures = [];
  if (!executablePath) failures.push('macOS .app executable is missing');
  if (!existsSync(distAppletRoot)) failures.push('Desktop dist applets-dist is missing');
  if (!existsSync(dmgDir) || !readdirSync(dmgDir).some((entry) => entry.endsWith('.dmg'))) {
    failures.push('macOS .dmg bundle is missing');
  }
  if (executablePath && existsSync(distAppletRoot)) {
    const executableMtime = statSync(executablePath).mtimeMs;
    const distNewest = newestMtimeMs(distAppletRoot);
    if (executableMtime + 1000 < distNewest) {
      failures.push(`Tauri app executable is older than Desktop packaged applet assets: executable ${new Date(executableMtime).toISOString()}, newest applet asset ${new Date(distNewest).toISOString()}`);
    }
  }
  return {
    name: 'Desktop Tauri bundle current filesystem freshness',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: executablePath || 'apps/desktop/src-tauri/target/release/bundle/macos',
    detail: failures.length === 0 ? 'Tauri bundle is current relative to Desktop packaged applet assets.' : failures.join('; '),
  };
}

function currentEvidenceFreshnessCheck({
  name,
  evidencePath,
  inputs,
  passDetail,
  staleDetail,
}) {
  const evidence = readEvidence(evidencePath);
  const failures = [];
  if (!evidence.content) {
    failures.push(`Missing evidence file: ${evidencePath}`);
  }
  const newestInput = newestInputMtimeMs(inputs, failures);
  if (evidence.content && newestInput > statSync(evidence.absolutePath).mtimeMs + 1000) {
    failures.push(`${staleDetail}: evidence ${new Date(statSync(evidence.absolutePath).mtimeMs).toISOString()}, source newest ${new Date(newestInput).toISOString()}`);
  }
  return {
    name,
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: evidencePath,
    detail: failures.length === 0 ? passDetail : failures.join('; '),
  };
}

function currentDesktopHttpGatewayFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Desktop HTTP Gateway current source freshness',
    evidencePath: 'desktop/http-gateway-gate-output.txt',
    inputs: [
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
      'apps/desktop/src-tauri/src/application/applets',
      'apps/desktop/src-tauri/src/interface/http_gateway',
      'apps/desktop/src-tauri/src/interface/tauri_commands/applets.rs',
      'tooling/scripts/applet-desktop-http-gateway-gate.mjs',
    ],
    passDetail: 'Desktop HTTP Gateway evidence is current relative to Gateway command dispatch source inputs.',
    staleDetail: 'Desktop HTTP Gateway evidence is older than relevant Gateway command dispatch inputs',
  });
}

function currentDesktopRuntimeFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Desktop Lynx runtime current source freshness',
    evidencePath: 'desktop/runtime-gate-output.txt',
    inputs: [
      'packages/applet-contract/package.json',
      'packages/applet-contract/tsconfig.json',
      'packages/applet-contract/src',
      'packages/applet-sdk/package.json',
      'packages/applet-sdk/tsconfig.json',
      'packages/applet-sdk/src',
      'apps/desktop/package.json',
      'apps/desktop/vite.config.ts',
      'apps/desktop/src/applet',
      'tooling/scripts/applet-desktop-runtime-gate.mjs',
      'tooling/fixtures/applets/packages/generic-complex-applet',
    ],
    passDetail: 'Desktop Lynx runtime evidence is current relative to SDK, Desktop applet runtime, gate, and generated package inputs.',
    staleDetail: 'Desktop Lynx runtime evidence is older than relevant runtime inputs',
  });
}

function currentDesktopProductHostFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Desktop product Host real Gateway current source freshness',
    evidencePath: 'desktop/product-host-real-gateway-gate-output.txt',
    inputs: [
      'packages/applet-contract/src',
      'packages/applet-sdk/src',
      'apps/desktop/package.json',
      'apps/desktop/vite.config.ts',
      'apps/desktop/src/App.tsx',
      'apps/desktop/src/applet',
      'apps/desktop/src/kernel',
      'apps/desktop/src/pages',
      'apps/desktop/src/runtimes',
      'apps/desktop/src/services',
      'apps/desktop/src/store',
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
      'apps/desktop/src-tauri/src/application/applets',
      'apps/desktop/src-tauri/src/infrastructure/station_client.rs',
      'apps/desktop/src-tauri/src/interface/http_gateway',
      'tooling/scripts/applet-desktop-product-host-gate.mjs',
      'tooling/fixtures/applets/packages/generic-complex-applet',
    ],
    passDetail: 'Desktop product Host real Gateway evidence is current relative to SDK, product Host, Rust Gateway, gate, and generated package inputs.',
    staleDetail: 'Desktop product Host real Gateway evidence is older than relevant product Host/Gateway inputs',
  });
}

function currentDesktopProductShellFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Desktop product shell real Gateway current source freshness',
    evidencePath: 'desktop/product-shell-real-gateway-gate-output.txt',
    inputs: [
      'packages/applet-contract/src',
      'packages/applet-sdk/src',
      'apps/desktop/package.json',
      'apps/desktop/vite.config.ts',
      'apps/desktop/src/App.tsx',
      'apps/desktop/src/components/PageRouter.tsx',
      'apps/desktop/src/kernel',
      'apps/desktop/src/pages',
      'apps/desktop/src/runtimes',
      'apps/desktop/src/services',
      'apps/desktop/src/store',
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
      'apps/desktop/src-tauri/src/application/applets',
      'apps/desktop/src-tauri/src/infrastructure/station_client.rs',
      'apps/desktop/src-tauri/src/interface/http_gateway',
      'tooling/scripts/applet-desktop-product-host-gate.mjs',
      'tooling/fixtures/applets/packages/generic-complex-applet',
    ],
    passDetail: 'Desktop product shell real Gateway evidence is current relative to SDK, product shell routing, Rust Gateway, gate, and generated package inputs.',
    staleDetail: 'Desktop product shell real Gateway evidence is older than relevant product shell/Gateway inputs',
  });
}

function currentDesktopProductWindowFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Desktop packaged product-window current source freshness',
    evidencePath: 'desktop/product-window-gate-output.txt',
    inputs: [
      'packages/applet-contract/src',
      'packages/applet-sdk/src',
      'apps/desktop/package.json',
      'apps/desktop/src',
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
      'apps/desktop/src-tauri/src',
      'apps/desktop/applets-dist',
      'tooling/scripts/applet-desktop-product-window-gate.mjs',
      'tooling/fixtures/applets/packages/generic-complex-applet',
    ],
    passDetail: 'Desktop packaged product-window evidence is current relative to product shell, Rust Gateway, packaged applets, gate, and generated package inputs.',
    staleDetail: 'Desktop packaged product-window evidence is older than relevant packaged product-window inputs',
  });
}

function currentDesktopLiveE2eFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Desktop live E2E current source freshness',
    evidencePath: 'desktop/live-e2e-output.txt',
    inputs: [
      'packages/applet-contract/package.json',
      'packages/applet-contract/src',
      'packages/applet-sdk/package.json',
      'packages/applet-sdk/src',
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
      'apps/desktop/src-tauri/src/application/applets',
      'apps/desktop/src-tauri/src/infrastructure/station_client.rs',
      'tooling/scripts/applet-desktop-e2e.mjs',
      'tooling/scripts/applet-validate.mjs',
      'tooling/scripts/applet-contract-test.mjs',
      'tooling/fixtures/applets/packages/generic-complex-applet',
    ],
    passDetail: 'Desktop live E2E evidence is current relative to contract, SDK, Rust Gateway, controlled upstream gate, and generated package inputs.',
    staleDetail: 'Desktop live E2E evidence is older than relevant live Gateway inputs',
  });
}

function currentProductCapabilityServiceFreshnessCheck() {
  return currentEvidenceFreshnessCheck({
    name: 'Product capability service executor current source freshness',
    evidencePath: 'release/product-capability-service-gate-output.txt',
    inputs: [
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/Cargo.lock',
      'apps/desktop/src-tauri/src/application/applets',
      'apps/desktop/src-tauri/src/infrastructure/station_client.rs',
      'tooling/scripts/applet-product-capability-service-gate.mjs',
      '.artifacts/applet-readiness/desktop/live-e2e-output.txt',
    ],
    passDetail: 'Product capability service executor evidence is current relative to Gateway executor source and live E2E evidence.',
    staleDetail: 'Product capability service executor evidence is older than relevant executor/live E2E inputs',
  });
}

function currentExternalSyntheticCertificationCheck() {
  const relativePath = 'external-producer/certification-output.txt';
  const certification = readEvidence(relativePath);
  const failures = [];
  if (!certification.content) {
    failures.push(`Missing evidence file: ${relativePath}`);
  } else if (!/^PASS external producer applet certification/m.test(certification.content)) {
    failures.push('certificationOutput is not a passing certification');
  }

  const packageLine = certification.content ? extractEvidenceLine(certification.content, 'Package') : '';
  const certifiedManifestId = certification.content ? extractEvidenceLine(certification.content, 'Manifest id') : '';
  const independentPath = certification.content ? extractEvidenceLine(certification.content, 'Independent package path') : '';
  const packagePath = packageLine ? path.resolve(packageLine) : '';
  if (!packagePath) failures.push('certification package path is missing');
  if (packagePath && isInsideRoot(packagePath)) failures.push('certification package path must be outside this repository');
  if (packagePath && !existsSync(packagePath)) failures.push(`certification package path does not exist: ${packagePath}`);
  if (independentPath !== 'enforced outside repository') {
    failures.push('certification must enforce an outside-repository package path');
  }
  if (certification.content && /--allow-repo-package|NOT ENFORCED/.test(certification.content)) {
    failures.push('certification output must not be a repo-package dry-run');
  }

  const manifestPath = packagePath ? path.join(packagePath, 'manifest.json') : '';
  if (packagePath && existsSync(packagePath) && !existsSync(manifestPath)) {
    failures.push(`certification package manifest is missing: ${manifestPath}`);
  }
  if (existsSync(manifestPath)) {
    const manifest = readJsonFile(manifestPath);
    if (manifest.error) {
      failures.push(manifest.error);
    } else {
      if (manifest.data.id !== certifiedManifestId) {
        failures.push(`certification manifest id ${certifiedManifestId || '<missing>'} does not match package manifest id ${manifest.data.id}`);
      }
      if (manifest.data.id === 'generic-complex-applet') {
        failures.push('certification package must not use the generic fixture applet id');
      }
      if (manifest.data.load?.desktop?.type !== 'lynx-web') {
        failures.push('certification package must target Desktop with load.desktop.type = lynx-web');
      }
    }
  }
  if (certification.content && packagePath && existsSync(packagePath)) {
    const certificationMtime = statSync(certification.absolutePath).mtimeMs;
    const packageNewest = newestMtimeMs(packagePath);
    if (certificationMtime + 1000 < packageNewest) {
      failures.push(`certification evidence is older than the external package contents: certification ${new Date(certificationMtime).toISOString()}, package newest ${new Date(packageNewest).toISOString()}`);
    }
  }

  return {
    name: 'Repo-external synthetic certification current package check',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: packagePath || relativePath,
    detail:
      failures.length === 0
        ? 'Repo-external synthetic package still exists, matches certification evidence, and is not a repo-package dry-run.'
        : failures.join('; '),
  };
}

function checkThirdPartyAttestation() {
  const relativePath = 'release/third-party-producer-attestation.json';
  const parsed = readJsonEvidence(relativePath);
  if (parsed.error) {
    return {
      name: 'Real independently authored third-party producer attestation',
      status: 'PENDING',
      evidence: relativePath,
      detail: parsed.error,
    };
  }

  const attestation = parsed.data;
  const certificationPath = isNonEmptyString(attestation.certificationOutput)
    ? attestation.certificationOutput
    : '';
  const certification = readEvidence(certificationPath);
  const packagePath = isNonEmptyString(attestation.packagePath)
    ? path.resolve(attestation.packagePath)
    : '';
  const failures = [];

  if (attestation.kind !== 'peers-touch.applet.release.third-party-attestation') {
    failures.push('kind must be peers-touch.applet.release.third-party-attestation');
  }
  if (!isNonEmptyString(attestation.appletId)) failures.push('appletId is required');
  if (!isNonEmptyString(attestation.producerName)) failures.push('producerName is required');
  if (attestation.independentlyAuthored !== true) failures.push('independentlyAuthored must be true');
  if (attestation.notGeneratedByPeersTouchTooling !== true) {
    failures.push('notGeneratedByPeersTouchTooling must be true');
  }
  if (!isNonEmptyString(attestation.reviewedBy)) failures.push('reviewedBy is required');
  const reviewedAt = parseCanonicalTimestamp(attestation.reviewedAt, 'reviewedAt', failures);
  if (!isNonEmptyString(attestation.certificationOutput)) failures.push('certificationOutput is required');
  if (!packagePath) failures.push('packagePath is required');
  if (packagePath && isInsideRoot(packagePath)) failures.push('packagePath must be outside this repository');
  if (packagePath && !existsSync(packagePath)) failures.push(`packagePath does not exist: ${packagePath}`);
  const manifestPath = packagePath ? path.join(packagePath, 'manifest.json') : '';
  let manifest = null;
  if (packagePath && existsSync(packagePath) && !existsSync(manifestPath)) {
    failures.push(`package manifest is missing: ${manifestPath}`);
  } else if (existsSync(manifestPath)) {
    const parsedManifest = readJsonFile(manifestPath);
    if (parsedManifest.error) {
      failures.push(parsedManifest.error);
    } else {
      manifest = parsedManifest.data;
      if (manifest.id !== attestation.appletId) {
        failures.push(`manifest id ${manifest.id} does not match attested appletId ${attestation.appletId}`);
      }
      if (isKnownSyntheticCertificationPackage(packagePath, manifest)) {
        failures.push('release attestation must not point at a Peers-Touch generated certification fixture package');
      }
    }
  }
  if (!Array.isArray(attestation.authorshipEvidenceFiles) || attestation.authorshipEvidenceFiles.length === 0) {
    failures.push('authorshipEvidenceFiles must list at least one supporting artifact for independent authorship');
  } else {
    const authorshipContents = [];
    for (const evidenceFile of attestation.authorshipEvidenceFiles) {
      if (!isNonEmptyString(evidenceFile)) {
        failures.push('authorshipEvidenceFiles must contain only non-empty paths');
        continue;
      }
      const absoluteEvidenceFile = path.resolve(evidenceFile);
      if (!existsSync(absoluteEvidenceFile)) {
        failures.push(`authorship supporting artifact is missing: ${evidenceFile}`);
        continue;
      }
      authorshipContents.push(readFileSync(absoluteEvidenceFile, 'utf8'));
    }
    const authorshipContent = authorshipContents.join('\n');
    if (authorshipContent && !containsText(authorshipContent, attestation.appletId)) {
      failures.push('authorship supporting artifacts must include the attested appletId');
    }
    if (authorshipContent && !containsText(authorshipContent, attestation.producerName)) {
      failures.push('authorship supporting artifacts must include the independent producer name');
    }
    if (authorshipContent && !/independent|third[- ]party|authored/i.test(authorshipContent)) {
      failures.push('authorship supporting artifacts must describe independent or third-party authorship');
    }
  }
  if (!certification.content) {
    failures.push(`certificationOutput is missing: ${certificationPath}`);
  } else {
    const certifiedPackage = extractEvidenceLine(certification.content, 'Package');
    const certifiedManifestId = extractEvidenceLine(certification.content, 'Manifest id');
    const independentPath = extractEvidenceLine(certification.content, 'Independent package path');
    if (!/^PASS external producer applet certification/m.test(certification.content)) {
      failures.push(`certificationOutput is not a passing certification: ${certificationPath}`);
    }
    if (certifiedPackage !== packagePath) {
      failures.push(`certification package path ${certifiedPackage || '<missing>'} does not match attested packagePath ${packagePath}`);
    }
    if (certifiedManifestId !== attestation.appletId) {
      failures.push(`certification manifest id ${certifiedManifestId || '<missing>'} does not match attested appletId ${attestation.appletId}`);
    }
    if (independentPath !== 'enforced outside repository') {
      failures.push('certification must enforce an outside-repository package path');
    }
    if (/--allow-repo-package|NOT ENFORCED/.test(certification.content)) {
      failures.push('certificationOutput must not be a repo-package dry-run');
    }
    if (reviewedAt !== null && statSync(certification.absolutePath).mtimeMs > reviewedAt + 1000) {
      failures.push('reviewedAt must be at or after the referenced certificationOutput file mtime');
    }
  }

  return {
    name: 'Real independently authored third-party producer attestation',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: relativePath,
    detail:
      failures.length === 0
        ? 'Third-party authorship attestation and certification evidence are present.'
        : failures.join('; '),
  };
}

function checkManualAcceptance() {
  const relativePath = 'release/manual-product-acceptance.json';
  const parsed = readJsonEvidence(relativePath);
  if (parsed.error) {
    return {
      name: 'Manual normal-user product acceptance',
      status: 'PENDING',
      evidence: relativePath,
      detail: parsed.error,
    };
  }

  const acceptance = parsed.data;
  const failures = [];
  const attestation = readJsonEvidence('release/third-party-producer-attestation.json');
  if (acceptance.kind !== 'peers-touch.applet.release.manual-product-acceptance') {
    failures.push('kind must be peers-touch.applet.release.manual-product-acceptance');
  }
  if (!isNonEmptyString(acceptance.appletId)) failures.push('appletId is required');
  if (acceptance.normalUserSession !== true) failures.push('normalUserSession must be true');
  if (acceptance.productShell !== true) failures.push('productShell must be true');
  if (acceptance.manualRun !== true) failures.push('manualRun must be true');
  if (acceptance.synthetic !== false) failures.push('synthetic must be false');
  if (acceptance.automatedHarness !== false) failures.push('automatedHarness must be false');
  if (!isNonEmptyString(acceptance.acceptedBy)) failures.push('acceptedBy is required');
  const acceptedAt = parseCanonicalTimestamp(acceptance.acceptedAt, 'acceptedAt', failures);
  if (acceptance.thirdPartyAttestation !== 'release/third-party-producer-attestation.json') {
    failures.push('thirdPartyAttestation must reference release/third-party-producer-attestation.json');
  }
  if (attestation.error) {
    failures.push(`thirdPartyAttestation is not available: ${attestation.error}`);
  }
  if (attestation.data?.appletId && acceptance.appletId !== attestation.data.appletId) {
    failures.push(`manual acceptance appletId ${acceptance.appletId} must match attested appletId ${attestation.data.appletId}`);
  }
  if (attestation.data?.reviewedAt && acceptedAt !== null) {
    const reviewedAt = parseCanonicalTimestamp(attestation.data.reviewedAt, 'thirdPartyAttestation.reviewedAt', failures);
    if (reviewedAt !== null && acceptedAt < reviewedAt) {
      failures.push('acceptedAt must be at or after thirdPartyAttestation.reviewedAt');
    }
  }
  if (!Array.isArray(acceptance.evidenceFiles) || acceptance.evidenceFiles.length === 0) {
    failures.push('evidenceFiles must list at least one supporting artifact');
  } else {
    for (const evidenceFile of acceptance.evidenceFiles) {
      if (!isNonEmptyString(evidenceFile)) {
        failures.push('evidenceFiles must contain only non-empty paths');
        continue;
      }
      if (!existsSync(path.resolve(evidenceFile))) {
        failures.push(`supporting artifact is missing: ${evidenceFile}`);
      }
    }
  }
  const evidenceContent = Array.isArray(acceptance.evidenceFiles)
    ? acceptance.evidenceFiles
        .filter(isNonEmptyString)
        .filter((evidenceFile) => existsSync(path.resolve(evidenceFile)))
        .map((evidenceFile) => readFileSync(path.resolve(evidenceFile), 'utf8'))
        .join('\n')
    : '';
  const requiredEvidenceMarkers = [
    [/productShell["': ]+true|Product shell evidence:/, 'product-shell evidence'],
    [/normalUserSession["': ]+true|normal user/i, 'normal-user evidence'],
    [new RegExp(acceptance.appletId ?? '$.^'), 'accepted applet id'],
  ];
  for (const [pattern, label] of requiredEvidenceMarkers) {
    if (!pattern.test(evidenceContent)) {
      failures.push(`supporting artifacts must include ${label}`);
    }
  }

  return {
    name: 'Manual normal-user product acceptance',
    status: failures.length === 0 ? 'PASS' : 'FAIL',
    evidence: relativePath,
    detail:
      failures.length === 0
        ? 'Manual normal-user acceptance evidence is present.'
        : failures.join('; '),
  };
}

const candidateChecks = [
  evidenceCheck({
    name: 'Canonical contract schema and validation',
    path: 'contract/schema-source.txt',
    required: [/PASS packages\/applet-contract is the canonical type source/],
  }),
  evidenceCheck({
    name: 'Contract JSON Schema generation',
    path: 'contract/schema-generation-output.txt',
    required: [/PASS applet contract schema generated/],
  }),
  evidenceCheck({
    name: 'Contract schema consumer evidence',
    path: 'contract/schema-consumers.txt',
    required: [/PASS generated JSON Schema is exported from the canonical applet-contract package/],
  }),
  evidenceCheck({
    name: 'Contract executable envelope tests',
    path: 'sdk/contract-test-output.txt',
    required: [/PASS applet contract tests/],
  }),
  evidenceCheck({
    name: 'Platform check gate',
    path: 'checks/platform-check-output.txt',
    required: [
      /PASS Applet platform check gate/,
      /Step: Applet SDK typecheck[\s\S]*?Status: PASS/,
      /Step: Desktop app typecheck and boundary checks[\s\S]*?Status: PASS/,
      /Step: Desktop Rust Gateway cargo check[\s\S]*?Status: PASS/,
      /Step: Mobile web\/native check[\s\S]*?Status: PASS/,
    ],
  }),
  currentPlatformCheckFreshnessCheck(),
  evidenceCheck({
    name: 'Package manifest validation',
    path: 'contract/validation-output.txt',
    required: [/PASS applet package validated/],
  }),
  evidenceCheck({
    name: 'Desktop applet package distribution gate',
    path: 'desktop/package-gate-output.txt',
    required: [
      /PASS Desktop applet index contains/,
      /PASS Each package has canonical bridge protocol, manifest\.json, and SHA-256 integrity/,
      /PASS Applet source trees avoid legacy/,
    ],
  }),
  evidenceCheck({
    name: 'Desktop packaged frontendDist assets gate',
    path: 'desktop/packaged-assets-gate-output.txt',
    required: [
      /PASS Desktop packaged applet assets gate/,
      /PASS packaged index:/,
      /PASS integrity files checked:/,
    ],
  }),
  currentDesktopPackagedAssetsCheck(),
  evidenceCheck({
    name: 'Desktop Tauri bundle freshness gate',
    path: 'desktop/tauri-bundle-gate-output.txt',
    required: [
      /PASS Desktop Tauri bundle applet gate/,
      /PASS macOS app:/,
      /PASS dmg:/,
      /PASS executable mtime:/,
      /PASS newest applet asset mtime:/,
    ],
  }),
  currentTauriBundleFreshnessCheck(),
  evidenceCheck({
    name: 'Desktop HTTP Gateway command dispatch gate',
    path: 'desktop/http-gateway-gate-output.txt',
    required: [
      /status: PASS/,
      /applet_commands_route_through_http_gateway_dispatch/,
      /test result: ok/,
    ],
  }),
  currentDesktopHttpGatewayFreshnessCheck(),
  evidenceCheck({
    name: 'Desktop Lynx runtime gate',
    path: 'desktop/runtime-gate-output.txt',
    required: [/Runtime status: PASS/, /task\.event/],
  }),
  currentDesktopRuntimeFreshnessCheck(),
  evidenceCheck({
    name: 'Desktop product Host real Gateway gate',
    path: 'desktop/product-host-real-gateway-gate-output.txt',
    required: [/Product host status: PASS/, /task-agent/, /skill-agent/, /Controlled upstream requests/],
  }),
  currentDesktopProductHostFreshnessCheck(),
  evidenceCheck({
    name: 'Desktop product shell real Gateway gate',
    path: 'desktop/product-shell-real-gateway-gate-output.txt',
    required: [/Product host status: PASS/, /shellRoute":true/, /appletListProjection/, /permissionGroups/, /Controlled upstream requests/],
  }),
  currentDesktopProductShellFreshnessCheck(),
  evidenceCheck({
    name: 'Desktop packaged product-window gate',
    path: 'desktop/product-window-gate-output.txt',
    required: [/PASS Desktop packaged product-window applet gate/, /"productShell":true/, /\/agent\/turn\/execute/],
  }),
  currentDesktopProductWindowFreshnessCheck(),
  evidenceCheck({
    name: 'Desktop live E2E controlled upstream',
    path: 'desktop/live-e2e-output.txt',
    required: [/Gateway live chain: PASS/, /task-agent/, /skill-agent/, /\/agent\/turn\/execute/],
  }),
  currentDesktopLiveE2eFreshnessCheck(),
  evidenceCheck({
    name: 'Product capability service executor gate',
    path: 'release/product-capability-service-gate-output.txt',
    required: [/PASS Product capability service executors/],
  }),
  currentProductCapabilityServiceFreshnessCheck(),
  evidenceCheck({
    name: 'Developer SDK package flow',
    path: 'developer-flow/sdk-package-flow-output.txt',
    required: [
      /PASS generated developer package includes canonical manifest\.json/,
      /PASS generated developer package build script rebuilds main\.lynx\.bundle/,
      /PASS generated developer source imports @peers-touch\/applet-sdk/,
      /PASS generated developer source uses high-level SDK capability APIs/,
      /PASS generated developer source avoids legacy applets_action\/search_query\/raw URL\/standalone mock paths/,
    ],
  }),
  currentDeveloperFlowFreshnessCheck(),
  evidenceCheck({
    name: 'Producer independence forbidden-path scan',
    path: 'producer-independence/forbidden-producer-scan-output.txt',
    required: [/PASS no forbidden producer terms found/],
  }),
  evidenceCheck({
    name: 'Host package input smoke',
    path: 'producer-independence/host-package-input-output.txt',
    required: [/PASS smoke accepts package directory only/],
  }),
  evidenceCheck({
    name: 'SDK adapter surface gate',
    path: 'sdk/adapter-test-output.txt',
    required: [
      /PASS SDK maps app, lifecycle, system/,
      /PASS SDK no longer auto-falls back to standalone when no Lynx\/WebHost bridge exists/,
      /PASS SDK standalone runtime requires explicit opt-in or explicit StandaloneBridgeAdapter construction/,
      /PASS SDK standalone context reports standalone platform\/runtime and does not masquerade as Web Host/,
      /canonical AppletError/,
    ],
  }),
  currentSdkAdapterFreshnessCheck(),
  currentMobileWebParityFreshnessCheck(),
  currentMobileNativeManifestFreshnessCheck(),
  currentAndroidRuntimeE2eFreshnessCheck(),
  currentIosRuntimeE2eFreshnessCheck(),
  evidenceCheck({
    name: 'Web Host runtime gate',
    path: 'web/web-host-runtime-gate-output.txt',
    required: [/PASS Applet Web Host runtime gate/, /\/agent\/turn\/execute/],
  }),
  currentWebHostRuntimeFreshnessCheck(),
  evidenceCheck({
    name: 'Production Web Host shell integration',
    path: 'web/production-web-host-runtime-output.txt',
    required: [/PASS Production Web Host runtime/],
  }),
  currentProductionWebHostFreshnessCheck(),
  evidenceCheck({
    name: 'Repo-external synthetic certification chain',
    path: 'external-producer/certification-output.txt',
    required: [/PASS external producer applet certification/, /Independent package path: enforced outside repository/],
  }),
  currentExternalSyntheticCertificationCheck(),
];

const releaseChecks = [
  checkThirdPartyAttestation(),
  checkManualAcceptance(),
];

const candidateFailures = candidateChecks.filter((check) => check.status !== 'PASS');
const releaseFailures = releaseChecks.filter((check) => check.status !== 'PASS');
const releaseStatus = releaseFailures.length === 0 ? 'PASS' : 'FAIL';
const status = candidateFailures.length === 0 && (candidateOnly || releaseStatus === 'PASS') ? 'PASS' : 'FAIL';

const lines = [
  `${status} Applet L3 ${candidateOnly ? 'candidate' : 'release'} readiness audit`,
  `Mode: ${candidateOnly ? 'candidate-only' : 'release'}`,
  `Candidate checks: ${candidateFailures.length === 0 ? 'PASS' : 'FAIL'}`,
  `Release checks: ${releaseStatus}`,
  '',
  'Candidate evidence checks:',
  ...candidateChecks.map(
    (check) => `- ${check.status} ${check.name} (${check.evidence}) - ${check.detail}`,
  ),
  '',
  'Release evidence checks:',
  ...releaseChecks.map(
    (check) => `- ${check.status} ${check.name} (${check.evidence}) - ${check.detail}`,
  ),
  '',
  'Release evidence templates:',
  '- release/third-party-producer-attestation.json must attest real independent authorship, point at an outside-repository package whose manifest id matches appletId, reference a passing non-dry-run external-producer certification output for the same package path and manifest id, include authorshipEvidenceFiles, and avoid known Peers-Touch generated certification fixture packages.',
  '- release/manual-product-acceptance.json must reference the third-party attestation, record a non-synthetic normal-user manual product-shell run for the same appletId, and list supporting artifacts containing product-shell, normal-user, and applet-id evidence.',
  '- release reviewedAt/acceptedAt fields must be canonical UTC ISO-8601 timestamps; reviewedAt must be at or after certificationOutput file mtime, and acceptedAt must be at or after thirdPartyAttestation.reviewedAt.',
  '',
  'Automated candidate evidence constraints:',
  '- Mobile native runtime evidence must come from the Tauri Mobile native plugin host. Old standalone Android/iOS runtime E2E evidence is invalid.',
  '- web/production-web-host-runtime-output.txt must come from the Production Web Host shell gate, not only the adapter/runtime harness.',
  '- release/product-capability-service-gate-output.txt must prove product-backed task/skill executors where registry/timer-backed placeholders are not release-final.',
];

writeFileSync(outputPath, `${lines.join('\n')}\n`);
process.stdout.write(`${lines.join('\n')}\nEvidence: ${outputPath}\n`);

if (status !== 'PASS') {
  process.exit(1);
}
