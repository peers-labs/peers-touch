import type { RuntimeDescriptor } from '../kernel/runtime';
import { messagingDomainRuntime } from '../messaging/runtime';
import {
  installMessagingRealtimeBridge,
  refreshMessagingProjection,
  resetMessagingRealtimeScope,
  teardownMessagingRealtimeBridge,
} from '../services/messagingRealtime';
import {
  installMessagingProjectionBridge,
  resetMessagingProjectionScope,
  teardownMessagingProjectionBridge,
} from '../services/messagingProjection';
import { useSocialChatStore } from '../store/socialChat';

messagingDomainRuntime.configure({
  install(): void {
    installMessagingRealtimeBridge();
    void installMessagingProjectionBridge();
  },
  teardown(): void {
    teardownMessagingProjectionBridge();
    teardownMessagingRealtimeBridge();
  },
  resetProjection(): void {
    resetMessagingRealtimeScope();
    resetMessagingProjectionScope();
    useSocialChatStore.getState().resetMessagingProjection();
  },
  reconcile(reason, scope): Promise<void> {
    return refreshMessagingProjection(reason, scope);
  },
});

export const messagingRuntime: RuntimeDescriptor = {
  id: 'messaging',
  scope: 'session',
  install(): void {
    messagingDomainRuntime.install();
  },
  teardown(): void {
    messagingDomainRuntime.teardown();
  },
  async bootstrap(actorPtid: string | null): Promise<void> {
    await messagingDomainRuntime.bootstrap(actorPtid);
  },
  async reconcile(reason: string): Promise<void> {
    await messagingDomainRuntime.reconcile(reason);
  },
};
