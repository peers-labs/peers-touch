import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentCapabilityBindingSchema,
  CapabilityReadinessState,
  CapabilityReadinessSnapshotSchema,
  CreateKnowledgeResourceDescriptorRequestSchema,
  CreateKnowledgeResourceDescriptorResponseSchema,
  DeleteAgentCapabilityBindingResponseSchema,
  GetCapabilityReadinessResponseSchema,
  KnowledgeResourceDescriptorSchema,
  KnowledgeResourceKind,
  ListAgentCapabilityBindingsResponseSchema,
  ListCapabilityManifestsResponseSchema,
  ListKnowledgeResourceDescriptorsRequestSchema,
  ListKnowledgeResourceDescriptorsResponseSchema,
  TombstoneKnowledgeResourceDescriptorRequestSchema,
  TombstoneKnowledgeResourceDescriptorResponseSchema,
  UpdateKnowledgeResourceDescriptorRequestSchema,
  UpdateKnowledgeResourceDescriptorResponseSchema,
  UpsertAgentCapabilityBindingResponseSchema,
} from '../gen/proto/domain/agent/capability_pb';
import { api, isAgentCapabilityReady } from './desktop_api';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

function resolveProto(bytes: Uint8Array): void {
  vi.mocked(invoke).mockResolvedValueOnce({
    ok: true,
    data: Array.from(bytes),
  });
}

function requestBytesAt(index: number): Uint8Array {
  const options = vi.mocked(invoke).mock.calls[index]?.[1] as {
    input?: { requestBytes?: number[] };
  } | undefined;
  return new Uint8Array(options?.input?.requestBytes ?? []);
}

