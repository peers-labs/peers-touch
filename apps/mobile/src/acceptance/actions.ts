import {
  submitStationInviteCodeGate,
  submitStationLoginGate,
} from '../features/auth/authSession';
import { verifyStationIdentity } from '../features/station/stationConnection';
import {
  activeStationEntry,
  addStationEntry,
  emptyStationRegistry,
  loadStationRegistry,
  persistStationRegistry,
  removeStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  applyAccessGateRuntimeResult,
  cancelOAuth,
  clearAuthRuntimeSession,
  readActiveAuthSession,
  readAccessRuntimeProjection,
  readAuthRuntimeSnapshot,
  refreshOAuthStatus,
  startAccessAttemptForActiveStation,
  startOAuth,
} from '../runtimes/authRuntime';
import { reconcileActiveMessagingSession } from '../runtimes/messagingRuntime';
import {
  acceptSocialFriendRequest,
  readSocialRuntimeProjection,
  reconcileSocialRuntime,
  sendSocialFriendRequest,
} from '../features/social/socialRuntime';
import {
  messagingCommandStatus,
  messagingCreateDirect,
  messagingCreateGroup,
  messagingListConversations,
  messagingListMessages,
  messagingOpenAttachment,
  messagingSearchMessages,
  messagingSendMessage,
  messagingStageAttachment,
  messagingStatus,
  messagingSubmitEdit,
  messagingSubmitMetadataInteraction,
  messagingSubmitReadCursor,
  messagingSubmitTyping,
  type MessagingAccountInput,
} from '../services/mobileCommands';
import { readSharedBuildIdentity } from './buildIdentity';
import type { MobileAcceptanceNamespace } from './contracts';
import {
  purgeNativeOAuth,
  requestCallbackReplayHandle,
  submitNegativeOAuthCallback,
} from './negativeOAuth';
import {
  sanitizeAccessDecision,
  sanitizeMessagingMessages,
  sanitizeMessagingProjection,
  sanitizeMobileProjection,
  sanitizeOAuthProjection,
  sanitizeStationRegistry,
} from './projection';

