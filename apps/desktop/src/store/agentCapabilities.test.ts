import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RuntimeCapabilitySnapshotSchema } from '../gen/proto/domain/agent/agent_pb';
import {
  AgentCapabilityBindingSchema,
  CapabilityApprovalPolicy,
  CapabilityManifestSchema,
  CapabilityReadinessSnapshotSchema,
  CapabilityReadinessState,
  CapabilitySourceKind,
  CreateKnowledgeResourceDescriptorRequestSchema,
  KnowledgeResourceDescriptorSchema,
  KnowledgeResourceKind,
  TombstoneKnowledgeResourceDescriptorRequestSchema,
  UpdateKnowledgeResourceDescriptorRequestSchema,
} from '../gen/proto/domain/agent/capability_pb';

const capabilityApi = vi.hoisted(() => ({
  listCapabilityManifests: vi.fn(),
  listAgentCapabilityBindings: vi.fn(),
  readAgentCapabilityReadiness: vi.fn(),
  upsertAgentCapabilityBinding: vi.fn(),
  deleteAgentCapabilityBinding: vi.fn(),
  createKnowledgeResourceDescriptor: vi.fn(),
  updateKnowledgeResourceDescriptor: vi.fn(),
  listKnowledgeResourceDescriptors: vi.fn(),
  tombstoneKnowledgeResourceDescriptor: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: capabilityApi,
}));

import {
  selectAgentCapabilityBindingsBySource,
  selectAgentCapabilityReadinessBySource,
  selectCapabilityManifestBySource,
  useAgentCapabilityStore,
} from './agentCapabilities';
import { projectAgentComposerReadiness } from './agentCapabilityReadiness';

const mcpManifest = create(CapabilityManifestSchema, {
  capabilityId: 'mcp.invoke',
  version: '1',
  sourceKind: CapabilitySourceKind.MCP,
  sourceInstanceId: 'local-mcp',
});
const connectorManifest = create(CapabilityManifestSchema, {
  capabilityId: 'connector.search',
  version: '2',
  sourceKind: CapabilitySourceKind.CONNECTOR,
  sourceInstanceId: 'search-provider',
});
const mcpBinding = create(AgentCapabilityBindingSchema, {
  bindingId: 'binding-mcp',
  agentId: 'agent-1',
  capabilityId: mcpManifest.capabilityId,
  capabilityVersion: mcpManifest.version,
  enabled: true,
  approvalPolicy: CapabilityApprovalPolicy.MANUAL,
  expectedAgentVersion: 8n,
  revision: 3n,
});
const readiness = create(CapabilityReadinessSnapshotSchema, {
  snapshotId: 'snapshot-1',
  agentId: 'agent-1',
  selectedClientSessionId: 'session-desktop',
  capabilities: [{
    capabilityId: mcpManifest.capabilityId,
    capabilityVersion: mcpManifest.version,
    bindingId: mcpBinding.bindingId,
    bindingRevision: mcpBinding.revision,
    state: CapabilityReadinessState.UNAVAILABLE,
    authority: 'station',
    reasonCode: 'mcp_operation_not_active',
  }],
});
const knowledgeDescriptor = create(KnowledgeResourceDescriptorSchema, {
  resourceId: 'knowledge-1',
  ptid: 'ptid:actor-1',
  revision: 1n,
  resourceKind: KnowledgeResourceKind.DOCUMENT,
  title: 'Architecture notes',
  locator: {
    case: 'stationContentRef',
    value: { contentRef: 'station-content:knowledge-1:1' },
  },
});

