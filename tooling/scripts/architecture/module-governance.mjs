#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

export const REGISTRY_KIND = 'peers-touch-architecture-module-registry';
export const REGISTRY_SCHEMA_VERSION = 5;
export const PRE_EDIT_CONTEXT_KIND = 'peers-touch-pre-edit-context';
export const PRE_EDIT_CONTEXT_SCHEMA_VERSION = 1;
export const DEFAULT_REGISTRY_PATH =
  'docs/architecture/engineering/architecture-governance/architecture-modules.json';

const REGISTRY_KEYS = new Set([
  'kind',
  'schemaVersion',
  'taxonomyIndexes',
  'documentCollections',
  'modules',
  'reuseDivergences',
]);
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
const CAPABILITY_OPTIONAL_KEYS = new Set(['reuseLayer']);
const EXTERNAL_REGISTRY_KEYS = new Set([
  'path',
  'capabilityIds',
  'gate',
]);
const REUSE_DIVERGENCE_KEYS = new Set([
  'capabilityId',
  'axis',
  'canonicalRoot',
  'implementations',
  'rationale',
  'decisionId',
  'reviewTrigger',
]);
const REUSE_DIVERGENCE_IMPLEMENTATION_KEYS = new Set([
  'capabilityId',
  'root',
  'consumers',
  'evidenceGates',
]);
const REUSE_DIVERGENCE_AXES = new Set([
  'presentation-policy',
  'os-capability',
  'runtime-constraint',
  'security-boundary',
]);
const REUSE_LAYERS = new Set([
  'model-contract',
  'portable-rust-core',
  'shared-ts-core',
  'shared-ui-primitive',
  'presentation-policy',
  'platform-adapter',
]);
const BASE_DOCUMENTS = ['README.md', 'design.md', 'decisions.md'];
const CLIENT_TS_MANIFESTS = [
  'apps/desktop/package.json',
  'apps/mobile/package.json',
];
const CLIENT_RUST_MANIFESTS = [
  'apps/desktop/src-tauri/Cargo.toml',
  'apps/mobile/src-tauri/Cargo.toml',
];
const ACCEPTANCE_GATES_PATH = 'tooling/acceptance/gates.yaml';
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MODULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DEPENDENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

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

function commandFailureReason(result) {
  if (result.error instanceof Error) return result.error.message;
  const stderr = String(result.stderr ?? '').trim();
  return stderr || `process exited with status ${String(result.status)}`;
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

function assertClosedObjectWithOptional(
  value,
  requiredKeys,
  optionalKeys,
  context,
) {
  if (!isPlainObject(value)) {
    fail('ARCHITECTURE_REGISTRY_INVALID', `${context} must be an object`);
  }
  const actual = new Set(Object.keys(value));
  const missing = [...requiredKeys].filter((key) => !actual.has(key));
  const unknown = [...actual].filter(
    (key) => !requiredKeys.has(key) && !optionalKeys.has(key),
  );
  if (missing.length > 0 || unknown.length > 0) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} has unknown or missing fields`,
      { missing: missing.sort(), unknown: unknown.sort() },
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
  const normalized = normalizeRepoPath(relative, context);
  let current = repoRoot;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    let component;
    try {
      component = fs.lstatSync(current);
    } catch {
      fail(code, `${context} does not exist`, { path: relative });
    }
    if (component.isSymbolicLink()) {
      fail(code, `${context} must not contain symlink components`, {
        path: relative,
        component: path.relative(repoRoot, current).split(path.sep).join('/'),
      });
    }
  }
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
  if (fs.statSync(absolute).size > 1024 * 1024) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${relative} exceeds the 1 MiB registry input budget`,
    );
  }
  const source = fs.readFileSync(absolute, 'utf8');
  const document = parseDocument(source, { uniqueKeys: true, merge: true });
  if (document.errors.length) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${relative} could not be parsed as a capability registry`,
      { reason: document.errors[0].message },
    );
  }
  let value;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    fail('ARCHITECTURE_REGISTRY_INVALID', `${relative} YAML expansion failed`, {
      reason: error.message,
    });
  }
  if (!isPlainObject(value) || !Array.isArray(value.capabilities)) {
    fail('ARCHITECTURE_REGISTRY_INVALID', `${relative} capabilities must be an array`);
  }
  const ids = value.capabilities.map((item) => item?.id);
  assertUniqueStrings(ids, `${relative}.capabilityIds`, {
    min: 1,
    pattern: ID_PATTERN,
  });
  return new Set(ids);
}

function pathContains(prefix, candidate) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`);
}

function pathHasArchitectureOwner(modules, candidate) {
  return modules.some((module) =>
    module.governedPaths.some((prefix) => pathContains(prefix, candidate)));
}

