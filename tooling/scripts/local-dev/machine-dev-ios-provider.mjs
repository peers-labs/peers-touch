import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { canonicalize, fail } from './machine-dev-primitives.mjs';
import { canonicalProviderId, resourceDigest } from './machine-dev-resource-contract.mjs';

export function appArtifactDigest(root) {
  const hash = createHash('sha256');
  const walk = (directory, prefix = '') => {
    for (const name of readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = `${prefix}${name}`;
      const stat = lstatSync(file);
      hash.update(relative).update('\0');
      if (stat.isSymbolicLink()) hash.update(`link:${readlinkSync(file)}`);
      else if (stat.isDirectory()) walk(file, `${relative}/`);
      else if (stat.isFile()) hash.update(readFileSync(file));
      else fail('RESOURCE_ARTIFACT_INVALID', 'app contains an unsupported filesystem entry');
      hash.update('\0');
    }
  };
  walk(root);
  return hash.digest('hex');
}

export class IOSResourceProvider {
  constructor({ execute = execFileSync, deviceRoot = path.join(homedir(), 'Library/Developer/CoreSimulator/Devices') } = {}) {
    this.execute = execute;
    this.deviceRoot = deviceRoot;
  }

  run(args, timeout = 60_000) {
    return this.execute('xcrun', ['simctl', ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout,
    }).trim();
  }

  inventory() {
    const document = JSON.parse(this.run(['list', '--json']));
    const runtimes = new Map((document.runtimes ?? []).map((item) => [item.identifier, item]));
    const types = new Map((document.devicetypes ?? []).map((item) => [item.identifier, item]));
    return Object.entries(document.devices ?? {}).flatMap(([runtime, devices]) =>
      devices.map((device) => ({
        providerId: canonicalProviderId(device.udid),
        name: device.name,
        model: types.get(device.deviceTypeIdentifier)?.name ?? device.deviceTypeIdentifier,
        deviceType: device.deviceTypeIdentifier,
        runtime,
        runtimeName: runtimes.get(runtime)?.name ?? runtime,
        available: device.isAvailable === true && runtimes.get(runtime)?.isAvailable !== false,
        state: device.state,
        dataPath: device.dataPath ?? path.join(this.deviceRoot, device.udid, 'data'),
      })));
  }

  inspect(providerId, bundleId) {
    const id = canonicalProviderId(providerId);
    const device = this.inventory().find((item) => item.providerId === id);
    if (!device) return { providerId: id, exists: false, directoryExists: existsSync(path.join(this.deviceRoot, id)) };
    let installed = null;
    let sessions = [];
    if (bundleId && device.state === 'Booted') {
      try {
        const container = this.run(['get_app_container', id, bundleId, 'app']);
        installed = { bundleId, artifactDigest: appArtifactDigest(container) };
      } catch (error) {
        // Only simctl's explicit missing-app response means absence.
        const reason = String(error.stderr ?? '');
        if (!/not installed|No such file|Unable to lookup|not found/i.test(reason)) throw error;
      }
      const services = this.run(['spawn', id, 'launchctl', 'list']);
      sessions = services.split('\n').filter((line) => /^\d+\s/.test(line) && line.includes(bundleId))
        .map((line) => ({ pid: Number(line.split(/\s+/)[0]), bundleId }));
    }
    return { ...device, exists: true, directoryExists: existsSync(path.dirname(device.dataPath)), installed, sessions };
  }

  prepareIdentity(intent) {
    // The nonce is persisted by Machine Dev before this provider call.
    return `Peers ${intent.displayName} ${intent.nonce}`;
  }

  recover(intent) {
    const matches = this.inventory().filter((item) =>
      item.name === intent.providerName &&
      item.runtime === intent.runtime &&
      item.deviceType === intent.deviceType &&
      !intent.beforeProviderIds.includes(item.providerId));
    if (matches.length > 1) fail('RESOURCE_RECOVERY_AMBIGUOUS', 'preparation intent matches more than one device');
    return matches[0] ?? null;
  }

