import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..', '..');
const wrapperPath = path.join(scriptDirectory, 'cargo-cache.sh');

function temporaryDirectory(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cargo-cache-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeExecutable(filePath, content) {
  writeFileSync(filePath, content, { mode: 0o755 });
}

function runWrapper(args, env) {
  return spawnSync('/bin/bash', [wrapperPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('repository Cargo config enables the wrapper without sharing target-dir', () => {
  const config = readFileSync(
    path.join(repositoryRoot, '.cargo', 'config.toml'),
    'utf8',
  );
  assert.match(config, /rustc-wrapper = "tooling\/scripts\/cargo-cache\.sh"/);
  assert.doesNotMatch(config, /target-dir|CARGO_TARGET_DIR/);
});

test('wrapper delegates through sccache when the backend is available', (t) => {
  const root = temporaryDirectory(t);
  const trace = path.join(root, 'trace.log');
  const compiler = path.join(root, 'rustc');
  const backend = path.join(root, 'sccache');

  writeExecutable(
    compiler,
    '#!/bin/sh\nprintf "compiler:%s\\n" "$*" >> "$TRACE"\n',
  );
  writeExecutable(
    backend,
    '#!/bin/sh\nprintf "backend:%s\\n" "$*" >> "$TRACE"\nexec "$@"\n',
  );

  const result = runWrapper([compiler, '--crate-name', 'probe'], {
    PT_SCCACHE_BIN: backend,
    PT_CARGO_CACHE_ROOT: path.join(root, 'cache-root'),
    TRACE: trace,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(trace, 'utf8').trim().split('\n'), [
    `backend:${compiler} --crate-name probe`,
    'compiler:--crate-name probe',
  ]);
});

test('wrapper directly executes rustc when caching is disabled or unavailable', (t) => {
  const root = temporaryDirectory(t);
  const compiler = path.join(root, 'rustc');
  const backend = path.join(root, 'sccache');
  const disabledTrace = path.join(root, 'disabled.log');
  const missingTrace = path.join(root, 'missing.log');

  writeExecutable(
    compiler,
    '#!/bin/sh\nprintf "compiler:%s\\n" "$*" >> "$TRACE"\n',
  );
  writeExecutable(
    backend,
    '#!/bin/sh\nprintf "backend:%s\\n" "$*" >> "$TRACE"\nexec "$@"\n',
  );

  const disabled = runWrapper([compiler, '--version'], {
    PT_CARGO_CACHE: '0',
    PT_SCCACHE_BIN: backend,
    TRACE: disabledTrace,
  });
  assert.equal(disabled.status, 0, disabled.stderr);
  assert.equal(readFileSync(disabledTrace, 'utf8'), 'compiler:--version\n');

  const unavailable = runWrapper([compiler, '-vV'], {
    PT_SCCACHE_BIN: path.join(root, 'missing-sccache'),
    TRACE: missingTrace,
  });
  assert.equal(unavailable.status, 0, unavailable.stderr);
  assert.equal(readFileSync(missingTrace, 'utf8'), 'compiler:-vV\n');
});

test('setup preserves Cargo user config and is idempotent', (t) => {
  const root = temporaryDirectory(t);
  const cargoHome = path.join(root, 'cargo-home');
  const machineRoot = path.join(root, 'machine-cache');
  const backend = path.join(root, 'sccache');
  const userConfig = path.join(cargoHome, 'config.toml');

  mkdirSync(cargoHome, { recursive: true });
  writeFileSync(userConfig, '[net]\noffline = true\n');
  writeExecutable(
    backend,
    '#!/bin/sh\ncase "${1:-}" in --show-stats|--start-server) exit 0 ;; *) exit 0 ;; esac\n',
  );

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = runWrapper(['setup'], {
      CARGO_HOME: cargoHome,
      HOME: root,
      PT_CARGO_CACHE_ROOT: machineRoot,
      PT_SCCACHE_BIN: backend,
    });
    assert.equal(result.status, 0, result.stderr);
  }

  const config = readFileSync(userConfig, 'utf8');
  assert.equal(
    config.match(/# BEGIN peers-touch cargo cache/g)?.length,
    1,
  );
  assert.match(config, /\[net\]\noffline = true/);
  assert.match(
    readFileSync(path.join(machineRoot, 'config.toml'), 'utf8'),
    /rustc-wrapper = ".+peers-rustc-wrapper"/,
  );
});

test('Cargo discovers the root config from a nested crate and keeps a local target', (t) => {
  execFileSync('cargo', ['--version'], { stdio: 'ignore' });

  const root = temporaryDirectory(t);
  const nestedCrate = path.join(root, 'apps', 'probe', 'src-tauri');
  const copiedWrapper = path.join(root, 'tooling', 'scripts', 'cargo-cache.sh');
  const fakeBackend = path.join(root, 'bin', 'sccache');
  const trace = path.join(root, 'wrapper.log');

  mkdirSync(path.join(root, '.cargo'), { recursive: true });
  mkdirSync(path.dirname(copiedWrapper), { recursive: true });
  mkdirSync(path.dirname(fakeBackend), { recursive: true });
  mkdirSync(path.join(nestedCrate, 'src'), { recursive: true });

  writeFileSync(
    path.join(root, '.cargo', 'config.toml'),
    '[build]\nrustc-wrapper = "tooling/scripts/cargo-cache.sh"\n',
  );
  writeFileSync(copiedWrapper, readFileSync(wrapperPath), { mode: 0o755 });
  writeExecutable(
    fakeBackend,
    '#!/bin/sh\nprintf "backend:%s\\n" "$*" >> "$TRACE"\nexec "$@"\n',
  );
  writeFileSync(
    path.join(nestedCrate, 'Cargo.toml'),
    [
      '[package]',
      'name = "cargo-cache-discovery-probe"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
    ].join('\n'),
  );
  writeFileSync(
    path.join(nestedCrate, 'src', 'lib.rs'),
    'pub fn probe() -> u64 { 42 }\n',
  );

  const result = spawnSync('cargo', ['check', '--offline', '--quiet'], {
    cwd: nestedCrate,
    encoding: 'utf8',
    env: {
      ...process.env,
      CARGO_INCREMENTAL: '0',
      PT_CARGO_CACHE_ROOT: path.join(root, 'cache-root'),
      PT_SCCACHE_BIN: fakeBackend,
      TRACE: trace,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(trace, 'utf8'), /backend:/);
  assert.equal(
    readFileSync(path.join(nestedCrate, 'target', 'CACHEDIR.TAG'), 'utf8')
      .includes('Signature: 8a477f597d28d172789f06886806bc55'),
    true,
  );
});
