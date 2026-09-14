#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  chmodSync,
  copyFileSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const STATION_MODULE = 'github.com/peers-labs/peers-touch/station';
const STATION_PACKAGE_PREFIX = `${STATION_MODULE}/`;
const DEFAULT_BUDGET_SECONDS = 600;
const MAX_BUDGET_SECONDS = 1_200;

export const PROTO_INPUTS = Object.freeze([
  'domain/common/common.proto',
  'domain/secure_content/content.proto',
  'domain/secure_content/object.proto',
  'domain/social/post.proto',
  'domain/social/comment.proto',
  'domain/social/media.proto',
  'domain/social/poll.proto',
  'domain/social/circle.proto',
  'domain/social/relationship.proto',
  'domain/social/private_content.proto',
  'domain/key_exchange/key_exchange.proto',
]);

const ALLOWED_PROTO_ROOTS = Object.freeze([
  'domain/common',
  'domain/secure_content',
  'domain/social',
  'domain/key_exchange',
]);

const GO_OUTPUT_DIRECTORIES = Object.freeze({
  'domain/common/common.proto': 'frame/core/types',
  'domain/secure_content/content.proto': 'frame/core/types/securecontent',
  'domain/secure_content/object.proto': 'frame/core/types/securecontent',
  'domain/social/post.proto': 'frame/touch/model',
  'domain/social/comment.proto': 'frame/touch/model',
  'domain/social/media.proto': 'frame/touch/model',
  'domain/social/poll.proto': 'frame/touch/model',
  'domain/social/circle.proto': 'frame/touch/model',
  'domain/social/relationship.proto': 'frame/touch/model',
  'domain/social/private_content.proto': 'frame/touch/model/privatecontent',
  'domain/key_exchange/key_exchange.proto': 'app/subserver/key_exchange/model',
});

const GO_PACKAGE_NAMES = Object.freeze({
  'domain/common/common.proto': 'types',
  'domain/secure_content/content.proto': 'securecontent',
  'domain/secure_content/object.proto': 'securecontent',
  'domain/social/post.proto': 'model',
  'domain/social/comment.proto': 'model',
  'domain/social/media.proto': 'model',
  'domain/social/poll.proto': 'model',
  'domain/social/circle.proto': 'model',
  'domain/social/relationship.proto': 'model',
  'domain/social/private_content.proto': 'privatecontent',
  'domain/key_exchange/key_exchange.proto': 'model',
});

const OUTPUT_ROOT_BY_CHANNEL = Object.freeze({
  go: 'apps/station',
  'desktop-ts': 'apps/desktop/src/gen/proto',
  'mobile-ts': 'apps/mobile/src/gen/proto',
});

export class SecureContentProtoError extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = 'SecureContentProtoError';
    this.code = code;
    this.detail = detail;
  }
}

function fail(code, message, detail = {}) {
  throw new SecureContentProtoError(code, message, detail);
}

function canonicalRoot(value) {
  try {
    return realpathSync(value);
  } catch (error) {
    fail('PROJECT_ROOT_INVALID', 'project root is unavailable', {
      root: value,
      cause: String(error),
    });
  }
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function assertRepositoryPath(projectRoot, relativePath, label) {
  if (
    typeof relativePath !== 'string' ||
    relativePath === '' ||
    path.isAbsolute(relativePath)
  ) {
    fail('PATH_OUTSIDE_REPOSITORY', `${label} must be repository-relative`);
  }
  const normalized = path.normalize(relativePath);
  const absolute = path.resolve(projectRoot, normalized);
  if (
    normalized === '.' ||
    normalized.startsWith(`..${path.sep}`) ||
    !isWithin(projectRoot, absolute)
  ) {
    fail('PATH_OUTSIDE_REPOSITORY', `${label} escapes the repository`, {
      path: relativePath,
    });
  }
  return { relative: normalized.split(path.sep).join('/'), absolute };
}

function assertNoSymlinkParents(root, destination) {
  const relative = path.relative(root, destination);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    fail('PATH_OUTSIDE_OUTPUT_MANIFEST', 'generated output escapes its root', {
      path: destination,
    });
  }
  const segments = relative.split(path.sep).slice(0, -1);
  let current = root;
  for (const segment of segments) {
    current = path.join(current, segment);
    if (!existsSync(current)) continue;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) {
      fail('PATH_OUTSIDE_OUTPUT_MANIFEST', 'output parent must not be a symlink', {
        path: current,
      });
    }
    if (!stats.isDirectory()) {
      fail('PATH_OUTSIDE_OUTPUT_MANIFEST', 'output parent is not a directory', {
        path: current,
      });
    }
  }
}

