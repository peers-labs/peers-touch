import { create, toBinary } from '@bufbuild/protobuf';
import { timestampFromMs } from '@bufbuild/protobuf/wkt';
import { invoke } from '@tauri-apps/api/core';

import {
  currentAccessGate,
  isAccessGranted,
  submitStationInviteCodeGate,
  submitStationLoginGate,
  type AccessDecision,
} from '../features/auth/authSession';
import {
  getMobileLifecycleKernel,
  type DraftDisposition,
} from '../app/lifecycle';
import {
  applyMobileNavigationIntent,
  readMobileNavigationProjection,
  type MobileDetailRoute,
  type MobileNavigationIntent,
  type MobileOverlayRoute,
  type MobilePrimaryRouteId,
  type MobileSettingDetailId,
} from '../app/navigation';
import { verifyStationIdentity } from '../features/station/stationConnection';
import {
  activeStationEntry,
  activateStationEntry,
  addStationEntry,
  emptyStationRegistry,
  removeStationEntry,
  type StoredStationRegistry,
} from '../features/station/stationRegistry';
import {
  cancelOAuth,
  readAuthRuntimeSnapshot,
  refreshOAuthStatus,
  startOAuth,
} from '../runtimes/authRuntime';
import {
  applyAccessGateRuntimeResult,
  readAccessRuntimeProjection,
  startAccessAttemptForActiveStation,
} from '../runtimes/accessRuntime';
import {
  activateNativeSessionRuntime,
  logoutSessionRuntime,
  purgeAllNativeSessionState,
  readActiveSessionProjection,
  readSessionRuntimeSnapshot,
} from '../runtimes/sessionRuntime';
import {
  readMobileRuntimeScopeProjection,
} from '../runtimes/runtimeRegistry';
import {
  readStationRegistryProjection,
  replaceStationRegistryProjection,
} from '../runtimes/stationRuntime';
import {
  checkAllPermissions,
  checkPermission,
  fetchNetworkState,
  readNativeLifecycleBridgeDiagnostic,
  requestPermission,
  type PermissionKind,
} from '../runtimes/nativeLifecycleBridge';
import { reconcileActiveMessagingSession } from '../runtimes/messagingRuntime';
import { dispatchOpenContactChat } from '../features/social/contactCommands';
import { mobileCallManager } from '../features/call/callState';
import {
  openPrivateMomentMedia,
  publishPrivateMoment,
  publishPrivateTextMoment,
  readPrivateComments,
  readPrivateMoment,
  readPrivateMomentsSnapshot,
  readPrivateTextMoment,
  recoverPrivateMoment,
  recoverPrivateTextMoment,
  reconcilePrivateMoments,
  storePrivateSocialRecoveryPhrase,
  submitPrivateComment,
  trackPublicMomentPublish,
} from '../runtimes/privateMomentsRuntime';
import {
  acceptSocialFriendRequest,
  applySocialFriendRequestProjectionCheckpoints,
  readSocialRuntimeProjection,
  readFederationContexts,
  readCurrentSocialProfile,
  reconcileSocialRuntime,
  searchSocialPeople,
  sendSocialFriendRequest,
  submitSocialFriendRequest,
  updateCurrentSocialProfile,
} from '../features/social/socialRuntime';
import type { PeerProfile } from '../features/social/socialTypes';
import {
  ChatDraftPayloadSchema,
  MobileDraftEnvelopeV2Schema,
  MobileDraftSurfaceKind,
  MomentDraftPayloadSchema,
} from '../gen/proto/domain/mobile/reliability_pb';
import {
  Audience_Kind,
  AudienceSchema,
  ReactionKind,
  type Post,
} from '../gen/proto/domain/social/post_pb';
import type { Comment } from '../gen/proto/domain/social/comment_pb';
import {
  NotificationPreferencePatchSchema,
  type NotificationPreferencesSnapshot,
} from '../gen/proto/domain/notification/notification_pb';
import {
  applyReliabilityCommandRecoveryAction,
  discardReliabilityDrafts,
  getDraftRestorationPort,
  listReliabilityCommands,
  listReliabilityProjectionCheckpoints,
  readReliabilityRuntimeStatus,
  reconcileReliableFriendRequests,
  reliabilityCommandRecoveryActions,
  resetAllLocalReliabilityData,
  restoreReliabilityDrafts,
  type CommandProjection,
  type DraftProjection,
} from '../runtimes/commandRuntime';
import {
  getRecoveryProjection,
  type RecoveryState,
} from '../runtimes/recoveryProjection';
import { mobileChatStorageProjectionRuntime } from '../runtimes/chatStorageRuntime';
import {
  MobileMutationAdmissionError,
  mobileMutationScopeKey,
  requireMobileMutationAdmission,
} from '../runtimes/mutationAdmission';
import {
  loadDevicePreferences,
  persistDevicePreferences,
  readDeviceSettingsRuntimeSnapshot,
  type DevicePreferences,
} from '../runtimes/deviceSettingsRuntime';
import {
  readCurrentActiveMomentsRuntime,
  readCurrentActiveProfileRuntime,
} from '../runtimes/socialProjectionRuntime';
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
  getSecureStorageValue,
  setSecureStorageValue,
  type MessagingMutationScopeInput,
  type PrivateMomentKind,
  type PrivateMomentMention,
  type PrivateSocialAudience,
  type PrivateSocialMomentIntent,
} from '../services/mobileCommands';
import type { CommandOutcome } from '../services/gateways/gatewayTypes';
import { readSharedBuildIdentity } from './buildIdentity';
import type {
  LifecycleWaitReadyInput,
  LifecycleWaitReadyOutput,
  MobileAcceptanceNamespace,
  PrivateMomentPublishActionOutput,
  PrivateMomentReadActionOutput,
  PrivateMomentSnapshotActionOutput,
  PublicRecoveryState,
  PublicReliabilityDraft,
  PublicReliabilitySnapshot,
  ReliabilityDraftReadInput,
} from './contracts';
import {
  configureOAuthSecureStorageFault,
  purgeNativeOAuth,
  requestCallbackReplayHandle,
  submitNegativeOAuthCallback,
} from './negativeOAuth';
import {
  configureReliabilityAcceptanceFault,
  type ReliabilityAcceptanceFaultMode,
} from './reliabilityFixture';
import {
  sanitizeAccessDecision,
  sanitizeMessagingMessages,
  sanitizeMessagingProjection,
  sanitizeMobileProjection,
  sanitizeOAuthProjection,
  sanitizeSessionRevocation,
  sanitizeStationRegistry,
} from './projection';

