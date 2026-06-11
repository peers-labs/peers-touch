#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const evidenceRoot = path.resolve('applet-readiness-evidence');
mkdirSync(path.join(evidenceRoot, 'parity'), { recursive: true });

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

const contract = await import('../../packages/applet-contract/dist/index.js');

globalThis.NativeModules = {
  bridge: {
    invoke({ method, params }) {
      const requestId = params?.options?.requestId ?? 'lynx-request-1';
      if (method === 'failure.case') {
        return JSON.stringify({
          protocol: contract.APPLET_BRIDGE_PROTOCOL,
          kind: 'response',
          appletId: 'parity-applet',
          sessionId: 'lynx-session',
          requestId,
          ok: false,
          error: { code: 'PERMISSION_DENIED', message: 'denied', requestId },
        });
      }
      return JSON.stringify({
        protocol: contract.APPLET_BRIDGE_PROTOCOL,
        kind: 'response',
        appletId: 'parity-applet',
        sessionId: 'lynx-session',
        requestId,
        ok: true,
        result: { method, params },
      });
    },
  },
};
globalThis.lynx = {
  getJSModule() {
    return {
      addListener() {},
      removeListener() {},
    };
  },
};

const sdk = await import('../../packages/applet-sdk/dist/index.js');

const lynxAdapter = new sdk.LynxBridgeAdapter();
const lynxResult = await lynxAdapter.invoke('app.getContext', { options: { requestId: 'lynx-ok' } });
assert.deepEqual(lynxResult, { method: 'app.getContext', params: { options: { requestId: 'lynx-ok' } } });
await assert.rejects(
  () => lynxAdapter.invoke('failure.case', { options: { requestId: 'lynx-deny' } }),
  (error) => error instanceof sdk.AppletError && error.code === 'PERMISSION_DENIED' && error.requestId === 'lynx-deny',
);

delete globalThis.NativeModules;
const lateBridgeSdk = new sdk.AppletSDK();
assert.equal(lateBridgeSdk.runtime, 'lynx');
globalThis.NativeModules = {
  bridge: {
    invoke({ method, params }) {
      return JSON.stringify({
        protocol: contract.APPLET_BRIDGE_PROTOCOL,
        kind: 'response',
        appletId: 'parity-applet',
        sessionId: 'lynx-session',
        requestId: 'lynx-late-bridge',
        ok: true,
        result: { method, params, lateBridge: true },
      });
    },
  },
};
const lateBridgeResult = await lateBridgeSdk.invoke('app.getContext', { source: 'late-bridge' });
assert.deepEqual(lateBridgeResult, { method: 'app.getContext', params: { source: 'late-bridge' }, lateBridge: true });
lateBridgeSdk.destroy();

delete globalThis.NativeModules;
globalThis.lynx = {
  getJSModule() {
    return {
      addListener() {},
      removeListener() {},
    };
  },
  requireModule(name) {
    if (name !== 'bridge') return undefined;
    return {
      call(methodName, data, callback) {
        callback(JSON.stringify({
          protocol: contract.APPLET_BRIDGE_PROTOCOL,
          kind: 'response',
          appletId: 'parity-applet',
          sessionId: 'lynx-session',
          requestId: 'lynx-require-module',
          ok: true,
          result: { methodName, data, viaRequireModule: true },
        }));
      },
    };
  },
};
const requireModuleSdk = new sdk.AppletSDK();
assert.equal(requireModuleSdk.runtime, 'lynx');
const requireModuleResult = await requireModuleSdk.invoke('app.getContext', { source: 'require-module' });
assert.deepEqual(requireModuleResult, {
  methodName: 'invoke',
  data: { method: 'app.getContext', params: { source: 'require-module' } },
  viaRequireModule: true,
});
requireModuleSdk.destroy();

globalThis.__PEERS_TOUCH_APPLET_HOST__ = {
  invoke(method, params) {
    const requestId = params?.options?.requestId ?? 'web-request-1';
    return {
      protocol: contract.APPLET_BRIDGE_PROTOCOL,
      kind: 'response',
      appletId: 'parity-applet',
      sessionId: 'web-session',
      requestId,
      ok: true,
      result: { method, params },
    };
  },
  getContext() {
    return { platform: 'web', runtime: 'web-host', bridgeProtocol: contract.APPLET_BRIDGE_PROTOCOL };
  },
};
const webAdapter = new sdk.WebHostBridgeAdapter();
const webResult = await webAdapter.invoke('system.getInfo', { options: { requestId: 'web-ok' } });
assert.deepEqual(webResult, { method: 'system.getInfo', params: { options: { requestId: 'web-ok' } } });
assert.equal(webAdapter.getContext()?.bridgeProtocol, contract.APPLET_BRIDGE_PROTOCOL);

