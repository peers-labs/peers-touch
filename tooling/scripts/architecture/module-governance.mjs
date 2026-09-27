#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REGISTRY_KIND = 'peers-touch-architecture-module-registry';
export const REGISTRY_SCHEMA_VERSION = 1;
export const DEFAULT_REGISTRY_PATH =
  'docs/architecture/architecture-module-governance/architecture-modules.json';

const REGISTRY_KEYS = new Set(['kind', 'schemaVersion', 'modules']);
const MODULE_KEYS = new Set([
  'id',
  'root',
  'status',
  'owner',
  'characteristics',
  'requiredDocuments',
  'decisionIds',
  'governedPaths',
  'capabilities',
  'externalCapabilityRegistries',
]);
const CHARACTERISTIC_KEYS = new Set([
  'protocol',
  'stateMachine',
  'persistence',
  'ownership',
  'moduleLayout',
  'crossRuntime',
  'integration',
]);
const CAPABILITY_KEYS = new Set([
  'id',
  'owner',
  'contractRoots',
  'consumers',
  'allowedDependencies',
  'evidenceGates',
]);
const EXTERNAL_REGISTRY_KEYS = new Set([
  'path',
  'capabilityIds',
  'gate',
]);
const BASE_DOCUMENTS = ['README.md', 'design.md', 'decisions.md'];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEPENDENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const PYTHON_YAML_IDS = String.raw`
import json
import pathlib
import sys
import yaml

value = yaml.safe_load(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if not isinstance(value, dict) or not isinstance(value.get("capabilities"), list):
    raise ValueError("capabilities must be a list")
ids = []
for item in value["capabilities"]:
    if not isinstance(item, dict) or not isinstance(item.get("id"), str):
        raise ValueError("each capability must have a string id")
    ids.append(item["id"])
print(json.dumps(ids))
`;

export class ArchitectureGovernanceError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ArchitectureGovernanceError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      ok: false,
      error: {
        type: this.name,
        code: this.code,
        message: this.message,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

function fail(code, message, details) {
  throw new ArchitectureGovernanceError(code, message, details);
}

function isPlainObject(value) {
  return (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function assertClosedObject(value, keys, context) {
  if (!isPlainObject(value)) {
    fail('ARCHITECTURE_REGISTRY_INVALID', `${context} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} has unknown or missing fields`,
      { actual, expected },
    );
  }
}

function assertString(value, context, pattern = null) {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
    || (pattern !== null && !pattern.test(value))
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} must be a valid non-empty string`,
    );
  }
  return value;
}

function assertUniqueStrings(values, context, { min = 0, pattern = null } = {}) {
  if (!Array.isArray(values) || values.length < min) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} must contain at least ${min} item(s)`,
    );
  }
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    assertString(value, `${context}[${index}]`, pattern);
    if (seen.has(value)) {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        `${context} contains a duplicate`,
        { value },
      );
    }
    seen.add(value);
  }
}

function normalizeRepoPath(value, context) {
  assertString(value, context);
  if (
    path.isAbsolute(value)
    || value.includes('\\')
    || value !== path.posix.normalize(value)
    || value === '.'
    || value.startsWith('../')
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} must be a normalized repository-relative path`,
      { value },
    );
  }
  return value;
}

function resolveRepoPath(repoRoot, relative, context) {
  const normalized = normalizeRepoPath(relative, context);
  const resolved = path.resolve(repoRoot, normalized);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} escapes the repository`,
      { value: relative },
    );
  }
  return resolved;
}

function requireCurrentPath(
  repoRoot,
  relative,
  context,
  code = 'ARCHITECTURE_REGISTRY_INVALID',
) {
  const resolved = resolveRepoPath(repoRoot, relative, context);
  let metadata;
  try {
    metadata = fs.lstatSync(resolved);
  } catch {
    fail(code, `${context} does not exist`, {
      path: relative,
    });
  }
  if (metadata.isSymbolicLink()) {
    fail(code, `${context} must not be a symlink`, {
      path: relative,
    });
  }
  return resolved;
}

function readUtf8(repoRoot, relative, code, context) {
  const resolved = requireCurrentPath(repoRoot, relative, context, code);
  try {
    return fs.readFileSync(resolved, 'utf8');
  } catch (error) {
    fail(code, `${context} is unreadable`, {
      path: relative,
      reason: error.message,
    });
  }
}

function parseJson(text, code, context) {
  try {
    return JSON.parse(text);
  } catch (error) {
    fail(code, `${context} is not valid JSON`, { reason: error.message });
  }
}

