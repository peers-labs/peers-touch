import type {
  AuthRuntimeRecovery,
} from '../runtimes/authRuntime';
import type {
  DraftDisposition,
  LifecycleKernelSnapshot,
} from '../app/lifecycle';
import type {
  MobileNavigationIntent,
  MobileNavigationProjection,
} from '../app/navigation';
import type {
  MobileOAuthProvider,
  OAuthPublicPhase,
  PrivateSocialAudience,
  PrivateSocialPublishState,
  PrivateSocialReadState,
} from '../services/mobileCommands';
import type {
  NetworkState,
  PermissionCheckResult,
  PermissionKind,
  PermissionRequestResult,
} from '../runtimes/nativeLifecycleBridge';
import type { DevicePreferences } from '../runtimes/deviceSettingsRuntime';
import type { EmbeddedMobileBuildIdentity } from './buildIdentity';

export const MOBILE_ACCEPTANCE_ACTION_NAMES = [
  'build.identity',
  'runtime.prepareActorIdentity',
  'station.add',
  'station.replace',
  'station.select',
  'access.submit',
  'oauth.start',
  'oauth.status',
  'oauth.cancel',
  'oauth.replayHandle',
  'oauth.negativeCallback',
  'lifecycle.snapshot',
  'lifecycle.waitReady',
  'lifecycle.suspend',
  'lifecycle.resume',
  'lifecycle.restart',
  'lifecycle.nativeBridgeDiagnostic',
  'lifecycle.secureStorageDeleteFailure',
  'lifecycle.scope.read',
  'navigation.snapshot',
  'navigation.apply',
  'platform.permission.check',
  'platform.permission.request',
  'platform.permission.checkAll',
  'platform.network.read',
  'session.logout',
  'native.deliverDeepLink',
  'projection.read',
  'federation.context.read',
  'messaging.createDirect',
  'messaging.createGroup',
  'messaging.attachment.stage',
  'messaging.attachment.open',
  'messaging.send',
  'messaging.interact',
  'messaging.read',
  'messaging.typing',
  'messaging.reconcile',
  'messaging.command.read',
  'messaging.search',
  'messaging.projection.read',
  'social.people.search',
  'reliability.fixture.configure',
  'reliability.friendRequest.submit',
  'reliability.snapshot',
  'reliability.reconcile',
  'reliability.command.action',
  'reliability.draft.write',
  'reliability.draft.read',
  'reliability.draft.action',
  'reliability.reset',
  'recovery.snapshot',
  'social.request.send',
  'social.request.accept',
  'social.contact.open',
  'social.reconcile',
  'social.projection.read',
  'moments.private.publishText',
  'moments.private.readText',
  'moments.private.reconcile',
  'moments.private.snapshot',
  'moments.feed.read',
  'moments.publish',
  'moments.react',
  'moments.comment',
  'moments.comments.read',
  'storage.cache.seed',
  'storage.conversation-clear.seed',
  'storage.batch.scenario',
  'storage.retention.seed',
  'settings.profile.read',
  'settings.profile.update',
  'settings.notifications.read',
  'settings.notifications.update',
  'settings.device.read',
  'settings.device.update',
  'getRealtimeDevice',
  'initiateCall',
  'callResolutionState',
  'acceptCall',
  'rejectCall',
  'cleanup',
] as const;

export type MobileAcceptanceActionName =
  typeof MOBILE_ACCEPTANCE_ACTION_NAMES[number];

export interface StationAddInput {
  url: string;
  draftDisposition?: DraftDisposition;
}

export interface StationReplaceInput {
  stationPeerId: string;
  url: string;
  draftDisposition?: DraftDisposition;
}

export interface StationSelectInput {
  stationPeerId: string;
  draftDisposition?: DraftDisposition;
}

export interface PublicStationEntry {
  stationPeerId: string;
  url: string;
  label: string;
  online?: boolean;
  lastCheckedAt?: number;
}

export interface StationMutationOutput {
  activeStationPeerId: string;
  verifiedStationPeerId: string;
  canonicalOrigin: string;
  entries: PublicStationEntry[];
  sessionRevocation?: SessionRevocationProjection;
}

export interface StationSelectionOutput {
  activeStationPeerId: string;
  entries: PublicStationEntry[];
  sessionRevocation: SessionRevocationProjection;
}

export interface SessionRevocationProjection {
  remoteRevocation: 'confirmed' | 'unconfirmed' | 'not-required';
}

export interface PlatformPermissionInput {
  kind: PermissionKind;
}

export type AccessSubmitInput =
  | {
    kind: 'start';
  }
  | {
    kind: 'login';
    attemptId: string;
    email: string;
    password: string;
  }
  | {
    kind: 'invite-code';
    attemptId: string;
    inviteCode: string;
  };

export interface PublicAccessGate {
  gateId: string;
  type: number | string;
  state: number | string;
}