describe('Desktop capability authority API', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it('decodes catalog, binding, and readiness protobuf responses', async () => {
    resolveProto(toBinary(
      ListCapabilityManifestsResponseSchema,
      create(ListCapabilityManifestsResponseSchema, {
        manifests: [{ capabilityId: 'filesystem.read', version: '1' }],
      }),
    ));
    resolveProto(toBinary(
      ListAgentCapabilityBindingsResponseSchema,
      create(ListAgentCapabilityBindingsResponseSchema, {
        bindings: [{
          bindingId: 'binding-1',
          agentId: 'agent-1',
          capabilityId: 'filesystem.read',
          capabilityVersion: '1',
          revision: 3n,
        }],
      }),
    ));
    resolveProto(toBinary(
      GetCapabilityReadinessResponseSchema,
      create(GetCapabilityReadinessResponseSchema, {
        snapshot: create(CapabilityReadinessSnapshotSchema, {
          snapshotId: 'snapshot-1',
          agentId: 'agent-1',
        }),
      }),
    ));

    const manifests = await api.listCapabilityManifests();
    const bindings = await api.listAgentCapabilityBindings('agent-1');
    const readiness = await api.readAgentCapabilityReadiness({
      agent_id: 'agent-1',
    });

    expect(manifests[0]?.capabilityId).toBe('filesystem.read');
    expect(bindings[0]?.revision).toBe(3n);
    expect(readiness.snapshotId).toBe('snapshot-1');
    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_capability_manifest_list', {
      input: { sourceKinds: [] },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_capability_binding_list', {
      input: { agentId: 'agent-1' },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, 'agent_capability_readiness', {
      input: { agent_id: 'agent-1' },
    });
  });

  it('preserves protobuf JSON readiness enum names', async () => {
    resolveProto(toBinary(
      GetCapabilityReadinessResponseSchema,
      create(GetCapabilityReadinessResponseSchema, {
        snapshot: create(CapabilityReadinessSnapshotSchema, {
          snapshotId: 'snapshot-1',
          agentId: 'agent-1',
          capabilities: [{
            capabilityId: 'tool:skills_list',
            capabilityVersion: '1',
            bindingId: 'binding-1',
            bindingRevision: 3n,
            state: CapabilityReadinessState.READY,
            reasonCode: 'capability_ready',
          }],
        }),
      }),
    ));

    const readiness = await api.getAgentCapabilityReadiness({
      agent_id: 'agent-1',
    });
    const capability = readiness.capabilities[0];

    expect(capability?.state).toBe('CAPABILITY_READINESS_STATE_READY');
    expect(capability && isAgentCapabilityReady(capability)).toBe(true);
  });

  it('normalizes an omitted protobuf readiness list to an empty array', async () => {
    resolveProto(toBinary(
      GetCapabilityReadinessResponseSchema,
      create(GetCapabilityReadinessResponseSchema, {
        snapshot: create(CapabilityReadinessSnapshotSchema, {
          snapshotId: 'snapshot-empty',
          agentId: 'agent-1',
        }),
      }),
    ));

    const readiness = await api.getAgentCapabilityReadiness({
      agent_id: 'agent-1',
    });

    expect(readiness.capabilities).toEqual([]);
  });

  it('forwards complete CAS inputs and decodes mutation responses', async () => {
    const binding = create(AgentCapabilityBindingSchema, {
      bindingId: 'binding-1',
      agentId: 'agent-1',
      capabilityId: 'filesystem.read',
      capabilityVersion: '1',
      enabled: true,
      approvalPolicy: 1,
      expectedAgentVersion: 7n,
      revision: 4n,
    });
    resolveProto(toBinary(
      UpsertAgentCapabilityBindingResponseSchema,
      create(UpsertAgentCapabilityBindingResponseSchema, { binding }),
    ));
    resolveProto(toBinary(
      DeleteAgentCapabilityBindingResponseSchema,
      create(DeleteAgentCapabilityBindingResponseSchema, { binding }),
    ));

    await api.upsertAgentCapabilityBinding({
      bindingId: binding.bindingId,
      agentId: binding.agentId,
      capabilityId: binding.capabilityId,
      capabilityVersion: binding.capabilityVersion,
      enabled: binding.enabled,
      approvalPolicy: binding.approvalPolicy,
      expectedAgentVersion: binding.expectedAgentVersion,
    }, 4n, 'upsert-key');
    await api.deleteAgentCapabilityBinding(
      binding.bindingId,
      binding.revision,
      'delete-key',
      'retired',
    );

    expect(invoke).toHaveBeenNthCalledWith(1, 'agent_capability_binding_upsert', {
      input: {
        binding: {
          bindingId: 'binding-1',
          agentId: 'agent-1',
          capabilityId: 'filesystem.read',
          capabilityVersion: '1',
          enabled: true,
          approvalPolicy: 1,
          expectedAgentVersion: 7,
        },
        expectedBindingRevision: 4,
        idempotencyKey: 'upsert-key',
      },
    });
    expect(invoke).toHaveBeenNthCalledWith(2, 'agent_capability_binding_delete', {
      input: {
        bindingId: 'binding-1',
        expectedBindingRevision: 4,
        idempotencyKey: 'delete-key',
        reason: 'retired',
      },
    });
  });

  it('encodes generated Knowledge descriptor CRUD requests and responses', async () => {
    const descriptor = create(KnowledgeResourceDescriptorSchema, {
      resourceId: 'knowledge-1',
      ptid: 'ptid:actor-1',
      revision: 2n,
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      title: 'Architecture notes',
    });
    const createRequest = create(CreateKnowledgeResourceDescriptorRequestSchema, {
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      source: { case: 'stationContent', value: new Uint8Array([1, 2, 3]) },
      idempotencyKey: 'create-1',
      title: descriptor.title,
    });
    const updateRequest = create(UpdateKnowledgeResourceDescriptorRequestSchema, {
      resourceId: descriptor.resourceId,
      expectedRevision: 1n,
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      source: { case: 'stationContent', value: new Uint8Array([4, 5, 6]) },
      idempotencyKey: 'update-1',
      title: descriptor.title,
    });
    const listRequest = create(ListKnowledgeResourceDescriptorsRequestSchema, {
      pageSize: 100,
    });
    const tombstoneRequest = create(
      TombstoneKnowledgeResourceDescriptorRequestSchema,
      {
        resourceId: descriptor.resourceId,
        expectedRevision: descriptor.revision,
        idempotencyKey: 'tombstone-1',
        reason: 'retired',
      },
    );

    resolveProto(toBinary(
      CreateKnowledgeResourceDescriptorResponseSchema,
      create(CreateKnowledgeResourceDescriptorResponseSchema, { descriptor }),
    ));
    resolveProto(toBinary(
      UpdateKnowledgeResourceDescriptorResponseSchema,
      create(UpdateKnowledgeResourceDescriptorResponseSchema, { descriptor }),
    ));
    resolveProto(toBinary(
      ListKnowledgeResourceDescriptorsResponseSchema,
      create(ListKnowledgeResourceDescriptorsResponseSchema, {
        descriptors: [descriptor],
      }),
    ));
    resolveProto(toBinary(
      TombstoneKnowledgeResourceDescriptorResponseSchema,
      create(TombstoneKnowledgeResourceDescriptorResponseSchema, { descriptor }),
    ));

    expect((await api.createKnowledgeResourceDescriptor(createRequest))
      .descriptor?.resourceId).toBe(descriptor.resourceId);
    expect((await api.updateKnowledgeResourceDescriptor(updateRequest))
      .descriptor?.revision).toBe(2n);
    expect((await api.listKnowledgeResourceDescriptors(listRequest))
      .descriptors).toEqual([descriptor]);
    expect((await api.tombstoneKnowledgeResourceDescriptor(tombstoneRequest))
      .descriptor?.resourceId).toBe(descriptor.resourceId);

    expect(fromBinary(
      CreateKnowledgeResourceDescriptorRequestSchema,
      requestBytesAt(0),
    )).toEqual(createRequest);
    expect(fromBinary(
      UpdateKnowledgeResourceDescriptorRequestSchema,
      requestBytesAt(1),
    )).toEqual(updateRequest);
    expect(fromBinary(
      ListKnowledgeResourceDescriptorsRequestSchema,
      requestBytesAt(2),
    )).toEqual(listRequest);
    expect(fromBinary(
      TombstoneKnowledgeResourceDescriptorRequestSchema,
      requestBytesAt(3),
    )).toEqual(tombstoneRequest);
  });
});