export const mobileAcceptanceActions: MobileAcceptanceNamespace = {
  'build.identity': async () => readSharedBuildIdentity(),

  'runtime.prepareActorIdentity': async (input) => {
    const storageKey = requireString(
      input?.storageKey,
      'runtime.prepareActorIdentity.storageKey',
    );
    const seedBase64 = requireString(
      input?.seedBase64,
      'runtime.prepareActorIdentity.seedBase64',
    );
    if (
      !/^mobile-crypto-identity\.v1\.identity\.[0-9a-f]{32}$/.test(storageKey)
      || !/^[A-Za-z0-9+/]{43}=$/.test(seedBase64)
    ) {
      throw new Error(
        'acceptance.mobile.invalidInput:runtime.prepareActorIdentity',
      );
    }
    await setSecureStorageValue(storageKey, seedBase64);
    if (await getSecureStorageValue(storageKey) !== seedBase64) {
      throw new Error('acceptance.mobile.actorIdentityPreparationFailed');
    }
    return { prepared: true };
  },

  'station.add': async (input) => {
    const requestedUrl = requireString(input?.url, 'station.add.url');
    const verified = await verifyStationIdentity(requestedUrl);
    const current = await readStationRegistryProjection();
    const next = addVerifiedStation(current, verified);
    if (current.activeStationPeerId !== verified.stationPeerId) {
      const sessionRevocation = await getMobileLifecycleKernel().transitionScope(
        'station-replace',
        async () => {
          const logout = await cancelAndClearCurrentAuthScope();
          await replaceStationRegistryProjection(next);
          return logout;
        },
        scopeTransitionOptions(input.draftDisposition),
      );
      return {
        ...stationMutationOutput(next, verified),
        sessionRevocation: sanitizeSessionRevocation(sessionRevocation),
      };
    }

    await replaceStationRegistryProjection(next);
    return stationMutationOutput(next, verified);
  },

  'station.replace': async (input) => {
    const currentStationPeerId = requireString(
      input?.stationPeerId,
      'station.replace.stationPeerId',
    );
    const requestedUrl = requireString(input?.url, 'station.replace.url');
    const current = await readStationRegistryProjection();
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
    const sessionRevocation = await getMobileLifecycleKernel().transitionScope(
      'station-replace',
      async () => {
        const logout = await cancelAndClearCurrentAuthScope();
        await replaceStationRegistryProjection(next);
        return logout;
      },
      scopeTransitionOptions(input.draftDisposition),
    );
    return {
      ...stationMutationOutput(next, verified),
      sessionRevocation: sanitizeSessionRevocation(sessionRevocation),
    };
  },

  'station.select': async (input) => {
    const stationPeerId = requireString(
      input?.stationPeerId,
      'station.select.stationPeerId',
    );
    const current = await readStationRegistryProjection();
    if (!current.entries.some((entry) => entry.stationPeerId === stationPeerId)) {
      throw new Error('acceptance.mobile.stationNotFound');
    }
    const next = activateStationEntry(current, stationPeerId);
    const sessionRevocation = current.activeStationPeerId !== next.activeStationPeerId
      ? await getMobileLifecycleKernel().transitionScope(
        'station-replace',
        async () => {
          const logout = await logoutSessionRuntime();
          await replaceStationRegistryProjection(next);
          return logout;
        },
        scopeTransitionOptions(input.draftDisposition),
      )
      : { remoteRevocation: 'not-required' as const, nativePurge: null };
    return {
      ...sanitizeStationRegistry(next),
      sessionRevocation: sanitizeSessionRevocation(sessionRevocation),
    };
  },

  'access.submit': async (input) => {
    if (!input) throw new Error('acceptance.mobile.invalidAccessSubmitInput');
    const station = requireActiveStation(
      await readStationRegistryProjection(),
    );

    if (input.kind === 'start') {
      beginAccessGateLaunch();
      const decision = await startAccessAttemptForActiveStation();
      await completeAccessGateLaunch(decision);
      return {
        decision: requirePublicDecision(decision),
        session: readSessionRuntimeSnapshot().session,
      };
    }

    const attemptId = requireString(
      input?.attemptId,
      'access.submit.attemptId',
    );

    if (input.kind === 'login') {
      const gate = currentAccessGate(readAccessRuntimeProjection().decision);
      if (!gate) throw new Error('acceptance.mobile.accessGateNotReady');
      const result = await submitStationLoginGate({
        stationPeerId: station.stationPeerId,
        stationUrl: station.url,
        attemptId,
        gate,
        email: requireString(input.email, 'access.submit.email'),
        password: requireString(input.password, 'access.submit.password'),
      });
      applyAccessGateRuntimeResult(result.decision);
      if (isAccessGranted(result.decision)) {
        await activateNativeSessionRuntime(station, result.decision);
      }
      await completeAccessGateLaunch(result.decision);
      return {
        decision: requirePublicDecision(result.decision),
        session: readSessionRuntimeSnapshot().session,
      };
    }

    if (input.kind === 'invite-code') {
      const gate = currentAccessGate(readAccessRuntimeProjection().decision);
      if (!gate) throw new Error('acceptance.mobile.accessGateNotReady');
      const result = await submitStationInviteCodeGate({
        stationPeerId: station.stationPeerId,
        stationUrl: station.url,
        attemptId,
        gate,
        inviteCode: requireString(
          input.inviteCode,
          'access.submit.inviteCode',
        ),
      });
      applyAccessGateRuntimeResult(result.decision);
      if (isAccessGranted(result.decision)) {
        await activateNativeSessionRuntime(station, result.decision);
      }
      return {
        decision: requirePublicDecision(result.decision),
        session: readSessionRuntimeSnapshot().session,
      };
    }

    throw new Error('acceptance.mobile.invalidAccessSubmitKind');
  },

  'oauth.start': async (input) => {
    if (!input) throw new Error('acceptance.mobile.invalidOAuthStartInput');
    const station = requireActiveStation(
      await readStationRegistryProjection(),
    );
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

  'lifecycle.snapshot': async () => (
    getMobileLifecycleKernel().getSnapshot()
  ),

  'lifecycle.waitReady': async (input) => waitForLifecycleReady(input),

  'lifecycle.suspend': async () => ({
    snapshot: await getMobileLifecycleKernel().suspend('acceptance-suspend'),
  }),

  'lifecycle.resume': async () => ({
    snapshot: await getMobileLifecycleKernel().resume('acceptance-resume'),
  }),

  'lifecycle.restart': async () => {
    await getMobileLifecycleKernel().restartRuntimeGraph('acceptance-restart');
    return {
      requested: true,
      scope: 'webview',
    };
  },

  'lifecycle.nativeBridgeDiagnostic': async () => (
    readNativeLifecycleBridgeDiagnostic()
  ),

  'lifecycle.secureStorageDeleteFailure': async () => {
    const kernel = getMobileLifecycleKernel();
    await configureOAuthSecureStorageFault('fail-next-remove');
    let errorCode: 'MOBILE_SECURE_STORAGE' | null = null;
    try {
      await kernel.transitionScope(
        'logout',
        purgeAllNativeSessionState,
        { restart: false, draftDisposition: 'discard' },
      );
    } catch (error) {
      if (mobileErrorCode(error) !== 'MOBILE_SECURE_STORAGE') throw error;
      errorCode = 'MOBILE_SECURE_STORAGE';
    } finally {
      await configureOAuthSecureStorageFault('none');
    }
    if (!errorCode) {
      throw new Error('acceptance.mobile.secureStorageDeleteFailureNotObserved');
    }

    const blocked = kernel.getSnapshot();
    if (blocked.phase !== 'COLD' || blocked.launchState === 'shell') {
      throw new Error('acceptance.mobile.secureStorageDeleteFailureDidNotBlock');
    }
    await kernel.transitionScope(
      'logout',
      purgeAllNativeSessionState,
      { draftDisposition: 'discard' },
    );
    return {
      outcome: 'blocked',
      errorCode,
      blocked,
      recovered: kernel.getSnapshot(),
    };
  },

  'lifecycle.scope.read': async () => {
    const stationRegistry = await readStationRegistryProjection();
    const lifecycle = getMobileLifecycleKernel().getSnapshot();
    const runtime = readMobileRuntimeScopeProjection();
    return {
      generation: lifecycle.generation,
      phase: lifecycle.phase,
      launchState: lifecycle.launchState,
      activeStationPeerId: stationRegistry.activeStationPeerId,
      activeActorPtid: runtime.activeActorPtid,
      runtimeStationPeerId: runtime.activeStationPeerId,
      deviceId: runtime.deviceId,
      social: runtime.social,
      group: runtime.group,
      navigation: runtime.navigation,
    };
  },

  'navigation.snapshot': async () => readMobileNavigationProjection(),

  'navigation.apply': async (input) => applyMobileNavigationIntent(
    requireNavigationIntent(input),
  ),

  'platform.permission.check': async (input) => (
    checkPermission(requirePermissionKind(input?.kind))
  ),

  'platform.permission.request': async (input) => (
    requestPermission(requirePermissionKind(input?.kind))
  ),

  'platform.permission.checkAll': async () => checkAllPermissions(),

  'platform.network.read': async () => fetchNetworkState(),

  'session.logout': async (input) => {
    const logout = await getMobileLifecycleKernel().transitionScope(
      'logout',
      logoutSessionRuntime,
      scopeTransitionOptions(input?.draftDisposition),
    );
    beginAccessGateLaunch();
    const decision = await startAccessAttemptForActiveStation();
    await completeAccessGateLaunch(decision);
    return {
      logout: sanitizeSessionRevocation(logout),
      decision: requirePublicDecision(decision),
      lifecycle: getMobileLifecycleKernel().getSnapshot(),
      runtime: readMobileRuntimeScopeProjection(),
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
    stationRegistry: await readStationRegistryProjection(),
    access: readAccessRuntimeProjection(),
    session: readSessionRuntimeSnapshot(),
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

  'messaging.reconcile': async () => {
    return reconcileActiveMessagingSession();
  },

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

  'federation.context.read': async () => ({
    federations: await readFederationContexts(),
  }),

  'social.people.search': async ({ query, federationId }) => {
    const contextId = requireString(
      federationId,
      'social.people.search.federationId',
    );
    const results = await searchSocialPeople(
      requireString(query, 'social.people.search.query'),
      contextId,
    );
    return results.map((result) => ({
      ptid: result.ptid,
      federationId: contextId,
      homeStationPeerId: result.homeStationPeerId,
    }));
  },

  'reliability.fixture.configure': async (input) => (
    configureReliabilityAcceptanceFault(
      requireReliabilityAcceptanceFaultMode(input?.mode),
    )
  ),

  'reliability.friendRequest.submit': async (input) => {
    const submission = await submitSocialFriendRequest(
      requirePtid(
        input?.receiverPtid,
        'reliability.friendRequest.submit.receiverPtid',
      ),
      requireString(
        input?.receiverHomeStationPeerId,
        'reliability.friendRequest.submit.receiverHomeStationPeerId',
      ),
      requireString(
        input?.federationId,
        'reliability.friendRequest.submit.federationId',
      ),
      input?.message?.trim() || undefined,
    );
    return {
      command: {
        commandId: submission.command.commandId,
        requestId: submission.command.requestId,
        payloadSha256: hexBytes(submission.command.payloadSha256),
        state: submission.command.state,
        checkpointReady: submission.command.checkpointReady,
      },
      projection: submission.projection,
    };
  },

  'reliability.snapshot': async () => readPublicReliabilitySnapshot(),

  'reliability.reconcile': async () => {
    const account = requireMessagingAccount();
    const commands = await reconcileReliableFriendRequests(
      account.stationPeerId,
      account.actorPtid,
    );
    const status = await readReliabilityRuntimeStatus();
    const appliedCheckpoints =
      await applySocialFriendRequestProjectionCheckpoints(
        account.stationPeerId,
        account.actorPtid,
        status.runtimeGeneration,
      );
    return {
      commands: commands.map((command) => ({
        commandId: command.commandId,
        requestId: command.requestId,
        payloadSha256: hexBytes(command.payloadSha256),
        state: command.state,
        checkpointReady: command.checkpointReady,
      })),
      appliedCheckpoints,
      snapshot: await readPublicReliabilitySnapshot(),
    };
  },

  'reliability.command.action': async (input) => {
    const commandId = requireString(
      input?.commandId,
      'reliability.command.action.commandId',
    );
    const action = input?.action;
    if (
      action !== 'reconcile'
      && action !== 'cancel'
      && action !== 'acknowledge'
      && action !== 'discard-tracking'
    ) {
      throw new Error(
        'acceptance.mobile.invalidInput:reliability.command.action',
      );
    }
    const snapshot = await readReliabilityOwnerState();
    const command = snapshot.commands.find(
      (candidate) => candidate.commandId === commandId,
    );
    if (!command) {
      throw new Error('acceptance.mobile.reliabilityCommandNotFound');
    }
    if (!reliabilityCommandRecoveryActions(command).includes(action)) {
      throw new Error('acceptance.mobile.reliabilityCommandActionUnavailable');
    }
    await applyReliabilityCommandRecoveryAction(action, [command]);
    return readPublicReliabilitySnapshot();
  },

  'reliability.draft.write': async (input) => {
    const account = requireMessagingAccount();
    const targetId = requireString(
      input?.targetId,
      'reliability.draft.write.targetId',
    );
    const text = requireString(
      input?.text,
      'reliability.draft.write.text',
    );
    const now = Date.now();
    const envelope = input.kind === 'chat'
      ? create(MobileDraftEnvelopeV2Schema, {
          schemaRevision: 2,
          stationPeerId: account.stationPeerId,
          actorPtid: account.actorPtid,
          surfaceKind: MobileDraftSurfaceKind.CHAT_COMPOSER,
          targetId,
          updatedAt: timestampFromMs(now),
          payload: {
            case: 'chat',
            value: create(ChatDraftPayloadSchema, {
              text,
              replyToMessageId: input.replyToMessageId?.trim() ?? '',
              attachmentRefs: [],
            }),
          },
        })
      : input.kind === 'moment'
        ? create(MobileDraftEnvelopeV2Schema, {
            schemaRevision: 2,
            stationPeerId: account.stationPeerId,
            actorPtid: account.actorPtid,
            surfaceKind: MobileDraftSurfaceKind.MOMENT_COMPOSER,
            targetId,
            updatedAt: timestampFromMs(now),
            payload: {
              case: 'moment',
              value: create(MomentDraftPayloadSchema, {
                text,
                audience: create(AudienceSchema, {
                  kind: requirePositiveInteger(
                    input.audienceKind,
                    'reliability.draft.write.audienceKind',
                  ) as Audience_Kind,
                }),
                mediaRefs: [],
              }),
            },
          })
        : null;
    if (!envelope) {
      throw new Error('acceptance.mobile.invalidInput:reliability.draft.write.kind');
    }
    const port = getDraftRestorationPort();
    await port.save(envelope);
    const persisted = await port.load(
      account.stationPeerId,
      account.actorPtid,
      envelope.surfaceKind,
      targetId,
    );
    if (!persisted) {
      throw new Error('acceptance.mobile.reliabilityDraftWriteMissing');
    }
    return publicReliabilityDraft({
      key: `${persisted.surfaceKind}:${persisted.targetId}`,
      kind: input.kind === 'chat' ? 'chat' : 'moments',
      surfaceKind: input.kind,
      targetId: persisted.targetId,
      updatedAtMs: now,
      envelope: persisted,
    });
  },

  'reliability.draft.read': async (input) => {
    const snapshot = await readReliabilityOwnerState();
    return publicReliabilityDrafts(
      filterReliabilityDrafts(snapshot.drafts, input),
    );
  },

  'reliability.draft.action': async (input) => {
    const snapshot = await readReliabilityOwnerState();
    const drafts = filterReliabilityDrafts(snapshot.drafts, input);
    if (drafts.length === 0) {
      throw new Error('acceptance.mobile.reliabilityDraftNotFound');
    }
    if (input.action === 'restore') {
      await restoreReliabilityDrafts(drafts);
    } else if (input.action === 'discard') {
      await discardReliabilityDrafts(drafts);
      getRecoveryProjection().clearDraftRestore();
    } else {
      throw new Error(
        'acceptance.mobile.invalidInput:reliability.draft.action',
      );
    }
    return readPublicReliabilitySnapshot();
  },

  'reliability.reset': async (input) => {
    if (input?.confirmation !== 'reset-all-local-reliability-data') {
      throw new Error('acceptance.mobile.invalidInput:reliability.reset');
    }
    return resetAllLocalReliabilityData();
  },

  'recovery.snapshot': async () => {
    const snapshot = getRecoveryProjection().getSnapshot();
    const session = readSessionRuntimeSnapshot();
    let writeAdmission: {
      open: boolean;
      reason: string | null;
    };
    if (!session.session) {
      writeAdmission = {
        open: false,
        reason: `session_${session.phase}`,
      };
    } else {
      try {
        requireMobileMutationAdmission(
          mobileMutationScopeKey(
            session.session.stationPeerId,
            session.session.actorPtid,
            session.session.deviceId,
            session.session.lifecycleGeneration,
          ),
        );
        writeAdmission = { open: true, reason: null };
      } catch (error) {
        if (!(error instanceof MobileMutationAdmissionError)) throw error;
        writeAdmission = { open: false, reason: error.reason };
      }
    }
    return {
      hasActiveRecovery: snapshot.hasActiveRecovery,
      isWriteBlocked: snapshot.isWriteBlocked,
      writeAdmission,
      updatedAtMs: snapshot.updatedAtMs,
      states: snapshot.states.map(publicRecoveryState),
    };
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

  'social.contact.open': async (input) => {
    requireMessagingAccount();
    const conversationId = await dispatchOpenContactChat(
      requirePtid(input?.peerPtid, 'social.contact.open.peerPtid'),
      requireString(input?.federationId, 'social.contact.open.federationId'),
    );
    return { conversationId };
  },

  'social.reconcile': async () => reconcileSocialRuntime(),

  'social.projection.read': async () => readSocialRuntimeProjection(),

  'moments.private.publish': async (input) => sanitizePrivateMomentPublish(
    await publishPrivateMoment(requirePrivateMomentIntent(input)),
  ),

  'moments.private.publishText': async (input) => sanitizePrivateMomentPublish(
    await publishPrivateTextMoment({
      draftId: requireString(
        input?.draftId,
        'moments.private.publishText.draftId',
      ),
      draftRevision: requirePositiveInteger(
        input?.draftRevision,
        'moments.private.publishText.draftRevision',
      ),
      text: requireString(input?.text, 'moments.private.publishText.text'),
      audience: requirePrivateSocialAudience(input?.audience),
    }),
  ),

  'moments.private.read': async (input) => sanitizePrivateMomentRead(
    await readPrivateMoment(requireString(input?.postId, 'moments.private.read.postId')),
  ),

  'moments.private.readText': async (input) => sanitizePrivateMomentRead(
    await readPrivateTextMoment(
      requireString(input?.postId, 'moments.private.readText.postId'),
    ),
  ),

  'moments.private.media.open': async (input) => sanitizePrivateMomentRead(
    await openPrivateMomentMedia(
      requireString(input?.postId, 'moments.private.media.open.postId'),
      requireString(input?.objectId, 'moments.private.media.open.objectId'),
    ),
  ),

  'moments.private.comment.submit': async (input) => {
    const result = await submitPrivateComment({
      draftId: requireString(input?.draftId, 'moments.private.comment.submit.draftId'),
      draftRevision: requirePositiveInteger(
        input?.draftRevision,
        'moments.private.comment.submit.draftRevision',
      ),
      postId: requireString(input?.postId, 'moments.private.comment.submit.postId'),
      replyToCommentId: input?.replyToCommentId?.trim() || undefined,
      text: requireString(input?.text, 'moments.private.comment.submit.text'),
      mentions: requirePrivateMentions(input?.mentions),
    });
    return sanitizePrivateComment(result.comment, result.draft);
  },

  'moments.private.comments.read': async (input) => sanitizePrivateCommentPage(
    await readPrivateComments(
      requireString(input?.postId, 'moments.private.comments.read.postId'),
      input?.cursor?.trim() || '',
      input?.limit === undefined
        ? 20
        : requirePositiveInteger(input.limit, 'moments.private.comments.read.limit'),
    ),
  ),

  'moments.private.storeRecoveryPhrase': async (input) => {
    const recoveryEpoch = input?.recoveryEpoch === undefined
      ? 1
      : requirePositiveInteger(
        input.recoveryEpoch,
        'moments.private.storeRecoveryPhrase.recoveryEpoch',
      );
    await storePrivateSocialRecoveryPhrase(
      requireString(
        input?.recoveryPhrase,
        'moments.private.storeRecoveryPhrase.recoveryPhrase',
      ),
      recoveryEpoch,
    );
    return { stored: true as const, recoveryEpoch };
  },

  'moments.private.recover': async (input) => sanitizePrivateMomentRead(
    await recoverPrivateMoment(
      requireString(input?.postId, 'moments.private.recover.postId'),
    ),
  ),

  'moments.private.recoverText': async (input) => sanitizePrivateMomentRead(
    await recoverPrivateTextMoment(
      requireString(input?.postId, 'moments.private.recoverText.postId'),
    ),
  ),

  'moments.private.reconcile': async () => {
    await reconcilePrivateMoments();
    return sanitizePrivateMomentSnapshot(readPrivateMomentsSnapshot());
  },

  'moments.private.snapshot': async () => (
    sanitizePrivateMomentSnapshot(readPrivateMomentsSnapshot())
  ),

  'moments.feed.read': async () => {
    const runtime = requireMomentsRuntime();
    if (!await runtime.feed.refresh()) {
      throw new Error('acceptance.mobile.momentsFeedUnavailable');
    }
    const snapshot = runtime.feed.state();
    return {
      outcome: snapshot.pageOutcome,
      hasMore: snapshot.hasMore,
      nextCursor: snapshot.cursor,
      posts: snapshot.posts.map(publicMoment),
    };
  },

  'moments.publish': async (input) => {
    const runtime = requireMomentsRuntime();
    const text = requireString(input?.text, 'moments.publish.text');
    const audienceKind = requireAudienceKind(input?.audienceKind);
    if (audienceKind !== Audience_Kind.PUBLIC) {
      throw new Error('acceptance.mobile.privateMomentRequiresNativeAction');
    }
    const result = await trackPublicMomentPublish(
      () => runtime.gateway.createMoment({
        kind: 'text',
        text,
        audience: create(AudienceSchema, { kind: audienceKind }),
      }),
      (outcome) => outcome.ok && Boolean(outcome.data.post),
    );
    const created = requireAcceptanceOutcome(
      result,
      'acceptance.mobile.momentsPublishFailed',
    );
    if (!created.post) {
      throw new Error('acceptance.mobile.momentsPublishMissingPost');
    }
    await runtime.feed.refresh();
    return publicMoment(created.post);
  },

  'moments.react': async (input) => {
    const runtime = requireMomentsRuntime();
    const postId = requireString(input?.postId, 'moments.react.postId');
    const reactionKind = requireReactionKind(input?.reactionKind);
    const result = input?.active
      ? await runtime.gateway.reactToPost(postId, reactionKind)
      : await runtime.gateway.unreactToPost(postId, reactionKind);
    const updated = requireAcceptanceOutcome(
      result,
      'acceptance.mobile.momentsReactionFailed',
    );
    runtime.feed.updateReaction(postId, updated.reactions);
    return updated.reactions.map((reaction) => ({
      kind: reaction.kind,
      count: reaction.count.toString(),
      reactedByViewer: reaction.reactedByViewer,
    }));
  },

  'moments.comment': async (input) => {
    const runtime = requireMomentsRuntime();
    const result = await runtime.gateway.createComment(
      requireString(input?.postId, 'moments.comment.postId'),
      requireString(input?.content, 'moments.comment.content'),
      input?.replyToCommentId?.trim() || undefined,
    );
    const created = requireAcceptanceOutcome(
      result,
      'acceptance.mobile.momentsCommentFailed',
    );
    if (!created.comment) {
      throw new Error('acceptance.mobile.momentsCommentMissing');
    }
    return publicMomentComment(created.comment);
  },

  'moments.comments.read': async (input) => {
    const runtime = requireMomentsRuntime();
    const result = await runtime.gateway.fetchComments(
      requireString(input?.postId, 'moments.comments.read.postId'),
      '',
      50,
    );
    return requireAcceptanceOutcome(
      result,
      'acceptance.mobile.momentsCommentsUnavailable',
    ).comments.map(publicMomentComment);
  },

  'settings.profile.read': async () => {
    const current = await readCurrentSocialProfile(true);
    return publicProfile(current.actorPtid, current.profile);
  },

  'settings.profile.update': async (input) => {
    const updated = await updateCurrentSocialProfile({
      displayName: optionalText(input?.displayName),
      note: optionalText(input?.note),
      region: optionalText(input?.region),
      timezone: optionalText(input?.timezone),
      defaultVisibility: optionalText(input?.defaultVisibility),
      manuallyApprovesFollowers: optionalBoolean(
        input?.manuallyApprovesFollowers,
      ),
      messagePermission: optionalText(input?.messagePermission),
      autoExpireDays: optionalNonNegativeInteger(input?.autoExpireDays),
    });
    return {
      outcome: updated.result.outcome,
      profile: publicProfile(updated.actorPtid, updated.result.profile),
    };
  },

  'settings.notifications.read': async () => {
    const runtime = requireProfileRuntime();
    const result = await runtime.refreshNotificationPreferences();
    return publicNotificationPreferences(requireAcceptanceOutcome(
      result,
      'acceptance.mobile.notificationPreferencesUnavailable',
    ));
  },

  'settings.notifications.update': async (input) => {
    const runtime = requireProfileRuntime();
    const result = await runtime.updateNotificationPreferences([
      create(NotificationPreferencePatchSchema, {
        category: requirePositiveInteger(
          input?.category,
          'settings.notifications.update.category',
        ),
        enabled: requireBoolean(
          input?.enabled,
          'settings.notifications.update.enabled',
        ),
        pushEnabled: requireBoolean(
          input?.pushEnabled,
          'settings.notifications.update.pushEnabled',
        ),
        soundEnabled: requireBoolean(
          input?.soundEnabled,
          'settings.notifications.update.soundEnabled',
        ),
      }),
    ]);
    const updated = requireAcceptanceOutcome(
      result,
      'acceptance.mobile.notificationPreferencesUpdateFailed',
    );
    return {
      outcome: updated.outcome,
      snapshot: publicNotificationPreferences(updated.snapshot),
    };
  },

  'storage.cache.seed': async (input) => {
    const runtime = await messagingStatus();
    if (!runtime.active || !runtime.stationPeerId || !runtime.actorPtid) {
      throw new Error('acceptance.mobile.messagingUnavailable');
    }
    return invoke<{ sizeBytes: number }>('chat_storage_acceptance_seed_cache', {
      input: {
        stationPeerId: runtime.stationPeerId,
        actorPtid: runtime.actorPtid,
        sizeBytes: requirePositiveInteger(
          input?.sizeBytes,
          'storage.cache.seed.sizeBytes',
        ),
      },
    });
  },

  'storage.conversation-clear.seed': async (input) => {
    const runtime = await messagingStatus();
    if (!runtime.active || !runtime.stationPeerId || !runtime.actorPtid) {
      throw new Error('acceptance.mobile.messagingUnavailable');
    }
    return invoke<{
      conversationId: string;
      messageId: string;
    }>('chat_storage_acceptance_seed_conversation_clear', {
      input: {
        stationPeerId: runtime.stationPeerId,
        actorPtid: runtime.actorPtid,
        plaintextBytes: requirePositiveInteger(
          input?.plaintextBytes,
          'storage.conversation-clear.seed.plaintextBytes',
        ),
      },
    });
  },

  'storage.batch.scenario': async (input) => {
    mobileChatStorageProjectionRuntime.configureAcceptanceBatchScenario({
      delayMs: input?.delayMs,
      failureConversationId: input?.failureConversationId,
      scopeChangeConversationId: input?.scopeChangeConversationId,
    });
    return { configured: true };
  },

  'storage.retention.seed': async (input) => {
    const runtime = await messagingStatus();
    if (!runtime.active || !runtime.stationPeerId || !runtime.actorPtid) {
      throw new Error('acceptance.mobile.messagingUnavailable');
    }
    return invoke<{
      conversationId: string;
      prunedMessageId: string;
      protectedMessageId: string;
      recentMessageId: string;
    }>('chat_storage_acceptance_seed_retention', {
      input: {
        stationPeerId: runtime.stationPeerId,
        actorPtid: runtime.actorPtid,
        oldPlaintextBytes: requirePositiveInteger(
          input?.oldPlaintextBytes,
          'storage.retention.seed.oldPlaintextBytes',
        ),
      },
    });
  },

  'settings.device.read': async () => {
    await loadDevicePreferences();
    const snapshot = readDeviceSettingsRuntimeSnapshot();
    if (snapshot.status !== 'ready') {
      throw new Error('acceptance.mobile.deviceSettingsUnavailable');
    }
    return { ...snapshot.preferences };
  },

  'settings.device.update': async (input) => {
    const preferences = requireDevicePreferences(input);
    await persistDevicePreferences(preferences);
    const snapshot = readDeviceSettingsRuntimeSnapshot();
    if (snapshot.status !== 'ready') {
      throw new Error('acceptance.mobile.deviceSettingsUnavailable');
    }
    return { ...snapshot.preferences };
  },

  getRealtimeDevice: async () => {
    const runtime = await messagingStatus();
    return {
      actorPtid: runtime.actorPtid ?? '',
      deviceId: runtime.deviceId ?? '',
      active: runtime.active && runtime.deviceEnrolled,
    };
  },

  initiateCall: async (input) => {
    const runtime = await messagingStatus();
    if (
      input.callerDeviceId
      && input.callerDeviceId !== runtime.deviceId
    ) {
      throw new Error('acceptance.mobile.callDeviceMismatch');
    }
    return publicCallSnapshot(await mobileCallManager.startOutgoingCall(
      requirePtid(input.calleePtid, 'call.calleePtid'),
      'audio',
    ));
  },

  callResolutionState: async (input) => {
    const snapshot = await mobileCallManager.readResolution(
      requireString(input.callId, 'call.callId'),
    );
    return snapshot ? publicCallSnapshot(snapshot) : null;
  },

  acceptCall: async (input) => {
    const callId = requireString(input.callId, 'call.callId');
    const current = mobileCallManager.getSnapshot();
    if (current?.callId !== callId) {
      throw new Error('acceptance.mobile.callNotFound');
    }
    try {
      return publicCallSnapshot(
        await mobileCallManager.acceptCall() ?? current,
      );
    } catch (error) {
      const snapshot = await mobileCallManager.readResolution(callId);
      if (!snapshot) throw error;
      return { ...publicCallSnapshot(snapshot), conflict: true };
    }
  },

  rejectCall: async (input) => {
    const callId = requireString(input.callId, 'call.callId');
    const current = mobileCallManager.getSnapshot();
    if (current?.callId !== callId) {
      throw new Error('acceptance.mobile.callNotFound');
    }
    try {
      return publicCallSnapshot(
        await mobileCallManager.rejectCall() ?? current,
      );
    } catch (error) {
      const snapshot = await mobileCallManager.readResolution(callId);
      if (!snapshot) throw error;
      return { ...publicCallSnapshot(snapshot), conflict: true };
    }
  },

  cleanup: async () => {
    let oauthPurge: Awaited<ReturnType<typeof purgeNativeOAuth>> | null = null;
    await getMobileLifecycleKernel().transitionScope(
      'logout',
      async () => {
        const logout = await logoutSessionRuntime();
        oauthPurge = logout.nativePurge ?? await purgeNativeOAuth();
        await replaceStationRegistryProjection(emptyStationRegistry());
      },
      { restart: false, draftDisposition: 'discard' },
    );
    if (!oauthPurge) throw new Error('acceptance.mobile.oauthPurgeMissing');
    return {
      oauthPurge,
      webSessionProjectionCleared: true,
      stationRegistryCleared: true,
    };
  },
};

export function publicCallSnapshot(snapshot: {
  callId: string;
  state: string;
  endReason?: string;
  winningDeviceId?: string;
}) {
  const state = snapshot.state === 'ended'
    && (snapshot.endReason === 'rejected' || snapshot.endReason === 'busy')
    ? 'rejected'
    : snapshot.state === 'ended' && snapshot.endReason === 'no-answer'
      ? 'no_answer'
      : snapshot.state;
  return {
    callId: snapshot.callId,
    state,
    winningDeviceId: snapshot.winningDeviceId,
  };
}

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

async function readReliabilityOwnerState() {
  const account = requireMessagingAccount();
  const status = await readReliabilityRuntimeStatus();
  if (
    !status.active
    || status.stationPeerId !== account.stationPeerId
    || status.actorPtid !== account.actorPtid
  ) {
    throw new Error('acceptance.mobile.reliabilityScopeUnavailable');
  }
  const [commands, drafts, checkpoints] = await Promise.all([
    listReliabilityCommands(
      account.stationPeerId,
      account.actorPtid,
      status.runtimeGeneration,
    ),
    getDraftRestorationPort().list(
      account.stationPeerId,
      account.actorPtid,
    ),
    listReliabilityProjectionCheckpoints(
      account.stationPeerId,
      account.actorPtid,
      status.runtimeGeneration,
    ),
  ]);
  return { status, commands, drafts, checkpoints };
}

async function readPublicReliabilitySnapshot(): Promise<PublicReliabilitySnapshot> {
  const { status, commands, drafts, checkpoints } =
    await readReliabilityOwnerState();
  return {
    runtime: { ...status },
    commands: commands.map((command) => ({
      commandId: command.commandId,
      orderingKey: command.orderingKey,
      payloadSha256: hexBytes(command.envelope.payloadSha256),
      state: command.state,
      attemptCount: command.attemptCount,
      typedLastError: command.typedLastError,
      createdAtMs: command.createdAtMs,
      updatedAtMs: command.updatedAtMs,
      nextAttemptAtMs: command.nextAttemptAtMs,
    })),
    drafts: await publicReliabilityDrafts(drafts),
    checkpoints: await Promise.all(checkpoints.map(async (checkpoint) => ({
      commandId: checkpoint.commandId,
      payloadSha256: hexBytes(checkpoint.payloadSha256),
      authoritativeLookupSha256: await sha256Hex(
        Uint8Array.from(checkpoint.authoritativeLookupBytes),
      ),
      createdAtMs: checkpoint.createdAtMs,
    }))),
  };
}

function filterReliabilityDrafts(
  drafts: readonly DraftProjection[],
  input: ReliabilityDraftReadInput | undefined,
): DraftProjection[] {
  if (
    input?.kind !== undefined
    && input.kind !== 'chat'
    && input.kind !== 'moment'
  ) {
    throw new Error('acceptance.mobile.invalidInput:reliability.draft.kind');
  }
  const targetId = input?.targetId?.trim() ?? '';
  return drafts.filter((draft) => (
    (!input?.kind || draft.surfaceKind === input.kind)
    && (!targetId || draft.targetId === targetId)
  ));
}

async function publicReliabilityDrafts(
  drafts: readonly DraftProjection[],
): Promise<PublicReliabilityDraft[]> {
  return Promise.all(drafts.map(publicReliabilityDraft));
}

async function publicReliabilityDraft(
  draft: DraftProjection,
): Promise<PublicReliabilityDraft> {
  return {
    key: draft.key,
    kind: draft.kind,
    surfaceKind: draft.surfaceKind,
    targetId: draft.targetId,
    updatedAtMs: draft.updatedAtMs,
    payloadSha256: await sha256Hex(
      Uint8Array.from(toBinary(MobileDraftEnvelopeV2Schema, draft.envelope)),
    ),
  };
}

function publicRecoveryState(state: RecoveryState): PublicRecoveryState {
  switch (state.kind) {
    case 'draft-restore-pending':
      return {
        kind: state.kind,
        count: state.drafts.length,
        actions: ['restore', 'discard'],
        detail: {
          draftKeys: state.drafts.map((draft) => draft.key),
        },
      };
    case 'command-recovery':
      return {
        kind: state.kind,
        count: state.commands.length,
        actions: [...new Set(state.commands.flatMap(
          reliabilityCommandRecoveryActions,
        ))],
        detail: {
          commandIds: state.commands.map((command) => command.commandId),
        },
      };
    case 'capacity-read-only':
      return {
        kind: state.kind,
        detail: {
          currentDepth: state.currentDepth,
          maxCapacity: state.maxCapacity,
        },
      };
    case 'legacy-reliability-recovery':
      return {
        kind: state.kind,
        actions: ['retain', 'discard-legacy', 'reset-all'],
        detail: {
          archivedLegacyFiles: state.archivedLegacyFiles,
          retainedReadOnly: state.retainedReadOnly,
        },
      };
    case 'reliability-reset-recovery':
      return {
        kind: state.kind,
        actions: ['finish-reset'],
      };
    case 'write-revocation':
      return {
        kind: state.kind,
        detail: state.admission.open
          ? {}
          : {
              reason: state.admission.reason,
              closedAt: state.admission.closedAt,
            },
      };
    case 'session-mismatch':
      return {
        kind: state.kind,
        actions: ['re-authenticate', 'switch-station'],
        detail: {
          expectedStationPeerId: state.expectedStationPeerId,
          actualStationPeerId: state.actualStationPeerId,
          detectedAtMs: state.detectedAtMs,
        },
      };
    case 'event-overflow-reconcile':
      return {
        kind: state.kind,
        detail: {
          staleDomains: state.staleDomains.map((entry) => entry.domain),
        },
      };
    case 'deferred-capability':
      return {
        kind: state.kind,
        detail: {
          runtimeIds: state.unavailableRuntimes.map(
            (runtime) => runtime.runtimeId,
          ),
        },
      };
    case 'device-local-flag':
      return {
        kind: state.kind,
        actions: ['retry', 'switch-station'],
        detail: {
          reason: state.reason,
          since: state.since,
        },
      };
  }
}

function hexBytes(value: ArrayLike<number>): string {
  return Array.from(
    value,
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function requireReliabilityAcceptanceFaultMode(
  value: unknown,
): ReliabilityAcceptanceFaultMode {
  if (
    value === 'none'
    || value === 'hold-before-dispatch'
    || value === 'lose-dispatch-response-and-readback'
    || value === 'fail-checkpoint-acknowledgement'
  ) {
    return value;
  }
  throw new Error(
    'acceptance.mobile.invalidInput:reliability.fixture.mode',
  );
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

function requirePrivateMentions(value: unknown): PrivateMomentMention[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 256) {
    throw new Error('acceptance.mobile.invalidInput:moments.private.mentions');
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`acceptance.mobile.invalidInput:moments.private.mentions.${index}`);
    }
    const mention = item as Record<string, unknown>;
    const offset = Number(mention.offset);
    const length = Number(mention.length);
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) {
      throw new Error(`acceptance.mobile.invalidInput:moments.private.mentions.${index}.range`);
    }
    return {
      actorPtid: requirePtid(
        mention.actorPtid,
        `moments.private.mentions.${index}.actorPtid`,
      ),
      offset,
      length,
      display: requireString(
        mention.display,
        `moments.private.mentions.${index}.display`,
      ),
    };
  });
}

function requirePrivateMomentKind(value: unknown): PrivateMomentKind {
  const kind = requireString(value ?? 'TEXT', 'moments.private.publish.momentKind');
  if (!['TEXT', 'IMAGE', 'VIDEO', 'LINK', 'POLL', 'REPOST', 'LOCATION'].includes(kind)) {
    throw new Error('acceptance.mobile.invalidInput:moments.private.publish.momentKind');
  }
  return kind as PrivateMomentKind;
}

function requirePrivateMomentIntent(value: unknown): PrivateSocialMomentIntent {
  if (!value || typeof value !== 'object') {
    throw new Error('acceptance.mobile.invalidInput:moments.private.publish');
  }
  const input = value as Record<string, unknown>;
  const momentKind = requirePrivateMomentKind(input.momentKind);
  const files = input.files === undefined
    ? []
    : Array.isArray(input.files)
      ? input.files.map((item, index) => {
        if (!item || typeof item !== 'object') {
          throw new Error(`acceptance.mobile.invalidInput:moments.private.publish.files.${index}`);
        }
        const file = item as Record<string, unknown>;
        return {
          handle: requireString(file.handle, `moments.private.publish.files.${index}.handle`),
          attachmentId: requireString(
            file.attachmentId,
            `moments.private.publish.files.${index}.attachmentId`,
          ),
          width: file.width === undefined ? undefined : requireNonNegativeInteger(file.width),
          height: file.height === undefined ? undefined : requireNonNegativeInteger(file.height),
          durationMs: file.durationMs === undefined
            ? undefined
            : requireNonNegativeInteger(file.durationMs),
          altText: typeof file.altText === 'string' ? file.altText : undefined,
        };
      })
      : (() => { throw new Error('acceptance.mobile.invalidInput:moments.private.publish.files'); })();
  const result: PrivateSocialMomentIntent = {
    draftId: requireString(input.draftId, 'moments.private.publish.draftId'),
    draftRevision: requirePositiveInteger(
      input.draftRevision,
      'moments.private.publish.draftRevision',
    ),
    text: requireString(input.text, 'moments.private.publish.text'),
    audience: requirePrivateSocialAudience(input.audience),
    momentKind,
    mentions: requirePrivateMentions(input.mentions),
    files,
  };
  if (momentKind === 'LINK') {
    const link = input.link as Record<string, unknown> | undefined;
    if (!link) throw new Error('acceptance.mobile.invalidInput:moments.private.publish.link');
    result.link = {
      url: requireString(link.url, 'moments.private.publish.link.url'),
      title: requireString(link.title, 'moments.private.publish.link.title'),
      description: typeof link.description === 'string' ? link.description : undefined,
      imageUrl: typeof link.imageUrl === 'string' ? link.imageUrl : undefined,
      siteName: typeof link.siteName === 'string' ? link.siteName : undefined,
      faviconUrl: typeof link.faviconUrl === 'string' ? link.faviconUrl : undefined,
    };
  } else if (momentKind === 'LOCATION') {
    const location = input.location as Record<string, unknown> | undefined;
    if (!location || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) {
      throw new Error('acceptance.mobile.invalidInput:moments.private.publish.location');
    }
    result.location = {
      name: requireString(location.name, 'moments.private.publish.location.name'),
      latitude: Number(location.latitude),
      longitude: Number(location.longitude),
      address: typeof location.address === 'string' ? location.address : undefined,
      placeId: typeof location.placeId === 'string' ? location.placeId : undefined,
    };
  } else if (momentKind === 'POLL') {
    const poll = input.poll as Record<string, unknown> | undefined;
    if (!poll || !Array.isArray(poll.options)) {
      throw new Error('acceptance.mobile.invalidInput:moments.private.publish.poll');
    }
    result.poll = {
      question: requireString(poll.question, 'moments.private.publish.poll.question'),
      options: poll.options.map((option, index) => requireString(
        option,
        `moments.private.publish.poll.options.${index}`,
      )),
      minChoices: requirePositiveInteger(poll.minChoices, 'moments.private.publish.poll.minChoices'),
      maxChoices: requirePositiveInteger(poll.maxChoices, 'moments.private.publish.poll.maxChoices'),
      expiresAtSeconds: requirePositiveInteger(
        poll.expiresAtSeconds,
        'moments.private.publish.poll.expiresAtSeconds',
      ),
    };
  } else if (momentKind === 'REPOST') {
    const repost = input.repost as Record<string, unknown> | undefined;
    if (!repost) throw new Error('acceptance.mobile.invalidInput:moments.private.publish.repost');
    result.repost = {
      sourcePostId: requireString(
        repost.sourcePostId,
        'moments.private.publish.repost.sourcePostId',
      ),
    };
  }
  return result;
}

function requirePrivateSocialAudienceFields(
  audience: Record<string, unknown>,
  allowedFields: readonly string[],
): void {
  const allowed = new Set(['kind', ...allowedFields]);
  const unexpected = Object.keys(audience).find((field) => !allowed.has(field));
  if (unexpected) {
    throw new Error(
      `acceptance.mobile.invalidInput:moments.private.audience.${unexpected}`,
    );
  }
}

function requireCircleId(value: unknown): string {
  const field = 'moments.private.audience.circleId';
  if (
    typeof value !== 'string'
    || !/^[1-9]\d*$/.test(value)
    || BigInt(value) > 18_446_744_073_709_551_615n
  ) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return value;
}

function requireGroupConversationId(value: unknown): string {
  const field = 'moments.private.audience.groupConversationId';
  if (
    typeof value !== 'string'
    || !value
    || value.trim() !== value
    || value.includes('\0')
  ) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return value;
}

function requirePrivateSocialAudience(value: unknown): PrivateSocialAudience {
  if (!value || typeof value !== 'object') {
    throw new Error('acceptance.mobile.invalidInput:moments.private.audience');
  }
  const audience = value as Record<string, unknown>;
  const kind = requireString(
    audience.kind,
    'moments.private.audience.kind',
  );
  if (kind === 'FOLLOWERS' || kind === 'FRIENDS' || kind === 'SELF') {
    requirePrivateSocialAudienceFields(audience, []);
    return { kind };
  }
  if (kind === 'CIRCLE') {
    requirePrivateSocialAudienceFields(audience, ['circleId']);
    return {
      kind,
      circleId: requireCircleId(audience.circleId),
    };
  }
  if (kind === 'GROUP') {
    requirePrivateSocialAudienceFields(audience, ['groupConversationId']);
    return {
      kind,
      groupConversationId: requireGroupConversationId(
        audience.groupConversationId,
      ),
    };
  }
  if (kind === 'CUSTOM_ALLOW') {
    requirePrivateSocialAudienceFields(audience, ['actorPtids']);
    return {
      kind,
      actorPtids: requirePtidList(
        audience.actorPtids,
        'moments.private.audience.actorPtids',
      ),
    };
  }
  if (kind === 'CUSTOM_DENY') {
    requirePrivateSocialAudienceFields(audience, ['actorPtids', 'baseKind']);
    const baseKind = requireString(
      audience.baseKind,
      'moments.private.audience.baseKind',
    );
    if (baseKind !== 'FOLLOWERS' && baseKind !== 'PUBLIC') {
      throw new Error(
        'acceptance.mobile.invalidInput:moments.private.audience.baseKind',
      );
    }
    return {
      kind,
      baseKind,
      actorPtids: requirePtidList(
        audience.actorPtids,
        'moments.private.audience.actorPtids',
      ),
    };
  }
  throw new Error('acceptance.mobile.invalidInput:moments.private.audience.kind');
}

function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return Number(value);
}

function requireNonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('acceptance.mobile.invalidInput:moments.private.nonNegativeInteger');
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

function requirePermissionKind(value: unknown): PermissionKind {
  if (
    value === 'camera'
    || value === 'microphone'
    || value === 'storage'
    || value === 'notifications'
  ) {
    return value;
  }
  throw new Error('acceptance.mobile.invalidInput:platform.permission.kind');
}

async function digestText(value: string | undefined): Promise<string | undefined> {
  return value === undefined
    ? undefined
    : sha256Hex(new TextEncoder().encode(value));
}

async function sanitizePrivateMomentPublish(
  value: Awaited<ReturnType<typeof publishPrivateTextMoment>>,
): Promise<PrivateMomentPublishActionOutput> {
  return {
    draftId: value.draftId,
    draftRevision: value.draftRevision,
    generation: value.generation,
    audienceKind: value.audienceKind,
    state: value.state,
    ...(value.postId ? { postId: value.postId } : {}),
    ...(value.text ? { textSha256: await digestText(value.text) } : {}),
    ...(value.errorCode === undefined ? {} : { errorCode: value.errorCode }),
  };
}

async function sanitizePrivateMomentRead(
  value: Awaited<ReturnType<typeof readPrivateTextMoment>>,
): Promise<PrivateMomentReadActionOutput> {
  const contentText = value.content?.kind === 'REPOST'
    ? value.content.comment
    : value.content?.text;
  const mediaStates = value.content && 'media' in value.content
    ? value.content.media.map((media) => media.state)
    : undefined;
  return {
    postId: value.postId,
    contentId: value.contentId,
    generation: value.generation,
    authorPtid: value.authorPtid,
    audienceKind: value.audienceKind,
    state: value.state,
    ...(value.content
      ? {
        contentKind: value.content.kind,
        ...(contentText ? { textSha256: await digestText(contentText) } : {}),
        ...(mediaStates ? { mediaStates } : {}),
      }
      : {}),
    mentionCount: value.mentions?.length ?? 0,
    ...(value.errorCode ? { errorCode: value.errorCode } : {}),
    ...(value.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: value.retryAfterSeconds }),
  };
}

