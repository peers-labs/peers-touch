import { identityRuntime } from '../../kernel/identityRuntime';
import { runIdentityPipeline } from '../../services/identityPipeline';
import { markLocalIdentityAction } from '../../services/identity_event';
import {
  api,
  type AuthSessionResponse,
  type MessagingAcceptanceInteractionSnapshot,
  type MessagingAcceptancePreparedCommand,
  type MessagingAcceptanceRestorableCommand,
} from '../../services/desktop_api';
import {
  type MemberSettingsResult,
  type MessagingConversationProjection,
  type MessagingProjection,
} from '../../services/im-service-contract';
import { imServiceV1 } from '../../services/im-service';
import { useSessionStore } from '../../store/session';
import { requireCanonicalAcceptancePtid } from './identity';

export type { MessagingAcceptanceInteractionSnapshot } from '../../services/desktop_api';

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

export interface NativeAcceptanceSubmittedCommandInput
  extends NativeAcceptanceActorInput {
  conversationId: string;
  messageId: string;
  commandId: string;
}

export interface NativeAcceptanceRestorableCommandInput
  extends NativeAcceptanceActorInput {
  conversationId: string;
  plaintext: string;
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

interface NativeAcceptanceBridgeDependencies {
  activeActorPtid(): string | null;
  markLocalIdentityAction(): void;
  logoutWindowSession(actorPtid: string): Promise<AuthSessionResponse>;
  completeLogoutLifecycle(): Promise<void>;
  readInteractionSnapshot(
    input: NativeAcceptanceInteractionSnapshotInput,
  ): Promise<MessagingAcceptanceInteractionSnapshot>;
  prepareSubmittedCommand(
    input: NativeAcceptanceSubmittedCommandInput,
  ): Promise<MessagingAcceptancePreparedCommand>;
  createRestorableCommand(
    input: NativeAcceptanceRestorableCommandInput,
  ): Promise<MessagingAcceptanceRestorableCommand>;
  resumeMessagingLifecycle(actorPtid: string): Promise<{
    actorPtid: string;
    activated: boolean;
  }>;
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
  prepareSubmittedCommand(
    input: NativeAcceptanceSubmittedCommandInput,
  ): Promise<MessagingAcceptancePreparedCommand>;
  createRestorableCommand(
    input: NativeAcceptanceRestorableCommandInput,
  ): Promise<MessagingAcceptanceRestorableCommand>;
  resumeMessagingLifecycle(
    input: NativeAcceptanceActorInput,
  ): Promise<{ actorPtid: string; activated: boolean }>;
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

    async prepareSubmittedCommand(input) {
      const actorPtid = requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      return dependencies.prepareSubmittedCommand({
        actorPtid,
        conversationId: requireEvidenceIdentity(
          input.conversationId,
          'acceptance.chat.conversationIdRequired',
        ),
        messageId: requireEvidenceIdentity(
          input.messageId,
          'acceptance.chat.messageIdRequired',
        ),
        commandId: requireEvidenceIdentity(
          input.commandId,
          'acceptance.chat.commandIdRequired',
        ),
      });
    },

    async createRestorableCommand(input) {
      const actorPtid = requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      return dependencies.createRestorableCommand({
        actorPtid,
        conversationId: requireEvidenceIdentity(
          input.conversationId,
          'acceptance.chat.conversationIdRequired',
        ),
        plaintext: requireEvidenceIdentity(
          input.plaintext,
          'acceptance.chat.plaintextRequired',
        ),
      });
    },

    async resumeMessagingLifecycle(input) {
      const actorPtid = requireMatchingActor(
        input.actorPtid,
        dependencies.activeActorPtid(),
      );
      return dependencies.resumeMessagingLifecycle(actorPtid);
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
  prepareSubmittedCommand: (input) =>
    api.messagingAcceptancePrepareSubmittedCommand(input),
  createRestorableCommand: (input) =>
    api.messagingAcceptanceCreateRestorableCommand(input),
  resumeMessagingLifecycle: (actorPtid) =>
    api.messagingAcceptanceResumeLifecycle(actorPtid),
  readMessages: (conversationId) =>
    imServiceV1.messaging.listMessages(conversationId).then(page => page.messages),
  readConversations: () =>
    imServiceV1.messaging.listConversations(),
  readMemberSettings: (conversationId) =>
    imServiceV1.messaging.getMemberSettings(conversationId),
  openAttachment: (attachmentId) =>
    imServiceV1.messaging.openAttachment(attachmentId),
  identityState: () => {
    const snapshot = identityRuntime.getSnapshot();
    const phase = snapshot.phase;
    return {
      phase: phase.kind,
      reason: 'reason' in phase ? phase.reason : '',
      authenticated: snapshot.lifecycle.authenticated,
      actorPtid: useSessionStore.getState().currentUser?.actorPtid ?? '',
    };
  },
});