export interface PublicAccessDecision {
  state: number | string;
  attemptId: string;
  currentGateId?: string;
  accessGrantId?: string;
  gates: PublicAccessGate[];
}

export interface AccessSubmitOutput {
  decision: PublicAccessDecision;
  session: {
    stationPeerId: string;
    actorPtid: string;
    expiresAt?: string;
  } | null;
}

export interface OAuthStartActionInput {
  provider: MobileOAuthProvider;
  accessAttemptId: string;
  gateId: string;
}

export type NegativeOAuthClientId = 'alice-ios' | 'alice-android';
export type NegativeOAuthOperation =
  | 'replay'
  | 'provider_mismatch'
  | 'station_mismatch';
export type NegativeOAuthExpectedFailure =
  | 'oauthReplay'
  | 'oauthProviderMismatch'
  | 'oauthStationMismatch';
export type AcceptanceLeaseState =
  | 'LEASED'
  | 'BASELINE_VERIFIED'
  | 'IN_USE';
export type PhysicalDeviceLeaseRef =
  `physical-device-lease/${NegativeOAuthClientId}`;
export type ProviderAccountLeaseRef =
  `provider-account-lease/${MobileOAuthProvider}`;
export type BrowserSessionLeaseRef =
  `browser-session-lease/${NegativeOAuthClientId}`;
export type AcceptanceLeaseRef =
  | PhysicalDeviceLeaseRef
  | ProviderAccountLeaseRef
  | BrowserSessionLeaseRef;

export interface AcceptanceBuildBinding {
  buildId: string;
  harnessEnabled: true;
}

export interface AcceptanceLeaseBinding {
  leaseRef: AcceptanceLeaseRef;
  holderRunId: string;
  fenceToken: number;
  state: AcceptanceLeaseState;
  expiresAtUnixMs: number;
}

export interface AcceptanceStationBinding {
  serviceId: 'station-primary' | 'station-secondary';
  stationOrigin: string;
  stationPeerId: string;
}

export interface AcceptanceRuntimeContext {
  build: AcceptanceBuildBinding;
  leases: [
    AcceptanceLeaseBinding,
    AcceptanceLeaseBinding,
    AcceptanceLeaseBinding,
  ];
  services: AcceptanceStationBinding[];
}

export interface CallbackReplayHandleInput {
  runId: string;
  gateId: 'mobile-native-access-e2e';
  clientId: NegativeOAuthClientId;
  context: AcceptanceRuntimeContext;
}

export interface CallbackReplayHandleOutput {
  callbackReplayHandle: string;
}

export interface NegativeOAuthFenceTokens {
  physicalDevice: number;
  providerAccount: number;
  browserSession: number;
}

interface NegativeOAuthIntentBase {
  artifactKind: 'mobile-oauth-negative-callback-intent';
  runId: string;
  gateId: 'mobile-native-access-e2e';
  clientId: NegativeOAuthClientId;
  requiredLeaseRefs: [
    PhysicalDeviceLeaseRef,
    ProviderAccountLeaseRef,
    BrowserSessionLeaseRef,
  ];
  holderRunId: string;
  fenceTokens: NegativeOAuthFenceTokens;
}

export type NegativeOAuthIntent =
  | (NegativeOAuthIntentBase & {
    variantId: `replay-${'ios' | 'android'}`;
    operation: 'replay';
    callbackReplayHandle: string;
    replayMode: 'different_after_claim';
    alternateServiceId: '';
    expectedFailure: 'oauthReplay';
  })
  | (NegativeOAuthIntentBase & {
    variantId: `provider-mismatch-${'ios' | 'android'}`;
    operation: 'provider_mismatch';
    callbackReplayHandle: '';
    replayMode: '';
    alternateServiceId: '';
    expectedFailure: 'oauthProviderMismatch';
  })
  | (NegativeOAuthIntentBase & {
    variantId: `station-mismatch-${'ios' | 'android'}`;
    operation: 'station_mismatch';
    callbackReplayHandle: '';
    replayMode: '';
    alternateServiceId: AcceptanceStationBinding['serviceId'];
    expectedFailure: 'oauthStationMismatch';
  });

export interface NegativeOAuthCallbackInput {
  context: AcceptanceRuntimeContext;
  intent: NegativeOAuthIntent;
}

export interface PublicNegativeOAuthProjection {
  phase: OAuthPublicPhase;
  stationPeerId?: string;
  provider?: string;
  accessAttemptId?: string;
  gateId?: string;
  expiresAtUnixMs?: number;
  result?: string;
  errorCode?: string;
  candidatePtid?: string;
  accessDecision: {
    state?: string;
    currentGateId?: string;
  } | null;
  sessionPresent: boolean;
}

export interface NegativeOAuthCallbackOutput {
  operation: NegativeOAuthOperation;
  failure: NegativeOAuthExpectedFailure;
  projection: PublicNegativeOAuthProjection;
}