function loadAcceptanceGateIds(repoRoot) {
  const absolute = requireCurrentPath(
    repoRoot,
    ACCEPTANCE_GATES_PATH,
    'Acceptance gate registry',
    'ARCHITECTURE_REUSE_INVALID',
  );
  if (fs.statSync(absolute).size > 1024 * 1024) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'Acceptance gate registry exceeds the 1 MiB input budget',
    );
  }
  const source = fs.readFileSync(absolute, 'utf8');
  const document = parseDocument(source, { uniqueKeys: true, merge: true });
  if (document.errors.length) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'Acceptance gate registry could not be resolved',
      { reason: document.errors[0].message },
    );
  }
  let value;
  try {
    value = document.toJS({ maxAliasCount: 100 });
  } catch (error) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'Acceptance gate registry YAML expansion failed',
      { reason: error.message },
    );
  }
  if (!isPlainObject(value) || !isPlainObject(value.gates)) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'Acceptance gate registry gates must be an object',
    );
  }
  const ids = Object.keys(value.gates).sort();
  assertUniqueStrings(ids, 'Acceptance gate IDs', {
    min: 1,
    pattern: ID_PATTERN,
  });
  return new Set(ids);
}

function workspacePackageManifests(repoRoot) {
  requireCurrentPath(
    repoRoot,
    'pnpm-workspace.yaml',
    'pnpm workspace manifest',
    'ARCHITECTURE_REUSE_INVALID',
  );
  const result = spawnSync(
    'pnpm',
    ['list', '--recursive', '--depth', '-1', '--json'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'pnpm workspace packages could not be resolved',
      { reason: commandFailureReason(result) },
    );
  }
  const workspacePackages = parseJson(
    result.stdout,
    'ARCHITECTURE_REUSE_INVALID',
    'pnpm workspace package list',
  );
  if (!Array.isArray(workspacePackages)) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'pnpm workspace package list must be an array',
    );
  }
  const manifests = new Map();
  for (const [index, workspacePackage] of workspacePackages.entries()) {
    if (
      !isPlainObject(workspacePackage)
      || typeof workspacePackage.name !== 'string'
      || workspacePackage.name.trim() === ''
      || typeof workspacePackage.path !== 'string'
      || workspacePackage.path.trim() === ''
    ) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        `pnpm workspace package list item ${index} is invalid`,
      );
    }
    const packageRoot = fs.realpathSync(workspacePackage.path);
    const relative = repoRelativePath(
      repoRoot,
      path.join(packageRoot, 'package.json'),
      `pnpm workspace package ${workspacePackage.name}`,
    );
    requireCurrentPath(
      repoRoot,
      relative,
      `pnpm workspace package ${workspacePackage.name}`,
      'ARCHITECTURE_REUSE_INVALID',
    );
    const value = parseJson(
      readUtf8(
        repoRoot,
        relative,
        'ARCHITECTURE_REUSE_INVALID',
        'workspace package manifest',
      ),
      'ARCHITECTURE_REUSE_INVALID',
      relative,
    );
    if (value.name !== workspacePackage.name) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        'pnpm workspace package identity is inconsistent',
        {
          expected: workspacePackage.name,
          actual: value.name,
          manifest: relative,
        },
      );
    }
    if (manifests.has(value.name)) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        'workspace package names must be unique',
        { name: value.name, manifests: [manifests.get(value.name), relative] },
      );
    }
    manifests.set(value.name, relative);
  }
  return manifests;
}

function workspaceProtocolPackage(name, specifier, workspacePackages) {
  if (typeof specifier !== 'string' || !specifier.startsWith('workspace:')) {
    return null;
  }
  if (workspacePackages.has(name)) return name;
  const alias = specifier.slice('workspace:'.length);
  const match = /^(@[^/]+\/[^@]+|[^@]+)@/.exec(alias);
  return match !== null && workspacePackages.has(match[1]) ? match[1] : null;
}

function directWorkspaceDependencies(repoRoot, relative, workspacePackages) {
  const value = parseJson(
    readUtf8(
      repoRoot,
      relative,
      'ARCHITECTURE_REUSE_INVALID',
      'client package manifest',
    ),
    'ARCHITECTURE_REUSE_INVALID',
    relative,
  );
  const declared = {
    ...(isPlainObject(value.dependencies) ? value.dependencies : {}),
    ...(isPlainObject(value.optionalDependencies)
      ? value.optionalDependencies
      : {}),
  };
  return new Map(
    Object.entries(declared)
      .map(([name, specifier]) => {
        const packageName = workspaceProtocolPackage(
          name,
          specifier,
          workspacePackages,
        );
        return packageName === null
          ? null
          : [packageName, workspacePackages.get(packageName)];
      })
      .filter((entry) => entry !== null),
  );
}

