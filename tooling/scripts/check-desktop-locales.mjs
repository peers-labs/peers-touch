#!/usr/bin/env node
// Desktop locale completeness gate.
//
// Every literal translation key used by apps/desktop must exist in the
// locale packs it can resolve against, and the en / zh-CN packs must stay
// in parity. The i18next runtime is configured with keySeparator:false and
// defaultNS:'common', so a key is the full flat string inside the bound
// namespace file (e.g. useTranslation('tts') + t('stt.title') resolves
// tts.json["stt.title"]).
//
// This gate replaces the previous "works because every call site carried
// an English defaultValue" state, which left non-English users on fallback
// text whenever a key was never added to the packs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NAMESPACE = 'common';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);
// Generated proto bindings and dependencies never own translation calls.
const SKIP_DIRECTORIES = new Set(['node_modules', 'gen']);
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const KEY_PATTERN = '[a-z0-9-]+\\.[A-Za-z0-9_.]+';
// t('a.b' ...), i18n.t('a.b' ...), obj.t('a.b' ...) — the `t` identifier must
// not be a suffix of another identifier (t2, format), but property access is
// accepted since i18next t functions are commonly passed around on objects.
const TRANSLATE_CALL_RE = new RegExp(
  `(?:^|[^A-Za-z0-9_$])(?:i18n\\.)?t\\(\\s*(['"])(${KEY_PATTERN})\\1`,
  'g',
);
const RESOLVE_VALUE_RE = new RegExp(
  `(?:^|[^A-Za-z0-9_$])resolveI18nValue\\(\\s*(?:\\w+\\s*,\\s*)?(['"])(${KEY_PATTERN})\\1`,
  'g',
);

