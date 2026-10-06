#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REQUIRED_GENERATOR_TEST =
  'secure-content generator preserves federated private object reservations and parity';
export const REQUIRED_RUNNER_TEST =
  'private-media source runner rejects missing skipped duplicate and zero-result tests';

export const REQUIRED_GO_TESTS = Object.freeze([
  'TestFederatedPrivateReconcileCommitsSourceOutboxAndReceiverProjection',
  'TestPeerClientPreservesPeerHopRequestIDThroughDirectAndRelayTransports',
  'TestFederatedPrivateObjectGrantBindingKnownAnswer',
  'TestFederatedPrivateObjectProtoReservations',
  'TestFederatedPrivateObjectRequestRejectsNonCanonicalWire',
  'TestFederatedPrivateObjectMetadataHeaderCanonicalBounds',
  'TestFederatedPrivateObjectMetadataHeaderRejectsNonCanonicalBase64URL',
  'TestFederatedPrivateObjectSourceReadAuthorizesAndStreamsRange',
  'TestFederatedPrivateObjectSourceReadRejectsClaimMismatch',
  'TestFederatedPrivateObjectSourceReadRejectsThirdStation',
  'TestFederatedPrivateObjectSourceReadRejectsInvalidTokenTemporalClaims',
  'TestFederatedPrivateObjectRecipientRejectsRevokedEndpointBeforeMint',
  'TestFederatedPrivateObjectDenialsReturnCanonicalNotFound',
  'TestFederatedPrivateObjectRecipientProxyPartitionsAndValidatesHeaders',
  'TestFederatedPrivateObjectRelayRejectsOversizedResponse',
  'TestFederatedPrivateObjectRelayRejectsOversizedFrameBeforeAllocation',
  'TestFederatedPrivateObjectRelayCancellationAcknowledgementReleasesSlot',
  'TestFederatedPrivateObjectRelayLateCancelledResponseKeepsSharedStream',
  'TestFederatedPrivateObjectRelayCancellationSaturationRejectsWithoutDisconnect',
  'TestFederatedPrivateObjectRelayRequestIDWrapRequiresNewStream',
  'TestFederatedPrivateObjectRelayRedactsLogs',
]);

export const REQUIRED_RUST_TESTS = Object.freeze([
  'social::private_media::tests::federated_private_object_grant_binding_known_answer',
  'social::private_media::tests::federated_private_object_metadata_rejects_noncanonical_base64url',
  'social::private_media::tests::remote_private_media_resume_preserves_object_identity',
  'social::private_media::tests::remote_private_media_rejects_descriptor_mismatch',
]);

export const REQUIRED_VITEST_TESTS = Object.freeze([
  'renders remote private image from home station',
  'renders remote private video retry state without direct remote URL',
]);

const GO_PACKAGES = Object.freeze([
  './frame/core/auth/federation/...',
  './frame/core/federation/...',
  './frame/core/plugin/native/subserver/relay-client/...',
  './frame/core/plugin/native/subserver/relay/...',
  './app/subserver/social/...',
]);

function fail(message) {
  throw new Error(`social private media source: ${message}`);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    fail(`${label} is invalid JSON: ${error.message}`);
  }
}

function requireExactPassingResults(required, terminal, matched, label) {
  if (matched === 0) fail(`${label} produced zero required test results`);
  const missing = required.filter((name) => !terminal.has(name));
  if (missing.length > 0) {
    fail(`${label} required tests have no terminal result: ${missing.join(', ')}`);
  }
  const duplicate = required.filter((name) => terminal.get(name).length !== 1);
  if (duplicate.length > 0) {
    fail(`${label} required tests have duplicate terminal results: ${duplicate.join(', ')}`);
  }
  const failed = required.filter((name) => terminal.get(name)[0] !== 'pass');
  if (failed.length > 0) {
    fail(`${label} required tests did not pass: ${failed.join(', ')}`);
  }
  return { status: 'PASS', passed: [...required] };
}

export function validateNodeTap(output) {
  const terminal = new Map();
  let matched = 0;
  for (const line of output.split('\n')) {
    const match = line.match(
      /^\s*(not ok|ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s+(SKIP|TODO).*)?\s*$/u,
    );
    if (!match || match[2] !== REQUIRED_GENERATOR_TEST) continue;
    matched += 1;
    if (match[3]) fail(`Node required test was skipped: ${match[2]}`);
    const results = terminal.get(match[2]) ?? [];
    results.push(match[1] === 'ok' ? 'pass' : 'fail');
    terminal.set(match[2], results);
  }
  return requireExactPassingResults(
    [REQUIRED_GENERATOR_TEST],
    terminal,
    matched,
    'Node',
  );
}

