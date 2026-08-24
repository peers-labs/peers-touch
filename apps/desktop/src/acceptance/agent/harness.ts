import { identityRuntime } from '../../kernel/identityRuntime';
import { installDeferredAppRuntimeProjections } from '../../services/appRuntime';
import { api, parseAgentChatConfig } from '../../services/desktop_api';
import { useAgentStore } from '../../store/agent';
import { useChatStore } from '../../store/chat';
import { useProviderStore } from '../../store/provider';
import { useSessionStore } from '../../store/session';
import { registerAcceptanceHarness } from '../registry';

interface LoginInput {
  account: string;
  password: string;
}

interface SendMessageInput {
  content: string;
}

async function waitFor(
  predicate: () => boolean,
  description: string,
  timeoutMs = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`timed out waiting for: ${description}`);
}

export function installAcceptanceHarness(): void {
  registerAcceptanceHarness('agent', {
    async loginWithPassword({ account, password }: LoginInput) {
      await identityRuntime.loginWithPassword(account, password);
      await identityRuntime.completeCurrentSession();
      await waitFor(
        () => identityRuntime.getSnapshot().lifecycle.state === 'ready',
        'lifecycle ready after login',
        30_000,
      );
      await installDeferredAppRuntimeProjections();
      const user = useSessionStore.getState().currentUser;
      return {
        authenticated: Boolean(user?.actorId),
        actorId: user?.actorId ?? null,
      };
    },

    async navigateToAgent() {
      await waitFor(
        () => useAgentStore.getState().agents.length > 0,
        'agent list to load',
        30_000,
      );
      const agentState = useAgentStore.getState();
      if (!agentState.agents.some((a) => a.name === agentState.selectedAgent)) {
        const first = agentState.agents[0];
        if (first) agentState.setSelectedAgent(first.name);
      }
      window.history.pushState(null, '', '#/agent');
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await waitFor(
        () => Boolean(document.querySelector('[data-pt-agent-composer]')),
        'agent composer to appear',
        30_000,
      );
      return { navigated: true };
    },

    async ensureProvider({ providerId, apiKey, modelId, baseUrl }: { providerId: string; apiKey: string; modelId: string; baseUrl?: string }) {
      const providerStore = useProviderStore.getState();
      await providerStore.loadProviders();
      const existing = providerStore.providers.find((p) => p.id === providerId);
      const existingDetail = existing ? await api.getProvider(providerId) : null;
      const effectiveBaseUrl = baseUrl || existingDetail?.base_url || '';
      if (!existing) {
        await providerStore.createProvider({ id: providerId, name: providerId, base_url: effectiveBaseUrl, api_key: apiKey });
      } else {
        await providerStore.updateProvider(providerId, apiKey, effectiveBaseUrl, true);
      }
      const agentStore = useAgentStore.getState();
      const selected = agentStore.selectedAgent;
      const agent = agentStore.agents.find((a) => a.name === selected) || agentStore.agents[0];
      if (agent) {
        const agentId = agent.id || agent.name;
        await agentStore.updateAgentProfile(agentId, {
          chatConfig: JSON.stringify({
            ...parseAgentChatConfig(agent),
            provider: providerId,
            model: modelId,
          }),
        });
        await agentStore.loadAgents();
        await new Promise((r) => setTimeout(r, 500));
      }
      return { configured: true, providerId, modelId, agentName: agent?.name };
    },

    async sendMessage({ content }: SendMessageInput) {
      const chatStore = useChatStore.getState();
      const beforeCount = chatStore.messages.length;
      chatStore.sendMessage(content);
      return {
        sent: true,
        beforeCount,
      };
    },

    async getMessages() {
      const messages = useChatStore.getState().messages;
      return {
        count: messages.length,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          loading: m.loading,
          error: m.error,
          hasToolCalls: (m.toolCalls?.length ?? 0) > 0,
        })),
      };
    },

    async waitForAssistantResponse({ afterCount }: { afterCount: number }) {
      await waitFor(() => {
        const messages = useChatStore.getState().messages;
        if (messages.length <= afterCount) return false;
        const last = messages[messages.length - 1];
        if (last.role !== 'assistant') return false;
        if (last.loading) return false;
        if (last.error) return false;
        return (last.content?.length ?? 0) > 0;
      }, 'assistant response to complete', 120_000);

      const messages = useChatStore.getState().messages;
      const last = messages[messages.length - 1];
      return {
        content: last.content,
        messageId: last.id,
        toolCalls: last.toolCalls?.length ?? 0,
      };
    },

    async getSourceBadges() {
      const badges = document.querySelectorAll('[data-source-badges] [data-source-badge]');
      return {
        count: badges.length,
        types: Array.from(badges).map((el) => el.getAttribute('data-source-badge')),
      };
    },

    async hasBudgetNotice() {
      return {
        present: Boolean(document.querySelector('[data-budget-notice]')),
      };
    },

    async hasCapabilityWarning() {
      return {
        present: Boolean(document.querySelector('[data-agent-capability-warning]')),
      };
    },
  });
}
