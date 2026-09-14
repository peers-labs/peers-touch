import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PROTO_INPUTS,
  SecureContentProtoError,
  buildOutputManifest,
  executeGeneration,
  parseArguments,
} from './proto-gen-secure-content.mjs';

const STATION_PREFIX = 'github.com/peers-labs/peers-touch/station/';

function goPackageFor(input) {
  if (input === 'domain/common/common.proto') {
    return `${STATION_PREFIX}frame/core/types;types`;
  }
  if (input.startsWith('domain/secure_content/')) {
    return `${STATION_PREFIX}frame/core/types/securecontent;securecontent`;
  }
  if (input === 'domain/social/private_content.proto') {
    return `${STATION_PREFIX}frame/touch/model/privatecontent;privatecontent`;
  }
  if (input.startsWith('domain/social/')) {
    return `${STATION_PREFIX}frame/touch/model;model`;
  }
  return `${STATION_PREFIX}app/subserver/key_exchange/model;model`;
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-secure-content-generator-'));
  mkdirSync(path.join(root, 'model'), { recursive: true });
  for (const input of PROTO_INPUTS) {
    const destination = path.join(root, 'model', input);
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(
      destination,
      [
        'syntax = "proto3";',
        `package test.${path.basename(input, '.proto')};`,
        `option go_package = "${goPackageFor(input)}";`,
        '',
      ].join('\n'),
    );
  }
  for (const relative of [
    'apps/station',
    'apps/desktop/src/gen/proto',
    'apps/mobile/src/gen/proto',
  ]) {
    mkdirSync(path.join(root, relative), { recursive: true });
  }
  const tools = {};
  for (const name of ['protoc', 'desktop-es', 'mobile-es', 'go']) {
    const executable = path.join(root, 'tools', name);
    mkdirSync(path.dirname(executable), { recursive: true });
    writeFileSync(executable, '#!/bin/sh\nexit 0\n');
    chmodSync(executable, 0o755);
    tools[name] = executable;
  }
  const goPath = path.join(root, 'gopath');
  const goPlugin = path.join(goPath, 'bin', 'protoc-gen-go');
  mkdirSync(path.dirname(goPlugin), { recursive: true });
  writeFileSync(goPlugin, '#!/bin/sh\nexit 0\n');
  chmodSync(goPlugin, 0o755);
  tools['protoc-gen-go'] = goPlugin;
  return {
    root,
    tools,
    goPath,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function optionValue(command, prefix) {
  const value = command.find((argument) => argument.startsWith(prefix));
  assert.ok(value, `missing command option ${prefix}`);
  return value.slice(prefix.length);
}

function fakeRunner({
  extraOutput = false,
  timeout = false,
  projectRoot = null,
  generatedPrefix = 'generated',
  repositoryWritePath = null,
  failureStatus = null,
  goPath = null,
  goEnvWritePath = null,
  goEnvStatus = 0,
  expectedGoEnvCwd = null,
  expectedGoEnvHome = null,
  expectedGoPlugin = null,
  forbiddenToolHome = null,
} = {}) {
  return (command, options) => {
    if (path.basename(command[0]) === 'go' && command[1] === 'env') {
      if (expectedGoEnvCwd !== null) {
        assert.equal(realpathSync(options.cwd), realpathSync(expectedGoEnvCwd));
      }
      if (expectedGoEnvHome !== null) {
        assert.equal(options.environment.HOME, expectedGoEnvHome);
      }
      if (goEnvWritePath !== null) {
        writeFileSync(goEnvWritePath, 'go env wrote into repository\n');
      }
      return {
        status: goEnvStatus,
        stdout: goEnvStatus === 0 ? `${goPath}\n` : '',
        stderr: goEnvStatus === 0 ? '' : 'injected go env failure',
      };
    }
    if (projectRoot !== null) {
      const relativeCwd = path.relative(projectRoot, options.cwd);
      assert.ok(
        relativeCwd === '..' || relativeCwd.startsWith(`..${path.sep}`),
        `generator command cwd escaped staging: ${options.cwd}`,
      );
    }
    if (repositoryWritePath !== null) {
      writeFileSync(repositoryWritePath, 'tool wrote into repository\n');
    }
    if (forbiddenToolHome !== null) {
      assert.notEqual(options.environment.HOME, forbiddenToolHome);
    }
    if (timeout) {
      return { status: null, stdout: '', stderr: '', error: { code: 'ETIMEDOUT' } };
    }
    if (failureStatus !== null) {
      return { status: failureStatus, stdout: '', stderr: 'injected failure' };
    }
    const goOutput = command.find((argument) => argument.startsWith('--go_out='));
    const esOutput = command.find((argument) => argument.startsWith('--es_out='));
    assert.notEqual(Boolean(goOutput), Boolean(esOutput));
    if (goOutput && expectedGoPlugin !== null) {
      assert.equal(
        optionValue(command, '--plugin=protoc-gen-go='),
        expectedGoPlugin,
      );
    }
    const outputRoot = goOutput
      ? optionValue(command, '--go_out=')
      : optionValue(command, '--es_out=');
    const inputs = command.filter((argument) => argument.endsWith('.proto'));
    for (const input of inputs) {
      const relative = input.split(`${path.sep}model${path.sep}`)[1];
      assert.ok(relative, `input is not below model: ${input}`);
      let generated;
      if (goOutput) {
        const source = readFileSync(input, 'utf8');
        const goPackage = source.match(/go_package\s*=\s*"([^";]+)/u)?.[1];
        assert.ok(goPackage?.startsWith(STATION_PREFIX));
        generated = path.join(
          outputRoot,
          goPackage.slice(STATION_PREFIX.length),
          `${path.basename(relative, '.proto')}.pb.go`,
        );
      } else {
        generated = path.join(
          outputRoot,
          relative.replace(/\.proto$/u, '_pb.ts'),
        );
      }
      mkdirSync(path.dirname(generated), { recursive: true });
      writeFileSync(generated, `${generatedPrefix}:${relative}\n`);
    }
    if (extraOutput) {
      writeFileSync(path.join(outputRoot, 'unexpected.txt'), 'unexpected\n');
    }
    return { status: 0, stdout: '', stderr: '' };
  };
}

