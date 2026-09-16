import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DevWorkError,
  checkDeclaration,
  digestDeclaration,
  heartbeatDeclaration,
  processStartIdentity,
  readLedger,
  releaseDeclaration,
  requireActiveDeclaration,
  startOrUpdateDeclaration,
  statusAll,
  statusCurrent,
} from './dev-work.mjs';

const FIXED_NOW = new Date('2026-09-16T12:00:00.000Z');

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'pt-dev-work-'));
  const home = path.join(root, 'home');
  const workspaceA = path.join(root, 'workspace-a');
  const workspaceB = path.join(root, 'workspace-b');
  mkdirSync(home, { recursive: true });
  mkdirSync(workspaceA);
  mkdirSync(workspaceB);
  return {
    root,
    home,
    workspaceA,
    workspaceB,
    close() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function clock(iso = FIXED_NOW.toISOString()) {
  return () => new Date(iso);
}

function options(scope, overrides = {}) {
  return {
    home: scope.home,
    workspaceRoot: scope.workspaceA,
    workItemId: 'dwf-b1',
    sessionId: 'session-a',
    owner: 'lane-b',
    purpose: 'test public work declarations',
    journeyId: 'DWF-AS03',
    branch: 'merge-desktop-prototype',
    sourceHead: '7'.repeat(40),
    sourceClaims:
      'exclusive-write:tooling/scripts/local-dev;shared-read:docs/architecture',
    runtimeClaims: 'shared:station.connect:station-four',
    clock: clock(),
    ...overrides,
  };
}

function expectCode(code, operation) {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof DevWorkError);
    assert.equal(error.code, code);
    return true;
  });
}

test('publishes a closed declaration with owner-only storage', () => {
  const scope = fixture();
  try {
    const declaration = startOrUpdateDeclaration(options(scope));
    const ledgerFile = path.join(scope.home, '.peers-touch', 'dev', 'work.json');
    assert.equal(declaration.state, 'DECLARED');
    assert.equal(declaration.declarationDigest, digestDeclaration(declaration));
    assert.equal(statSync(ledgerFile).mode & 0o777, 0o600);
    assert.equal(statSync(path.dirname(ledgerFile)).mode & 0o777, 0o700);
    assert.deepEqual(
      statusCurrent({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        clock: clock(),
      }).declarations.map((item) => item.workItemId),
      ['dwf-b1'],
    );
    assert.equal(
      statusCurrent({
        home: scope.home,
        workspaceRoot: scope.workspaceB,
        clock: clock(),
      }).declarations.length,
      0,
    );
  } finally {
    scope.close();
  }
});

test('rejects source and runtime conflicts but permits shared reads', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope));
    expectCode('RESOURCE_DECLARATION_CONFLICT', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: scope.workspaceB,
          workItemId: 'source-conflict',
          sessionId: 'session-b',
          branch: 'other-branch',
          sourceHead: '8'.repeat(40),
          sourceClaims: 'exclusive-write:tooling/scripts/local-dev/dev-work.mjs',
          runtimeClaims: '',
        }),
      ),
    );
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: scope.workspaceB,
        workItemId: 'reader',
        sessionId: 'session-reader',
        branch: 'reader-branch',
        sourceHead: '8'.repeat(40),
        sourceClaims: 'shared-read:docs/architecture',
        runtimeClaims: '',
      }),
    );
    expectCode('RESOURCE_DECLARATION_CONFLICT', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: scope.workspaceB,
          workItemId: 'runtime-conflict',
          sessionId: 'session-runtime',
          branch: 'runtime-branch',
          sourceHead: '9'.repeat(40),
          sourceClaims: 'shared-read:model',
          runtimeClaims: 'exclusive:station.connect:station-four',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('rejects disjoint writes to the same branch across workspaces', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope));
    expectCode('RESOURCE_DECLARATION_CONFLICT', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: scope.workspaceB,
          workItemId: 'same-branch',
          sessionId: 'session-b',
          sourceHead: '8'.repeat(40),
          sourceClaims: 'exclusive-write:apps/station',
          runtimeClaims: '',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('uses the injected current clock for expiry and successor admission', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope, { expiresMinutes: 1 }));
    assert.equal(
      statusAll({
        home: scope.home,
        clock: clock('2026-09-16T12:00:30.000Z'),
      }).declarations[0].state,
      'DECLARED',
    );
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: scope.workspaceB,
        workItemId: 'successor',
        sessionId: 'session-b',
        branch: 'successor-branch',
        sourceHead: '8'.repeat(40),
        clock: clock('2026-09-16T12:02:00.000Z'),
      }),
    );
    const states = statusAll({
      home: scope.home,
      clock: clock('2026-09-16T12:02:00.000Z'),
    }).declarations.map((item) => item.state);
    assert.deepEqual(states.sort(), ['DECLARED', 'STALE']);
  } finally {
    scope.close();
  }
});

