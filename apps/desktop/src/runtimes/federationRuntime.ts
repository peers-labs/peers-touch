// Federation runtime owns the authenticated actor's profile and available
// Federation contexts. Both projections are session-scoped Station truth.

import type { RuntimeDescriptor } from '../kernel/runtime';
import { useFederationStore } from '../store/federation';
import { log } from '../utils/logger';

export const federationRuntime: RuntimeDescriptor = {
  id: 'federation',
  scope: 'session',

  install(): void {
    log.debug('federation', 'runtime installed');
  },

  teardown(): void {
    useFederationStore.getState().clearSession();
    log.debug('federation', 'runtime torn down');
  },

  async bootstrap(actorPtid: string | null): Promise<void> {
    if (!actorPtid) return;
    const store = useFederationStore.getState();
    await Promise.allSettled([
      store.refreshSelf(),
      store.refreshFederationContexts(),
    ]);
  },

  async reconcile(reason: string): Promise<void> {
    log.debug('federation', 'reconcile', { reason });
    const store = useFederationStore.getState();
    await Promise.allSettled([
      store.refreshSelf(),
      store.refreshFederationContexts(),
    ]);
  },
};