export interface OAuthPurgeInput {
  stationOrigin: string;
  stationPeerId: string;
}

export type OAuthStationRevocation =
  | 'not_required'
  | 'confirmed'
  | 'unconfirmed';

export interface OAuthSecureStorageAbsence {
  activeAttemptIndexAbsent: boolean;
  attemptSecretRecordAbsent: boolean;
  currentSessionIndexAbsent: boolean;
  credentialRecordAbsent: boolean;
  publicProjectionAbsent: boolean;
}

export interface OAuthPurgeOutput {
  stationRevocation: OAuthStationRevocation;
  secureStorage: OAuthSecureStorageAbsence;
}

export interface PublicOAuthProjection {
  phase: OAuthPublicPhase;
  stationPeerId?: string;
  provider?: string;
  accessAttemptId?: string;
  gateId?: string;
  expiresAtUnixMs?: number;
  result?: string;
  errorCode?: string;
  candidatePtid: string | null;
  accessDecision: PublicAccessDecision | null;
  session: {
    actorPtid: string;
    expiresAt?: string;
  } | null;
  errorKey: string | null;
  recovery: AuthRuntimeRecovery;
}

export interface MobilePublicProjection {
  station: {
    activeStationPeerId: string;
    entries: PublicStationEntry[];
  };
  access: {
    decision: PublicAccessDecision | null;
    session: {
      stationPeerId: string;
      actorPtid: string;
      expiresAt?: string;
    } | null;
    loading: boolean;
    errorKey: string | null;
    restored: boolean;
  };
  oauth: PublicOAuthProjection;
}

export interface LifecycleRestartOutput {
  requested: true;
  scope: 'webview';
}

export interface LifecycleWaitReadyInput {
  minimumGeneration?: number;
  includeDiagnostics?: boolean;
}

export type PublicLifecycleSnapshot = LifecycleKernelSnapshot;

export interface LifecycleWaitReadyOutput extends LifecycleKernelSnapshot {
  runtimeErrors?: readonly {
    runtimeId: string;
    error: string;
  }[];
}

export interface SecureStorageDeleteFailureOutput {
  outcome: 'blocked';
  errorCode: 'MOBILE_SECURE_STORAGE';
  blocked: PublicLifecycleSnapshot;
  recovered: PublicLifecycleSnapshot;
}

export interface LifecycleTransitionOutput {
  snapshot: PublicLifecycleSnapshot;
}

export interface MobileRuntimeScopeProjection {
  activeStationPeerId: string | null;
  activeActorPtid: string | null;
  deviceId: string | null;
  social: {
    stationPeerId: string | null;
    actorPtid: string | null;
    sessionCount: number;
    requestCount: number;
    messageThreadCount: number;
  };
  group: {
    stationPeerId: string | null;
    actorPtid: string | null;
    groupCount: number;
    messageThreadCount: number;
  };
  navigation: MobileNavigationProjection;
}

export interface LifecycleScopeReadOutput {
  generation: number;
  phase: PublicLifecycleSnapshot['phase'];
  launchState: PublicLifecycleSnapshot['launchState'];
  activeStationPeerId: string;
  activeActorPtid: string | null;
  deviceId: string | null;
  runtimeStationPeerId: string | null;
  social: MobileRuntimeScopeProjection['social'];
  group: MobileRuntimeScopeProjection['group'];
  navigation: MobileRuntimeScopeProjection['navigation'];
}

export interface SessionLogoutOutput {
  logout: SessionRevocationProjection;
  decision: PublicAccessDecision;
  lifecycle: PublicLifecycleSnapshot;
  runtime: MobileRuntimeScopeProjection;
}

export interface SessionLogoutInput {
  draftDisposition?: DraftDisposition;
}

export interface NativeDeepLinkInput {
  url: string;
}

export interface NativeDeepLinkOutput {
  supported: false;
  reason: 'external-driver-required';
  owner: 'appium-native-context';
}

export interface MessagingCreateDirectActionInput {
  peerPtid: string;
  federationId: string;
}

export interface MessagingCreateGroupActionInput {
  conversationId: string;
  name: string;
  memberPtids: string[];
  federationId: string;
}

export type MessagingCreateDirectActionOutput = {
  conversationId: string;
  commandId: string;
  state: 'pending' | 'projected';
};

export type MessagingCreateGroupActionOutput = {
  conversationId: string;
  commandId: string;
  state: 'pending' | 'projected' | 'failed';
};

export interface MessagingStageAttachmentActionInput {
  filename: string;
  mimeType: string;
  bytesBase64: string;
  sha256: string;
}

export interface MessagingStageAttachmentActionOutput {
  stageId: string;
  filename: string;
  mimeType: string;
  plaintextSize: number;
  completed: boolean;
}

