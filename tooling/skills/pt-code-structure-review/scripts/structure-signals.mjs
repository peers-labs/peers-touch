#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SOURCE_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cpp',
  '.go',
  '.java',
  '.js',
  '.jsx',
  '.kt',
  '.kts',
  '.mjs',
  '.cjs',
  '.py',
  '.pyi',
  '.rb',
  '.rs',
  '.sh',
  '.swift',
  '.ts',
  '.tsx',
]);

const GENERATED_PATTERNS = [
  /(?:^|\/)generated(?:\/|$)/,
  /(?:^|\/)gen\/proto(?:\/|$)/,
  /\.generated(?:\.[^.]+)+$/,
  /\.pb\.(?:go|rs|dart|ts|js)$/,
  /_pb2(?:_grpc)?\.py$/,
];

const VENDORED_PATTERNS = [
  /(?:^|\/)vendor(?:\/|$)/,
  /(?:^|\/)third_party(?:\/|$)/,
  /(?:^|\/)node_modules(?:\/|$)/,
];

const SIGNALS = Object.freeze({
  FILE_LINES: {
    code: 'STRUCT-SIGNAL-FILE-LINES',
    threshold: 500,
    ruleHints: ['STRUCT-03', 'STRUCT-07'],
  },
  IMPORT_FANOUT: {
    code: 'STRUCT-SIGNAL-IMPORT-FANOUT',
    threshold: 20,
    ruleHints: ['STRUCT-03', 'STRUCT-04', 'STRUCT-05'],
  },
  INDENT_DEPTH: {
    code: 'STRUCT-SIGNAL-INDENT-DEPTH',
    threshold: 8,
    ruleHints: ['STRUCT-03', 'STRUCT-06'],
  },
});

export class StructureSignalError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StructureSignalError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new StructureSignalError(code, message);
}

function nextValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    fail('STRUCTURE_SIGNALS_USAGE', `${option} requires a value`);
  }
  return value;
}

export function parseArguments(argv) {
  let rangeProvided = false;
  const options = {
    range: 'HEAD',
    fixtureDir: null,
    format: 'text',
    classifyStdin: false,
    filesStdin: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--range') {
      options.range = nextValue(argv, index, token);
      rangeProvided = true;
      index += 1;
    } else if (token === '--fixture-dir') {
      options.fixtureDir = nextValue(argv, index, token);
      index += 1;
    } else if (token === '--format') {
      options.format = nextValue(argv, index, token);
      index += 1;
    } else if (token === '--classify-stdin') {
      options.classifyStdin = true;
    } else if (token === '--files-stdin') {
      options.filesStdin = true;
    } else if (token === '--help' || token === '-h') {
      options.help = true;
    } else {
      fail('STRUCTURE_SIGNALS_USAGE', `unknown argument: ${token}`);
    }
  }

  if (!options.range || !new Set(['text', 'json']).has(options.format)) {
    fail('STRUCTURE_SIGNALS_USAGE', 'invalid range or format');
  }
  if (options.fixtureDir !== null && options.fixtureDir.length === 0) {
    fail('STRUCTURE_SIGNALS_USAGE', 'fixture directory is empty');
  }
  const stdinModes = [options.classifyStdin, options.filesStdin].filter(
    Boolean,
  ).length;
  if (stdinModes > 1) {
    fail(
      'STRUCTURE_SIGNALS_USAGE',
      '--classify-stdin and --files-stdin are mutually exclusive',
    );
  }
  if (stdinModes > 0 && rangeProvided) {
    fail(
      'STRUCTURE_SIGNALS_USAGE',
      'stdin modes cannot be combined with --range',
    );
  }
  if (stdinModes > 0 && options.fixtureDir !== null) {
    fail(
      'STRUCTURE_SIGNALS_USAGE',
      'stdin modes cannot be combined with --fixture-dir',
    );
  }
  return options;
}

export function readStdinText(
  stream = process.stdin,
  readFile = fs.readFileSync,
) {
  if (typeof stream?._handle?.setBlocking === 'function') {
    stream._handle.setBlocking(true);
  }
  return readFile(0, 'utf8');
}

function git(root, args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail(
      'STRUCTURE_SIGNALS_RANGE_INVALID',
      `invalid or unreadable git range: ${args[2] ?? 'unknown'}`,
    );
  }
}

function walkFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

