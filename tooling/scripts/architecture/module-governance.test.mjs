import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ArchitectureGovernanceError,
  deriveRequiredDocuments,
  validateArchitectureRegistry,
  validateChangedArchitecturePaths,
  validatePlanArchitecture,
} from './module-governance.mjs';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
const CHARACTERISTICS = Object.freeze({
  protocol: true,
  stateMachine: true,
  persistence: false,
  ownership: true,
  moduleLayout: true,
  crossRuntime: true,
  integration: true,
});

function document(owner, body = '') {
  return [
    '# Example',
    '',
    '> **Status**: active',
    '> **Version**: v1.0',
    '> **Created**: 2026-09-27 | **Updated**: 2026-09-27',
    `> **Owner**: ${owner}`,
    '',
    '---',
    '',
    body,
    '',
  ].join('\n');
}

function decisions(owner, id = 'EX-D01') {
  return document(owner, [
    '## Decision Index',
    '',
    '| ID | Decision | Status |',
    '|---|---|---|',
    `| ${id} | Keep one contract | accepted |`,
    '',
    `## ${id}: Keep one contract`,
    '',
    '**Status**: accepted',
    '**Date**: 2026-09-27',
    '',
    '### Context',
    '',
    'One contract is required.',
    '',
    '### Decision',
    '',
    'Use one contract.',
    '',
    '### Rationale',
    '',
    'It is deterministic.',
    '',
    '### Alternatives Considered',
    '',
    '- Multiple contracts: rejected.',
    '',
    '### Consequences',
    '',
    'Validation can fail closed.',
  ].join('\n'));
}

