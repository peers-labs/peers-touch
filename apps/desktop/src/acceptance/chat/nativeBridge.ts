import type { AuthSessionResponse } from '../../services/desktop_api';
import {
  type MemberSettingsResult,
  type MessagingConversationProjection,
  type MessagingProjection,
} from '../../services/im-service-contract';
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

export interface NativeAcceptanceConversationInput
  extends NativeAcceptanceActorInput {
  conversationId: string;
}

export interface NativeAcceptanceAttachmentInput
  extends NativeAcceptanceActorInput {
  attachmentId: string;
}

export interface NativeAcceptanceIdentityState {
  phase: string;
  reason: string;
  authenticated: boolean;
  actorPtid: string;
}

export interface NativeAcceptanceLogoutResult {
  actorPtid: string;
  status: string;
}

export interface MessagingAcceptanceInteractionSnapshot {
  actorPtid: string;
  conversationId: string;
  messageId: string;
  projection: Record<string, unknown> | null;
  intent: Record<string, unknown> | null;
  outbox: Record<string, unknown> | null;
  directSessions: Array<Record<string, unknown>>;
  commandLedger: Array<Record<string, unknown>>;
  reactions: Array<Record<string, unknown>>;
  pins: Array<Record<string, unknown>>;
  readCursors: Array<Record<string, unknown>>;
  consumptionCount: number;
  laneSequence: number;
  consumerEpoch: number;
}

interface NativeAcceptanceBridgeDependencies {
  activeActorPtid(): string | null;
  markLocalIdentityAction(): void;
  logoutWindowSession(actorPtid: string): Promise<AuthSessionResponse>;
  completeLogoutLifecycle(): Promise<void>;
  readInteractionSnapshot(
    input: NativeAcceptanceInteractionSnapshotInput,
  ): Promise<MessagingAcceptanceInteractionSnapshot>;
  readMessages(conversationId: string): Promise<MessagingProjection[]>;
  readConversations(): Promise<MessagingConversationProjection[]>;
  readMemberSettings(conversationId: string): Promise<MemberSettingsResult>;
  openAttachment(attachmentId: string): Promise<string>;
  identityState(): NativeAcceptanceIdentityState;
}

export interface NativeAcceptanceBridge {
  logout(
    input: NativeAcceptanceActorInput,
  ): Promise<NativeAcceptanceLogoutResult>;
  engineInteractionSnapshot(
    input: NativeAcceptanceInteractionSnapshotInput,
  ): Promise<MessagingAcceptanceInteractionSnapshot>;
  engineMessages(
    input: NativeAcceptanceConversationInput,
  ): Promise<{ messages: MessagingProjection[] }>;
  engineConversations(
    input: NativeAcceptanceActorInput,
  ): Promise<{ conversations: MessagingConversationProjection[] }>;
  conversationMemberSettings(
    input: NativeAcceptanceConversationInput,
  ): Promise<{ settings: MemberSettingsResult }>;
  openAttachment(
    input: NativeAcceptanceAttachmentInput,
  ): Promise<{ localPath: string }>;
  identityState(): Promise<NativeAcceptanceIdentityState>;
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

    async engineMessages(input) {
      requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      const conversationId = requireEvidenceIdentity(
        input.conversationId,
        'acceptance.chat.conversationIdRequired',
      );
      return {
        messages: await dependencies.readMessages(conversationId),
      };
    },

    async engineConversations(input) {
      requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      return {
        conversations: await dependencies.readConversations(),
      };
    },

    async conversationMemberSettings(input) {
      requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      const conversationId = requireEvidenceIdentity(
        input.conversationId,
        'acceptance.chat.conversationIdRequired',
      );
      return {
        settings: await dependencies.readMemberSettings(conversationId),
      };
    },

    async openAttachment(input) {
      requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      const attachmentId = requireEvidenceIdentity(
        input.attachmentId,
        'acceptance.chat.attachmentIdRequired',
      );
      return {
        localPath: await dependencies.openAttachment(attachmentId),
      };
    },

    async identityState() {
      return dependencies.identityState();
    },
  };
}
