#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { prepareAppletFixturePackage } from './lib/applet-readiness-paths.mjs';

const rootDir = process.cwd();
const skipBuild = process.argv.includes('--skip-build');
const productAppMode = process.argv.includes('--product-app');
const packageArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const usesDefaultFixture = !packageArg;
const packageDir = packageArg ? path.resolve(packageArg) : prepareAppletFixturePackage('generic-complex-applet');
const evidenceDir = path.resolve('tooling/acceptance/evidence/applets/desktop/product-window-gate');
const outputPath = path.resolve('.artifacts/applet-readiness/desktop/product-window-gate-output.txt');
const windowEvidencePath = path.join(evidenceDir, 'product-shell-evidence.json');
const lifecycleEvidencePath = path.join(evidenceDir, 'product-lifecycle-evidence.json');
const sourceAppletRoot = path.resolve('apps/desktop/applets-dist');
const distAppletRoot = path.resolve('apps/desktop/dist/applets-dist');
const sourceIndexPath = path.join(sourceAppletRoot, 'index.json');
const desktopFrontendDist = path.resolve('apps/desktop/dist');
const appShellSourcePath = path.resolve('apps/desktop/src/App.tsx');
const defaultBundleRoot = path.resolve('apps/desktop/src-tauri/target/release/bundle');
const runId = `${process.pid}-${Date.now()}`;
const stableTempRoot = path.resolve(
  process.env.TMPDIR
    ?? process.env.TEMP
    ?? process.env.TMP
    ?? '.local/applet-product-window-gate/tmp',
);
mkdirSync(stableTempRoot, { recursive: true });
const stableProcessEnv = {
  ...process.env,
  TMPDIR: stableTempRoot,
  TEMP: stableTempRoot,
  TMP: stableTempRoot,
};
const isolatedCargoTargetDir = path.resolve(
  process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_CARGO_TARGET_DIR
    ?? '.local/applet-product-window-gate/cargo-target',
);
const isolatedStorageRoot = path.resolve(
  process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_STORAGE_ROOT
    ?? `.local/applet-product-window-gate/storage-${runId}`,
);
const preserveStorageRoot = /^(1|true|TRUE|yes|YES)$/.test(
  process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_PRESERVE_STORAGE_ROOT ?? '',
);
const isolatedProfile = process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_PROFILE
  ?? 'desktop-product-window-certification';
const configuredBundleRoot = process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_BUNDLE_ROOT;
const tauriBundleRoot = configuredBundleRoot
  ? path.resolve(configuredBundleRoot)
  : skipBuild
    ? defaultBundleRoot
    : path.join(isolatedCargoTargetDir, 'release', 'bundle');
const requiredUpstreamUrls = (process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS
  ?? '/api/v1/e2e,/api/v1/e2e/echo,/agent/turn/execute,/chat/completions')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);
const externalStationBaseUrl = (process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL ?? '').trim();
const requiredUpstreamTimeoutMs = Number.parseInt(
  process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS_TIMEOUT_MS ?? '15000',
  10,
);
const postRequiredUpstreamWaitMs = Number.parseInt(
  process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS ?? '0',
  10,
);
const lifecycleMode = (process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_LIFECYCLE ?? '').trim() === '1';
const lifecycleEvidenceTimeoutMs = Number.parseInt(
  process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_LIFECYCLE_TIMEOUT_MS ?? '30000',
  10,
);
const productWindowActorId = (process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_ACTOR_ID ?? 'applet-product-window-e2e-actor').trim()
  || 'applet-product-window-e2e-actor';

mkdirSync(evidenceDir, { recursive: true });

function fail(message, details = []) {
  const output = ['FAIL Desktop packaged product-window applet gate', message, ...details]
    .filter(Boolean)
    .join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stderr.write(`${output}\n`);
  process.exit(1);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...stableProcessEnv, ...(options.env ?? {}) },
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

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return Buffer.from(bytes);
}

function protoBytes(fieldNumber, payload) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  return Buffer.concat([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(body.length),
    body,
  ]);
}

