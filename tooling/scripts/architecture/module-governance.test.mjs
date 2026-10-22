import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ArchitectureGovernanceError,
  buildPreEditContext,
  collectSharedClientDependencies,
  deriveRequiredDocuments,
  loadArchitectureRegistry,
  renderPreEditContext,
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
  const moduleRoot = `docs/architecture/domains/${id}`;
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
  await mkdir(path.join(root, 'docs/architecture/domains'), {
    recursive: true,
  });
  await mkdir(path.join(root, 'tooling/acceptance'), {
    recursive: true,
  });
  await writeFile(
    path.join(root, 'docs/architecture/domains/README.md'),
    document('Architecture Team'),
  );
  const module = await createModule(root, 'example');
  await writeFile(
    path.join(root, 'docs', 'README.md'),
    '- Example: `architecture/domains/example/README.md`\n',
  );
  await writeFile(
    path.join(root, 'tooling/acceptance/gates.yaml'),
    JSON.stringify({
      version: 1,
      gates: {
        'architecture-test': {
          command: 'true',
          timeout_seconds: 1,
          environment: 'local',
          tier: 'ci-cheap',
          description: 'Fixture gate.',
        },
        'unrelated-gate': {
          command: 'true',
          timeout_seconds: 1,
          environment: 'local',
          tier: 'ci-cheap',
          description: 'Unrelated fixture gate.',
        },
      },
    }),
  );
  return {
    root,
    module,
    registry: {
      kind: 'peers-touch-architecture-module-registry',
      schemaVersion: 5,
      taxonomyIndexes: ['docs/architecture/domains/README.md'],
      documentCollections: [],
      modules: [module],
      reuseDivergences: [],
    },
  };
}

function addDivergenceCapability(value, overrides = {}) {
  const capability = {
    id: 'architecture.example.variant',
    owner: 'architecture.variant',
    contractRoots: [value.module.root],
    consumers: ['tooling/example', value.module.root],
    allowedDependencies: ['architecture.example.validate'],
    evidenceGates: ['architecture-test'],
    ...overrides,
  };
  value.module.capabilities.push(capability);
  return capability;
}

