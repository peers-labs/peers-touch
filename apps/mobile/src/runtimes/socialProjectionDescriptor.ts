/**
 * socialProjectionDescriptor.ts — Social projection runtime descriptor
 *
 * Integrates the social domain (friend chat, contacts, presence, typing)
 * with the shared event ingress and gateway layer.
 *
 * groupRuntime remains a subordinate projection: it receives events from
 * the social projection's ingress and reconciles through the social
 * projection's lifecycle.
 */

import type { MobileAuthSession } from '../features/auth/authSession';
import type { SocialState } from '../features/social/socialStore';
import type { GroupState } from '../features/group/groupStore';
import type { GroupE2eeRuntimeController } from '../features/group/groupE2eeRuntime';
import type { FriendChatMessage } from '../features/social/socialTypes';
import type { GroupMembershipKind, RealtimeWireEvent } from '../features/social/socialWire';
import { isSenderKeyDistributionMessage } from '../features/social/socialProjection';
import type {
  SocialEventIngressController,
  SocialIngressEvent,
  SocialIngressDomain,
  WriteAdmission,
} from './socialEventIngress';
import { createSocialEventIngress } from './socialEventIngress';
// ---------------------------------------------------------------------------
// Social projection descriptor metadata
// ---------------------------------------------------------------------------

/** Subordinate domain IDs managed by this converged projection */
export const SOCIAL_PROJECTION_SUBORDINATES: readonly string[] = ['group'] as const;

export const SOCIAL_PROJECTION_ID = 'social-projection' as const;

// ---------------------------------------------------------------------------
// Projection controller
// ---------------------------------------------------------------------------

export interface SocialProjectionController {
  /** The shared event ingress backing this projection */
  readonly ingress: SocialEventIngressController;

  /** Route a realtime wire event through the ingress into domain stores */
  routeRealtimeEvent: (wireEvent: RealtimeWireEvent) => void;

  /** Reconcile all domains (social + subordinates) */
  reconcileAll: () => Promise<void>;

  /** Handle session revalidation after control-event loss */
  revalidateSession: () => Promise<void>;

