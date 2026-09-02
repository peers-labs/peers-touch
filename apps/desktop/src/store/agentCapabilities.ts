import { create } from '@bufbuild/protobuf';

import type {
  AgentCapabilityBinding,
  CapabilityManifest,
  CapabilityReadiness,
  CapabilityReadinessSnapshot,
  CapabilityApprovalPolicy,
  CapabilitySourceKind,
  CreateKnowledgeResourceDescriptorRequest,
  KnowledgeResourceDescriptor,
  TombstoneKnowledgeResourceDescriptorRequest,
  UpdateKnowledgeResourceDescriptorRequest,
} from '../gen/proto/domain/agent/capability_pb';
import {
  ListKnowledgeResourceDescriptorsRequestSchema,
} from '../gen/proto/domain/agent/capability_pb';
import { api } from '../services/desktop_api';
import { log } from '../utils/logger';
import { createDesktopStore } from './createDesktopStore';
import {
  beginMutation,
  endMutation,
  toStoreError,
  type RevalidationState,
} from './revalidation';

export interface AgentCapabilityReadinessInput {
  runtimeSnapshotId?: string;
  clientCapabilitySessionId?: string;
}

export interface UpsertAgentCapabilityBindingIntent
  extends AgentCapabilityReadinessInput {
  bindingId?: string;
  agentId: string;
  capabilityId: string;
  capabilityVersion: string;
  enabled: boolean;
  approvalPolicy: CapabilityApprovalPolicy;
  expectedAgentVersion: number | bigint;
  expectedBindingRevision: number | bigint;
  idempotencyKey: string;
}

export interface DeleteAgentCapabilityBindingIntent
  extends AgentCapabilityReadinessInput {
  agentId: string;
  bindingId: string;
  expectedBindingRevision: number | bigint;
  idempotencyKey: string;
  reason: string;
}

export interface AgentCapabilityState extends RevalidationState {
  manifests: CapabilityManifest[];
  knowledgeDescriptors: KnowledgeResourceDescriptor[];
  bindingsByAgentId: Record<string, AgentCapabilityBinding[]>;
  readinessByAgentId: Record<string, CapabilityReadinessSnapshot | undefined>;
  readinessInputByAgentId: Record<string, AgentCapabilityReadinessInput>;
  loadingCatalog: boolean;
  loadingKnowledgeDescriptors: boolean;
  loadingAgentIds: Record<string, true>;
  loadCatalog: (sourceKinds?: readonly CapabilitySourceKind[]) => Promise<void>;
  loadKnowledgeDescriptors: () => Promise<void>;
  loadAgent: (
    agentId: string,
    readinessInput?: AgentCapabilityReadinessInput,
  ) => Promise<void>;
  upsertBinding: (
    intent: UpsertAgentCapabilityBindingIntent,
  ) => Promise<AgentCapabilityBinding>;
  deleteBinding: (
    intent: DeleteAgentCapabilityBindingIntent,
  ) => Promise<AgentCapabilityBinding>;
  createKnowledgeDescriptor: (
    request: CreateKnowledgeResourceDescriptorRequest,
  ) => Promise<KnowledgeResourceDescriptor>;
  updateKnowledgeDescriptor: (
    request: UpdateKnowledgeResourceDescriptorRequest,
  ) => Promise<KnowledgeResourceDescriptor>;
  tombstoneKnowledgeDescriptor: (
    request: TombstoneKnowledgeResourceDescriptorRequest,
  ) => Promise<KnowledgeResourceDescriptor>;
  reset: () => void;
}

const KNOWLEDGE_DESCRIPTOR_PAGE_SIZE = 100;
const MAX_KNOWLEDGE_DESCRIPTOR_PAGES = 100;

let projectionEpoch = 0;
let catalogLoadSequence = 0;
let knowledgeDescriptorLoadSequence = 0;
const agentLoadSequences = new Map<string, number>();

function nextAgentLoadSequence(agentId: string): number {
  const sequence = (agentLoadSequences.get(agentId) ?? 0) + 1;
  agentLoadSequences.set(agentId, sequence);
  return sequence;
}

