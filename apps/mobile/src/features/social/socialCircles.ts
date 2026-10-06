import { fromJson, type DescMessage, type JsonValue, type MessageShape } from '@bufbuild/protobuf';
import { create } from 'zustand';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScopeKey } from '../auth/mobileAuthIdentity';
import {
  AddCircleMemberResponseSchema,
  CreateCircleResponseSchema,
  DeleteCircleResponseSchema,
  ListCircleMembersResponseSchema,
  ListMyCirclesResponseSchema,
  RemoveCircleMemberResponseSchema,
  RenameCircleResponseSchema,
  type Circle,
  type CircleMember,
} from '../../gen/proto/domain/social/circle_pb';
import type { ActorSearchResult } from './socialTypes';
import { federationCatalogEntryToResult } from './socialNormalizers';
import { useSocialStore } from './socialStore';
import { requireMobileMutationAdmission } from '../../runtimes/mutationAdmission';
import {
  executeSocialNativeOperation,
  type SocialNativeOperation,
} from '../../services/socialNativeAdapter';
import { responseJson } from '../../services/stationTransport';

const PAGE_SIZE = 100;
const CONVERGENCE_ATTEMPTS = 4;

interface CircleGateway {
  listCircles: (cursor?: string) => Promise<{
    circles: Circle[];
    nextCursor: string;
    hasMore: boolean;
  }>;
  createCircle: (name: string, description: string) => Promise<Circle>;
  updateCircle: (circleId: string, name: string, description: string) => Promise<Circle>;
  deleteCircle: (circleId: string) => Promise<boolean>;
  listMembers: (circleId: string, cursor?: string) => Promise<{
    members: CircleMember[];
    nextCursor: string;
    hasMore: boolean;
  }>;
  addMembers: (circleId: string, memberPtids: string[]) => Promise<bigint>;
  removeMembers: (circleId: string, memberPtids: string[]) => Promise<bigint>;
}

export interface SocialCirclesState {
  sessionKey: string | null;
  circles: Circle[];
  nextCursor: string;
  hasMore: boolean;
  membersByCircle: Record<string, CircleMember[]>;
  loading: boolean;
  loadingMembers: Record<string, boolean>;
  pendingCircleIds: Record<string, boolean>;
  pickerResults: ActorSearchResult[];
  pickerLoading: boolean;
  pickerError: string | null;
  error: string | null;
  reset: () => void;
  refreshCircles: () => Promise<void>;
  loadMoreCircles: () => Promise<void>;
  refreshMembers: (circleId: string) => Promise<void>;
  createCircle: (name: string, description: string) => Promise<string>;
  updateCircle: (circleId: string, name: string, description: string) => Promise<void>;
  deleteCircle: (circleId: string) => Promise<void>;
  addMembers: (circleId: string, memberPtids: string[]) => Promise<void>;
  removeMembers: (circleId: string, memberPtids: string[]) => Promise<void>;
  searchPickerPeople: (query: string, federationId?: string) => Promise<void>;
  clearPickerSearch: () => void;
}

const initialProjection = {
  sessionKey: null,
  circles: [] as Circle[],
  nextCursor: '',
  hasMore: false,
  membersByCircle: {} as Record<string, CircleMember[]>,
  loading: false,
  loadingMembers: {} as Record<string, boolean>,
  pendingCircleIds: {} as Record<string, boolean>,
  pickerResults: [] as ActorSearchResult[],
  pickerLoading: false,
  pickerError: null as string | null,
  error: null as string | null,
};

let circleReadToken: object | null = null;
const memberReadTokens = new Map<string, object>();
let pickerSearchToken: object | null = null;