describe('agent capability authority store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentCapabilityStore.getState().reset();
    capabilityApi.listCapabilityManifests.mockResolvedValue([
      mcpManifest,
      connectorManifest,
    ]);
    capabilityApi.listAgentCapabilityBindings.mockResolvedValue([mcpBinding]);
    capabilityApi.readAgentCapabilityReadiness.mockResolvedValue(readiness);
    capabilityApi.upsertAgentCapabilityBinding.mockResolvedValue(mcpBinding);
    capabilityApi.deleteAgentCapabilityBinding.mockResolvedValue(mcpBinding);
    capabilityApi.listKnowledgeResourceDescriptors.mockResolvedValue({
      descriptors: [knowledgeDescriptor],
      nextCursor: '',
    });
    capabilityApi.createKnowledgeResourceDescriptor.mockResolvedValue({
      descriptor: knowledgeDescriptor,
      manifest: mcpManifest,
    });
    capabilityApi.updateKnowledgeResourceDescriptor.mockResolvedValue({
      descriptor: knowledgeDescriptor,
      manifest: mcpManifest,
    });
    capabilityApi.tombstoneKnowledgeResourceDescriptor.mockResolvedValue({
      descriptor: knowledgeDescriptor,
      manifest: mcpManifest,
    });
  });

  it('loads catalog, bindings, and readiness as the canonical projection', async () => {
    const store = useAgentCapabilityStore.getState();
    await store.loadCatalog();
    await store.loadAgent('agent-1', {
      clientCapabilitySessionId: 'session-desktop',
    });

    const state = useAgentCapabilityStore.getState();
    expect(state.manifests).toEqual([mcpManifest, connectorManifest]);
    expect(state.bindingsByAgentId['agent-1']).toEqual([mcpBinding]);
    expect(state.readinessByAgentId['agent-1']).toBe(readiness);
    expect(capabilityApi.readAgentCapabilityReadiness).toHaveBeenCalledWith({
      agent_id: 'agent-1',
      runtime_snapshot_id: undefined,
      client_capability_session_id: 'session-desktop',
    });
  });

  it('submits plain CAS fields and refreshes bindings plus readiness', async () => {
    await useAgentCapabilityStore.getState().loadAgent('agent-1', {
      clientCapabilitySessionId: 'session-desktop',
    });
    capabilityApi.readAgentCapabilityReadiness.mockClear();

    await useAgentCapabilityStore.getState().upsertBinding({
      bindingId: mcpBinding.bindingId,
      agentId: mcpBinding.agentId,
      capabilityId: mcpBinding.capabilityId,
      capabilityVersion: mcpBinding.capabilityVersion,
      enabled: true,
      approvalPolicy: CapabilityApprovalPolicy.MANUAL,
      expectedAgentVersion: 8n,
      expectedBindingRevision: 3n,
      idempotencyKey: 'upsert-command-1',
    });

    expect(capabilityApi.upsertAgentCapabilityBinding).toHaveBeenCalledWith({
      bindingId: 'binding-mcp',
      agentId: 'agent-1',
      capabilityId: 'mcp.invoke',
      capabilityVersion: '1',
      enabled: true,
      approvalPolicy: CapabilityApprovalPolicy.MANUAL,
      expectedAgentVersion: 8n,
    }, 3n, 'upsert-command-1');
    expect(capabilityApi.listAgentCapabilityBindings).toHaveBeenCalledWith('agent-1');
    expect(capabilityApi.readAgentCapabilityReadiness).toHaveBeenCalledWith({
      agent_id: 'agent-1',
      runtime_snapshot_id: undefined,
      client_capability_session_id: 'session-desktop',
    });
  });

  it('joins source selectors through canonical manifest identity', async () => {
    await useAgentCapabilityStore.getState().loadCatalog();
    await useAgentCapabilityStore.getState().loadAgent('agent-1');
    const state = useAgentCapabilityStore.getState();

    expect(selectCapabilityManifestBySource(
      state,
      CapabilitySourceKind.MCP,
      'local-mcp',
    )).toBe(mcpManifest);
    expect(selectAgentCapabilityBindingsBySource(
      state,
      'agent-1',
      CapabilitySourceKind.MCP,
    )).toEqual([mcpBinding]);
    expect(selectAgentCapabilityReadinessBySource(
      state,
      'agent-1',
      CapabilitySourceKind.MCP,
    )).toEqual(readiness.capabilities);
    expect(selectAgentCapabilityReadinessBySource(
      state,
      'agent-1',
      CapabilitySourceKind.CONNECTOR,
    )).toEqual([]);
  });

  it('loads every Knowledge descriptor page into the runtime-owned projection', async () => {
    const secondDescriptor = create(KnowledgeResourceDescriptorSchema, {
      ...knowledgeDescriptor,
      resourceId: 'knowledge-2',
      revision: 2n,
    });
    capabilityApi.listKnowledgeResourceDescriptors
      .mockResolvedValueOnce({
        descriptors: [knowledgeDescriptor],
        nextCursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        descriptors: [secondDescriptor],
        nextCursor: '',
      });

    await useAgentCapabilityStore.getState().loadKnowledgeDescriptors();

    expect(useAgentCapabilityStore.getState().knowledgeDescriptors).toEqual([
      knowledgeDescriptor,
      secondDescriptor,
    ]);
    expect(
      capabilityApi.listKnowledgeResourceDescriptors.mock.calls[1]?.[0].cursor,
    ).toBe('cursor-2');
  });

  it('mutates descriptors through generated requests and reconciles authority', async () => {
    const createRequest = create(CreateKnowledgeResourceDescriptorRequestSchema, {
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      source: { case: 'stationContent', value: new Uint8Array([1, 2, 3]) },
      idempotencyKey: 'knowledge-create-1',
      title: 'Architecture notes',
    });
    const updateRequest = create(UpdateKnowledgeResourceDescriptorRequestSchema, {
      resourceId: knowledgeDescriptor.resourceId,
      expectedRevision: knowledgeDescriptor.revision,
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      source: { case: 'stationContent', value: new Uint8Array([4, 5, 6]) },
      idempotencyKey: 'knowledge-update-1',
      title: 'Updated architecture notes',
    });
    const tombstoneRequest = create(
      TombstoneKnowledgeResourceDescriptorRequestSchema,
      {
        resourceId: knowledgeDescriptor.resourceId,
        expectedRevision: knowledgeDescriptor.revision,
        idempotencyKey: 'knowledge-delete-1',
        reason: 'retired',
      },
    );

    await useAgentCapabilityStore.getState().createKnowledgeDescriptor(createRequest);
    await useAgentCapabilityStore.getState().updateKnowledgeDescriptor(updateRequest);
    await useAgentCapabilityStore.getState().tombstoneKnowledgeDescriptor(
      tombstoneRequest,
    );

    expect(capabilityApi.createKnowledgeResourceDescriptor)
      .toHaveBeenCalledWith(createRequest);
    expect(capabilityApi.updateKnowledgeResourceDescriptor)
      .toHaveBeenCalledWith(updateRequest);
    expect(capabilityApi.tombstoneKnowledgeResourceDescriptor)
      .toHaveBeenCalledWith(tombstoneRequest);
    expect(capabilityApi.listKnowledgeResourceDescriptors).toHaveBeenCalledTimes(3);
    expect(capabilityApi.listCapabilityManifests).toHaveBeenCalledTimes(3);
  });

  it('clears every actor-scoped projection on reset', async () => {
    await useAgentCapabilityStore.getState().loadCatalog();
    await useAgentCapabilityStore.getState().loadKnowledgeDescriptors();
    await useAgentCapabilityStore.getState().loadAgent('agent-1');

    useAgentCapabilityStore.getState().reset();

    expect(useAgentCapabilityStore.getState()).toMatchObject({
      manifests: [],
      knowledgeDescriptors: [],
      bindingsByAgentId: {},
      readinessByAgentId: {},
      readinessInputByAgentId: {},
      pendingMutations: {},
    });
  });
});