function repoRelativePath(repoRoot, absolute, context) {
  const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith('../')
    || path.isAbsolute(relative)
  ) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      `${context} must resolve inside the repository`,
      { path: absolute },
    );
  }
  return normalizeRepoPath(relative, context);
}

function directCargoPathDependencies(repoRoot, relative) {
  const manifest = requireCurrentPath(
    repoRoot,
    relative,
    'client Cargo manifest',
    'ARCHITECTURE_REUSE_INVALID',
  );
  const result = spawnSync(
    'cargo',
    [
      'metadata',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      manifest,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      `${relative} could not be resolved by cargo metadata`,
      { reason: commandFailureReason(result) },
    );
  }
  const metadata = parseJson(
    result.stdout,
    'ARCHITECTURE_REUSE_INVALID',
    `${relative} cargo metadata`,
  );
  if (!Array.isArray(metadata.packages)) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      `${relative} cargo metadata packages must be an array`,
    );
  }
  const canonicalManifest = fs.realpathSync(manifest);
  const owner = metadata.packages.find(
    (candidate) =>
      typeof candidate?.manifest_path === 'string'
      && fs.realpathSync(candidate.manifest_path) === canonicalManifest,
  );
  if (owner === undefined || !Array.isArray(owner.dependencies)) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      `${relative} package is missing from cargo metadata`,
    );
  }
  return new Map(
    owner.dependencies
      .filter(
        (dependency) =>
          dependency?.kind === null
          && typeof dependency.name === 'string'
          && typeof dependency.path === 'string',
      )
      .map((dependency) => {
        const dependencyManifest = repoRelativePath(
          repoRoot,
          path.join(dependency.path, 'Cargo.toml'),
          `${relative} path dependency ${dependency.name}`,
        );
        requireCurrentPath(
          repoRoot,
          dependencyManifest,
          `${relative} path dependency ${dependency.name}`,
          'ARCHITECTURE_REUSE_INVALID',
        );
        return [dependency.name, dependencyManifest];
      }),
  );
}

function sharedDependencyEntries(
  ecosystem,
  manifests,
  dependencyMaps,
) {
  const [first, ...rest] = dependencyMaps;
  return [...first.entries()]
    .filter(([name, target]) =>
      rest.every((dependencies) => dependencies.get(name) === target))
    .map(([name, manifest]) => ({
      ecosystem,
      package: name,
      manifest,
      consumers: [...manifests],
    }));
}

export function collectSharedClientDependencies({
  repoRoot = process.cwd(),
} = {}) {
  const canonicalRoot = fs.realpathSync(repoRoot);
  const workspacePackages = workspacePackageManifests(canonicalRoot);
  return [
    ...sharedDependencyEntries(
      'pnpm',
      CLIENT_TS_MANIFESTS,
      CLIENT_TS_MANIFESTS.map((relative) =>
        directWorkspaceDependencies(
          canonicalRoot,
          relative,
          workspacePackages,
        )),
    ),
    ...sharedDependencyEntries(
      'cargo',
      CLIENT_RUST_MANIFESTS,
      CLIENT_RUST_MANIFESTS.map((relative) =>
        directCargoPathDependencies(canonicalRoot, relative)),
    ),
  ].sort((left, right) =>
    compareStrings(
      `${left.ecosystem}:${left.package}`,
      `${right.ecosystem}:${right.package}`,
    ));
}

