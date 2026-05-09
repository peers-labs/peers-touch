// social runtime — adapts the existing `services/socialRealtime.ts`
// bridge to the kernel `RuntimeDescriptor` contract.
//
// `services/socialRealtime.ts` already owns its own session-store
// subscription and self-bootstraps inside `installSocialRealtimeBridge`,
// so this adapter is intentionally thin:
//   • install / teardown delegate.
//   • bootstrap is a no-op — install() has already arranged for
//     `reconcileAuthenticatedRuntime` to fire on every authenticated
//     edge, so the BootPipeline does not need to do extra work here.
//   • reconcile triggers an explicit projection refresh (used by the
//     foreground/visibility heuristics; periodic reconcile is still
//     owned by socialRealtime's own timer).
//
// Behavioural equivalence with the previous `installAppRuntime` path is
// the explicit goal of this step.

import {
  installSocialRealtimeBridge,
  refreshSocialProjection,
  teardownSocialRealtimeBridge,
} from '../services/socialRealtime';
import type { RuntimeDescriptor } from '../kernel/runtime';

export const socialRuntime: RuntimeDescriptor = {
  id: 'social',
  // `app` so the runtime is installed once at boot. Authenticated-edge
  // bootstrapping is handled internally by socialRealtime via its own
  // session-store subscription, mirroring the legacy behaviour.
  scope: 'app',
  install(): void {
    installSocialRealtimeBridge();
  },
  teardown(): void {
    teardownSocialRealtimeBridge();
  },
  async bootstrap(): Promise<void> {
    // Intentionally empty — install() already drives the first
    // bootstrap via `reconcileAuthenticatedRuntime`.
  },
  async reconcile(reason: string): Promise<void> {
    await refreshSocialProjection(`runtime:reconcile:${reason}`, true);
  },
};
