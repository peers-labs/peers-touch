#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const evidenceRoot = path.resolve('applet-readiness-evidence');
const evidenceDir = path.join(evidenceRoot, 'mobile');
const workDir = path.resolve('.local/applet-mobile-native-manifest-gate');
const defaultPackageDir = path.resolve('applet-readiness-evidence/package/mobile-native-certification-applet');
const explicitPackageDir = process.argv[2] !== undefined;
const packageDir = path.resolve(process.argv[2] ?? defaultPackageDir);

mkdirSync(evidenceDir, { recursive: true });
mkdirSync(workDir, { recursive: true });

function write(relative, content) {
  writeFileSync(path.join(evidenceRoot, relative), `${content.trim()}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseLocalProperties(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        if (separator === -1) return [line, ''];
        return [
          line.slice(0, separator).trim(),
          line.slice(separator + 1).trim().replace(/\\:/g, ':'),
        ];
      }),
  );
}

function findAndroidSdkRoot() {
  const androidDir = path.resolve('apps/mobile/android');
  const localProperties = parseLocalProperties(path.join(androidDir, 'local.properties'));
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    localProperties['sdk.dir'],
    path.join(process.env.HOME ?? '', 'Library/Android/sdk'),
    '/opt/homebrew/share/android-commandlinetools',
    '/usr/local/share/android-commandlinetools',
  ].filter(Boolean);

  return candidates.find((candidate) => existsSync(path.join(candidate, 'platforms'))) ?? null;
}

function childProcessEnv(overrides = {}) {
  const env = { ...process.env, ...overrides };
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
    if (env[key] === '') {
      delete env[key];
    }
  }
  return env;
}

function runAndroidJvmContractTest() {
  const androidDir = path.resolve('apps/mobile/android');
  const gradlew = path.join(androidDir, 'gradlew');
  const sdkRoot = findAndroidSdkRoot();
  const outputRelativePath = 'mobile/android-jvm-contract-test-output.txt';

  if (!existsSync(gradlew)) {
    write(outputRelativePath, 'SKIP Android JVM AppletBridgeSessionContractTest: apps/mobile/android/gradlew was not found.');
    return { ran: false, reason: 'apps/mobile/android/gradlew was not found' };
  }
  if (!sdkRoot) {
    write(
      outputRelativePath,
      'SKIP Android JVM AppletBridgeSessionContractTest: Android SDK was not configured via ANDROID_HOME, ANDROID_SDK_ROOT, local.properties sdk.dir, ~/Library/Android/sdk, or Homebrew android-commandlinetools.',
    );
    return {
      ran: false,
      reason: 'Android SDK was not configured via ANDROID_HOME, ANDROID_SDK_ROOT, local.properties sdk.dir, ~/Library/Android/sdk, or Homebrew android-commandlinetools',
    };
  }

  const result = spawnSync(gradlew, [
    ':app:testDebugUnitTest',
    '--tests',
    'com.peerstouch.mobile.core.applet.AppletBridgeSessionContractTest',
  ], {
    cwd: androidDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: childProcessEnv({
      ANDROID_HOME: sdkRoot,
      ANDROID_SDK_ROOT: sdkRoot,
    }),
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  write(outputRelativePath, output);
  if (result.status !== 0) {
    throw new Error([
      'Android JVM AppletBridgeSessionContractTest failed.',
      `Evidence: applet-readiness-evidence/${outputRelativePath}`,
      output,
    ].filter(Boolean).join('\n'));
  }

  return { ran: true, sdkRoot, output: outputRelativePath };
}

function runIosXcodeBuild() {
  const iosDir = path.resolve('apps/mobile/ios');
  const workspace = path.join(iosDir, 'PeersTouch.xcworkspace');
  const podsProject = path.join(iosDir, 'Pods/Pods.xcodeproj');
  const outputRelativePath = 'mobile/ios-xcode-build-output.txt';

  if (!existsSync(workspace)) {
    write(outputRelativePath, 'SKIP iOS Xcode workspace build: apps/mobile/ios/PeersTouch.xcworkspace was not found.');
    return { ran: false, reason: 'apps/mobile/ios/PeersTouch.xcworkspace was not found' };
  }
  if (!existsSync(podsProject)) {
    write(outputRelativePath, 'SKIP iOS Xcode workspace build: CocoaPods project was not found; run pod install in apps/mobile/ios.');
    return { ran: false, reason: 'CocoaPods project was not found; run pod install in apps/mobile/ios' };
  }

  const result = spawnSync('xcodebuild', [
    '-workspace',
    workspace,
    '-scheme',
    'PeersTouch',
    '-configuration',
    'Debug',
    '-sdk',
    'iphonesimulator',
    '-destination',
    'generic/platform=iOS Simulator',
    'build',
  ], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    env: childProcessEnv(),
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  write(outputRelativePath, output);
  if (result.status !== 0) {
    if (
      output.includes('CoreSimulator is out of date') ||
      output.includes('Supported platforms for the buildables in the current scheme is empty')
    ) {
      return {
        ran: false,
        reason: `iOS Simulator environment is unavailable; see applet-readiness-evidence/${outputRelativePath}`,
      };
    }
    throw new Error([
      'iOS Xcode workspace build failed.',
      `Evidence: applet-readiness-evidence/${outputRelativePath}`,
      output,
    ].filter(Boolean).join('\n'));
  }

  return { ran: true, output: outputRelativePath };
}

if (!explicitPackageDir) {
  rmSync(packageDir, { recursive: true, force: true });
}

if (!existsSync(path.join(packageDir, 'manifest.json'))) {
  if (explicitPackageDir) {
    throw new Error(`Package manifest not found: ${path.join(packageDir, 'manifest.json')}`);
  }
  run('node', [
    'tooling/scripts/create-generic-complex-applet.mjs',
    packageDir,
    '--id',
    'mobile-native-certification-applet',
    '--name',
    'Mobile Native Certification Applet',
    '--package-name',
    '@peers-touch/mobile-native-certification-applet',
    '--description',
    'Canonical applet package fixture for native mobile manifest parser readiness evidence.',
    '--targets',
    'android,ios',
  ]);
}

const contract = await import('../../packages/applet-contract/dist/index.js');
const manifestPath = path.join(packageDir, 'manifest.json');
const manifest = readJson(manifestPath);
const contractCheck = contract.validateManifest(manifest);
if (!contractCheck.valid || !contractCheck.manifest) {
  throw new Error(`Generated mobile manifest is not contract-valid:\n${contractCheck.errors.map((item) => `- ${item}`).join('\n')}`);
}

assert.deepEqual(contractCheck.manifest.targets, ['android', 'ios']);
assert.equal(contractCheck.manifest.load.android?.type, 'lynx-native');
assert.equal(contractCheck.manifest.load.ios?.type, 'lynx-native');
assert.equal(contractCheck.manifest.bridge.protocol, contract.APPLET_BRIDGE_PROTOCOL);
assert.ok(contractCheck.manifest.permissions.includes('network.request'));
assert.ok(contractCheck.manifest.services.some((service) => service.id === 'primary-api'));
assert.ok(contractCheck.manifest.integrity.files['main.lynx.bundle']);
assert.ok(contractCheck.manifest.integrity.files['schemas/skill.input.json']);

const androidParserSource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletManifestParser.kt',
  'utf8',
);
assert.match(androidParserSource, /"android" to "lynx-native"/);
assert.match(androidParserSource, /raw\["targets"\] \?: raw\["targetPlatforms"\]/);
assert.match(androidParserSource, /network\.request permission requires at least one service declaration/);
assert.match(androidParserSource, /integrity\.files must include entries\.lynx/);

const androidSessionTestSource = readFileSync(
  'apps/mobile/android/app/src/test/java/com/peerstouch/mobile/core/applet/AppletBridgeSessionContractTest.kt',
  'utf8',
);
assert.match(androidSessionTestSource, /canonicalManifestParsesAndroidNativeApplet/);
assert.match(androidSessionTestSource, /networkPermissionRequiresServiceDeclaration/);
assert.match(androidSessionTestSource, /bridgeSessionEnforcesPermissionsAndCanonicalErrors/);
assert.match(androidSessionTestSource, /PERMISSION_DENIED/);
assert.match(androidSessionTestSource, /CAPABILITY_FAILED/);
assert.match(androidSessionTestSource, /INVALID_PARAMS/);
assert.match(androidSessionTestSource, /INVALID_SESSION/);

const androidRuntimeE2ESource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/AppletRuntimeE2E.kt',
  'utf8',
);
assert.match(androidRuntimeE2ESource, /peers_touch_applet_android_runtime_e2e/);
assert.match(androidRuntimeE2ESource, /AppletRuntimeE2E/);
assert.match(androidRuntimeE2ESource, /storage\.set/);
assert.match(androidRuntimeE2ESource, /storage\.get/);
assert.match(androidRuntimeE2ESource, /writeText\(envelope\)/);

const androidMainActivitySource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/MainActivity.kt',
  'utf8',
);
assert.match(androidMainActivitySource, /AppletRuntimeE2E\.configure\(intent\)/);
assert.match(androidMainActivitySource, /AppletContainerView\(appletId = runtimeE2EAppletId\)/);

const androidAppletContainerSource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/ui/AppletContainerView.kt',
  'utf8',
);
assert.match(androidAppletContainerSource, /appletManager\.scanLocalApplets\(\)/);
assert.match(androidAppletContainerSource, /appletSurfaceCache\.getOrCreate\(ctx, appletId, appletManager\)/);
assert.match(androidAppletContainerSource, /appletManager\.showApplet\(appletId\)/);
assert.match(androidAppletContainerSource, /appletManager\.hideApplet\(appletId\)/);

const androidSurfaceCacheSource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/applet/kernel/AppletSurfaceCache.kt',
  'utf8',
);
assert.match(androidSurfaceCacheSource, /File\(it\.path, loadConfig\.entry\)\.toURI\(\)\.toString\(\)/);
assert.match(androidSurfaceCacheSource, /lynxViewFactory\.create\(context, bundleUrl, session\)/);
assert.match(androidSurfaceCacheSource, /SurfaceCommand\.HIDE/);
assert.match(androidSurfaceCacheSource, /SurfaceCommand\.DETACH/);
assert.match(androidSurfaceCacheSource, /SurfaceCommand\.DESTROY/);

const androidLynxViewFactorySource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/LynxViewFactory.kt',
  'utf8',
);
assert.match(androidLynxViewFactorySource, /registerModule\("bridge", AppletBridgeNativeModule::class\.java, bridgeSession\)/);
assert.match(androidLynxViewFactorySource, /File\(URI\(bundleUrl\)\)\.readBytes\(\)/);
assert.match(androidLynxViewFactorySource, /renderTemplateWithBaseUrl\(bundleBytes, emptyMap<String, Any>\(\), bundleUrl\)/);

const androidAppletBridgeNativeModuleSource = readFileSync(
  'apps/mobile/android/app/src/main/java/com/peerstouch/mobile/core/lynx/bridge/AppletBridgeNativeModule.kt',
  'utf8',
);
assert.match(androidAppletBridgeNativeModuleSource, /fun invoke\(data: ReadableMap\): String/);
assert.match(androidAppletBridgeNativeModuleSource, /AppletRuntimeE2E\.record\(appContext, session, method, envelope\)/);
assert.match(androidAppletBridgeNativeModuleSource, /"kind", "response"/);
assert.match(androidAppletBridgeNativeModuleSource, /"ok", ok/);
assert.match(androidAppletBridgeNativeModuleSource, /"result"/);
assert.match(androidAppletBridgeNativeModuleSource, /"error"/);

const iosBundleStorageSource = readFileSync(
  'apps/mobile/ios/PeersTouch/Core/Applet/AppletBundleStorage.swift',
  'utf8',
);
assert.match(iosBundleStorageSource, /manifest\.json/);
assert.match(iosBundleStorageSource, /JSONDecoder\(\)\.decode\(AppletManifest\.self/);
assert.match(iosBundleStorageSource, /bundleURL\(for appletId: String\)/);

const iosAppletManagerSource = readFileSync(
  'apps/mobile/ios/PeersTouch/Core/Applet/AppletManager.swift',
  'utf8',
);
assert.match(iosAppletManagerSource, /init\(bundleStorage: AppletBundleStorage, bridgeDispatcher: BridgeDispatcher\)/);
assert.match(iosAppletManagerSource, /func scanLocalApplets\(\) -> \[AppletManifest\]/);
assert.match(iosAppletManagerSource, /func loadApplet\(id: String\) throws -> AppletBridgeSession/);
assert.match(iosAppletManagerSource, /manifest\.targets\.contains\("ios"\)/);

const iosAppletContainerSource = readFileSync(
  'apps/mobile/ios/PeersTouch/Core/Applet/UI/AppletContainerView.swift',
  'utf8',
);
assert.match(iosAppletContainerSource, /lynxViewFactory: LynxViewFactory = Container\.shared\.lynxViewFactory/);
assert.match(iosAppletContainerSource, /try appletManager\.loadApplet\(id: appletId\)/);
assert.match(iosAppletContainerSource, /AppletLynxViewRepresentable\(/);

const iosAppletLynxViewSource = readFileSync(
  'apps/mobile/ios/PeersTouch/Core/Applet/UI/AppletLynxViewRepresentable.swift',
  'utf8',
);
assert.match(iosAppletLynxViewSource, /lynxViewFactory\.create\(bundleURL: bundleURL, bridgeSession: session\)/);
assert.doesNotMatch(iosAppletLynxViewSource, /Placeholder until Lynx iOS SDK is integrated|let placeholder = UIView\(\)/);

const iosAppletBridgeNativeModuleSource = readFileSync(
  'apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/AppletBridgeNativeModule.swift',
  'utf8',
);
assert.match(iosAppletBridgeNativeModuleSource, /final class AppletBridgeNativeModule: NSObject, LynxModule/);
assert.match(iosAppletBridgeNativeModuleSource, /static var name: String\s*\{\s*"bridge"\s*\}/);
assert.match(iosAppletBridgeNativeModuleSource, /\["invoke": "invoke:"\]/);
assert.match(iosAppletBridgeNativeModuleSource, /init\(param: Any\)/);
assert.match(iosAppletBridgeNativeModuleSource, /session\.dispatch\(method: method, params: params\)/);
assert.match(iosAppletBridgeNativeModuleSource, /AppletManifest\.bridgeProtocol/);
assert.match(iosAppletBridgeNativeModuleSource, /"kind": "response"/);
assert.match(iosAppletBridgeNativeModuleSource, /"ok": ok/);
assert.match(iosAppletBridgeNativeModuleSource, /"result"/);
assert.match(iosAppletBridgeNativeModuleSource, /"error"/);
assert.match(iosAppletBridgeNativeModuleSource, /"INVALID_PARAMS"/);
assert.match(iosAppletBridgeNativeModuleSource, /"INVALID_SESSION"/);
assert.match(iosAppletBridgeNativeModuleSource, /"CAPABILITY_FAILED"/);

const iosLynxViewFactorySource = readFileSync(
  'apps/mobile/ios/PeersTouch/Core/Lynx/LynxViewFactory.swift',
  'utf8',
);
assert.match(iosLynxViewFactorySource, /let config = LynxConfig\(provider: engineManager\.config\?\.templateProvider\)/);
assert.match(iosLynxViewFactorySource, /config\.register\(AppletBridgeNativeModule\.self, param: bridgeSession\)/);
assert.match(iosLynxViewFactorySource, /LynxEnv\.sharedInstance\(\)\.prepareConfig\(config\)/);
assert.match(iosLynxViewFactorySource, /builder\.config = config/);
assert.doesNotMatch(iosLynxViewFactorySource, /builder\.config = self\.engineManager\.config/);

const iosXcodeProjectSource = readFileSync(
  'apps/mobile/ios/PeersTouch.xcodeproj/project.pbxproj',
  'utf8',
);
for (const requiredSource of [
  'AppletManifest.swift in Sources',
  'AppletBundleStorage.swift in Sources',
  'AppletManager.swift in Sources',
  'AppletBridgeSession.swift in Sources',
  'AppletContainerView.swift in Sources',
  'AppletLynxViewRepresentable.swift in Sources',
  'AppletBridgeNativeModule.swift in Sources',
  'LynxViewFactory.swift in Sources',
  'BridgeDispatcher.swift in Sources',
]) {
  assert.match(iosXcodeProjectSource, new RegExp(requiredSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
for (const staleSource of [
  'AppletManifestParser.swift',
  'AppletState.swift',
  'AppletLoadingView.swift',
  'AppletErrorView.swift',
]) {
  assert.doesNotMatch(iosXcodeProjectSource, new RegExp(staleSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

const swiftHarnessPath = path.join(workDir, 'main.swift');
const swiftBinaryPath = path.join(workDir, 'ios-manifest-gate');
writeFileSync(swiftHarnessPath, `import Foundation
import Darwin

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("manifest path argument is required")
}

let manifestURL = URL(fileURLWithPath: CommandLine.arguments[1])
let data: Data
do {
    data = try Data(contentsOf: manifestURL)
} catch {
    fail("failed to read manifest: \\(error)")
}

let manifest: AppletManifest
do {
    manifest = try JSONDecoder().decode(AppletManifest.self, from: data)
} catch {
    fail("failed to decode manifest: \\(error)")
}

let issues = manifest.validate()
if !issues.isEmpty {
    fail("manifest validation failed: " + issues.joined(separator: "; "))
}

guard manifest.targets == ["android", "ios"] else {
    fail("manifest targets were not android,ios")
}
guard manifest.load.android?.type == "lynx-native" else {
    fail("android load type was not lynx-native")
}
guard manifest.iosLoadConfig?.type == "lynx-native" else {
    fail("ios load type was not lynx-native")
}
guard manifest.bridge.protocol_ == AppletManifest.bridgeProtocol else {
    fail("bridge protocol mismatch")
}
guard manifest.permissions.contains("network.request") else {
    fail("network.request permission missing")
}
guard manifest.services.contains(where: { $0.id == "primary-api" }) else {
    fail("primary-api service missing")
}
guard manifest.integrity.files.keys.contains("main.lynx.bundle") else {
    fail("main.lynx.bundle integrity missing")
}

final class EchoBridgeModule: BridgeModule, @unchecked Sendable {
    let moduleName = "storage"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        return ["method": method, "value": params?["value"] ?? NSNull()]
    }
}