async function sanitizePrivateComment(
  comment: Awaited<ReturnType<typeof submitPrivateComment>>['comment'],
  draft: Awaited<ReturnType<typeof submitPrivateComment>>['draft'],
) {
  return {
    ...(comment?.commentId ? { commentId: comment.commentId } : {}),
    ...(comment?.contentId ? { contentId: comment.contentId } : {}),
    postId: comment?.postId ?? draft.postId,
    state: comment?.state ?? draft.state,
    ...(comment?.text ? { textSha256: await digestText(comment.text) } : {}),
    mentionCount: comment?.mentions.length ?? draft.mentions.length,
    ...(draft.errorCode ? { errorCode: draft.errorCode } : {}),
    ...(draft.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: draft.retryAfterSeconds }),
  };
}

async function sanitizePrivateCommentPage(
  page: Awaited<ReturnType<typeof readPrivateComments>>,
) {
  return {
    postId: page.postId,
    comments: await Promise.all(page.comments.map(async (comment) => ({
      commentId: comment.commentId,
      contentId: comment.contentId,
      postId: comment.postId,
      state: comment.state,
      ...(comment.text ? { textSha256: await digestText(comment.text) } : {}),
      mentionCount: comment.mentions.length,
    }))),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  };
}

function sanitizePrivateMomentSnapshot(
  value: ReturnType<typeof readPrivateMomentsSnapshot>,
): Promise<PrivateMomentSnapshotActionOutput> {
  return Promise.all([
    Promise.all(value.projections.map(sanitizePrivateMomentPublish)),
    Promise.all(Object.values(value.postsById).map(sanitizePrivateMomentRead)),
  ]).then(([publish, reads]) => ({
    active: value.active,
    reconciling: value.reconciling,
    stationPeerId: value.stationPeerId,
    actorPtid: value.actorPtid,
    publish,
    reads,
    publishStateHistory: [...value.publishStateHistory],
    readStateHistoryByPostId: Object.fromEntries(
      Object.entries(value.readStateHistoryByPostId)
        .map(([postId, states]) => [postId, [...states]]),
    ),
    report: value.lastReport
      ? {
        endpointPrekeysAvailable: value.lastReport.endpointPrekeysAvailable,
        recoveryPrekeysAvailable: value.lastReport.recoveryPrekeysAvailable,
        submissionsProcessed: value.lastReport.submissionsProcessed,
        submissionsUnknown: value.lastReport.submissionsUnknown,
        submissionsTerminal: value.lastReport.submissionsTerminal,
      }
      : null,
    errorPresent: value.errorMessage !== null,
  }));
}