test('heartbeat, activation, release, and restart obey lifecycle ownership', () => {
  const scope = fixture();
  try {
    const currentRepo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
    );
    const branch = execFileSync('git', ['branch', '--show-current'], {
      cwd: currentRepo,
      encoding: 'utf8',
    }).trim();
    const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: currentRepo,
      encoding: 'utf8',
    }).trim();
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: currentRepo,
        branch,
        sourceHead,
        expiresMinutes: 1,
      }),
    );
    expectCode('WORK_DECLARATION_NOT_ACTIVE', () =>
      requireActiveDeclaration({
        home: scope.home,
        workspaceRoot: currentRepo,
        workItemId: 'dwf-b1',
        clock: clock(),
      }),
    );
    const active = checkDeclaration({
      home: scope.home,
      workspaceRoot: currentRepo,
      workItemId: 'dwf-b1',
      sessionId: 'session-a',
      clock: clock('2026-09-16T12:00:10.000Z'),
    });
    assert.equal(active.state, 'ACTIVE');
    const heartbeat = heartbeatDeclaration({
      home: scope.home,
      workspaceRoot: currentRepo,
      workItemId: 'dwf-b1',
      sessionId: 'session-a',
      expiresMinutes: 10,
      clock: clock('2026-09-16T12:00:30.000Z'),
    });
    assert.equal(heartbeat.expiresAt, '2026-09-16T12:10:30.000Z');
    expectCode('WORK_DECLARATION_OWNER_MISMATCH', () =>
      releaseDeclaration({
        home: scope.home,
        workspaceRoot: currentRepo,
        workItemId: 'dwf-b1',
        sessionId: 'other-session',
        clock: clock('2026-09-16T12:01:00.000Z'),
      }),
    );
    assert.equal(
      releaseDeclaration({
        home: scope.home,
        workspaceRoot: currentRepo,
        workItemId: 'dwf-b1',
        sessionId: 'session-a',
        clock: clock('2026-09-16T12:01:00.000Z'),
      }).state,
      'RELEASED',
    );
    expectCode('WORK_DECLARATION_NOT_ACTIVE', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: currentRepo,
          branch,
          sourceHead,
          clock: clock('2026-09-16T12:02:00.000Z'),
        }),
        { requireExisting: true },
      ),
    );
    assert.equal(
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: currentRepo,
          branch,
          sourceHead,
          sessionId: 'session-b',
          clock: clock('2026-09-16T12:02:00.000Z'),
        }),
      ).sessionId,
      'session-b',
    );
  } finally {
    scope.close();
  }
});

test('activation rejects branch and source identity drift', () => {
  const scope = fixture();
  try {
    const currentRepo = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
    );
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: currentRepo,
        branch: 'not-the-current-branch',
      }),
    );
    expectCode('WORKTREE_IDENTITY_MISMATCH', () =>
      checkDeclaration({
        home: scope.home,
        workspaceRoot: currentRepo,
        workItemId: 'dwf-b1',
        sessionId: 'session-a',
        clock: clock(),
      }),
    );
  } finally {
    scope.close();
  }
});

