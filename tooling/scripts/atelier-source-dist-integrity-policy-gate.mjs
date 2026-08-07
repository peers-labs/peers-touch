#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const appletId = 'peers.atelier';
const bundleName = 'main.lynx.bundle';
const sourceManifestPath = path.join(repoRoot, 'apps/applets/atelier/applet.manifest.json');
const desktopManifestPath = path.join(repoRoot, 'apps/desktop/applets-dist/peers.atelier/manifest.json');
const bundlePath = path.join(repoRoot, 'apps/desktop/applets-dist/peers.atelier/main.lynx.bundle');
const evidenceDir = path.join(repoRoot, 'tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-source-dist-integrity-policy-gate.json');
const gate = 'atelier:source-dist-integrity-policy-gate';

const coveredPaths = [
  'Atelier source manifest keeps pending bundle integrity placeholder instead of pretending to be generated dist truth',
  'Atelier desktop dist manifest remains the runtime integrity truth and matches generated main.lynx.bundle sha256',
  'Atelier release-stamped manifest policy keeps source/dist service bindings permissions platform permissions and skills unchanged',
  'Atelier release-stamped manifest policy forbids execution persistence and privileged producer capability expansion',
];

const doesNotProve = [
  'real signed release artifact stamping',
  'real applet store publish or install',
  'real Desktop product window UI',
  'real Desktop Host loading stamped source manifest',
  'real Station service binding runtime',
  'complete Host + Station + applet E2E',
];

const forbiddenCapabilityPatterns = [
  /provider\.invoke/i,
  /skills\.invoke/i,
  /shell/i,
  /file/i,
  /memory\.write/i,
  /artifact\.produce/i,
  /gate\.produce/i,
  /run\.execute/i,
  /input_snapshot/i,
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(arrayOf(values).filter((value) => typeof value === 'string'))].sort();
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
  for (const requiredPath of [sourceManifestPath, desktopManifestPath, bundlePath]) {
    if (!existsSync(requiredPath)) {
      errors.push(`missing required file: ${path.relative(repoRoot, requiredPath)}`);
    }
  }
  if (errors.length > 0) {
    finish(report('FAIL', errors));
    return;
  }

  const sourceManifest = readJson(sourceManifestPath);
  const desktopManifest = readJson(desktopManifestPath);
  const actualIntegrity = `sha256:${sha256(bundlePath)}`;
  const sourceIntegrity = sourceManifest.integrity?.files?.[bundleName] ?? null;
  const desktopIntegrity = desktopManifest.integrity?.files?.[bundleName] ?? null;

  if (sourceManifest.id !== appletId) {
    errors.push(`source manifest id must be ${appletId}`);
  }
  if (desktopManifest.id !== appletId) {
    errors.push(`desktop dist manifest id must be ${appletId}`);
  }
  if (sourceIntegrity !== 'sha256:pending-atelier-bundle') {
    errors.push('source manifest must keep sha256:pending-atelier-bundle until release stamping');
  }
  if (desktopIntegrity !== actualIntegrity) {
    errors.push('desktop dist manifest integrity must match generated main.lynx.bundle sha256');
  }
  if (sourceIntegrity === actualIntegrity) {
    errors.push('source manifest must not be treated as the generated dist integrity truth');
  }
  if (!sameJson(sourceManifest.permissions, desktopManifest.permissions)) {
    errors.push('source and desktop dist manifest permissions must match before release stamping');
  }
  if (!sameJson(sourceManifest.services, desktopManifest.services)) {
    errors.push('source and desktop dist manifest service bindings must match before release stamping');
  }
  if (!sameJson(sourceManifest.skills, desktopManifest.skills)) {
    errors.push('source and desktop dist manifest skills must match before release stamping');
  }

  const stampedManifest = {
    ...sourceManifest,
    integrity: {
      ...(sourceManifest.integrity ?? {}),
      algorithm: 'sha256',
      files: {
        ...(sourceManifest.integrity?.files ?? {}),
        [bundleName]: actualIntegrity,
      },
    },
  };
  for (const field of ['permissions', 'platformPermissions', 'services', 'skills']) {
    if (!sameJson(sourceManifest[field], stampedManifest[field])) {
      errors.push(`release-stamped manifest must not mutate ${field}`);
    }
  }

  const capabilityStrings = [
    ...uniqueStrings(stampedManifest.permissions),
    ...uniqueStrings(stampedManifest.platformPermissions),
    ...uniqueStrings(arrayOf(stampedManifest.skills).map((skill) => typeof skill === 'string' ? skill : JSON.stringify(skill))),
  ];
  for (const capability of capabilityStrings) {
    if (forbiddenCapabilityPatterns.some((pattern) => pattern.test(capability))) {
      errors.push(`release-stamped manifest must not add forbidden capability: ${capability}`);
    }
  }

  finish(report(errors.length === 0 ? 'PASS' : 'FAIL', errors, {
    sourceIntegrity,
    desktopIntegrity,
    actualIntegrity,
    stampedIntegrity: stampedManifest.integrity?.files?.[bundleName] ?? null,
    unchangedFields: {
      permissions: sameJson(sourceManifest.permissions, stampedManifest.permissions),
      platformPermissions: sameJson(sourceManifest.platformPermissions, stampedManifest.platformPermissions),
      services: sameJson(sourceManifest.services, stampedManifest.services),
      skills: sameJson(sourceManifest.skills, stampedManifest.skills),
    },
    desktopPlatformPermissionsPresent: Array.isArray(desktopManifest.platformPermissions),
    permissionCount: uniqueStrings(stampedManifest.permissions).length,
    platformPermissionCount: uniqueStrings(stampedManifest.platformPermissions).length,
    serviceCount: arrayOf(stampedManifest.services).length,
    skillCount: arrayOf(stampedManifest.skills).length,
  }));
}

function report(status, errors, integrity = undefined) {
  const proves = status === 'PASS' ? coveredPaths : [];
  return {
    status,
    ok: status === 'PASS',
    evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
    appletId,
    gate,
    coveredPaths: proves,
    claimBoundary: {
      readiness: 'NOT_READY',
      proves,
      doesNotProve,
    },
    notCovered: doesNotProve,
    checkedFiles: [
      path.relative(repoRoot, sourceManifestPath),
      path.relative(repoRoot, desktopManifestPath),
      path.relative(repoRoot, bundlePath),
    ],
    integrity: integrity ?? null,
    errors,
  };
}

try {
  main();
} catch (error) {
  finish(report('FAIL', [error instanceof Error ? error.message : String(error)]));
}