export function deriveRequiredDocuments(characteristics) {
  assertClosedObject(
    characteristics,
    CHARACTERISTIC_KEYS,
    'module.characteristics',
  );
  for (const key of CHARACTERISTIC_KEYS) {
    if (typeof characteristics[key] !== 'boolean') {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        `module.characteristics.${key} must be boolean`,
      );
    }
  }
  const documents = [...BASE_DOCUMENTS];
  if (
    characteristics.protocol
    || characteristics.stateMachine
    || characteristics.persistence
  ) {
    documents.push('data-model.md');
  }
  if (characteristics.ownership || characteristics.moduleLayout) {
    documents.push('module-layout.md');
  }
  if (characteristics.crossRuntime || characteristics.integration) {
    documents.push('integration.md');
  }
  return documents;
}

function assertExactArray(actual, expected, code, context) {
  if (
    !Array.isArray(actual)
    || actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    fail(code, `${context} does not match the derived contract`, {
      actual,
      expected,
    });
  }
}

function metadataValue(source, name) {
  const match = new RegExp(
    `^>\\s+\\*\\*${name}\\*\\*:\\s*(.+?)\\s*$`,
    'm',
  ).exec(source);
  return match?.[1] ?? null;
}

function validateDocument(repoRoot, module, document) {
  const relative = `${module.root}/${document}`;
  const source = readUtf8(
    repoRoot,
    relative,
    'ARCHITECTURE_DOCUMENT_REQUIRED',
    `${module.id} document`,
  );
  if (metadataValue(source, 'Status') !== module.status) {
    fail(
      'ARCHITECTURE_STATUS_MISMATCH',
      `${relative} status must match its module`,
      { expected: module.status, actual: metadataValue(source, 'Status') },
    );
  }
  if (metadataValue(source, 'Owner') !== module.owner) {
    fail(
      'ARCHITECTURE_STATUS_MISMATCH',
      `${relative} owner must match its module`,
      { expected: module.owner, actual: metadataValue(source, 'Owner') },
    );
  }
  return source;
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function validateDecision(source, moduleId, decisionId) {
  const escaped = escapePattern(decisionId);
  const indexPattern = new RegExp(
    `^\\|\\s*${escaped}\\s*\\|[^\\n|]*\\|\\s*accepted\\s*\\|\\s*$`,
    'm',
  );
  if (!indexPattern.test(source)) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      `${decisionId} is not accepted in ${moduleId} decision index`,
    );
  }
  const heading = new RegExp(`^##\\s+${escaped}(?=\\s|:|：)`, 'm').exec(source);
  if (heading === null) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      `${decisionId} has no ADR section`,
    );
  }
  const remainder = source.slice(heading.index);
  const nextHeading = remainder.slice(1).search(/\n##\s+/);
  const section =
    nextHeading === -1 ? remainder : remainder.slice(0, nextHeading + 1);
  const required = [
    /\*\*Status\*\*:\s*accepted/,
    /\*\*Date\*\*:\s*\d{4}-\d{2}-\d{2}/,
    /^(?:###\s+Context|\*\*Context\*\*)\s*$/m,
    /^(?:###\s+Decision|\*\*Decision\*\*)\s*$/m,
    /^(?:###\s+Rationale|\*\*Rationale\*\*)\s*$/m,
    /^(?:###\s+Alternatives Considered|\*\*Alternatives Considered\*\*)\s*$/m,
    /^(?:###\s+Consequences|\*\*Consequences\*\*)\s*$/m,
  ];
  if (required.some((pattern) => !pattern.test(section))) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      `${decisionId} does not satisfy the ADR-lite contract`,
    );
  }
}

function acceptedDecisionIds(source) {
  return [
    ...source.matchAll(
      /^\|\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*\|[^\n|]*\|\s*accepted\s*\|\s*$/gm,
    ),
  ].map((match) => match[1]);
}

function loadExternalCapabilityIds(repoRoot, relative) {
  const absolute = requireCurrentPath(
    repoRoot,
    relative,
    'external capability registry',
  );
  if (path.extname(relative) === '.json') {
    const value = parseJson(
      fs.readFileSync(absolute, 'utf8'),
      'ARCHITECTURE_REGISTRY_INVALID',
      relative,
    );
    if (!isPlainObject(value) || !Array.isArray(value.capabilities)) {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        `${relative} capabilities must be an array`,
      );
    }
    const ids = value.capabilities.map((item) => item?.id);
    assertUniqueStrings(ids, `${relative}.capabilityIds`, {
      min: 1,
      pattern: ID_PATTERN,
    });
    return new Set(ids);
  }
  const result = spawnSync('python3', ['-c', PYTHON_YAML_IDS, absolute], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${relative} could not be parsed as a capability registry`,
      { reason: result.stderr.trim() },
    );
  }
  const ids = parseJson(
    result.stdout,
    'ARCHITECTURE_REGISTRY_INVALID',
    `${relative} capability IDs`,
  );
  assertUniqueStrings(ids, `${relative}.capabilityIds`, {
    min: 1,
    pattern: ID_PATTERN,
  });
  return new Set(ids);
}

function pathContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function validateCapability(repoRoot, module, capability, context) {
  assertClosedObject(capability, CAPABILITY_KEYS, context);
  assertString(capability.id, `${context}.id`, ID_PATTERN);
  assertString(capability.owner, `${context}.owner`, ID_PATTERN);
  assertUniqueStrings(capability.contractRoots, `${context}.contractRoots`, {
    min: 1,
  });
  assertUniqueStrings(capability.consumers, `${context}.consumers`, { min: 1 });
  assertUniqueStrings(
    capability.allowedDependencies,
    `${context}.allowedDependencies`,
    { pattern: DEPENDENCY_PATTERN },
  );
  assertUniqueStrings(capability.evidenceGates, `${context}.evidenceGates`, {
    min: 1,
    pattern: ID_PATTERN,
  });
  for (const field of ['contractRoots', 'consumers']) {
    capability[field].forEach((value, index) => {
      requireCurrentPath(repoRoot, value, `${context}.${field}[${index}]`);
      if (
        !module.governedPaths.some((prefix) => pathContains(prefix, value))
      ) {
        fail(
          'ARCHITECTURE_REGISTRY_INVALID',
          `${context}.${field}[${index}] is outside module governed paths`,
          { path: value },
        );
      }
    });
  }
}

function validateExternalRegistry(repoRoot, external, context) {
  assertClosedObject(external, EXTERNAL_REGISTRY_KEYS, context);
  normalizeRepoPath(external.path, `${context}.path`);
  assertUniqueStrings(external.capabilityIds, `${context}.capabilityIds`, {
    min: 1,
    pattern: ID_PATTERN,
  });
  assertString(external.gate, `${context}.gate`, ID_PATTERN);
  const available = loadExternalCapabilityIds(repoRoot, external.path);
  const missing = external.capabilityIds.filter((id) => !available.has(id));
  if (missing.length > 0) {
    fail(
      'ARCHITECTURE_CAPABILITY_UNKNOWN',
      `${context} references unknown capability IDs`,
      { path: external.path, missing },
    );
  }
}

function validateModule(repoRoot, module, indexSource, position) {
  const context = `modules[${position}]`;
  assertClosedObject(module, MODULE_KEYS, context);
  assertString(module.id, `${context}.id`, MODULE_ID_PATTERN);
  normalizeRepoPath(module.root, `${context}.root`);
  if (
    !module.root.startsWith('docs/architecture/')
    || path.posix.basename(module.root) !== module.id
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context}.root must be docs/architecture/<module-id>`,
    );
  }
  if (module.status !== 'active') {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context}.status must be active`,
    );
  }
  assertString(module.owner, `${context}.owner`);
  const derived = deriveRequiredDocuments(module.characteristics);
  assertExactArray(
    module.requiredDocuments,
    derived,
    'ARCHITECTURE_DOCUMENT_REQUIRED',
    `${module.id}.requiredDocuments`,
  );
  assertUniqueStrings(module.decisionIds, `${context}.decisionIds`, {
    min: 1,
    pattern: ID_PATTERN,
  });
  assertUniqueStrings(module.governedPaths, `${context}.governedPaths`, {
    min: 1,
  });
  if (!module.governedPaths.includes(module.root)) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${module.id} must govern its document root`,
    );
  }
  module.governedPaths.forEach((value, index) =>
    requireCurrentPath(repoRoot, value, `${context}.governedPaths[${index}]`));
  const documentSources = new Map(
    module.requiredDocuments.map((document) => [
      document,
      validateDocument(repoRoot, module, document),
    ]),
  );
  const decisions = documentSources.get('decisions.md');
  assertExactArray(
    [...module.decisionIds].sort(),
    acceptedDecisionIds(decisions).sort(),
    'ARCHITECTURE_DECISION_INVALID',
    `${module.id}.decisionIds`,
  );
  for (const decisionId of module.decisionIds) {
    validateDecision(decisions, module.id, decisionId);
  }
  const indexReference = `${module.root.slice('docs/'.length)}/README.md`;
  if (!indexSource.includes(indexReference)) {
    fail(
      'ARCHITECTURE_INDEX_MISSING',
      `${module.id} is missing from docs/README.md`,
      { expectedReference: indexReference },
    );
  }
  if (!Array.isArray(module.capabilities)) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context}.capabilities must be an array`,
    );
  }
  module.capabilities.forEach((capability, index) =>
    validateCapability(
      repoRoot,
      module,
      capability,
      `${context}.capabilities[${index}]`,
    ));
  if (!Array.isArray(module.externalCapabilityRegistries)) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context}.externalCapabilityRegistries must be an array`,
    );
  }
  module.externalCapabilityRegistries.forEach((external, index) =>
    validateExternalRegistry(
      repoRoot,
      external,
      `${context}.externalCapabilityRegistries[${index}]`,
    ));
  return module;
}