test('source claims reject symlink escape through the nearest existing parent', () => {
  const scope = fixture();
  try {
    const outside = path.join(scope.root, 'outside');
    mkdirSync(outside);
    symlinkSync(outside, path.join(scope.workspaceA, 'escape'));
    expectCode('INVALID_SOURCE_CLAIM', () =>
      startOrUpdateDeclaration(
        options(scope, {
          sourceClaims: 'exclusive-write:escape/new-file.mjs',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('migrates legacy root claims only for terminal declarations', () => {
  const scope = fixture();
  try {
    const declaration = startOrUpdateDeclaration(options(scope));
    const ledgerFile = path.join(
      scope.home,
      '.peers-touch',
      'dev',
      'work.json',
    );
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    const legacy = ledger.declarations[declaration.declarationId];
    legacy.state = 'RELEASED';
    legacy.sourceClaims = [
      {
        mode: 'exclusive-write',
        pathPrefix: '.',
      },
    ];
    legacy.declarationDigest = digestDeclaration(legacy);
    writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);

    const migrated = readLedger(ledgerFile);
    assert.deepEqual(
      migrated.declarations[declaration.declarationId].sourceClaims,
      [],
    );

    legacy.state = 'ACTIVE';
    legacy.declarationDigest = digestDeclaration(legacy);
    writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);
    expectCode('MACHINE_WORK_LEDGER_INVALID', () => readLedger(ledgerFile));
  } finally {
    scope.close();
  }
});

test('malformed ledger and lock metadata fail closed without replacement', () => {
  const ledgerScope = fixture();
  try {
    const ledgerFile = path.join(
      ledgerScope.home,
      '.peers-touch',
      'dev',
      'work.json',
    );
    mkdirSync(path.dirname(ledgerFile), { recursive: true });
    writeFileSync(ledgerFile, '{"schemaVersion":1,"kind":"wrong"}\n');
    const before = readFileSync(ledgerFile, 'utf8');
    expectCode('MACHINE_WORK_LEDGER_INVALID', () => readLedger(ledgerFile));
    expectCode('MACHINE_WORK_LEDGER_INVALID', () =>
      startOrUpdateDeclaration(options(ledgerScope)),
    );
    assert.equal(readFileSync(ledgerFile, 'utf8'), before);
  } finally {
    ledgerScope.close();
  }

  const lockScope = fixture();
  try {
    const lockFile = path.join(
      lockScope.home,
      '.peers-touch',
      'dev',
      'work.lock',
    );
    mkdirSync(path.dirname(lockFile), { recursive: true });
    const malformed = `${JSON.stringify({
      pid: String(process.pid),
      processStart: processStartIdentity(),
      createdAt: FIXED_NOW.toISOString(),
    })}\n`;
    writeFileSync(lockFile, malformed);
    expectCode('MACHINE_WORK_LEDGER_LOCK_INVALID', () =>
      startOrUpdateDeclaration(
        options(lockScope, {
          lockTimeoutMs: 10,
        }),
      ),
    );
    assert.equal(readFileSync(lockFile, 'utf8'), malformed);
  } finally {
    lockScope.close();
  }
});

test('closed declaration fields and non-canonical stored claims fail closed', () => {
  const scope = fixture();
  try {
    const created = startOrUpdateDeclaration(options(scope));
    const ledgerFile = path.join(scope.home, '.peers-touch', 'dev', 'work.json');
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    ledger.declarations[created.declarationId].unexpected = true;
    writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);
    expectCode('MACHINE_WORK_LEDGER_INVALID', () => readLedger(ledgerFile));
  } finally {
    scope.close();
  }

  const claimScope = fixture();
  try {
    const created = startOrUpdateDeclaration(options(claimScope));
    const ledgerFile = path.join(
      claimScope.home,
      '.peers-touch',
      'dev',
      'work.json',
    );
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    const declaration = ledger.declarations[created.declarationId];
    declaration.sourceClaims[0].pathPrefix = 'docs//architecture';
    declaration.declarationDigest = digestDeclaration(declaration);
    writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);
    expectCode('MACHINE_WORK_LEDGER_INVALID', () => readLedger(ledgerFile));
  } finally {
    claimScope.close();
  }
});

test('symlinked CLI invocation executes the real module', () => {
  const scope = fixture();
  try {
    const cli = fileURLToPath(new URL('./dev-work.mjs', import.meta.url));
    const link = path.join(scope.root, 'dev-work-link.mjs');
    symlinkSync(cli, link);
    assert.ok(lstatSync(link).isSymbolicLink());
    const result = spawnSync(
      process.execPath,
      [link, 'status-all', '--home', scope.home],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.declarations.length, 0);
  } finally {
    scope.close();
  }
});

test('existing private directory modes are corrected on mutation', () => {
  const scope = fixture();
  try {
    const devRoot = path.join(scope.home, '.peers-touch', 'dev');
    mkdirSync(devRoot, { recursive: true });
    chmodSync(devRoot, 0o755);
    startOrUpdateDeclaration(options(scope));
    assert.equal(statSync(devRoot).mode & 0o777, 0o700);
  } finally {
    scope.close();
  }
});