function requireNavigationIntent(value: unknown): MobileNavigationIntent {
  if (!value || typeof value !== 'object') {
    throw new Error('acceptance.mobile.invalidInput:navigation.intent');
  }
  const input = value as Record<string, unknown>;
  switch (input.kind) {
    case 'primary':
      return {
        kind: 'primary',
        routeId: requirePrimaryRouteId(input.routeId),
      };
    case 'detail.push':
      return {
        kind: 'detail.push',
        route: requireDetailRoute(input.route),
      };
    case 'detail.pop':
    case 'overlay.close':
    case 'reset':
      return { kind: input.kind };
    case 'overlay.open':
      return {
        kind: 'overlay.open',
        route: requireOverlayRoute(input.route),
      };
    default:
      throw new Error('acceptance.mobile.invalidInput:navigation.intent.kind');
  }
}

function requirePrimaryRouteId(value: unknown): MobilePrimaryRouteId {
  if (
    value === 'tab:chat'
    || value === 'tab:moments'
    || value === 'tab:contacts'
    || value === 'tab:settings'
  ) {
    return value;
  }
  throw new Error('acceptance.mobile.invalidInput:navigation.primary.routeId');
}

function requireDetailRoute(value: unknown): MobileDetailRoute {
  if (!value || typeof value !== 'object') {
    throw new Error('acceptance.mobile.invalidInput:navigation.detail.route');
  }
  const route = value as Record<string, unknown>;
  switch (route.routeId) {
    case 'detail:chat-conversation':
      return {
        routeId: route.routeId,
        sessionUlid: requireString(
          route.sessionUlid,
          'navigation.detail.sessionUlid',
        ),
      };
    case 'detail:group-conversation':
      return {
        routeId: route.routeId,
        groupUlid: requireString(
          route.groupUlid,
          'navigation.detail.groupUlid',
        ),
      };
    case 'detail:contact-profile':
      return {
        routeId: route.routeId,
        actorPtid: requirePtid(
          route.actorPtid,
          'navigation.detail.actorPtid',
        ),
      };
    case 'detail:moment':
      return {
        routeId: route.routeId,
        postId: requireString(
          route.postId,
          'navigation.detail.postId',
        ),
      };
    case 'detail:setting':
      return {
        routeId: route.routeId,
        settingId: requireSettingDetailId(route.settingId),
      };
    default:
      throw new Error('acceptance.mobile.invalidInput:navigation.detail.routeId');
  }
}

