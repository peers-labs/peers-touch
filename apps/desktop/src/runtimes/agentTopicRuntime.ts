import type { RuntimeDescriptor } from '../kernel/runtime';
import { useAgentTopicStore } from '../store/agentTopics';
import { log } from '../utils/logger';

const TOPIC_RECONCILE_INTERVAL_MS = 60_000;

let installed = false;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;

async function reconcileTopics(reason: string): Promise<void> {
  log.info('agentTopicRuntime', 'reconciling agent topic projection', { reason });
  await useAgentTopicStore.getState().reconcileSelectedAgentTopics(reason);
}

function installTimer(): void {
  if (reconcileTimer != null) return;
  reconcileTimer = setInterval(() => {
    void reconcileTopics('periodic');
  }, TOPIC_RECONCILE_INTERVAL_MS);
}

function clearTimer(): void {
  if (reconcileTimer == null) return;
  clearInterval(reconcileTimer);
  reconcileTimer = null;
}

export const agentTopicRuntime: RuntimeDescriptor = {
  id: 'agent-topic',
  scope: 'app',
  install() {
    if (installed) return;
    installed = true;
    installTimer();
  },
  teardown() {
    installed = false;
    clearTimer();
  },
  async bootstrap() {
    await reconcileTopics('bootstrap');
  },
  async reconcile(reason: string) {
    await reconcileTopics(reason);
  },
};
