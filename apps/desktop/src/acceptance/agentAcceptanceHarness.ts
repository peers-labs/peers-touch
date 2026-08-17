import { api, parseAgentChatConfig, type Agent } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import { useAgentConnectorStore } from '../store/agentConnectors';
import { useMentionStore } from '../store/mentions';
import { usePortalStore } from '../store/portal';

interface AgentFixture {
  source: Agent;
  target: Agent;
  sendReady: boolean;
}

const FIXTURE_PREFIX = 'acceptance-agent-';
const CLI_PROVIDER_ID = 'claude-cli';
const CLI_PROVIDER_FIXTURE_URL = 'acceptance://agent-phase2-native';
const createdAgentIds = new Set<string>();
let createdCliProvider = false;

declare global {
  interface Window {
    __PT_AGENT_ACCEPTANCE__?: {
      ensureFixture(): Promise<AgentFixture>;
      activateAgent(name: string, surface: 'chat' | 'profile'): Promise<void>;
      knowledgeBindings(agentId: string): ReturnType<typeof api.listAgentKnowledgeBindings>;
      connectorSnapshot(agentId: string): Promise<{
        available: ReturnType<typeof useAgentConnectorStore.getState>['availableConnectors'];
        configured: ReturnType<typeof parseAgentChatConfig>['connectors'];
      }>;
      conversationSnapshot(agentId: string): Promise<{
        conversations: Awaited<ReturnType<typeof api.listAgentConversations>>;
        messagesByConversation: Record<string, Awaited<ReturnType<typeof api.listAgentConversationMessages>>>;
      }>;
      mentionSnapshot(): ReturnType<typeof useMentionStore.getState>;
      portalSnapshot(): Pick<ReturnType<typeof usePortalStore.getState>, 'activeView' | 'expanded' | 'portalStack'>;
      cleanupFixture(): Promise<{ deletedAgentIds: string[] }>;
    };
  }
}

async function ensureAgent(
  role: 'source' | 'target',
  provider: string,
  model: string,
): Promise<Agent> {
  const store = useAgentStore.getState();
  const existing = store.agents.find((agent) => agent.name.startsWith(`${FIXTURE_PREFIX}${role}-`));
  if (existing) {
    createdAgentIds.add(existing.id);
    return existing;
  }

  const suffix = Date.now().toString(36);
  const agent = await store.createAgent({
    name: `${FIXTURE_PREFIX}${role}-${suffix}`,
    title: `Acceptance ${role}`,
    description: `Disposable ${role} Agent fixture`,
    provider,
    model,
    visibility: 'private',
    workspaceMode: 'agent',
  });
  createdAgentIds.add(agent.id);
  return agent;
}

export function installAgentAcceptanceHarness(): void {
  if (window.__PT_AGENT_ACCEPTANCE__) return;

  window.__PT_AGENT_ACCEPTANCE__ = {
    async ensureFixture() {
      const store = useAgentStore.getState();
      const providers = await api.listProviders();
      const cliProvider = providers.find((provider) => provider.id === CLI_PROVIDER_ID);
      if (!cliProvider?.enabled) {
        await api.createProvider({
          id: CLI_PROVIDER_ID,
          name: CLI_PROVIDER_ID,
          base_url: CLI_PROVIDER_FIXTURE_URL,
        });
        createdCliProvider = true;
      } else {
        const detail = await api.getProvider(CLI_PROVIDER_ID);
        createdCliProvider = detail.base_url === CLI_PROVIDER_FIXTURE_URL;
      }
      await Promise.all([store.loadModels(), store.loadAgents()]);
      const executableModel = useAgentStore
        .getState()
        .availableModels.find(
          (model) => model.enabled && model.provider_id === CLI_PROVIDER_ID,
        );
      const provider = executableModel?.provider_id ?? '';
      const model = executableModel?.id ?? '';
      const source = await ensureAgent('source', provider, model);
      const target = await ensureAgent('target', provider, model);
      await useAgentStore.getState().loadAgents();
      return {
        source,
        target,
        sendReady: Boolean(provider && model),
      };
    },

    async activateAgent(name, surface) {
      const store = useAgentStore.getState();
      if (!store.agents.some((agent) => agent.name === name)) {
        await store.loadAgents();
      }
      useAgentStore.getState().setSelectedAgent(name);
      useAgentStore.getState().setAgentSurface(name, surface);
      window.location.hash = '#/agent';
    },

    knowledgeBindings(agentId) {
      return api.listAgentKnowledgeBindings(agentId);
    },

    async connectorSnapshot(agentId) {
      await useAgentConnectorStore.getState().loadConnectors();
      const agent = useAgentStore.getState().agents.find((item) => item.id === agentId);
      return {
        available: useAgentConnectorStore.getState().availableConnectors,
        configured: agent ? parseAgentChatConfig(agent).connectors ?? [] : [],
      };
    },

    async conversationSnapshot(agentId) {
      const agent = useAgentStore
        .getState()
        .agents.find((item) => item.id === agentId || item.name === agentId);
      const conversationAgentId = agent?.name ?? agentId;
      const conversations = await api.listAgentConversations(conversationAgentId, {
        page: 1,
        pageSize: 100,
      });
      const messagesByConversation: Record<
        string,
        Awaited<ReturnType<typeof api.listAgentConversationMessages>>
      > = {};
      for (const conversation of conversations) {
        messagesByConversation[conversation.conversation_id] = await api.listAgentConversationMessages({
          conversation_id: conversation.conversation_id,
          limit: 100,
        });
      }
      return { conversations, messagesByConversation };
    },

    mentionSnapshot() {
      return useMentionStore.getState();
    },

    portalSnapshot() {
      const { activeView, expanded, portalStack } = usePortalStore.getState();
      return { activeView, expanded, portalStack };
    },

    async cleanupFixture() {
      const deletedAgentIds: string[] = [];
      for (const agentId of createdAgentIds) {
        const bindings = await api.listAgentKnowledgeBindings(agentId);
        for (const binding of bindings) {
          await api.deleteAgentKnowledgeBinding(binding.id);
        }
        await api.deleteAgent(agentId);
        deletedAgentIds.push(agentId);
      }
      createdAgentIds.clear();
      if (createdCliProvider) {
        await api.deleteProvider(CLI_PROVIDER_ID);
        createdCliProvider = false;
      }
      await useAgentStore.getState().loadAgents();
      return { deletedAgentIds };
    },
  };
}