function generationOptions(
  scope,
  mode,
  runner = fakeRunner({ projectRoot: scope.root }),
) {
  return {
    mode,
    budgetSeconds: 30,
    projectRoot: scope.root,
    protoc: scope.tools.protoc,
    goPlugin: scope.tools['protoc-gen-go'],
    desktopPlugin: scope.tools['desktop-es'],
    mobilePlugin: scope.tools['mobile-es'],
    environment: { PATH: path.dirname(scope.tools.protoc) },
    runCommand: runner,
  };
}

test('builds one fixed three-channel output manifest', () => {
  const scope = fixture();
  try {
    const manifest = buildOutputManifest(scope.root);
    assert.deepEqual(manifest.inputs, PROTO_INPUTS);
    assert.equal(manifest.outputs.length, PROTO_INPUTS.length * 3);
    assert.equal(
      new Set(manifest.outputs.map((output) => output.destination)).size,
      manifest.outputs.length,
    );
    assert.ok(
      manifest.outputs.some(
        (output) =>
          output.destination ===
          'apps/station/frame/core/types/securecontent/content.pb.go',
      ),
    );
    assert.ok(
      manifest.outputs.some(
        (output) =>
          output.destination ===
          'apps/station/frame/core/types/securecontent/prekey.pb.go',
      ),
    );
    assert.ok(
      manifest.outputs.some(
        (output) =>
          output.destination ===
          'apps/station/frame/touch/model/privatecontent/private_content.pb.go',
      ),
    );
  } finally {
    scope.close();
  }
});

