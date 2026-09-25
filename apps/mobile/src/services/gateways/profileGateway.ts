/**
 * profileGateway.ts — Profile domain API gateway
 *
 * Wraps peer profile lookup, actor search, and federation resolve APIs
 * behind a typed gateway with JSON quarantine and command outcome adapters.
 *
 * The Station-owned Notification preference transport is colocated here for
 * W6C, but remains a separate generated-contract gateway.
 */

import { create, fromJson, toJson, type JsonValue } from '@bufbuild/protobuf';
import type { MobileAuthSession } from '../../features/auth/authSession';
import {
  ActorListSchema,
  ProfileUpdateOutcome,
  UpdateProfileRequestSchema,
  UpdateProfileResponseSchema,
} from '../../gen/proto/domain/actor/actor_pb';
import { FederationResolveViewSchema } from '../../gen/proto/domain/federation/federation_resolve_pb';
import {
  ListFederationsResponseSchema,
  type FederationSummary,
} from '../../gen/proto/domain/federation/federation_projection_service_pb';
import {
  GetNotificationPreferencesResponseSchema,
  NotificationCategory,
  NotificationPreferencesUpdateOutcome,
  UpdateNotificationPreferencesRequestSchema,
  UpdateNotificationPreferencesResponseSchema,
  type NotificationPreferencesSnapshot,
  type UpdateNotificationPreferencesRequest,
} from '../../gen/proto/domain/notification/notification_pb';
import {
  normalizeActorSearchResult,
  normalizePeerProfile,
  federationViewToResult,
} from '../../features/social/socialNormalizers';
import type {
  ActorSearchResult,
  FederationResolveView,
  PeerProfile,
} from '../../features/social/socialTypes';
import {
  createGatewayTransport,
  type CommandOutcome,
  type GatewayError,
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// Gateway output types
// ---------------------------------------------------------------------------

export interface ActorSearchResultList {
  readonly items: ActorSearchResult[];
  readonly total: number;
}

export interface FederationResolveResult {
  readonly view: FederationResolveView;
  readonly asSearchResult: ActorSearchResult | null;
}

export interface EditableProfileInput {
  readonly displayName?: string;
  readonly note?: string;
  readonly avatar?: string;
  readonly header?: string;
  readonly region?: string;
  readonly timezone?: string;
  readonly defaultVisibility?: string;
  readonly manuallyApprovesFollowers?: boolean;
  readonly messagePermission?: string;
  readonly autoExpireDays?: number;
}

export interface ProfileUpdateResult {
  readonly outcome: ProfileUpdateOutcome;
  readonly profile: PeerProfile;
}

export interface NotificationPreferencesUpdateResult {
  readonly outcome: NotificationPreferencesUpdateOutcome;
  readonly snapshot: NotificationPreferencesSnapshot;
}

// ---------------------------------------------------------------------------
// Profile gateway interface
// ---------------------------------------------------------------------------

export interface ProfileGateway {
  getCurrentProfile: () => Promise<CommandOutcome<PeerProfile>>;
  updateCurrentProfile: (
    input: EditableProfileInput,
    observedRevision: bigint,
  ) => Promise<CommandOutcome<ProfileUpdateResult>>;
  getPeerProfile: (ptid: string) => Promise<CommandOutcome<PeerProfile>>;
  searchActors: (query: string) => Promise<CommandOutcome<ActorSearchResultList>>;
  listFederations: () => Promise<CommandOutcome<FederationSummary[]>>;
  resolveFederationHandle: (handle: string) => Promise<CommandOutcome<FederationResolveResult>>;
}

export interface NotificationPreferenceGateway {
  getNotificationPreferences: () => Promise<CommandOutcome<NotificationPreferencesSnapshot>>;
  updateNotificationPreferences: (
    input: UpdateNotificationPreferencesRequest,
  ) => Promise<CommandOutcome<NotificationPreferencesUpdateResult>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProfileGateway(session: MobileAuthSession): ProfileGateway {
  const { command } = createGatewayTransport(session, 'profile');
  const getCurrentProfile = async (): Promise<CommandOutcome<PeerProfile>> => {
    const result = await command<Partial<PeerProfile>>({
      method: 'GET',
      path: '/actor/profile',
    });
    if (!result.ok) return result;
    const profile = normalizePeerProfile(result.data);
    return profile.profileRevision > 0n
      ? { ok: true, data: profile }
      : invalidProfileResponse('GET');
  };

  return {
    getCurrentProfile,

    updateCurrentProfile: async (input, observedRevision) => {
      if (
        observedRevision === 0n
        || Object.values(input).every((value) => value === undefined)
      ) {
        return invalidProfileMutation();
      }
      const request = create(UpdateProfileRequestSchema, {
        ...input,
        observedRevision,
      });
      const body = toJson(UpdateProfileRequestSchema, request, {
        useProtoFieldName: true,
      });
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return invalidProfileResponse('POST');
      }
      const result = await command<JsonValue>({
        method: 'POST',
        path: '/actor/profile',
        body,
      });
      if (!result.ok) {
        return shouldReconcileLostResponse(result.error)
          ? reconcileLostProfileResponse(getCurrentProfile, input, observedRevision, result)
          : result;
      }
      try {
        const response = fromJson(UpdateProfileResponseSchema, result.data);
        if (
          !response.profile
          || !validProfileUpdateOutcome(response.outcome)
        ) {
          throw new Error('invalid profile update response');
        }
        const profile = normalizePeerProfile(
          response.profile as unknown as Partial<PeerProfile>,
        );
        if (profile.profileRevision === 0n) {
          throw new Error('invalid profile revision');
        }
        return {
          ok: true,
          data: {
            outcome: response.outcome,
            profile,
          },
        };
      } catch {
        const invalid = invalidProfileResponse('POST');
        return reconcileLostProfileResponse(
          getCurrentProfile,
          input,
          observedRevision,
          invalid,
        );
      }
    },

    getPeerProfile: async (ptid) => {
      const result = await command<Partial<PeerProfile>>({
        method: 'GET',
        path: `/actor/actors/${encodeURIComponent(ptid)}/profile`,
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizePeerProfile(result.data) };
    },

    searchActors: async (query) => {
      const result = await command<JsonValue>({
        method: 'GET',
        path: '/api/v1/social/users/search',
        query: { q: query },
      });
      if (!result.ok) return result;
      try {
        const actors = fromJson(ActorListSchema, result.data);
        const items = actors.items.map(normalizeActorSearchResult);
        const total = Number(actors.total);
        if (items.some((item) => !item.ptid.startsWith('ptid:'))
          || !Number.isSafeInteger(total) || total < 0) {
          throw new Error('invalid actor search identity or total');
        }
        return { ok: true, data: { items, total } };
      } catch {
        return {
          ok: false,
          error: {
            code: 'INVALID_ACTOR_SEARCH_RESPONSE',
            message: 'mobile.contacts.searchFailed',
            method: 'GET',
            path: '/api/v1/social/users/search',
          },
        };
      }
    },

    listFederations: async () => {
      const result = await command<JsonValue>({
        method: 'GET',
        path: '/sub-federation/federations',
      });
      if (!result.ok) return result;
      try {
        const { federations } = fromJson(ListFederationsResponseSchema, result.data);
        if (federations.some((federation) => !federation.federationId.trim())) {
          throw new Error('invalid Federation identity');
        }
        return {
          ok: true,
          data: federations.filter((federation) => federation.status === 'active'),
        };
      } catch {
        return {
          ok: false,
          error: {
            code: 'INVALID_FEDERATION_RESPONSE',
            message: 'mobile.contacts.federationsFailed',
            method: 'GET',
            path: '/sub-federation/federations',
          },
        };
      }
    },

    resolveFederationHandle: async (handle) => {
      const result = await command<JsonValue>({
        method: 'GET',
        path: '/actor/federation/resolve',
        query: { handle },
      });
      if (!result.ok) return result;
      try {
        const view = fromJson(FederationResolveViewSchema, result.data);
        const asSearchResult = federationViewToResult(view);
        if (!asSearchResult?.ptid.startsWith('ptid:') || !Number.isSafeInteger(Number(view.locatorSeq))) {
          throw new Error('invalid resolved actor identity');
        }
        return { ok: true, data: { view, asSearchResult } };
      } catch {
        return {
          ok: false,
          error: {
            code: 'INVALID_ACTOR_SEARCH_RESPONSE',
            message: 'mobile.contacts.searchFailed',
            method: 'GET',
            path: '/actor/federation/resolve',
          },
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Notification preference gateway
// ---------------------------------------------------------------------------

export function createNotificationPreferenceGateway(
  session: MobileAuthSession,
): NotificationPreferenceGateway {
  const { command } = createGatewayTransport(session, 'notification');
  const actorPtid = session.actorRef.ptid;

  return {
    getNotificationPreferences: async () => {
      const path = '/notification/preferences';
      const result = await command<JsonValue>({ method: 'GET', path });
      if (!result.ok) return result;
      try {
        const { snapshot } = fromJson(
          GetNotificationPreferencesResponseSchema,
          result.data,
        );
        if (!snapshot || !validNotificationPreferencesSnapshot(snapshot, actorPtid)) {
          throw new Error('invalid notification preference response');
        }
        return { ok: true, data: snapshot };
      } catch {
        return invalidNotificationPreferenceResponse('GET', path);
      }
    },

    updateNotificationPreferences: async (input) => {
      const path = '/notification/preferences';
      if (
        input.observedRevision === 0n
        || !validNotificationPreferenceUpdates(input)
      ) {
        return invalidNotificationPreferenceResponse('POST', path);
      }
      const body = toJson(UpdateNotificationPreferencesRequestSchema, input, {
        alwaysEmitImplicit: true,
        enumAsInteger: true,
        useProtoFieldName: true,
      });
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return invalidNotificationPreferenceResponse('POST', path);
      }
      const result = await command<JsonValue>({
        method: 'POST',
        path,
        body,
      });
      if (!result.ok) {
        return shouldReconcileLostResponse(result.error)
          ? reconcileLostNotificationResponse(
            createNotificationPreferenceGateway(session),
            input,
            result,
          )
          : result;
      }
      try {
        const response = fromJson(
          UpdateNotificationPreferencesResponseSchema,
          result.data,
        );
        if (
          !response.snapshot
          || !validNotificationPreferencesUpdateOutcome(response.outcome)
          || !validNotificationPreferencesSnapshot(response.snapshot, actorPtid)
        ) {
          throw new Error('invalid notification preference response');
        }
        return {
          ok: true,
          data: {
            outcome: response.outcome,
            snapshot: response.snapshot,
          },
        };
      } catch {
        return reconcileLostNotificationResponse(
          createNotificationPreferenceGateway(session),
          input,
          invalidNotificationPreferenceResponse('POST', path),
        );
      }
    },
  };
}

function validNotificationPreferencesSnapshot(
  snapshot: NotificationPreferencesSnapshot,
  actorPtid: string,
): boolean {
  if (snapshot.notificationPreferencesRevision === 0n) return false;
  const categories = new Set<NotificationCategory>();
  const valid = snapshot.preferences.every((preference) => {
    if (
      preference.actorPtid !== actorPtid
      || preference.category === NotificationCategory.UNSPECIFIED
      || categories.has(preference.category)
    ) {
      return false;
    }
    categories.add(preference.category);
    return true;
  });
  return valid
    && categories.size === 4
    && [
      NotificationCategory.SOCIAL,
      NotificationCategory.CHAT,
      NotificationCategory.SYSTEM,
      NotificationCategory.TASK,
    ].every((category) => categories.has(category));
}

function validNotificationPreferenceUpdates(
  input: UpdateNotificationPreferencesRequest,
): boolean {
  if (input.updates.length === 0) return false;
  const categories = new Set<NotificationCategory>();
  return input.updates.every((update) => {
    if (
      update.category === NotificationCategory.UNSPECIFIED
      || categories.has(update.category)
    ) {
      return false;
    }
    categories.add(update.category);
    return true;
  });
}

function validProfileUpdateOutcome(outcome: ProfileUpdateOutcome): boolean {
  return outcome === ProfileUpdateOutcome.APPLIED
    || outcome === ProfileUpdateOutcome.UNCHANGED
    || outcome === ProfileUpdateOutcome.CONFLICT;
}

function validNotificationPreferencesUpdateOutcome(
  outcome: NotificationPreferencesUpdateOutcome,
): boolean {
  return outcome === NotificationPreferencesUpdateOutcome.APPLIED
    || outcome === NotificationPreferencesUpdateOutcome.UNCHANGED
    || outcome === NotificationPreferencesUpdateOutcome.CONFLICT;
}

function shouldReconcileLostResponse(error: GatewayError): boolean {
  return error.status === undefined;
}

async function reconcileLostProfileResponse(
  readProfile: () => Promise<CommandOutcome<PeerProfile>>,
  input: EditableProfileInput,
  observedRevision: bigint,
  original: { readonly ok: false; readonly error: GatewayError },
): Promise<CommandOutcome<ProfileUpdateResult>> {
  const readback = await readProfile();
  if (!readback.ok) return original;
  if (profileMatchesInput(readback.data, input)) {
    return {
      ok: true,
      data: {
        outcome: readback.data.profileRevision === observedRevision
          ? ProfileUpdateOutcome.UNCHANGED
          : ProfileUpdateOutcome.APPLIED,
        profile: readback.data,
      },
    };
  }
  if (readback.data.profileRevision > observedRevision) {
    return {
      ok: true,
      data: {
        outcome: ProfileUpdateOutcome.CONFLICT,
        profile: readback.data,
      },
    };
  }
  return original;
}

async function reconcileLostNotificationResponse(
  gateway: Pick<NotificationPreferenceGateway, 'getNotificationPreferences'>,
  input: UpdateNotificationPreferencesRequest,
  original: { readonly ok: false; readonly error: GatewayError },
): Promise<CommandOutcome<NotificationPreferencesUpdateResult>> {
  const readback = await gateway.getNotificationPreferences();
  if (!readback.ok) return original;
  if (notificationSnapshotMatchesUpdates(readback.data, input)) {
    return {
      ok: true,
      data: {
        outcome:
          readback.data.notificationPreferencesRevision === input.observedRevision
            ? NotificationPreferencesUpdateOutcome.UNCHANGED
            : NotificationPreferencesUpdateOutcome.APPLIED,
        snapshot: readback.data,
      },
    };
  }
  if (readback.data.notificationPreferencesRevision > input.observedRevision) {
    return {
      ok: true,
      data: {
        outcome: NotificationPreferencesUpdateOutcome.CONFLICT,
        snapshot: readback.data,
      },
    };
  }
  return original;
}

function profileMatchesInput(
  profile: PeerProfile,
  input: EditableProfileInput,
): boolean {
  return (input.displayName === undefined || input.displayName === profile.displayName)
    && (input.note === undefined || input.note === profile.note)
    && (input.avatar === undefined || input.avatar === profile.avatar)
    && (input.header === undefined || input.header === profile.header)
    && (input.region === undefined || input.region === profile.region)
    && (input.timezone === undefined || input.timezone === profile.timezone)
    && (
      input.defaultVisibility === undefined
      || input.defaultVisibility === profile.defaultVisibility
    )
    && (
      input.manuallyApprovesFollowers === undefined
      || input.manuallyApprovesFollowers === profile.manuallyApprovesFollowers
    )
    && (
      input.messagePermission === undefined
      || input.messagePermission === profile.messagePermission
    )
    && (
      input.autoExpireDays === undefined
      || input.autoExpireDays === profile.autoExpireDays
    );
}

function notificationSnapshotMatchesUpdates(
  snapshot: NotificationPreferencesSnapshot,
  input: UpdateNotificationPreferencesRequest,
): boolean {
  const preferences = new Map(
    snapshot.preferences.map((preference) => [preference.category, preference]),
  );
  return input.updates.every((update) => {
    const preference = preferences.get(update.category);
    return Boolean(
      preference
      && preference.enabled === update.enabled
      && preference.pushEnabled === update.pushEnabled
      && preference.soundEnabled === update.soundEnabled,
    );
  });
}

function invalidProfileResponse(
  method: 'GET' | 'POST',
): { readonly ok: false; readonly error: GatewayError } {
  return {
    ok: false,
    error: {
      code: 'INVALID_PROFILE_RESPONSE',
      message: 'mobile.settings.profileUnavailable',
      method,
      path: '/actor/profile',
    },
  };
}

function invalidProfileMutation(): { readonly ok: false; readonly error: GatewayError } {
  return {
    ok: false,
    error: {
      code: 'INVALID_PROFILE_MUTATION',
      message: 'mobile.settings.profile.saveFailed',
      method: 'POST',
      path: '/actor/profile',
    },
  };
}

function invalidNotificationPreferenceResponse(
  method: 'GET' | 'POST',
  path: string,
): { readonly ok: false; readonly error: GatewayError } {
  return {
    ok: false,
    error: {
      code: 'INVALID_NOTIFICATION_PREFERENCE_RESPONSE',
      message: 'mobile.launch.unavailable',
      method,
      path,
    },
  };
}
