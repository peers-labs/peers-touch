import type {
  AuthRuntimeRecovery,
} from '../runtimes/authRuntime';
import type {
  MobileOAuthProvider,
  OAuthPublicPhase,
} from '../services/mobileCommands';
import type { EmbeddedMobileBuildIdentity } from './buildIdentity';

export const MOBILE_ACCEPTANCE_ACTION_NAMES = [
  'build.identity',
  'station.add',
  'station.replace',
  'access.submit',
  'oauth.start',
  'oauth.status',
  'oauth.cancel',
  'oauth.replayHandle',
  'oauth.negativeCallback',
  'lifecycle.restart',
  'native.deliverDeepLink',
  'projection.read',
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
  'social.request.send',
  'social.request.accept',
  'social.reconcile',
  'social.projection.read',
  'cleanup',
] as const;

export type MobileAcceptanceActionName =
  typeof MOBILE_ACCEPTANCE_ACTION_NAMES[number];

export interface StationAddInput {
  url: string;
}

export interface StationReplaceInput {
  stationPeerId: string;
  url: string;
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
}

export interface SocialRequestSendActionInput {
  receiverPtid: string;
  receiverHomeStationPeerId: string;
  federationId: string;
  message?: string;
}

export interface SocialRequestAcceptActionInput {
  requestId: string;
}

export interface CleanupOutput {
  oauthPurge: OAuthPurgeOutput;
  webSessionProjectionCleared: true;
  stationRegistryCleared: true;
}

export interface MobileAcceptanceActionContract {
  'build.identity': {
    input: undefined;
    output: EmbeddedMobileBuildIdentity;
  };
  'station.add': {
    input: StationAddInput;
    output: StationMutationOutput;
  };
  'station.replace': {
    input: StationReplaceInput;
    output: StationMutationOutput;
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
  'lifecycle.restart': {
    input: undefined;
    output: LifecycleRestartOutput;
  };
  'native.deliverDeepLink': {
    input: NativeDeepLinkInput;
    output: NativeDeepLinkOutput;
  };
  'projection.read': {
    input: undefined;
    output: MobilePublicProjection;
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
  'social.request.send': {
    input: SocialRequestSendActionInput;
    output: PublicSocialRuntimeProjection;
  };
  'social.request.accept': {
    input: SocialRequestAcceptActionInput;
    output: PublicSocialRuntimeProjection;
  };
  'social.reconcile': {
    input: undefined;
    output: PublicSocialRuntimeProjection;
  };
  'social.projection.read': {
    input: undefined;
    output: PublicSocialRuntimeProjection;
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