function assertUnambiguousGovernedPaths(modules) {
  const claims = modules.flatMap((module) =>
    module.governedPaths.map((governedPath) => ({
      moduleId: module.id,
      path: governedPath,
    })));
  for (let leftIndex = 0; leftIndex < claims.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < claims.length;
      rightIndex += 1
    ) {
      const left = claims[leftIndex];
      const right = claims[rightIndex];
      if (
        left.moduleId !== right.moduleId
        && (pathContains(left.path, right.path)
          || pathContains(right.path, left.path))
      ) {
        fail(
          'ARCHITECTURE_REGISTRY_INVALID',
          'governed paths overlap across modules',
          { left, right },
        );
      }
    }
  }
}

export function loadArchitectureRegistry({
  repoRoot = process.cwd(),
  registryPath = DEFAULT_REGISTRY_PATH,
} = {}) {
  const canonicalRoot = fs.realpathSync(repoRoot);
  const source = readUtf8(
    canonicalRoot,
    registryPath,
    'ARCHITECTURE_REGISTRY_INVALID',
    'architecture module registry',
  );
  return parseJson(
    source,
    'ARCHITECTURE_REGISTRY_INVALID',
    'architecture module registry',
  );
}

export function validateArchitectureRegistry({
  repoRoot = process.cwd(),
  registry = null,
  registryPath = DEFAULT_REGISTRY_PATH,
} = {}) {
  const canonicalRoot = fs.realpathSync(repoRoot);
  const value = registry ?? loadArchitectureRegistry({
    repoRoot: canonicalRoot,
    registryPath,
  });
  assertClosedObject(value, REGISTRY_KEYS, 'registry');
  if (
    value.kind !== REGISTRY_KIND
    || value.schemaVersion !== REGISTRY_SCHEMA_VERSION
    || !Array.isArray(value.modules)
    || value.modules.length === 0
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      'registry identity or modules are invalid',
    );
  }
  const indexSource = readUtf8(
    canonicalRoot,
    'docs/README.md',
    'ARCHITECTURE_INDEX_MISSING',
    'docs index',
  );
  const modules = value.modules.map((module, index) =>
    validateModule(canonicalRoot, module, indexSource, index));
  const moduleIds = new Set();
  const capabilityIds = new Set();
  for (const module of modules) {
    if (moduleIds.has(module.id)) {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        'module IDs must be globally unique',
        { id: module.id },
      );
    }
    moduleIds.add(module.id);
    for (const capability of module.capabilities) {
      if (capabilityIds.has(capability.id)) {
        fail(
          'ARCHITECTURE_REGISTRY_INVALID',
          'capability IDs must be globally unique',
          { id: capability.id },
        );
      }
      capabilityIds.add(capability.id);
    }
  }
  assertUnambiguousGovernedPaths(modules);
  return {
    ok: true,
    registry: value,
    modules,
    moduleIds: [...moduleIds].sort(),
    capabilityIds: [...capabilityIds].sort(),
  };
}

