import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findExecutable } from './doctor.mjs';

// Toolchain bootstrapper for `make dev-up`.
//
// Design:
// - idempotent: every step first re-checks the requirement and no-ops when met;
// - system-wide tools go into /opt/peers-dev with one /etc/profile.d entry,
//   so full teardown is "rm -rf /opt/peers-dev + remove apt packages";
// - China-reachable mirrors are used by default (aliyun for Go/docker-ce apt,
//   npmmirror for Node, rsproxy for Rust); override with BOOTSTRAP_* env vars;
// - never caches passwords; `sudo -n` must work or bootstrap fails loudly.

const GO_REQUIRED_READOVER = [
  'apps/station/app/go.mod',
  'go.work',
];
const NODE_MIN_MAJOR = 20;
const INSTALL_ROOT = process.env.BOOTSTRAP_INSTALL_ROOT || '/opt/peers-dev';
const PROFILE_D = '/etc/profile.d/peers-dev.sh';
const PROFILE_D_CONTENT = [
  '# Peers-Touch developer toolchain (managed by devctl bootstrap)',
  `export PATH="${INSTALL_ROOT}/go/bin:${INSTALL_ROOT}/node/bin:$HOME/.cargo/bin:$PATH"`,
  '',
].join('\n');

const ALIYUN_DOCKER_APT = 'https://mirrors.aliyun.com/docker-ce/linux/debian';
const ALIYUN_GO_BASE = process.env.BOOTSTRAP_GO_BASE || 'https://mirrors.aliyun.com/golang';
const NODE_DIST_BASE = process.env.BOOTSTRAP_NODE_BASE
  || 'https://npmmirror.com/mirrors/node';
const RUSTUP_DIST_SERVER = process.env.BOOTSTRAP_RUSTUP_DIST || 'https://rsproxy.cn';

const APT_DOCKER_PACKAGES = [
  'docker-ce',
  'docker-ce-cli',
  'containerd.io',
  'docker-buildx-plugin',
  'docker-compose-plugin',
];
// Tauri 2 Linux client build dependencies (webkit 4.1 stack).
const APT_CLIENT_PACKAGES = [
  'build-essential',
  'curl',
  'wget',
  'file',
  'libwebkit2gtk-4.1-dev',
  'libssl-dev',
  'libxdo-dev',
  'libayatana-appindicator3-dev',
  'librsvg2-dev',
];
const APT_BASE_PACKAGES = [
  'ca-certificates',
  'curl',
  'gnupg',
  'git',
  'make',
  'python3',
  'protobuf-compiler',
  'uidmap',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    env: options.env ?? process.env,
  });
  if (options.capture) {
    if (result.error) return { status: null, stdout: '', stderr: String(result.error) };
    return {
      status: result.status,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  }
  if (result.error || result.status !== 0) {
    throw new BootError(
      `command failed: ${command} ${args.join(' ')}`,
      result.error ? String(result.error) : result.stderr,
    );
  }
  return result;
}

export class BootError extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'BootError';
    this.detail = detail;
  }
}

function log(message) {
  process.stdout.write(`[bootstrap] ${message}\n`);
}

export function detectPlatform() {
  if (process.platform === 'darwin') {
    return { family: 'darwin', release: os.release(), arch: process.arch };
  }
  if (process.platform === 'linux') {
    const release = readOsRelease();
    const ids = [release.ID, ...(release.ID_LIKE ?? '').split(/\s+/u)].filter(Boolean);
    let family = 'unknown-linux';
    if (ids.some((id) => ['debian', 'ubuntu'].includes(id))) {
      family = 'debian';
    } else if (ids.some((id) => ['rhel', 'centos', 'fedora', 'rocky', 'almalinux'].includes(id))) {
      family = 'rhel';
    }
    return {
      family,
      release,
      codename: release.VERSION_CODENAME,
      arch: process.arch,
    };
  }
  if (process.platform === 'win32') {
    return { family: 'win32', arch: process.arch };
  }
  return { family: 'unknown', arch: process.arch };
}

function readOsRelease() {
  const values = {};
  for (const file of ['/etc/os-release', '/usr/lib/os-release']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/u)) {
      const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
      if (match) {
        values[match[1]] = match[2].replaceAll(/^"|"$/gu, '');
      }
    }
    break;
  }
  return values;
}

function sudoAvailable() {
  const result = run('sudo', ['-n', 'true'], { capture: true });
  return result.status === 0;
}

function sudo(args, options) {
  return run('sudo', ['-n', ...args], options);
}

function versionLine(executable, args = ['--version']) {
  if (!executable) return undefined;
  const result = run(executable, args, { capture: true });
  if (result.status !== 0) return undefined;
  return `${result.stdout}${result.stderr}`.trim().split(/\r?\n/u)[0];
}