export interface MessagingOpenAttachmentActionInput {
  attachmentId: string;
}

export type MessagingOpenAttachmentActionOutput =
  | { state: 'ready'; available: true }
  | { state: 'pending'; available: false; nextAttemptAtUnixMs: number };

export interface MessagingSendActionInput {
  conversationId: string;
  plaintext: string;
  replyToMessageId?: string;
  threadRootMessageId?: string;
  attachmentStageIds?: string[];
}

export type MessagingSendActionOutput =
  | {
    conversationId: string;
    commandId: string;
    messageId: string;
    attachmentIds: string[];
    state: 'pending';
  }
  | {
    conversationId: string;
    messageId: string;
    attachmentIds: string[];
    state: 'draft';
  };

export type MessagingInteractionActionInput =
  | {
    kind: 'edit';
    conversationId: string;
    messageId: string;
    plaintext: string;
  }
  | {
    kind: 'retract';
    conversationId: string;
    messageId: string;
  }
  | {
    kind: 'reaction';
    conversationId: string;
    messageId: string;
    reaction: string;
    remove: boolean;
  }
  | {
    kind: 'pin';
    conversationId: string;
    messageId: string;
    remove: boolean;
  };

export interface MessagingInteractionActionOutput {
  conversationId: string;
  commandId: string;
  messageId: string;
  attachmentIds: string[];
  state: 'pending';
}

export interface MessagingReadActionInput {
  conversationId: string;
  lastReadSequence: number;
}

export interface MessagingTypingActionInput {
  conversationId: string;
  isTyping: boolean;
}

export interface MessagingCommandReadActionInput {
  commandId: string;
}

export interface MessagingSearchActionInput {
  conversationId: string;
  query: string;
  limit?: number;
}

export interface MessagingProjectionReadActionInput {
  conversationId?: string;
}

export interface MessagingReconcileActionOutput {
  deviceEnrolled: boolean;
  processed: number;
  cursor: number;
  laneHead: number;
  consumerEpoch: number;
  deliveryReceiptSubmitted: boolean;
  commandState:
    | 'idle'
    | 'submitted'
    | 'retry_scheduled'
    | 'failed'
    | 'stale_delivery_plan'
    | 'stale_authority_plan';
  commandId?: string;
  nextAttemptAtUnixMs?: number;
}

export interface PublicMessagingAttachmentProjection {
  attachmentId: string;
  filename: string;
  mimeType: string;
  plaintextSize: number;
  ciphertextSize?: number;
  availabilityState?: 'remote' | 'local';
}

export interface PublicMessagingMessageProjection {
  eventId?: string;
  eventSequence?: number;
  messageId: string;
  senderPtid: string;
  state:
    | 'draft'
    | 'pending'
    | 'prepared'
    | 'retry_wait'
    | 'submitted'
    | 'failed'
    | 'terminal'
    | 'accepted'
    | 'delivered'
    | 'read';
  timestampUnixMs: number;
  replyToMessageId?: string;
  threadRootMessageId?: string;
  editedText?: string;
  editedAtUnixMs?: number;
  retracted: boolean;
  reactions: Array<{
    actorPtid: string;
    reaction: string;
    createdAtUnixMs: number;
  }>;
  pinnedByPtid?: string;
  pinnedAtUnixMs?: number;
  readByPtids: string[];
  plaintext: string;
  attachments: PublicMessagingAttachmentProjection[];
}

export interface PublicMessagingProjection {
  runtime: {
    active: boolean;
    profileId?: string;
    stationPeerId?: string;
    actorPtid?: string;
    deviceId?: string;
    deviceEnrolled: boolean;
    laneSequence: number;
    consumerEpoch: number;
    conversationCount: number;
    activationGeneration: number;
    workerPhase: 'running' | 'suspended' | 'stopping';
  };
  conversations: Array<{
    conversationId: string;
    authorityStationId: string;
    federationId: string;
    kind: number;
    name: string;
    ownerPtid: string;
    memberPtids: string[];
    membershipEpoch: number;
    mlsEpoch: number;
    active: boolean;
    updatedAtUnixMs: number;
  }>;
  messages: Record<string, PublicMessagingMessageProjection[]>;
}

export interface PublicSocialRuntimeProjection {
  active: boolean;
  activeSessionUlid: string | null;
  friendRequests: Array<{
    requestId: string;
    federationId: string;
    senderPtid: string;
    receiverPtid: string;
    senderHomeStationPeerId: string;
    receiverHomeStationPeerId: string;
    status: number;
  }>;
  typingPeers: Record<string, Record<string, {
    typing: boolean;
    lastUpdate: number;
  }>>;
  peerOnline: Record<string, boolean>;
  lastReconcileAt: number | null;
  ingress: {
    lifecycle: 'active' | 'suspended' | 'torn';
    streamCursor: string;
    writeAdmissionOpen: boolean;
    staleDomains: string[];
    dataQueueDepth: number;
    controlQueueDepth: number;
  } | null;
}