final class ThrowingBridgeModule: BridgeModule, @unchecked Sendable {
    enum TestError: Error {
        case failed
    }

    let moduleName = "tasks"

    func handle(method: String, params: [String: Any]?) async throws -> Any? {
        throw TestError.failed
    }
}

let dispatcher = BridgeDispatcher()
dispatcher.register(module: EchoBridgeModule())
dispatcher.register(module: ThrowingBridgeModule())
let session = AppletBridgeSession(manifest: manifest, bridgeDispatcher: dispatcher)
let semaphore = DispatchSemaphore(value: 0)

Task {
    let allowed = try await session.dispatch(method: "storage.get", params: ["value": "ok"])
    guard case .success(let allowedData) = allowed else {
        fail("storage.get should be allowed")
    }
    guard let allowedObject = allowedData as? [String: Any], allowedObject["method"] as? String == "get" else {
        fail("storage.get result was not routed through BridgeDispatcher")
    }

    let denied = try await session.dispatch(method: "navigation.back", params: [:])
    guard case .error(let deniedCode, _) = denied, deniedCode == "PERMISSION_DENIED" else {
        fail("navigation.back should return PERMISSION_DENIED")
    }

    let failed = try await session.dispatch(method: "tasks.start", params: [:])
    guard case .error(let failedCode, _) = failed, failedCode == "CAPABILITY_FAILED" else {
        fail("throwing bridge module should return CAPABILITY_FAILED")
    }

    let malformed = try await session.dispatch(method: "malformed", params: [:])
    guard case .error(let malformedCode, _) = malformed, malformedCode == "INVALID_PARAMS" else {
        fail("malformed method should return INVALID_PARAMS")
    }

    let response = session.makeBridgeResponse(requestId: "ios-request-1", result: denied)
    guard response["protocol"] as? String == AppletManifest.bridgeProtocol else {
        fail("bridge response protocol mismatch")
    }
    guard response["kind"] as? String == "response" else {
        fail("bridge response kind mismatch")
    }
    guard response["appletId"] as? String == manifest.id else {
        fail("bridge response appletId mismatch")
    }
    guard response["sessionId"] as? String == session.sessionId else {
        fail("bridge response sessionId mismatch")
    }
    guard response["ok"] as? Bool == false else {
        fail("bridge response ok=false missing")
    }
    guard let errorObject = response["error"] as? [String: Any], errorObject["code"] as? String == "PERMISSION_DENIED" else {
        fail("bridge response error did not preserve canonical code")
    }

    try session.dispatchLifecycle(.launch)
    try session.dispatchLifecycle(.ready)
    session.destroy()
    do {
        _ = try await session.dispatch(method: "storage.get", params: [:])
        fail("destroyed session should throw")
    } catch AppletError.bridgeFailed {
    } catch {
        fail("destroyed session returned unexpected error: \\(error)")
    }

    semaphore.signal()
}

