import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sha256 } from './release-evidence-check.mjs';
import { INSTALL_ASSETS, checkManifest } from './release-assets.mjs';
import { compareVersions } from './release-version-check.mjs';

function requireFact(condition, code) {
  if (!condition) throw new Error(code);
}

function execute(command, args, options = {}) {
  let descriptor;
  try {
    if (options.inputFile) descriptor = fs.openSync(options.inputFile, 'r');
    return execFileSync(command, args, {
      env: options.environment ?? process.env,
      encoding: 'utf8',
      stdio: [descriptor ?? 'ignore', 'pipe', 'pipe'],
      timeout: options.timeout ?? 300_000,
    });
  } catch (error) {
    throw new Error(`RD_COMMAND_FAILED:${path.basename(command)}:${error.status ?? 'UNKNOWN'}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function expectFailure(command, args, code, environment) {
  const result = spawnSync(command, args, {
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300_000,
  });
  requireFact(result.status !== 0 && result.stderr.includes(code), `RD_EXPECTED_FAILURE_MISSING:${code}`);
  return { rejected: true, code };
}

function productEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|GITHUB|GH_|ACTIONS)/u.test(key)));
}

function parseJSONOutput(output) {
  const line = output.trim().split('\n').at(-1);
  requireFact(line, 'RD_INSTALLER_OUTPUT_MISSING');
  return JSON.parse(line);
}

function readEnvironment(root) {
  return Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').trim().split('\n')
    .map((line) => line.split(/=(.*)/su).slice(0, 2)));
}

function writeEnvironment(file, values) {
  for (const [key, value] of Object.entries(values)) {
    requireFact(/^[A-Z0-9_]+$/u.test(key) && !/[\r\n"'$]/u.test(value), 'RD_ENV_VALUE_INVALID');
  }
  fs.writeFileSync(file, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`,
    { mode: 0o600 });
}

async function downloadRelease({ repo, tag, releaseId, phase, directory, names }) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const token = phase === 'candidate' ? process.env.GH_TOKEN : undefined;
  requireFact(phase !== 'candidate' || token, 'RD_CANDIDATE_TOKEN_REQUIRED');
  const headers = { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const api = `https://api.github.com/repos/${repo}/releases/${releaseId || `tags/${tag}`}`;
  const response = await fetch(api, { headers, signal: AbortSignal.timeout(30_000) });
  requireFact(response.ok, 'RD_RELEASE_DOWNLOAD_FAILED');
  const release = await response.json();
  requireFact(release.tag_name === tag && release.draft === (phase === 'candidate'), 'RD_RELEASE_IDENTITY_MISMATCH');
  const selected = names ? release.assets.filter((asset) => names.includes(asset.name)) : release.assets;
  if (names) {
    for (const name of names) requireFact(selected.some((asset) => asset.name === name), `RD_ASSET_MISSING:${name}`);
  }
  const assets = [];
  for (const asset of selected) {
    requireFact(/^[A-Za-z0-9_.-]+$/u.test(asset.name), 'RD_ASSET_NAME_INVALID');
    const url = phase === 'candidate' ? asset.url : asset.browser_download_url;
    const download = await fetch(url, {
      headers: phase === 'candidate'
        ? { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' }
        : {},
      signal: AbortSignal.timeout(300_000),
    });
    requireFact(download.ok, 'RD_ASSET_DOWNLOAD_FAILED');
    const file = path.join(directory, asset.name);
    const { Readable, Transform } = await import('node:stream');
    const { pipeline } = await import('node:stream/promises');
    const hash = createHash('sha256');
    const digestingStream = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(download.body), digestingStream, fs.createWriteStream(file, { mode: 0o600 }));
    assets.push({ name: asset.name, sha256: hash.digest('hex') });
  }
  return {
    assets,
    availableNames: release.assets.map((asset) => asset.name),
    targetCommitish: release.target_commitish,
  };
}

function verifyStationAssets(directory, assets) {
  for (const name of [...INSTALL_ASSETS, 'checksums.txt']) {
    requireFact(assets.some((asset) => asset.name === name), `RD_ASSET_MISSING:${name}`);
  }
  const entries = fs.readFileSync(path.join(directory, 'checksums.txt'), 'utf8').trim().split('\n');
  for (const name of INSTALL_ASSETS) {
    const expected = entries.find((line) => line.endsWith(`  ${name}`))?.split('  ')[0];
    requireFact(expected === assets.find((asset) => asset.name === name).sha256, 'RD_CHECKSUM_MISMATCH');
  }
}

export async function downloadAssets(options) {
  const requiredNames = [...INSTALL_ASSETS, 'checksums.txt', 'latest.json'];
  const { assets, availableNames } = await downloadRelease({ ...options, names: requiredNames });
  verifyStationAssets(options.directory, assets);
  requireFact(assets.some((asset) => asset.name === 'latest.json'), 'RD_ASSET_MISSING:latest.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(options.directory, 'latest.json'), 'utf8'));
  checkManifest(manifest, { repo: options.repo, tag: options.tag, assets: availableNames });
  return assets;
}

async function reservePorts(count) {
  const net = await import('node:net');
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  }
}

function createTLSMaterial(directory) {
  const certificate = path.join(directory, 'asset-server.crt');
  const privateKey = path.join(directory, 'asset-server.key');
  execute('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', privateKey, '-out', certificate,
  ]);
  fs.chmodSync(certificate, 0o600);
  fs.chmodSync(privateKey, 0o600);
  return { certificate, privateKey };
}