function isCurrentAgentLoad(
  agentId: string,
  sequence: number,
  epoch: number,
): boolean {
  return projectionEpoch === epoch && agentLoadSequences.get(agentId) === sequence;
}

function requireIntentValue(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`agent.capabilityMutationFieldRequired:${field}`);
  }
}

async function reconcileKnowledgeProjection(
  state: AgentCapabilityState,
): Promise<void> {
  await Promise.all([
    state.loadCatalog(),
    state.loadKnowledgeDescriptors(),
  ]);
}

export const useAgentCapabilityStore = createDesktopStore<AgentCapabilityState>(
  'agentCapabilities',
  (set, get) => ({
    manifests: [],
    knowledgeDescriptors: [],
    bindingsByAgentId: {},
    readinessByAgentId: {},
    readinessInputByAgentId: {},
    loadingCatalog: false,
    loadingKnowledgeDescriptors: false,
    loadingAgentIds: {},
    loading: false,
    error: null,
    lastLoadedAt: null,
    pendingMutations: {},

    loadCatalog: async (sourceKinds = []) => {
      const epoch = projectionEpoch;
      const sequence = ++catalogLoadSequence;
      set({ loadingCatalog: true, loading: true, error: null });
      try {
        const manifests = await api.listCapabilityManifests(sourceKinds);
        if (epoch !== projectionEpoch || sequence !== catalogLoadSequence) return;
        set({ manifests, lastLoadedAt: Date.now() });
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to load capability catalog', {
          error: message,
        });
        if (epoch === projectionEpoch && sequence === catalogLoadSequence) {
          set({ error: message });
        }
        throw error;
      } finally {
        if (epoch === projectionEpoch && sequence === catalogLoadSequence) {
          set((state) => ({
            loadingCatalog: false,
            loading:
              state.loadingKnowledgeDescriptors
              || Object.keys(state.loadingAgentIds).length > 0,
          }));
        }
      }
    },

    loadKnowledgeDescriptors: async () => {
      const epoch = projectionEpoch;
      const sequence = ++knowledgeDescriptorLoadSequence;
      set({ loadingKnowledgeDescriptors: true, loading: true, error: null });
      try {
        const descriptors: KnowledgeResourceDescriptor[] = [];
        const seenCursors = new Set<string>();
        let cursor = '';
        for (let page = 0; page < MAX_KNOWLEDGE_DESCRIPTOR_PAGES; page += 1) {
          const response = await api.listKnowledgeResourceDescriptors(create(
            ListKnowledgeResourceDescriptorsRequestSchema,
            {
              includeTombstoned: false,
              cursor,
              pageSize: KNOWLEDGE_DESCRIPTOR_PAGE_SIZE,
            },
          ));
          descriptors.push(...response.descriptors);
          if (!response.nextCursor) break;
          if (seenCursors.has(response.nextCursor)) {
            throw new Error('agent.knowledgeDescriptorCursorRepeated');
          }
          seenCursors.add(response.nextCursor);
          cursor = response.nextCursor;
          if (page === MAX_KNOWLEDGE_DESCRIPTOR_PAGES - 1) {
            throw new Error('agent.knowledgeDescriptorPageLimitExceeded');
          }
        }
        if (
          epoch !== projectionEpoch
          || sequence !== knowledgeDescriptorLoadSequence
        ) return;
        set({ knowledgeDescriptors: descriptors, lastLoadedAt: Date.now() });
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to load Knowledge descriptors', {
          error: message,
        });
        if (
          epoch === projectionEpoch
          && sequence === knowledgeDescriptorLoadSequence
        ) {
          set({ error: message });
        }
        throw error;
      } finally {
        if (
          epoch === projectionEpoch
          && sequence === knowledgeDescriptorLoadSequence
        ) {
          set((state) => ({
            loadingKnowledgeDescriptors: false,
            loading:
              state.loadingCatalog
              || Object.keys(state.loadingAgentIds).length > 0,
          }));
        }
      }
    },

    loadAgent: async (agentId, readinessInput = {}) => {
      requireIntentValue(agentId, 'agentId');
      const previousInput = get().readinessInputByAgentId[agentId] ?? {};
      const effectiveInput = {
        runtimeSnapshotId:
          readinessInput.runtimeSnapshotId ?? previousInput.runtimeSnapshotId,
        clientCapabilitySessionId:
          readinessInput.clientCapabilitySessionId
          ?? previousInput.clientCapabilitySessionId,
      };
      const epoch = projectionEpoch;
      const sequence = nextAgentLoadSequence(agentId);
      set((state) => ({
        loading: true,
        error: null,
        loadingAgentIds: { ...state.loadingAgentIds, [agentId]: true },
        readinessInputByAgentId: {
          ...state.readinessInputByAgentId,
          [agentId]: effectiveInput,
        },
      }));
      try {
        const [bindings, readiness] = await Promise.all([
          api.listAgentCapabilityBindings(agentId),
          api.readAgentCapabilityReadiness({
            agent_id: agentId,
            runtime_snapshot_id: effectiveInput.runtimeSnapshotId,
            client_capability_session_id:
              effectiveInput.clientCapabilitySessionId,
          }),
        ]);
        if (!isCurrentAgentLoad(agentId, sequence, epoch)) return;
        set((state) => ({
          bindingsByAgentId: {
            ...state.bindingsByAgentId,
            [agentId]: bindings,
          },
          readinessByAgentId: {
            ...state.readinessByAgentId,
            [agentId]: readiness,
          },
          lastLoadedAt: Date.now(),
        }));
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to load Agent capability projection', {
          agentId,
          error: message,
        });
        if (isCurrentAgentLoad(agentId, sequence, epoch)) set({ error: message });
        throw error;
      } finally {
        if (isCurrentAgentLoad(agentId, sequence, epoch)) {
          set((state) => {
            const loadingAgentIds = { ...state.loadingAgentIds };
            delete loadingAgentIds[agentId];
            return {
              loadingAgentIds,
              loading:
                state.loadingCatalog
                || state.loadingKnowledgeDescriptors
                || Object.keys(loadingAgentIds).length > 0,
            };
          });
        }
      }
    },

    upsertBinding: async (intent) => {
      requireIntentValue(intent.agentId, 'agentId');
      requireIntentValue(intent.capabilityId, 'capabilityId');
      requireIntentValue(intent.capabilityVersion, 'capabilityVersion');
      requireIntentValue(intent.idempotencyKey, 'idempotencyKey');
      const epoch = projectionEpoch;
      const mutationKey = `upsert:${intent.agentId}:${intent.capabilityId}`;
      set((state) => ({
        error: null,
        pendingMutations: beginMutation(state.pendingMutations, mutationKey),
      }));
      try {
        const binding = await api.upsertAgentCapabilityBinding(
          {
            bindingId: intent.bindingId ?? '',
            agentId: intent.agentId,
            capabilityId: intent.capabilityId,
            capabilityVersion: intent.capabilityVersion,
            enabled: intent.enabled,
            approvalPolicy: intent.approvalPolicy,
            expectedAgentVersion: intent.expectedAgentVersion,
          },
          intent.expectedBindingRevision,
          intent.idempotencyKey,
        );
        if (epoch === projectionEpoch) {
          await get().loadAgent(intent.agentId, intent);
        }
        return binding;
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to upsert Agent capability binding', {
          agentId: intent.agentId,
          capabilityId: intent.capabilityId,
          error: message,
        });
        if (epoch === projectionEpoch) set({ error: message });
        throw error;
      } finally {
        if (epoch === projectionEpoch) {
          set((state) => ({
            pendingMutations: endMutation(state.pendingMutations, mutationKey),
          }));
        }
      }
    },

    deleteBinding: async (intent) => {
      requireIntentValue(intent.agentId, 'agentId');
      requireIntentValue(intent.bindingId, 'bindingId');
      requireIntentValue(intent.idempotencyKey, 'idempotencyKey');
      const epoch = projectionEpoch;
      const mutationKey = `delete:${intent.agentId}:${intent.bindingId}`;
      set((state) => ({
        error: null,
        pendingMutations: beginMutation(state.pendingMutations, mutationKey),
      }));
      try {
        const binding = await api.deleteAgentCapabilityBinding(
          intent.bindingId,
          intent.expectedBindingRevision,
          intent.idempotencyKey,
          intent.reason,
        );
        if (epoch === projectionEpoch) {
          await get().loadAgent(intent.agentId, intent);
        }
        return binding;
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to delete Agent capability binding', {
          agentId: intent.agentId,
          bindingId: intent.bindingId,
          error: message,
        });
        if (epoch === projectionEpoch) set({ error: message });
        throw error;
      } finally {
        if (epoch === projectionEpoch) {
          set((state) => ({
            pendingMutations: endMutation(state.pendingMutations, mutationKey),
          }));
        }
      }
    },

    createKnowledgeDescriptor: async (request) => {
      requireIntentValue(request.title, 'title');
      requireIntentValue(request.idempotencyKey, 'idempotencyKey');
      const epoch = projectionEpoch;
      const mutationKey = `knowledge:create:${request.idempotencyKey}`;
      set((state) => ({
        error: null,
        pendingMutations: beginMutation(state.pendingMutations, mutationKey),
      }));
      try {
        const response = await api.createKnowledgeResourceDescriptor(request);
        if (!response.descriptor) {
          throw new Error('agent.knowledgeDescriptorResponseMissing');
        }
        if (epoch === projectionEpoch) {
          await reconcileKnowledgeProjection(get());
        }
        return response.descriptor;
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to create Knowledge descriptor', {
          error: message,
        });
        if (epoch === projectionEpoch) set({ error: message });
        throw error;
      } finally {
        if (epoch === projectionEpoch) {
          set((state) => ({
            pendingMutations: endMutation(state.pendingMutations, mutationKey),
          }));
        }
      }
    },

    updateKnowledgeDescriptor: async (request) => {
      requireIntentValue(request.resourceId, 'resourceId');
      requireIntentValue(request.title, 'title');
      requireIntentValue(request.idempotencyKey, 'idempotencyKey');
      const epoch = projectionEpoch;
      const mutationKey = `knowledge:update:${request.resourceId}`;
      set((state) => ({
        error: null,
        pendingMutations: beginMutation(state.pendingMutations, mutationKey),
      }));
      try {
        const response = await api.updateKnowledgeResourceDescriptor(request);
        if (!response.descriptor) {
          throw new Error('agent.knowledgeDescriptorResponseMissing');
        }
        if (epoch === projectionEpoch) {
          await reconcileKnowledgeProjection(get());
        }
        return response.descriptor;
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to update Knowledge descriptor', {
          resourceId: request.resourceId,
          error: message,
        });
        if (epoch === projectionEpoch) set({ error: message });
        throw error;
      } finally {
        if (epoch === projectionEpoch) {
          set((state) => ({
            pendingMutations: endMutation(state.pendingMutations, mutationKey),
          }));
        }
      }
    },

    tombstoneKnowledgeDescriptor: async (request) => {
      requireIntentValue(request.resourceId, 'resourceId');
      requireIntentValue(request.idempotencyKey, 'idempotencyKey');
      const epoch = projectionEpoch;
      const mutationKey = `knowledge:tombstone:${request.resourceId}`;
      set((state) => ({
        error: null,
        pendingMutations: beginMutation(state.pendingMutations, mutationKey),
      }));
      try {
        const response = await api.tombstoneKnowledgeResourceDescriptor(request);
        if (!response.descriptor) {
          throw new Error('agent.knowledgeDescriptorResponseMissing');
        }
        if (epoch === projectionEpoch) {
          await reconcileKnowledgeProjection(get());
        }
        return response.descriptor;
      } catch (error) {
        const message = toStoreError(error);
        log.error('agentCapabilities', 'Failed to tombstone Knowledge descriptor', {
          resourceId: request.resourceId,
          error: message,
        });
        if (epoch === projectionEpoch) set({ error: message });
        throw error;
      } finally {
        if (epoch === projectionEpoch) {
          set((state) => ({
            pendingMutations: endMutation(state.pendingMutations, mutationKey),
          }));
        }
      }
    },

    reset: () => {
      projectionEpoch += 1;
      catalogLoadSequence += 1;
      knowledgeDescriptorLoadSequence += 1;
      agentLoadSequences.clear();
      set({
        manifests: [],
        knowledgeDescriptors: [],
        bindingsByAgentId: {},
        readinessByAgentId: {},
        readinessInputByAgentId: {},
        loadingCatalog: false,
        loadingKnowledgeDescriptors: false,
        loadingAgentIds: {},
        loading: false,
        error: null,
        lastLoadedAt: null,
        pendingMutations: {},
      });
    },
  }),
);

