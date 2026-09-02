import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentCapabilityBindingSchema,
  CapabilityApprovalPolicy,
  CapabilityManifestSchema,
  CapabilitySourceKind,
} from '../gen/proto/domain/agent/capability_pb';

const connectorManifest = create(CapabilityManifestSchema, {
  capabilityId: 'connector.search',
  version: '2',
  sourceKind: CapabilitySourceKind.CONNECTOR,
  sourceInstanceId: 'search-provider',
  defaultApprovalPolicy: CapabilityApprovalPolicy.MANUAL,
});

const connectorBinding = create(AgentCapabilityBindingSchema, {
  bindingId: 'binding-connector',
  agentId: 'agent-1',
  capabilityId: connectorManifest.capabilityId,
  capabilityVersion: connectorManifest.version,
  enabled: true,
  approvalPolicy: CapabilityApprovalPolicy.MANUAL,
  expectedAgentVersion: 8n,
  revision: 3n,
});

const capabilityState = vi.hoisted(() => ({
  manifests: [] as Array<{
    capabilityId: string;
    version: string;
    sourceKind: CapabilitySourceKind;
    sourceInstanceId: string;
    defaultApprovalPolicy: CapabilityApprovalPolicy;
  }>,
  bindingsByAgentId: {} as Record<string, typeof connectorBinding[]>,
  loadCatalog: vi.fn(),
  loadAgent: vi.fn(),
  upsertBinding: vi.fn(),
  deleteBinding: vi.fn(),
}));

vi.mock('./agentCapabilities', () => ({
  useAgentCapabilityStore: {
    getState: () => capabilityState,
  },
  selectCapabilityManifestBySource: (
    state: typeof capabilityState,
    sourceKind: CapabilitySourceKind,
    sourceInstanceId: string,
  ) => state.manifests.find(
    (manifest) =>
      manifest.sourceKind === sourceKind
      && manifest.sourceInstanceId === sourceInstanceId,
  ),
}));

vi.mock('./agent', () => ({
  useAgentStore: {
    getState: () => ({
      agents: [{ id: 'agent-1', version: 8 }],
    }),
  },
}));

vi.mock('./oauth2', () => ({
  useOAuth2Store: {
    getState: () => ({
      providers: [],
      connections: [],
      loadAll: vi.fn(),
      startAuth: vi.fn(),
    }),
  },
}));

import { useAgentConnectorStore } from './agentConnectors';

describe('agent connector capability bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilityState.manifests = [connectorManifest];
    capabilityState.bindingsByAgentId = {};
    capabilityState.upsertBinding.mockResolvedValue(connectorBinding);
    capabilityState.deleteBinding.mockResolvedValue(connectorBinding);
  });

  it('binds the CONNECTOR manifest selected by sourceInstanceId', async () => {
    await useAgentConnectorStore
      .getState()
      .bindConnector('agent-1', 'search-provider');

    expect(capabilityState.loadCatalog).toHaveBeenCalledWith();
    expect(capabilityState.loadAgent).toHaveBeenCalledWith('agent-1');
    expect(capabilityState.upsertBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        capabilityId: 'connector.search',
        capabilityVersion: '2',
        enabled: true,
        approvalPolicy: CapabilityApprovalPolicy.MANUAL,
        expectedAgentVersion: 8,
        expectedBindingRevision: 0n,
      }),
    );
  });

  it('deletes the canonical binding when unbinding', async () => {
    capabilityState.bindingsByAgentId = {
      'agent-1': [connectorBinding],
    };

    await useAgentConnectorStore
      .getState()
      .unbindConnector('agent-1', 'search-provider');

    expect(capabilityState.deleteBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'agent-1',
        bindingId: 'binding-connector',
        expectedBindingRevision: 3n,
        reason: 'connector_unbound',
      }),
    );
  });
});