function requireOverlayRoute(value: unknown): MobileOverlayRoute {
  if (!value || typeof value !== 'object') {
    throw new Error('acceptance.mobile.invalidInput:navigation.overlay.route');
  }
  const routeId = (value as Record<string, unknown>).routeId;
  if (routeId === 'overlay:add-friend' || routeId === 'overlay:create-group') {
    return { routeId };
  }
  throw new Error('acceptance.mobile.invalidInput:navigation.overlay.routeId');
}

function requireSettingDetailId(value: unknown): MobileSettingDetailId {
  if (
    value === 'account-info'
    || value === 'notifications'
    || value === 'privacy-security'
    || value === 'safety-number'
    || value === 'blocked-users'
    || value === 'chat-settings'
    || value === 'chat-background'
    || value === 'station-connection'
    || value === 'encryption'
    || value === 'language'
    || value === 'about'
  ) {
    return value;
  }
  throw new Error('acceptance.mobile.invalidInput:navigation.detail.settingId');
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

function mobileErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.match(/\bMOBILE_[A-Z_]+\b/)?.[0] ?? null;
}

async function waitForLifecycleReady(
  input: LifecycleWaitReadyInput | undefined,
  timeoutMs = 10_000,
): Promise<LifecycleWaitReadyOutput> {
  const kernel = getMobileLifecycleKernel();
  const minimumGeneration = input?.minimumGeneration ?? 0;
  if (!Number.isSafeInteger(minimumGeneration) || minimumGeneration < 0) {
    throw new Error('acceptance.mobile.invalidLifecycleGeneration');
  }
  const settled = () => {
    const snapshot = kernel.getSnapshot();
    return snapshot.phase === 'ACTIVE'
      && snapshot.generation >= minimumGeneration
      && snapshot.runtimes.every(
        (runtime) => runtime.status === 'ready' || runtime.status === 'failed',
      )
      ? snapshot
      : null;
  };
  const project = (
    snapshot: ReturnType<typeof kernel.getSnapshot>,
  ): LifecycleWaitReadyOutput => {
    if (!input?.includeDiagnostics) return snapshot;
    return {
      ...snapshot,
      runtimeErrors: kernel.getDiagnosticRuntimeErrors(),
    };
  };
  const current = settled();
  if (current) return Promise.resolve(project(current));

  return new Promise<LifecycleWaitReadyOutput>((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(project(kernel.getSnapshot()));
    }, timeoutMs);
    const check = () => {
      const snapshot = settled();
      if (!snapshot) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(project(snapshot));
    };
    unsubscribe = kernel.subscribe(check);
    check();
  });
}

