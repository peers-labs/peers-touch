import { create } from '@bufbuild/protobuf';

import {
  CreateKnowledgeResourceDescriptorRequestSchema,
  KnowledgeResourceKind,
  ReadKnowledgeResourceContentRequestSchema,
  TombstoneKnowledgeResourceDescriptorRequestSchema,
  UpdateKnowledgeResourceDescriptorRequestSchema,
  type KnowledgeResourceDescriptor,
} from '../gen/proto/domain/agent/capability_pb';
import { api } from './desktop_api';
import { useAgentCapabilityStore } from '../store/agentCapabilities';

export interface KnowledgeContentResult {
  descriptor: KnowledgeResourceDescriptor;
  content: string;
}

function newKnowledgeIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `knowledge-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const knowledgeService = {
  async list() {
    await useAgentCapabilityStore.getState().loadKnowledgeDescriptors();
    return useAgentCapabilityStore.getState().knowledgeDescriptors;
  },

  createDocument(title: string, content: string) {
    const request = create(CreateKnowledgeResourceDescriptorRequestSchema, {
      title: title.trim(),
      resourceKind: KnowledgeResourceKind.DOCUMENT,
      idempotencyKey: newKnowledgeIdempotencyKey(),
      source: { case: 'stationContent', value: new TextEncoder().encode(content) },
    });
    return useAgentCapabilityStore.getState().createKnowledgeDescriptor(request);
  },

  updateDocument(descriptor: KnowledgeResourceDescriptor, title: string, content: string) {
    const request = create(UpdateKnowledgeResourceDescriptorRequestSchema, {
      resourceId: descriptor.resourceId,
      expectedRevision: descriptor.revision,
      title: title.trim(),
      resourceKind: descriptor.resourceKind,
      idempotencyKey: newKnowledgeIdempotencyKey(),
      source: { case: 'stationContent', value: new TextEncoder().encode(content) },
    });
    return useAgentCapabilityStore.getState().updateKnowledgeDescriptor(request);
  },

  async readContent(descriptor: KnowledgeResourceDescriptor): Promise<KnowledgeContentResult> {
    const response = await api.readKnowledgeResourceContent(
      create(ReadKnowledgeResourceContentRequestSchema, {
        resourceId: descriptor.resourceId,
        revision: descriptor.revision,
      }),
    );
    if (!response.descriptor) throw new Error('agent.knowledgeDescriptorResponseMissing');
    return {
      descriptor: response.descriptor,
      content: new TextDecoder().decode(response.content),
    };
  },

  tombstone(descriptor: KnowledgeResourceDescriptor, reason: string) {
    const request = create(TombstoneKnowledgeResourceDescriptorRequestSchema, {
      resourceId: descriptor.resourceId,
      expectedRevision: descriptor.revision,
      idempotencyKey: newKnowledgeIdempotencyKey(),
      reason,
    });
    return useAgentCapabilityStore.getState().tombstoneKnowledgeDescriptor(request);
  },
};