async function startAssetProcess(runtime, tls, versions) {
  const [port] = await reservePorts(1);
  const config = path.join(runtime, `asset-server-${port}.json`);
  fs.writeFileSync(config, JSON.stringify({
    host: '127.0.0.1', port, versions,
    certificate: tls.certificate, privateKey: tls.privateKey,
  }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(new URL('./release-asset-server.mjs', import.meta.url)), config], {
    env: productEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-4096);
  });
  const stop = async () => {
    if (child.exitCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([
      once(child, 'exit'),
      new Promise((resolve) => setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000)),
    ]);
  };
  let ready;
  try {
    ready = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('RD_ASSET_SERVER_TIMEOUT')), 30_000);
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const lineEnd = output.indexOf('\n');
        if (lineEnd < 0) return;
        clearTimeout(timer);
        try {
          resolve(JSON.parse(output.slice(0, lineEnd)));
        } catch {
          reject(new Error('RD_ASSET_SERVER_READY_INVALID'));
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error(`RD_ASSET_SERVER_EXITED:${stderr ? 'WITH_ERROR' : 'EMPTY'}`));
      });
    });
  } catch (error) {
    await stop();
    throw error;
  }
  if (ready.ready !== true || ready.origin !== `https://127.0.0.1:${port}`) {
    await stop();
    throw new Error('RD_ASSET_SERVER_READY_INVALID');
  }
  return {
    origin: ready.origin,
    stop,
  };
}

function installerCommand({ assets, version, operation, root, project, ports, extra = [] }) {
  return [
    path.join(assets, 'install.sh'), operation, '--version', version,
    '--root', root, '--project', project, '--port', String(ports[0]),
    '--libp2p-port', String(ports[1]), ...extra,
  ];
}

function runInstaller(spec, environment) {
  return parseJSONOutput(execute('sh', installerCommand(spec), { environment, timeout: 600_000 }));
}

function rejectInstaller(spec, code, environment) {
  return expectFailure('sh', installerCommand(spec), code, environment);
}

async function requestJSON(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) });
  const text = await response.text();
  requireFact(response.ok, `RD_PRODUCT_HTTP_FAILED:${response.status}`);
  return text ? JSON.parse(text) : {};
}

