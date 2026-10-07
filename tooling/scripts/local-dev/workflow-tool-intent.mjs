import path from 'node:path';

import { parse } from 'shell-quote';
import {
  isWorkflowOwnerCommandTarget,
} from './workflow-owner-command-policy.mjs';

const READ_ONLY_TOOL_NAMES = new Set([
  'askuserquestion',
  'glob',
  'grep',
  'read',
  'requestuserinput',
  'viewimage',
  'webfetch',
  'websearch',
]);
const WRITE_TOOL_NAMES =
  /(applypatch|edit|strreplace|write|delete|move|rename)/;
const SHELL_TOOL_NAMES = /(bash|command|exec|run|shell|terminal)/;
const READ_ONLY_COMMANDS = new Set([
  'cat',
  'cd',
  'date',
  'echo',
  'grep',
  'head',
  'jq',
  'ls',
  'printf',
  'pwd',
  'realpath',
  'rg',
  'sed',
  'stat',
  'tail',
  'true',
  'wc',
]);
const SHELL_SEPARATORS = new Set(['&&', '||', '|', ';']);
const REDIRECT_OPERATORS = new Set([
  '>',
  '>>',
  '<',
  '<<',
  '>&',
  '<&',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim())
    : [];
}

export function normalizeToolName(value) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function patchTargets(value) {
  if (typeof value !== 'string') return [];
  return [...value.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(
    (match) => match[1].trim(),
  );
}

export function declaredWriteTargets(event) {
  const input = isObject(event.toolInput) ? event.toolInput : {};
  const values = [
    ...event.willEditFilepaths,
    input.file_path,
    input.filePath,
    input.path,
    ...stringArray(input.paths),
    ...patchTargets(input.patch ?? input.diff),
  ];
  return [
    ...new Set(
      values.filter((value) => typeof value === 'string' && value.trim()),
    ),
  ];
}

function unsupportedShellSyntax(command) {
  return (
    command.includes('\n') ||
    command.includes('\r') ||
    command.includes('\0') ||
    command.includes('`') ||
    command.includes('$') ||
    command.includes('<(') ||
    command.includes('>(')
  );
}

function hasUnbalancedShellQuotes(command) {
  let quote = null;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote === null && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (character === quote) quote = null;
  }
  return quote !== null || escaped;
}

function shellWord(token) {
  if (typeof token === 'string') return token;
  if (isObject(token) && token.op === 'glob' && typeof token.pattern === 'string') {
    return token.pattern;
  }
  return null;
}

export function parseShellAst(command) {
  if (typeof command !== 'string' || !command.trim()) {
    return { valid: false, code: 'SHELL_COMMAND_MISSING', commands: [] };
  }
  if (unsupportedShellSyntax(command) || hasUnbalancedShellQuotes(command)) {
    return {
      valid: false,
      code: 'SHELL_DYNAMIC_SYNTAX_DENIED',
      commands: [],
    };
  }

  let tokens;
  try {
    tokens = parse(command, {});
  } catch {
    return { valid: false, code: 'SHELL_PARSE_FAILED', commands: [] };
  }
  const commands = [];
  let current = [];
  let hasRedirect = false;
  let hasUnsafeRedirect = false;
  let hasGlob = false;
  for (const [index, token] of tokens.entries()) {
    if (isObject(token) && typeof token.op === 'string') {
      if (REDIRECT_OPERATORS.has(token.op)) {
        hasRedirect = true;
        const target = shellWord(tokens[index + 1]);
        const safe =
          token.op === '<' ||
          token.op === '<&' ||
          ((token.op === '>' || token.op === '>>') &&
            target === '/dev/null') ||
          (token.op === '>&' && /^\d+$/.test(target ?? ''));
        if (!safe) hasUnsafeRedirect = true;
        current.push({ operator: token.op });
        continue;
      }
      if (!SHELL_SEPARATORS.has(token.op)) {
        return {
          valid: false,
          code: 'SHELL_OPERATOR_DENIED',
          commands: [],
        };
      }
      if (current.length === 0) {
        return { valid: false, code: 'SHELL_PARSE_FAILED', commands: [] };
      }
      commands.push(current);
      current = [];
      continue;
    }
    if (isObject(token) && token.op === 'glob') hasGlob = true;
    const word = shellWord(token);
    if (word === null) {
      return {
        valid: false,
        code: 'SHELL_DYNAMIC_SYNTAX_DENIED',
        commands: [],
      };
    }
    current.push(word);
  }
  if (current.length > 0) commands.push(current);
  if (commands.length === 0) {
    return { valid: false, code: 'SHELL_PARSE_FAILED', commands: [] };
  }
  return {
    valid: true,
    commands,
    hasRedirect,
    hasUnsafeRedirect,
    hasGlob,
    hasBraceExpansion: tokens.some(
      (token) =>
        typeof token === 'string' &&
        token.includes('{') &&
        token.includes('}'),
    ),
  };
}

function executableName(command) {
  const first = command.find((item) => typeof item === 'string');
  return first ? path.basename(first).toLowerCase() : '';
}