function normalizePath(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

export function normalizeSourcePath(file) {
  return file.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
}

function isRepositoryRelativePath(file) {
  const normalized = normalizeSourcePath(file);
  return (
    normalized.length > 0 &&
    !normalized.startsWith('/') &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split('/').includes('..')
  );
}

export function isGeneratedSource(file) {
  const normalized = normalizeSourcePath(file);
  return GENERATED_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isVendoredSource(file) {
  const normalized = normalizeSourcePath(file);
  return VENDORED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasAuthoredSourceKind(file) {
  const normalized = normalizeSourcePath(file);
  return (
    SOURCE_EXTENSIONS.has(path.extname(normalized)) ||
    path.basename(normalized) === 'Makefile' ||
    path.extname(normalized) === '.mk'
  );
}

export function isReviewableSource(file) {
  return classifySourcePath(file).status === 'REVIEW';
}

export function classifySourcePath(file) {
  const normalized = normalizeSourcePath(file);
  let status = 'REVIEW';
  let reason = 'authored-source';
  if (!isRepositoryRelativePath(normalized)) {
    status = 'SKIPPED';
    reason = 'invalid-path';
  } else if (isGeneratedSource(normalized)) {
    status = 'SKIPPED';
    reason = 'generated-source';
  } else if (isVendoredSource(normalized)) {
    status = 'SKIPPED';
    reason = 'vendored-source';
  } else if (normalized.startsWith('tooling/review-fixtures/')) {
    status = 'SKIPPED';
    reason = 'review-fixture';
  } else if (!hasAuthoredSourceKind(normalized)) {
    status = 'SKIPPED';
    reason = 'unsupported-file-kind';
  }
  return { path: normalized, status, reason };
}

function changedFiles(root, range) {
  const diff = git(root, ['diff', '--name-only', range, '--']);
  const files = diff ? diff.split('\n') : [];
  if (range === 'HEAD') {
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard']);
    if (untracked) files.push(...untracked.split('\n'));
  }
  return [...new Set(files.filter(Boolean))].sort();
}

function countImports(lines, extension) {
  const dependencies = new Set();
  if (extension === '.go') {
    let inImportBlock = false;
    for (const line of lines) {
      if (/^\s*import\s*\(\s*$/.test(line)) {
        inImportBlock = true;
        continue;
      }
      if (inImportBlock && /^\s*\)\s*$/.test(line)) {
        inImportBlock = false;
        continue;
      }
      const candidate = inImportBlock
        ? line
        : line.replace(/^\s*import\s+/, '');
      const specifier = candidate.match(
        /^\s*(?:[._A-Za-z][\w.]*\s+)?["`]([^"`]+)["`]/,
      )?.[1];
      if (specifier) {
        dependencies.add(specifier);
      }
    }
    return dependencies.size;
  }

  for (const line of lines) {
    const matches = [
      line.match(/\bfrom\s+["']([^"']+)["']/)?.[1],
      line.match(/^\s*import\s+["']([^"']+)["']/)?.[1],
      line.match(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/)?.[1],
      line.match(/^\s*require\s+["']([^"']+)["']/)?.[1],
      line.match(/^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/)?.[1],
      line.match(/^\s*use\s+([^;\s]+)\s*;/)?.[1],
      line.match(/^\s*#include\s*[<"]([^>"]+)[>"]/)?.[1],
      line.match(
        /^\s*import\s+([A-Za-z_][\w./*-]*)(?:\s+as\s+\w+)?\s*;?\s*$/,
      )?.[1],
    ];
    matches.filter(Boolean).forEach((specifier) => dependencies.add(specifier));

    const pythonImports = line.match(/^\s*import\s+(.+?)\s*$/)?.[1];
    if (pythonImports && ['.py', '.pyi'].includes(extension)) {
      pythonImports
        .split(',')
        .map((specifier) => specifier.trim().split(/\s+as\s+/)[0])
        .filter((specifier) => /^[A-Za-z_][\w.]*$/.test(specifier))
        .forEach((specifier) => dependencies.add(specifier));
    }
  }
  return dependencies.size;
}

function indentationDepth(lines) {
  return lines.reduce((maximum, line) => {
    const whitespace = line.match(/^[ \t]*/)?.[0] ?? '';
    const columns = [...whitespace].reduce(
      (total, character) => total + (character === '\t' ? 2 : 1),
      0,
    );
    return Math.max(maximum, Math.floor(columns / 2));
  }, 0);
}

function signal(definition, file, value, detail) {
  return {
    code: definition.code,
    path: file,
    value,
    threshold: definition.threshold,
    ruleHints: definition.ruleHints,
    detail,
    blocking: false,
  };
}

export function analyzeSource(file, source) {
  const lines = source === '' ? [] : source.split(/\r?\n/);
  if (lines.at(-1) === '') {
    lines.pop();
  }
  const extension = path.extname(file);
  const imports = countImports(lines, extension);
  const depth = indentationDepth(lines);
  const results = [];

  if (lines.length >= SIGNALS.FILE_LINES.threshold) {
    results.push(
      signal(
        SIGNALS.FILE_LINES,
        file,
        lines.length,
        `${lines.length} physical lines`,
      ),
    );
  }
  if (imports >= SIGNALS.IMPORT_FANOUT.threshold) {
    results.push(
      signal(
        SIGNALS.IMPORT_FANOUT,
        file,
        imports,
        `${imports} import dependencies`,
      ),
    );
  }
  if (depth >= SIGNALS.INDENT_DEPTH.threshold) {
    results.push(
      signal(
        SIGNALS.INDENT_DEPTH,
        file,
        depth,
        `maximum indentation depth ${depth}`,
      ),
    );
  }
  return results;
}

export function analyzeFiles(root, files, options = {}) {
  const sourceFiles = [...new Set(files.map(normalizeSourcePath))].filter(
    (file) =>
      isRepositoryRelativePath(file) &&
      hasAuthoredSourceKind(file) &&
      !isGeneratedSource(file) &&
      !isVendoredSource(file) &&
      (options.includeFixtures || !file.startsWith('tooling/review-fixtures/')) &&
      fs.existsSync(path.resolve(root, file)) &&
      fs.statSync(path.resolve(root, file)).isFile(),
  );
  const signals = sourceFiles.flatMap((file) => {
    const absolute = path.resolve(root, file);
    return analyzeSource(file, fs.readFileSync(absolute, 'utf8'));
  });
  return {
    kind: 'peers-touch-code-structure-signals',
    verdict: 'ADVISORY_ONLY',
    blocking: false,
    filesScanned: sourceFiles.length,
    signals,
  };
}

function renderText(result, target) {
  const lines = [
    `Code structure signals for ${target}`,
    `Scanned: ${result.filesScanned} non-generated source file(s)`,
  ];
  if (result.signals.length === 0) {
    lines.push('No advisory signals.');
  } else {
    for (const item of result.signals) {
      lines.push(
        `[${item.code}] ${item.path}: ${item.detail}; investigate ${item.ruleHints.join(', ')}`,
      );
    }
  }
  lines.push('code-structure-signals: pass (advisory only)');
  return `${lines.join('\n')}\n`;
}

export function run(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(
      'Usage: structure-signals.mjs [--range <git-range>] [--fixture-dir <dir>] [--format text|json] [--classify-stdin|--files-stdin]\n',
    );
    return;
  }

  if (options.classifyStdin) {
    const classifications = [
      ...new Set(
        readStdinText()
          .split(/\r?\n/)
          .map(normalizeSourcePath)
          .filter(Boolean),
      ),
    ]
      .sort()
      .map(classifySourcePath);
    if (options.format === 'json') {
      process.stdout.write(
        `${JSON.stringify(
          {
            kind: 'peers-touch-code-structure-source-classification',
            files: classifications,
          },
          null,
          2,
        )}\n`,
      );
      return;
    }
    const files = classifications
      .filter((item) => item.status === 'REVIEW')
      .map((item) => item.path);
    process.stdout.write(files.length > 0 ? `${files.join('\n')}\n` : '');
    return;
  }

  if (options.filesStdin) {
    const files = readStdinText()
      .split(/\r?\n/)
      .map(normalizeSourcePath)
      .filter(Boolean);
    const result = analyzeFiles(
      execFileSync('git', ['rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim(),
      files,
    );
    process.stdout.write(
      options.format === 'json'
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderText(result, 'stdin file scope'),
    );
    return;
  }

  let root;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    fail('STRUCTURE_SIGNALS_REPOSITORY_REQUIRED', 'not inside a git repository');
  }
  let files;
  let target;
  if (options.fixtureDir) {
    const fixtureRoot = path.resolve(root, options.fixtureDir);
    if (!fs.existsSync(fixtureRoot) || !fs.statSync(fixtureRoot).isDirectory()) {
      fail(
        'STRUCTURE_SIGNALS_FIXTURE_INVALID',
        `fixture directory does not exist: ${options.fixtureDir}`,
      );
    }
    files = walkFiles(fixtureRoot).map((file) => normalizePath(root, file));
    target = `fixture ${options.fixtureDir}`;
  } else {
    files = changedFiles(root, options.range);
    target = `range ${options.range}`;
  }

  const result = analyzeFiles(root, files, {
    includeFixtures: options.fixtureDir !== null,
  });
  process.stdout.write(
    options.format === 'json'
      ? `${JSON.stringify(result, null, 2)}\n`
      : renderText(result, target),
  );
}

if (
  process.argv[1] &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])
) {
  try {
    run();
  } catch (error) {
    const code = error?.code ?? 'STRUCTURE_SIGNALS_FAILED';
    process.stderr.write(`[${code}] ${error.message}\n`);
    process.exitCode = 1;
  }
}