export function modulesForPaths(registryResult, paths) {
  const normalized = paths.map((value, index) =>
    normalizeRepoPath(value, `paths[${index}]`));
  return registryResult.modules.filter((module) =>
    normalized.some((candidate) =>
      module.governedPaths.some((prefix) => pathContains(prefix, candidate))));
}

function nearestActiveArchitectureRoot(repoRoot, relative) {
  if (!relative.startsWith('docs/architecture/')) return null;
  const parts = relative.split('/');
  const start = parts.length > 3 ? parts.length - 1 : 3;
  for (let length = start; length >= 3; length -= 1) {
    const candidate = parts.slice(0, length).join('/');
    const readme = path.join(repoRoot, candidate, 'README.md');
    if (!fs.existsSync(readme) || !fs.lstatSync(readme).isFile()) continue;
    const source = fs.readFileSync(readme, 'utf8');
    if (metadataValue(source, 'Status') === 'active') return candidate;
  }
  return null;
}

export function validateChangedArchitecturePaths({
  repoRoot = process.cwd(),
  changedPaths,
  registry = null,
  registryPath = DEFAULT_REGISTRY_PATH,
}) {
  if (!Array.isArray(changedPaths)) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      'changedPaths must be an array',
    );
  }
  const canonicalRoot = fs.realpathSync(repoRoot);
  const registryResult = validateArchitectureRegistry({
    repoRoot: canonicalRoot,
    registry,
    registryPath,
  });
  const normalized = changedPaths.map((value, index) =>
    normalizeRepoPath(value, `changedPaths[${index}]`));
  const registeredRoots = new Set(
    registryResult.modules.map((module) => module.root),
  );
  for (const changedPath of normalized) {
    const activeRoot = nearestActiveArchitectureRoot(
      canonicalRoot,
      changedPath,
    );
    const standardDocument = BASE_DOCUMENTS.concat([
      'data-model.md',
      'module-layout.md',
      'integration.md',
    ]).includes(path.posix.basename(changedPath));
    const unregisteredModulePath =
      changedPath.split('/').length >= 4
      && changedPath.startsWith('docs/architecture/')
      && standardDocument;
    if (
      (activeRoot !== null && !registeredRoots.has(activeRoot))
      || (activeRoot === null && unregisteredModulePath)
    ) {
      fail(
        'ARCHITECTURE_MODULE_UNREGISTERED',
        'changed active architecture module is not registered',
        {
          path: changedPath,
          moduleRoot:
            activeRoot ?? changedPath.split('/').slice(0, -1).join('/'),
        },
      );
    }
  }
  return {
    ok: true,
    modules: modulesForPaths(registryResult, normalized)
      .map((module) => module.id)
      .sort(),
    changedPaths: [...normalized].sort(),
  };
}

