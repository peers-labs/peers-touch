#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const sourceManifestPath = path.join(repoRoot, 'apps/applets/note/applet.manifest.json');
const desktopPackageDir = path.join(repoRoot, 'apps/desktop/applets-dist/peers.note');
const desktopIndexPath = path.join(repoRoot, 'apps/desktop/applets-dist/index.json');
const desktopManifestPath = path.join(desktopPackageDir, 'manifest.json');
const bundlePath = path.join(desktopPackageDir, 'main.lynx.bundle');
const evidenceDir = path.join(repoRoot, 'tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'note-desktop-injection-gate.json');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function finish(report) {
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  const output = `${JSON.stringify(report, null, 2)}\n`;
  if (report.status === 'PASS') {
    process.stdout.write(output);
    return;
  }
  process.stderr.write(output);
  process.exit(1);
}

function main() {
  const errors = [];

  for (const requiredPath of [sourceManifestPath, desktopIndexPath, desktopManifestPath, bundlePath]) {
    if (!existsSync(requiredPath)) {
      errors.push(`missing required file: ${path.relative(repoRoot, requiredPath)}`);
    }
  }

  if (errors.length > 0) {
    finish({
      status: 'FAIL',
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId: 'peers.note',
      checkedFiles: [],
      errors,
    });
    return;
  }

  const sourceManifest = readJson(sourceManifestPath);
  const desktopIndex = readJson(desktopIndexPath);
  const desktopManifest = readJson(desktopManifestPath);
  const indexedManifest = Array.isArray(desktopIndex.applets)
    ? desktopIndex.applets.find((manifest) => manifest?.id === 'peers.note')
    : null;

  if (!indexedManifest) {
    errors.push('apps/desktop/applets-dist/index.json must include peers.note');
  }
  if (sourceManifest.id !== 'peers.note') {
    errors.push('source applet.manifest.json id must be peers.note');
  }
  if (desktopManifest.id !== 'peers.note') {
    errors.push('desktop manifest id must be peers.note');
  }
  if (desktopManifest.load?.desktop?.type !== 'lynx-web') {
    errors.push('desktop manifest load.desktop.type must be lynx-web');
  }
  if (desktopManifest.load?.desktop?.entry !== 'main.lynx.bundle') {
    errors.push('desktop manifest load.desktop.entry must be main.lynx.bundle');
  }
  if (!Array.isArray(desktopManifest.permissions) || !desktopManifest.permissions.includes('network.request')) {
    errors.push('desktop manifest must grant network.request');
  }

  const noteService = Array.isArray(desktopManifest.services)
    ? desktopManifest.services.find((service) => service?.id === 'note')
    : null;
  if (!noteService) {
    errors.push('desktop manifest must declare note service binding');
  } else {
    if (noteService.binding !== 'station-resolved') {
      errors.push('note service binding must be station-resolved');
    }
    if (noteService.publicPathPrefix !== '/v1') {
      errors.push('note service publicPathPrefix must be /v1');
    }
    if (noteService.stationPathPrefix !== '/applets/note/v1') {
      errors.push('note service stationPathPrefix must be /applets/note/v1');
    }
  }

  const expectedIntegrity = desktopManifest.integrity?.files?.['main.lynx.bundle'];
  const actualIntegrity = `sha256:${sha256(bundlePath)}`;
  if (expectedIntegrity !== actualIntegrity) {
    errors.push('desktop manifest integrity for main.lynx.bundle must match the generated bundle');
  }

  const sourceService = Array.isArray(sourceManifest.services)
    ? sourceManifest.services.find((service) => service?.id === 'note')
    : null;
  if (JSON.stringify(sourceService) !== JSON.stringify(noteService)) {
    errors.push('desktop manifest note service declaration must match source applet.manifest.json');
  }

  const bundleText = readFileSync(bundlePath, 'utf8');
  const forbiddenBundleTerms = ['notebook_', '@tauri-apps/api', 'apps/desktop', 'apps/station', 'apps/mobile'];
  for (const term of forbiddenBundleTerms) {
    if (bundleText.includes(term)) {
      errors.push(`generated Note bundle contains forbidden term: ${term}`);
    }
  }

  finish({
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.note',
    checkedFiles: [
      path.relative(repoRoot, sourceManifestPath),
      path.relative(repoRoot, desktopIndexPath),
      path.relative(repoRoot, desktopManifestPath),
      path.relative(repoRoot, bundlePath),
    ],
    desktopPackage: path.relative(repoRoot, desktopPackageDir),
    indexed: Boolean(indexedManifest),
    desktopLoad: desktopManifest.load?.desktop ?? null,
    noteService: noteService ?? null,
    integrity: {
      expected: expectedIntegrity ?? null,
      actual: actualIntegrity,
    },
    errors,
  });
}

try {
  main();
} catch (error) {
  finish({
    status: 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId: 'peers.note',
    checkedFiles: [],
    errors: [error.message],
  });
}