export const useSocialCirclesStore = create<SocialCirclesState>((set, get) => ({
  ...initialProjection,

  reset: () => {
    circleReadToken = null;
    memberReadTokens.clear();
    pickerSearchToken = null;
    set({ ...initialProjection });
  },

  refreshCircles: async () => {
    const { session, scopeKey, gateway } = circleContext(get, set);
    const token = {};
    circleReadToken = token;
    set({ loading: true, error: null });
    try {
      const page = await gateway.listCircles();
      if (!circleReadCurrent(token, session, scopeKey)) return;
      set({
        circles: page.circles,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loading: false,
      });
    } catch (error) {
      if (!circleReadCurrent(token, session, scopeKey)) return;
      set({ loading: false, error: errorMessage(error) });
    }
  },

  loadMoreCircles: async () => {
    const state = get();
    if (state.loading || !state.hasMore) return;
    const { session, scopeKey, gateway } = circleContext(get, set);
    const token = {};
    circleReadToken = token;
    set({ loading: true, error: null });
    try {
      const page = await gateway.listCircles(state.nextCursor);
      if (!circleReadCurrent(token, session, scopeKey)) return;
      set((current) => ({
        circles: mergeCircles(current.circles, page.circles),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        loading: false,
      }));
    } catch (error) {
      if (!circleReadCurrent(token, session, scopeKey)) return;
      set({ loading: false, error: errorMessage(error) });
    }
  },

  refreshMembers: async (circleId) => {
    const { session, scopeKey, gateway } = circleContext(get, set);
    const token = {};
    memberReadTokens.set(circleId, token);
    set((state) => ({
      loadingMembers: { ...state.loadingMembers, [circleId]: true },
      error: null,
    }));
    try {
      const members = await readAllMembers(gateway, circleId);
      if (!memberReadCurrent(circleId, token, session, scopeKey)) return;
      set((state) => ({
        membersByCircle: { ...state.membersByCircle, [circleId]: members },
        loadingMembers: { ...state.loadingMembers, [circleId]: false },
      }));
    } catch (error) {
      if (!memberReadCurrent(circleId, token, session, scopeKey)) return;
      set((state) => ({
        loadingMembers: { ...state.loadingMembers, [circleId]: false },
        error: errorMessage(error),
      }));
    }
  },

  createCircle: async (name, description) => {
    const { session, scopeKey, gateway } = circleContext(get, set);
    const normalizedName = requireName(name);
    set({ error: null });
    const created = await gateway.createCircle(normalizedName, description.trim());
    const circleId = created.id.toString();
    const circles = await readAllCircles(gateway);
    requireCurrentScope(session, scopeKey);
    if (!circles.some((circle) => circle.id === created.id)) {
      throw new Error('mobile.social.circles.createUnconfirmed');
    }
    set({ circles, nextCursor: '', hasMore: false });
    return circleId;
  },

  updateCircle: async (circleId, name, description) => {
    const context = circleContext(get, set);
    await withPendingCircle(circleId, set, async () => {
      await context.gateway.updateCircle(
        circleId,
        requireName(name),
        description.trim(),
      );
      const circles = await readAllCircles(context.gateway);
      requireCurrentScope(context.session, context.scopeKey);
      const readback = circles.find((circle) => circle.id.toString() === circleId);
      if (!readback || readback.name !== name.trim() || readback.description !== description.trim()) {
        throw new Error('mobile.social.circles.updateUnconfirmed');
      }
      set({ circles, nextCursor: '', hasMore: false });
    });
  },

  deleteCircle: async (circleId) => {
    const context = circleContext(get, set);
    await withPendingCircle(circleId, set, async () => {
      if (!await context.gateway.deleteCircle(circleId)) {
        throw new Error('mobile.social.circles.deleteRejected');
      }
      const circles = await readAllCircles(context.gateway);
      requireCurrentScope(context.session, context.scopeKey);
      if (circles.some((circle) => circle.id.toString() === circleId)) {
        throw new Error('mobile.social.circles.deleteUnconfirmed');
      }
      set((state) => {
        const membersByCircle = { ...state.membersByCircle };
        delete membersByCircle[circleId];
        return { circles, membersByCircle, nextCursor: '', hasMore: false };
      });
    });
  },

  addMembers: async (circleId, memberPtids) => {
    await mutateMembers(circleId, memberPtids, true, get, set);
  },

  removeMembers: async (circleId, memberPtids) => {
    await mutateMembers(circleId, memberPtids, false, get, set);
  },

  searchPickerPeople: async (query, federationId) => {
    const trimmed = query.trim();
    if (!trimmed) {
      get().clearPickerSearch();
      return;
    }
    circleContext(get, set);
    const profileGateway = useSocialStore.getState().profileGateway;
    if (!profileGateway) throw new Error('mobile.social.runtimeUnavailable');
    const token = {};
    pickerSearchToken = token;
    set({ pickerLoading: true, pickerError: null });
    try {
      const local = await profileGateway.searchActors(trimmed.replace(/^@/, ''));
      if (!local.ok) throw new Error(local.error.message);
      let remote: ActorSearchResult[] = [];
      if (federationId?.trim()) {
        const remoteOutcome = await profileGateway.searchFederationActors(
          federationId.trim(),
          trimmed.replace(/^@/, '').split('@')[0],
        );
        if (!remoteOutcome.ok) throw new Error(remoteOutcome.error.message);
        remote = remoteOutcome.data.map(federationCatalogEntryToResult);
      }
      if (pickerSearchToken !== token) return;
      set({
        pickerResults: mergePeople(local.data.items, remote),
        pickerLoading: false,
      });
    } catch (error) {
      if (pickerSearchToken !== token) return;
      set({
        pickerLoading: false,
        pickerError: errorMessage(error),
      });
    }
  },

  clearPickerSearch: () => {
    pickerSearchToken = null;
    set({ pickerResults: [], pickerLoading: false, pickerError: null });
  },
}));