export type PublicReliabilityCommandState =
  | 'pending'
  | 'failed-retryable'
  | 'committed'
  | 'failed-terminal'
  | 'unknown-outcome'
  | 'reconciling'
  | 'cancelled';

export interface PublicReliabilityCommand {
  commandId: string;
  orderingKey: string;
  payloadSha256: string;
  state: PublicReliabilityCommandState;
  attemptCount: number;
  typedLastError: number;
  createdAtMs: number;
  updatedAtMs: number;
  nextAttemptAtMs: number | null;
}

export interface PublicReliabilityDraft {
  key: string;
  kind: 'chat' | 'moments';
  surfaceKind: 'chat' | 'moment';
  targetId: string;
  updatedAtMs: number;
  payloadSha256: string;
}

export interface PublicReliabilityCheckpoint {
  commandId: string;
  payloadSha256: string;
  authoritativeLookupSha256: string;
  createdAtMs: number;
}

export interface PublicReliabilitySnapshot {
  runtime: {
    active: boolean;
    stationPeerId?: string;
    actorPtid?: string;
    runtimeGeneration: number;
    admissionOpen: boolean;
    pendingCommands: number;
    unknownCommands: number;
    draftCount: number;
    recoveryState?: 'legacy-disposition-required' | 'reset-incomplete';
    archivedLegacyFiles: number;
  };
  commands: PublicReliabilityCommand[];
  drafts: PublicReliabilityDraft[];
  checkpoints: PublicReliabilityCheckpoint[];
}

export interface ReliabilityFriendRequestSubmitOutput {
  command: {
    commandId: string;
    requestId: string;
    payloadSha256: string;
    state: PublicReliabilityCommandState;
    checkpointReady: boolean;
  };
  projection: PublicSocialRuntimeProjection;
}

export interface ReliabilityReconcileOutput {
  commands: Array<{
    commandId: string;
    requestId: string;
    payloadSha256: string;
    state: PublicReliabilityCommandState;
    checkpointReady: boolean;
  }>;
  appliedCheckpoints: number;
  snapshot: PublicReliabilitySnapshot;
}

export interface ReliabilityFixtureConfigureInput {
  mode:
    | 'none'
    | 'hold-before-dispatch'
    | 'lose-dispatch-response-and-readback'
    | 'fail-checkpoint-acknowledgement';
}

export interface ReliabilityFixtureConfigureOutput {
  mode: ReliabilityFixtureConfigureInput['mode'];
}

export interface ReliabilityCommandActionInput {
  commandId: string;
  action: 'reconcile' | 'cancel' | 'acknowledge' | 'discard-tracking';
}

export type ReliabilityDraftWriteInput =
  | {
    kind: 'chat';
    targetId: string;
    text: string;
    replyToMessageId?: string;
  }
  | {
    kind: 'moment';
    targetId: string;
    text: string;
    audienceKind: number;
  };

export interface ReliabilityDraftReadInput {
  kind?: 'chat' | 'moment';
  targetId?: string;
}

export interface ReliabilityDraftActionInput
  extends ReliabilityDraftReadInput {
  action: 'restore' | 'discard';
}

export interface ReliabilityResetInput {
  confirmation: 'reset-all-local-reliability-data';
}

export interface ReliabilityCleanupOutput {
  recordsAbsent: boolean;
  pathsAbsent: boolean;
  keysAbsent: boolean;
  securePhysicalDeletionProven: false;
}

export interface PublicRecoveryState {
  kind:
    | 'legacy-reliability-recovery'
    | 'reliability-reset-recovery'
    | 'draft-restore-pending'
    | 'command-recovery'
    | 'capacity-read-only'
    | 'write-revocation'
    | 'session-mismatch'
    | 'event-overflow-reconcile'
    | 'deferred-capability'
    | 'device-local-flag';
  count?: number;
  actions?: string[];
  detail?: Record<string, string | number | boolean | string[]>;
}

export interface PublicRecoverySnapshot {
  hasActiveRecovery: boolean;
  isWriteBlocked: boolean;
  writeAdmission: {
    open: boolean;
    reason: string | null;
  };
  updatedAtMs: number;
  states: PublicRecoveryState[];
}

export interface SocialRequestSendActionInput {
  receiverPtid: string;
  receiverHomeStationPeerId: string;
  federationId: string;
  message?: string;
}

export interface SocialPeopleSearchActionInput {
  query: string;
  federationId: string;
}

export interface FederationContextReadOutput {
  federations: Array<{ federationId: string; name: string; status: string }>;
}

export interface PublicActorSearchResult {
  ptid: string;
  federationId: string;
  homeStationPeerId: string;
}

export interface SocialRequestAcceptActionInput {
  requestId: string;
}

