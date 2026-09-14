import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
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
  startOrUpdateDeclaration,
  statusAll,
  statusCurrent,
} from './dev-work.mjs';

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

function options(scope, overrides = {}) {
  return {
    home: scope.home,
    workspaceRoot: scope.workspaceA,
    workItemId: 'workflow-control-plane',
    sessionId: 'session-a',
    owner: 'test-owner',
    purpose: 'test public work declarations',
    branch: 'feat/workflow',
    sourceHead: '1'.repeat(40),
    sourceClaims: 'exclusive-write:tooling/skills;shared-read:docs/README.md',
    runtimeClaims: 'shared:station.connect:station-four',
    now: new Date('2026-09-13T12:00:00.000Z'),
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

test('publishes one declaration and exposes it to all workspaces', () => {
  const scope = fixture();
  try {
    const declaration = startOrUpdateDeclaration(options(scope));
    const status = statusAll({
      home: scope.home,
      now: new Date('2026-09-13T12:01:00.000Z'),
    });
    assert.equal(status.declarations.length, 1);
    assert.equal(status.declarations[0].declarationId, declaration.declarationId);
    assert.equal(
      status.declarations[0].declarationDigest,
      digestDeclaration(status.declarations[0]),
    );
    assert.equal(
      statusCurrent({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        now: new Date('2026-09-13T12:01:00.000Z'),
      }).declarations.length,
      1,
    );
    assert.equal(
      statusCurrent({
        home: scope.home,
        workspaceRoot: scope.workspaceB,
        now: new Date('2026-09-13T12:01:00.000Z'),
      }).declarations.length,
      0,
    );
  } finally {
    scope.close();
  }
});

test('warns but allows overlapping source claims on independent branches', () => {
  const scope = fixture();
  try {
    const first = startOrUpdateDeclaration(options(scope));
    const warnings = [];
    const second = startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: scope.workspaceB,
        workItemId: 'other-work',
        sessionId: 'session-b',
        branch: 'feat/other',
        sourceHead: '2'.repeat(40),
        sourceClaims: 'exclusive-write:tooling/skills/pt-dev-workflow',
      }),
      { onWarning: (warning) => warnings.push(warning) },
    );

    assert.equal(
      statusAll({ home: scope.home }).declarations.length,
      2,
    );
    assert.notEqual(second.workspaceId, first.workspaceId);
    assert.deepEqual(warnings, [
      {
        declarationId: first.declarationId,
        workspaceId: first.workspaceId,
        branch: first.branch,
        kind: 'SOURCE_OVERLAP_WARNING',
        resource: 'tooling/skills/pt-dev-workflow',
        otherPathPrefix: 'tooling/skills',
      },
    ]);
  } finally {
    scope.close();
  }
});

test('rejects overlapping exclusive source claims inside one workspace', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope));
    expectCode('RESOURCE_DECLARATION_CONFLICT', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workItemId: 'other-work',
          sessionId: 'session-b',
          branch: 'feat/other',
          sourceHead: '2'.repeat(40),
          sourceClaims: 'exclusive-write:tooling/skills/pt-dev-workflow',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('allows shared reads and rejects exclusive runtime conflicts', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(
      options(scope, {
        sourceClaims: 'shared-read:docs',
        runtimeClaims: 'exclusive:local.slot:3',
      }),
    );
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: scope.workspaceB,
        workItemId: 'reader',
        sessionId: 'session-b',
        branch: 'feat/reader',
        sourceHead: '2'.repeat(40),
        sourceClaims: 'shared-read:docs',
        runtimeClaims: '',
      }),
    );
    expectCode('RESOURCE_DECLARATION_CONFLICT', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: scope.workspaceB,
          workItemId: 'slot-user',
          sessionId: 'session-c',
          branch: 'feat/slot',
          sourceHead: '3'.repeat(40),
          sourceClaims: 'shared-read:model',
          runtimeClaims: 'exclusive:local.slot:3',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('rejects two workspaces writing the same branch even on disjoint paths', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(
      options(scope, {
        sourceClaims: 'exclusive-write:apps/desktop',
      }),
    );
    expectCode('RESOURCE_DECLARATION_CONFLICT', () =>
      startOrUpdateDeclaration(
        options(scope, {
          workspaceRoot: scope.workspaceB,
          workItemId: 'same-branch',
          sessionId: 'session-b',
          sourceHead: '2'.repeat(40),
          sourceClaims: 'exclusive-write:apps/station',
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('marks expired declarations stale and permits a successor', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope, { expiresMinutes: 1 }));
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: scope.workspaceB,
        workItemId: 'successor',
        sessionId: 'session-b',
        branch: 'feat/successor',
        sourceHead: '2'.repeat(40),
        now: new Date('2026-09-13T12:02:00.000Z'),
      }),
    );
    const states = statusAll({
      home: scope.home,
      now: new Date('2026-09-13T12:02:00.000Z'),
    }).declarations.map((item) => item.state);
    assert.deepEqual(states.sort(), ['DECLARED', 'STALE']);
  } finally {
    scope.close();
  }
});

