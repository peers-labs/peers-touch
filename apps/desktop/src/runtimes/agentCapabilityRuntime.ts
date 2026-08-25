import type { RuntimeDescriptor } from '../kernel/runtime';
import { isBrowserGatewayRuntime } from '../kernel/gateway';
import { api } from '../services/desktop_api';
import { useAgentStore } from '../store/agent';
import { useAgentConnectorStore } from '../store/agentConnectors';
import { useMCPStore } from '../store/mcp';
import { useProviderStore } from '../store/provider';
import { useSkillStore } from '../store/skill';
import { useToolStore } from '../store/tool';
import { log } from '../utils/logger';

let installed = false;

async function openBrowserCapabilitySession(): Promise<void> {
  if (!isBrowserGatewayRuntime()) return;
  await api.openBrowserCapabilitySession();
}

export async function closeBrowserCapabilitySession(): Promise<void> {
  if (!isBrowserGatewayRuntime()) return;
  await api.closeBrowserCapabilitySession();
}

async function loadAgentCapabilities(reason: string): Promise<void> {
  log.info('agentCapabilityRuntime', 'loading agent capability projections', { reason });
  await Promise.all([
    useProviderStore.getState().loadProviders(),
    useAgentStore.getState().loadModels(),
    useAgentStore.getState().loadAgents(),
    useAgentStore.getState().loadApplets(),
    useAgentConnectorStore.getState().loadConnectors(),
    useMCPStore.getState().loadServers(),
    useSkillStore.getState().loadSkills(),
    useToolStore.getState().loadTools(),
  ]);
}

export const agentCapabilityRuntime: RuntimeDescriptor = {
  id: 'agent-capability',
  scope: 'session',
  install() {
    if (installed) return;
    installed = true;
  },
  teardown() {
    void closeBrowserCapabilitySession().catch((error) => {
      log.warn('agentCapabilityRuntime', 'browser capability session close failed', {
        error: String(error),
      });
    });
    installed = false;
  },
  async bootstrap(actorId) {
    if (!actorId) return;
    await openBrowserCapabilitySession();
    await loadAgentCapabilities('bootstrap');
  },
  async reconcile(reason: string) {
    await loadAgentCapabilities(reason);
  },
};
