#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-official-status-ui-gate.json');
const gate = 'atelier:official-status-ui-gate';

const coveredPaths = [
  'official Atelier status UI unit matrix covers loading empty disconnected auth-denied error reconciling degraded and ready statuses from generated contract',
  'official Atelier status UI page surface keeps loading empty typed recovery status notice global error and main content mutually exclusive where required',
  'official Atelier status UI action policy exposes create-project only for empty workspaces and retry only for retryable recovery kinds',
  'official Atelier status UI render wiring consumes status action policy for empty create-project and projection-only retry affordances',
  'official Atelier status UI retry boundary reloads Station projection only and does not expose execution provider gate artifact memory shell file or input_snapshot actions',
  'official Atelier status UI copy and tone are contract-owned through generated label keys and i18n catalogs',
];

const doesNotProve = [
  'real Desktop product window UI',
  'real Desktop Host failure producer behavior',
  'real Station projection stream failure matrix',
  'real auth recovery or reconnect behavior against Station',
  'post-ready applet UI actions',
  'complete Host + Station + applet E2E',
];

const sourceAnchors = [
  {
    path: 'apps/applets/atelier/frontend/src/application/atelierViewState.test.ts',
    anchors: [
      'covers every generated view status in the official page surface matrix',
      'derives create, retry, and no-action policy from the page surface',
      'covers every generated view status in the action policy matrix',
      'covers every generated recovery kind in global-error action policy',
      'provider\\.invoke|gate\\.run|artifact\\.write',
    ],
  },
  {
    path: 'apps/applets/atelier/frontend/src/application/pageComposition.ts',
    anchors: [
      'globalErrorVisible',
      'typedRecoveryKind',
      'loadingVisible',
      'emptyVisible',
      'mainContentVisible',
    ],
  },
  {
    path: 'apps/applets/atelier/frontend/src/application/officialRecoveryView.ts',
    anchors: [
      'deriveOfficialStatusActionPolicy',
      'isOfficialStatusActionPolicyConsistent',
      'ATELIER_RECOVERY_RETRYABLE_KINDS',
    ],
  },
  {
    path: 'apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx',
    anchors: [
      'const statusActionPolicy = deriveOfficialStatusActionPolicy({',
      'retryVisible={statusActionPolicy.retryVisible}',
      'statusActionPolicy.createProjectVisible ?',
      'atelier.recovery.retryBoundary',
    ],
  },
  {
    path: 'apps/applets/atelier/frontend/locales/en.json',
    anchors: [
      'atelier.recovery.retryBoundary',
      'atelier.error.authDeniedTitle',
      'atelier.error.disconnectedTitle',
      'atelier.empty.title',
    ],
  },
  {
    path: 'apps/applets/atelier/frontend/locales/zh-CN.json',
    anchors: [
      'atelier.recovery.retryBoundary',
      'atelier.error.authDeniedTitle',
      'atelier.error.disconnectedTitle',
      'atelier.empty.title',
    ],
  },
];

function outputTail(output) {
  return output.split(/\r?\n/).filter(Boolean).slice(-20);
}

function assertSourceAnchors() {
  const failures = [];
  for (const source of sourceAnchors) {
    const contents = readFileSync(source.path, 'utf8');
    for (const anchor of source.anchors) {
      if (!contents.includes(anchor)) {
        failures.push(`${source.path} missing ${anchor}`);
      }
    }
  }
  return failures;
}

function runOfficialUnitGate() {
  const result = spawnSync('pnpm', ['--filter', '@peers-touch/atelier-official-applet', 'run', 'test:unit'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    id: 'official-frontend-unit',
    command: 'pnpm --filter @peers-touch/atelier-official-applet run test:unit',
    status: result.status === 0 ? 'PASS' : 'FAIL',
    exitCode: result.status,
    outputTail: outputTail(output),
  };
}

function writeEvidence(report) {
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

const anchorFailures = assertSourceAnchors();
const command = runOfficialUnitGate();
const status = anchorFailures.length === 0 && command.status === 'PASS' ? 'PASS' : 'FAIL';

writeEvidence({
  status,
  evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM',
  appletId: 'peers.atelier',
  gate,
  coveredPaths: status === 'PASS' ? coveredPaths : [],
  notCovered: doesNotProve,
  claimBoundary: {
    readiness: 'NOT_READY',
    proves: status === 'PASS' ? coveredPaths : [],
    doesNotProve,
  },
  sourceAnchors: sourceAnchors.map((source) => source.path),
  anchorFailures,
  command,
  completedAt: new Date().toISOString(),
});
