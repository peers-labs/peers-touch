/**
 * profileGateway.ts — Profile domain API gateway
 *
 * Wraps peer profile lookup, actor search, and federation resolve APIs
 * behind a typed gateway with JSON quarantine and command outcome adapters.
 *
 * Also surfaces the MS-P05 account preference contracts entry point.
 */

import type { MobileAuthSession } from '../../features/auth/authSession';
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
} from './gatewayTypes';

// ---------------------------------------------------------------------------
// Raw JSON shapes from Station (quarantined)
// ---------------------------------------------------------------------------

interface ActorSearchRaw {
  items?: Partial<ActorSearchResult>[];
  total?: number;
}

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

/**
 * MS-P05 account preference: per-actor notification, privacy, and
 * display preferences.  The shape matches the Station preference
 * proto once it reaches proto parity; until then, JSON quarantine
 * normalizes the response here.
 */
export interface AccountPreference {
  readonly actorPtid: string;
  readonly notificationEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly soundEnabled: boolean;
  readonly defaultPostVisibility: string;
  readonly messagePermission: string;
  readonly autoExpireDays: number;
}

// ---------------------------------------------------------------------------
// Profile gateway interface
// ---------------------------------------------------------------------------

export interface ProfileGateway {
  getPeerProfile: (ptid: string) => Promise<CommandOutcome<PeerProfile>>;
  searchActors: (query: string) => Promise<CommandOutcome<ActorSearchResultList>>;
  resolveFederationHandle: (handle: string) => Promise<CommandOutcome<FederationResolveResult>>;

  // MS-P05 account preference contracts
  getAccountPreferences: () => Promise<CommandOutcome<AccountPreference>>;
  updateAccountPreferences: (input: Partial<AccountPreference>) => Promise<CommandOutcome<AccountPreference>>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createProfileGateway(session: MobileAuthSession): ProfileGateway {
  const { command } = createGatewayTransport(session);

  return {
    getPeerProfile: async (ptid) => {
      const result = await command<Partial<PeerProfile>>({
        method: 'GET',
        path: `/actor/actors/${encodeURIComponent(ptid)}/profile`,
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizePeerProfile(result.data) };
    },

    searchActors: async (query) => {
      const result = await command<ActorSearchRaw>({
        method: 'GET',
        path: '/api/v1/social/users/search',
        query: { q: query },
      });
      if (!result.ok) return result;
      const items = (result.data.items ?? []).map(normalizeActorSearchResult);
      return { ok: true, data: { items, total: result.data.total ?? items.length } };
    },

    resolveFederationHandle: async (handle) => {
      const result = await command<FederationResolveView>({
        method: 'GET',
        path: '/actor/federation/resolve',
        query: { handle },
      });
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          view: result.data,
          asSearchResult: federationViewToResult(result.data),
        },
      };
    },

    // --- MS-P05 account preference contracts ---
    getAccountPreferences: async () => {
      const result = await command<Record<string, unknown>>({
        method: 'GET',
        path: '/actor/preferences',
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeAccountPreference(result.data) };
    },

    updateAccountPreferences: async (input) => {
      const result = await command<Record<string, unknown>>({
        method: 'PUT',
        path: '/actor/preferences',
        body: {
          ...(input.notificationEnabled !== undefined ? { notification_enabled: input.notificationEnabled } : {}),
          ...(input.pushEnabled !== undefined ? { push_enabled: input.pushEnabled } : {}),
          ...(input.soundEnabled !== undefined ? { sound_enabled: input.soundEnabled } : {}),
          ...(input.defaultPostVisibility !== undefined ? { default_post_visibility: input.defaultPostVisibility } : {}),
          ...(input.messagePermission !== undefined ? { message_permission: input.messagePermission } : {}),
          ...(input.autoExpireDays !== undefined ? { auto_expire_days: input.autoExpireDays } : {}),
        },
      });
      if (!result.ok) return result;
      return { ok: true, data: normalizeAccountPreference(result.data) };
    },
  };
}

// ---------------------------------------------------------------------------
// JSON quarantine normalizer (private)
// ---------------------------------------------------------------------------

function normalizeAccountPreference(payload: Record<string, unknown>): AccountPreference {
  return {
    actorPtid: String(payload.actorPtid ?? payload.actor_ptid ?? ''),
    notificationEnabled: (payload.notificationEnabled ?? payload.notification_enabled) !== false,
    pushEnabled: (payload.pushEnabled ?? payload.push_enabled) !== false,
    soundEnabled: (payload.soundEnabled ?? payload.sound_enabled) !== false,
    defaultPostVisibility: String(payload.defaultPostVisibility ?? payload.default_post_visibility ?? 'public'),
    messagePermission: String(payload.messagePermission ?? payload.message_permission ?? 'everyone'),
    autoExpireDays: Number(payload.autoExpireDays ?? payload.auto_expire_days ?? 0),
  };
}
