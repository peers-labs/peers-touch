import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentCapabilityBindingSchema,
  CapabilityApprovalPolicy,
  CapabilityManifestSchema,
  CapabilitySourceKind,
  ConnectorResourceManifestSchema,
  ConnectorResourceStatus,
} from '../gen/proto/domain/agent/capability_pb';

const connectorManifest = create(CapabilityManifestSchema, {
  capabilityId: 'connector.search',
  version: '2',
  sourceKind: CapabilitySourceKind.CONNECTOR,
  sourceInstanceId: 'connector_resource_1234567890abcdef12345678',
  defaultApprovalPolicy: CapabilityApprovalPolicy.MANUAL,
});

const connectorResource = create(ConnectorResourceManifestSchema, {
  connectorId: 'search-provider',
  oauthConnectionId: 'oauth-connection-1',
  connectionRevision: 2n,
  resourceId: 'connection.status',
  resourceVersion: 'connection-status',
  status: ConnectorResourceStatus.READY,
  toolManifests: [{
    capabilityId: connectorManifest.capabilityId,
    capabilityVersion: connectorManifest.version,
  }],
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

const connectorApi = vi.hoisted(() => ({
  syncOAuthConnectorManifests: vi.fn(),
  listConnectorResourceManifests: vi.fn(),
}));

const oauthState = vi.hoisted(() => ({
  providers: [] as OAuth2ProviderSummary[],
  connections: [] as OAuth2Connection[],
  loadAll: vi.fn(),
  loadConnections: vi.fn(),
  startAuth: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: connectorApi,
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
    getState: () => oauthState,
  },
}));

import { useAgentConnectorStore } from './agentConnectors';
import type { OAuth2Connection, OAuth2ProviderSummary } from '../services/desktop_api';

describe('agent connector capability bindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilityState.manifests = [connectorManifest];
    capabilityState.bindingsByAgentId = {};
    capabilityState.loadCatalog.mockImplementation(
      async () => capabilityState.manifests,
    );
    capabilityState.upsertBinding.mockResolvedValue(connectorBinding);
    capabilityState.deleteBinding.mockResolvedValue(connectorBinding);
    oauthState.providers = [];
    oauthState.connections = [];
    oauthState.loadAll.mockResolvedValue(undefined);
    oauthState.loadConnections.mockResolvedValue(undefined);
    connectorApi.syncOAuthConnectorManifests.mockResolvedValue([]);
    connectorApi.listConnectorResourceManifests.mockResolvedValue([]);
    useAgentConnectorStore.setState({
      availableConnectors: [],
      resourceManifests: [connectorResource],
      loading: false,
    });
  });

  it('shares one in-flight Connector projection load across concurrent callers', async () => {
    let finishSync: (() => void) | undefined;
    connectorApi.syncOAuthConnectorManifests.mockImplementation(
      () => new Promise<void>((resolve) => {
        finishSync = resolve;
      }),
    );

    const first = useAgentConnectorStore.getState().loadConnectors();
    const second = useAgentConnectorStore.getState().loadConnectors();

    await vi.waitFor(() => {
      expect(connectorApi.syncOAuthConnectorManifests).toHaveBeenCalledOnce();
    });
    finishSync?.();
    await Promise.all([first, second]);

    expect(oauthState.loadAll).toHaveBeenCalledOnce();
    expect(oauthState.loadConnections).toHaveBeenCalledOnce();
    expect(connectorApi.listConnectorResourceManifests).toHaveBeenCalledOnce();
  });

  it('runs a trailing refresh for a request made during an active load', async () => {
    let finishFirstSync: (() => void) | undefined;
    connectorApi.syncOAuthConnectorManifests
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          finishFirstSync = resolve;
        }),
      )
      .mockResolvedValueOnce([]);

    const first = useAgentConnectorStore.getState().loadConnectors();
    await vi.waitFor(() => {
      expect(connectorApi.syncOAuthConnectorManifests).toHaveBeenCalledOnce();
    });
    const second = useAgentConnectorStore.getState().loadConnectors();
    finishFirstSync?.();
    await Promise.all([first, second]);

    expect(connectorApi.syncOAuthConnectorManifests).toHaveBeenCalledTimes(2);
    expect(connectorApi.listConnectorResourceManifests).toHaveBeenCalledTimes(2);
  });

  it('allows a Connector projection load to retry after failure', async () => {
    connectorApi.syncOAuthConnectorManifests
      .mockRejectedValueOnce(new Error('revision conflict'))
      .mockResolvedValueOnce([]);

    await expect(
      useAgentConnectorStore.getState().loadConnectors(),
    ).rejects.toThrow('revision conflict');
    await expect(
      useAgentConnectorStore.getState().loadConnectors(),
    ).resolves.toBeUndefined();

    expect(connectorApi.syncOAuthConnectorManifests).toHaveBeenCalledTimes(2);
    expect(useAgentConnectorStore.getState().loading).toBe(false);
  });

  it('binds the CONNECTOR manifest referenced by the resource projection', async () => {
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

  it('binds against the fetched catalog snapshot when the store projection is stale', async () => {
    capabilityState.manifests = [];
    capabilityState.loadCatalog.mockResolvedValueOnce([connectorManifest]);

    await useAgentConnectorStore
      .getState()
      .bindConnector('agent-1', 'search-provider');

    expect(capabilityState.upsertBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: connectorManifest.capabilityId,
        capabilityVersion: connectorManifest.version,
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

  it('binds every ready resource manifest for one Connector', async () => {
    const profileManifest = create(CapabilityManifestSchema, {
      capabilityId: 'connector.profile',
      version: '3',
      sourceKind: CapabilitySourceKind.CONNECTOR,
      sourceInstanceId: 'connector_resource_abcdef1234567890abcdef12',
      defaultApprovalPolicy: CapabilityApprovalPolicy.MANUAL,
    });
    const profileResource = create(ConnectorResourceManifestSchema, {
      connectorId: 'search-provider',
      oauthConnectionId: 'oauth-connection-1',
      connectionRevision: 2n,
      resourceId: 'connection.profile',
      resourceVersion: 'connection-profile',
      status: ConnectorResourceStatus.READY,
      toolManifests: [{
        capabilityId: profileManifest.capabilityId,
        capabilityVersion: profileManifest.version,
      }],
    });
    capabilityState.manifests = [connectorManifest, profileManifest];
    useAgentConnectorStore.setState({
      resourceManifests: [connectorResource, profileResource],
    });

    await useAgentConnectorStore
      .getState()
      .bindConnector('agent-1', 'search-provider');

    expect(capabilityState.upsertBinding).toHaveBeenCalledTimes(2);
    expect(capabilityState.upsertBinding).toHaveBeenCalledWith(
      expect.objectContaining({
        capabilityId: 'connector.profile',
        capabilityVersion: '3',
      }),
    );
  });
});