export function validateNodeTestSource(source, requiredName) {
  const escaped = requiredName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const declaration = new RegExp(
    `\\btest\\s*\\(\\s*(['"])${escaped}\\1`,
    'gu',
  );
  const skipped = new RegExp(
    `\\btest\\s*\\.\\s*(?:skip|todo)\\s*\\(\\s*(['"])${escaped}\\1`,
    'gu',
  );
  if (skipped.test(source)) fail(`Node required test was skipped: ${requiredName}`);
  const matches = [...source.matchAll(declaration)];
  if (matches.length === 0) fail(`Node required test is missing: ${requiredName}`);
  if (matches.length !== 1) fail(`Node required test is duplicated: ${requiredName}`);
  return { status: 'PASS', declared: requiredName };
}

export function validateGoTestEvents(output) {
  const terminal = new Map();
  let matched = 0;
  for (const [index, line] of output.split('\n').entries()) {
    if (line.trim() === '') continue;
    const event = parseJson(line, `go test event line ${index + 1}`);
    if (!REQUIRED_GO_TESTS.includes(event.Test)) continue;
    matched += 1;
    if (event.Action === 'skip') {
      fail(`Go required test was skipped: ${event.Test}`);
    }
    if (['pass', 'fail'].includes(event.Action)) {
      const results = terminal.get(event.Test) ?? [];
      results.push(event.Action);
      terminal.set(event.Test, results);
    }
  }
  return requireExactPassingResults(REQUIRED_GO_TESTS, terminal, matched, 'Go');
}

export function validateRustTestList(output) {
  const discovered = new Map();
  for (const line of output.split('\n')) {
    const match = line.match(/^(.+): test$/u);
    if (!match || !REQUIRED_RUST_TESTS.includes(match[1])) continue;
    discovered.set(match[1], (discovered.get(match[1]) ?? 0) + 1);
  }
  if (discovered.size === 0) fail('Rust discovery produced zero required tests');
  const missing = REQUIRED_RUST_TESTS.filter((name) => !discovered.has(name));
  if (missing.length > 0) fail(`Rust required tests are missing: ${missing.join(', ')}`);
  const duplicate = REQUIRED_RUST_TESTS.filter(
    (name) => discovered.get(name) !== 1,
  );
  if (duplicate.length > 0) {
    fail(`Rust required tests are duplicated: ${duplicate.join(', ')}`);
  }
  return { status: 'PASS', discovered: [...REQUIRED_RUST_TESTS] };
}

export function validateRustTestOutput(output) {
  const terminal = new Map();
  let matched = 0;
  for (const line of output.split('\n')) {
    const match = line.match(/^\s*test (.+) \.\.\. (ok|FAILED|ignored)\s*$/u);
    if (!match || !REQUIRED_RUST_TESTS.includes(match[1])) continue;
    matched += 1;
    if (match[2] === 'ignored') {
      fail(`Rust required test was skipped: ${match[1]}`);
    }
    const results = terminal.get(match[1]) ?? [];
    results.push(match[2] === 'ok' ? 'pass' : 'fail');
    terminal.set(match[1], results);
  }
  return requireExactPassingResults(REQUIRED_RUST_TESTS, terminal, matched, 'Rust');
}

export function validateVitestReport(output) {
  const report = parseJson(output, 'Vitest report');
  const terminal = new Map();
  let matched = 0;
  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      if (!REQUIRED_VITEST_TESTS.includes(assertion.title)) continue;
      matched += 1;
      if (['pending', 'skipped', 'todo', 'disabled'].includes(assertion.status)) {
        fail(`Vitest required test was skipped: ${assertion.title}`);
      }
      const results = terminal.get(assertion.title) ?? [];
      results.push(assertion.status === 'passed' ? 'pass' : 'fail');
      terminal.set(assertion.title, results);
    }
  }
  return requireExactPassingResults(
    REQUIRED_VITEST_TESTS,
    terminal,
    matched,
    'Vitest',
  );
}

function walkTestFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTestFiles(absolute));
    } else if (
      entry.isFile()
      && /\.(?:test|spec)\.(?:ts|tsx)$/u.test(entry.name)
    ) {
      files.push(absolute);
    }
  }
  return files;
}

