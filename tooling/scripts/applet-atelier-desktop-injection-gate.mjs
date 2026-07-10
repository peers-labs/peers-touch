#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const appletId = 'peers.atelier';
const serviceId = 'atelier';
const sourceManifestPath = path.join(repoRoot, 'apps/applets/atelier/applet.manifest.json');
const sourceServiceManifestPath = path.join(repoRoot, 'apps/applets/atelier/service.manifest.json');
const projectionContractPath = path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-projection.contract.json');
const stationMainPath = path.join(repoRoot, 'apps/station/app/main.go');
const stationAtelierSubserverPath = path.join(repoRoot, 'apps/station/app/subserver/official_applets/atelier.go');
const desktopPackageDir = path.join(repoRoot, 'apps/desktop/applets-dist/peers.atelier');
const desktopIndexPath = path.join(repoRoot, 'apps/desktop/applets-dist/index.json');
const desktopManifestPath = path.join(desktopPackageDir, 'manifest.json');
const bundlePath = path.join(desktopPackageDir, 'main.lynx.bundle');
const evidenceDir = path.join(repoRoot, 'applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-desktop-injection-gate.json');
const desktopInjectionCoveredPaths = [
  'source peers.atelier manifest, service manifest, and projection contract are present',
  'packaged peers.atelier Desktop manifest is indexed and matches the source applet manifest service binding',
  'packaged peers.atelier Desktop manifest grants only the projection/service/event permissions required by the contract',
  'packaged peers.atelier Desktop manifest declares station-resolved atelier service binding from /v1 to /applets/atelier/v1',
  'Station main registers the official Atelier applet subserver and exposes the expected /applets/atelier/v1 routes',
  'packaged main.lynx.bundle integrity matches the Desktop manifest and avoids direct Desktop/Station/Tauri imports',
];
const desktopInjectionDoesNotProve = [
  'real Desktop product window UI renders peers.atelier',
  'real Desktop Gateway network.request reaches Station at runtime',
  'real Station projection event stream, reconnect, cursor replay, or unsubscribe lifecycle',
  'real provider, gate, artifact, memory, rerun, workspace-open, or preview-open side effects',
  'complete Host + Station + applet E2E',
];