export const mobileAcceptanceActions: MobileAcceptanceNamespace = {
  'build.identity': async () => readSharedBuildIdentity(),

  'station.add': async (input) => {
    const requestedUrl = requireString(input?.url, 'station.add.url');
    const verified = await verifyStationIdentity(requestedUrl);
    const current = await loadStationRegistry();
    const next = addVerifiedStation(current, verified);
    if (
      current.activeStationPeerId
      && current.activeStationPeerId !== verified.stationPeerId
    ) {
      await cancelAndClearCurrentAuthScope();
    }

    await persistStationRegistry(next);
    return stationMutationOutput(next, verified);
  },

  'station.replace': async (input) => {
    const currentStationPeerId = requireString(
      input?.stationPeerId,
      'station.replace.stationPeerId',
    );
    const requestedUrl = requireString(input?.url, 'station.replace.url');
    const current = await loadStationRegistry();
    if (!current.entries.some(
      (entry) => entry.stationPeerId === currentStationPeerId,
    )) {
      throw new Error('acceptance.mobile.stationNotFound');
    }

    const verified = await verifyStationIdentity(requestedUrl);
    const withoutReplacedStation = removeStationEntry(
      current,
      currentStationPeerId,
    );
    const next = addVerifiedStation(withoutReplacedStation, verified);
    await cancelAndClearCurrentAuthScope();
    await persistStationRegistry(next);
    return stationMutationOutput(next, verified);
  },

  'access.submit': async (input) => {
    if (!input) throw new Error('acceptance.mobile.invalidAccessSubmitInput');
    const station = requireActiveStation(await loadStationRegistry());

    if (input.kind === 'start') {
      const decision = await startAccessAttemptForActiveStation();
      return {
        decision: requirePublicDecision(decision),
        session: readAccessRuntimeProjection().session,
      };
    }

    const attemptId = requireString(
      input?.attemptId,
      'access.submit.attemptId',
    );

    if (input.kind === 'login') {
      const result = await submitStationLoginGate({
        stationPeerId: station.stationPeerId,
        stationUrl: station.url,
        attemptId,
        email: requireString(input.email, 'access.submit.email'),
        password: requireString(input.password, 'access.submit.password'),
      });
      applyAccessGateRuntimeResult(result.decision, result.session);
      return {
        decision: requirePublicDecision(result.decision),
        session: {
          stationPeerId: result.session.stationPeerId,
          actorPtid: result.session.actorRef.ptid,
          expiresAt: result.session.expiresAt,
        },
      };
    }

    if (input.kind === 'invite-code') {
      const decision = await submitStationInviteCodeGate({
        stationUrl: station.url,
        attemptId,
        inviteCode: requireString(
          input.inviteCode,
          'access.submit.inviteCode',
        ),
      });
      applyAccessGateRuntimeResult(decision);
      return {
        decision: requirePublicDecision(decision),
        session: readAccessRuntimeProjection().session,
      };
    }

    throw new Error('acceptance.mobile.invalidAccessSubmitKind');
  },

  'oauth.start': async (input) => {
    if (!input) throw new Error('acceptance.mobile.invalidOAuthStartInput');
    const station = requireActiveStation(await loadStationRegistry());
    const provider = input?.provider;
    if (provider !== 'github' && provider !== 'google') {
      throw new Error('acceptance.mobile.invalidOAuthProvider');
    }
    await startOAuth({
      provider,
      stationUrl: station.url,
      accessAttemptId: requireString(
        input.accessAttemptId,
        'oauth.start.accessAttemptId',
      ),
      gateId: requireString(input.gateId, 'oauth.start.gateId'),
    });
    return sanitizeOAuthProjection(readAuthRuntimeSnapshot());
  },

  'oauth.status': async () => {
    await refreshOAuthStatus();
    return sanitizeOAuthProjection(readAuthRuntimeSnapshot());
  },

  'oauth.cancel': async () => {
    await cancelOAuth();
    return sanitizeOAuthProjection(readAuthRuntimeSnapshot());
  },

  'oauth.replayHandle': async (input) => requestCallbackReplayHandle(input),

  'oauth.negativeCallback': async (input) => (
    submitNegativeOAuthCallback(input)
  ),

  'lifecycle.restart': async () => {
    return {
      requested: true,
      scope: 'webview',
    };
  },

  'native.deliverDeepLink': async (input) => {
    requireString(input?.url, 'native.deliverDeepLink.url');
    return {
      supported: false,
      reason: 'external-driver-required',
      owner: 'appium-native-context',
    };
  },

  'projection.read': async () => sanitizeMobileProjection({
    stationRegistry: await loadStationRegistry(),
    access: readAccessRuntimeProjection(),
    oauth: readAuthRuntimeSnapshot(),
  }),

  'messaging.createDirect': async (input) => {
    const account = requireMessagingAccount();
    return messagingCreateDirect({
      ...account,
      peerPtid: requirePtid(input?.peerPtid, 'messaging.createDirect.peerPtid'),
      federationId: requireString(
        input?.federationId,
        'messaging.createDirect.federationId',
      ),
    });
  },

  'messaging.createGroup': async (input) => {
    const account = requireMessagingAccount();
    return messagingCreateGroup({
      ...account,
      conversationId: requireString(
        input?.conversationId,
        'messaging.createGroup.conversationId',
      ),
      name: requireString(input?.name, 'messaging.createGroup.name'),
      memberPtids: requirePtidList(
        input?.memberPtids,
        'messaging.createGroup.memberPtids',
      ),
      federationId: requireString(
        input?.federationId,
        'messaging.createGroup.federationId',
      ),
    });
  },

  'messaging.attachment.stage': async (input) => {
    const account = requireMessagingAccount();
    const filename = requireString(
      input?.filename,
      'messaging.attachment.stage.filename',
    );
    const mimeType = requireString(
      input?.mimeType,
      'messaging.attachment.stage.mimeType',
    );
    const expectedSha256 = requireSha256(
      input?.sha256,
      'messaging.attachment.stage.sha256',
    );
    const bytes = decodeBoundedBase64(
      input?.bytesBase64,
      'messaging.attachment.stage.bytesBase64',
    );
    const actualSha256 = await sha256Hex(bytes);
    if (actualSha256 !== expectedSha256) {
      throw new Error('acceptance.mobile.attachmentDigestMismatch');
    }
    const staged = await messagingStageAttachment({
      ...account,
      file: new File([bytes.buffer], filename, { type: mimeType }),
    });
    return {
      stageId: staged.stageId,
      filename: staged.filename,
      mimeType: staged.mimeType,
      plaintextSize: staged.plaintextSize,
      completed: staged.completed,
    };
  },

  'messaging.attachment.open': async (input) => {
    const result = await messagingOpenAttachment({
      ...requireMessagingAccount(),
      attachmentId: requireString(
        input?.attachmentId,
        'messaging.attachment.open.attachmentId',
      ),
    });
    return result.state === 'ready'
      ? { state: 'ready', available: true }
      : {
        state: 'pending',
        available: false,
        nextAttemptAtUnixMs: result.nextAttemptAtUnixMs,
      };
  },

  'messaging.send': async (input) => {
    const conversationId = requireString(
      input?.conversationId,
      'messaging.send.conversationId',
    );
    const result = await messagingSendMessage({
      ...requireMessagingAccount(),
      conversationId,
      plaintext: input?.plaintext ?? '',
      replyToMessageId: input?.replyToMessageId,
      threadRootMessageId: input?.threadRootMessageId,
      attachmentStageIds: input?.attachmentStageIds,
    });
    return { conversationId, ...result };
  },

  'messaging.interact': async (input) => {
    const conversationId = requireString(
      input?.conversationId,
      'messaging.interact.conversationId',
    );
    const messageId = requireString(
      input?.messageId,
      'messaging.interact.messageId',
    );
    if (input.kind === 'edit') {
      const result = await messagingSubmitEdit({
        ...requireMessagingAccount(),
        conversationId,
        messageId,
        plaintext: requireString(
          input.plaintext,
          'messaging.interact.plaintext',
        ),
      });
      return { conversationId, ...result };
    }
    const interaction = input.kind === 'retract'
      ? { kind: 'retract' as const }
      : input.kind === 'reaction'
        ? {
          kind: 'reaction' as const,
          reaction: requireString(
            input.reaction,
            'messaging.interact.reaction',
          ),
          remove: input.remove,
        }
        : { kind: 'pin' as const, remove: input.remove };
    const result = await messagingSubmitMetadataInteraction({
      ...requireMessagingAccount(),
      conversationId,
      messageId,
      interaction,
    });
    return { conversationId, ...result };
  },

  'messaging.read': async (input) => {
    const conversationId = requireString(
      input?.conversationId,
      'messaging.read.conversationId',
    );
    const lastReadSequence = requirePositiveInteger(
      input?.lastReadSequence,
      'messaging.read.lastReadSequence',
    );
    const result = await messagingSubmitReadCursor({
      ...requireMessagingAccount(),
      conversationId,
      lastReadSequence,
    });
    return { conversationId, lastReadSequence, submitted: result.submitted };
  },

  'messaging.typing': async (input) => {
    const conversationId = requireString(
      input?.conversationId,
      'messaging.typing.conversationId',
    );
    if (typeof input?.isTyping !== 'boolean') {
      throw new Error('acceptance.mobile.invalidInput:messaging.typing.isTyping');
    }
    const result = await messagingSubmitTyping({
      ...requireMessagingAccount(),
      conversationId,
      isTyping: input.isTyping,
    });
    return { conversationId, isTyping: input.isTyping, submitted: result.submitted };
  },

  'messaging.reconcile': async () => reconcileActiveMessagingSession(),

  'messaging.command.read': async (input) => messagingCommandStatus({
    ...requireMessagingAccount(),
    commandId: requireString(
      input?.commandId,
      'messaging.command.read.commandId',
    ),
  }),

  'messaging.search': async (input) => sanitizeMessagingMessages(
    await messagingSearchMessages({
      ...requireMessagingAccount(),
      conversationId: requireString(
        input?.conversationId,
        'messaging.search.conversationId',
      ),
      query: requireString(input?.query, 'messaging.search.query'),
      limit: input?.limit === undefined
        ? undefined
        : requirePositiveInteger(input.limit, 'messaging.search.limit'),
    }),
  ),

  'messaging.projection.read': async (input) => {
    const account = requireMessagingAccount();
    const runtime = await messagingStatus();
    const conversations = await messagingListConversations(account);
    const requestedConversationId = input?.conversationId?.trim() ?? '';
    if (
      requestedConversationId
      && !conversations.some(
        (conversation) => conversation.conversationId === requestedConversationId,
      )
    ) {
      throw new Error('acceptance.mobile.messagingConversationNotFound');
    }
    const selected = requestedConversationId
      ? conversations.filter(
        (conversation) => conversation.conversationId === requestedConversationId,
      )
      : conversations;
    const messages = Object.fromEntries(await Promise.all(selected.map(async (conversation) => [
      conversation.conversationId,
      await messagingListMessages({
        ...account,
        conversationId: conversation.conversationId,
      }),
    ] as const)));
    return sanitizeMessagingProjection({ runtime, conversations, messages });
  },

  'social.request.send': async (input) => sendSocialFriendRequest(
    requirePtid(input?.receiverPtid, 'social.request.send.receiverPtid'),
    requireString(
      input?.receiverHomeStationPeerId,
      'social.request.send.receiverHomeStationPeerId',
    ),
    requireString(input?.federationId, 'social.request.send.federationId'),
    input?.message?.trim() || undefined,
  ),

  'social.request.accept': async (input) => acceptSocialFriendRequest(
    requireString(input?.requestId, 'social.request.accept.requestId'),
  ),

  'social.reconcile': async () => reconcileSocialRuntime(),

  'social.projection.read': async () => readSocialRuntimeProjection(),

  cleanup: async () => {
    const station = requireActiveStation(await loadStationRegistry());
    const oauthPurge = await purgeNativeOAuth({
      stationOrigin: station.url,
      stationPeerId: station.stationPeerId,
    });
    await clearAuthRuntimeSession();
    await persistStationRegistry(emptyStationRegistry());
    return {
      oauthPurge,
      webSessionProjectionCleared: true,
      stationRegistryCleared: true,
    };
  },
};