async function createSharedDependencyWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'shared-dependencies-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directories = [
    'apps/desktop/src-tauri/src',
    'apps/mobile/src-tauri/src',
    'workspace-packages/shared',
    'workspace-packages/dev-only',
    'rust/shared/src',
    'rust/dev-only/src',
  ];
  await Promise.all(
    directories.map((relative) =>
      mkdir(path.join(root, relative), { recursive: true })),
  );
  await writeFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - apps/*\n  - workspace-packages/{shared,dev-only}\n',
  );
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-root', private: true }),
  );
  await writeFile(
    path.join(root, 'workspace-packages/shared/package.json'),
    JSON.stringify({ name: '@test/shared', version: '1.0.0' }),
  );
  await writeFile(
    path.join(root, 'workspace-packages/dev-only/package.json'),
    JSON.stringify({ name: '@test/dev-only', version: '1.0.0' }),
  );
  for (const client of ['desktop', 'mobile']) {
    await writeFile(
      path.join(root, `apps/${client}/package.json`),
      JSON.stringify({
        name: `@test/${client}`,
        dependencies: {
          'shared-alias': 'workspace:@test/shared@*',
        },
        devDependencies: {
          '@test/dev-only': 'workspace:*',
        },
      }),
    );
    await writeFile(
      path.join(root, `apps/${client}/src-tauri/src/lib.rs`),
      '',
    );
  }
  await writeFile(
    path.join(root, 'rust/shared/Cargo.toml'),
    '[package]\nname = "shared-crate"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  await writeFile(path.join(root, 'rust/shared/src/lib.rs'), '');
  await writeFile(
    path.join(root, 'rust/dev-only/Cargo.toml'),
    '[package]\nname = "dev-only-crate"\nversion = "0.1.0"\nedition = "2021"\n',
  );
  await writeFile(path.join(root, 'rust/dev-only/src/lib.rs'), '');
  await writeFile(
    path.join(root, 'apps/desktop/src-tauri/Cargo.toml'),
    [
      '[package]',
      'name = "desktop-client"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies.shared_alias]',
      'package = "shared-crate"',
      'path = "../../../rust/shared"',
      '',
      '[dev-dependencies]',
      'dev-only-alias = { package = "dev-only-crate", path = "../../../rust/dev-only" }',
      '',
    ].join('\n'),
  );
  await writeFile(
    path.join(root, 'apps/mobile/src-tauri/Cargo.toml'),
    [
      '[package]',
      'name = "mobile-client"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[dependencies]',
      'mobile_shared = { package = "shared-crate", path = "../../../rust/shared" }',
      '',
      '[dev-dependencies.dev-only-alias]',
      'package = "dev-only-crate"',
      'path = "../../../rust/dev-only"',
      '',
    ].join('\n'),
  );
  return root;
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
    'agent',
    'api-ownership',
    'architecture-module-governance',
    'bot',
    'chat-storage-governance',
    'cross-client-runtime',
    'cross-station-social',
    'development-workflow',
    'experience-design',
    'local-dev-control-plane',
    'mobile-social-parity',
    'node-connectivity',
    'oauth-login-broker',
    'secure-content',
    'station-access-lifecycle',
    'x-config',
  ]);
  assert.deepEqual(result.capabilityIds, [
    'agent.chat.minimum-usable',
    'agent.mcp.dual-runtime',
    'architecture.module.validate',
    'chat.storage.device-governance',
    'client.chat.headless',
    'client.chat.presentation.desktop',
    'client.chat.presentation.mobile',
    'client.media-security.headless',
    'client.messaging.native-filesystem',
    'client.messaging.portable-core',
    'client.reuse.admission',
    'client.runtime.portability',
    'client.secure-content.portable-core',
    'client.station-trust.portable-core',
    'client.storage.headless',
    'experience.design.evaluate',
    'mobile.social.native-parity',
    'oauth.login.broker',
    'relay.control.enrollment',
    'relay.transport.circuit',
    'station.connectivity.node-authorization',
    'x.config.operator',
    'x.config.publication',
    'x.config.snapshot',
  ]);
});

test('current shared client dependencies are capability-registered', () => {
  const result = validateArchitectureRegistry({ repoRoot: REPO_ROOT });
  assert.deepEqual(
    result.sharedClientDependencies.map((dependency) => ({
      id: `${dependency.ecosystem}:${dependency.package}`,
      capabilityId: dependency.capabilityId,
      reuseLayer: dependency.reuseLayer,
    })),
    [
      {
        id: 'cargo:messaging-core',
        capabilityId: 'client.messaging.portable-core',
        reuseLayer: 'portable-rust-core',
      },
      {
        id: 'cargo:messaging-native-filesystem',
        capabilityId: 'client.messaging.native-filesystem',
        reuseLayer: 'platform-adapter',
      },
      {
        id: 'cargo:secure-content-core',
        capabilityId: 'client.secure-content.portable-core',
        reuseLayer: 'portable-rust-core',
      },
      {
        id: 'cargo:station-libp2p-http',
        capabilityId: 'relay.transport.circuit',
        reuseLayer: 'portable-rust-core',
      },
      {
        id: 'cargo:station-trust',
        capabilityId: 'client.station-trust.portable-core',
        reuseLayer: 'portable-rust-core',
      },
      {
        id: 'cargo:x-config-core',
        capabilityId: 'x.config.snapshot',
        reuseLayer: 'portable-rust-core',
      },
      {
        id: 'pnpm:@peers-touch/client-chat-core',
        capabilityId: 'client.chat.headless',
        reuseLayer: 'shared-ts-core',
      },
      {
        id: 'pnpm:@peers-touch/client-media-security',
        capabilityId: 'client.media-security.headless',
        reuseLayer: 'shared-ts-core',
      },
      {
        id: 'pnpm:@peers-touch/client-storage',
        capabilityId: 'client.storage.headless',
        reuseLayer: 'shared-ts-core',
      },
    ],
  );
});

test('shared dependency collection follows workspace and Cargo metadata', async (t) => {
  const root = await createSharedDependencyWorkspace(t);
  assert.deepEqual(
    collectSharedClientDependencies({ repoRoot: root }).map(
      (dependency) => ({
        id: `${dependency.ecosystem}:${dependency.package}`,
        manifest: dependency.manifest,
      }),
    ),
    [
      {
        id: 'cargo:shared-crate',
        manifest: 'rust/shared/Cargo.toml',
      },
      {
        id: 'pnpm:@test/shared',
        manifest: 'workspace-packages/shared/package.json',
      },
    ],
  );
});

test('workspace dependency collection rejects package symlink escapes', async (t) => {
  const root = await createSharedDependencyWorkspace(t);
  const external = await mkdtemp(path.join(os.tmpdir(), 'external-package-'));
  t.after(() => rm(external, { recursive: true, force: true }));
  await writeFile(
    path.join(external, 'package.json'),
    JSON.stringify({ name: '@test/external', version: '1.0.0' }),
  );
  await symlink(external, path.join(root, 'workspace-packages/external'));
  await writeFile(
    path.join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - apps/*\n  - workspace-packages/*\n',
  );
  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
    collectSharedClientDependencies({ repoRoot: root }));
});

test('registry rejects an unregistered shared client dependency', () => {
  const registry = structuredClone(
    loadArchitectureRegistry({ repoRoot: REPO_ROOT }),
  );
  const module = registry.modules.find(
    (candidate) => candidate.id === 'cross-client-runtime',
  );
  module.capabilities = module.capabilities.filter(
    (capability) => capability.id !== 'client.storage.headless',
  );
  rejectsCode('ARCHITECTURE_REUSE_UNREGISTERED', () =>
    validateArchitectureRegistry({
      repoRoot: REPO_ROOT,
      registry,
    }));
});

test('registry rejects shared dependency capabilities with incomplete consumers', () => {
  const registry = structuredClone(
    loadArchitectureRegistry({ repoRoot: REPO_ROOT }),
  );
  const module = registry.modules.find(
    (candidate) => candidate.id === 'cross-client-runtime',
  );
  for (const capability of module.capabilities) {
    if (
      capability.id === 'client.storage.headless'
      || capability.id === 'client.reuse.admission'
    ) {
      capability.consumers = ['apps'];
    }
  }
  rejectsCode('ARCHITECTURE_REUSE_UNREGISTERED', () =>
    validateArchitectureRegistry({
      repoRoot: REPO_ROOT,
      registry,
    }));
});

test('registry rejects a shared dependency with the wrong reuse layer', () => {
  const registry = structuredClone(
    loadArchitectureRegistry({ repoRoot: REPO_ROOT }),
  );
  const module = registry.modules.find(
    (candidate) => candidate.id === 'cross-client-runtime',
  );
  module.capabilities.find(
    (capability) => capability.id === 'client.storage.headless',
  ).reuseLayer = 'platform-adapter';

  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: REPO_ROOT,
      registry,
    }));
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

test('reuse divergences require a registered accepted decision', async (t) => {
  const value = await fixture(t);
  const implementationCapability = addDivergenceCapability(value);
  value.registry.reuseDivergences.push({
    capabilityId: 'architecture.example.validate',
    axis: 'runtime-constraint',
    canonicalRoot: 'tooling/example',
    implementations: [
      {
        capabilityId: implementationCapability.id,
        root: 'docs/architecture/domains/example',
        consumers: ['tooling/example'],
        evidenceGates: ['architecture-test'],
      },
    ],
    rationale: 'The fixture exercises divergence validation.',
    decisionId: 'EX-D99',
    reviewTrigger: 'Review when the runtime constraint disappears.',
  });
  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('reuse divergences bind capability roots, consumers, and decisions', async (t) => {
  const value = await fixture(t);
  const implementationCapability = addDivergenceCapability(value);
  const divergence = {
    capabilityId: 'architecture.example.validate',
    axis: 'runtime-constraint',
    canonicalRoot: 'tooling/example',
    implementations: [
      {
        capabilityId: implementationCapability.id,
        root: 'docs/architecture/domains/example',
        consumers: [
          'tooling/example',
          'docs/architecture/domains/example',
        ],
        evidenceGates: ['architecture-test'],
      },
    ],
    rationale: 'The fixture exercises a bounded runtime variation.',
    decisionId: 'EX-D01',
    reviewTrigger: 'Review when the runtime constraint disappears.',
  };
  value.registry.reuseDivergences.push(divergence);
  const result = validateArchitectureRegistry({
    repoRoot: value.root,
    registry: value.registry,
  });
  assert.deepEqual(result.reuseDivergences, [divergence]);
});

test('reuse divergences reject unknown evidence gates', async (t) => {
  const value = await fixture(t);
  const implementationCapability = addDivergenceCapability(value);
  value.registry.reuseDivergences.push({
    capabilityId: 'architecture.example.validate',
    axis: 'runtime-constraint',
    canonicalRoot: 'tooling/example',
    implementations: [
      {
        capabilityId: implementationCapability.id,
        root: 'docs/architecture/domains/example',
        consumers: ['tooling/example'],
        evidenceGates: ['missing-gate'],
      },
    ],
    rationale: 'The fixture exercises evidence gate validation.',
    decisionId: 'EX-D01',
    reviewTrigger: 'Review when the runtime constraint disappears.',
  });
  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('reuse divergences reject Gates not owned by the implementation capability', async (t) => {
  const value = await fixture(t);
  const implementationCapability = addDivergenceCapability(value);
  value.registry.reuseDivergences.push({
    capabilityId: 'architecture.example.validate',
    axis: 'runtime-constraint',
    canonicalRoot: 'tooling/example',
    implementations: [
      {
        capabilityId: implementationCapability.id,
        root: 'docs/architecture/domains/example',
        consumers: ['tooling/example'],
        evidenceGates: ['unrelated-gate'],
      },
    ],
    rationale: 'The fixture exercises Gate ownership validation.',
    decisionId: 'EX-D01',
    reviewTrigger: 'Review when the runtime constraint disappears.',
  });
  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('reuse divergence implementation capabilities depend on the canonical capability', async (t) => {
  const value = await fixture(t);
  const implementationCapability = addDivergenceCapability(value, {
    allowedDependencies: [],
  });
  value.registry.reuseDivergences.push({
    capabilityId: 'architecture.example.validate',
    axis: 'runtime-constraint',
    canonicalRoot: 'tooling/example',
    implementations: [
      {
        capabilityId: implementationCapability.id,
        root: 'docs/architecture/domains/example',
        consumers: ['tooling/example'],
        evidenceGates: ['architecture-test'],
      },
    ],
    rationale: 'The fixture exercises canonical dependency validation.',
    decisionId: 'EX-D01',
    reviewTrigger: 'Review when the runtime constraint disappears.',
  });
  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('reuse divergences require architecture-owned implementation roots', async (t) => {
  const value = await fixture(t);
  const implementationCapability = addDivergenceCapability(value);
  value.registry.reuseDivergences.push({
    capabilityId: 'architecture.example.validate',
    axis: 'runtime-constraint',
    canonicalRoot: 'tooling/example',
    implementations: [
      {
        capabilityId: implementationCapability.id,
        root: 'docs/README.md',
        consumers: ['tooling/example'],
        evidenceGates: ['architecture-test'],
      },
    ],
    rationale: 'The fixture exercises implementation ownership.',
    decisionId: 'EX-D01',
    reviewTrigger: 'Review when the runtime constraint disappears.',
  });
  rejectsCode('ARCHITECTURE_REUSE_INVALID', () =>
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

test('capability contract roots must exist inside module governance', async (t) => {
  const value = await fixture(t);
  value.registry.modules[0].capabilities[0].contractRoots = ['docs/README.md'];
  rejectsCode('ARCHITECTURE_REGISTRY_INVALID', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('capability consumers may live outside the owning module', async (t) => {
  const value = await fixture(t);
  value.registry.modules[0].capabilities[0].consumers = ['docs/README.md'];
  const result = validateArchitectureRegistry({
    repoRoot: value.root,
    registry: value.registry,
  });
  assert.deepEqual(
    result.registry.modules[0].capabilities[0].consumers,
    ['docs/README.md'],
  );
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

test('external YAML capability references must resolve', async (t) => {
  const value = await fixture(t);
  await writeFile(
    path.join(value.root, 'capabilities.yaml'),
    'capabilities:\n  - id: station.current\n',
  );
  value.registry.modules[0].externalCapabilityRegistries.push({
    path: 'capabilities.yaml',
    capabilityIds: ['station.missing'],
    gate: 'station-capability-gate',
  });
  rejectsCode('ARCHITECTURE_CAPABILITY_UNKNOWN', () =>
    validateArchitectureRegistry({
      repoRoot: value.root,
      registry: value.registry,
    }));
});

test('governed paths cannot overlap across modules', async (t) => {
  const value = await fixture(t);
  const second = await createModule(value.root, 'second');
  await mkdir(path.join(value.root, 'tooling/example/nested'), {
    recursive: true,
  });
  second.governedPaths = [
    second.root,
    'tooling/example/nested',
  ];
  second.capabilities[0].contractRoots = ['tooling/example/nested'];
  second.capabilities[0].consumers = ['tooling/example/nested'];
  value.registry.modules.push(second);
  await writeFile(
    path.join(value.root, 'docs', 'README.md'),
    [
      '- Example: `architecture/domains/example/README.md`',
      '- Second: `architecture/domains/second/README.md`',
      '',
    ].join('\n'),
  );
  rejectsCode('ARCHITECTURE_REGISTRY_INVALID', () =>
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
      'docs/architecture/domains/example/design.md',
      'tooling/example/check.mjs',
    ],
  });
  assert.deepEqual(result.modules, ['example']);
});

test('taxonomy indexes are admitted without becoming modules', async (t) => {
  const value = await fixture(t);
  const result = validateChangedArchitecturePaths({
    repoRoot: value.root,
    registry: value.registry,
    changedPaths: ['docs/architecture/domains/README.md'],
  });
  assert.deepEqual(result.modules, []);
});

test('taxonomy indexes cannot carry Plan decisions', async (t) => {
  const value = await fixture(t);
  rejectsCode('ARCHITECTURE_DECISION_INVALID', () =>
    validatePlanArchitecture({
      repoRoot: value.root,
      registry: value.registry,
      sources: ['docs/architecture/domains/README.md'],
      decisions: ['FAKE-D01'],
    }));
});

test('known document collections do not claim module ownership', async (t) => {
  const value = await fixture(t);
  const collectionRoot = 'docs/architecture/domains/reference';
  await mkdir(path.join(value.root, collectionRoot), { recursive: true });
  await writeFile(
    path.join(value.root, collectionRoot, 'README.md'),
    document('Reference Team'),
  );
  await writeFile(
    path.join(value.root, collectionRoot, 'design.md'),
    document('Reference Team'),
  );
  value.registry.documentCollections.push(collectionRoot);
  const result = validateChangedArchitecturePaths({
    repoRoot: value.root,
    registry: value.registry,
    changedPaths: [`${collectionRoot}/design.md`],
  });
  assert.deepEqual(result.modules, []);
});

test('module identity is independent from its nested directory basename', async (t) => {
  const value = await fixture(t);
  value.registry.modules[0].id = 'business-example';
  const result = validateArchitectureRegistry({
    repoRoot: value.root,
    registry: value.registry,
  });
  assert.deepEqual(result.moduleIds, ['business-example']);
});

test('pre-edit context deterministically matches knowledge and architecture', async (t) => {
  const value = await fixture(t);
  const knowledgePath = 'docs/knowledge/invariants/example.md';
  await mkdir(path.join(value.root, path.dirname(knowledgePath)), {
    recursive: true,
  });
  await writeFile(
    path.join(value.root, knowledgePath),
    [
      '---',
      'kind: invariant',
      'title: Example',
      'status: active',
      'owns:',
      '  - tooling/example/',
      'detected: 2026-09-27',
      '---',
      '',
      '# Example',
      '',
    ].join('\n'),
  );

  const first = buildPreEditContext({
    repoRoot: value.root,
    registry: value.registry,
    targets: ['tooling/example/check.mjs'],
  });
  const second = buildPreEditContext({
    repoRoot: value.root,
    registry: value.registry,
    targets: [path.join(value.root, 'tooling/example/check.mjs')],
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.targets, ['tooling/example/check.mjs']);
  assert.deepEqual(
    first.knowledge.map((entry) => entry.path),
    [knowledgePath],
  );
  assert.deepEqual(
    first.architecture.map((entry) => entry.moduleId),
    ['example'],
  );
  assert.deepEqual(first.architecture[0].capabilityIds, [
    'architecture.example.validate',
  ]);
  assert.match(first.receiptDigest, /^[0-9a-f]{64}$/);
  assert.match(renderPreEditContext(first), /PT_PRE_EDIT_CONTEXT/);
  assert.match(renderPreEditContext(first), /does not grant write authorization/);
});

test('pre-edit context ordering is independent of locale collation', async (t) => {
  const value = await fixture(t);
  const knowledgeRoot = path.join(
    value.root,
    'docs/knowledge/invariants',
  );
  await mkdir(knowledgeRoot, { recursive: true });
  for (const name of ['zeta.md', '\u00e4ther.md']) {
    await writeFile(
      path.join(knowledgeRoot, name),
      [
        '---',
        'kind: invariant',
        `title: ${name}`,
        'status: active',
        'owns:',
        '  - tooling/example/',
        'detected: 2026-09-27',
        '---',
        '',
      ].join('\n'),
    );
  }

  const receipt = buildPreEditContext({
    repoRoot: value.root,
    registry: value.registry,
    targets: ['tooling/example/check.mjs'],
  });
  assert.deepEqual(
    receipt.knowledge.map((entry) => entry.path),
    [
      'docs/knowledge/invariants/zeta.md',
      'docs/knowledge/invariants/\u00e4ther.md',
    ],
  );
});

test('changed active architecture modules must be registered', async (t) => {
  const value = await fixture(t);
  await mkdir(
    path.join(value.root, 'docs/architecture/domains/unregistered'),
    { recursive: true },
  );
  await writeFile(
    path.join(value.root, 'docs/architecture/domains/unregistered/README.md'),
    document('Another Team'),
  );
  rejectsCode('ARCHITECTURE_MODULE_UNREGISTERED', () =>
    validateChangedArchitecturePaths({
      repoRoot: value.root,
      registry: value.registry,
      changedPaths: ['docs/architecture/domains/unregistered/README.md'],
    }));
});

test('removed paths do not manufacture current architecture modules', async (t) => {
  const value = await fixture(t);
  const result = validateChangedArchitecturePaths({
    repoRoot: value.root,
    registry: value.registry,
    changedPaths: ['docs/architecture/domains/removed/design.md'],
  });
  assert.deepEqual(result.modules, []);
});

test('Plan decisions must belong to selected registered modules', async (t) => {
  const value = await fixture(t);
  rejectsCode('ARCHITECTURE_DECISION_INVALID', () =>
    validatePlanArchitecture({
      repoRoot: value.root,
      registry: value.registry,
      sources: ['docs/architecture/domains/example/design.md'],
      decisions: ['OTHER-D01'],
    }));
});

test('Plan validation preserves gradual rollout for unregistered modules', async (t) => {
  const value = await fixture(t);
  await mkdir(path.join(value.root, 'docs/architecture/existing'), {
    recursive: true,
  });
  await writeFile(
    path.join(value.root, 'docs/architecture/existing/README.md'),
    document('Existing Team'),
  );
  await writeFile(
    path.join(value.root, 'docs/architecture/existing/design.md'),
    document('Existing Team'),
  );

  const legacyOnly = validatePlanArchitecture({
    repoRoot: value.root,
    registry: value.registry,
    sources: ['docs/architecture/existing/design.md'],
    decisions: ['EXISTING-D01'],
  });
  assert.deepEqual(legacyOnly.modules, []);

  const mixed = validatePlanArchitecture({
    repoRoot: value.root,
    registry: value.registry,
    sources: [
      'docs/architecture/domains/example/design.md',
      'docs/architecture/existing/design.md',
    ],
    decisions: ['EX-D01', 'EXISTING-D01'],
  });
  assert.deepEqual(mixed.modules, ['example']);

  rejectsCode('ARCHITECTURE_DECISION_INVALID', () =>
    validatePlanArchitecture({
      repoRoot: value.root,
      registry: value.registry,
      sources: [
        'docs/architecture/domains/example/design.md',
        'docs/architecture/existing/design.md',
      ],
      decisions: ['EX-D99', 'EXISTING-D01'],
    }));
});
