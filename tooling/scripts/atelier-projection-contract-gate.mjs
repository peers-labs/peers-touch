import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const evidenceDir = path.join(
  repoRoot,
  'tooling/acceptance/evidence/applets/official-applet',
);
const evidencePath = path.join(evidenceDir, 'atelier-projection-contract-gate.json');
const failures = [];
const legacyAtelierSubscription = ['atelier', 'events', 'subscribe'].join('.');
const legacyAgentEventPath = ['/agent/events/', 'subscribe'].join('');
const legacyMountedAgentEventPath = ['/sub-agent/agent/events/', 'subscribe'].join('');
const legacyGeneratedSubscriptionConstant = ['ATELIER_PROJECTION_', 'SUBSCRIPTION_METHOD'].join('');
const legacyGlobalStreamConfig = ['__ATELIER_PROJECTION_', 'STREAM__'].join('');

const files = {
  contract: 'apps/applets/atelier/contracts/atelier-projection.contract.json',
  officialGenerated:
    'apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts',
  prototypeGenerated:
    'packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts',
  officialClient:
    'apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts',
  officialController:
    'apps/applets/atelier/frontend/src/application/useAtelierController.ts',
  officialReducer:
    'apps/applets/atelier/frontend/src/application/projectionReducer.ts',
  prototypeBridge:
    'packages/prototypes/desktop/applets/atelier/src/appletBridge.ts',
  prototypeRuntime:
    'packages/prototypes/desktop/applets/atelier/src/bridgeRuntime.ts',
  prototypeBootstrap:
    'packages/prototypes/desktop/applets/atelier/src/runtimeBootstrap.ts',
  desktopSupervisor:
    'apps/desktop/src-tauri/src/infrastructure/event_stream/mod.rs',
  desktopAppletHost:
    'apps/desktop/src-tauri/src/application/applets/mod.rs',
  stationAgent: 'apps/station/app/subserver/agent/agent.go',
  stationGateServer:
    'apps/station/app/subserver/official_applets/atelier_gate_server/main.go',
  appletManifest: 'apps/applets/atelier/applet.manifest.json',
  capabilityContract: 'packages/applet-contract/src/capability.ts',
};

const sources = Object.fromEntries(
  Object.entries(files).map(([key, relativePath]) => [
    key,
    fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'),
  ]),
);
const contract = JSON.parse(sources.contract);

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function expectIncludes(key, fragment, message) {
  expect(sources[key].includes(fragment), `${files[key]}: ${message}`);
}

function expectExcludes(key, fragment, message) {
  expect(!sources[key].includes(fragment), `${files[key]}: ${message}`);
}