test('heartbeat extends ownership and release requires the owning session', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope, { expiresMinutes: 1 }));
    const heartbeat = heartbeatDeclaration(
      options(scope, {
        now: new Date('2026-09-13T12:00:30.000Z'),
        expiresMinutes: 10,
      }),
    );
    assert.equal(heartbeat.expiresAt, '2026-09-13T12:10:30.000Z');
    expectCode('WORK_DECLARATION_OWNER_MISMATCH', () =>
      releaseDeclaration(options(scope, { sessionId: 'other-session' })),
    );
    const released = releaseDeclaration(
      options(scope, { now: new Date('2026-09-13T12:01:00.000Z') }),
    );
    assert.equal(released.state, 'RELEASED');
  } finally {
    scope.close();
  }
});

test('start replaces a released declaration while update cannot revive it', () => {
  const scope = fixture();
  try {
    const created = startOrUpdateDeclaration(options(scope));
    releaseDeclaration(options(scope));
    expectCode('WORK_DECLARATION_NOT_ACTIVE', () =>
      startOrUpdateDeclaration(
        options(scope, { purpose: 'invalid revive' }),
        { requireExisting: true },
      ),
    );
    const restarted = startOrUpdateDeclaration(
      options(scope, {
        sessionId: 'session-restarted',
        purpose: 'new run',
        now: new Date('2026-09-13T12:05:00.000Z'),
      }),
    );
    assert.equal(restarted.declarationId, created.declarationId);
    assert.equal(restarted.state, 'DECLARED');
    assert.equal(restarted.sessionId, 'session-restarted');
    assert.equal(restarted.createdAt, '2026-09-13T12:05:00.000Z');
  } finally {
    scope.close();
  }
});

test('rejects live declaration takeover by another session or owner', () => {
  const scope = fixture();
  try {
    startOrUpdateDeclaration(options(scope));
    expectCode('WORK_DECLARATION_OWNER_MISMATCH', () =>
      startOrUpdateDeclaration(
        options(scope, {
          sessionId: 'session-b',
        }),
      ),
    );
    expectCode('WORK_DECLARATION_OWNER_MISMATCH', () =>
      startOrUpdateDeclaration(
        options(scope, {
          owner: 'other-owner',
        }),
        { requireExisting: true },
      ),
    );
  } finally {
    scope.close();
  }
});

test('update preserves claims and requires activation before identity checks', () => {
  const scope = fixture();
  try {
    const created = startOrUpdateDeclaration(options(scope));
    const updated = startOrUpdateDeclaration(
      options(scope, {
        purpose: 'updated purpose',
        sourceClaims: undefined,
        runtimeClaims: undefined,
      }),
      { requireExisting: true },
    );
    assert.deepEqual(updated.sourceClaims, created.sourceClaims);
    assert.deepEqual(updated.runtimeClaims, created.runtimeClaims);
    expectCode('WORK_DECLARATION_NOT_ACTIVE', () =>
      checkDeclaration({
        home: scope.home,
        workspaceRoot: scope.workspaceA,
        workItemId: 'workflow-control-plane',
      }),
    );
  } finally {
    scope.close();
  }
});

test('check rejects source HEAD drift', () => {
  const scope = fixture();
  try {
    const currentRepo = process.cwd();
    const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: currentRepo,
      encoding: 'utf8',
    }).trim();
    const wrongHead = currentHead === '4'.repeat(40) ? '5'.repeat(40) : '4'.repeat(40);
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: currentRepo,
        branch: undefined,
        sourceHead: wrongHead,
      }),
    );
    expectCode('WORKTREE_IDENTITY_MISMATCH', () =>
      checkDeclaration({
        home: scope.home,
        workspaceRoot: currentRepo,
        workItemId: 'workflow-control-plane',
        sessionId: 'session-a',
        now: new Date('2026-09-13T12:01:00.000Z'),
      }),
    );
  } finally {
    scope.close();
  }
});

test('check promotes a matching declaration to active', () => {
  const scope = fixture();
  try {
    const currentRepo = process.cwd();
    startOrUpdateDeclaration(
      options(scope, {
        workspaceRoot: currentRepo,
        branch: undefined,
        sourceHead: undefined,
      }),
    );
    const active = checkDeclaration({
      home: scope.home,
      workspaceRoot: currentRepo,
      workItemId: 'workflow-control-plane',
      now: new Date('2026-09-13T12:01:00.000Z'),
    });
    assert.equal(active.state, 'ACTIVE');
    assert.equal(active.declarationDigest, digestDeclaration(active));
  } finally {
    scope.close();
  }
});

test('malformed ledger fails closed without replacement', () => {
  const scope = fixture();
  try {
    const ledgerFile = path.join(scope.home, '.peers-touch', 'dev', 'work.json');
    mkdirSync(path.dirname(ledgerFile), { recursive: true });
    writeFileSync(ledgerFile, '{"schemaVersion":1,"kind":"wrong"}\n');
    const before = readFileSync(ledgerFile, 'utf8');
    expectCode('MACHINE_WORK_LEDGER_INVALID', () =>
      readLedger(ledgerFile),
    );
    expectCode('MACHINE_WORK_LEDGER_INVALID', () =>
      startOrUpdateDeclaration(options(scope)),
    );
    assert.equal(readFileSync(ledgerFile, 'utf8'), before);
  } finally {
    scope.close();
  }
});