export const selectCapabilityManifests = (
  state: AgentCapabilityState,
): CapabilityManifest[] => state.manifests;

export const selectKnowledgeResourceDescriptors = (
  state: AgentCapabilityState,
): KnowledgeResourceDescriptor[] => state.knowledgeDescriptors;

export const selectAgentCapabilityBindings = (
  state: AgentCapabilityState,
  agentId: string,
): AgentCapabilityBinding[] => state.bindingsByAgentId[agentId] ?? [];

export const selectAgentCapabilityReadiness = (
  state: AgentCapabilityState,
  agentId: string,
): CapabilityReadinessSnapshot | undefined => state.readinessByAgentId[agentId];

export function selectCapabilityManifest(
  state: AgentCapabilityState,
  capabilityId: string,
  version: string,
): CapabilityManifest | undefined {
  return state.manifests.find(
    (manifest) =>
      manifest.capabilityId === capabilityId && manifest.version === version,
  );
}

export function selectCapabilityManifestBySource(
  state: AgentCapabilityState,
  sourceKind: CapabilitySourceKind,
  sourceInstanceId: string,
): CapabilityManifest | undefined {
  return selectCapabilityManifestsBySource(
    state,
    sourceKind,
    sourceInstanceId,
  )[0];
}

export function selectCapabilityManifestsBySource(
  state: AgentCapabilityState,
  sourceKind: CapabilitySourceKind,
  sourceInstanceId?: string,
): CapabilityManifest[] {
  return state.manifests.filter(
    (manifest) =>
      manifest.sourceKind === sourceKind
      && (
        sourceInstanceId === undefined
        || manifest.sourceInstanceId === sourceInstanceId
      ),
  );
}