function parseGoPackage(protoPath, input) {
  const source = readFileSync(protoPath, 'utf8');
  const matches = [
    ...source.matchAll(/^\s*option\s+go_package\s*=\s*"([^"]+)"\s*;/gm),
  ];
  if (matches.length !== 1) {
    fail('GO_PACKAGE_INVALID', 'proto must declare exactly one go_package', {
      proto: protoPath,
    });
  }
  const [importPath, packageName = ''] = matches[0][1].split(';');
  const expectedDirectory = GO_OUTPUT_DIRECTORIES[input];
  const expectedImportPath = `${STATION_PACKAGE_PREFIX}${expectedDirectory}`;
  const expectedPackageName = GO_PACKAGE_NAMES[input];
  if (
    importPath !== expectedImportPath ||
    packageName !== expectedPackageName
  ) {
    fail('GO_PACKAGE_FORBIDDEN', 'proto go_package does not match its fixed output', {
      proto: protoPath,
      goPackage: matches[0][1],
      expected: `${expectedImportPath};${expectedPackageName}`,
    });
  }
  if (packageName && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(packageName)) {
    fail('GO_PACKAGE_INVALID', 'proto go_package has an invalid package name', {
      proto: protoPath,
    });
  }
  return expectedDirectory;
}

function assertAllowedInput(relativePath) {
  const directory = path.posix.dirname(relativePath);
  if (
    !ALLOWED_PROTO_ROOTS.some(
      (root) => directory === root || directory.startsWith(`${root}/`),
    )
  ) {
    fail('PROTO_INPUT_OUTSIDE_ALLOWLIST', 'proto input is outside the allowlist', {
      path: relativePath,
    });
  }
}

export function buildOutputManifest(projectRootValue) {
  const projectRoot = canonicalRoot(projectRootValue);
  const modelRoot = path.join(projectRoot, 'model');
  const canonicalModelRoot = canonicalRoot(modelRoot);
  const allowedOutputRoots = [
    'apps/station',
    'apps/desktop/src/gen/proto',
    'apps/mobile/src/gen/proto',
  ].map((relative) => canonicalRoot(path.join(projectRoot, relative)));
  const outputs = [];
  for (const input of PROTO_INPUTS) {
    assertAllowedInput(input);
    const source = assertRepositoryPath(
      projectRoot,
      path.posix.join('model', input),
      'proto input',
    );
    if (!existsSync(source.absolute)) {
      fail('PROTO_INPUT_MISSING', 'required proto input is missing', {
        path: source.relative,
      });
    }
    const sourceStats = lstatSync(source.absolute);
    if (sourceStats.isSymbolicLink()) {
      fail('PROTO_INPUT_OUTSIDE_ALLOWLIST', 'proto input must not be a symlink', {
        path: source.relative,
      });
    }
    if (!sourceStats.isFile()) {
      fail('PROTO_INPUT_MISSING', 'required proto input is not a file', {
        path: source.relative,
      });
    }
    const canonicalSource = realpathSync(source.absolute);
    if (!isWithin(canonicalModelRoot, canonicalSource)) {
      fail('PROTO_INPUT_OUTSIDE_ALLOWLIST', 'proto input escapes model', {
        path: source.relative,
      });
    }
    const stem = path.posix.basename(input, '.proto');
    const goDirectory = parseGoPackage(source.absolute, input);
    const destinations = [
      {
        channel: 'go',
        stagedPath: path.posix.join('go', goDirectory, `${stem}.pb.go`),
        destination: path.posix.join('apps/station', goDirectory, `${stem}.pb.go`),
      },
      {
        channel: 'desktop-ts',
        stagedPath: path.posix.join(
          'desktop-ts',
          input.replace(/\.proto$/, '_pb.ts'),
        ),
        destination: path.posix.join(
          'apps/desktop/src/gen/proto',
          input.replace(/\.proto$/, '_pb.ts'),
        ),
      },
      {
        channel: 'mobile-ts',
        stagedPath: path.posix.join(
          'mobile-ts',
          input.replace(/\.proto$/, '_pb.ts'),
        ),
        destination: path.posix.join(
          'apps/mobile/src/gen/proto',
          input.replace(/\.proto$/, '_pb.ts'),
        ),
      },
    ];
    for (const output of destinations) {
      const destination = assertRepositoryPath(
        projectRoot,
        output.destination,
        'generated output',
      );
      const allowedRoot = canonicalRoot(
        path.join(projectRoot, OUTPUT_ROOT_BY_CHANNEL[output.channel]),
      );
      if (!allowedOutputRoots.includes(allowedRoot)) {
        fail('OUTPUT_MANIFEST_INVALID', 'unknown generated output root');
      }
      if (!isWithin(allowedRoot, destination.absolute)) {
        fail(
          'PATH_OUTSIDE_OUTPUT_MANIFEST',
          'generated output escapes its allowed root',
          { path: output.destination },
        );
      }
      assertNoSymlinkParents(allowedRoot, destination.absolute);
      outputs.push({ input, ...output });
    }
  }
  const destinationSet = new Set(outputs.map((output) => output.destination));
  if (destinationSet.size !== outputs.length) {
    fail('OUTPUT_MANIFEST_INVALID', 'generated output destinations are not unique');
  }
  return {
    projectRoot,
    modelRoot,
    inputs: [...PROTO_INPUTS],
    outputs: outputs.sort((left, right) =>
      left.destination.localeCompare(right.destination),
    ),
  };
}

