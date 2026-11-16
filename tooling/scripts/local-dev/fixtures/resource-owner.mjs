import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { MachineResourceOwner } from '../machine-dev-resource-store.mjs';
import { appArtifactDigest } from '../machine-dev-ios-provider.mjs';
import { resourceDigest } from '../machine-dev-resource-contract.mjs';

export function resourceFixture(t) {
  const home = mkdtempSync(path.join(tmpdir(), 'pt-resource-owner-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const devices = new Map();
  const appPath = mkdtempSync(path.join(home, 'app-'));
  writeFileSync(path.join(appPath, 'Info.plist'), 'fixture bundle identity: test.app');
  const provider = {
    inventory: () => structuredClone([...devices.values()]),
    inspect(id, bundleId) {
      const device = devices.get(id);
      return device ? {
        ...structuredClone(device), exists: true, directoryExists: true,
        installed: bundleId ? device.installed ?? null : null, sessions: device.sessions ?? [],
      } : { providerId: id, exists: false, directoryExists: false };
    },
    prepareIdentity: (intent) => `Peers ${intent.displayName} ${intent.nonce}`,
    bundleIdentity: () => 'test.app',
    nativeIdentity: () => ({
      sourceCommit: resolved().source.head, workspaceDigest: digest, applicationId: 'test.app', platform: 'ios',
    }),
    install(id, artifact) {
      devices.get(id).installed = { bundleId: 'test.app', artifactDigest: appArtifactDigest(artifact) };
    },
    create(intent) {
      let device = [...devices.values()].find((item) => item.name === intent.providerName);
      if (!device) {
        device = {
          providerId: randomUUID().toUpperCase(), name: intent.providerName,
          model: 'iPhone Fixture', runtimeName: 'iOS Fixture',
          deviceType: intent.deviceType, runtime: intent.runtime, available: true,
          state: 'Shutdown', installed: null, sessions: [],
        };
        devices.set(device.providerId, device);
      }
      return structuredClone(device);
    },
  };
  const holders = [];
  let currentProfile = 'alpha';
  let digest = `sha256:${resourceDigest('fixture-digest')}`;
  const resolved = () => ({
    profile: {
      profile: currentProfile, profileFile: `/fixture/${currentProfile}.env`, resetPolicy: 'agent-resettable',
      resourceRequirements: [{ kind: 'simulator.ios', runtime: 'ios.fixture', deviceType: 'iphone.fixture', data: 'preserve' }],
    },
    binding: { workspaceId: '0123456789abcdef' },
    source: { branch: 'fixture', head: 'a'.repeat(40) },
  });
  const owner = new MachineResourceOwner({ home }, {
    provider, admit: resolved, transaction: (callback) => callback(resolved()),
    source: (value) => ({ ...value.source, workspaceDigest: digest }),
    leases: () => structuredClone(holders), verifyLease: () => {},
  });
  return {
    home, appPath, owner, provider, devices, holders,
    setProfile: (value) => { currentProfile = value; },
    setDigest: (value) => { digest = `sha256:${resourceDigest(value)}`; },
    source: () => owner.source(resolved()),
    create: (count = 1, request = 'first') => owner.assign({
      count, purpose: 'Device', create: true, preparationId: request,
    }).devices,
  };
}
