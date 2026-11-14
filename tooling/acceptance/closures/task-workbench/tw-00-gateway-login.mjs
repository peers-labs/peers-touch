#!/usr/bin/env node
// TW-O00 — headless gateway transport smoke (no GUI).
//
// Proves the native desktop binary accepts password login over its loopback
// gateway and that an authenticated command reaches Station. Run INSIDE the
// acceptance cell (node, against 127.0.0.1:3030):
//
//   docker exec -i tw-d1-cell node --input-type=module - < this-file
//
// Env: PEERS_GATEWAY_URL, PT_ACTOR_ACCOUNT, PT_ACTOR_PASSWORD, PT_TW_REPORT_DIR.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Gateway, envActor } from './lib/gateway.mjs';
import { CheckCollector, gitRev, writeReport } from './lib/evidence.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../../..');
const reportDir = process.env.PT_TW_REPORT_DIR ?? '/workspace/run/reports';
const checks = new CheckCollector();
const gw = new Gateway();
const { account, password } = envActor();

let session = null;
try {
  await gw.login(account, password);
  checks.record('A1', true, `password login accepted for ${account}`);
} catch (error) {
  checks.record('A1', false, error.message);
}

try {
  session = await gw.currentSession();
  const ok = !!session?.actor_ptid && session.actor_ptid.includes(':alice:');
  checks.record('A2', ok, ok ? `actor=${session.actor_ptid.slice(0, 48)}…` : 'no actor_ptid');
} catch (error) {
  checks.record('A2', false, error.message);
}

try {
  const agents = await gw.agentsList();
  const list = agents?.agents ?? agents?.agentConfigs ?? [];
  checks.record('A3', Array.isArray(list), `agents_list returned ${Array.isArray(list) ? list.length : 'non-array'}`);
} catch (error) {
  checks.record('A3', false, error.message);
}

const report = writeReport(path.join(reportDir, 'tw-00-gateway-login.json'), {
  plan: 'TW-20261102',
  closure: 'tw-00-gateway-login',
  source_commit: process.env.PT_TW_SOURCE_COMMIT ?? gitRev(root),
  station_url: process.env.PEERS_STATION_URL ?? 'persisted-active',
  pass: checks.passCount,
  fail: checks.failCount,
  results: checks.results,
});
console.log(`PASS=${report.pass} FAIL=${report.fail}`);
process.exit(report.fail === 0 ? 0 : 1);
