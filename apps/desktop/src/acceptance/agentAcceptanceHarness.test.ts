import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AgentCapabilityBindingSchema,
  CapabilityApprovalPolicy,
  CapabilityManifestSchema,
  CapabilitySourceKind,
} from '../gen/proto/domain/agent/capability_pb';

const mocks = vi.hoisted(() => ({
  api: {
    createProvider: vi.fn(),
    deleteAgent: vi.fn(),
    deleteAgentCapabilityBinding: vi.fn(),
    deleteProvider: vi.fn(),
    getProvider: vi.fn(),
    listAgentCapabilityBindings: vi.fn(),
    listAgentConversationMessages: vi.fn(),
    listAgentConversations: vi.fn(),
    listCapabilityManifests: vi.fn(),
    listProviders: vi.fn(),
  },
  agentState: {
    agents: [] as Array<{
      id: string;
      name: string;
      title: string;
    }>,
    availableModels: [] as Array<{
      id: string;
      provider_id: string;
      enabled: boolean;
    }>,
    createAgent: vi.fn(),
    loadAgents: vi.fn(),
    loadModels: vi.fn(),
    setAgentSurface: vi.fn(),
    setSelectedAgent: vi.fn(),
  },
  connectorState: {
    availableConnectors: [] as Array<{
      id: string;
      name: string;
      type: 'oauth';
      provider: string;
      status: 'connected';
    }>,
    loadConnectors: vi.fn(),
  },
}));

vi.mock('../services/desktop_api', () => ({ api: mocks.api }));
vi.mock('../store/agent', () => ({
  useAgentStore: { getState: () => mocks.agentState },
}));
vi.mock('../store/agentConnectors', () => ({
  useAgentConnectorStore: { getState: () => mocks.connectorState },
}));
vi.mock('../store/mentions', () => ({
  useMentionStore: { getState: () => ({ mentionedAgentIds: [] }) },
}));
vi.mock('../store/portal', () => ({
  usePortalStore: {
    getState: () => ({ activeView: null, expanded: false, portalStack: [] }),
  },
}));

import { installAgentAcceptanceHarness } from './agentAcceptanceHarness';

const knowledgeManifest = create(CapabilityManifestSchema, {
  capabilityId: 'knowledge:resource-1',
  version: 'legacy-v1',
  sourceKind: CapabilitySourceKind.KNOWLEDGE,
  sourceInstanceId: 'resource-1',
});
const connectorManifest = create(CapabilityManifestSchema, {
  capabilityId: 'connector:github',
  version: 'legacy-v1',
  sourceKind: CapabilitySourceKind.CONNECTOR,
  sourceInstanceId: 'github',
});
const knowledgeBinding = create(AgentCapabilityBindingSchema, {
  bindingId: 'binding-knowledge',
  agentId: 'agent-1',
  capabilityId: knowledgeManifest.capabilityId,
  capabilityVersion: knowledgeManifest.version,
  enabled: true,
  approvalPolicy: CapabilityApprovalPolicy.MANUAL,
  revision: 3n,
});
const connectorBinding = create(AgentCapabilityBindingSchema, {
  bindingId: 'binding-connector',
  agentId: 'agent-1',
  capabilityId: connectorManifest.capabilityId,
  capabilityVersion: connectorManifest.version,
  enabled: true,
  approvalPolicy: CapabilityApprovalPolicy.MANUAL,
  revision: 4n,
});

function acceptanceHarness() {
  const harness = window.__PT_AGENT_ACCEPTANCE__;
  if (!harness) throw new Error('agent.acceptanceHarnessMissing');
  return harness;
}

describe('Agent acceptance harness capability authority', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('window', { location: { hash: '' } });
    mocks.agentState.agents = [];
    mocks.agentState.availableModels = [];
    mocks.connectorState.availableConnectors = [{
      id: 'github',
      name: 'GitHub',
      type: 'oauth',
      provider: 'github',
      status: 'connected',
    }];
    mocks.api.listAgentCapabilityBindings.mockResolvedValue([
      knowledgeBinding,
      connectorBinding,
    ]);
    mocks.api.listCapabilityManifests.mockResolvedValue([
      knowledgeManifest,
      connectorManifest,
    ]);
    mocks.api.deleteAgentCapabilityBinding.mockResolvedValue(knowledgeBinding);
    mocks.api.deleteAgent.mockResolvedValue(undefined);
    mocks.api.listProviders.mockResolvedValue([{ id: 'claude-cli', enabled: true }]);
    mocks.api.getProvider.mockResolvedValue({
      id: 'claude-cli',
      base_url: 'configured://provider',
    });
    mocks.agentState.loadAgents.mockResolvedValue(undefined);
    mocks.agentState.loadModels.mockResolvedValue(undefined);
    mocks.connectorState.loadConnectors.mockResolvedValue(undefined);
    installAgentAcceptanceHarness();
  });

  it('projects Knowledge bindings only through source-kind manifests', async () => {
    const bindings = await acceptanceHarness().knowledgeBindings('agent-1');

    expect(mocks.api.listAgentCapabilityBindings).toHaveBeenCalledWith('agent-1');
    expect(mocks.api.listCapabilityManifests).toHaveBeenCalledWith([
      CapabilitySourceKind.KNOWLEDGE,
    ]);
    expect(bindings).toEqual([{
      bindingId: 'binding-knowledge',
      capabilityId: 'knowledge:resource-1',
      capabilityVersion: 'legacy-v1',
      resourceId: 'resource-1',
      policy: 'manual',
      enabled: true,
      revision: '3',
    }]);
  });

  it('projects configured Connectors from canonical bindings instead of Agent config', async () => {
    const snapshot = await acceptanceHarness().connectorSnapshot('agent-1');

    expect(mocks.connectorState.loadConnectors).toHaveBeenCalledOnce();
    expect(mocks.api.listCapabilityManifests).toHaveBeenCalledWith([
      CapabilitySourceKind.CONNECTOR,
    ]);
    expect(snapshot).toEqual({
      available: mocks.connectorState.availableConnectors,
      configured: [{
        bindingId: 'binding-connector',
        capabilityId: 'connector:github',
        capabilityVersion: 'legacy-v1',
        connectorId: 'github',
        enabled: true,
        revision: '4',
      }],
    });
  });

  it('deletes every canonical capability binding before deleting fixture Agents', async () => {
    mocks.agentState.agents = [
      {
        id: 'agent-source',
        name: 'acceptance-agent-source-existing',
        title: 'Source',
      },
      {
        id: 'agent-target',
        name: 'acceptance-agent-target-existing',
        title: 'Target',
      },
    ];

    await acceptanceHarness().ensureFixture();
    const cleanup = await acceptanceHarness().cleanupFixture();

    expect(mocks.api.deleteAgentCapabilityBinding).toHaveBeenCalledTimes(4);
    expect(mocks.api.deleteAgentCapabilityBinding).toHaveBeenCalledWith(
      'binding-knowledge',
      3n,
      expect.any(String),
      'acceptance_fixture_cleanup',
    );
    expect(mocks.api.deleteAgentCapabilityBinding).toHaveBeenCalledWith(
      'binding-connector',
      4n,
      expect.any(String),
      'acceptance_fixture_cleanup',
    );
    expect(mocks.api.deleteAgent).toHaveBeenNthCalledWith(1, 'agent-source');
    expect(mocks.api.deleteAgent).toHaveBeenNthCalledWith(2, 'agent-target');
    expect(cleanup).toEqual({
      deletedAgentIds: ['agent-source', 'agent-target'],
    });
  });
});
