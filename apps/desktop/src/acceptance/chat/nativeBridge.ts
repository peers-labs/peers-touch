import { runIdentityPipeline } from '../../services/identityPipeline';
import { markLocalIdentityAction } from '../../services/identity_event';
import {
  api,
  type AuthSessionResponse,
  type MessagingAcceptanceInteractionSnapshot,
} from '../../services/desktop_api';
import { useSessionStore } from '../../store/session';
import { requireCanonicalAcceptancePtid } from './identity';

export interface NativeAcceptanceActorInput {
  actorPtid: string;
}

export interface NativeAcceptanceInteractionSnapshotInput
  extends NativeAcceptanceActorInput {
  conversationId: string;
  messageId: string;
  commandId?: string;
}

export interface NativeAcceptanceLogoutResult {
  actorPtid: string;
  status: string;
}

interface NativeAcceptanceBridgeDependencies {
  activeActorPtid(): string | null;
  markLocalIdentityAction(): void;
  logoutWindowSession(actorPtid: string): Promise<AuthSessionResponse>;
  completeLogoutLifecycle(): Promise<void>;
  readInteractionSnapshot(
    input: NativeAcceptanceInteractionSnapshotInput,
  ): Promise<MessagingAcceptanceInteractionSnapshot>;
}

export interface NativeAcceptanceBridge {
  logout(
    input: NativeAcceptanceActorInput,
  ): Promise<NativeAcceptanceLogoutResult>;
  engineInteractionSnapshot(
    input: NativeAcceptanceInteractionSnapshotInput,
  ): Promise<MessagingAcceptanceInteractionSnapshot>;
}

function requireMatchingActor(
  expectedActorPtid: string,
  activeActorPtid: string | null,
): string {
  const expected = requireCanonicalAcceptancePtid(expectedActorPtid);
  const active = requireCanonicalAcceptancePtid(activeActorPtid);
  if (expected !== active) {
    throw new Error('acceptance.chat.actorPtidMismatch');
  }
  return expected;
}

function requireEvidenceIdentity(value: string, errorKey: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(errorKey);
  }
  return normalized;
}

export function createNativeAcceptanceBridge(
  dependencies: NativeAcceptanceBridgeDependencies,
): NativeAcceptanceBridge {
  return {
    async logout(input) {
      const actorPtid = requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      dependencies.markLocalIdentityAction();
      const response = await dependencies.logoutWindowSession(actorPtid);
      if (response.actor_ptid !== null) {
        throw new Error('acceptance.chat.logoutRetainedActor');
      }
      await dependencies.completeLogoutLifecycle();
      return {
        actorPtid,
        status: response.status,
      };
    },

    async engineInteractionSnapshot(input) {
      const actorPtid = requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      return dependencies.readInteractionSnapshot({
        actorPtid,
        conversationId: requireEvidenceIdentity(
          input.conversationId,
          'acceptance.chat.conversationIdRequired',
        ),
        messageId: requireEvidenceIdentity(
          input.messageId,
          'acceptance.chat.messageIdRequired',
        ),
        commandId: input.commandId?.trim() ?? '',
      });
    },
  };
}

export const nativeAcceptanceBridge = createNativeAcceptanceBridge({
  activeActorPtid: () =>
    useSessionStore.getState().currentUser?.actorPtid ?? null,
  markLocalIdentityAction,
  logoutWindowSession: (actorPtid) =>
    api.acceptanceLogoutWindowSession(actorPtid),
  completeLogoutLifecycle: async () => {
    await runIdentityPipeline({
      reason: 'logout',
      actorPtid: null,
      loginMethod: null,
    });
  },
  readInteractionSnapshot: (input) =>
    api.messagingAcceptanceInteractionSnapshot(input),
});
