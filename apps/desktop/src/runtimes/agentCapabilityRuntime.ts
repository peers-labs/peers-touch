import type { RuntimeDescriptor } from '../kernel/runtime';
import { useAgentStore } from '../store/agent';
import { useMCPStore } from '../store/mcp';
import { useSkillStore } from '../store/skill';
import { useToolStore } from '../store/tool';
import { log } from '../utils/logger';

let installed = false;

async function loadAgentCapabilities(reason: string): Promise<void> {
  log.info('agentCapabilityRuntime', 'loading agent capability projections', { reason });
  await Promise.all([
    useAgentStore.getState().loadModels(),
    useAgentStore.getState().loadAgents(),
    useAgentStore.getState().loadApplets(),
    useMCPStore.getState().loadServers(),
    useSkillStore.getState().loadSkills(),
    useToolStore.getState().loadTools(),
  ]);
}

export const agentCapabilityRuntime: RuntimeDescriptor = {
  id: 'agent-capability',
  scope: 'app',
  install() {
    if (installed) return;
    installed = true;
  },
  teardown() {
    installed = false;
  },
  async bootstrap() {
    await loadAgentCapabilities('bootstrap');
  },
  async reconcile(reason: string) {
    await loadAgentCapabilities(reason);
  },
};
