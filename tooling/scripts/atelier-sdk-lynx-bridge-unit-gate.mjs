#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/official-applet');
const evidencePath = path.join(evidenceDir, 'atelier-sdk-lynx-bridge-unit-gate.json');
const gate = 'atelier:sdk-lynx-bridge-unit-gate';

const coveredPaths = [
  'Applet SDK Lynx bridge unit matrix unwraps canonical object and string envelopes before applet capability consumers observe results',
  'Applet SDK Lynx bridge unit matrix preserves canonical Host error envelopes as AppletError with code details and requestId',
  'Applet SDK Lynx bridge unit matrix covers bridge.invoke and legacy bridge.call fallback without exposing provider runtime execution',
  'Applet SDK Lynx bridge unit matrix normalizes synchronous legacy bridge.call throws as AppletError before applet capability consumers observe failures',
  'Applet SDK Lynx bridge unit matrix unwraps legacy bridge.call string envelopes before applet capability consumers observe results',
  'Applet SDK Lynx bridge unit matrix preserves legacy bridge.call string error envelopes as AppletError before applet capability consumers observe failures',
  'Applet SDK Lynx bridge unit matrix covers lynx.requireModule bridge injection fallback when NativeModules is absent',
  'Applet SDK Lynx bridge unit matrix tolerates delayed Host bridge injection before readiness timeout',
  'Applet SDK Lynx bridge unit matrix fails closed when the Lynx bridge is not available',
  'Applet SDK Lynx bridge event receiver long-polls events.subscribe without params and backs off malformed event envelopes',
  'Applet SDK Lynx bridge event receiver retries events.subscribe after canonical Host error envelopes without dispatching invalid events',
  'Applet SDK Lynx bridge event receiver retries events.subscribe after string canonical Host error envelopes without dispatching invalid events',
  'Applet SDK pending Host event replay buffers unmatched events by topic with a bounded retained tail',
  'Applet SDK destroy tears down bridge event subscription and clears local handlers before stale Host events can be retained',
  'Applet SDK local event unsubscribe removes topic handlers before stale Host events can be delivered',
  'Applet SDK local event unsubscribe preserves sibling same-topic handlers for subsequent Host events',
  'Applet SDK local event dispatch snapshots same-topic handlers so self-unsubscribe cannot skip sibling handlers',
  'Applet SDK local event dispatch snapshots same-topic handlers so newly registered handlers wait for subsequent Host events',
  'Applet SDK pending Host event replay snapshots queued events so reentrant unmatched Host events remain buffered',
];

const doesNotProve = [
  'real Desktop Host Lynx bridge injection',
  'real Desktop Host event stream producer behavior',
  'real Station SSE topic registration or Gateway delivery',
  'real applet product-window UI',
  'complete Host + Station + applet E2E',
];

const commands = [
  {
    id: 'sdk-check',
    display: 'pnpm --filter @peers-touch/applet-sdk run check',
    command: 'pnpm',
    args: ['--filter', '@peers-touch/applet-sdk', 'run', 'check'],
  },
  {
    id: 'sdk-unit',
    display: 'pnpm --filter @peers-touch/applet-sdk run test:unit',
    command: 'pnpm',
    args: ['--filter', '@peers-touch/applet-sdk', 'run', 'test:unit'],
  },
];

function outputTail(output) {
  return output.split(/\r?\n/).filter(Boolean).slice(-20);
}

function runCommand(command) {
  const result = spawnSync(command.command, command.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return {
    id: command.id,
    command: command.display,
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

const results = commands.map(runCommand);
const status = results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL';
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
  commands: results,
  sourceAnchors: {
    packageScript: 'packages/applet-sdk/package.json#test:unit',
    unitTest: 'packages/applet-sdk/src/adapters/lynx.test.ts',
    lynxAdapter: 'packages/applet-sdk/src/adapters/lynx.ts',
    sdkPendingReplay: 'packages/applet-sdk/src/index.ts',
  },
  completedAt: new Date().toISOString(),
});
