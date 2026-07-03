// Standalone Node test for DefaultPermissionManager.
//
// Imports from the package barrel (../dist/index.js) which the integrator wires
// up later. CapabilityMethod is imported straight from the contract package
// because the kernel barrel does not re-export it. A fake AuditSink collects
// records and a deterministic clock keeps timestamp assertions stable.

import assert from 'node:assert/strict';

import { CapabilityMethod } from '@peers-touch/applet-contract';

import { DefaultPermissionManager } from '../dist/index.js';

// Fake audit sink accumulating every recorded decision.
function makeAudit() {
  const records = [];
  return {
    records,
    record: (entry) => records.push(entry),
  };
}

const clock = { now: () => 5000 };
const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeManager() {
  const audit = makeAudit();
  const manager = new DefaultPermissionManager({ audit, clock, logger });
  return { audit, manager };
}

// registerGrants then check a granted method → granted:true, audited at t=5000.
{
  const { audit, manager } = makeManager();
  manager.registerGrants('inst-1', [CapabilityMethod.StorageGet]);
  const decision = manager.check('inst-1', 'com.example.app', CapabilityMethod.StorageGet);

  assert.equal(decision.granted, true);
  assert.equal(decision.reason, undefined);
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0].granted, true);
  assert.equal(audit.records[0].timestamp, 5000);
  assert.equal(audit.records[0].method, CapabilityMethod.StorageGet);
  assert.equal(audit.records[0].appletId, 'com.example.app');
  assert.equal(audit.records[0].instanceId, 'inst-1');
}

// check a valid-but-ungranted method → PERMISSION_DENIED, audited.
{
  const { audit, manager } = makeManager();
  manager.registerGrants('inst-1', [CapabilityMethod.StorageGet]);
  const decision = manager.check('inst-1', 'com.example.app', CapabilityMethod.NetworkRequest);

  assert.equal(decision.granted, false);
  assert.equal(decision.reason, 'PERMISSION_DENIED');
  assert.equal(audit.records.length, 1);
  assert.equal(audit.records[0].granted, false);
  assert.equal(audit.records[0].reason, 'PERMISSION_DENIED');
}

// check on an unregistered instance → PERMISSION_DENIED.
{
  const { manager } = makeManager();
  const decision = manager.check('missing', 'com.example.app', CapabilityMethod.StorageGet);

  assert.equal(decision.granted, false);
  assert.equal(decision.reason, 'PERMISSION_DENIED');
}

// check with an invalid method identifier → POLICY_DENIED.
{
  const { manager } = makeManager();
  manager.registerGrants('inst-1', [CapabilityMethod.StorageGet]);
  const decision = manager.check('inst-1', 'com.example.app', 'bogus.method');

  assert.equal(decision.granted, false);
  assert.equal(decision.reason, 'POLICY_DENIED');
}

// registerGrants keeps valid entries and drops invalid ones.
{
  const { manager } = makeManager();
  manager.registerGrants('inst-1', [CapabilityMethod.StorageGet, 'bad.method']);

  const valid = manager.check('inst-1', 'com.example.app', CapabilityMethod.StorageGet);
  assert.equal(valid.granted, true);

  const invalid = manager.check('inst-1', 'com.example.app', 'bad.method');
  assert.equal(invalid.granted, false);
  assert.equal(invalid.reason, 'POLICY_DENIED');
}

// revokeAll drops every grant → PERMISSION_DENIED afterwards.
{
  const { manager } = makeManager();
  manager.registerGrants('inst-1', [CapabilityMethod.StorageGet]);
  manager.revokeAll('inst-1');
  const decision = manager.check('inst-1', 'com.example.app', CapabilityMethod.StorageGet);

  assert.equal(decision.granted, false);
  assert.equal(decision.reason, 'PERMISSION_DENIED');
}

process.stdout.write('PASS permission-manager tests\n');