function validateCrossClientReuseCoverage(repoRoot, modules) {
  const reuseModule = modules.find(
    (module) => module.id === 'cross-client-runtime',
  );
  if (reuseModule === undefined) {
    return [];
  }
  const capabilities = modules.flatMap((module) => module.capabilities);
  const inventory = collectSharedClientDependencies({ repoRoot });
  const classifiedInventory = inventory.map((dependency) => {
    const matchingCapabilities = capabilities.filter((capability) =>
      capability.contractRoots.some((contractRoot) =>
        pathContains(contractRoot, dependency.manifest))
      && dependency.consumers.every((consumer) =>
        capability.consumers.includes(consumer)));
    if (matchingCapabilities.length !== 1) {
      return {
        ...dependency,
        matchingCapabilities,
      };
    }
    const [capability] = matchingCapabilities;
    const expectedLayers = dependency.ecosystem === 'cargo'
      ? ['portable-rust-core', 'platform-adapter']
      : dependency.manifest.startsWith('packages/ui/')
        ? ['shared-ui-primitive']
        : ['shared-ts-core'];
    return {
      ...dependency,
      capabilityId: capability.id,
      owner: capability.owner,
      canonicalRoots: [...capability.contractRoots],
      allowedDependencies: [...capability.allowedDependencies],
      evidenceGates: [...capability.evidenceGates],
      reuseLayer: capability.reuseLayer,
      expectedLayers,
      matchingCapabilities,
    };
  });
  const missing = classifiedInventory.filter(
    (dependency) => dependency.matchingCapabilities.length !== 1,
  );
  if (missing.length > 0) {
    fail(
      'ARCHITECTURE_REUSE_UNREGISTERED',
      'Desktop/Mobile shared dependencies require architecture capabilities',
      { missing },
    );
  }
  const misclassified = classifiedInventory.filter(
    (dependency) => (
      !dependency.expectedLayers.includes(dependency.reuseLayer)
    ),
  );
  if (misclassified.length > 0) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'Desktop/Mobile shared dependencies require the correct reuse layer',
      {
        misclassified: misclassified.map((dependency) => ({
          package: dependency.package,
          capabilityId: dependency.capabilityId,
          expectedLayers: dependency.expectedLayers,
          actualLayer: dependency.reuseLayer,
        })),
      },
    );
  }
  const reusePolicy = reuseModule.capabilities.find(
    (capability) => capability.id === 'client.reuse.admission',
  );
  if (reusePolicy === undefined) {
    fail(
      'ARCHITECTURE_REUSE_UNREGISTERED',
      'cross-client reuse admission capability is missing',
    );
  }
  const requiredConsumers = [
    ...CLIENT_TS_MANIFESTS,
    ...CLIENT_RUST_MANIFESTS,
  ];
  const missingPolicyConsumers = requiredConsumers.filter(
    (consumer) => !reusePolicy.consumers.includes(consumer),
  );
  if (missingPolicyConsumers.length > 0) {
    fail(
      'ARCHITECTURE_REUSE_UNREGISTERED',
      'cross-client reuse admission omits canonical client manifests',
      { missingConsumers: missingPolicyConsumers },
    );
  }
  return classifiedInventory.map(({
    expectedLayers: _expectedLayers,
    matchingCapabilities: _matchingCapabilities,
    ...dependency
  }) => dependency);
}