function createCircleGateway(session: MobileAuthSession): CircleGateway {
  const execute = async <Desc extends DescMessage>(
    operation: SocialNativeOperation,
    schema: Desc,
  ): Promise<MessageShape<Desc>> => {
    if (operation.operationId !== 'social_circles_list'
      && operation.operationId !== 'social_circle_members_list') {
      requireMobileMutationAdmission(mobileAuthScopeKey(session), 'moments');
    }
    const response = await executeSocialNativeOperation(session, operation);
    const payload = unwrapEnvelope(responseJson(response));
    if (response.status < 200 || response.status >= 300) {
      throw new Error(errorFromPayload(payload, response.status));
    }
    try {
      return fromJson(schema, payload as JsonValue);
    } catch {
      throw new Error('mobile.social.circles.invalidResponse');
    }
  };

  return {
    listCircles: async (cursor) => {
      const page = await execute({
        operationId: 'social_circles_list',
        limit: PAGE_SIZE,
        cursor,
      }, ListMyCirclesResponseSchema);
      return page;
    },
    createCircle: async (name, description) => {
      const response = await execute({
        operationId: 'social_circle_create',
        name,
        description: description || undefined,
        member_ptids: [],
      }, CreateCircleResponseSchema);
      if (!response.circle) throw new Error('mobile.social.circles.invalidResponse');
      return response.circle;
    },
    updateCircle: async (circleId, name, description) => {
      const response = await execute({
        operationId: 'social_circle_update',
        circle_id: circleId,
        name,
        description,
      }, RenameCircleResponseSchema);
      if (!response.circle) throw new Error('mobile.social.circles.invalidResponse');
      return response.circle;
    },
    deleteCircle: async (circleId) => (
      await execute({
        operationId: 'social_circle_delete',
        circle_id: circleId,
      }, DeleteCircleResponseSchema)
    ).success,
    listMembers: async (circleId, cursor) => execute({
      operationId: 'social_circle_members_list',
      circle_id: circleId,
      limit: PAGE_SIZE,
      cursor,
    }, ListCircleMembersResponseSchema),
    addMembers: async (circleId, memberPtids) => (
      await execute({
        operationId: 'social_circle_members_add',
        circle_id: circleId,
        member_ptids: memberPtids,
      }, AddCircleMemberResponseSchema)
    ).memberCount,
    removeMembers: async (circleId, memberPtids) => (
      await execute({
        operationId: 'social_circle_members_remove',
        circle_id: circleId,
        member_ptids: memberPtids,
      }, RemoveCircleMemberResponseSchema)
    ).memberCount,
  };
}

async function mutateMembers(
  circleId: string,
  memberPtids: string[],
  add: boolean,
  get: () => SocialCirclesState,
  set: (partial: Partial<SocialCirclesState> | ((state: SocialCirclesState) => Partial<SocialCirclesState>)) => void,
) {
  const ptids = [...new Set(memberPtids.map((ptid) => ptid.trim()).filter(Boolean))];
  if (ptids.length === 0) return;
  const context = circleContext(get, set);
  await withPendingCircle(circleId, set, async () => {
    const expectedCount = add
      ? await context.gateway.addMembers(circleId, ptids)
      : await context.gateway.removeMembers(circleId, ptids);
    for (let attempt = 0; attempt < CONVERGENCE_ATTEMPTS; attempt += 1) {
      const [members, circles] = await Promise.all([
        readAllMembers(context.gateway, circleId),
        readAllCircles(context.gateway),
      ]);
      requireCurrentScope(context.session, context.scopeKey);
      const circle = circles.find((item) => item.id.toString() === circleId);
      const membershipConverged = ptids.every((ptid) => (
        members.some((member) => member.actorPtid === ptid) === add
      ));
      if (
        circle
        && circle.memberCount === expectedCount
        && BigInt(members.length) === expectedCount
        && membershipConverged
      ) {
        set((state) => ({
          circles,
          membersByCircle: { ...state.membersByCircle, [circleId]: members },
          nextCursor: '',
          hasMore: false,
        }));
        return;
      }
      await Promise.resolve();
    }
    throw new Error('mobile.social.circles.memberMutationUnconfirmed');
  });
}