export interface PrivateMomentPublishActionInput {
  draftId: string;
  draftRevision: number;
  text: string;
  audience: PrivateSocialAudience;
}

export interface PrivateMomentPublishActionOutput {
  draftId: string;
  draftRevision: number;
  generation: number;
  audienceKind: PrivateSocialAudience['kind'];
  state: PrivateSocialPublishState;
  postId?: string;
  textSha256?: string;
  errorCode?: number;
}

export interface PrivateMomentReadActionInput {
  postId: string;
}

export interface PrivateMomentReadActionOutput {
  postId: string;
  contentId: string;
  generation: string;
  authorPtid: string;
  audienceKind: string;
  state: PrivateSocialReadState;
  contentKind?: 'TEXT';
  textSha256?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
}

export interface PrivateMomentSnapshotActionOutput {
  active: boolean;
  reconciling: boolean;
  stationPeerId: string | null;
  actorPtid: string | null;
  publish: PrivateMomentPublishActionOutput[];
  reads: PrivateMomentReadActionOutput[];
  report: {
    endpointPrekeysAvailable: number;
    submissionsProcessed: number;
    submissionsUnknown: number;
    submissionsTerminal: number;
  } | null;
  errorPresent: boolean;
}

export interface PublicMomentProjection {
  postId: string;
  authorPtid: string;
  text: string;
  deleted: boolean;
  reactions: Array<{
    kind: number;
    count: string;
    reactedByViewer: boolean;
  }>;
}

export interface PublicMomentCommentProjection {
  commentId: string;
  postId: string;
  authorPtid: string;
  content: string;
  replyToCommentId: string;
  deleted: boolean;
}

export interface MomentsFeedReadOutput {
  outcome: number;
  hasMore: boolean;
  nextCursor: string;
  posts: PublicMomentProjection[];
}

export interface MomentsPublishActionInput {
  text: string;
  audienceKind: number;
}

export interface MomentsReactionActionInput {
  postId: string;
  reactionKind: number;
  active: boolean;
}

export interface MomentsCommentActionInput {
  postId: string;
  content: string;
  replyToCommentId?: string;
}

export interface MomentsCommentsReadActionInput {
  postId: string;
}

export interface PublicProfileProjection {
  actorPtid: string;
  profileRevision: string;
  displayName: string;
  note: string;
  region: string;
  timezone: string;
  defaultVisibility: string;
  manuallyApprovesFollowers: boolean;
  messagePermission: string;
  autoExpireDays: number;
}

export interface SettingsProfileUpdateActionInput {
  displayName?: string;
  note?: string;
  region?: string;
  timezone?: string;
  defaultVisibility?: string;
  manuallyApprovesFollowers?: boolean;
  messagePermission?: string;
  autoExpireDays?: number;
}

export interface PublicNotificationPreference {
  category: number;
  enabled: boolean;
  pushEnabled: boolean;
  soundEnabled: boolean;
}

export interface PublicNotificationPreferences {
  revision: string;
  preferences: PublicNotificationPreference[];
}

export interface SettingsNotificationUpdateActionInput
  extends PublicNotificationPreference {}


export interface CleanupOutput {
  oauthPurge: OAuthPurgeOutput;
  webSessionProjectionCleared: true;
  stationRegistryCleared: true;
}

export interface PrepareActorIdentityInput {
  storageKey: string;
  seedBase64: string;
}