function validateReuseDivergences(
  repoRoot,
  divergences,
  modules,
  capabilityIds,
) {
  if (!Array.isArray(divergences)) {
    fail(
      'ARCHITECTURE_REUSE_INVALID',
      'registry.reuseDivergences must be an array',
    );
  }
  const capabilities = new Map(
    modules.flatMap((module) =>
      module.capabilities.map((capability) => [capability.id, capability])),
  );
  const acceptedDecisions = new Set(
    modules.flatMap((module) => module.decisionIds),
  );
  const acceptanceGateIds = loadAcceptanceGateIds(repoRoot);
  const decisionIds = new Set();
  return divergences.map((divergence, index) => {
    const context = `registry.reuseDivergences[${index}]`;
    assertClosedObject(divergence, REUSE_DIVERGENCE_KEYS, context);
    assertString(
      divergence.capabilityId,
      `${context}.capabilityId`,
      ID_PATTERN,
    );
    if (!capabilityIds.has(divergence.capabilityId)) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        `${context}.capabilityId is not registered`,
        { capabilityId: divergence.capabilityId },
      );
    }
    if (!REUSE_DIVERGENCE_AXES.has(divergence.axis)) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        `${context}.axis is not an accepted divergence axis`,
        { axis: divergence.axis },
      );
    }
    const canonicalRoot = normalizeRepoPath(
      divergence.canonicalRoot,
      `${context}.canonicalRoot`,
    );
    requireCurrentPath(repoRoot, canonicalRoot, `${context}.canonicalRoot`);
    const capability = capabilities.get(divergence.capabilityId);
    if (
      !capability.contractRoots.some((contractRoot) =>
        pathContains(contractRoot, canonicalRoot))
    ) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        `${context}.canonicalRoot is outside the capability contract roots`,
        { canonicalRoot, capabilityId: divergence.capabilityId },
      );
    }
    if (
      !Array.isArray(divergence.implementations)
      || divergence.implementations.length === 0
    ) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        `${context}.implementations must contain at least one item`,
      );
    }
    const implementationRoots = new Set();
    divergence.implementations.forEach((implementation, position) => {
      const implementationContext =
        `${context}.implementations[${position}]`;
      assertClosedObject(
        implementation,
        REUSE_DIVERGENCE_IMPLEMENTATION_KEYS,
        implementationContext,
      );
      assertString(
        implementation.capabilityId,
        `${implementationContext}.capabilityId`,
        ID_PATTERN,
      );
      const implementationCapability = capabilities.get(
        implementation.capabilityId,
      );
      if (
        implementationCapability === undefined
        || implementation.capabilityId === divergence.capabilityId
      ) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${implementationContext}.capabilityId must identify a distinct registered capability`,
          { capabilityId: implementation.capabilityId },
        );
      }
      if (
        !implementationCapability.allowedDependencies.includes(
          divergence.capabilityId,
        )
      ) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${implementationContext}.capabilityId does not depend on the canonical capability`,
          {
            capabilityId: implementation.capabilityId,
            canonicalCapabilityId: divergence.capabilityId,
          },
        );
      }
      const normalizedRoot = normalizeRepoPath(
        implementation.root,
        `${implementationContext}.root`,
      );
      if (implementationRoots.has(normalizedRoot)) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${context}.implementations contains a duplicate root`,
          { root: normalizedRoot },
        );
      }
      implementationRoots.add(normalizedRoot);
      requireCurrentPath(
        repoRoot,
        normalizedRoot,
        `${implementationContext}.root`,
      );
      if (
        pathContains(canonicalRoot, normalizedRoot)
        || pathContains(normalizedRoot, canonicalRoot)
      ) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${implementationContext}.root must be separate from the canonical root`,
          { root: normalizedRoot, canonicalRoot },
        );
      }
      if (!pathHasArchitectureOwner(modules, normalizedRoot)) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${implementationContext}.root has no registered architecture owner`,
          { root: normalizedRoot },
        );
      }
      if (
        !implementationCapability.contractRoots.some((contractRoot) =>
          pathContains(contractRoot, normalizedRoot))
      ) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${implementationContext}.root is outside the implementation capability contract roots`,
          {
            root: normalizedRoot,
            capabilityId: implementation.capabilityId,
          },
        );
      }
      assertUniqueStrings(
        implementation.consumers,
        `${implementationContext}.consumers`,
        { min: 1 },
      );
      implementation.consumers.forEach((value, consumerIndex) => {
        const normalized = normalizeRepoPath(
          value,
          `${implementationContext}.consumers[${consumerIndex}]`,
        );
        requireCurrentPath(
          repoRoot,
          normalized,
          `${implementationContext}.consumers[${consumerIndex}]`,
        );
        if (!pathHasArchitectureOwner(modules, normalized)) {
          fail(
            'ARCHITECTURE_REUSE_INVALID',
            `${implementationContext}.consumers[${consumerIndex}] has no registered architecture owner`,
            { consumer: normalized },
          );
        }
        if (!implementationCapability.consumers.includes(normalized)) {
          fail(
            'ARCHITECTURE_REUSE_INVALID',
            `${implementationContext}.consumers[${consumerIndex}] is not registered on the implementation capability`,
            {
              consumer: normalized,
              capabilityId: implementation.capabilityId,
            },
          );
        }
      });
      assertUniqueStrings(
        implementation.evidenceGates,
        `${implementationContext}.evidenceGates`,
        { min: 1, pattern: ID_PATTERN },
      );
      const unknownGates = implementation.evidenceGates.filter(
        (gateId) =>
          !acceptanceGateIds.has(gateId)
          || !implementationCapability.evidenceGates.includes(gateId),
      );
      if (unknownGates.length > 0) {
        fail(
          'ARCHITECTURE_REUSE_INVALID',
          `${implementationContext}.evidenceGates contains unknown or unauthorized Gates`,
          { unknownGates },
        );
      }
    });
    assertString(divergence.rationale, `${context}.rationale`);
    assertString(divergence.decisionId, `${context}.decisionId`, ID_PATTERN);
    if (!acceptedDecisions.has(divergence.decisionId)) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        `${context}.decisionId is not an accepted registered decision`,
        { decisionId: divergence.decisionId },
      );
    }
    if (decisionIds.has(divergence.decisionId)) {
      fail(
        'ARCHITECTURE_REUSE_INVALID',
        'reuse divergence decision IDs must be unique',
        { decisionId: divergence.decisionId },
      );
    }
    decisionIds.add(divergence.decisionId);
    assertString(divergence.reviewTrigger, `${context}.reviewTrigger`);
    return divergence;
  });
}