function addVerifiedStation(
  registry: StoredStationRegistry,
  verified: Awaited<ReturnType<typeof verifyStationIdentity>>,
): StoredStationRegistry {
  const result = addStationEntry(
    registry,
    {
      stationPeerId: verified.stationPeerId,
      url: verified.canonicalOrigin,
    },
    {
      checkedAt: verified.verifiedAt,
      online: true,
    },
  );
  if (!result.ok) throw new Error(result.error);
  return result.registry;
}

function stationMutationOutput(
  registry: StoredStationRegistry,
  verified: Awaited<ReturnType<typeof verifyStationIdentity>>,
) {
  return {
    ...sanitizeStationRegistry(registry),
    verifiedStationPeerId: verified.stationPeerId,
    canonicalOrigin: verified.canonicalOrigin,
  };
}

function requireActiveStation(registry: StoredStationRegistry) {
  const station = activeStationEntry(registry);
  if (!station) throw new Error('acceptance.mobile.activeStationRequired');
  return station;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return value.trim();
}

function requirePtid(value: unknown, field: string): string {
  const ptid = requireString(value, field);
  if (!ptid.startsWith('ptid:')) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return ptid;
}

function requirePtidList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return value.map((item, index) => requirePtid(item, `${field}.${index}`));
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return Number(value);
}

function requireSha256(value: unknown, field: string): string {
  const digest = requireString(value, field).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return digest;
}

function decodeBoundedBase64(value: unknown, field: string): Uint8Array<ArrayBuffer> {
  const encoded = requireString(value, field);
  if (encoded.length > 1_398_104) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  try {
    const decoded = globalThis.atob(encoded);
    const buffer = new ArrayBuffer(decoded.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
}

async function sha256Hex(value: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', value));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function requireMessagingAccount(): MessagingAccountInput {
  const session = readActiveAuthSession();
  if (!session?.stationPeerId || !session.actorRef.ptid) {
    throw new Error('acceptance.mobile.activeMessagingSessionRequired');
  }
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorRef.ptid,
  };
}

function requirePublicDecision(
  decision: Parameters<typeof sanitizeAccessDecision>[0],
) {
  const sanitized = sanitizeAccessDecision(decision);
  if (!sanitized) throw new Error('acceptance.mobile.accessDecisionMissing');
  return sanitized;
}

async function cancelAndClearCurrentAuthScope(): Promise<void> {
  await cancelOAuth();
  await clearAuthRuntimeSession();
}