  create(intent) {
    const existing = this.recover(intent);
    if (existing) return existing;
    const id = canonicalProviderId(this.run(['create', intent.providerName, intent.deviceType, intent.runtime]));
    const result = this.inventory().find((item) => item.providerId === id);
    if (!result || result.name !== intent.providerName) fail('RESOURCE_CREATE_UNVERIFIED', 'created simulator cannot be verified');
    return result;
  }

  boot(id) {
    const device = this.inspect(id);
    if (!device.exists) fail('RESOURCE_PROVIDER_MISSING', 'simulator no longer exists');
    if (device.state !== 'Booted') this.run(['boot', canonicalProviderId(id)]);
    this.run(['bootstatus', canonicalProviderId(id), '-b'], 180_000);
  }

  install(id, appPath) {
    this.boot(id);
    this.run(['install', canonicalProviderId(id), appPath], 180_000);
  }

  bundleIdentity(appPath) {
    return this.execute('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(appPath, 'Info.plist')], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000,
    }).trim();
  }

  nativeIdentity(appPath) {
    const executable = this.execute('/usr/libexec/PlistBuddy',
      ['-c', 'Print :CFBundleExecutable', path.join(appPath, 'Info.plist')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim();
    if (!executable || executable.includes('/') || executable === '..') fail('RESOURCE_ARTIFACT_INVALID', 'invalid native executable');
    const identities = new Map();
    // Xcode debug builds may place Rust in the debug dylib. Read native bytes,
    // never a sidecar JSON file or the bundle's staged web assets.
    for (const name of readdirSync(appPath).filter((item) => item === executable || item.endsWith('.dylib'))) {
      const bytes = readFileSync(path.join(appPath, name)).toString('latin1');
      for (const match of bytes.matchAll(/\{[^{}\0\r\n]{1,4096}"schema":"peers-mobile-build-identity"[^{}\0\r\n]{0,4096}\}/g)) {
        try {
          const identity = JSON.parse(match[0]);
          if (JSON.stringify(canonicalize(identity)) === match[0] &&
              ['acceptance-debug', 'development'].includes(identity.configuration) &&
              identity.harnessEnabled === (identity.configuration === 'acceptance-debug')) {
            identities.set(JSON.stringify(identity), identity);
          }
        } catch { /* Other native constants are not identity evidence. */ }
      }
    }
    if (identities.size !== 1) fail('RESOURCE_NATIVE_IDENTITY_UNPROVEN', 'native application must contain exactly one embedded Mobile build identity');
    return [...identities.values()][0];
  }

  devEndpointUsers(devUrl) {
    return this.inventory().filter((item) => item.state === 'Booted').flatMap((device) => {
      const observation = this.inspect(device.providerId, 'com.peers.touch.mobile');
      if (!observation.installed) return [];
      const container = this.run(['get_app_container', device.providerId, 'com.peers.touch.mobile', 'app']);
      const matches = readdirSync(container).filter((name) => name === 'Peers' || name.endsWith('.dylib'))
        .some((name) => readFileSync(path.join(container, name)).includes(Buffer.from(devUrl)));
      return matches ? [{ providerId: device.providerId, name: device.name, sessions: observation.sessions }] : [];
    });
  }

  reset(id) {
    const device = this.inspect(id);
    if (device.state === 'Booted') this.run(['shutdown', canonicalProviderId(id)]);
    this.run(['erase', canonicalProviderId(id)], 180_000);
  }

  delete(id) {
    const device = this.inspect(id);
    if (device.exists) {
      if (device.state === 'Booted') this.run(['shutdown', canonicalProviderId(id)]);
      this.run(['delete', canonicalProviderId(id)], 180_000);
    }
    const after = this.inspect(id);
    if (after.exists || after.directoryExists) {
      fail('RESOURCE_DELETE_UNVERIFIED', 'device or associated simulator directory remains after deletion', after);
    }
    return after;
  }

  observationDigest(observation) {
    return resourceDigest(observation);
  }
}