test('rejects missing inputs and non-Station go_package values', () => {
  const scope = fixture();
  try {
    rmSync(path.join(scope.root, 'model/domain/secure_content/content.proto'));
    assert.throws(
      () => buildOutputManifest(scope.root),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'PROTO_INPUT_MISSING',
    );

    const input = path.join(scope.root, 'model/domain/common/common.proto');
    writeFileSync(
      input,
      [
        'syntax = "proto3";',
        'package test.common;',
        'option go_package = "github.com/peers-labs/peers-touch/apps/applets/demo/service/model;model";',
        '',
      ].join('\n'),
    );
    writeFileSync(
      path.join(scope.root, 'model/domain/secure_content/content.proto'),
      [
        'syntax = "proto3";',
        'package test.content;',
        `option go_package = "${goPackageFor(
          'domain/secure_content/content.proto',
        )}";`,
        '',
      ].join('\n'),
    );
    assert.throws(
      () => buildOutputManifest(scope.root),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'GO_PACKAGE_FORBIDDEN',
    );

    writeFileSync(
      input,
      [
        'syntax = "proto3";',
        'package test.common;',
        `option go_package = "${STATION_PREFIX}frame/core/types;model";`,
        '',
      ].join('\n'),
    );
    assert.throws(
      () => buildOutputManifest(scope.root),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'GO_PACKAGE_FORBIDDEN',
    );

    writeFileSync(
      input,
      [
        'syntax = "proto3";',
        'package test.common;',
        `option go_package = "${STATION_PREFIX}app/subserver/conversation/model;model";`,
        '',
      ].join('\n'),
    );
    assert.throws(
      () => buildOutputManifest(scope.root),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'GO_PACKAGE_FORBIDDEN',
    );
  } finally {
    scope.close();
  }
});

