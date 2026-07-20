#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  parseDesktopLaunchSpec,
  parseProviderProfile,
  runtimeInputs,
  sanitizeRuntimeInputStatus,
  validateRuntimeInput,
} from './atelier-full-e2e-runtime-inputs.mjs';

const evidenceDir = path.resolve('applet-readiness-evidence/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-full-e2e-runtime-inputs-controlled-gate.json');

const claimBoundary = {
  readiness: 'NOT_READY',
  proves: [
    'full E2E runtime input validation has an executable controlled matrix for missing, invalid, and present inputs',
    'invalid Station URL, unsafe Desktop cmd launch specs, empty IDE targets, and malformed provider profiles fail closed before Desktop launch',
    'Station URL userinfo and controlled/synthetic provider profile markers fail closed before Desktop launch',
    'runtime input evidence records status and reason without persisting raw Station URL or provider profile values',
    'Desktop cmd launch specs reject shell metacharacters and parse into non-shell command/args',
    'provider runtime profiles must be JSON objects with non-empty profileRef',
  ],
  doesNotProve: [
    'real Desktop Host launch',
    'real Station service binding',
    'real IDE launch',
    'production provider/model/runtime quality',
    'full Host + Station + applet E2E',
    'global Atelier readiness',
  ],
};

function statusByEnv(env) {
  const statuses = runtimeInputs.map((input) => sanitizeRuntimeInputStatus(validateRuntimeInput(input, env), env));
  return Object.fromEntries(statuses.map((status) => [status.env, status]));
}

function assertStatus(statuses, envName, expectedStatus, expectedReasonSubstring) {
  assert.equal(statuses[envName]?.status, expectedStatus, `${envName} must be ${expectedStatus}`);
  if (expectedReasonSubstring) {
    assert.ok(
      statuses[envName]?.reason?.includes(expectedReasonSubstring),
      `${envName} reason must include ${expectedReasonSubstring}; got ${statuses[envName]?.reason}`,
    );
  }
}

function assertAllPresent(statuses) {
  for (const input of runtimeInputs) {
    assertStatus(statuses, input.env, 'PRESENT');
  }
}

function expectThrows(fn, expectedMessage) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof Error, 'expected an Error instance');
    assert.ok(error.message.includes(expectedMessage), `expected ${expectedMessage}; got ${error.message}`);
    return true;
  });
}

const safeDesktopLaunch = 'cmd:node --version';
const safeProviderProfile = JSON.stringify({ profileRef: 'controlled-provider-profile' });
const rawRuntimeInputLeakSentinels = [
  'operator:atelier-secret-token',
  'provider-profile-secret-token',
  'station-secret-host.invalid',
];
const presentEnv = {
  PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://127.0.0.1:3000',
  PEERS_ATELIER_FULL_E2E_DESKTOP_APP: safeDesktopLaunch,
  PEERS_ATELIER_FULL_E2E_IDE: 'controlled-ide-target',
  PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: safeProviderProfile,
};

const scenarios = [
  {
    name: 'all missing inputs stay missing without inferring readiness',
    env: {},
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['MISSING'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['MISSING'],
      PEERS_ATELIER_FULL_E2E_IDE: ['MISSING'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['MISSING'],
    },
  },
  {
    name: 'non-http Station URL is invalid',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_STATION_URL: 'file:///tmp/station.sock',
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['INVALID', 'must be http(s)'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['PRESENT'],
    },
  },
  {
    name: 'Station URL with username is invalid',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://operator@127.0.0.1:3000',
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['INVALID', 'must not include username'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['PRESENT'],
    },
  },
  {
    name: 'Station URL with password is invalid',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_STATION_URL: 'http://operator:atelier-secret-token@station-secret-host.invalid:3000',
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['INVALID', 'must not include username'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['PRESENT'],
    },
  },
  {
    name: 'Desktop cmd launch rejects shell metacharacters',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: 'cmd:node --version && echo unsafe',
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['INVALID', 'must not require shell metacharacters'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['PRESENT'],
    },
  },
  {
    name: 'blank IDE target is invalid',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_IDE: '   ',
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['INVALID', 'must be non-empty'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['PRESENT'],
    },
  },
  {
    name: 'provider profile must be a JSON object',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: '[]',
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['INVALID', 'must be a JSON object'],
    },
  },
  {
    name: 'provider profile requires non-empty profileRef',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({ profileRef: '   ' }),
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['INVALID', 'must include non-empty profileRef'],
    },
  },
  {
    name: 'provider profile rejects syntheticOnly marker',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({
        profileRef: 'provider-profile-secret-token',
        syntheticOnly: true,
      }),
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['INVALID', 'must not be syntheticOnly'],
    },
  },
  {
    name: 'provider profile rejects controlledOnly marker',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({
        profileRef: 'controlled-provider-profile',
        controlledOnly: true,
      }),
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['INVALID', 'must not be controlledOnly'],
    },
  },
  {
    name: 'provider profile rejects controlled local evidence class',
    env: {
      ...presentEnv,
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: JSON.stringify({
        profileRef: 'controlled-provider-profile',
        evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
      }),
    },
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['INVALID', 'must not use controlled local evidence class'],
    },
  },
  {
    name: 'safe present inputs validate without launching Desktop',
    env: presentEnv,
    expected: {
      PEERS_ATELIER_FULL_E2E_STATION_URL: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_DESKTOP_APP: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_IDE: ['PRESENT'],
      PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE: ['PRESENT'],
    },
  },
];