/** Namespaces bound by useTranslation(...) calls in one source file. */
export function parseNamespaces(content) {
  const namespaces = new Set();
  const callRe = /useTranslation\(\s*(\[[^\]]*\]|['"][\w-]+['"])?/g;
  let match;
  while ((match = callRe.exec(content)) !== null) {
    const argument = match[1];
    if (!argument) {
      namespaces.add(DEFAULT_NAMESPACE);
      continue;
    }
    for (const ns of argument.matchAll(/['"]([\w-]+)['"]/g)) {
      namespaces.add(ns[1]);
    }
  }
  return [...namespaces];
}

/** Slice the argument list of a call whose '(' starts at openIndex. */
function sliceCallArguments(content, openIndex) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (quote) {
      if (char === '\\') { index += 1; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') depth += 1;
    if (char === ')' && depth === 1) return content.slice(openIndex + 1, index);
    if (char === ')') depth -= 1;
  }
  return content.slice(openIndex + 1);
}

/** Explicit ns option on one t() call: ns: 'x' or ns: ['x', 'y']. */
function extractCallNamespaces(argumentText) {
  const literal = argumentText.match(/\bns\s*:\s*['"]([\w-]+)['"]/);
  if (literal) return [literal[1]];
  const array = argumentText.match(/\bns\s*:\s*\[([^\]]*)\]/);
  if (array) {
    return [...array[1].matchAll(/['"]([\w-]+)['"]/g)].map((match) => match[1]);
  }
  return [];
}

/**
 * Literal translation keys referenced in one source file.
 * Dynamic keys (variables / template strings) are intentionally ignored.
 * Returns [{ key, line, count, forceCommon, callNs }].
 */
export function extractTranslationKeys(content) {
  const findings = [];
  const callPatterns = [
    { regex: TRANSLATE_CALL_RE, forceCommon: false },
    { regex: RESOLVE_VALUE_RE, forceCommon: true },
  ];

  for (const { regex, forceCommon } of callPatterns) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const line = content.slice(0, match.index).split('\n').length;
      const openParen = content.indexOf('(', match.index + match[0].indexOf('t'));
      const argumentsText = openParen === -1 ? '' : sliceCallArguments(content, openParen);
      findings.push({
        key: match[2],
        line,
        count: /\bcount\s*:/.test(argumentsText),
        forceCommon,
        callNs: forceCommon ? [DEFAULT_NAMESPACE] : extractCallNamespaces(argumentsText),
      });
    }
  }

  // Deduplicate identical key+line observations.
  const seen = new Set();
  return findings.filter((finding) => {
    const stamp = `${finding.key}:${finding.line}`;
    if (seen.has(stamp)) return false;
    seen.add(stamp);
    return true;
  });
}

/**
 * A key resolves when it exists directly or via i18next plural suffix
 * variants (`key` called with count resolves key_one/key_other).
 */
function keyExists(pack, key) {
  if (Object.hasOwn(pack, key)) return true;
  return PLURAL_SUFFIXES.some((suffix) => Object.hasOwn(pack, `${key}_${suffix}`));
}

/** Flat JSON packs reject duplicate keys that JSON.parse silently keeps. */
export function findDuplicateKeys(text) {
  const seen = new Set();
  const duplicates = new Set();
  for (const match of text.matchAll(/^\s*"((?:[^"\\]|\\.)+)"\s*:/gm)) {
    if (seen.has(match[1])) duplicates.add(match[1]);
    seen.add(match[1]);
  }
  return [...duplicates];
}

async function collectSourceFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      files.push(...await collectSourceFiles(absolute));
    } else if (
      SOURCE_EXTENSIONS.has(path.extname(entry.name))
      && !entry.name.includes('.test.')
      && !entry.name.includes('.spec.')
    ) {
      files.push(absolute);
    }
  }
  return files.sort();
}

async function loadPacks(localesRoot, language, namespaces) {
  const packs = {};
  for (const namespace of namespaces) {
    const file = path.join(localesRoot, language, `${namespace}.json`);
    const text = await fs.readFile(file, 'utf8');
    const duplicates = findDuplicateKeys(text);
    if (duplicates.length > 0) {
      const error = new Error(`${language}/${namespace}.json has duplicate keys: ${duplicates.join(', ')}`);
      error.code = 'DUPLICATE_KEYS';
      throw error;
    }
    packs[namespace] = JSON.parse(text);
  }
  return packs;
}

export async function runChecker(repoRoot) {
  const localesRoot = path.join(repoRoot, 'packages', 'locales');
  const sourceRoot = path.join(repoRoot, 'apps', 'desktop', 'src');

  const metadata = JSON.parse(await fs.readFile(path.join(localesRoot, 'metadata.json'), 'utf8'));
  const namespaces = metadata.en.namespaces;

  const [enPacks, zhPacks, sourceFiles] = await Promise.all([
    loadPacks(localesRoot, 'en', namespaces),
    loadPacks(localesRoot, 'zh-CN', namespaces),
    collectSourceFiles(sourceRoot),
  ]);

  const errors = [];
  let referenceCount = 0;
  let unresolvedFileCount = 0;

  for (const file of sourceFiles) {
    const content = await fs.readFile(file, 'utf8');
    const bindings = parseNamespaces(content);
    const keys = extractTranslationKeys(content);
    if (keys.length === 0) continue;
    referenceCount += keys.length;

    // An explicit per-call ns option wins (t('x', { ns: 'agent' })).
    // Otherwise the file's useTranslation bindings apply; files that merely
    // receive t from a caller may resolve against any namespace.
    const eligible = (finding) => {
      if (finding.callNs.length > 0) {
        return finding.callNs.filter((namespace) => namespaces.includes(namespace));
      }
      return bindings.length > 0 ? bindings : namespaces;
    };
    const unresolved = keys.filter((finding) => {
      const scopes = eligible(finding);
      return !scopes.some((namespace) => enPacks[namespace] && keyExists(enPacks[namespace], finding.key));
    });

    for (const finding of unresolved) {
      errors.push(
        `${path.relative(repoRoot, file)}:${finding.line}: missing en key "${finding.key}"`
        + ` (checked namespaces: ${eligible(finding).join(', ')})`,
      );
    }

    if (unresolved.length > 0) unresolvedFileCount += 1;
  }

  // en / zh-CN parity, raw key sets must match (both languages ship _one/_other).
  for (const namespace of namespaces) {
    const enKeys = Object.keys(enPacks[namespace]).sort();
    const zhKeys = Object.keys(zhPacks[namespace]).sort();
    const enSet = new Set(enKeys);
    const zhSet = new Set(zhKeys);
    const onlyEn = enKeys.filter((key) => !zhSet.has(key));
    const onlyZh = zhKeys.filter((key) => !enSet.has(key));
    if (onlyEn.length > 0) {
      errors.push(`zh-CN/${namespace}.json missing ${onlyEn.length} key(s): ${onlyEn.slice(0, 5).join(', ')}${onlyEn.length > 5 ? ', …' : ''}`);
    }
    if (onlyZh.length > 0) {
      errors.push(`en/${namespace}.json missing ${onlyZh.length} key(s): ${onlyZh.slice(0, 5).join(', ')}${onlyZh.length > 5 ? ', …' : ''}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    sourceFileCount: sourceFiles.length,
    referenceCount,
    unresolvedFileCount,
    namespaceCount: namespaces.length,
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  const repoRoot = path.resolve(path.dirname(scriptPath), '../..');
  try {
    const result = await runChecker(repoRoot);
    if (!result.ok) {
      process.stderr.write(`FAIL Desktop locales:\n${result.errors.map((error) => `  - ${error}`).join('\n')}\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write(
        `PASS Desktop locales: ${result.referenceCount} key references across `
        + `${result.sourceFileCount} source files, ${result.namespaceCount} namespaces, en/zh-CN parity\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`FAIL Desktop locales: ${error.message}\n`);
    process.exitCode = 1;
  }
}