async function dashboardToken(origin, root) {
  const values = readEnvironment(root);
  const result = await requestJSON(`${origin}/dashboard/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: values.PEERS_DASHBOARD_USERNAME,
      password: values.PEERS_DASHBOARD_PASSWORD,
    }),
  });
  requireFact(typeof result.token === 'string' && result.token.split('.').length === 3, 'RD_DASHBOARD_LOGIN_FAILED');
  return result.token;
}

async function actorByUsername(origin, token, username) {
  const actors = await requestJSON(`${origin}/dashboard/api/actors?search=${encodeURIComponent(username)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const actor = actors.items?.find((item) => item.preferred_username === username);
  requireFact(actor?.ptid, 'RD_PRODUCT_ACTOR_READBACK_FAILED');
  return actor;
}

async function uploadProductObject(origin, token, bucketID, bytes, filename) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/octet-stream' }), filename);
  form.append('visibility', 'public');
  form.append('filename', filename);
  const response = await requestJSON(`${origin}/dashboard/api/oss/buckets/${encodeURIComponent(bucketID)}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  requireFact(response.id && response.key && response.sha256, 'RD_PRODUCT_UPLOAD_FAILED');
  return response;
}

async function seedProduct(origin, root, label = 'seed') {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8);
  const username = `rd${label}${suffix}`.slice(0, 20);
  const password = `Aa1!${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  await requestJSON(`${origin}/actor/sign-up`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: username, email: `${username}@example.invalid`, password }),
  });
  const token = await dashboardToken(origin, root);
  const actor = await actorByUsername(origin, token, username);
  const bucket = await requestJSON(`${origin}/dashboard/api/oss/buckets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      owner_ptid: actor.ptid, name: `rd-${label}-${suffix}`, default_visibility: 'public',
      quota_bytes: 1048576, ttl_days: 0, description: 'release lifecycle fixture',
    }),
  });
  requireFact(bucket.id, 'RD_PRODUCT_BUCKET_CREATE_FAILED');
  const bytes = Buffer.from(`peers-release-${label}-${suffix}`);
  const object = await uploadProductObject(origin, token, bucket.id, bytes, `${label}.bin`);
  const fixture = {
    username, actorPTID: actor.ptid, bucketID: bucket.id, objectID: object.id,
    key: object.key, contentSha256: sha256(bytes),
  };
  await readProduct(origin, root, fixture);
  return fixture;
}

async function readProduct(origin, root, fixture) {
  const token = await dashboardToken(origin, root);
  const actor = await actorByUsername(origin, token, fixture.username);
  requireFact(actor.ptid === fixture.actorPTID, 'RD_PRODUCT_ACTOR_IDENTITY_MISMATCH');
  const objects = await requestJSON(
    `${origin}/dashboard/api/oss/buckets/${encodeURIComponent(fixture.bucketID)}/objects`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const object = objects.items?.find((item) => item.id === fixture.objectID);
  requireFact(object?.key === fixture.key, 'RD_PRODUCT_OBJECT_READBACK_FAILED');
  const response = await fetch(`${origin}/sub-oss/file?key=${encodeURIComponent(fixture.key)}`,
    { signal: AbortSignal.timeout(30_000) });
  requireFact(response.ok, 'RD_PRODUCT_RECEIVER_READ_FAILED');
  const contentSha256 = sha256(Buffer.from(await response.arrayBuffer()));
  requireFact(contentSha256 === fixture.contentSha256, 'RD_PRODUCT_RECEIVER_DIGEST_MISMATCH');
  return {
    actorPTID: actor.ptid, bucketID: fixture.bucketID, objectID: fixture.objectID,
    contentSha256,
  };
}

async function waitHealthy(origin, release, timeout = 180_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`${origin}/sub-oss/healthz`, { signal: AbortSignal.timeout(3000) });
      const value = await requestJSON(`${origin}/app-meta/version`);
      const identity = value.data ?? value;
      if (health.ok && identity.build_commit === release.source && identity.build_label === release.tag) return identity;
    } catch {
      // The container is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('RD_HEALTH_TIMEOUT');
}

function compose(root, project, args, options = {}) {
  return execute('docker', [
    'compose', '-p', project, '--env-file', path.join(root, '.env'),
    '-f', path.join(root, 'docker-compose.yml'), ...args,
  ], options);
}

function createOwnedVolume(name, root) {
  execute('docker', ['volume', 'create', '--label', `sh.peers.install-root=${root}`, name]);
}

function removeOwnedVolume(name, root) {
  const value = JSON.parse(execute('docker', ['volume', 'inspect', name]))[0];
  requireFact(value.Labels?.['sh.peers.install-root'] === root, 'RD_CLEANUP_SCOPE_MISMATCH');
  execute('docker', ['volume', 'rm', name]);
}

async function proveOldProgramCompatibility({
  runtime, project, mainRoot, backup, baselineAssets, baselineRelease, schema, fixture, ports,
}) {
  const root = path.join(runtime, 'compatibility');
  fs.mkdirSync(root, { mode: 0o700 });
  const volumes = [`${project}-pg`, `${project}-data`];
  const values = readEnvironment(mainRoot);
  Object.assign(values, {
    PEERS_STATION_IMAGE: baselineRelease.image,
    PEERS_PG_VOLUME: volumes[0],
    PEERS_DATA_VOLUME: volumes[1],
    PEERS_INSTALL_ROOT: root,
    STATION_PORT: String(ports[0]),
    LIBP2P_PORT: String(ports[1]),
  });
  writeEnvironment(path.join(root, '.env'), values);
  fs.copyFileSync(path.join(baselineAssets, 'docker-compose.yml'), path.join(root, 'docker-compose.yml'));
  for (const volume of volumes) createOwnedVolume(volume, root);
  let cleanup = 'FAIL';
  try {
    execute('docker', [
      'run', '--rm', '--network', 'none', '-i', '-v', `${volumes[1]}:/data`,
      'pgvector/pgvector:pg16', 'tar', '-C', '/data', '-xf', '-',
    ], { inputFile: path.join(backup, 'peers-data.tar') });
    compose(root, project, ['up', '-d', '--wait', 'postgres'], { timeout: 300_000 });
    compose(root, project, [
      'exec', '-T', 'postgres', 'pg_restore', '-U', 'peers', '-d', 'peers_touch',
      '--exit-on-error', '--no-owner',
    ], { inputFile: path.join(backup, 'database.dump') });
    compose(root, project, ['up', '-d', 'station']);
    const origin = `http://127.0.0.1:${ports[0]}`;
    await waitHealthy(origin, baselineRelease);
    const existing = await readProduct(origin, root, fixture);
    const written = await seedProduct(origin, root, 'compat');
    const writtenReadback = await readProduct(origin, root, written);
    cleanup = 'PASS';
    return {
      result: 'FUNCTIONAL_PASS',
      from: JSON.parse(fs.readFileSync(path.join(mainRoot, 'state.json'), 'utf8')).release,
      to: baselineRelease,
      schema,
      readWrite: {
        existingProductReadback: existing.contentSha256 === fixture.contentSha256,
        oldProgramWriteReadback: writtenReadback.contentSha256 === written.contentSha256,
      },
      cleanup: { result: 'PASS' },
    };
  } finally {
    try {
      try {
        compose(root, project, ['down']);
      } catch {
        // Label-scoped cleanup below is the authoritative fallback.
      }
      cleanupOwnedResources(root, [project]);
      cleanup = 'PASS';
    } catch {
      cleanup = 'FAIL';
    }
    requireFact(cleanup === 'PASS', 'RD_COMPATIBILITY_CLEANUP_FAILED');
  }
}