export interface MobileAcceptanceActionContract {
  'build.identity': {
    input: undefined;
    output: EmbeddedMobileBuildIdentity;
  };
  'runtime.prepareActorIdentity': {
    input: PrepareActorIdentityInput;
    output: { prepared: true };
  };
  'station.add': {
    input: StationAddInput;
    output: StationMutationOutput;
  };
  'station.replace': {
    input: StationReplaceInput;
    output: StationMutationOutput;
  };
  'station.select': {
    input: StationSelectInput;
    output: StationSelectionOutput;
  };
  'access.submit': {
    input: AccessSubmitInput;
    output: AccessSubmitOutput;
  };
  'oauth.start': {
    input: OAuthStartActionInput;
    output: PublicOAuthProjection;
  };
  'oauth.status': {
    input: undefined;
    output: PublicOAuthProjection;
  };
  'oauth.cancel': {
    input: undefined;
    output: PublicOAuthProjection;
  };
  'oauth.replayHandle': {
    input: CallbackReplayHandleInput;
    output: CallbackReplayHandleOutput;
  };
  'oauth.negativeCallback': {
    input: NegativeOAuthCallbackInput;
    output: NegativeOAuthCallbackOutput;
  };
  'lifecycle.snapshot': {
    input: undefined;
    output: PublicLifecycleSnapshot;
  };
  'lifecycle.waitReady': {
    input: LifecycleWaitReadyInput;
    output: LifecycleWaitReadyOutput;
  };
  'lifecycle.suspend': {
    input: undefined;
    output: LifecycleTransitionOutput;
  };
  'lifecycle.resume': {
    input: undefined;
    output: LifecycleTransitionOutput;
  };
  'lifecycle.restart': {
    input: undefined;
    output: LifecycleRestartOutput;
  };
  'lifecycle.nativeBridgeDiagnostic': {
    input: undefined;
    output: {
      code: string;
      operation: string;
      message: string;
    } | null;
  };
  'lifecycle.secureStorageDeleteFailure': {
    input: undefined;
    output: SecureStorageDeleteFailureOutput;
  };
  'lifecycle.scope.read': {
    input: undefined;
    output: LifecycleScopeReadOutput;
  };
  'navigation.snapshot': {
    input: undefined;
    output: MobileNavigationProjection;
  };
  'navigation.apply': {
    input: MobileNavigationIntent;
    output: MobileNavigationProjection;
  };
  'platform.permission.check': {
    input: PlatformPermissionInput;
    output: PermissionCheckResult;
  };
  'platform.permission.request': {
    input: PlatformPermissionInput;
    output: PermissionRequestResult;
  };
  'platform.permission.checkAll': {
    input: undefined;
    output: PermissionCheckResult[];
  };
  'platform.network.read': {
    input: undefined;
    output: NetworkState;
  };
  'session.logout': {
    input: SessionLogoutInput | undefined;
    output: SessionLogoutOutput;
  };
  'native.deliverDeepLink': {
    input: NativeDeepLinkInput;
    output: NativeDeepLinkOutput;
  };
  'projection.read': {
    input: undefined;
    output: MobilePublicProjection;
  };
  'federation.context.read': {
    input: undefined;
    output: FederationContextReadOutput;
  };
  'messaging.createDirect': {
    input: MessagingCreateDirectActionInput;
    output: MessagingCreateDirectActionOutput;
  };
  'messaging.createGroup': {
    input: MessagingCreateGroupActionInput;
    output: MessagingCreateGroupActionOutput;
  };
  'messaging.attachment.stage': {
    input: MessagingStageAttachmentActionInput;
    output: MessagingStageAttachmentActionOutput;
  };
  'messaging.attachment.open': {
    input: MessagingOpenAttachmentActionInput;
    output: MessagingOpenAttachmentActionOutput;
  };
  'messaging.send': {
    input: MessagingSendActionInput;
    output: MessagingSendActionOutput;
  };
  'messaging.interact': {
    input: MessagingInteractionActionInput;
    output: MessagingInteractionActionOutput;
  };
  'messaging.read': {
    input: MessagingReadActionInput;
    output: MessagingReadActionInput & { submitted: boolean };
  };
  'messaging.typing': {
    input: MessagingTypingActionInput;
    output: MessagingTypingActionInput & { submitted: boolean };
  };
  'messaging.reconcile': {
    input: undefined;
    output: MessagingReconcileActionOutput | null;
  };
  'messaging.command.read': {
    input: MessagingCommandReadActionInput;
    output: {
      commandId: string;
      conversationId: string;
      state:
        | 'pending'
        | 'retry_wait'
        | 'submitted'
        | 'failed'
        | 'superseded'
        | 'committed';
      lastErrorCode: string;
    };
  };
  'messaging.search': {
    input: MessagingSearchActionInput;
    output: PublicMessagingMessageProjection[];
  };
  'messaging.projection.read': {
    input: MessagingProjectionReadActionInput;
    output: PublicMessagingProjection;
  };
  'social.people.search': {
    input: SocialPeopleSearchActionInput;
    output: PublicActorSearchResult[];
  };
  'reliability.fixture.configure': {
    input: ReliabilityFixtureConfigureInput;
    output: ReliabilityFixtureConfigureOutput;
  };
  'reliability.friendRequest.submit': {
    input: SocialRequestSendActionInput;
    output: ReliabilityFriendRequestSubmitOutput;
  };
  'reliability.snapshot': {
    input: undefined;
    output: PublicReliabilitySnapshot;
  };
  'reliability.reconcile': {
    input: undefined;
    output: ReliabilityReconcileOutput;
  };
  'reliability.command.action': {
    input: ReliabilityCommandActionInput;
    output: PublicReliabilitySnapshot;
  };
  'reliability.draft.write': {
    input: ReliabilityDraftWriteInput;
    output: PublicReliabilityDraft;
  };
  'reliability.draft.read': {
    input: ReliabilityDraftReadInput | undefined;
    output: PublicReliabilityDraft[];
  };
  'reliability.draft.action': {
    input: ReliabilityDraftActionInput;
    output: PublicReliabilitySnapshot;
  };
  'reliability.reset': {
    input: ReliabilityResetInput;
    output: ReliabilityCleanupOutput;
  };
  'recovery.snapshot': {
    input: undefined;
    output: PublicRecoverySnapshot;
  };
  'social.request.send': {
    input: SocialRequestSendActionInput;
    output: PublicSocialRuntimeProjection;
  };
  'social.request.accept': {
    input: SocialRequestAcceptActionInput;
    output: PublicSocialRuntimeProjection;
  };
  'social.contact.open': {
    input: MessagingCreateDirectActionInput;
    output: Pick<MessagingCreateDirectActionOutput, 'conversationId'>;
  };
  'social.reconcile': {
    input: undefined;
    output: PublicSocialRuntimeProjection;
  };
  'social.projection.read': {
    input: undefined;
    output: PublicSocialRuntimeProjection;
  };
  'moments.private.publishText': {
    input: PrivateMomentPublishActionInput;
    output: PrivateMomentPublishActionOutput;
  };
  'moments.private.readText': {
    input: PrivateMomentReadActionInput;
    output: PrivateMomentReadActionOutput;
  };
  'moments.private.reconcile': {
    input: undefined;
    output: PrivateMomentSnapshotActionOutput;
  };
  'moments.private.snapshot': {
    input: undefined;
    output: PrivateMomentSnapshotActionOutput;
  };
  'moments.feed.read': {
    input: undefined;
    output: MomentsFeedReadOutput;
  };
  'moments.publish': {
    input: MomentsPublishActionInput;
    output: PublicMomentProjection;
  };
  'moments.react': {
    input: MomentsReactionActionInput;
    output: PublicMomentProjection['reactions'];
  };
  'moments.comment': {
    input: MomentsCommentActionInput;
    output: PublicMomentCommentProjection;
  };
  'moments.comments.read': {
    input: MomentsCommentsReadActionInput;
    output: PublicMomentCommentProjection[];
  };
  'storage.cache.seed': {
    input: { sizeBytes: number };
    output: { sizeBytes: number };
  };
  'storage.conversation-clear.seed': {
    input: { plaintextBytes: number };
    output: {
      conversationId: string;
      messageId: string;
    };
  };
  'storage.batch.scenario': {
    input: {
      delayMs?: number;
      failureConversationId?: string;
      scopeChangeConversationId?: string;
    };
    output: { configured: boolean };
  };
  'storage.retention.seed': {
    input: { oldPlaintextBytes: number };
    output: {
      conversationId: string;
      prunedMessageId: string;
      protectedMessageId: string;
      recentMessageId: string;
    };
  };
  'settings.profile.read': {
    input: undefined;
    output: PublicProfileProjection;
  };
  'settings.profile.update': {
    input: SettingsProfileUpdateActionInput;
    output: {
      outcome: number;
      profile: PublicProfileProjection;
    };
  };
  'settings.notifications.read': {
    input: undefined;
    output: PublicNotificationPreferences;
  };
  'settings.notifications.update': {
    input: SettingsNotificationUpdateActionInput;
    output: {
      outcome: number;
      snapshot: PublicNotificationPreferences;
    };
  };
  'settings.device.read': {
    input: undefined;
    output: DevicePreferences;
  };
  'settings.device.update': {
    input: DevicePreferences;
    output: DevicePreferences;
  };
  getRealtimeDevice: {
    input: undefined;
    output: {
      actorPtid: string;
      deviceId: string;
      active: boolean;
    };
  };
  initiateCall: {
    input: { calleePtid: string; callerDeviceId?: string };
    output: {
      callId: string;
      state: string;
      winningDeviceId?: string;
    };
  };
  callResolutionState: {
    input: { callId: string; deviceId?: string };
    output: {
      callId: string;
      state: string;
      winningDeviceId?: string;
      terminalAction?: string;
    } | null;
  };
  acceptCall: {
    input: { callId: string; deviceId?: string };
    output: {
      callId: string;
      state: string;
      winningDeviceId?: string;
      conflict?: boolean;
    };
  };
  rejectCall: {
    input: { callId: string; deviceId?: string };
    output: {
      callId: string;
      state: string;
      winningDeviceId?: string;
      conflict?: boolean;
    };
  };
  cleanup: {
    input: undefined;
    output: CleanupOutput;
  };
}

export type MobileAcceptanceAction<
  Name extends MobileAcceptanceActionName,
> = MobileAcceptanceActionContract[Name]['input'] extends undefined
  ? (input?: undefined) => Promise<MobileAcceptanceActionContract[Name]['output']>
  : (
    input: MobileAcceptanceActionContract[Name]['input'],
  ) => Promise<MobileAcceptanceActionContract[Name]['output']>;

export type MobileAcceptanceNamespace = {
  [Name in MobileAcceptanceActionName]: MobileAcceptanceAction<Name>;
};

declare global {
  interface Window {
    __PEERS_MOBILE_ACCEPTANCE__?: MobileAcceptanceNamespace;
  }
}