export function validatePlanArchitecture({
  repoRoot = process.cwd(),
  sources,
  decisions,
  registry = null,
  registryPath = DEFAULT_REGISTRY_PATH,
}) {
  assertUniqueStrings(sources, 'architecture.sources', { min: 1 });
  assertUniqueStrings(decisions, 'architecture.decisions', {
    min: 1,
    pattern: ID_PATTERN,
  });
  const canonicalRoot = fs.realpathSync(repoRoot);
  const registryResult = validateArchitectureRegistry({
    repoRoot: canonicalRoot,
    registry,
    registryPath,
  });
  const normalizedSources = sources.map((value, index) =>
    normalizeRepoPath(value, `architecture.sources[${index}]`));
  const modules = registryResult.modules.filter((module) =>
    normalizedSources.some((source) => pathContains(module.root, source)));
  const accepted = new Set(modules.flatMap((module) => module.decisionIds));
  const unknown = decisions.filter((decision) => !accepted.has(decision));
  if (unknown.length > 0) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      'Plan references decisions outside its registered architecture modules',
      { unknown },
    );
  }
  for (const source of normalizedSources) {
    const activeRoot = nearestActiveArchitectureRoot(canonicalRoot, source);
    if (
      activeRoot !== null
      && !modules.some((module) => module.root === activeRoot)
    ) {
      fail(
        'ARCHITECTURE_MODULE_UNREGISTERED',
        'Plan references an unregistered active architecture module',
        { source, moduleRoot: activeRoot },
      );
    }
  }
  return {
    ok: true,
    modules: modules.map((module) => module.id).sort(),
    sources: [...normalizedSources].sort(),
    decisions: [...decisions].sort(),
  };
}

function parseCli(argv) {
  const [command = 'validate', ...args] = argv;
  if (command !== 'validate') {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `unsupported command: ${command}`,
    );
  }
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--repo-root' && value) {
      options.repoRoot = value;
      index += 1;
    } else if (flag === '--registry' && value) {
      options.registryPath = value;
      index += 1;
    } else {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        `unsupported argument: ${flag}`,
      );
    }
  }
  return options;
}

function main() {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = validateArchitectureRegistry(options);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      modules: result.moduleIds,
      capabilities: result.capabilityIds,
    })}\n`);
  } catch (error) {
    const normalized =
      error instanceof ArchitectureGovernanceError
        ? error
        : new ArchitectureGovernanceError(
          'ARCHITECTURE_REGISTRY_INVALID',
          error.message,
        );
    process.stderr.write(`${JSON.stringify(normalized.toJSON())}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
