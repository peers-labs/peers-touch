// social runtime — adapts the existing `services/socialRealtime.ts`
// bridge to the kernel `RuntimeDescriptor` contract.
//
// `services/socialRealtime.ts` already owns its own session-store
// subscription and self-bootstraps inside `installSocialRealtimeBridge`,
// so this adapter is intentionally thin:
//   • install / teardown delegate.
//   • bootstrap is a no-op — install() has already arranged for
//     `reconcileAuthenticatedRuntime` to fire on every authenticated
//     edge, while bootstrap gives the kernel an explicit projection
//     refresh hook when it already knows the authenticated actor.
//   • reconcile triggers an explicit projection refresh (used by the
//     foreground/visibility heuristics; periodic reconcile is still
//     owned by socialRealtime's own timer).
//
// Behavioural equivalence with the previous `installAppRuntime` path is
// the explicit goal of this step.

import {
  dispatchSocialRuntimeHostEvent,
  installSocialRealtimeBridge,
  refreshSocialProjection,
  teardownSocialRealtimeBridge,
} from '../services/socialRealtime';
import type { RuntimeDescriptor } from '../kernel/runtime';
import { installDesktopSocialHostAdapter } from './desktopSocialHostAdapter';

let teardownHostAdapter: (() => void) | null = null;

export const socialRuntime: RuntimeDescriptor = {
  id: 'social',
  // `app` so the runtime is installed once at boot. Authenticated-edge
  // bootstrapping is handled internally by socialRealtime via its own
  // session-store subscription, mirroring the legacy behaviour.
  scope: 'app',
  install(): void {
    installSocialRealtimeBridge();
    if (!teardownHostAdapter) {
      teardownHostAdapter = installDesktopSocialHostAdapter(dispatchSocialRuntimeHostEvent);
    }
  },
  teardown(): void {
    teardownHostAdapter?.();
    teardownHostAdapter = null;
    teardownSocialRealtimeBridge();
  },
  async bootstrap(actorPtid: string | null): Promise<void> {
    if (!actorPtid) return;
    await refreshSocialProjection('runtime:bootstrap', true);
  },
  async reconcile(reason: string): Promise<void> {
    await refreshSocialProjection(`runtime:reconcile:${reason}`, true);
  },
};
