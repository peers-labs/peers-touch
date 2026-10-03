import type { AccessDecision } from '../features/auth/authSession';
import type { StoredStationRegistry } from '../features/station/stationRegistry';
import type { AuthRuntimeSnapshot } from '../runtimes/authRuntime';
import type { AccessRuntimeSnapshot } from '../runtimes/accessRuntime';
import type {
  SessionRuntimeRevocation,
  SessionRuntimeSnapshot,
} from '../runtimes/sessionRuntime';
import type {
  MobilePublicProjection,
  PublicAccessDecision,
  PublicMessagingProjection,
  SessionRevocationProjection,
  PublicOAuthProjection,
  PublicStationEntry,
} from './contracts';
import type {
  MessagingConversationProjection,
  MessagingMessageProjection,
  MessagingRuntimeStatus,
} from '../services/mobileCommands';

export function sanitizeStationRegistry(
  registry: StoredStationRegistry,
): MobilePublicProjection['station'] {
  return {
    activeStationPeerId: registry.activeStationPeerId,
    entries: registry.entries.map(toPublicStationEntry),
  };
}

export function sanitizeSessionRevocation(
  revocation: SessionRuntimeRevocation,
): SessionRevocationProjection {
  return {
    remoteRevocation: revocation.remoteRevocation,
  };
}

export function sanitizeAccessDecision(
  decision: AccessDecision | null | undefined,
): PublicAccessDecision | null {
  if (!decision) return null;
  return {
    state: decision.state,
    attemptId: decision.attemptId,
    currentGateId: decision.currentGateId,
    accessGrantId: decision.accessGrantId,
    gates: decision.gates.map((gate) => ({
      gateId: gate.gateId,
      type: gate.type,
      state: gate.state,
    })),
  };
}

export function sanitizeOAuthProjection(
  snapshot: AuthRuntimeSnapshot,
): PublicOAuthProjection {
  return {
    phase: snapshot.phase,
    stationPeerId: snapshot.stationPeerId,
    provider: snapshot.provider,
    accessAttemptId: snapshot.accessAttemptId,
    gateId: snapshot.gateId,
    expiresAtUnixMs: snapshot.expiresAtUnixMs,
    result: snapshot.result,
    errorCode: snapshot.errorCode,
    candidatePtid: snapshot.candidatePtid,
    accessDecision: sanitizeOAuthAccessDecision(snapshot.accessDecision),
    session: snapshot.session ? {
      actorPtid: snapshot.session.actorPtid,
      expiresAt: snapshot.session.expiresAt,
    } : null,
    errorKey: snapshot.errorKey,
    recovery: snapshot.recovery,
  };
}

export function sanitizeMobileProjection(input: {
  stationRegistry: StoredStationRegistry;
  access: AccessRuntimeSnapshot;
  session: SessionRuntimeSnapshot;
  oauth: AuthRuntimeSnapshot;
}): MobilePublicProjection {
  return {
    station: sanitizeStationRegistry(input.stationRegistry),
    access: {
      decision: sanitizeAccessDecision(input.access.decision),
      session: input.session.session ? {
        stationPeerId: input.session.session.stationPeerId,
        actorPtid: input.session.session.actorPtid,
        expiresAt: input.session.session.expiresAt,
      } : null,
      loading: input.access.loading,
      errorKey: input.access.errorKey,
      restored: input.access.restored,
    },
    oauth: sanitizeOAuthProjection(input.oauth),
  };
}

export function sanitizeMessagingProjection(input: {
  runtime: MessagingRuntimeStatus;
  conversations: MessagingConversationProjection[];
  messages: Record<string, MessagingMessageProjection[]>;
}): PublicMessagingProjection {
  return {
    runtime: {
      active: input.runtime.active,
      profileId: input.runtime.profileId,
      stationPeerId: input.runtime.stationPeerId,
      actorPtid: input.runtime.actorPtid,
      deviceId: input.runtime.deviceId,
      deviceEnrolled: input.runtime.deviceEnrolled,
      laneSequence: input.runtime.laneSequence,
      consumerEpoch: input.runtime.consumerEpoch,
      conversationCount: input.runtime.conversationCount,
      activationGeneration: input.runtime.activationGeneration,
      workerPhase: input.runtime.workerPhase,
    },
    conversations: input.conversations.map((conversation) => ({
      conversationId: conversation.conversationId,
      authorityStationId: conversation.authorityStationId,
      federationId: conversation.federationId,
      kind: conversation.kind,
      name: conversation.name,
      ownerPtid: conversation.ownerPtid,
      memberPtids: [...conversation.memberPtids],
      members: conversation.members.map((member) => ({ ...member })),
      membershipEpoch: conversation.membershipEpoch,
      mlsEpoch: conversation.mlsEpoch,
      active: conversation.active,
      updatedAtUnixMs: conversation.updatedAtUnixMs,
    })),
    messages: Object.fromEntries(
      Object.entries(input.messages).map(([conversationId, messages]) => [
        conversationId,
        sanitizeMessagingMessages(messages),
      ]),
    ),
  };
}

export function sanitizeMessagingMessages(
  messages: MessagingMessageProjection[],
): PublicMessagingProjection['messages'][string] {
  return messages.map((message) => ({
    eventId: message.eventId,
    eventSequence: message.eventSequence,
    messageId: message.messageId,
    senderPtid: message.senderPtid,
    state: message.state,
    timestampUnixMs: message.timestampUnixMs,
    replyToMessageId: message.replyToMessageId,
    threadRootMessageId: message.threadRootMessageId,
    editedText: message.editedText,
    editedAtUnixMs: message.editedAtUnixMs,
    retracted: message.retracted,
    reactions: message.reactions.map((reaction) => ({
      actorPtid: reaction.actorPtid,
      reaction: reaction.reaction,
      createdAtUnixMs: reaction.createdAtUnixMs,
    })),
    pinnedByPtid: message.pinnedByPtid,
    pinnedAtUnixMs: message.pinnedAtUnixMs,
    readByPtids: [...message.readByPtids],
    plaintext: message.plaintext,
    attachments: message.attachments.map((attachment) => ({
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      plaintextSize: attachment.plaintextSize,
      ciphertextSize: attachment.ciphertextSize,
      availabilityState: attachment.availabilityState,
    })),
  }));
}

function toPublicStationEntry(
  entry: StoredStationRegistry['entries'][number],
): PublicStationEntry {
  return {
    stationPeerId: entry.stationPeerId,
    url: entry.url,
    label: entry.label,
    online: entry.online,
    lastCheckedAt: entry.lastCheckedAt,
  };
}

function sanitizeOAuthAccessDecision(
  decision: AuthRuntimeSnapshot['accessDecision'],
): PublicAccessDecision | null {
  if (!decision) return null;
  return {
    state: decision.state,
    attemptId: decision.attemptId,
    currentGateId: decision.currentGateId,
    accessGrantId: decision.accessGrantId,
    gates: decision.gates.map((gate) => ({
      gateId: gate.gateId,
      type: gate.gateType,
      state: gate.state,
    })),
  };
}