function protoString(fieldNumber, value) {
  return protoBytes(fieldNumber, Buffer.from(value, 'utf8'));
}

function actorProfileProto() {
  return Buffer.concat([
    protoString(1, productWindowActorId),
    protoString(2, 'Applet Product Window Certification'),
    protoString(3, 'applet-product-window-e2e'),
  ]);
}

function peersResponseProto(payload) {
  const any = Buffer.concat([
    protoString(1, 'type.googleapis.com/peers_touch.model.actor.v1.ActorProfile'),
    protoBytes(2, payload),
  ]);
  return Buffer.concat([
    protoString(1, '200'),
    protoString(2, 'ok'),
    protoBytes(3, any),
  ]);
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function writeProto(res, body = Buffer.alloc(0)) {
  res.writeHead(200, { 'content-type': 'application/protobuf' });
  res.end(body);
}

function writeSse(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': product-window-certification\n\n');
}

async function proxyExternalStationRequest(req, res, targetBaseUrl) {
  const target = new URL(req.url ?? '/', targetBaseUrl);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (!value || name.toLowerCase() === 'host' || name.toLowerCase() === 'connection') {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
  const response = await fetch(target, {
    method: req.method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.writeHead(response.status);
  if (!response.body) {
    res.end();
    return;
  }
  for await (const chunk of response.body) {
    res.write(chunk);
  }
  res.end();
}

function productAppletInstallState(manifest) {
  return {
    actorId: productWindowActorId,
    deviceId: 'desktop-default',
    appletId: manifest.id,
    version: manifest.version ?? '0.0.0',
    channel: 1,
    status: 1,
  };
}

function productAppletCatalog(manifest) {
  const installState = productAppletInstallState(manifest);
  const entry = manifest.load?.desktop?.entry ?? manifest.entries?.lynx ?? 'main.lynx.bundle';
  return {
    items: [{
      info: {
        id: manifest.id,
        name: manifest.name ?? manifest.id,
        description: manifest.description ?? '',
        iconUrl: manifest.icon ?? '',
        developerId: manifest.author ?? 'product-window-gate',
        status: 1,
      },
      version: {
        appletId: manifest.id,
        version: manifest.version ?? '0.0.0',
        bundleUrl: `/applets-dist/${manifest.id}/${entry}`,
        bundleHash: '',
        status: 1,
        channel: 1,
        manifest: {
          manifestJson: JSON.stringify(manifest),
          targetPlatforms: ['desktop'],
          permissions: manifest.permissions ?? [],
          capabilities: manifest.capabilities ?? [],
          runtimeType: 'lynx-web',
        },
      },
      installState,
    }],
    totalCount: 1,
  };
}

function startControlledUpstream(manifest) {
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, url: req.url });
    const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (parsed.pathname === '/events/stream') {
      writeSse(res);
      return;
    }
    if (parsed.pathname === '/presence/heartbeat') {
      await readBody(req);
      writeProto(res, protoString(1, 'online'));
      return;
    }
    if (
      parsed.pathname === '/conversation/list'
      || parsed.pathname === '/api/v1/social/friend-requests'
    ) {
      writeProto(res);
      return;
    }
    if (
      parsed.pathname === '/notification/list'
      || parsed.pathname === '/notification/unread-counts'
      || parsed.pathname === '/api/v1/social/users/me'
      || parsed.pathname === '/key-exchange/keys/bundle'
    ) {
      if (req.method !== 'GET') await readBody(req);
      writeProto(res);
      return;
    }
    if (parsed.pathname === '/actor/federation/health') {
      writeProto(res, peersResponseProto(Buffer.alloc(0)));
      return;
    }
    if (parsed.pathname === '/actor/profile') {
      writeProto(res, peersResponseProto(actorProfileProto()));
      return;
    }
    if (parsed.pathname === '/api/v1/applets/catalog') {
      writeJson(res, 200, productAppletCatalog(manifest));
      return;
    }
    if (parsed.pathname === '/api/v1/applets/installed') {
      writeJson(res, 200, { states: [productAppletInstallState(manifest)] });
      return;
    }
    if (req.url === '/api/v1/e2e') {
      res.writeHead(200, { 'content-type': 'application/json', 'x-applet-e2e': 'product-window-network' });
      res.end(JSON.stringify({ message: 'product-window-network-ok' }));
      return;
    }
    if (req.url === '/api/v1/e2e/echo') {
      const body = await readBody(req);
      res.writeHead(201, { 'content-type': 'application/json', 'x-applet-e2e': 'product-window-network-post' });
      res.end(JSON.stringify({ message: 'product-window-network-post-ok', echo: body }));
      return;
    }
    if (req.url === '/agent/turn/execute') {
      await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ messageId: 'product-window-agent-message', content: 'product-window-agent-ok' }));
      return;
    }
    if (req.url === '/chat/completions') {
      await readBody(req);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        model: 'e2e-model-openai',
        choices: [{ message: { role: 'assistant', content: 'product-window-provider-ok' } }],
      }));
      return;
    }
    if (
      externalStationBaseUrl
      && (
        parsed.pathname.startsWith('/applets/')
        || parsed.pathname.startsWith('/sub-agent/')
      )
    ) {
      try {
        await proxyExternalStationRequest(req, res, externalStationBaseUrl);
      } catch (error) {
        writeJson(res, 502, {
          error: 'external_station_proxy_failed',
          path: req.url,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    writeJson(res, 404, { error: 'not_found', path: req.url });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate controlled upstream port'));
        return;
      }
      resolve({ server, requests, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function stagePackage(manifest) {
  const targetDir = path.join(sourceAppletRoot, manifest.id);
  const distTargetDir = path.join(distAppletRoot, manifest.id);
  const packageSourceDir = path.resolve(packageDir);
  const targetIsPackageSource = packageSourceDir === path.resolve(targetDir);
  const backupRoot = path.resolve('.local/applet-product-window-gate', `backup-${process.pid}-${Date.now()}`);
  const backupDir = path.join(backupRoot, manifest.id);
  const distBackupDir = path.join(backupRoot, 'dist-applets-dist');
  const originalIndex = existsSync(sourceIndexPath) ? readFileSync(sourceIndexPath, 'utf8') : null;
  const originalIndexStat = originalIndex === null ? null : statSync(sourceIndexPath);
  const hadTarget = existsSync(targetDir);
  const hadDistAppletRoot = existsSync(distAppletRoot);

  mkdirSync(backupRoot, { recursive: true });
  if (hadTarget) {
    cpSync(targetDir, backupDir, { recursive: true, dereference: true, preserveTimestamps: true });
  }
  if (hadDistAppletRoot) {
    cpSync(distAppletRoot, distBackupDir, { recursive: true, dereference: true, preserveTimestamps: true });
  }

  const stagedSourceDir = targetIsPackageSource && hadTarget ? backupDir : packageSourceDir;
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(stagedSourceDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.split(path.sep).includes('node_modules'),
  });

  const index = originalIndex
    ? JSON.parse(originalIndex)
    : { version: 1, generatedAt: new Date(0).toISOString(), applets: [] };
  index.version = 1;
  index.generatedAt = new Date().toISOString();
  index.applets = [
    ...(Array.isArray(index.applets) ? index.applets.filter((item) => item.id !== manifest.id) : []),
    manifest,
  ];
  writeFileSync(sourceIndexPath, `${JSON.stringify(index, null, 2)}\n`);
  if (hadDistAppletRoot) {
    rmSync(distTargetDir, { recursive: true, force: true });
    cpSync(stagedSourceDir, distTargetDir, {
      recursive: true,
      dereference: true,
      filter: (source) => !source.split(path.sep).includes('node_modules'),
    });
    const distIndexPath = path.join(distAppletRoot, 'index.json');
    const distIndex = existsSync(distIndexPath)
      ? readJson(distIndexPath)
      : { version: 1, generatedAt: new Date(0).toISOString(), applets: [] };
    distIndex.version = 1;
    distIndex.generatedAt = new Date().toISOString();
    distIndex.applets = [
      ...(Array.isArray(distIndex.applets) ? distIndex.applets.filter((item) => item.id !== manifest.id) : []),
      manifest,
    ];
    writeFileSync(distIndexPath, `${JSON.stringify(distIndex, null, 2)}\n`);
  }

  return () => {
    if (originalIndex === null) {
      rmSync(sourceIndexPath, { force: true });
    } else {
      writeFileSync(sourceIndexPath, originalIndex);
      if (originalIndexStat) {
        utimesSync(sourceIndexPath, originalIndexStat.atime, originalIndexStat.mtime);
      }
    }
    rmSync(targetDir, { recursive: true, force: true });
    if (hadTarget) {
      cpSync(backupDir, targetDir, { recursive: true, dereference: true, preserveTimestamps: true });
    }
    rmSync(distAppletRoot, { recursive: true, force: true });
    if (hadDistAppletRoot) {
      mkdirSync(path.dirname(distAppletRoot), { recursive: true });
      cpSync(distBackupDir, distAppletRoot, { recursive: true, dereference: true, preserveTimestamps: true });
    }
    rmSync(backupRoot, { recursive: true, force: true });
  };
}

function findMacApp() {
  const macosDir = path.join(tauriBundleRoot, 'macos');
  if (!existsSync(macosDir)) return null;
  return readdirSync(macosDir)
    .filter((entry) => entry.endsWith('.app'))
    .map((entry) => path.join(macosDir, entry))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0] ?? null;
}

function findMacExecutable(appPath) {
  const macosDir = path.join(appPath, 'Contents', 'MacOS');
  return readdirSync(macosDir)
    .map((entry) => path.join(macosDir, entry))
    .find((entryPath) => (statSync(entryPath).mode & 0o111) !== 0) ?? null;
}

async function waitForEvidence(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    if (existsSync(windowEvidencePath)) {
      return readJson(windowEvidencePath);
    }
    if (child.exitCode !== null) {
      lastState = `app exited with code ${child.exitCode}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(lastState ?? `timed out waiting for ${windowEvidencePath}`);
}

async function waitForJsonEvidence(child, evidencePath, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  while (Date.now() < deadline) {
    if (existsSync(evidencePath)) {
      return readJson(evidencePath);
    }
    if (child.exitCode !== null) {
      lastState = `app exited with code ${child.exitCode}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(lastState ?? `timed out waiting for ${label}: ${evidencePath}`);
}

async function waitForRequiredUpstreamUrls(upstream, requiredUrls, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hitUrls = new Set(upstream.requests.map((request) => request.url));
    const missing = requiredUrls.filter((requiredUrl) => !hitUrls.has(requiredUrl));
    if (missing.length === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const hitUrls = new Set(upstream.requests.map((request) => request.url));
  const missing = requiredUrls.filter((requiredUrl) => !hitUrls.has(requiredUrl));
  assert.deepEqual(missing, [], `controlled upstream did not receive required URLs: ${missing.join(', ')}`);
}

function stopChild(child) {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  child.kill('SIGTERM');
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    }, 1500);
    const done = setTimeout(resolve, 4000);
    child.once('exit', () => {
      clearTimeout(force);
      clearTimeout(done);
      resolve();
    });
  });
}

let restore = null;
let controlledUpstream = null;
let child = null;
let appStdout = '';
let appStderr = '';
let selectedAppPath = '';
let selectedExecutablePath = '';

try {
  if (usesDefaultFixture && !existsSync(path.join(packageDir, 'manifest.json'))) {
    run('node', ['tooling/scripts/create-generic-complex-applet.mjs', packageDir]);
  }

  assert.ok(existsSync(packageDir), `package directory is missing: ${packageDir}`);
  const manifest = readJson(path.join(packageDir, 'manifest.json'));
  assert.equal(typeof manifest.id, 'string', 'certification package manifest.id must be a string');
  assert.ok(manifest.id.trim(), 'certification package manifest.id must be non-empty');
  assert.equal(manifest.load?.desktop?.type, 'lynx-web', 'certification package must declare Desktop lynx-web load config');
  if (!productAppMode) {
    assert.ok(manifest.permissions?.includes('telemetry.track'), 'certification package must be able to write readiness telemetry');
  }
  const appShellSource = readFileSync(appShellSourcePath, 'utf8');
  assert.ok(!appShellSource.includes('AppletReadinessProbeView'), 'packaged product-window gate must not depend on AppletReadinessProbeView');
  assert.ok(
    appShellSource.includes('installAppRuntime()') && appShellSource.includes('<View lifecycle={lifecycle} />'),
    'packaged product-window gate must render the normal App lifecycle shell',
  );

  rmSync(windowEvidencePath, { force: true });
  rmSync(lifecycleEvidencePath, { force: true });
  if (!preserveStorageRoot) {
    rmSync(isolatedStorageRoot, { recursive: true, force: true });
  }
  mkdirSync(isolatedStorageRoot, { recursive: true });

  if (!skipBuild) {
    run('pnpm', ['--filter', '@peers-touch/app-desktop', 'run', 'build']);
    restore = stagePackage(manifest);
    run('pnpm', [
      '--filter',
      '@peers-touch/app-desktop',
      'exec',
      'tauri',
      'build',
      '--bundles',
      'app',
      '--config',
      JSON.stringify({ build: { frontendDist: desktopFrontendDist, beforeBuildCommand: 'true' } }),
    ], {
      env: { CI: 'false', CARGO_TARGET_DIR: isolatedCargoTargetDir },
    });
    restore();
    restore = null;
  }

  const appPath = findMacApp();
  assert.ok(appPath, 'macOS .app bundle is missing; run without --skip-build to create it');
  const executablePath = findMacExecutable(appPath);
  assert.ok(executablePath, 'macOS .app executable is missing');
  selectedAppPath = appPath;
  selectedExecutablePath = executablePath;

  controlledUpstream = await startControlledUpstream(manifest);
  child = spawn(executablePath, [], {
    cwd: path.dirname(executablePath),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...stableProcessEnv,
      PEERS_APPLET_PRODUCT_WINDOW_E2E: '1',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_PRODUCT_APP: productAppMode ? '1' : '0',
      PEERS_APPLET_PRODUCT_WINDOW_E2E_APPLET_ID: manifest.id,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_EVIDENCE: windowEvidencePath,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_LIFECYCLE_EVIDENCE: lifecycleEvidencePath,
      PEERS_APPLET_PRODUCT_WINDOW_E2E_PROVIDER_BASE_URL: controlledUpstream.baseUrl,
      PEERS_APPLET_E2E_BASE_URL: controlledUpstream.baseUrl,
      PEERS_STATION_URL: controlledUpstream.baseUrl,
      PEERS_APPLET_SERVICE_PRIMARY_API: controlledUpstream.baseUrl,
      PEERS_APPLET_SERVICE_STATION_API: controlledUpstream.baseUrl,
      PEERS_APPLET_CLIPBOARD_BACKEND: 'memory',
      PEERS_STORAGE_ROOT: isolatedStorageRoot,
      PT_PROFILE: isolatedProfile,
    },
  });

  child.stdout.on('data', (chunk) => {
    appStdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    appStderr += chunk.toString();
  });

  const timeoutMs = Number.parseInt(process.env.PEERS_APPLET_PRODUCT_WINDOW_E2E_TIMEOUT_MS ?? '120000', 10);
  const evidence = await waitForEvidence(child, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000);
  assert.equal(evidence?.ok, true, 'Gateway readiness telemetry evidence did not report ok=true');
  assert.equal(evidence?.appletId, manifest.id, 'Gateway readiness telemetry evidence appletId did not match package manifest');
  assert.equal(
    evidence?.launchMode,
    'product-window-certification',
    'Gateway evidence did not report product-window certification launch mode',
  );
  assert.equal(evidence?.productShell, true, 'Gateway evidence did not report productShell=true');
  if (productAppMode) {
    assert.equal(
      evidence?.event,
      'applet.product.rendered',
      'Gateway product evidence did not report applet.product.rendered',
    );
    assert.ok(
      typeof evidence?.readySource === 'string' && evidence.readySource.length > 0,
      'Gateway product evidence did not report readySource',
    );
  } else {
    assert.equal(
      evidence?.event,
      'applet.readiness.flow.completed',
      'Gateway readiness telemetry evidence did not report the completion event',
    );
  }

  if (requiredUpstreamUrls.length > 0) {
    const waitMs = Number.isFinite(requiredUpstreamTimeoutMs) && requiredUpstreamTimeoutMs > 0
      ? requiredUpstreamTimeoutMs
      : 15000;
    await waitForRequiredUpstreamUrls(controlledUpstream, requiredUpstreamUrls, waitMs);
    if (Number.isFinite(postRequiredUpstreamWaitMs) && postRequiredUpstreamWaitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, postRequiredUpstreamWaitMs));
    }
  }
  const lifecycleEvidence = lifecycleMode
    ? await waitForJsonEvidence(
      child,
      lifecycleEvidencePath,
      Number.isFinite(lifecycleEvidenceTimeoutMs) && lifecycleEvidenceTimeoutMs > 0
        ? lifecycleEvidenceTimeoutMs
        : 30000,
      'product-window lifecycle evidence',
    )
    : null;
  if (lifecycleMode) {
    assert.equal(lifecycleEvidence?.ok, true, 'Gateway lifecycle evidence did not report ok=true');
    assert.equal(
      lifecycleEvidence?.event,
      'applet.lifecycle.smoothness.completed',
      'Gateway lifecycle evidence did not report applet.lifecycle.smoothness.completed',
    );
  }

  const output = [
    'PASS Desktop packaged product-window applet gate',
    `Package: ${packageDir}`,
    `macOS app: ${appPath}`,
    `Executable: ${executablePath}`,
    `Controlled upstream: ${controlledUpstream.baseUrl}`,
    externalStationBaseUrl ? `External Station upstream: ${externalStationBaseUrl}` : '',
    `Isolated storage root: ${isolatedStorageRoot}`,
    `Preserve storage root: ${preserveStorageRoot ? 'enabled' : 'disabled'}`,
    `Isolated profile: ${isolatedProfile}`,
    `Product app mode: ${productAppMode ? 'enabled' : 'disabled'}`,
    `Lifecycle mode: ${lifecycleMode ? 'enabled' : 'disabled'}`,
    `Required upstream URLs: ${JSON.stringify(requiredUpstreamUrls)}`,
    `Product shell evidence: ${JSON.stringify(evidence)}`,
    lifecycleEvidence ? `Product lifecycle evidence: ${JSON.stringify(lifecycleEvidence)}` : '',
    `Controlled upstream requests: ${JSON.stringify(controlledUpstream.requests)}`,
    appStdout ? `App stdout: ${appStdout}` : '',
    appStderr ? `App stderr: ${appStderr}` : '',
  ].filter(Boolean).join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stdout.write(`${output}\n`);
} catch (error) {
  const output = [
    'FAIL Desktop packaged product-window applet gate',
    error instanceof Error ? error.message : String(error),
    selectedAppPath ? `macOS app: ${selectedAppPath}` : '',
    selectedExecutablePath ? `Executable: ${selectedExecutablePath}` : '',
    controlledUpstream ? `Controlled upstream: ${controlledUpstream.baseUrl}` : '',
    controlledUpstream ? `Controlled upstream requests: ${JSON.stringify(controlledUpstream.requests)}` : '',
    `Isolated storage root: ${isolatedStorageRoot}`,
    `Isolated profile: ${isolatedProfile}`,
    appStdout ? `App stdout: ${appStdout}` : '',
    appStderr ? `App stderr: ${appStderr}` : '',
  ].join('\n');
  writeFileSync(outputPath, `${output}\n`);
  process.stderr.write(`${output}\n`);
  process.exitCode = 1;
} finally {
  if (child) await stopChild(child);
  if (controlledUpstream) {
    await new Promise((resolve) => controlledUpstream.server.close(resolve));
  }
  if (restore) restore();
}