export function discoverVitestFiles(projectRoot) {
  const desktopRoot = path.join(projectRoot, 'apps/desktop');
  const sourceRoot = path.join(desktopRoot, 'src');
  const matchedByName = new Map(
    REQUIRED_VITEST_TESTS.map((name) => [name, []]),
  );
  for (const file of walkTestFiles(sourceRoot)) {
    const contents = fs.readFileSync(file, 'utf8');
    for (const name of REQUIRED_VITEST_TESTS) {
      const occurrences = contents.split(name).length - 1;
      for (let index = 0; index < occurrences; index += 1) {
        matchedByName.get(name).push(file);
      }
    }
  }
  const missing = REQUIRED_VITEST_TESTS.filter(
    (name) => matchedByName.get(name).length === 0,
  );
  if (missing.length > 0) fail(`Vitest required tests are missing: ${missing.join(', ')}`);
  const duplicate = REQUIRED_VITEST_TESTS.filter(
    (name) => matchedByName.get(name).length !== 1,
  );
  if (duplicate.length > 0) {
    fail(`Vitest required tests are duplicated: ${duplicate.join(', ')}`);
  }
  return [
    ...new Set(
      [...matchedByName.values()]
        .flat()
        .map((file) => path.relative(desktopRoot, file).split(path.sep).join('/')),
    ),
  ].sort();
}

function runCommand(run, command, args, options, label) {
  const result = run(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10 * 60 * 1000,
    ...options,
  });
  if (result.error) fail(`${label} failed to execute: ${result.error.message}`);
  if (result.status !== 0) {
    fail(
      `${label} exited with status ${result.status}: `
      + `${String(result.stderr ?? '').trim()}`,
    );
  }
  return String(result.stdout ?? '');
}

export function runPrivateMediaSource({
  projectRoot,
  environment = process.env,
  run = spawnSync,
}) {
  const runnerTestSource = fs.readFileSync(
    path.join(
      projectRoot,
      'tooling/scripts/check-social-private-media-source.test.mjs',
    ),
    'utf8',
  );
  validateNodeTestSource(runnerTestSource, REQUIRED_RUNNER_TEST);

  const nodeOutput = runCommand(
    run,
    process.execPath,
    [
      '--test',
      '--test-reporter=tap',
      '--test-name-pattern',
      `^${REQUIRED_GENERATOR_TEST}$`,
      'tooling/scripts/proto-gen-secure-content.test.mjs',
    ],
    { cwd: projectRoot, env: environment },
    'generator reservation test',
  );
  const nodeResult = validateNodeTap(nodeOutput);

  runCommand(
    run,
    process.execPath,
    ['tooling/scripts/proto-gen-secure-content.mjs', '--check'],
    { cwd: projectRoot, env: environment },
    'secure-content generated parity',
  );

  const goPattern = `^(?:${REQUIRED_GO_TESTS.join('|')})$`;
  const goOutput = runCommand(
    run,
    'go',
    ['test', '-json', '-count=1', '-timeout=120s', '-run', goPattern, ...GO_PACKAGES],
    { cwd: path.join(projectRoot, 'apps/station'), env: environment },
    'Go private media tests',
  );
  const goResult = validateGoTestEvents(goOutput);

  const desktopManifest = path.join(
    projectRoot,
    'apps/desktop/src-tauri/Cargo.toml',
  );
  const rustList = runCommand(
    run,
    'cargo',
    ['test', '--manifest-path', desktopManifest, '--', '--list', '--format', 'terse'],
    { cwd: projectRoot, env: environment },
    'Rust private media discovery',
  );
  validateRustTestList(rustList);
  const rustOutput = runCommand(
    run,
    'cargo',
    [
      'test',
      '--manifest-path',
      desktopManifest,
      'social::private_media::tests::',
      '--',
      '--nocapture',
    ],
    { cwd: projectRoot, env: environment },
    'Rust private media tests',
  );
  const rustResult = validateRustTestOutput(rustOutput);

  const vitestFiles = discoverVitestFiles(projectRoot);
  const vitestOutput = runCommand(
    run,
    'pnpm',
    [
      '--dir',
      'apps/desktop',
      'exec',
      'vitest',
      'run',
      ...vitestFiles,
      '--reporter=json',
      '--silent',
    ],
    { cwd: projectRoot, env: environment },
    'Vitest private media tests',
  );
  const vitestResult = validateVitestReport(vitestOutput);

  for (const manifest of [
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/mobile/src-tauri/Cargo.toml',
  ]) {
    runCommand(
      run,
      'cargo',
      ['check', '--manifest-path', path.join(projectRoot, manifest)],
      { cwd: projectRoot, env: environment },
      `${manifest} compile check`,
    );
  }

  return {
    status: 'PASS',
    node: nodeResult.passed.length + 1,
    go: goResult.passed.length,
    rust: rustResult.passed.length,
    vitest: vitestResult.passed.length,
    rustConsumersCompiled: 2,
  };
}

export function main() {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
  );
  process.stdout.write(
    `${JSON.stringify(runPrivateMediaSource({ projectRoot }))}\n`,
  );
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