  /** Teardown the projection and ingress */
  teardown: () => void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createSocialProjection(
  session: MobileAuthSession,
  store: SocialState,
  groupStore?: GroupState,
  groupE2eeRuntime?: GroupE2eeRuntimeController,
): SocialProjectionController {
  let torn = false;

  // Route ingress events to the appropriate domain stores
  function handleIngressEvent(event: SocialIngressEvent): void {
    if (torn) return;

    switch (event.domain) {
      case 'social':
        // Social data events are handled synchronously by the store
        // (actual routing depends on event.kind, handled by the
        // existing realtime handler paths)
        break;
      case 'group':
        // Group events routed to groupStore
        break;
      case 'notification':
        // Notification events trigger store refresh
        void store.refreshNotifications();
        break;
      case 'control':
        if (event.kind === 'session-revalidate') {
          void revalidateSession();
        }
        if (event.kind === 'resync-required') {
          void reconcileAll();
        }
        break;
      default:
        break;
    }
  }

  function handleStaleness(domain: SocialIngressDomain): void {
    if (torn) return;
    // When a domain goes stale, trigger targeted reconciliation
    switch (domain) {
      case 'social':
        void store.reconcile();
        break;
      case 'group':
        void groupStore?.reconcile();
        break;
      case 'notification':
        void store.refreshNotifications();
        break;
      default:
        break;
    }
  }

  function handleAdmissionChange(admission: WriteAdmission): void {
    if (torn) return;
    if (!admission.open) {
      // Write admission closed: trigger session revalidation
      void revalidateSession();
    }
  }

  function handleReconcileRequired(domains: readonly SocialIngressDomain[]): void {
    if (torn) return;
    domains.forEach((domain) => handleStaleness(domain));
  }

  const ingress = createSocialEventIngress({
    onEvent: handleIngressEvent,
    onStaleness: handleStaleness,
    onAdmissionChange: handleAdmissionChange,
    onReconcileRequired: handleReconcileRequired,
  });

  // Route realtime wire events through the ingress
  function routeRealtimeEvent(wireEvent: RealtimeWireEvent): void {
    if (torn) return;

    const cursor = `rt-${Date.now()}`;
    const timestampMs = Date.now();

    switch (wireEvent.kind) {
      case 'message':
        if (isSenderKeyDistributionMessage(wireEvent.message)) {
          void routeSkdmControlMessage(wireEvent.message);
          return;
        }
        ingress.ingestDataEvent({
          domain: 'social',
          kind: 'friend-message',
          sessionUlid: wireEvent.sessionUlid,
          payload: { message: wireEvent.message },
          cursor,
          timestampMs,
        });
        void store.ingestRealtimeMessage(wireEvent.sessionUlid, wireEvent.message);
        break;

      case 'group-message':
        ingress.ingestDataEvent({
          domain: 'group',
          kind: 'group-message',
          groupUlid: wireEvent.groupUlid,
          payload: { message: wireEvent.message },
          cursor,
          timestampMs,
        });
        if (groupStore) {
          void groupStore
            .ingestRealtimeMessage(wireEvent.groupUlid, wireEvent.message)
            .then(() => groupE2eeRuntime?.repairEncryptedMessages());
        }
        break;

      case 'receipt':
        ingress.ingestDataEvent({
          domain: 'social',
          kind: 'friend-receipt',
          sessionUlid: wireEvent.sessionUlid,
          payload: { messageUlid: wireEvent.messageUlid, receiptKind: wireEvent.receiptKind },
          cursor,
          timestampMs,
        });
        store.applyMessageReceipt(wireEvent.sessionUlid, wireEvent.messageUlid, wireEvent.receiptKind);
        break;

      case 'mutation':
        ingress.ingestDataEvent({
          domain: 'social',
          kind: 'friend-mutation',
          sessionUlid: wireEvent.sessionUlid,
          payload: {
            messageUlid: wireEvent.messageUlid,
            mutationKind: wireEvent.mutationKind,
            newContent: wireEvent.newContent,
            newCiphertext: wireEvent.newCiphertext,
            mutatedTsUnixMs: wireEvent.mutatedTsUnixMs,
          },
          cursor,
          timestampMs,
        });
        store.applyMessageMutation(wireEvent.sessionUlid, wireEvent.messageUlid, wireEvent.mutationKind, {
          newContent: wireEvent.newContent,
          newCiphertext: wireEvent.newCiphertext,
          mutatedTsUnixMs: wireEvent.mutatedTsUnixMs,
        });
        groupStore?.applyMessageMutation(wireEvent.sessionUlid, wireEvent.messageUlid, wireEvent.mutationKind, {
          newContent: wireEvent.newContent,
          newCiphertext: wireEvent.newCiphertext,
          mutatedTsUnixMs: wireEvent.mutatedTsUnixMs,
        });
        break;

      case 'typing':
        ingress.ingestDataEvent({
          domain: 'social',
          kind: 'friend-typing',
          sessionUlid: wireEvent.sessionUlid,
          payload: { fromActorPtid: wireEvent.fromActorPtid, typing: wireEvent.typing },
          cursor,
          timestampMs,
        });
        store.applyTypingState(wireEvent.sessionUlid, wireEvent.fromActorPtid, wireEvent.typing);
        break;

      case 'presence':
        ingress.ingestDataEvent({
          domain: 'social',
          kind: 'friend-presence',
          payload: { ptid: wireEvent.ptid, online: wireEvent.online },
          cursor,
          timestampMs,
        });
        store.setPeerOnline(wireEvent.ptid, wireEvent.online);
        break;

      case 'group-membership':
        ingress.ingestDataEvent({
          domain: 'group',
          kind: 'group-membership',
          groupUlid: wireEvent.groupUlid,
          payload: { actorPtid: wireEvent.actorPtid, membershipKind: wireEvent.membershipKind },
          cursor,
          timestampMs,
        });
        void routeGroupMembershipChange(wireEvent.groupUlid, wireEvent.actorPtid, wireEvent.membershipKind);
        break;

      case 'settings-changed':
        if (wireEvent.conversationKind === 'friend') {
          ingress.ingestDataEvent({
            domain: 'social',
            kind: 'friend-settings-changed',
            payload: { containerUlid: wireEvent.containerUlid },
            cursor,
            timestampMs,
          });
          void store.loadConversationSettings(wireEvent.containerUlid);
        } else {
          ingress.ingestDataEvent({
            domain: 'group',
            kind: 'group-settings-changed',
            groupUlid: wireEvent.containerUlid,
            payload: { containerUlid: wireEvent.containerUlid },
            cursor,
            timestampMs,
          });
          void groupStore?.loadSettings(wireEvent.containerUlid);
        }
        break;

      case 'resync':
        ingress.ingestControlEvent({
          domain: 'control',
          kind: 'resync-required',
          payload: {},
          cursor,
          timestampMs,
        });
        void reconcileAll();
        break;
    }
  }

  async function reconcileAll(): Promise<void> {
    if (torn) return;
    await Promise.allSettled([
      store.reconcile(),
      groupStore?.reconcile().then(() => groupE2eeRuntime?.repairEncryptedMessages()),
    ]);
  }

  async function revalidateSession(): Promise<void> {
    if (torn) return;
    // Reconcile all domains to repair any state drift
    await reconcileAll();
    // Reopen ingress admission after successful reconciliation
    ingress.reopenAdmission();
  }

  async function routeSkdmControlMessage(message: FriendChatMessage): Promise<void> {
    if (!groupE2eeRuntime || message.senderPtid === store.currentUserPtid) return;
    const skdmBytes = message.encryptedPayload?.byteLength
      ? message.encryptedPayload
      : new Uint8Array();
    await groupE2eeRuntime.consumeSkdmControlMessage(message.senderPtid, skdmBytes);
  }

  async function routeGroupMembershipChange(
    groupUlid: string,
    actorPtid: string,
    membershipKind: GroupMembershipKind,
  ): Promise<void> {
    try {
      await groupStore?.refreshGroups();
      if (membershipKind === 'DISSOLVED' && groupStore?.activeGroupUlid === groupUlid) {
        await groupStore.selectGroup(null);
      }
      if (membershipKind !== 'DISSOLVED' && groupStore?.activeGroupUlid === groupUlid) {
        await groupStore.loadMembers(groupUlid);
      }
      if (membershipKind === 'REMOVED' || membershipKind === 'LEFT' || membershipKind === 'TRANSFERRED') {
        await groupE2eeRuntime?.rotateAfterMembershipChange(groupUlid, actorPtid);
      }
    } catch {
      // Group store and E2EE runtime persist their own domain errors.
    }
  }

  function teardown(): void {
    torn = true;
    ingress.teardown();
  }

  return {
    ingress,
    routeRealtimeEvent,
    reconcileAll,
    revalidateSession,
    teardown,
  };
}