function validateCapability(repoRoot, module, capability, context) {
  assertClosedObjectWithOptional(
    capability,
    CAPABILITY_KEYS,
    CAPABILITY_OPTIONAL_KEYS,
    context,
  );
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
  if (
    capability.reuseLayer !== undefined
    && !REUSE_LAYERS.has(capability.reuseLayer)
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context}.reuseLayer is invalid`,
      { reuseLayer: capability.reuseLayer },
    );
  }
  capability.contractRoots.forEach((value, index) => {
    requireCurrentPath(repoRoot, value, `${context}.contractRoots[${index}]`);
    if (!module.governedPaths.some((prefix) => pathContains(prefix, value))) {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        `${context}.contractRoots[${index}] is outside module governed paths`,
        { path: value },
      );
    }
  });
  capability.consumers.forEach((value, index) =>
    requireCurrentPath(repoRoot, value, `${context}.consumers[${index}]`));
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

function validateModule(
  repoRoot,
  module,
  indexSource,
  taxonomyRoots,
  position,
) {
  const context = `modules[${position}]`;
  assertClosedObject(module, MODULE_KEYS, context);
  assertString(module.id, `${context}.id`, MODULE_ID_PATTERN);
  normalizeRepoPath(module.root, `${context}.root`);
  if (
    !module.root.startsWith('docs/architecture/')
    || !taxonomyRoots.some((taxonomyRoot) =>
      taxonomyRoot !== module.root && pathContains(taxonomyRoot, module.root))
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context}.root must be nested under a declared taxonomy index`,
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
    || !Array.isArray(value.taxonomyIndexes)
    || !Array.isArray(value.documentCollections)
    || !Array.isArray(value.modules)
    || !Array.isArray(value.reuseDivergences)
    || value.modules.length === 0
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      'registry identity or modules are invalid',
    );
  }
  assertUniqueStrings(value.taxonomyIndexes, 'registry.taxonomyIndexes', {
    min: 1,
  });
  const taxonomyRoots = value.taxonomyIndexes.map((relative, index) => {
    const context = `registry.taxonomyIndexes[${index}]`;
    const normalized = normalizeRepoPath(relative, context);
    if (
      !normalized.startsWith('docs/architecture/')
      || path.posix.basename(normalized) !== 'README.md'
    ) {
      fail(
        'ARCHITECTURE_REGISTRY_INVALID',
        `${context} must be an architecture taxonomy README`,
      );
    }
    const source = readUtf8(
      canonicalRoot,
      normalized,
      'ARCHITECTURE_INDEX_MISSING',
      context,
    );
    if (metadataValue(source, 'Status') !== 'active') {
      fail(
        'ARCHITECTURE_STATUS_MISMATCH',
        `${context} must have active status`,
      );
    }
    return path.posix.dirname(normalized);
  });
  assertUniqueStrings(
    value.documentCollections,
    'registry.documentCollections',
  );
  const documentCollections = value.documentCollections.map(
    (relative, index) => {
      const context = `registry.documentCollections[${index}]`;
      const normalized = normalizeRepoPath(relative, context);
      if (
        !normalized.startsWith('docs/architecture/')
        || !taxonomyRoots.some((taxonomyRoot) =>
          taxonomyRoot !== normalized
          && pathContains(taxonomyRoot, normalized))
      ) {
        fail(
          'ARCHITECTURE_REGISTRY_INVALID',
          `${context} must be nested under a declared taxonomy index`,
        );
      }
      requireCurrentPath(canonicalRoot, normalized, context);
      requireCurrentPath(
        canonicalRoot,
        `${normalized}/README.md`,
        `${context} README`,
      );
      return normalized;
    },
  );
  const indexSource = readUtf8(
    canonicalRoot,
    'docs/README.md',
    'ARCHITECTURE_INDEX_MISSING',
    'docs index',
  );
  const modules = value.modules.map((module, index) =>
    validateModule(
      canonicalRoot,
      module,
      indexSource,
      taxonomyRoots,
      index,
    ));
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
  const sharedClientDependencies = validateCrossClientReuseCoverage(
    canonicalRoot,
    modules,
  );
  const reuseDivergences = validateReuseDivergences(
    canonicalRoot,
    value.reuseDivergences,
    modules,
    capabilityIds,
  );
  return {
    ok: true,
    registry: value,
    taxonomyIndexes: [...value.taxonomyIndexes].sort(),
    taxonomyRoots: [...taxonomyRoots].sort(),
    documentCollections: [...documentCollections].sort(),
    modules,
    moduleIds: [...moduleIds].sort(),
    capabilityIds: [...capabilityIds].sort(),
    sharedClientDependencies,
    reuseDivergences,
  };
}

export function modulesForPaths(registryResult, paths) {
  const normalized = paths.map((value, index) =>
    normalizeRepoPath(value, `paths[${index}]`));
  return registryResult.modules.filter((module) =>
    normalized.some((candidate) =>
      module.governedPaths.some((prefix) => pathContains(prefix, candidate))));
}

function normalizeTargetPath(repoRoot, value, context) {
  assertString(value, context);
  let absolute = path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(repoRoot, value);
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  if (fs.existsSync(existing)) {
    absolute = path.join(
      fs.realpathSync(existing),
      path.relative(existing, absolute),
    );
  }
  const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
  if (
    relative === ''
    || relative === '..'
    || relative.startsWith('../')
    || path.isAbsolute(relative)
  ) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `${context} must resolve inside the repository`,
      { value },
    );
  }
  return normalizeRepoPath(relative, context);
}