function cleanupOwnedResources(root, projects = []) {
  const containers = execute('docker', [
    'ps', '-aq', '--filter', `label=sh.peers.install-root=${root}`,
  ]).trim().split(/\s+/u).filter(Boolean);
  if (containers.length) execute('docker', ['rm', '-f', ...containers]);
  for (const project of projects) {
    const networks = execute('docker', [
      'network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`,
    ]).trim().split(/\s+/u).filter(Boolean);
    if (networks.length) execute('docker', ['network', 'rm', ...networks]);
  }
  const volumes = execute('docker', [
    'volume', 'ls', '-q', '--filter', `label=sh.peers.install-root=${root}`,
  ]).trim().split(/\s+/u).filter(Boolean);
  for (const volume of volumes) removeOwnedVolume(volume, root);
  requireFact(execute('docker', ['ps', '-aq', '--filter', `label=sh.peers.install-root=${root}`]).trim() === '',
    'RD_CONTAINER_CLEANUP_FAILED');
  requireFact(execute('docker', ['volume', 'ls', '-q', '--filter', `label=sh.peers.install-root=${root}`]).trim() === '',
    'RD_VOLUME_CLEANUP_FAILED');
}

export async function runSuite(options) {
  const { directory, phase, repo, tag, fromTag } = options;
  requireFact(process.env.GITHUB_ACTIONS === 'true', 'RD_REVIEWED_CI_RUNTIME_REQUIRED');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'peers-release-'));
  const project = `rd-${randomUUID().slice(0, 12)}`;
  const root = path.join(runtime, 'station');
  const compatibilityRoot = path.join(runtime, 'compatibility');
  const compatibilityProject = `${project}-compatibility`;
  const assetRoot = path.join(directory, 'assets');
  const baselineRoot = path.join(directory, 'baseline-assets');
  const scenarios = [];
  const report = {
    ...options,
    sourceDigest: options.source,
    suiteRuntimeId: project,
    fixtureEpoch: randomUUID(),
    target: `${os.platform()}-${os.arch()}`,
    assets: [],
    baselineAssets: [],
    scenarios,
    cleanup: { result: 'FAIL' },
    result: 'UNPROVEN',
    unproven: ['RD-T05 native updater install/apply requires a separately bound OS runtime report'],
  };
  let assetServer;
  let tamperServer;
  let installed = false;
  let purged = false;
  let failure;
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(runtime, 'home'), { mode: 0o700 });

  function observed(id, action, value) {
    const name = `${id}.json`;
    fs.writeFileSync(path.join(directory, name), `${JSON.stringify(value, null, 2)}\n`);
    scenarios.push({
      id, action, result: 'FUNCTIONAL_PASS',
      receiver: { observed: true, evidence: name, sha256: sha256(fs.readFileSync(path.join(directory, name))) },
    });
  }

  try {
    report.assets = await downloadAssets({ ...options, directory: assetRoot });
    const release = JSON.parse(fs.readFileSync(path.join(assetRoot, 'station-release.json'), 'utf8'));
    requireFact(release.source === options.source && release.tag === tag, 'RD_SOURCE_MISMATCH');
    report.imageDigest = release.image.split('@')[1];
    let baselineRelease;
    if (phase === 'candidate') {
      requireFact(fromTag && compareVersions(tag, fromTag) > 0, 'RD_REAL_BASELINE_REQUIRED');
      const baselineDownload = await downloadRelease({
        repo, tag: fromTag, phase: 'public', directory: baselineRoot,
        names: [...INSTALL_ASSETS, 'checksums.txt'],
      });
      report.baselineAssets = baselineDownload.assets;
      verifyStationAssets(baselineRoot, report.baselineAssets);
      baselineRelease = JSON.parse(fs.readFileSync(path.join(baselineRoot, 'station-release.json'), 'utf8'));
      requireFact(baselineRelease.tag === fromTag
        && baselineRelease.source === baselineDownload.targetCommitish,
      'RD_BASELINE_SOURCE_MISMATCH');
    }

    const tls = createTLSMaterial(runtime);
    assetServer = await startAssetProcess(runtime, tls, {
      [tag]: assetRoot,
      ...(baselineRelease ? { [fromTag]: baselineRoot } : {}),
    });
    const environment = {
      ...productEnvironment(),
      HOME: path.join(runtime, 'home'),
      CURL_CA_BUNDLE: tls.certificate,
      PEERS_RELEASE_ORIGIN: assetServer.origin,
      DOCKER_CONFIG: process.env.DOCKER_CONFIG || path.join(os.homedir(), '.docker'),
    };
    if (phase === 'public') {
      environment.DOCKER_CONFIG = path.join(runtime, 'anonymous-docker');
      fs.mkdirSync(environment.DOCKER_CONFIG);
      fs.writeFileSync(path.join(environment.DOCKER_CONFIG, 'config.json'), '{}');
    }

    const ports = await reservePorts(2);
    const initialAssets = baselineRelease ? baselineRoot : assetRoot;
    const initialRelease = baselineRelease ?? release;
    const initialVersion = initialRelease.tag;
    const common = { root, project, ports };
    const install = runInstaller({
      assets: initialAssets, version: initialVersion, operation: 'install', ...common,
    }, environment);
    installed = true;
    observed('rd-install', 'invoke the immutable release install.sh against a private TLS asset origin', install);

    const envDigest = sha256(fs.readFileSync(path.join(root, '.env')));
    runInstaller({ assets: initialAssets, version: initialVersion, operation: 'install', ...common }, environment);
    requireFact(envDigest === sha256(fs.readFileSync(path.join(root, '.env'))), 'RD_IDEMPOTENCY_FAILED');
    observed('rd-install-idempotent', 'repeat installation without rotating any generated credential', { preserved: true });

    if (phase === 'candidate') {
      const tampered = path.join(runtime, 'tampered-assets');
      fs.mkdirSync(tampered, { mode: 0o700 });
      for (const name of [...INSTALL_ASSETS, 'checksums.txt']) {
        fs.copyFileSync(path.join(assetRoot, name), path.join(tampered, name));
      }
      fs.appendFileSync(path.join(tampered, 'docker-compose.yml'), '\n# tampered\n');
      tamperServer = await startAssetProcess(runtime, tls, { [tag]: tampered });
      const tamperEnvironment = { ...environment, PEERS_RELEASE_ORIGIN: tamperServer.origin };
      const tamperPorts = await reservePorts(2);
      const rejected = rejectInstaller({
        assets: assetRoot, version: tag, operation: 'install',
        root: path.join(runtime, 'tamper-station'), project: `${project}-tamper`, ports: tamperPorts,
      }, 'RD_CHECKSUM_MISMATCH', tamperEnvironment);
      observed('rd-checksum-reject', 'reject one modified release asset before instance ownership begins', rejected);

      const origin = `http://127.0.0.1:${ports[0]}`;
      const fixture = await seedProduct(origin, root);
      const fixtureReadback = await readProduct(origin, root, fixture);
      const backupResult = runInstaller({
        assets: baselineRoot, version: fromTag, operation: 'backup', ...common,
      }, environment);
      const explicitBackup = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')).backup;
      observed('rd-backup', 'stop writes and capture database, identity, object bytes and configuration', {
        ...backupResult, backupManifest: sha256(fs.readFileSync(path.join(explicitBackup, 'manifest.json'))),
        fixture: fixtureReadback,
      });

      const upgrade = runInstaller({
        assets: assetRoot, version: tag, operation: 'upgrade', ...common,
      }, environment);
      let state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      const upgradeBackup = state.backup;
      requireFact(state.release.source === options.source && state.release.image === release.image,
        'RD_BUILD_IDENTITY_MISMATCH');
      const upgradedReadback = await readProduct(origin, root, fixture);
      observed('rd-upgrade', 'upgrade A to B after a verified backup and read receiver-visible product data', {
        ...upgrade, fixture: upgradedReadback,
      });
      observed('rd-station-start', 'run the candidate Station from the immutable image digest', upgrade);
      observed('rd-station-build-identity', 'read candidate build and image identity after upgrade', {
        source: state.release.source, image: state.release.image, tag: state.release.tag,
      });

      const missingProof = rejectInstaller({
        assets: assetRoot, version: tag, operation: 'rollback', ...common,
        extra: ['--to', fromTag],
      }, 'RD_SCHEMA_COMPATIBILITY_REQUIRED', environment);

      const compatibilityPorts = await reservePorts(2);
      const compatibilityReport = await proveOldProgramCompatibility({
        runtime, project: compatibilityProject, mainRoot: root, backup: upgradeBackup, baselineAssets: baselineRoot,
        baselineRelease, schema: state.schema, fixture, ports: compatibilityPorts,
      });
      const compatibilityReportFile = path.join(directory, 'compatibility-report.json');
      fs.writeFileSync(compatibilityReportFile, `${JSON.stringify(compatibilityReport, null, 2)}\n`);
      const proof = {
        from: release,
        to: baselineRelease,
        schema: state.schema,
        result: 'FUNCTIONAL_PASS',
        readWriteVerified: true,
        suiteReport: path.basename(compatibilityReportFile),
        suiteReportDigest: sha256(fs.readFileSync(compatibilityReportFile)),
      };
      const proofFile = path.join(directory, 'compatibility.json');
      fs.writeFileSync(proofFile, `${JSON.stringify(proof, null, 2)}\n`);
      const wrongProofFile = path.join(directory, 'compatibility-wrong-schema.json');
      fs.writeFileSync(wrongProofFile, `${JSON.stringify({ ...proof, schema: 'wrong-schema' }, null, 2)}\n`);
      const mismatchedProof = rejectInstaller({
        assets: assetRoot, version: tag, operation: 'rollback', ...common,
        extra: ['--to', fromTag, '--compatibility', wrongProofFile],
      }, 'RD_SCHEMA_COMPATIBILITY_MISMATCH', environment);
      observed('rd-rollback-reject', 'reject absent and source/schema-mismatched compatibility evidence', {
        missingProof, mismatchedProof,
      });

      const rollback = runInstaller({
        assets: assetRoot, version: tag, operation: 'rollback', ...common,
        extra: ['--to', fromTag, '--compatibility', proofFile],
      }, environment);
      const rollbackReadback = await readProduct(origin, root, fixture);
      observed('rd-rollback-compatible', 'run the actual old program only after its cloned B-schema read/write proof', {
        ...rollback, fixture: rollbackReadback,
        compatibilityReport: sha256(fs.readFileSync(compatibilityReportFile)),
      });

      runInstaller({ assets: assetRoot, version: tag, operation: 'upgrade', ...common }, environment);
      state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      requireFact(state.release.tag === tag, 'RD_SECOND_UPGRADE_FAILED');
      await readProduct(origin, root, fixture);
      const corruptBackup = path.join(root, 'backups', randomUUID().replaceAll('-', '').slice(0, 24));
      fs.cpSync(upgradeBackup, corruptBackup, { recursive: true });
      fs.appendFileSync(path.join(corruptBackup, 'database.dump'), 'corrupt');
      const corruptRejected = rejectInstaller({
        assets: assetRoot, version: tag, operation: 'rollback', ...common,
        extra: ['--to', fromTag, '--restore-backup', corruptBackup, '--confirm-loss'],
      }, 'RD_BACKUP_CORRUPT', environment);
      const originalVolumes = [...state.volumes];
      const restore = runInstaller({
        assets: assetRoot, version: tag, operation: 'rollback', ...common,
        extra: ['--to', fromTag, '--restore-backup', upgradeBackup, '--confirm-loss'],
      }, environment);
      const restoredState = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      requireFact(restoredState.volumes.some((volume, index) => volume !== originalVolumes[index]),
        'RD_RESTORE_NEW_VOLUMES_REQUIRED');
      const restoreReadback = await readProduct(origin, root, fixture);
      observed('rd-backup-restore', 'reject a corrupt snapshot and restore the complete A snapshot into new volumes', {
        ...restore, corruptRejected, fixture: restoreReadback,
        newVolumes: restoredState.volumes.map((name) => sha256(name)),
      });
    } else {
      const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
      requireFact(state.release.source === options.source && state.release.image === release.image,
        'RD_BUILD_IDENTITY_MISMATCH');
      observed('rd-station-start', 'start Station from an anonymously downloaded public release', install);
      observed('rd-station-build-identity', 'read public build and image identity', {
        source: state.release.source, image: state.release.image, tag: state.release.tag,
      });
    }

    const installedState = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
    const uninstallAssets = installedState.release.tag === tag ? assetRoot : baselineRoot;
    const uninstall = runInstaller({
      assets: uninstallAssets, version: installedState.release.tag, operation: 'uninstall', root, project, ports,
      extra: ['--purge', '--confirm-purge', project],
    }, environment);
    purged = true;
    observed('rd-uninstall', 'uninstall and purge only the currently registered Suite volumes', uninstall);
    report.result = 'FUNCTIONAL_PASS';
  } catch (error) {
    report.error = error.message;
    failure = error;
  } finally {
    let cleanupError;
    try {
      if (installed && !purged && fs.existsSync(path.join(root, 'state.json'))) {
        const state = JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8'));
        const fallbackAssets = state.release.tag === tag ? assetRoot : baselineRoot;
        const [port, libp2pPort] = [
          Number(readEnvironment(root).STATION_PORT),
          Number(readEnvironment(root).LIBP2P_PORT),
        ];
        const environment = {
          ...productEnvironment(),
          HOME: path.join(runtime, 'home'),
          ...(assetServer ? {
            CURL_CA_BUNDLE: path.join(runtime, 'asset-server.crt'),
            PEERS_RELEASE_ORIGIN: assetServer.origin,
          } : {}),
        };
        runInstaller({
          assets: fallbackAssets, version: state.release.tag, operation: 'uninstall',
          root, project, ports: [port, libp2pPort], extra: ['--purge', '--confirm-purge', project],
        }, environment);
      }
    } catch (error) {
      cleanupError = error;
    }
    for (const [ownedRoot, projects] of [
      [root, [project, `${project}-recovery`]],
      [compatibilityRoot, [compatibilityProject]],
    ]) {
      try {
        cleanupOwnedResources(ownedRoot, projects);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) {
      report.result = 'UNPROVEN';
      report.cleanup = { result: 'FAIL', code: cleanupError.message };
      failure ??= cleanupError;
    } else {
      report.cleanup = { result: 'PASS' };
    }
    for (const server of [tamperServer, assetServer]) {
      if (!server) continue;
      try {
        await server.stop();
      } catch (error) {
        report.result = 'UNPROVEN';
        report.cleanup = { result: 'FAIL', code: 'RD_ASSET_SERVER_CLEANUP_FAILED' };
        failure ??= error;
      }
    }
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.writeFileSync(path.join(directory, 'release-suite.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  if (failure) throw failure;
  requireFact(report.result === 'FUNCTIONAL_PASS', report.error || 'RD_SUITE_UNPROVEN');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const options = {
    repo: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    attempt: process.env.GITHUB_RUN_ATTEMPT,
    tag: process.env.GITHUB_REF_NAME,
    source: process.env.GITHUB_SHA,
    releaseId: process.env.PT_RD_RELEASE_ID,
    phase: process.argv[2],
    directory: process.argv[3],
    fromTag: process.env.PT_RD_FROM_TAG,
  };
  runSuite(options).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