test('unknown declaration fields fail closed', () => {
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
});

test('non-canonical declaration keys and claims fail closed', () => {
  const keyScope = fixture();
  try {
    const created = startOrUpdateDeclaration(options(keyScope));
    const ledgerFile = path.join(
      keyScope.home,
      '.peers-touch',
      'dev',
      'work.json',
    );
    const ledger = JSON.parse(readFileSync(ledgerFile, 'utf8'));
    ledger.declarations.other = ledger.declarations[created.declarationId];
    delete ledger.declarations[created.declarationId];
    writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);
    expectCode('MACHINE_WORK_LEDGER_INVALID', () => readLedger(ledgerFile));
  } finally {
    keyScope.close();
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
    declaration.sourceClaims[0].pathPrefix = 'docs//README.md';
    declaration.declarationDigest = digestDeclaration(declaration);
    writeFileSync(ledgerFile, `${JSON.stringify(ledger)}\n`);
    expectCode('MACHINE_WORK_LEDGER_INVALID', () => readLedger(ledgerFile));
  } finally {
    claimScope.close();
  }
});

test('malformed work ledger lock metadata fails closed', () => {
  const scope = fixture();
  try {
    const lockFile = path.join(scope.home, '.peers-touch', 'dev', 'work.lock');
    mkdirSync(path.dirname(lockFile), { recursive: true });
    const malformed = `${JSON.stringify({
      pid: String(process.pid),
      processStart: processStartIdentity(),
      createdAt: new Date().toISOString(),
    })}\n`;
    writeFileSync(lockFile, malformed);
    expectCode('MACHINE_WORK_LEDGER_LOCK_INVALID', () =>
      startOrUpdateDeclaration(options(scope, { lockTimeoutMs: 10 })),
    );
    assert.equal(readFileSync(lockFile, 'utf8'), malformed);
  } finally {
    scope.close();
  }
});

test('live work ledger lock fails within the caller budget', () => {
  const scope = fixture();
  try {
    const lockFile = path.join(scope.home, '.peers-touch', 'dev', 'work.lock');
    mkdirSync(path.dirname(lockFile), { recursive: true });
    writeFileSync(
      lockFile,
      `${JSON.stringify({
        pid: process.pid,
        processStart: processStartIdentity(),
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    expectCode('MACHINE_WORK_LEDGER_LOCKED', () =>
      startOrUpdateDeclaration(
        options(scope, {
          lockTimeoutMs: 10,
        }),
      ),
    );
  } finally {
    scope.close();
  }
});

test('publishes lock metadata atomically for concurrent readers', async () => {
  const scope = fixture();
  let child;
  try {
    const preload = path.join(scope.root, 'delay-lock-write.cjs');
    writeFileSync(
      preload,
      [
        "const fs = require('node:fs');",
        "const { syncBuiltinESMExports } = require('node:module');",
        'const delayed = new Set();',
        'const originalOpenSync = fs.openSync;',
        'fs.openSync = function (...args) {',
        '  const fd = originalOpenSync.apply(this, args);',
        "  if (String(args[0]).includes('work.lock')) delayed.add(fd);",
        '  return fd;',
        '};',
        'const originalWriteFileSync = fs.writeFileSync;',
        'fs.writeFileSync = function (target, ...args) {',
        '  if (delayed.delete(target)) {',
        '    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);',
        '  }',
        '  return originalWriteFileSync.call(this, target, ...args);',
        '};',
        'syncBuiltinESMExports();',
        '',
      ].join('\n'),
    );
    const cli = fileURLToPath(new URL('./dev-work.mjs', import.meta.url));
    child = spawn(
      process.execPath,
      [
        cli,
        'start',
        '--home',
        scope.home,
        '--workspace-root',
        scope.workspaceA,
        '--work-item',
        'concurrent-writer',
        '--session',
        'concurrent-session',
        '--owner',
        'test-owner',
        '--purpose',
        'exercise atomic lock publication',
        '--branch',
        'feat/concurrent-writer',
        '--source-head',
        '4'.repeat(40),
        '--source-claims',
        'exclusive-write:tooling/concurrent',
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${preload}`.trim(),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const childResult = new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });

    const lockFile = path.join(scope.home, '.peers-touch', 'dev', 'work.lock');
    const deadline = Date.now() + 2_000;
    while (!existsSync(lockFile) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.ok(existsSync(lockFile), 'child did not publish the work ledger lock');

    const status = statusAll({
      home: scope.home,
      lockTimeoutMs: 2_000,
    });
    const result = await childResult;
    assert.equal(
      result.code,
      0,
      `child failed with signal ${result.signal}: ${stderr || stdout}`,
    );
    assert.equal(status.declarations.length, 1);
    assert.equal(status.declarations[0].workItemId, 'concurrent-writer');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    scope.close();
  }
});