function parsePositiveInteger(value, field, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    fail('INVALID_ARGUMENT', `${field} must be within 1..${maximum}`);
  }
  return parsed;
}

export function parseArguments(argv) {
  const options = {
    mode: null,
    budgetSeconds: DEFAULT_BUDGET_SECONDS,
  };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check' || token === '--apply') {
      if (options.mode !== null) {
        fail('INVALID_ARGUMENT', 'choose exactly one of --check or --apply');
      }
      options.mode = token.slice(2);
      continue;
    }
    const key = {
      '--budget-seconds': 'budgetSeconds',
      '--project-root': 'projectRoot',
      '--protoc': 'protoc',
      '--go-plugin': 'goPlugin',
      '--desktop-plugin': 'desktopPlugin',
      '--mobile-plugin': 'mobilePlugin',
    }[token];
    if (!key) {
      fail('INVALID_ARGUMENT', `unsupported argument: ${token}`);
    }
    if (seen.has(key)) {
      fail('INVALID_ARGUMENT', `duplicate argument: ${token}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      fail('INVALID_ARGUMENT', `missing value for ${token}`);
    }
    seen.add(key);
    options[key] = value;
    index += 1;
  }
  if (options.mode === null) {
    fail('INVALID_ARGUMENT', 'choose exactly one of --check or --apply');
  }
  options.budgetSeconds = parsePositiveInteger(
    options.budgetSeconds,
    'budget-seconds',
    MAX_BUDGET_SECONDS,
  );
  return options;
}

function executablePath(value, environment) {
  if (value.includes(path.sep)) {
    return path.resolve(value);
  }
  for (const directory of (environment.PATH ?? '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, value);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  return null;
}

function requireExecutable(value, field, environment) {
  const resolved = executablePath(value, environment);
  if (!resolved) {
    fail('TOOL_UNAVAILABLE', `${field} is unavailable`, { executable: value });
  }
  try {
    accessSync(resolved, constants.X_OK);
  } catch {
    fail('TOOL_UNAVAILABLE', `${field} is not executable`, {
      executable: resolved,
    });
  }
  return resolved;
}

function defaultGoPlugin(environment, runCommand, deadline, cwd) {
  if (environment.PROTOC_GEN_GO) return environment.PROTOC_GEN_GO;
  const fromPath = executablePath('protoc-gen-go', environment);
  if (fromPath) return fromPath;
  const go = executablePath('go', environment);
  if (!go) return 'protoc-gen-go';
  const result = runCommand([go, 'env', 'GOPATH'], {
    cwd,
    timeout: remainingMilliseconds(deadline),
    environment,
  });
  if (result.status !== 0) return 'protoc-gen-go';
  return path.join(String(result.stdout).trim(), 'bin', 'protoc-gen-go');
}

function remainingMilliseconds(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    fail('GENERATION_TIMEOUT', 'Secure Content proto generation timed out');
  }
  return remaining;
}

function defaultRunCommand(command, options) {
  return spawnSync(command[0], command.slice(1), {
    cwd: options.cwd,
    env: options.environment,
    encoding: 'utf8',
    timeout: options.timeout,
  });
}

function runAuditedCommand(command, options) {
  const before = snapshotRepository(options.projectRoot);
  let result;
  let executionError = null;
  try {
    result = options.runCommand(command, {
      cwd: options.cwd,
      environment: options.environment,
      timeout: remainingMilliseconds(options.deadline),
    });
  } catch (error) {
    executionError = error;
  }
  assertRepositoryUnchanged(
    before,
    snapshotRepository(options.projectRoot),
  );
  if (executionError !== null) throw executionError;
  remainingMilliseconds(options.deadline);
  return result;
}

function runChecked(command, options) {
  const result = options.runCommand(command, {
    cwd: options.cwd,
    environment: options.environment,
    timeout: remainingMilliseconds(options.deadline),
  });
  if (result.error?.code === 'ETIMEDOUT') {
    fail('GENERATION_TIMEOUT', 'Secure Content proto generation timed out');
  }
  if (result.error) {
    fail('TOOL_EXECUTION_FAILED', 'failed to execute proto tool', {
      executable: command[0],
      cause: String(result.error),
    });
  }
  if (result.status !== 0) {
    fail('GENERATION_FAILED', 'proto tool returned a non-zero status', {
      executable: command[0],
      status: result.status,
    });
  }
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile()) {
        result.push(path.relative(root, absolute).split(path.sep).join('/'));
      } else {
        fail('OUTPUT_MANIFEST_INVALID', 'generated output is not a regular file', {
          path: absolute,
        });
      }
    }
  };
  visit(root);
  return result.sort();
}

function snapshotRepository(root) {
  const snapshot = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (directory === root && entry.name === '.git') {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join('/');
      const stats = lstatSync(absolute);
      if (stats.isDirectory()) {
        snapshot.set(
          relative,
          `dir:${stats.mode & 0o777}:${stats.mtimeMs}`,
        );
        visit(absolute);
      } else if (stats.isSymbolicLink()) {
        snapshot.set(relative, `link:${readlinkSync(absolute)}`);
      } else if (stats.isFile()) {
        const metadataOnly = relative
          .split('/')
          .some((segment) => segment === 'node_modules' || segment === 'target');
        if (metadataOnly) {
          snapshot.set(
            relative,
            `file-meta:${stats.mode & 0o777}:${stats.size}:${stats.mtimeMs}`,
          );
        } else {
          const digest = createHash('sha256')
            .update(readFileSync(absolute))
            .digest('hex');
          snapshot.set(relative, `file:${stats.mode & 0o777}:${digest}`);
        }
      } else {
        snapshot.set(relative, `other:${stats.mode}`);
      }
    }
  };
  visit(root);
  return snapshot;
}

function assertRepositoryUnchanged(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  const changed = [...paths]
    .filter((entry) => before.get(entry) !== after.get(entry))
    .sort();
  if (changed.length > 0) {
    fail(
      'REPOSITORY_WRITE_OUTSIDE_MANIFEST',
      'proto tools modified the repository directly',
      { changed },
    );
  }
}

function copyProtoSources(sourceRoot, destinationRoot) {
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail('PROTO_INPUT_OUTSIDE_ALLOWLIST', 'model source must not contain symlinks', {
          path: absolute,
        });
      }
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && entry.name.endsWith('.proto')) {
        const relative = path.relative(sourceRoot, absolute);
        const destination = path.join(destinationRoot, relative);
        mkdirSync(path.dirname(destination), { recursive: true });
        copyFileSync(absolute, destination);
      }
    }
  };
  visit(sourceRoot);
}

function assertGeneratedManifest(stageRoot, manifest) {
  const expected = new Set(manifest.outputs.map((output) => output.stagedPath));
  const actual = ['go', 'desktop-ts', 'mobile-ts'].flatMap((channel) =>
    listFiles(path.join(stageRoot, channel)).map((file) =>
      path.posix.join(channel, file),
    ),
  );
  const unexpected = actual.filter((file) => !expected.has(file));
  const missing = [...expected].filter((file) => !actual.includes(file));
  if (unexpected.length > 0 || missing.length > 0) {
    fail('OUTPUT_MANIFEST_MISMATCH', 'generated files differ from the manifest', {
      unexpected,
      missing,
    });
  }
}

function writeAtomic(destination, bytes, mode = 0o644) {
  mkdirSync(path.dirname(destination), { recursive: true, mode: 0o755 });
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
    chmodSync(temporary, mode);
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
}

function normalizedGeneratedBytes(staged, destination) {
  const generated = readFileSync(staged, 'utf8').replace(/\n*$/u, '');
  if (!existsSync(destination)) {
    return Buffer.from(`${generated}\n`);
  }
  const current = readFileSync(destination, 'utf8');
  const trailingNewlines = current.match(/\n*$/u)?.[0].length ?? 0;
  return Buffer.from(`${generated}${'\n'.repeat(trailingNewlines)}`);
}

function applyManifestChanges(
  changes,
  deadline,
  renameFile = renameSync,
) {
  const prepared = [];
  const committed = [];
  try {
    for (const change of changes) {
      remainingMilliseconds(deadline);
      assertNoSymlinkParents(change.outputRoot, change.destination);
      if (existsSync(change.destination)) {
        const stats = lstatSync(change.destination);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          fail(
            'PATH_OUTSIDE_OUTPUT_MANIFEST',
            'generated destination must be a regular file',
            { path: change.relative },
          );
        }
      }
      mkdirSync(path.dirname(change.destination), {
        recursive: true,
        mode: 0o755,
      });
      const temporary = path.join(
        path.dirname(change.destination),
        `.${path.basename(change.destination)}.${process.pid}.${Date.now()}.stage`,
      );
      writeFileSync(temporary, change.bytes, { flag: 'wx', mode: 0o600 });
      chmodSync(temporary, 0o644);
      prepared.push({ ...change, temporary });
    }

    for (const change of prepared) {
      remainingMilliseconds(deadline);
      renameFile(change.temporary, change.destination);
      committed.push(change);
    }
  } catch (error) {
    const rollbackFailures = [];
    for (const change of committed.reverse()) {
      try {
        if (change.previous === null) {
          rmSync(change.destination, { force: true });
        } else {
          writeAtomic(change.destination, change.previous, change.previousMode);
        }
      } catch (rollbackError) {
        rollbackFailures.push({
          path: change.relative,
          cause: String(rollbackError),
        });
      }
    }
    if (rollbackFailures.length > 0) {
      fail(
        'APPLY_ROLLBACK_FAILED',
        'failed to restore the generated output set',
        { rollbackFailures },
      );
    }
    if (error instanceof SecureContentProtoError) throw error;
    fail('APPLY_FAILED', 'failed to commit the generated output set', {
      cause: String(error),
    });
  } finally {
    for (const change of prepared) {
      if (existsSync(change.temporary)) rmSync(change.temporary, { force: true });
    }
  }
}

export function executeGeneration(options) {
  const environment = options.environment ?? process.env;
  const runCommand = options.runCommand ?? defaultRunCommand;
  const projectRoot = canonicalRoot(options.projectRoot);
  const manifest = buildOutputManifest(projectRoot);
  const deadline = Date.now() + options.budgetSeconds * 1_000;
  const stageRoot = mkdtempSync(path.join(tmpdir(), 'pt-secure-content-proto-'));
  const goStage = path.join(stageRoot, 'go');
  const desktopStage = path.join(stageRoot, 'desktop-ts');
  const mobileStage = path.join(stageRoot, 'mobile-ts');
  const stagedModelRoot = path.join(stageRoot, 'model');
  const stagedHome = path.join(stageRoot, 'home');
  const stagedTemporary = path.join(stageRoot, 'tmp');
  mkdirSync(goStage, { recursive: true });
  mkdirSync(desktopStage, { recursive: true });
  mkdirSync(mobileStage, { recursive: true });
  mkdirSync(stagedHome, { recursive: true });
  mkdirSync(stagedTemporary, { recursive: true });
  copyProtoSources(manifest.modelRoot, stagedModelRoot);
  const toolEnvironment = {
    ...environment,
    HOME: stagedHome,
    PWD: stageRoot,
    TMPDIR: stagedTemporary,
  };
  const inputPaths = manifest.inputs.map((input) =>
    path.join(stagedModelRoot, input),
  );
  const auditedRunCommand = (command, commandOptions) =>
    runAuditedCommand(command, {
      ...commandOptions,
      projectRoot,
      deadline,
      runCommand,
    });

  try {
    let toolFailure = null;
    try {
      const protoc = requireExecutable(
        options.protoc ?? 'protoc',
        'protoc',
        toolEnvironment,
      );
      const goPlugin = requireExecutable(
        options.goPlugin ??
          defaultGoPlugin(
            toolEnvironment,
            auditedRunCommand,
            deadline,
            stageRoot,
          ),
        'protoc-gen-go',
        toolEnvironment,
      );
      const desktopPlugin = requireExecutable(
        options.desktopPlugin ??
          path.join(projectRoot, 'apps/desktop/node_modules/.bin/protoc-gen-es'),
        'Desktop protoc-gen-es',
        toolEnvironment,
      );
      const mobilePlugin = requireExecutable(
        options.mobilePlugin ??
          path.join(projectRoot, 'apps/mobile/node_modules/.bin/protoc-gen-es'),
        'Mobile protoc-gen-es',
        toolEnvironment,
      );
      runChecked(
        [
          protoc,
          `--plugin=protoc-gen-go=${goPlugin}`,
          `--go_out=${goStage}`,
          `--go_opt=module=${STATION_MODULE}`,
          `-I${stagedModelRoot}`,
          ...inputPaths,
        ],
        {
          cwd: stageRoot,
          deadline,
          environment: toolEnvironment,
          runCommand: auditedRunCommand,
        },
      );
      for (const [plugin, output] of [
        [desktopPlugin, desktopStage],
        [mobilePlugin, mobileStage],
      ]) {
        runChecked(
          [
            protoc,
            `--plugin=protoc-gen-es=${plugin}`,
            `--es_out=${output}`,
            '--es_opt=target=ts',
            `-I${stagedModelRoot}`,
            ...inputPaths,
          ],
          {
            cwd: stageRoot,
            deadline,
            environment: toolEnvironment,
            runCommand: auditedRunCommand,
          },
        );
      }
    } catch (error) {
      toolFailure = error;
    }
    if (toolFailure !== null) throw toolFailure;
    remainingMilliseconds(deadline);
    assertGeneratedManifest(stageRoot, manifest);

    const changes = [];
    for (const output of manifest.outputs) {
      remainingMilliseconds(deadline);
      const staged = path.join(stageRoot, output.stagedPath);
      const destination = assertRepositoryPath(
        projectRoot,
        output.destination,
        'generated output',
      ).absolute;
      const outputRoot = canonicalRoot(
        path.join(projectRoot, OUTPUT_ROOT_BY_CHANNEL[output.channel]),
      );
      assertNoSymlinkParents(outputRoot, destination);
      if (existsSync(destination)) {
        const stats = lstatSync(destination);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          fail(
            'PATH_OUTSIDE_OUTPUT_MANIFEST',
            'generated destination must be a regular file',
            { path: output.destination },
          );
        }
      }
      const bytes = normalizedGeneratedBytes(staged, destination);
      const current = existsSync(destination) ? readFileSync(destination) : null;
      if (current !== null && current.equals(bytes)) continue;
      changes.push({
        relative: output.destination,
        destination,
        outputRoot,
        bytes,
        previous: current,
        previousMode: existsSync(destination)
          ? lstatSync(destination).mode & 0o777
          : 0o644,
      });
    }
    const changed = changes.map((change) => change.relative);
    if (options.mode === 'check' && changes.length > 0) {
      fail('GENERATION_DRIFT', 'generated Secure Content outputs are stale', {
        changed,
      });
    }
    if (options.mode === 'apply' && changes.length > 0) {
      applyManifestChanges(changes, deadline, options.renameFile);
    }
    return {
      status: 'PASS',
      mode: options.mode,
      inputs: manifest.inputs,
      outputs: manifest.outputs.map((output) => output.destination),
      changed,
    };
  } finally {
    rmSync(stageRoot, { recursive: true, force: true });
  }
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function main(argv = process.argv.slice(2)) {
  try {
    const parsed = parseArguments(argv);
    const projectRoot = parsed.projectRoot
      ? path.resolve(parsed.projectRoot)
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    output(executeGeneration({ ...parsed, projectRoot }));
    return 0;
  } catch (error) {
    const payload =
      error instanceof SecureContentProtoError
        ? {
            status: 'BLOCKED',
            code: error.code,
            message: error.message,
            detail: error.detail,
          }
        : {
            status: 'BLOCKED',
            code: 'SECURE_CONTENT_PROTO_INTERNAL_ERROR',
            message: String(error),
          };
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 2;
  }
}

const invokedDirectly =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = main();
}