async function readAllCircles(gateway: CircleGateway): Promise<Circle[]> {
  const circles: Circle[] = [];
  let cursor = '';
  do {
    const page = await gateway.listCircles(cursor);
    circles.push(...page.circles);
    cursor = page.hasMore ? page.nextCursor : '';
  } while (cursor);
  return mergeCircles([], circles);
}

async function readAllMembers(
  gateway: CircleGateway,
  circleId: string,
): Promise<CircleMember[]> {
  const members: CircleMember[] = [];
  let cursor = '';
  do {
    const page = await gateway.listMembers(circleId, cursor);
    members.push(...page.members);
    cursor = page.hasMore ? page.nextCursor : '';
  } while (cursor);
  return [...new Map(members.map((member) => [member.actorPtid, member])).values()];
}

function circleContext(
  get: () => SocialCirclesState,
  set: (partial: Partial<SocialCirclesState>) => void,
) {
  const session = useSocialStore.getState().authSession;
  if (!session) throw new Error('mobile.social.notAuthenticated');
  const scopeKey = mobileAuthScopeKey(session);
  if (get().sessionKey !== scopeKey) {
    circleReadToken = null;
    memberReadTokens.clear();
    pickerSearchToken = null;
    set({ ...initialProjection, sessionKey: scopeKey });
  }
  return { session, scopeKey, gateway: createCircleGateway(session) };
}

function requireCurrentScope(session: MobileAuthSession, scopeKey: string) {
  if (
    useSocialStore.getState().authSession !== session
    || useSocialCirclesStore.getState().sessionKey !== scopeKey
  ) {
    throw new Error('mobile.social.circles.sessionChanged');
  }
}

function circleReadCurrent(token: object, session: MobileAuthSession, scopeKey: string) {
  return circleReadToken === token
    && useSocialStore.getState().authSession === session
    && useSocialCirclesStore.getState().sessionKey === scopeKey;
}

function memberReadCurrent(
  circleId: string,
  token: object,
  session: MobileAuthSession,
  scopeKey: string,
) {
  return memberReadTokens.get(circleId) === token
    && useSocialStore.getState().authSession === session
    && useSocialCirclesStore.getState().sessionKey === scopeKey;
}

async function withPendingCircle(
  circleId: string,
  set: (
    partial: Partial<SocialCirclesState>
      | ((state: SocialCirclesState) => Partial<SocialCirclesState>)
  ) => void,
  action: () => Promise<void>,
) {
  set((state) => ({
    pendingCircleIds: { ...state.pendingCircleIds, [circleId]: true },
    error: null,
  }));
  try {
    await action();
  } catch (error) {
    set({ error: errorMessage(error) });
    throw error;
  } finally {
    set((state) => ({
      pendingCircleIds: { ...state.pendingCircleIds, [circleId]: false },
    }));
  }
}

function unwrapEnvelope(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data?: unknown }).data ?? {};
  }
  return payload ?? {};
}

function errorFromPayload(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object') {
    const value = payload as Record<string, unknown>;
    const message = value.message ?? value.msg ?? value.detail;
    if (typeof message === 'string' && message) return message;
  }
  return `mobile.social.circles.http.${status}`;
}

function requireName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error('mobile.social.circles.nameRequired');
  return normalized;
}

function mergeCircles(current: Circle[], incoming: Circle[]): Circle[] {
  return [...new Map([...current, ...incoming].map((circle) => [
    circle.id.toString(),
    circle,
  ])).values()];
}

function mergePeople(local: ActorSearchResult[], remote: ActorSearchResult[]) {
  return [...new Map([...local, ...remote].map((actor) => [actor.ptid, actor])).values()];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'mobile.social.circles.failed';
}
