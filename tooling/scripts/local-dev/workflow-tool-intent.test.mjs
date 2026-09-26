import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyToolIntent,
  parseShellAst,
} from './workflow-tool-intent.mjs';

function shell(command) {
  return {
    toolName: 'exec_command',
    toolInput: { command },
    command,
    willEditFilepaths: [],
  };
}

test('parses composed read-only commands structurally', () => {
  const intent = classifyToolIntent(
    shell('git status --short && rg -n "binding" tooling | head -n 10'),
  );
  assert.equal(intent.kind, 'READ');
  assert.equal(intent.ast.commands.length, 3);
});

test('multiline and command-substitution payloads fail closed', () => {
  for (const command of [
    'cat README.md\nrm generated.txt',
    'echo $(rm generated.txt)',
    'echo `rm generated.txt`',
    'bash -c "rm ../other/file"',
    'rm "$OTHER/file"',
    'rm ../*/file',
    'cd ..; cd other; rm file',
  ]) {
    const intent = classifyToolIntent(shell(command));
    assert.equal(intent.kind, 'SHELL_UNSAFE');
    assert.match(intent.ast.code, /^SHELL_.*_DENIED$/);
  }
});

test('redirection is a mutation rather than a read-only command', () => {
  const intent = classifyToolIntent(shell('cat README.md > generated.txt'));
  assert.equal(intent.kind, 'SHELL_MUTATION');
  assert.equal(intent.ast.hasRedirect, true);
});

test('read-only input and dev-null redirections remain read-only', () => {
  assert.equal(
    classifyToolIntent(shell('cat < README.md')).kind,
    'READ',
  );
  assert.equal(
    classifyToolIntent(shell('rg binding 2>/dev/null || true')).kind,
    'READ',
  );
});

test('recognizes only one structurally exact workflow owner command', () => {
  for (const target of [
    'env-unregister',
    'dev-start',
    'plan-binding-advance',
    'plan-activate',
    'plan-reopen',
    'completion-review-prepare',
    'completion-review-submit',
    'completion-review-status',
    'skills',
  ]) {
    assert.equal(
      classifyToolIntent(shell(`make ${target} WORK_ITEM=WORK-01`)).kind,
      'OWNER_CONTROL',
      target,
    );
  }
  assert.notEqual(
    classifyToolIntent(
      shell('make dev-start WORK_ITEM=WORK-01; rm generated.txt'),
    ).kind,
    'OWNER_CONTROL',
  );
});

test('denies direct development runtime-owner execution', () => {
  assert.equal(
    classifyToolIntent(
      shell('python3 tooling/acceptance/runtime_owner.py run'),
    ).kind,
    'DIRECT_RUNTIME_OWNER',
  );
  assert.equal(
    classifyToolIntent(
      shell('python3 tooling/scripts/acceptance-run.py --policy development'),
    ).kind,
    'DIRECT_RUNTIME_OWNER',
  );
});

test('exposes parse failures as typed AST results', () => {
  assert.equal(parseShellAst('').code, 'SHELL_COMMAND_MISSING');
  assert.equal(parseShellAst('echo "unterminated').valid, false);
});
