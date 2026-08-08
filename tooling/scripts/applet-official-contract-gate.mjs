#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function collectFiles(dirPath) {
  if (!existsSync(dirPath)) return [];
  const files = [];
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'build'].includes(entry.name)) continue;
      files.push(...collectFiles(entryPath));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

function includesAny(content, terms) {
  return terms.filter((term) => content.includes(term));
}

function fail(report) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'official-contract-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(1);
}

function pass(report) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(path.join(evidenceDir, 'official-contract-gate.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const appletDir = process.argv[2] ? path.resolve(process.argv[2]) : null;
  if (!appletDir) {
    throw new Error('usage: pnpm applet:official-contract-gate <apps/applets/<service>>');
  }

  const errors = [];
  const requiredPaths = [
    'README.md',
    'applet.manifest.json',
    'service.manifest.json',
    'frontend',
    'frontend/package.json',
    'frontend/src',
    'frontend/src/infrastructure/capability',
    'service',
    'service/go.mod',
    'service/domain',
    'service/application',
    'service/infrastructure',
    'service/transport',
    'service/stationadapter',
    'service/standalone',
    'contracts/README.md',
    'docs',
    'tests',
  ];
  for (const requiredPath of requiredPaths) {
    if (!existsSync(path.join(appletDir, requiredPath))) {
      errors.push(`missing required path: ${requiredPath}`);
    }
  }

  let appletManifest = null;
  let serviceManifest = null;
  try {
    appletManifest = readJson(path.join(appletDir, 'applet.manifest.json'));
  } catch (error) {
    errors.push(`invalid applet.manifest.json: ${error.message}`);
  }
  try {
    serviceManifest = readJson(path.join(appletDir, 'service.manifest.json'));
  } catch (error) {
    errors.push(`invalid service.manifest.json: ${error.message}`);
  }

  const serviceName = serviceManifest?.service;
  if (!serviceName || typeof serviceName !== 'string') {
    errors.push('service.manifest.json must declare string field "service"');
  }

  if (appletManifest && serviceName) {
    const declaredService = Array.isArray(appletManifest.services)
      ? appletManifest.services.find((service) => service && service.id === serviceName)
      : null;
    if (!declaredService) {
      errors.push(`applet.manifest.json must declare services[] entry for ${serviceName}`);
    }
    if (declaredService && declaredService.binding !== 'station-resolved') {
      errors.push(`applet.manifest.json services.${serviceName}.binding must be station-resolved`);
    }
    if (declaredService && declaredService.publicPathPrefix !== '/v1') {
      errors.push(`applet.manifest.json services.${serviceName}.publicPathPrefix must be /v1`);
    }
    if (declaredService && declaredService.stationPathPrefix !== `/applets/${serviceName}/v1`) {
      errors.push(`applet.manifest.json services.${serviceName}.stationPathPrefix must be /applets/${serviceName}/v1`);
    }
    if (!Array.isArray(appletManifest.permissions) || !appletManifest.permissions.includes('network.request')) {
      errors.push('applet.manifest.json must include permission network.request');
    }
    if (!appletManifest.serviceDependencies || !appletManifest.serviceDependencies[serviceName]) {
      errors.push(`applet.manifest.json must declare serviceDependencies.${serviceName}`);
    }
    if (!Array.isArray(appletManifest.platformPermissions) || !appletManifest.platformPermissions.includes(`network:service:${serviceName}`)) {
      errors.push(`applet.manifest.json must include platformPermissions network:service:${serviceName}`);
    }
    if (JSON.stringify(appletManifest).includes('baseUrl') || JSON.stringify(appletManifest).includes('http://') || JSON.stringify(appletManifest).includes('https://')) {
      errors.push('applet.manifest.json must not expose backend base URL or upstream URL');
    }
  }

  if (serviceManifest) {
    if (!serviceManifest.deployment || serviceManifest.deployment.stationBundled !== true) {
      errors.push('service.manifest.json must declare deployment.stationBundled=true');
    }
    if (!serviceManifest.deployment || !Object.hasOwn(serviceManifest.deployment, 'standalone')) {
      errors.push('service.manifest.json must declare deployment.standalone status');
    }
  }

  const frontendFiles = collectFiles(path.join(appletDir, 'frontend')).filter((filePath) => /\.(ts|tsx|js|jsx|json)$/.test(filePath));
  const forbiddenImportTerms = [
    'apps/desktop',
    'apps/mobile',
    'apps/station',
    '@tauri-apps/api',
    'desktop_api',
    'notebook_',
  ];
  const forbiddenNetworkTerms = [
    'fetch(',
    'axios',
    'baseUrl',
    'http://',
    'https://',
  ];
  for (const filePath of frontendFiles) {
    const content = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(process.cwd(), filePath);
    for (const term of includesAny(content, forbiddenImportTerms)) {
      errors.push(`forbidden frontend dependency "${term}" in ${relativePath}`);
    }
    for (const term of includesAny(content, forbiddenNetworkTerms)) {
      errors.push(`forbidden frontend raw network term "${term}" in ${relativePath}`);
    }
  }

  const report = {
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    checkedPath: path.relative(process.cwd(), appletDir),
    service: serviceName ?? null,
    evidenceClass: 'REAL_PRODUCT_PATH',
    errors,
  };

  if (errors.length > 0) fail(report);
  pass(report);
}

try {
  main();
} catch (error) {
  fail({
    status: 'FAIL',
    checkedPath: process.argv[2] ?? null,
    evidenceClass: 'REAL_PRODUCT_PATH',
    errors: [error.message],
  });
}