function listKnowledgeFiles(repoRoot) {
  const roots = [
    'docs/knowledge/invariants',
    'docs/knowledge/pitfalls',
    'docs/knowledge/playbooks',
  ];
  const files = [];
  function walk(relative) {
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) return;
    let entries;
    try {
      entries = fs.readdirSync(absolute, { withFileTypes: true });
    } catch (error) {
      fail(
        'KNOWLEDGE_CONTEXT_UNREADABLE',
        'knowledge directory is unreadable',
        { path: relative, reason: error.message },
      );
    }
    for (const entry of entries.sort((left, right) =>
      compareStrings(left.name, right.name))) {
      const candidate = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        fail(
          'KNOWLEDGE_CONTEXT_UNREADABLE',
          'knowledge paths must not be symlinks',
          { path: candidate },
        );
      }
      if (entry.isDirectory()) {
        walk(candidate);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(candidate);
      }
    }
  }
  roots.forEach(walk);
  return files.sort();
}

function knowledgeOwns(source, relative) {
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') return [];
  let inOwns = false;
  const owns = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === '---') break;
    if (/^owns:\s*$/.test(line)) {
      inOwns = true;
      continue;
    }
    if (/^[A-Za-z_-]+:/.test(line)) {
      inOwns = false;
      continue;
    }
    if (!inOwns) continue;
    const match = /^\s*-\s+(.+?)\s*$/.exec(line);
    if (match === null) continue;
    owns.push(
      normalizeRepoPath(
        match[1].replace(/\/+$/, ''),
        `${relative}.owns[${owns.length}]`,
      ),
    );
  }
  return owns;
}

function escapeGlob(value) {
  return escapePattern(value)
    .replaceAll('\\*\\*', '.*')
    .replaceAll('\\*', '[^/]*');
}

function ownershipMatches(ownedPath, target) {
  if (ownedPath.includes('*')) {
    return new RegExp(`^${escapeGlob(ownedPath)}(?:/.*)?$`).test(target);
  }
  return pathContains(ownedPath, target);
}

function matchingKnowledge(repoRoot, targets) {
  return listKnowledgeFiles(repoRoot)
    .map((relative) => {
      const source = readUtf8(
        repoRoot,
        relative,
        'KNOWLEDGE_CONTEXT_UNREADABLE',
        'knowledge entry',
      );
      return {
        path: relative,
        source,
        owns: knowledgeOwns(source, relative),
      };
    })
    .filter((entry) =>
      entry.owns.some((ownedPath) =>
        targets.some((target) => ownershipMatches(ownedPath, target))))
    .map((entry) => ({
      path: entry.path,
      digest: sha256(entry.source),
    }))
    .sort((left, right) => compareStrings(left.path, right.path));
}

function architectureContext(repoRoot, module) {
  const documents = module.requiredDocuments
    .map((document) => `${module.root}/${document}`)
    .sort();
  const documentDigests = documents.map((relative) => ({
    path: relative,
    digest: sha256(
      readUtf8(
        repoRoot,
        relative,
        'ARCHITECTURE_DOCUMENT_REQUIRED',
        `${module.id} context document`,
      ),
    ),
  }));
  const capabilityIds = [
    ...module.capabilities.map((capability) => capability.id),
    ...module.externalCapabilityRegistries.flatMap(
      (external) => external.capabilityIds,
    ),
  ].sort();
  return {
    moduleId: module.id,
    documents,
    capabilityIds,
    digest: canonicalDigest({
      module,
      documents: documentDigests,
    }),
  };
}

export function buildPreEditContext({
  repoRoot = process.cwd(),
  targets,
  registry = null,
  registryPath = DEFAULT_REGISTRY_PATH,
} = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      'pre-edit context requires at least one target',
    );
  }
  const canonicalRoot = fs.realpathSync(repoRoot);
  const normalizedTargets = [
    ...new Set(
      targets.map((value, index) =>
        normalizeTargetPath(canonicalRoot, value, `targets[${index}]`)),
    ),
  ].sort();
  const registryResult = validateArchitectureRegistry({
    repoRoot: canonicalRoot,
    registry,
    registryPath,
  });
  const receipt = {
    kind: PRE_EDIT_CONTEXT_KIND,
    schemaVersion: PRE_EDIT_CONTEXT_SCHEMA_VERSION,
    targets: normalizedTargets,
    knowledge: matchingKnowledge(canonicalRoot, normalizedTargets),
    architecture: modulesForPaths(registryResult, normalizedTargets)
      .map((module) => architectureContext(canonicalRoot, module))
      .sort((left, right) => compareStrings(left.moduleId, right.moduleId)),
    registryDigest: canonicalDigest(registryResult.registry),
  };
  return {
    ...receipt,
    receiptDigest: canonicalDigest(receipt),
  };
}