function requireMomentsRuntime() {
  const runtime = readCurrentActiveMomentsRuntime();
  if (!runtime) {
    throw new Error('acceptance.mobile.activeMomentsRuntimeRequired');
  }
  return runtime;
}

function requireProfileRuntime() {
  const runtime = readCurrentActiveProfileRuntime();
  if (!runtime) {
    throw new Error('acceptance.mobile.activeProfileRuntimeRequired');
  }
  return runtime;
}

function requireAcceptanceOutcome<T>(
  result: CommandOutcome<T>,
  errorKey: string,
): T {
  if (!result.ok) throw new Error(`${errorKey}:${result.error.code}`);
  return result.data;
}

function publicMoment(post: Post) {
  const text = post.content.case === 'textPost'
    || post.content.case === 'imagePost'
    || post.content.case === 'videoPost'
    || post.content.case === 'locationPost'
    ? post.content.value.text
    : post.content.case === 'repostPost'
      ? post.content.value.comment
      : '';
  return {
    postId: post.id,
    authorPtid: post.authorPtid,
    text,
    deleted: post.isDeleted,
    reactions: post.reactions.map((reaction) => ({
      kind: reaction.kind,
      count: reaction.count.toString(),
      reactedByViewer: reaction.reactedByViewer,
    })),
  };
}