const scenarioResults = [];
for (const scenario of scenarios) {
  const statuses = statusByEnv(scenario.env);
  for (const [envName, [expectedStatus, expectedReasonSubstring]] of Object.entries(scenario.expected)) {
    assertStatus(statuses, envName, expectedStatus, expectedReasonSubstring);
  }
  scenarioResults.push({
    name: scenario.name,
    statuses: Object.values(statuses).map(({ env, status, reason }) => ({
      env,
      status,
      ...(reason ? { reason } : {}),
    })),
  });
}

const presentStatuses = statusByEnv(presentEnv);
assertAllPresent(presentStatuses);

const parsedLaunch = parseDesktopLaunchSpec(safeDesktopLaunch);
assert.equal(parsedLaunch.kind, 'cmd', 'safe Desktop cmd launch must parse as cmd');
assert.equal(parsedLaunch.command, 'node', 'safe Desktop cmd launch must keep executable separate');
assert.deepEqual(parsedLaunch.args, ['--version'], 'safe Desktop cmd launch must parse args without shell');
expectThrows(
  () => parseDesktopLaunchSpec('cmd:node --version && echo unsafe'),
  'must not require shell metacharacters',
);

const parsedProviderProfile = parseProviderProfile(safeProviderProfile, 'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE');
assert.equal(
  parsedProviderProfile.profileRef,
  'controlled-provider-profile',
  'provider profile parser must keep profileRef',
);
expectThrows(
  () => parseProviderProfile('[]', 'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE'),
  'must be a JSON object',
);
expectThrows(
  () => parseProviderProfile('{"profileRef":"   "}', 'PEERS_ATELIER_FULL_E2E_PROVIDER_PROFILE'),
  'must include non-empty profileRef',
);

function assertNoRawRuntimeInputLeak(document) {
  const serialized = JSON.stringify(document);
  for (const sentinel of rawRuntimeInputLeakSentinels) {
    assert.equal(serialized.includes(sentinel), false, `runtime input evidence must not persist raw input value ${sentinel}`);
  }
}

const document = {
  ok: true,
  evidenceClass: 'READINESS_AUDIT',
  gate: 'atelier:full-e2e-runtime-inputs-controlled-gate',
  readiness: 'NOT_READY',
  globalReady: false,
  runtimeInputEnvs: runtimeInputs.map((input) => input.env),
  scenarios: scenarioResults,
  parserChecks: {
    safeDesktopLaunch: {
      kind: parsedLaunch.kind,
      command: parsedLaunch.command,
      args: parsedLaunch.args,
    },
    providerProfileRef: parsedProviderProfile.profileRef,
    rejectsShellMetacharacters: true,
    rejectsProviderProfileArray: true,
    rejectsBlankProviderProfileRef: true,
  rejectsStationUrlUserinfo: true,
  rejectsControlledProfileMarkers: true,
    redactsRawRuntimeInputValues: true,
  },
  mutatesSharedFullE2EEvidence: false,
  mutatesSharedPreflightEvidence: false,
  claimBoundary,
  notCovered: claimBoundary.doesNotProve,
  completedAt: new Date().toISOString(),
};

assertNoRawRuntimeInputLeak(document);

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify(document, null, 2)}\n`);