async function createModule(root, id, owner = 'Architecture Team') {
  const moduleRoot = `docs/architecture/${id}`;
  await mkdir(path.join(root, moduleRoot), { recursive: true });
  await mkdir(path.join(root, `tooling/${id}`), { recursive: true });
  for (const name of deriveRequiredDocuments(CHARACTERISTICS)) {
    const content =
      name === 'decisions.md'
        ? decisions(owner)
        : document(owner, `${name} content`);
    await writeFile(path.join(root, moduleRoot, name), content);
  }
  return {
    id,
    root: moduleRoot,
    status: 'active',
    owner,
    characteristics: { ...CHARACTERISTICS },
    requiredDocuments: deriveRequiredDocuments(CHARACTERISTICS),
    decisionIds: ['EX-D01'],
    governedPaths: [moduleRoot, `tooling/${id}`],
    capabilities: [
      {
        id: `architecture.${id}.validate`,
        owner: 'architecture.test',
        contractRoots: [`tooling/${id}`],
        consumers: [`tooling/${id}`],
        allowedDependencies: ['node.fs'],
        evidenceGates: ['architecture-test'],
      },
    ],
    externalCapabilityRegistries: [],
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'module-governance-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'docs'), { recursive: true });
  const module = await createModule(root, 'example');
  await writeFile(
    path.join(root, 'docs', 'README.md'),
    '- Example: `architecture/example/README.md`\n',
  );
  return {
    root,
    module,
    registry: {
      kind: 'peers-touch-architecture-module-registry',
      schemaVersion: 1,
      modules: [module],
    },
  };
}

function rejectsCode(code, operation) {
  assert.throws(
    operation,
    (error) =>
      error instanceof ArchitectureGovernanceError && error.code === code,
  );
}

test('current repository satisfies the module registry', () => {
  const result = validateArchitectureRegistry({ repoRoot: REPO_ROOT });
  assert.deepEqual(result.moduleIds, [
    'architecture-module-governance',
    'station-access-lifecycle',
  ]);
  assert.deepEqual(result.capabilityIds, ['architecture.module.validate']);
});

test('required documents are derived from module characteristics', () => {
  assert.deepEqual(deriveRequiredDocuments(CHARACTERISTICS), [
    'README.md',
    'design.md',
    'decisions.md',
    'data-model.md',
    'module-layout.md',
    'integration.md',
  ]);
  assert.deepEqual(
    deriveRequiredDocuments({
      protocol: false,
      stateMachine: false,
      persistence: false,
      ownership: false,
      moduleLayout: false,
      crossRuntime: false,
      integration: false,
    }),
    ['README.md', 'design.md', 'decisions.md'],
  );
});

test('registry rejects unknown fields', async (t) => {
  const value = await fixture(t);
  value.registry.modules[0].extra = [];
  rejectsCode('ARCHITECTURE_REGISTRY_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('registry rejects an incomplete derived document set', async (t) => {
  const value = await fixture(t);
  value.registry.modules[0].requiredDocuments =
    value.registry.modules[0].requiredDocuments.slice(0, -1);
  rejectsCode('ARCHITECTURE_DOCUMENT_REQUIRED', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('registry rejects a missing required document', async (t) => {
  const value = await fixture(t);
  await unlink(
    path.join(value.root, value.module.root, 'data-model.md'),
  );
  rejectsCode('ARCHITECTURE_DOCUMENT_REQUIRED', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('capability paths must exist inside module governance', async (t) => {
  const value = await fixture(t);
  value.registry.modules[0].capabilities[0].consumers = ['docs/README.md'];
  rejectsCode('ARCHITECTURE_REGISTRY_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('registry rejects document status drift', async (t) => {
  const value = await fixture(t);
  await writeFile(
    path.join(value.root, value.module.root, 'design.md'),
    document(value.module.owner).replace(
      '**Status**: active',
      '**Status**: draft',
    ),
  );
  rejectsCode('ARCHITECTURE_STATUS_MISMATCH', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('registry rejects an incomplete decision record', async (t) => {
  const value = await fixture(t);
  await writeFile(
    path.join(value.root, value.module.root, 'decisions.md'),
    decisions(value.module.owner).replace('### Consequences', '### Result'),
  );
  rejectsCode('ARCHITECTURE_DECISION_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('registry rejects an accepted decision omitted from its declaration', async (t) => {
  const value = await fixture(t);
  const decisionPath = path.join(
    value.root,
    value.module.root,
    'decisions.md',
  );
  const source = decisions(value.module.owner)
    .replace(
      '| EX-D01 | Keep one contract | accepted |',
      '| EX-D01 | Keep one contract | accepted |\n'
        + '| EX-D02 | Keep one owner | accepted |',
    )
    .concat(
      '\n## EX-D02: Keep one owner\n\n'
        + '**Status**: accepted\n'
        + '**Date**: 2026-09-27\n\n'
        + '### Context\n\nContext.\n\n'
        + '### Decision\n\nDecision.\n\n'
        + '### Rationale\n\nRationale.\n\n'
        + '### Alternatives Considered\n\n- Another owner.\n\n'
        + '### Consequences\n\nConsequence.\n',
    );
  await writeFile(decisionPath, source);
  rejectsCode('ARCHITECTURE_DECISION_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('external capability references must resolve', async (t) => {
  const value = await fixture(t);
  await writeFile(
    path.join(value.root, 'capabilities.json'),
    JSON.stringify({ capabilities: [{ id: 'station.current' }] }),
  );
  value.registry.modules[0].externalCapabilityRegistries.push({
    path: 'capabilities.json',
    capabilityIds: ['station.missing'],
    gate: 'station-capability-gate',
  });
  rejectsCode('ARCHITECTURE_CAPABILITY_UNKNOWN', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('changed paths resolve registered module ownership', async (t) => {
  const value = await fixture(t);
  const result = validateChangedArchitecturePaths({
    repoRoot: value.root,
    registry: value.registry,
    changedPaths: [
      'docs/architecture/example/design.md',
      'tooling/example/check.mjs',
    ],
  });
  assert.deepEqual(result.modules, ['example']);
});

test('changed active architecture modules must be registered', async (t) => {
  const value = await fixture(t);
  await mkdir(
    path.join(value.root, 'docs/architecture/unregistered'),
    { recursive: true },
  );
  await writeFile(
    path.join(value.root, 'docs/architecture/unregistered/README.md'),
    document('Another Team'),
  );
  rejectsCode('ARCHITECTURE_MODULE_UNREGISTERED', () =>
    validateChangedArchitecturePaths({
      repoRoot: value.root,
      registry: value.registry,
      changedPaths: ['docs/architecture/unregistered/README.md'],
    }));
});

test('removed standard module documents cannot escape registration', async (t) => {
  const value = await fixture(t);
  rejectsCode('ARCHITECTURE_MODULE_UNREGISTERED', () =>
    validateChangedArchitecturePaths({
      repoRoot: value.root,
      registry: value.registry,
      changedPaths: ['docs/architecture/removed/design.md'],
    }));
});

test('Plan decisions must belong to selected registered modules', async (t) => {
  const value = await fixture(t);
  rejectsCode('ARCHITECTURE_DECISION_INVALID', () =>
    validatePlanArchitecture({
      repoRoot: value.root,
      registry: value.registry,
      sources: ['docs/architecture/example/design.md'],
      decisions: ['OTHER-D01'],
    }));
});