function parseSemver(text) {
  const match = text?.match(/(\d+)\.(\d+)(?:\.(\d+))?/u);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function atLeast(version, required) {
  if (!version) return false;
  for (let i = 0; i < required.length; i += 1) {
    if ((version[i] ?? 0) > required[i]) return true;
    if ((version[i] ?? 0) < required[i]) return false;
  }
  return true;
}

function readGoRequired(root) {
  for (const relative of GO_REQUIRED_READOVER) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const match = fs.readFileSync(file, 'utf8').match(/^go\s+(\d+\.\d+(?:\.\d+)?)/mu);
    if (match) return parseSemver(match[1]);
  }
  return [1, 24, 0];
}

function toolPresent(name, predicate) {
  const executable = findExecutable(name);
  if (!executable) return false;
  if (predicate) return Boolean(predicate(executable));
  return true;
}

function writeProfileD() {
  const tmp = path.join(os.tmpdir(), `peers-dev-profile-${process.pid}`);
  fs.writeFileSync(tmp, PROFILE_D_CONTENT, { mode: 0o644 });
  sudo(['mkdir', '-p', '/etc/profile.d']);
  sudo(['install', '-m', '0644', tmp, PROFILE_D]);
  fs.rmSync(tmp, { force: true });
}

function bootstrapEnv() {
  return {
    ...process.env,
    PATH: ['/opt/peers-dev/go/bin', '/opt/peers-dev/node/bin', path.join(os.homedir(), '.cargo', 'bin'), process.env.PATH].join(path.delimiter),
  };
}

function installGo(root) {
  const required = readGoRequired(root);
  const current = parseSemver(versionLine(findExecutable('go')));
  if (atLeast(current, required)) {
    log(`go ${current.join('.')} already satisfies ${required.join('.')}`);
    return false;
  }
  const version = `${required[0]}.${required[1]}.${required[2]}`;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url = `${ALIYUN_GO_BASE}/go${version}.linux-${arch}.tar.gz`;
  log(`installing go ${version} from ${url}`);
  sudo(['mkdir', '-p', INSTALL_ROOT]);
  const archive = path.join(os.tmpdir(), `go-${version}.tar.gz`);
  run('curl', ['-fsSL', '--retry', '3', '-o', archive, url]);
  sudo(['rm', '-rf', path.join(INSTALL_ROOT, 'go')]);
  sudo(['tar', '-C', INSTALL_ROOT, '-xzf', archive]);
  fs.rmSync(archive, { force: true });
  writeProfileD();
  return true;
}

function resolveLatestNodeLts() {
  const result = run('curl', ['-fsSL', '--retry', '3', `${NODE_DIST_BASE}/index.json`], { capture: true });
  if (result.status !== 0) return undefined;
  try {
    const entries = JSON.parse(result.stdout);
    const lts = entries
      .filter((entry) => Boolean(entry.lts))
      .sort((left, right) => {
        const leftVersion = parseSemver(enterVersion(left));
        const rightVersion = parseSemver(enterVersion(right));
        return compareVersions(rightVersion, leftVersion);
      })[0];
    return lts ? enterVersion(lts).replace(/^v/u, '') : undefined;
  } catch {
    return undefined;
  }
}

function enterVersion(entry) {
  return entry.version ?? '';
}