const androidNativeModule = readFileSync('apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/bridge/AppletBridgeNativeModule.kt', 'utf8');
assert.match(androidNativeModule, /peers-touch\.applet\.bridge/);
assert.match(androidNativeModule, /put\("kind", "response"\)/);
assert.match(androidNativeModule, /put\("ok", ok\)/);
assert.match(androidNativeModule, /put\("result", toJsonValue\(result\.data\)\)/);
assert.match(androidNativeModule, /catch \(e: JSONException\)/);
assert.match(androidNativeModule, /INVALID_PARAMS/);
assert.doesNotMatch(androidNativeModule, /put\("success"/);

const androidDispatcher = readFileSync('apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/bridge/BridgeDispatcher.kt', 'utf8');
assert.doesNotMatch(androidDispatcher, /BRIDGE_/);
assert.match(androidDispatcher, /CAPABILITY_NOT_FOUND/);
assert.match(androidDispatcher, /INVALID_PARAMS/);
assert.match(androidDispatcher, /CAPABILITY_FAILED/);

const androidSession = readFileSync('apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletBridgeSession.kt', 'utf8');
assert.match(androidSession, /PERMISSION_DENIED/);
assert.match(androidSession, /INVALID_SESSION/);
assert.match(androidSession, /grantedPermissions\.contains\(api\)/);

const androidManifestParser = readFileSync('apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletManifestParser.kt', 'utf8');
assert.match(androidManifestParser, /val targets: List<String>/);
assert.match(androidManifestParser, /val entries: AppletEntryMap/);
assert.match(androidManifestParser, /val services: List<AppletServiceDeclaration>/);
assert.match(androidManifestParser, /val skills: List<AppletSkillDeclaration>/);
assert.match(androidManifestParser, /val integrity: PackageIntegrity/);
assert.match(androidManifestParser, /raw\["targets"\] \?: raw\["targetPlatforms"\]/);
assert.match(androidManifestParser, /LOAD_TYPES_BY_PLATFORM/);
assert.match(androidManifestParser, /integrity\.files must include entries\.lynx/);

const androidManager = readFileSync('apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletManager.kt', 'utf8');
assert.match(androidManager, /"android" !in manifest\.targets/);

const iosDispatcher = readFileSync('apps/mobile/ios/PeersTouch/Core/Applet/Bridge/BridgeDispatcher.swift', 'utf8');
assert.doesNotMatch(iosDispatcher, /BRIDGE_/);
assert.match(iosDispatcher, /CAPABILITY_NOT_FOUND/);
assert.match(iosDispatcher, /INVALID_PARAMS/);
assert.match(iosDispatcher, /CAPABILITY_FAILED/);

const iosLegacyLynxDispatcher = readFileSync('apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/BridgeDispatcher.swift', 'utf8');
assert.doesNotMatch(iosLegacyLynxDispatcher, /BRIDGE_/);
assert.match(iosLegacyLynxDispatcher, /CAPABILITY_NOT_FOUND/);
assert.match(iosLegacyLynxDispatcher, /INVALID_PARAMS/);
assert.match(iosLegacyLynxDispatcher, /CAPABILITY_FAILED/);

const iosSession = readFileSync('apps/mobile/ios/PeersTouch/Core/Applet/AppletBridgeSession.swift', 'utf8');
assert.match(iosSession, /makeBridgeResponse/);
assert.match(iosSession, /AppletManifest\.bridgeProtocol/);
assert.match(iosSession, /PERMISSION_DENIED/);

const iosManifest = readFileSync('apps/mobile/ios/PeersTouch/Core/Applet/AppletManifest.swift', 'utf8');
assert.match(iosManifest, /let targets: \[String\]/);
assert.match(iosManifest, /let entries: AppletEntryMap/);
assert.match(iosManifest, /let services: \[AppletServiceDeclaration\]/);
assert.match(iosManifest, /let skills: \[AppletSkillDeclaration\]/);
assert.match(iosManifest, /let integrity: PackageIntegrity/);
assert.match(iosManifest, /targetPlatforms = try container\.decodeIfPresent/);
assert.match(iosManifest, /targets = try container\.decodeIfPresent\(\[String\]\.self, forKey: \.targets\) \?\? targetPlatforms \?\? \[\]/);
assert.match(iosManifest, /loadTypesByPlatform/);
assert.match(iosManifest, /integrity\.files must include entries\.lynx/);

write('parity/mobile-web-bridge-output.txt', [
  'PASS SDK Lynx adapter unwraps JSON string contract envelopes.',
  'PASS SDK WebHost adapter unwraps contract envelopes and exposes protocol context.',
  'PASS Android Lynx bridge emits peers-touch.applet.bridge response envelopes with ok/result/error.',
  'PASS Android Lynx bridge converts malformed native calls into canonical error envelopes.',
  'PASS Android and iOS manifest parsers model canonical targets, entries, services, skills, and integrity fields.',
  'PASS Android and iOS dispatcher errors use canonical applet error codes, including the legacy iOS Lynx bridge path.',
  'PASS Android and iOS permission checks include full capability method grants.',
].join('\n'));

process.stdout.write('PASS applet mobile/web parity gate\n');