semaphore.wait()
`);

rmSync(swiftBinaryPath, { force: true });
run('swiftc', [
  'apps/mobile/ios/PeersTouch/Core/Applet/AppletManifest.swift',
  'apps/mobile/ios/PeersTouch/Core/Applet/AppletBundleStorage.swift',
  'apps/mobile/ios/PeersTouch/Core/Applet/AppletManager.swift',
  'apps/mobile/ios/PeersTouch/Core/Lynx/Bridge/BridgeDispatcher.swift',
  'apps/mobile/ios/PeersTouch/Core/Applet/AppletBridgeSession.swift',
  swiftHarnessPath,
  '-o',
  swiftBinaryPath,
]);
run(swiftBinaryPath, [manifestPath]);

const androidJvmTest = runAndroidJvmContractTest();
const iosXcodeBuild = runIosXcodeBuild();

write('mobile/native-manifest-gate-output.txt', [
  'PASS Generated android,ios applet package validates against canonical contract.',
  'PASS Generated package uses lynx-native load entries for Android and iOS.',
  'PASS iOS AppletManifest Swift model decodes and validates the canonical package manifest at runtime.',
  'PASS iOS AppletBundleStorage and AppletManager are included in the executable native manifest/session harness.',
  'PASS iOS Xcode project target includes AppletManifest, bundle storage, manager, session, container, representable, LynxViewFactory, and BridgeDispatcher, with stale placeholder/parser references removed.',
  'PASS iOS AppletContainerView uses AppletManager.loadApplet(id:) and AppletLynxViewRepresentable uses LynxViewFactory instead of a placeholder UIView.',
  'PASS iOS LynxViewFactory registers AppletBridgeNativeModule as the per-session bridge module instead of loading a bare LynxView.',
  'PASS iOS AppletBridgeNativeModule exposes NativeModules.bridge.invoke and returns canonical peers-touch.applet.bridge response envelopes.',
  'PASS iOS AppletBridgeSession and BridgeDispatcher enforce full-method permission, canonical errors, destroyed-session rejection, and response envelopes at runtime.',
  iosXcodeBuild.ran
    ? `PASS iOS Xcode workspace build succeeded. Evidence: ${iosXcodeBuild.output}.`
    : `SKIP iOS Xcode workspace build: ${iosXcodeBuild.reason}. Source and executable Swift harness assertions remain active; this is not iOS Lynx runtime E2E.`,
  'PASS Android manifest parser source models canonical targets/load/services/integrity constraints for the same manifest shape.',
  'PASS Android applet container scans local bundles, resolves sandbox bundle URLs, loads sandbox file bundles via Lynx byte-array render, exposes an intent-gated runtime E2E launch path, and records canonical bridge markers without claiming runtime E2E evidence.',
  androidJvmTest.ran
    ? `PASS Android JVM AppletBridgeSessionContractTest executed with SDK at ${androidJvmTest.sdkRoot}. Evidence: ${androidJvmTest.output}.`
    : `SKIP Android JVM AppletBridgeSessionContractTest: ${androidJvmTest.reason}. Source contract assertions remain active; this is not Android Lynx runtime E2E.`,
  `PASS Package: ${path.relative(process.cwd(), packageDir)}`,
].join('\n'));

process.stdout.write('PASS applet mobile native manifest gate\n');