export function selectAgentCapabilityBindingsBySource(
  state: AgentCapabilityState,
  agentId: string,
  sourceKind: CapabilitySourceKind,
): AgentCapabilityBinding[] {
  const manifestKeys = new Set(
    state.manifests
      .filter((manifest) => manifest.sourceKind === sourceKind)
      .map((manifest) => `${manifest.capabilityId}\u0000${manifest.version}`),
  );
  return selectAgentCapabilityBindings(state, agentId).filter(
    (binding) => manifestKeys.has(
      `${binding.capabilityId}\u0000${binding.capabilityVersion}`,
    ),
  );
}

export function selectAgentCapabilityReadinessBySource(
  state: AgentCapabilityState,
  agentId: string,
  sourceKind: CapabilitySourceKind,
): CapabilityReadiness[] {
  const snapshot = selectAgentCapabilityReadiness(state, agentId);
  if (!snapshot) return [];
  const manifestKeys = new Set(
    state.manifests
      .filter((manifest) => manifest.sourceKind === sourceKind)
      .map((manifest) => `${manifest.capabilityId}\u0000${manifest.version}`),
  );
  return snapshot.capabilities.filter(
    (readiness) => manifestKeys.has(
      `${readiness.capabilityId}\u0000${readiness.capabilityVersion}`,
    ),
  );
}