function publicMomentComment(comment: Comment) {
  return {
    commentId: comment.id,
    postId: comment.postId,
    authorPtid: comment.authorPtid,
    content: comment.content,
    replyToCommentId: comment.replyToCommentId,
    deleted: comment.isDeleted,
  };
}

function publicProfile(actorPtid: string, profile: PeerProfile) {
  return {
    actorPtid,
    profileRevision: profile.profileRevision.toString(),
    displayName: profile.displayName,
    note: profile.note,
    region: profile.region,
    timezone: profile.timezone,
    defaultVisibility: profile.defaultVisibility,
    manuallyApprovesFollowers: profile.manuallyApprovesFollowers,
    messagePermission: profile.messagePermission,
    autoExpireDays: profile.autoExpireDays,
  };
}

function publicNotificationPreferences(
  snapshot: NotificationPreferencesSnapshot,
) {
  return {
    revision: snapshot.notificationPreferencesRevision.toString(),
    preferences: snapshot.preferences.map((preference) => ({
      category: preference.category,
      enabled: preference.enabled,
      pushEnabled: preference.pushEnabled,
      soundEnabled: preference.soundEnabled,
    })),
  };
}

function requireAudienceKind(value: unknown): Audience_Kind {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 8) {
    throw new Error('acceptance.mobile.invalidInput:moments.publish.audienceKind');
  }
  return Number(value) as Audience_Kind;
}