function desktopInjectionClaimBoundary(proves = []) {
  return {
    readiness: 'NOT_READY',
    proves,
    doesNotProve: desktopInjectionDoesNotProve,
  };
}

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

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function main() {
  const errors = [];

  for (const requiredPath of [
    sourceManifestPath,
    sourceServiceManifestPath,
    projectionContractPath,
    stationMainPath,
    stationAtelierSubserverPath,
    desktopIndexPath,
    desktopManifestPath,
    bundlePath,
  ]) {
    if (!existsSync(requiredPath)) {
      errors.push(`missing required file: ${path.relative(repoRoot, requiredPath)}`);
    }
  }

  if (errors.length > 0) {
    finish({
      status: 'FAIL',
      evidenceClass: 'REAL_PRODUCT_PATH',
      appletId,
      checkedFiles: [],
      claimBoundary: desktopInjectionClaimBoundary(),
      notCovered: desktopInjectionDoesNotProve,
      errors,
    });
    return;
  }

  const sourceManifest = readJson(sourceManifestPath);
  const sourceServiceManifest = readJson(sourceServiceManifestPath);
  const projectionContract = readJson(projectionContractPath);
  const desktopIndex = readJson(desktopIndexPath);
  const desktopManifest = readJson(desktopManifestPath);
  const stationMain = readFileSync(stationMainPath, 'utf8');
  const stationAtelierSubserver = readFileSync(stationAtelierSubserverPath, 'utf8');
  const indexedManifest = Array.isArray(desktopIndex.applets)
    ? desktopIndex.applets.find((manifest) => manifest?.id === appletId)
    : null;

  if (!indexedManifest) {
    errors.push(`apps/desktop/applets-dist/index.json must include ${appletId}`);
  } else if (!sameJson(indexedManifest, desktopManifest)) {
    errors.push(`indexed ${appletId} manifest must match apps/desktop/applets-dist/peers.atelier/manifest.json`);
  }
  if (sourceManifest.id !== appletId) {
    errors.push(`source applet.manifest.json id must be ${appletId}`);
  }
  if (desktopManifest.id !== appletId) {
    errors.push(`desktop manifest id must be ${appletId}`);
  }
  if (desktopManifest.load?.desktop?.type !== 'lynx-web') {
    errors.push('desktop manifest load.desktop.type must be lynx-web');
  }
  if (desktopManifest.load?.desktop?.entry !== 'main.lynx.bundle') {
    errors.push('desktop manifest load.desktop.entry must be main.lynx.bundle');
  }

  const requiredPermissions = [
    'network.request',
    'events.subscribe',
    'events.unsubscribe',
    'events.poll',
    ...(Array.isArray(projectionContract.methods) ? projectionContract.methods : []),
  ];
  for (const permission of requiredPermissions) {
    if (!Array.isArray(sourceManifest.permissions) || !sourceManifest.permissions.includes(permission)) {
      errors.push(`source manifest must grant ${permission}`);
    }
    if (!Array.isArray(desktopManifest.permissions) || !desktopManifest.permissions.includes(permission)) {
      errors.push(`desktop manifest must grant ${permission}`);
    }
  }
  if (!sameJson(sourceManifest.permissions, desktopManifest.permissions)) {
    errors.push('desktop manifest permissions must match source applet.manifest.json');
  }
  const forbiddenPermissions = [
    'atelier.provider.invoke',
    'atelier.skills.invoke',
    'atelier.memory.write',
    'atelier.rerun',
    'atelier.artifact.produce',
    'atelier.gate.produce',
    'execute',
    'run',
    'shell',
    'file',
  ];
  for (const permission of forbiddenPermissions) {
    if (Array.isArray(desktopManifest.permissions) && desktopManifest.permissions.includes(permission)) {
      errors.push(`desktop manifest must not grant forbidden permission ${permission}`);
    }
  }

  const atelierService = Array.isArray(desktopManifest.services)
    ? desktopManifest.services.find((service) => service?.id === serviceId)
    : null;
  if (!atelierService) {
    errors.push('desktop manifest must declare atelier service binding');
  } else {
    if (atelierService.binding !== 'station-resolved') {
      errors.push('atelier service binding must be station-resolved');
    }
    if (atelierService.publicPathPrefix !== '/v1') {
      errors.push('atelier service publicPathPrefix must be /v1');
    }
    if (atelierService.stationPathPrefix !== '/applets/atelier/v1') {
      errors.push('atelier service stationPathPrefix must be /applets/atelier/v1');
    }
    if (atelierService.streaming !== true) {
      errors.push('atelier service binding must keep streaming enabled');
    }
    if (sourceServiceManifest.routes?.publicPrefix !== atelierService.publicPathPrefix) {
      errors.push('service.manifest publicPrefix must match applet manifest atelier publicPathPrefix');
    }
    if (sourceServiceManifest.routes?.stationPrefix !== atelierService.stationPathPrefix) {
      errors.push('service.manifest stationPrefix must match applet manifest atelier stationPathPrefix');
    }
    if (sourceServiceManifest.service !== serviceId) {
      errors.push(`service.manifest service must be ${serviceId}`);
    }
    if (sourceServiceManifest.deployment?.stationBundled !== true) {
      errors.push('service.manifest must declare stationBundled=true for Atelier');
    }
    if (sourceManifest.serviceDependencies?.[serviceId]?.kind !== 'station-subserver') {
      errors.push('source manifest must declare atelier station-subserver dependency');
    }
    if (sourceManifest.serviceDependencies?.[serviceId]?.required !== true) {
      errors.push('source manifest atelier service dependency must be required');
    }
  }

  const sourceService = Array.isArray(sourceManifest.services)
    ? sourceManifest.services.find((service) => service?.id === serviceId)
    : null;
  if (!sameJson(sourceService, atelierService)) {
    errors.push('desktop manifest atelier service declaration must match source applet.manifest.json');
  }

  const expectedHTTPMapping = [
    { method: 'GET', publicPath: '/v1/workspace', stationPath: '/applets/atelier/v1/workspace' },
    { method: 'POST', publicPath: '/v1/projects', stationPath: '/applets/atelier/v1/projects' },
    { method: 'POST', publicPath: '/v1/messages', stationPath: '/applets/atelier/v1/messages' },
    { method: 'POST', publicPath: '/v1/escalations:resolve', stationPath: '/applets/atelier/v1/escalations:resolve' },
    { method: 'POST', publicPath: '/v1/provider/capabilities', stationPath: '/applets/atelier/v1/provider/capabilities' },
    { method: 'POST', publicPath: '/v1/feedback/submit', stationPath: '/applets/atelier/v1/feedback/submit' },
    { method: 'POST', publicPath: '/v1/memory/confirm-candidate', stationPath: '/applets/atelier/v1/memory/confirm-candidate' },
    { method: 'POST', publicPath: '/v1/feedback/confirm-rerun', stationPath: '/applets/atelier/v1/feedback/confirm-rerun' },
    { method: 'POST', publicPath: '/v1/artifact/body/fetch', stationPath: '/applets/atelier/v1/artifact/body/fetch' },
    { method: 'PATCH', publicPath: '/v1/tasks/*', stationPath: '/applets/atelier/v1/tasks/{task_id}/status' },
    { method: 'DELETE', publicPath: '/v1/tasks/*', stationPath: '/applets/atelier/v1/tasks/{task_id}' },
  ];
  const allowedPaths = Array.isArray(sourceService?.allowedPaths) ? sourceService.allowedPaths : [];
  for (const mapping of expectedHTTPMapping) {
    if (!allowedPaths.includes(mapping.publicPath)) {
      errors.push(`source manifest atelier service allowedPaths must include ${mapping.publicPath}`);
    }
  }
  if (!stationMain.includes('server.WithSubServer("official_applet_atelier", officialapplets.NewAtelierSubServer)')) {
    errors.push('Station main must register official_applet_atelier subserver');
  }
  for (const requiredSnippet of [
    'const atelierMountPath = "/applets/atelier"',
    'const atelierV1Prefix = atelierMountPath + "/v1"',
    'func NewAtelierSubServer',
    'func (s *AtelierSubServer) handle',
    'path == atelierV1Prefix+"/workspace"',
    'path == atelierV1Prefix+"/projects"',
    'path == atelierV1Prefix+"/messages"',
    'path == atelierV1Prefix+"/escalations:resolve"',
    'path == atelierV1Prefix+"/provider/capabilities"',
    'path == atelierV1Prefix+"/feedback/submit"',
    'path == atelierV1Prefix+"/memory/confirm-candidate"',
    'path == atelierV1Prefix+"/feedback/confirm-rerun"',
    'path == atelierV1Prefix+"/artifact/body/fetch"',
    'strings.HasPrefix(path, atelierV1Prefix+"/tasks/") && strings.HasSuffix(path, "/status")',
    'strings.HasPrefix(path, atelierV1Prefix+"/tasks/")',
    'CreateProjectFromGoal(ctx, actorID',
    'SendMessage(ctx, actorID',
    'ResolveDecision(ctx, actorID',
    'ProviderCapabilities(ctx, actorID',
    'SubmitFeedback(ctx, actorID',
    'ConfirmMemoryCandidate(ctx, actorID',
    'ConfirmRerun(ctx, actorID',
    'FetchArtifactBody(ctx, actorID',
    'SetTaskStatus(ctx, actorID',
    'PurgeTask(ctx, actorID',
  ]) {
    if (!stationAtelierSubserver.includes(requiredSnippet)) {
      errors.push(`Station Atelier official subserver must contain ${requiredSnippet}`);
    }
  }
  for (const forbiddenSnippet of [
    'atelier.provider.invoke',
    'atelier.memory.write',
    'atelier.rerun',
    'atelier.artifact.produce',
    'atelier.gate.produce',
  ]) {
    if (stationAtelierSubserver.includes(forbiddenSnippet)) {
      errors.push(`Station Atelier official subserver must not expose forbidden capability ${forbiddenSnippet}`);
    }
  }

  const expectedIntegrity = desktopManifest.integrity?.files?.['main.lynx.bundle'];
  const actualIntegrity = `sha256:${sha256(bundlePath)}`;
  if (expectedIntegrity !== actualIntegrity) {
    errors.push('desktop manifest integrity for main.lynx.bundle must match the generated bundle');
  }
  if (sourceManifest.integrity?.files?.['main.lynx.bundle'] === actualIntegrity) {
    errors.push('source manifest should not be treated as the generated bundle integrity truth source');
  }

  const bundleText = readFileSync(bundlePath, 'utf8');
  const forbiddenBundleTerms = ['@tauri-apps/api', 'apps/desktop', 'apps/station', 'apps/mobile'];
  for (const term of forbiddenBundleTerms) {
    if (bundleText.includes(term)) {
      errors.push(`generated Atelier bundle contains forbidden term: ${term}`);
    }
  }

  finish({
    status: errors.length === 0 ? 'PASS' : 'FAIL',
    evidenceClass: 'REAL_PRODUCT_PATH',
    appletId,
    coveredPaths: desktopInjectionCoveredPaths,
    claimBoundary: desktopInjectionClaimBoundary(errors.length === 0 ? desktopInjectionCoveredPaths : []),
    notCovered: desktopInjectionDoesNotProve,
    checkedFiles: [
      path.relative(repoRoot, sourceManifestPath),
      path.relative(repoRoot, sourceServiceManifestPath),
      path.relative(repoRoot, projectionContractPath),
      path.relative(repoRoot, stationMainPath),
      path.relative(repoRoot, stationAtelierSubserverPath),
      path.relative(repoRoot, desktopIndexPath),
      path.relative(repoRoot, desktopManifestPath),
      path.relative(repoRoot, bundlePath),
    ],
    desktopPackage: path.relative(repoRoot, desktopPackageDir),
    indexed: Boolean(indexedManifest),
    desktopLoad: desktopManifest.load?.desktop ?? null,
    atelierService: atelierService ?? null,
    permissionsChecked: requiredPermissions,
    forbiddenPermissions,
    serviceManifest: {
      service: sourceServiceManifest.service ?? null,
      routes: sourceServiceManifest.routes ?? null,
      stationBundled: sourceServiceManifest.deployment?.stationBundled ?? null,
    },
    stationRouteAlignment: {
      mainRegistered: stationMain.includes('server.WithSubServer("official_applet_atelier", officialapplets.NewAtelierSubServer)'),
      mountPath: '/applets/atelier',
      stationPrefix: '/applets/atelier/v1',
      httpMapping: expectedHTTPMapping,
    },
    integrity: {
      sourcePlaceholder: sourceManifest.integrity?.files?.['main.lynx.bundle'] ?? null,
      sourcePlaceholderExpected: sourceManifest.integrity?.files?.['main.lynx.bundle'] === 'sha256:pending-atelier-bundle',
      distManifestIsIntegrityTruth: expectedIntegrity === actualIntegrity,
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
    appletId,
    checkedFiles: [],
    claimBoundary: desktopInjectionClaimBoundary(),
    notCovered: desktopInjectionDoesNotProve,
    errors: [error.message],
  });
}