function compareVersions(left, right) {
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function installNode() {
  const current = parseSemver(versionLine(findExecutable('node')));
  if (current && current[0] >= NODE_MIN_MAJOR) {
    log(`node ${current.join('.')} already present`);
    return false;
  }
  const version = resolveLatestNodeLts();
  if (!version) {
    throw new BootError('cannot resolve latest Node LTS', `GET ${NODE_DIST_BASE}/index.json`);
  }
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const url = `${NODE_DIST_BASE}/v${version}/node-v${version}-linux-${arch}.tar.xz`;
  log(`installing node ${version} (LTS) from ${url}`);
  sudo(['mkdir', '-p', INSTALL_ROOT]);
  const archive = path.join(os.tmpdir(), `node-${version}.tar.xz`);
  run('curl', ['-fsSL', '--retry', '3', '-o', archive, url]);
  sudo(['rm', '-rf', path.join(INSTALL_ROOT, 'node')]);
  sudo(['mkdir', '-p', path.join(INSTALL_ROOT, 'node')]);
  sudo(['tar', '-C', path.join(INSTALL_ROOT, 'node'), '--strip-components=1', '-xJf', archive]);
  fs.rmSync(archive, { force: true });
  writeProfileD();
  return true;
}

function enableCorepackAndPnpm() {
  const env = bootstrapEnv();
  const nodeBin = path.join(INSTALL_ROOT, 'node', 'bin');
  if (!fs.existsSync(path.join(nodeBin, 'corepack'))) {
    return false;
  }
  // corepack shims live next to the node binaries (root-owned directory).
  const corepack = path.join(nodeBin, 'corepack');
  const result = run('sudo', ['-n', 'env', `COREPACK_NPM_REGISTRY=${process.env.BOOTSTRAP_NPM_REGISTRY || 'https://registry.npmmirror.com'}`, corepack, 'enable'], { capture: true, env });
  if (result.status !== 0) {
    throw new BootError('corepack enable failed', result.stderr);
  }
  // Persist a China-reachable npm registry for corepack/npm downloads.
  const npmrc = path.join(os.homedir(), '.npmrc');
  const line = 'registry=https://registry.npmmirror.com';
  const existing = fs.existsSync(npmrc) ? fs.readFileSync(npmrc, 'utf8') : '';
  if (!existing.split(/\r?\n/u).some((entry) => entry.startsWith('registry='))) {
    fs.writeFileSync(npmrc, `${existing.trimEnd()}\n${line}\n`.trimStart(), { mode: 0o600 });
  }
  log('corepack enabled; pnpm resolves via the packageManager field');
  return true;
}

function installRust() {
  if (toolPresent('rustc') && toolPresent('cargo')) {
    log('rust toolchain already present');
    return false;
  }
  const archTriplet = process.arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  const url = `${RUSTUP_DIST_SERVER}/rustup/dist/${archTriplet}/rustup-init`;
  const installer = path.join(os.tmpdir(), 'rustup-init');
  log(`installing rust via rustup from ${RUSTUP_DIST_SERVER}`);
  run('curl', ['-fsSL', '--retry', '3', '-o', installer, url]);
  fs.chmodSync(installer, 0o755);
  run(installer, ['-y', '--no-modify-path', '--default-toolchain', 'stable', '--profile', 'minimal'], {
    env: {
      ...bootstrapEnv(),
      RUSTUP_DIST_SERVER,
      RUSTUP_UPDATE_ROOT: `${RUSTUP_DIST_SERVER}/rustup/rustup`,
    },
  });
  fs.rmSync(installer, { force: true });
  writeProfileD();
  const cargoHome = process.env.CARGO_HOME ?? path.join(os.homedir(), '.cargo');
  fs.mkdirSync(path.join(cargoHome), { recursive: true });
  fs.writeFileSync(path.join(cargoHome, 'config.toml'), [
    '[source.crates-io]',
    `replace-with = "${process.env.BOOTSTRAP_CARGO_MIRROR || 'rsproxy-sparse'}"`,
    '[source.rsproxy-sparse]',
    'registry = "sparse+https://rsproxy.cn/index/"',
    '[registries.rsproxy]',
    'index = "https://rsproxy.cn/crates.io-index"',
    '[net]',
    'git-fetch-with-cli = true',
    '',
  ].join('\n'));
  return true;
}

function aptUpdated(force = false) {
  if (!force && process.env.PT_BOOTSTRAP_APT_UPDATED === '1') return;
  log('apt-get update');
  sudo(['apt-get', 'update', '-qq']);
  process.env.PT_BOOTSTRAP_APT_UPDATED = '1';
}

function aptInstall(packages) {
  aptUpdated();
  log(`apt-get install ${packages.join(' ')}`);
  sudo(['apt-get', 'install', '-y', '--no-install-recommends', ...packages]);
}

function configureDockerApt(codename) {
  const keyring = '/etc/apt/keyrings/docker.gpg';
  const list = '/etc/apt/sources.list.d/docker.list';
  if (fs.existsSync(list)) return;
  log('configuring docker-ce apt repository (aliyun mirror)');
  sudo(['install', '-m', '0755', '-d', '/etc/apt/keyrings']);
  const key = path.join(os.tmpdir(), 'docker.asc');
  run('curl', ['-fsSL', '--retry', '3', '-o', key, `${ALIYUN_DOCKER_APT}/gpg`]);
  sudo(['bash', '-c', `gpg --dearmor < ${key} > ${keyring}`]);
  fs.rmSync(key, { force: true });
  sudo(['chmod', 'a+r', keyring]);
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  sudo(['bash', '-c',
    `echo "deb [arch=${arch} signed-by=${keyring}] ${ALIYUN_DOCKER_APT} ${codename} stable" > ${list}`]);
}

function configureDockerDaemon(insecureRegistries) {
  if (!insecureRegistries?.length) return;
  const configPath = '/etc/docker/daemon.json';
  let config = {};
  const cat = run('sudo', ['-n', 'cat', configPath], { capture: true });
  if (cat.status === 0 && cat.stdout.trim()) {
    try {
      config = JSON.parse(cat.stdout);
    } catch {
      throw new BootError('cannot parse existing /etc/docker/daemon.json', cat.stdout);
    }
  }
  const current = new Set(config['insecure-registries'] ?? []);
  let changed = false;
  for (const registry of insecureRegistries) {
    if (!current.has(registry)) {
      current.add(registry);
      changed = true;
    }
  }
  if (!changed) return;
  config['insecure-registries'] = [...current].sort();
  log(`configuring docker insecure-registries: ${[...current].join(', ')}`);
  const tmp = path.join(os.tmpdir(), 'daemon.json');
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`);
  sudo(['install', '-m', '0644', '-D', tmp, configPath]);
  fs.rmSync(tmp, { force: true });
  sudo(['systemctl', 'restart', 'docker']);
}

function bootstrapDebian(root, options, platform) {
  const actions = [];
  if (!sudoAvailable()) {
    throw new BootError(
      'passwordless sudo is required for Linux bootstrap ("sudo -n true" failed)',
      'Run on an account with nopasswd sudo, or install the toolchain manually (see manual appendix).',
    );
  }

  aptInstall(APT_BASE_PACKAGES);

  if (!toolPresent('docker')) {
    configureDockerApt(platform.codename || 'bookworm');
    // The docker source was added after the first apt update, so refresh.
    aptUpdated(true);
    aptInstall(APT_DOCKER_PACKAGES);
    sudo(['systemctl', 'enable', '--now', 'docker']);
    actions.push('docker-installed');
  }
  configureDockerDaemon(options.insecureRegistries);
  let reloginRequired = false;
  if (!groupsContainDocker()) {
    sudo(['usermod', '-aG', 'docker', os.userInfo().username]);
    actions.push('docker-group-added');
    reloginRequired = true;
    log('user added to docker group; a new login session is required to use docker without sudo');
  }

  if (installGo(root)) actions.push('go-installed');
  if (installNode()) actions.push('node-installed');
  if (enableCorepackAndPnpm()) actions.push('corepack-enabled');
  if (installRust()) actions.push('rust-installed');

  if (options.withClientDeps) {
    aptInstall(APT_CLIENT_PACKAGES);
    actions.push('client-deps-installed');
  }
  return { actions, reloginRequired };
}

function groupsContainDocker() {
  const names = run('id', ['-nG'], { capture: true }).stdout.split(/\s+/u);
  return names.includes('docker');
}

function bootstrapDarwin(root, options) {
  if (!toolPresent('brew')) {
    throw new BootError(
      'Homebrew is required on macOS but was not found',
      'Install Homebrew first, then rerun "make dev-up".',
    );
  }
  const formulae = ['go', 'node', 'protobuf', 'python@3'];
  for (const formula of formulae) {
    if (run('brew', ['list', formula], { capture: true }).status !== 0) {
      run('brew', ['install', formula]);
    }
  }
  if (!toolPresent('rustc')) {
    run('brew', ['install', 'rustup-init']);
    run('rustup-init', ['-y', '--no-modify-path', '--default-toolchain', 'stable', '--profile', 'minimal']);
  }
  if (!toolPresent('docker')) {
    run('brew', ['install', '--cask', 'docker']);
    log('Docker Desktop installed; first launch needs a manual EULA acceptance, then rerun dev-up');
  }
  if (options.withClientDeps) {
    log('Tauri client builds on macOS use Xcode Command Line Tools; run "xcode-select --install" if missing');
  }
}

// options:
//   checkOnly         report what is missing, install nothing
//   noInstall         same as checkOnly (make flag alias)
//   withClientDeps    install Linux webkit/Tauri system packages
//   insecureRegistries  hostnames to add to docker daemon insecure-registries
export async function runBootstrap(root, environment = process.env, options = {}) {
  const platform = detectPlatform();
  const report = {
    platform,
    installRoot: INSTALL_ROOT,
    actions: [],
  };

  if (platform.family === 'win32') {
    throw new BootError('Windows automatic bootstrap is not implemented yet', 'Use the manual appendix.');
  }

  if (!options.checkOnly && !options.noInstall) {
    if (platform.family === 'debian') {
      const result = bootstrapDebian(root, options, platform);
      report.actions = result.actions;
      report.reloginRequired = result.reloginRequired;
    } else if (platform.family === 'darwin') {
      bootstrapDarwin(root, options);
    } else if (platform.family === 'rhel') {
      throw new BootError(
        `Automatic bootstrap for RPM family (${platform.release?.ID ?? 'unknown'}) is not implemented yet`,
        'dnf equivalents of the apt steps are documented in the manual; contributions welcome',
      );
    } else {
      throw new BootError(`Unsupported Linux distribution: ${platform.release?.PRETTY_NAME ?? 'unknown'}`);
    }
  }

  return report;
}