test('rejects symlinked output parents before generation', () => {
  const scope = fixture();
  const outside = mkdtempSync(path.join(tmpdir(), 'pt-secure-content-output-'));
  try {
    symlinkSync(outside, path.join(scope.root, 'apps/station/frame'));
    assert.throws(
      () => buildOutputManifest(scope.root),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'PATH_OUTSIDE_OUTPUT_MANIFEST',
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
    scope.close();
  }
});

test('rejects proto symlinks and unavailable executables', () => {
  const scope = fixture();
  const outside = mkdtempSync(path.join(tmpdir(), 'pt-secure-content-outside-'));
  try {
    const input = path.join(
      scope.root,
      'model/domain/secure_content/content.proto',
    );
    rmSync(input);
    const outsideProto = path.join(outside, 'content.proto');
    writeFileSync(outsideProto, 'syntax = "proto3";\n');
    symlinkSync(outsideProto, input);
    assert.throws(
      () => buildOutputManifest(scope.root),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'PROTO_INPUT_OUTSIDE_ALLOWLIST',
    );

    rmSync(input);
    writeFileSync(
      input,
      [
        'syntax = "proto3";',
        'package test.content;',
        `option go_package = "${goPackageFor(
          'domain/secure_content/content.proto',
        )}";`,
        '',
      ].join('\n'),
    );
    rmSync(scope.tools.protoc);
    assert.throws(
      () => executeGeneration(generationOptions(scope, 'check')),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'TOOL_UNAVAILABLE',
    );
  } finally {
    rmSync(outside, { recursive: true, force: true });
    scope.close();
  }
});

test('apply writes only manifest outputs and check detects no drift', () => {
  const scope = fixture();
  try {
    const sentinel = path.join(scope.root, 'outside-manifest.txt');
    writeFileSync(sentinel, 'sentinel\n');
    const applied = executeGeneration(generationOptions(scope, 'apply'));
    assert.equal(applied.status, 'PASS');
    assert.equal(applied.changed.length, PROTO_INPUTS.length * 3);
    assert.equal(readFileSync(sentinel, 'utf8'), 'sentinel\n');

    const checked = executeGeneration(generationOptions(scope, 'check'));
    assert.equal(checked.status, 'PASS');
    assert.deepEqual(checked.changed, []);
    assert.equal(readFileSync(sentinel, 'utf8'), 'sentinel\n');
  } finally {
    scope.close();
  }
});

test('resolves the physical Go plugin before staged HOME isolation', () => {
  const scope = fixture();
  try {
    const originalHome = path.join(scope.root, 'original-home');
    const pathPlugin = path.join(scope.root, 'tools', 'protoc-gen-go');
    mkdirSync(originalHome, { recursive: true });
    writeFileSync(pathPlugin, '#!/bin/sh\nexit 1\n');
    chmodSync(pathPlugin, 0o755);

    const options = generationOptions(scope, 'apply');
    delete options.goPlugin;
    options.environment = {
      HOME: originalHome,
      PATH: path.dirname(scope.tools.protoc),
    };
    options.runCommand = fakeRunner({
      projectRoot: scope.root,
      goPath: scope.goPath,
      expectedGoEnvCwd: scope.root,
      expectedGoEnvHome: originalHome,
      expectedGoPlugin: scope.tools['protoc-gen-go'],
      forbiddenToolHome: originalHome,
    });

    const result = executeGeneration(options);
    assert.equal(result.status, 'PASS');
    assert.equal(result.changed.length, PROTO_INPUTS.length * 3);
  } finally {
    scope.close();
  }
});

test('falls back to a genuine PATH Go plugin when go env fails', () => {
  const scope = fixture();
  try {
    const pathPlugin = path.join(scope.root, 'tools', 'protoc-gen-go');
    writeFileSync(pathPlugin, '#!/bin/sh\nexit 0\n');
    chmodSync(pathPlugin, 0o755);

    const options = generationOptions(scope, 'apply');
    delete options.goPlugin;
    options.runCommand = fakeRunner({
      projectRoot: scope.root,
      goEnvStatus: 1,
      expectedGoPlugin: pathPlugin,
    });

    const result = executeGeneration(options);
    assert.equal(result.status, 'PASS');
    assert.equal(result.changed.length, PROTO_INPUTS.length * 3);
  } finally {
    scope.close();
  }
});

test('check mode fails closed on drift without replacing the destination', () => {
  const scope = fixture();
  try {
    executeGeneration(generationOptions(scope, 'apply'));
    const destination = path.join(
      scope.root,
      'apps/mobile/src/gen/proto/domain/social/post_pb.ts',
    );
    writeFileSync(destination, 'locally changed\n');

    assert.throws(
      () => executeGeneration(generationOptions(scope, 'check')),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'GENERATION_DRIFT' &&
        error.detail.changed.includes(
          'apps/mobile/src/gen/proto/domain/social/post_pb.ts',
        ),
    );
    assert.equal(readFileSync(destination, 'utf8'), 'locally changed\n');
  } finally {
    scope.close();
  }
});

test('rejects unexpected generated files and exhausted budgets', () => {
  const scope = fixture();
  try {
    assert.throws(
      () =>
        executeGeneration(
          generationOptions(scope, 'apply', fakeRunner({ extraOutput: true })),
        ),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'OUTPUT_MANIFEST_MISMATCH',
    );
    assert.equal(
      existsSync(path.join(scope.root, 'apps/station/unexpected.txt')),
      false,
    );

    assert.throws(
      () =>
        executeGeneration(
          generationOptions(scope, 'apply', fakeRunner({ timeout: true })),
        ),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'GENERATION_TIMEOUT',
    );
  } finally {
    scope.close();
  }
});

test('detects tool writes outside the output manifest in check mode', () => {
  const scope = fixture();
  try {
    const escaped = path.join(scope.root, 'tool-escape.txt');
    assert.throws(
      () =>
        executeGeneration(
          generationOptions(
            scope,
            'check',
            fakeRunner({
              projectRoot: scope.root,
              repositoryWritePath: escaped,
            }),
          ),
        ),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'REPOSITORY_WRITE_OUTSIDE_MANIFEST' &&
        error.detail.changed.includes('tool-escape.txt'),
    );
  } finally {
    scope.close();
  }
});

test('audits repository writes from tool discovery and failed tools', () => {
  for (const mode of ['go-env', 'failure', 'timeout']) {
    const scope = fixture();
    try {
      const escaped = path.join(scope.root, `${mode}-escape.txt`);
      let runner;
      const options = generationOptions(scope, 'check');
      if (mode === 'go-env') {
        runner = fakeRunner({
          projectRoot: scope.root,
          goPath: scope.goPath,
          goEnvWritePath: escaped,
        });
        delete options.goPlugin;
      } else {
        runner = fakeRunner({
          projectRoot: scope.root,
          repositoryWritePath: escaped,
          failureStatus: mode === 'failure' ? 1 : null,
          timeout: mode === 'timeout',
        });
      }
      options.runCommand = runner;
      assert.throws(
        () => executeGeneration(options),
        (error) =>
          error instanceof SecureContentProtoError &&
          error.code === 'REPOSITORY_WRITE_OUTSIDE_MANIFEST' &&
          error.detail.changed.includes(`${mode}-escape.txt`),
        mode,
      );
    } finally {
      scope.close();
    }
  }
});

test('does not exempt dependency or build directories from write auditing', () => {
  for (const directory of ['node_modules', 'target']) {
    const scope = fixture();
    try {
      const containingDirectory = path.join(scope.root, directory);
      mkdirSync(containingDirectory, { recursive: true });
      const escaped = path.join(containingDirectory, 'escaped.txt');
      assert.throws(
        () =>
          executeGeneration(
            generationOptions(
              scope,
              'check',
              fakeRunner({
                projectRoot: scope.root,
                repositoryWritePath: escaped,
                failureStatus: 1,
              }),
            ),
          ),
        (error) =>
          error instanceof SecureContentProtoError &&
          error.code === 'REPOSITORY_WRITE_OUTSIDE_MANIFEST' &&
          error.detail.changed.includes(`${directory}/escaped.txt`),
        directory,
      );
    } finally {
      scope.close();
    }
  }
});

test('rolls back the complete manifest when a later rename fails', () => {
  const scope = fixture();
  try {
    executeGeneration(
      generationOptions(
        scope,
        'apply',
        fakeRunner({ projectRoot: scope.root, generatedPrefix: 'v1' }),
      ),
    );
    const manifest = buildOutputManifest(scope.root);
    const before = new Map(
      manifest.outputs.map((output) => [
        output.destination,
        readFileSync(path.join(scope.root, output.destination)),
      ]),
    );
    let renameCount = 0;
    const renameFile = (source, destination) => {
      renameCount += 1;
      if (renameCount === 2) {
        throw new Error('injected second rename failure');
      }
      renameSync(source, destination);
    };

    assert.throws(
      () =>
        executeGeneration({
          ...generationOptions(
            scope,
            'apply',
            fakeRunner({ projectRoot: scope.root, generatedPrefix: 'v2' }),
          ),
          renameFile,
        }),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'APPLY_FAILED',
    );
    for (const [destination, bytes] of before) {
      assert.deepEqual(readFileSync(path.join(scope.root, destination)), bytes);
    }
  } finally {
    scope.close();
  }
});

test('removes newly created outputs when the apply transaction fails', () => {
  const scope = fixture();
  try {
    const manifest = buildOutputManifest(scope.root);
    let renameCount = 0;
    const renameFile = (source, destination) => {
      renameCount += 1;
      if (renameCount === 2) {
        throw new Error('injected new-output rename failure');
      }
      renameSync(source, destination);
    };
    assert.throws(
      () =>
        executeGeneration({
          ...generationOptions(scope, 'apply'),
          renameFile,
        }),
      (error) =>
        error instanceof SecureContentProtoError &&
        error.code === 'APPLY_FAILED',
    );
    for (const output of manifest.outputs) {
      assert.equal(
        existsSync(path.join(scope.root, output.destination)),
        false,
        output.destination,
      );
    }
  } finally {
    scope.close();
  }
});

test('requires one bounded mode and rejects duplicate options', () => {
  assert.deepEqual(parseArguments(['--check', '--budget-seconds', '15']), {
    mode: 'check',
    budgetSeconds: 15,
  });
  assert.throws(
    () => parseArguments(['--check', '--apply']),
    (error) =>
      error instanceof SecureContentProtoError &&
      error.code === 'INVALID_ARGUMENT',
  );
  assert.throws(
    () => parseArguments(['--check', '--budget-seconds', '0']),
    (error) =>
      error instanceof SecureContentProtoError &&
      error.code === 'INVALID_ARGUMENT',
  );
});