function isReadOnlyCommand(command) {
  const words = command.filter((item) => typeof item === 'string');
  const executable = executableName(command);
  if (READ_ONLY_COMMANDS.has(executable)) {
    if (executable === 'sed' && words.some((word) => /^-.*i/.test(word))) {
      return false;
    }
    if (executable === 'rg' && words.some((word) => word.startsWith('--pre'))) {
      return false;
    }
    return true;
  }
  if (executable === 'git') {
    const unsafe = words.some(
      (word) => word === '--ext-diff' || word.startsWith('--output'),
    );
    return !unsafe && (
      new Set(['status', 'diff', 'log', 'show', 'rev-parse']).has(words[1]) ||
        (words[1] === 'branch' && words.includes('--show-current')) ||
        (words[1] === 'worktree' && words[2] === 'list')
    );
  }
  return false;
}

function hasNestedEvaluation(ast) {
  if (!ast.valid) return false;
  return ast.commands.some((command) => {
    const words = command.filter((item) => typeof item === 'string');
    const executable = executableName(command);
    if (new Set(['bash', 'sh', 'zsh', 'dash', 'fish']).has(executable)) {
      return words.includes('-c');
    }
    if (new Set(['node', 'python', 'python3', 'perl', 'ruby']).has(executable)) {
      return words.includes('-c') || words.includes('-e') || words.includes('--eval');
    }
    return executable === 'eval' || executable === 'source' || executable === '.';
  });
}

function hasWorkingDirectoryMutation(ast) {
  return (
    ast.valid &&
    ast.commands.some((command) =>
      new Set(['cd', 'pushd', 'popd']).has(executableName(command)),
    )
  );
}

function isOwnerCommand(ast) {
  if (
    !ast.valid ||
    ast.hasRedirect ||
    ast.hasGlob ||
    ast.hasBraceExpansion ||
    hasNestedEvaluation(ast) ||
    ast.commands.length !== 1
  ) {
    return false;
  }
  const words = ast.commands[0].filter((item) => typeof item === 'string');
  return (
    executableName(ast.commands[0]) === 'make' &&
    isWorkflowOwnerCommandTarget(words[1])
  );
}

function isDirectRuntimeOwner(toolName, ast) {
  if (normalizeToolName(toolName).includes('runtimeowner')) return true;
  if (!ast.valid) return false;
  return ast.commands.some((command) => {
    const words = command.filter((item) => typeof item === 'string');
    const names = words.map((word) => path.basename(word).toLowerCase());
    if (
      names.some((name) => name === 'runtime_owner.py' || name === 'runtime-owner') &&
      words.some((word) => word.toLowerCase() === 'run')
    ) {
      return true;
    }
    const acceptance = names.some((name) => name === 'acceptance-run.py');
    const policyIndex = words.findIndex(
      (word) => word === '--policy' || word.startsWith('--policy='),
    );
    const development =
      policyIndex >= 0 &&
      (words[policyIndex] === '--policy=development' ||
        words[policyIndex + 1] === 'development');
    return acceptance && development;
  });
}

function shellPathCandidates(ast) {
  if (!ast.valid) return [];
  const candidates = [];
  for (const command of ast.commands) {
    for (const token of command.slice(1)) {
      if (typeof token !== 'string') continue;
      if (token.startsWith('-')) {
        const assignment = token.indexOf('=');
        if (assignment > 0 && assignment < token.length - 1) {
          candidates.push(token.slice(assignment + 1));
        }
        continue;
      }
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue;
      candidates.push(token);
    }
  }
  return [...new Set(candidates)];
}

export function classifyToolIntent(event) {
  const name = normalizeToolName(event.toolName);
  if (READ_ONLY_TOOL_NAMES.has(name)) {
    return { kind: 'READ', mutating: false, targets: [] };
  }
  if (WRITE_TOOL_NAMES.test(name)) {
    return {
      kind: 'WRITE',
      mutating: true,
      targets: declaredWriteTargets(event),
    };
  }
  if (!SHELL_TOOL_NAMES.test(name)) {
    return {
      kind: 'UNSUPPORTED',
      mutating: true,
      targets: declaredWriteTargets(event),
    };
  }

  const ast = parseShellAst(event.command);
  if (isDirectRuntimeOwner(event.toolName, ast)) {
    return {
      kind: 'DIRECT_RUNTIME_OWNER',
      mutating: true,
      targets: shellPathCandidates(ast),
      ast,
    };
  }
  if (isOwnerCommand(ast)) {
    return {
      kind: 'OWNER_CONTROL',
      mutating: true,
      targets: shellPathCandidates(ast),
      ast,
    };
  }
  if (
    ast.valid &&
    !ast.hasUnsafeRedirect &&
    ast.commands.every((command) => isReadOnlyCommand(command))
  ) {
    return {
      kind: 'READ',
      mutating: false,
      targets: shellPathCandidates(ast),
      ast,
    };
  }
  if (
    ast.valid &&
    (
      ast.hasGlob ||
      ast.hasBraceExpansion ||
      hasNestedEvaluation(ast) ||
      hasWorkingDirectoryMutation(ast)
    )
  ) {
    return {
      kind: 'SHELL_UNSAFE',
      mutating: true,
      targets: shellPathCandidates(ast),
      ast: {
        ...ast,
        code:
          ast.hasGlob || ast.hasBraceExpansion
            ? 'SHELL_EXPANSION_MUTATION_DENIED'
            : hasWorkingDirectoryMutation(ast)
              ? 'SHELL_CWD_MUTATION_DENIED'
              : 'SHELL_NESTED_EVALUATION_DENIED',
      },
    };
  }
  return {
    kind: ast.valid ? 'SHELL_MUTATION' : 'SHELL_UNSAFE',
    mutating: true,
    targets: shellPathCandidates(ast),
    ast,
  };
}