function expectExact(actual, expected, label) {
  expect(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${files.contract}: ${label} must equal ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}`,
  );
}

function writeEvidence(status, error) {
  const proves = status === 'PASS'
    ? [
        'Atelier projection contract and generated TypeScript artifacts are aligned',
        'Atelier consumes the canonical Desktop Host topic without a feature-owned Station stream',
        'Desktop canonical SSE supervisor is the sole owner of /events/stream cursor and reconnect state',
        'AgentDomainEvent invalidates Atelier projection and Resync triggers authoritative readback',
        'Station and product-window fixtures use /events/stream with no private Agent event endpoint',
      ]
    : [];
  const doesNotProve = [
    'real Desktop product-window rendering',
    'arbitrary Station network failure recovery',
    'complete Host + Station + applet E2E',
  ];
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    evidencePath,
    `${JSON.stringify(
      {
        status,
        evidenceClass: 'STATIC_CONTRACT_GATE',
        appletId: 'peers.atelier',
        gate: 'atelier:projection-contract-gate',
        coveredPaths: proves,
        notCovered: doesNotProve,
        claimBoundary: {
          readiness: 'NOT_READY',
          proves,
          doesNotProve,
        },
        command: 'pnpm run atelier:projection-contract-gate',
        error,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  );
}

try {
  execFileSync(
    'node',
    ['tooling/scripts/generate-atelier-projection-contract.mjs', '--check'],
    { cwd: repoRoot, stdio: 'pipe' },
  );

  expect(contract.eventTopic === 'atelier.projection.event', 'eventTopic must remain atelier.projection.event');
  expect(!Object.hasOwn(contract, 'subscriptionMethod'), 'feature-owned subscriptionMethod must be deleted');
  expectExact(
    contract.eventSubscription,
    {
      transport: 'canonical_host_bridge',
      hostSubscriptionMethod: 'events.subscribe',
      stationPath: '/events/stream',
      cursorOwner: 'desktop.canonical_realtime_supervisor',
      invalidationPatchKind: 'snapshot.invalidate',
      resyncPayloadKind: 'atelier.projection.resync',
      controlledEvidence: contract.eventSubscription.controlledEvidence,
    },
    'eventSubscription canonical transport',
  );
  expect(
    contract.eventSubscription.controlledEvidence?.canonicalSingleConnectionProven === true,
    'eventSubscription controlled evidence must declare canonical single connection proof',
  );
  expect(
    contract.eventSubscription.controlledEvidence?.privateAgentStreamDeleted === true,
    'eventSubscription controlled evidence must declare private Agent stream deletion',
  );
  expect(
    contract.patchKinds.includes('snapshot.invalidate'),
    'patchKinds must include snapshot.invalidate',
  );
  expect(
    !contract.methods.includes('events.subscribe')
      && !contract.methods.includes(legacyAtelierSubscription),
    'Host event subscription must not be an Atelier runtime method',
  );
  expect(
    !Object.hasOwn(contract.methodTransports, 'events.subscribe')
      && !Object.hasOwn(contract.methodTransports, legacyAtelierSubscription),
    'Host event subscription must not be represented as an Atelier method transport',
  );

  for (const key of ['officialGenerated', 'prototypeGenerated']) {
    expectExcludes(
      key,
      legacyGeneratedSubscriptionConstant,
      'generated contract must not export a feature-owned subscription method',
    );
    expectIncludes(
      key,
      '"stationPath": "/events/stream"',
      'generated contract must expose the canonical Station event path',
    );
  }

  expectIncludes(
    'officialClient',
    'await sdk.events.subscribe(ATELIER_PROJECTION_EVENT_TOPIC)',
    'official client must subscribe through the generic Host event API',
  );
  expectExcludes(
    'officialClient',
    legacyGlobalStreamConfig,
    'official client must not consume private stream launch configuration',
  );
  expectExcludes(
    'officialClient',
    legacyGeneratedSubscriptionConstant,
    'official client must not invoke a feature-owned Station stream',
  );
  expectIncludes(
    'officialClient',
    "value.kind === 'atelier.projection.resync'",
    'official client must recognize canonical Resync',
  );
  expectIncludes(
    'officialController',
    'reconcileFromCanonicalEvent',
    'official controller must reconcile canonical invalidations',
  );
  expectIncludes(
    'officialReducer',
    "case 'snapshot.invalidate'",
    'official reducer must recognize canonical invalidation patches',
  );

  expectIncludes(
    'prototypeBridge',
    "invokeProjectionSubscription(host, 'events.subscribe'",
    'prototype bridge must subscribe through the generic Host event API',
  );
  expectExcludes(
    'prototypeBridge',
    legacyGeneratedSubscriptionConstant,
    'prototype bridge must not invoke a feature-owned Station stream',
  );
  expectExcludes(
    'prototypeBootstrap',
    legacyGlobalStreamConfig,
    'prototype bootstrap must not own Station stream configuration',
  );
  expectIncludes(
    'prototypeRuntime',
    "event.patch.kind === 'snapshot.invalidate'",
    'prototype runtime must reconcile canonical invalidation patches',
  );

  expectIncludes(
    'desktopSupervisor',
    'One long-lived SSE connection per actor to `/events/stream`',
    'Desktop canonical supervisor must own the actor SSE connection',
  );
  expectIncludes(
    'desktopSupervisor',
    'pub fn register_observer',
    'Desktop canonical supervisor must expose in-process observers',
  );
  expectIncludes(
    'desktopAppletHost',
    'Some(RealtimeEventKind::AgentDomainEvent(agent_event))',
    'Desktop applet Host must project canonical AgentDomainEvent messages',
  );
  expectIncludes(
    'desktopAppletHost',
    '"kind": "snapshot.invalidate"',
    'Desktop applet Host must emit snapshot invalidations',
  );
  expectIncludes(
    'stationGateServer',
    'agentEventAPI                          = "/events/stream"',
    'Atelier Station fixture must expose the canonical event path',
  );
  expectExcludes(
    'stationAgent',
    legacyAgentEventPath,
    'Agent subserver must not register a private event endpoint',
  );
  expectExcludes(
    'appletManifest',
    legacyAtelierSubscription,
    'Applet manifest must not request the deleted private capability',
  );
  expectExcludes(
    'capabilityContract',
    'AtelierEventsSubscribe',
    'shared applet capability contract must not retain the deleted private capability',
  );

  const implementationSurface = [
    sources.officialClient,
    sources.prototypeBridge,
    sources.prototypeBootstrap,
    sources.desktopAppletHost,
    sources.stationAgent,
    sources.stationGateServer,
  ].join('\n');
  for (const forbidden of [
    legacyAtelierSubscription,
    legacyAgentEventPath,
    legacyMountedAgentEventPath,
    legacyGlobalStreamConfig,
  ]) {
    expect(!implementationSurface.includes(forbidden), `implementation surface still contains ${forbidden}`);
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  writeEvidence('PASS');
  process.stdout.write('Atelier projection contract gate passed.\n');
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeEvidence('FAIL', message);
  console.error('Atelier projection contract gate failed:');
  console.error(message);
  process.exitCode = 1;
}