export function renderPreEditContext(receipt) {
  return [
    'PT_PRE_EDIT_CONTEXT',
    JSON.stringify(canonicalize(receipt)),
    'This receipt is read-only context and does not grant write authorization.',
  ].join('\n');
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
  const taxonomyRoots = new Set(registryResult.taxonomyRoots);
  const documentCollections = registryResult.documentCollections;
  for (const changedPath of normalized) {
    if (!fs.existsSync(path.join(canonicalRoot, changedPath))) {
      continue;
    }
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
    const exactTaxonomyIndex =
      activeRoot !== null
      && taxonomyRoots.has(activeRoot)
      && changedPath === `${activeRoot}/README.md`;
    const knownDocumentCollection = documentCollections.some((collection) =>
      pathContains(collection, changedPath));
    const activeUnregisteredModule =
      activeRoot !== null
      && !registeredRoots.has(activeRoot)
      && !taxonomyRoots.has(activeRoot);
    const unregisteredNestedModule =
      activeRoot !== null
      && taxonomyRoots.has(activeRoot)
      && !exactTaxonomyIndex
      && unregisteredModulePath;
    if (
      (
        (
          activeUnregisteredModule
          || unregisteredNestedModule
          || (activeRoot === null && unregisteredModulePath)
        )
        && !knownDocumentCollection
      )
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
  const taxonomySources = normalizedSources.filter((source) =>
    registryResult.taxonomyIndexes.includes(source));
  if (taxonomySources.length > 0) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      'taxonomy indexes cannot be Plan architecture sources',
      { taxonomySources },
    );
  }
  normalizedSources.forEach((source, index) =>
    requireCurrentPath(
      canonicalRoot,
      source,
      `architecture.sources[${index}]`,
    ));
  const modules = registryResult.modules.filter((module) =>
    normalizedSources.some((source) => pathContains(module.root, source)));
  if (modules.length === 0) {
    return {
      ok: true,
      modules: [],
      sources: [...normalizedSources].sort(),
      decisions: [...decisions].sort(),
    };
  }
  const selectedRoots = new Set(modules.map((module) => module.root));
  const unregisteredActiveRoots = [
    ...new Set(
      normalizedSources
        .map((source) => nearestActiveArchitectureRoot(canonicalRoot, source))
        .filter((root) => root !== null && !selectedRoots.has(root)),
    ),
  ];
  const accepted = new Set(modules.flatMap((module) => module.decisionIds));
  const namespaces = new Set(
    modules.flatMap((module) =>
      module.decisionIds.map((decision) => {
        const marker = decision.indexOf('-');
        return marker === -1 ? decision : decision.slice(0, marker + 1);
      })),
  );
  const unknown = decisions.filter(
    (decision) =>
      !accepted.has(decision)
      && (
        unregisteredActiveRoots.length === 0
        || [...namespaces].some((namespace) =>
          decision.startsWith(namespace))
      ),
  );
  if (unknown.length > 0) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      'Plan references decisions outside its registered architecture modules',
      { unknown },
    );
  }
  const missingModules = modules
    .filter((module) =>
      !module.decisionIds.some((decision) => decisions.includes(decision)))
    .map((module) => module.id);
  if (missingModules.length > 0) {
    fail(
      'ARCHITECTURE_DECISION_INVALID',
      'Plan omits accepted decisions for a registered architecture module',
      { missingModules },
    );
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
  if (!['validate', 'changed-paths', 'plan', 'context'].includes(command)) {
    fail(
      'ARCHITECTURE_REGISTRY_INVALID',
      `unsupported command: ${command}`,
    );
  }
  const options = {
    command,
    changedPaths: [],
    sources: [],
    decisions: [],
  };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--repo-root' && value) {
      options.repoRoot = value;
      index += 1;
    } else if (flag === '--registry' && value) {
      options.registryPath = value;
      index += 1;
    } else if (flag === '--changed-file' && value) {
      options.changedPaths.push(value);
      index += 1;
    } else if (flag === '--source' && value) {
      options.sources.push(value);
      index += 1;
    } else if (flag === '--decision' && value) {
      options.decisions.push(value);
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
    let output;
    if (options.command === 'validate') {
      const result = validateArchitectureRegistry(options);
      output = {
        ok: true,
        modules: result.moduleIds,
        capabilities: result.capabilityIds,
        sharedClientDependencies: result.sharedClientDependencies,
        reuseDivergences: result.reuseDivergences,
      };
    } else if (options.command === 'changed-paths') {
      output = validateChangedArchitecturePaths({
        ...options,
        changedPaths: options.changedPaths,
      });
    } else if (options.command === 'plan') {
      output = validatePlanArchitecture(options);
    } else {
      output = {
        ok: true,
        receipt: buildPreEditContext({
          ...options,
          targets: options.changedPaths,
        }),
      };
    }
    process.stdout.write(`${JSON.stringify(output)}\n`);
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
