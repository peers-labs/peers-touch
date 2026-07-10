import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const scenario = process.argv[2] || 'valid-final-evidence';
const now = () => new Date().toISOString();
const launchId = process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_LAUNCH_ID;
const sessionId = 'controlled-session-' + scenario;
const stationUrl = process.env.PEERS_STATION_URL;
const gatewayUrl = new URL(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_GATEWAY_URL);
const taskId = 'controlled-task';
const workspaceUri = 'pt-workspace://task/' + encodeURIComponent(taskId) + '?workspace=controlled-workspace';
const ideTarget = process.env.PEERS_ATELIER_FULL_E2E_IDE;
const providerProfile = JSON.parse(process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE);

function controlledHash(value) {
  return 'sha256:' + createHash('sha256').update(String(value)).digest('hex');
}

function writeJson(filePath, document) {
  writeFileSync(filePath, JSON.stringify(document, null, 2) + '\n');
}

function desktopReadyEvidence() {
  const evidence = {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    readiness: 'NOT_READY',
    globalReady: false,
    serviceBinding: {
      service: 'atelier',
      transport: 'sdk.network.request',
      stationUrlRedacted: true,
      stationUrlHash: controlledHash(stationUrl),
      stationPathPrefix: '/applets/atelier/v1',
    },
    productShell: {
      kind: 'desktop_host_product_shell',
      appletId: 'peers.atelier',
    },
    productWindow: {
      kind: 'desktop_product_window',
      appletId: 'peers.atelier',
      mounted: true,
    },
    completedAt: now(),
  };
  if (scenario === 'desktop-ready-wrong-station-url-hash') {
    evidence.serviceBinding.stationUrlHash = controlledHash('http://other-station.invalid:3000');
  }
  return evidence;
}

function workspaceOpenEvidence() {
  const evidence = {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    action: 'atelier.workspace.open',
    accepted: true,
    mode: 'host_intent',
    hostSideEffect: 'workspace_open_intent',
    realIdeLaunchProven: scenario === 'workspace-open-claims-real-ide-launch',
    ideHintRedacted: true,
    ideTargetHash: controlledHash(ideTarget),
    taskId,
    workspaceUri,
    completedAt: now(),
  };
  if (scenario === 'workspace-open-stale-launch') {
    evidence.launchId = 'stale-launch';
  }
  if (scenario === 'workspace-open-stale-session') {
    evidence.sessionId = 'stale-session';
  }
  if (scenario === 'workspace-open-wrong-ide-target') {
    evidence.ideTargetHash = controlledHash('other-ide-target');
  }
  if (scenario === 'workspace-open-wrong-action') {
    evidence.action = 'provider.invoke';
  }
  if (scenario === 'workspace-open-native-launch-mode') {
    evidence.mode = 'native_launch';
  }
  if (scenario === 'workspace-open-shell-side-effect') {
    evidence.hostSideEffect = 'shell_execute';
  }
  if (scenario === 'workspace-open-file-url') {
    evidence.workspaceUri = 'file:///tmp/workspace';
  }
  if (scenario === 'workspace-open-task-mismatch') {
    evidence.workspaceUri = 'pt-workspace://task/other-task?workspace=controlled-workspace';
  }
  if (scenario === 'workspace-open-missing-workspace-query') {
    evidence.workspaceUri = 'pt-workspace://task/' + encodeURIComponent(taskId);
  }
  return {
    ...evidence,
  };
}

function ideLaunchEvidence() {
  return {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    action: 'atelier.workspace.open',
    taskId,
    workspaceUri,
    ideTargetRedacted: true,
    ideTargetHash: controlledHash(ideTarget),
    realIdeLaunchProven: true,
    launchOwner: scenario === 'ide-launch-wrong-owner' ? 'applet' : 'desktop_host',
    resolver: 'controlled-workspace-resolver',
    launchCommand: 'controlled-ide-launch',
    appletFileShellExecuteExposed: scenario === 'ide-launch-exposes-shell',
    appletOpenExternalUrlExposed: scenario === 'ide-launch-exposes-open-external-url',
    completedAt: now(),
  };
}

function providerRuntimeEvidence() {
  const evidence = {
    ok: true,
    launchId,
    appletId: 'peers.atelier',
    sessionId,
    owner: scenario === 'provider-wrong-owner' ? 'applet' : 'station',
    scope: 'production-provider-runtime',
    providerProfileRefRedacted: true,
    providerProfileRefHash: controlledHash(providerProfile.profileRef),
    providerRuntimeProven: true,
    providerModelQualityProven: true,
    streamingReplyUXProven: true,
    artifactPersistenceProven: true,
    traceCheckpointResumeProven: true,
    appletProviderInvokeExposed: scenario === 'provider-exposes-invoke',
    appletRuntimeExecuteExposed: false,
    appletArtifactWriteExposed: scenario === 'provider-exposes-artifact-write',
    appletTraceCheckpointResumeExposed: scenario === 'provider-exposes-trace-checkpoint-resume',
    completedAt: now(),
  };
  if (scenario === 'provider-wrong-profile-ref-hash') {
    evidence.providerProfileRefHash = controlledHash('other-provider-profile');
  }
  return evidence;
}

function gatewayBody(request) {
  if (request?.cmd !== 'applets_invoke') {
    return { ok: false, error: { message: 'unsupported command' } };
  }
  const pathName = request?.args?.params?.path;
  if (pathName === '/v1/workspace') {
    return {
      ok: true,
      data: {
        status: {
          status: 200,
          body: {
            selectedTaskId: taskId,
            workspace: {
              tasks: [{ id: taskId }],
            },
          },
        },
      },
    };
  }
  if (pathName === '/v1/provider/capabilities') {
    return {
      ok: true,
      data: {
        status: {
          status: 200,
          body: {
            source: 'station.provider.capabilities',
            capabilities: [{ scope: 'station-provider', readOnly: true }],
          },
        },
      },
    };
  }
  return { ok: false, error: { message: 'unsupported path ' + pathName } };
}

const server = createServer((request, response) => {
  let body = '';
  request.on('data', (chunk) => {
    body += chunk.toString();
  });
  request.on('end', () => {
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: false, error: { message: 'invalid json' } }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(gatewayBody(parsed)));
  });
});

server.listen(Number(gatewayUrl.port), gatewayUrl.hostname, () => {
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_WORKSPACE_OPEN_EVIDENCE, workspaceOpenEvidence());
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_IDE_LAUNCH_EVIDENCE, ideLaunchEvidence());
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_PROVIDER_RUNTIME_EVIDENCE, providerRuntimeEvidence());
  writeJson(process.env.PEERS_ATELIER_FULL_E2E_DESKTOP_READY_EVIDENCE, desktopReadyEvidence());
});

process.on('SIGTERM', () => {
  setTimeout(() => process.exit(0), 2500).unref();
});
setInterval(() => {}, 1000);
