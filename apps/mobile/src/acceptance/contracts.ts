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