function requireReactionKind(value: unknown): ReactionKind {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 5) {
    throw new Error('acceptance.mobile.invalidInput:moments.react.reactionKind');
  }
  return Number(value) as ReactionKind;
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`acceptance.mobile.invalidInput:${field}`);
  }
  return value;
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error('acceptance.mobile.invalidInput:settings.profile.text');
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined) return undefined;
  return requireBoolean(value, 'settings.profile.boolean');
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('acceptance.mobile.invalidInput:settings.profile.integer');
  }
  return Number(value);
}

function requireDevicePreferences(value: unknown): DevicePreferences {
  if (!value || typeof value !== 'object') {
    throw new Error('acceptance.mobile.invalidInput:settings.device');
  }
  const input = value as Record<string, unknown>;
  if (
    !['system', 'light', 'dark'].includes(String(input.theme))
    || !['small', 'medium', 'large'].includes(String(input.fontSize))
  ) {
    throw new Error('acceptance.mobile.invalidInput:settings.device');
  }
  return {
    theme: input.theme as DevicePreferences['theme'],
    fontSize: input.fontSize as DevicePreferences['fontSize'],
    compactMode: requireBoolean(
      input.compactMode,
      'settings.device.compactMode',
    ),
    mediaAutoDownload: requireBoolean(
      input.mediaAutoDownload,
      'settings.device.mediaAutoDownload',
    ),
  };
}

function requireMessagingAccount(): MessagingMutationScopeInput {
  const session = readActiveSessionProjection();
  if (!session?.stationPeerId || !session.actorPtid) {
    throw new Error('acceptance.mobile.activeMessagingSessionRequired');
  }
  return {
    stationPeerId: session.stationPeerId,
    actorPtid: session.actorPtid,
    deviceId: session.deviceId,
    lifecycleGeneration: session.lifecycleGeneration,
  };
}

function requirePublicDecision(
  decision: Parameters<typeof sanitizeAccessDecision>[0],
) {
  const sanitized = sanitizeAccessDecision(decision);
  if (!sanitized) throw new Error('acceptance.mobile.accessDecisionMissing');
  return sanitized;
}

async function cancelAndClearCurrentAuthScope() {
  return logoutSessionRuntime();
}

function scopeTransitionOptions(
  value: unknown,
): { readonly draftDisposition?: DraftDisposition } {
  if (value === undefined) return {};
  if (value === 'retain' || value === 'discard') {
    return { draftDisposition: value };
  }
  throw new Error('acceptance.mobile.invalidInput:draftDisposition');
}

function beginAccessGateLaunch(): void {
  const kernel = getMobileLifecycleKernel();
  if (kernel.getSnapshot().launchState === 'station-selection') {
    kernel.transitionLaunchState('station-handshake');
  }
}

async function completeAccessGateLaunch(
  decision: AccessDecision,
): Promise<void> {
  const kernel = getMobileLifecycleKernel();
  if (isAccessGranted(decision)) {
    await kernel.reconcileLaunchState('access-granted');
    return;
  }
  if (kernel.getSnapshot().launchState === 'station-handshake') {
    kernel.transitionLaunchState('access-gate-chain');
  }
}