describe('Agent composer readiness projection', () => {
  function stationSnapshot(
    state: CapabilityReadinessState,
    expiresAtMs = 10_000,
    agentRevision = 8,
  ) {
    return create(CapabilityReadinessSnapshotSchema, {
      snapshotId: 'readiness-1',
      agentId: 'agent-1',
      runtimeSnapshotId: 'runtime-1',
      modelCapabilities: create(RuntimeCapabilitySnapshotSchema, {
        snapshotId: 'runtime-1',
      }),
      bindingRevisions: [
        `agent:agent-1:${agentRevision}`,
        'binding:binding-mcp:3',
      ],
      capabilities: [{
        capabilityId: mcpBinding.capabilityId,
        capabilityVersion: mcpBinding.capabilityVersion,
        bindingId: mcpBinding.bindingId,
        bindingRevision: mcpBinding.revision,
        state,
        authority: 'station-capability-authority',
        reasonCode: state === CapabilityReadinessState.READY
          ? 'capability_ready'
          : 'runtime_capability_unavailable',
      }],
      createdAt: timestampFromDate(new Date(1_000)),
      expiresAt: timestampFromDate(new Date(expiresAtMs)),
    });
  }

  it('allows only fresh Station snapshots in an accepted ready or degraded state', () => {
    expect(projectAgentComposerReadiness(
      'agent-1',
      8,
      [mcpBinding],
      stationSnapshot(CapabilityReadinessState.READY),
      5_000,
    )).toMatchObject({
      state: 'ready',
      compatibility: 'compatible',
      canSend: true,
      snapshotId: 'readiness-1',
      runtimeSnapshotId: 'runtime-1',
      authority: 'station-capability-authority',
    });
    expect(projectAgentComposerReadiness(
      'agent-1',
      8,
      [mcpBinding],
      stationSnapshot(CapabilityReadinessState.DEGRADED),
      5_000,
    )).toMatchObject({
      state: 'degraded',
      compatibility: 'degraded',
      canSend: true,
    });
  });

  it('blocks unknown, stale, and authoritative non-ready snapshots', () => {
    expect(projectAgentComposerReadiness(
      'agent-1',
      8,
      [mcpBinding],
      undefined,
      5_000,
    )).toMatchObject({
      state: 'unknown',
      canSend: false,
      reasonCode: 'readiness_snapshot_missing',
    });
    expect(projectAgentComposerReadiness(
      'agent-1',
      8,
      [mcpBinding],
      stationSnapshot(CapabilityReadinessState.READY, 4_999),
      5_000,
    )).toMatchObject({
      state: 'stale',
      canSend: false,
      reasonCode: 'readiness_snapshot_expired',
    });
    expect(projectAgentComposerReadiness(
      'agent-1',
      8,
      [mcpBinding],
      stationSnapshot(CapabilityReadinessState.UNAVAILABLE),
      5_000,
    )).toMatchObject({
      state: 'unavailable',
      compatibility: 'incompatible',
      canSend: false,
      reasonCode: 'runtime_capability_unavailable',
    });
  });

  it('rejects a snapshot that does not cover the selected Agent revision', () => {
    expect(projectAgentComposerReadiness(
      'agent-1',
      8,
      [mcpBinding],
      stationSnapshot(CapabilityReadinessState.READY, 10_000, 7),
      5_000,
    )).toMatchObject({
      state: 'stale',
      canSend: false,
      reasonCode: 'agent_revision_stale',
    });
  });
});
