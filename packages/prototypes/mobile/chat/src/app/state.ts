/**
 * MobileApp state — one pure reducer over a discriminated action union.
 *
 * This mirrors the main product's unidirectional flow: screens dispatch
 * intents, all mutations happen here immutably, and the view is derived from
 * AppState. No component holds business state; local-only UI (e.g. an input
 * draft not yet committed, or the in-place rail filter) is the only exception
 * and is modeled explicitly.
 */
import type {
  AppState, AudienceKind, CallState, ChatsSheet, MediaKind, MomentComment, Route, TabId, TrustReason,
} from './model';
import { createInitialState, ME } from './model';
import type { ChatMessage } from './model';
import { buildStationAccessInput, deriveStationLabel, stationIdentityKey } from './stationLink';
import { identityTone } from '../../../../shared/ui-system/identity-tone';
import { applyViewerReaction, emptyReactionState } from '../../../../shared/chat-domain';
import {
  emptyAccessState, grantFixtureDecision, nextOAuthPhase,
  refreshFixtureDecision, submitInviteFixture, submitLoginFixture, submitSchemaFixture,
  type AccessDecision, type GateProfileId, type OAuthProvider,
} from './accessGate';

export interface CircleDraft {
  name: string;
  desc: string;
  memberIds: string[];
}

export type Action =
  | { type: 'tab'; tab: TabId }
  | { type: 'navigate'; route: Route }
  | { type: 'back' }
  | { type: 'chats/sheet'; sheet: ChatsSheet }
  | { type: 'contact/add'; id: string; name: string; role?: string }
  | { type: 'group/start'; id: string; name: string; memberIds: string[] }
  | { type: 'composer/open' }
  | { type: 'composer/close' }
  | { type: 'composer/draft'; value: string }
  | { type: 'composer/audience'; audience: AudienceKind }
  | { type: 'composer/target'; circle?: string; group?: string }
  | { type: 'composer/toggleActor'; id: string }
  | { type: 'composer/addImages'; images: string[] }
  | { type: 'composer/removeImage'; index: number }
  | { type: 'moment/publish' }
  | { type: 'moment/toggleReaction'; id: string; kind: import('./model').ReactionKind }
  | { type: 'moment/toggleComments'; id: string }
  | { type: 'moment/commentDraft'; id: string; value: string }
  | { type: 'moment/addComment'; id: string; text: string }
  | { type: 'moment/delete'; id: string }
  | { type: 'circle/create'; name: string }
  | { type: 'circle/save'; id: string; draft: CircleDraft }
  | { type: 'circle/delete'; id: string }
  | { type: 'setting/set'; key: keyof AppState['settings']; value: string | boolean }
  | { type: 'station/select'; id: string }
  | { type: 'station/add'; url: string }
  | { type: 'auth/signOut' }
  // Access gate attempt lifecycle (fixture decision machine, see accessGate.ts)
  | { type: 'access/start' }
  | { type: 'access/apply'; decision: AccessDecision; profile: GateProfileId }
  | { type: 'access/submit-login'; email: string; password: string }
  | { type: 'access/submit-invite'; code: string }
  | { type: 'access/submit-schema'; values: Record<string, string | boolean | number> }
  | { type: 'access/refresh' }
  | { type: 'access/abandon' }
  | { type: 'access/remembered'; emails: string[] }
  | { type: 'access/oauth-start'; provider: OAuthProvider }
  | { type: 'access/oauth-tick' }
  | { type: 'access/oauth-cancel' }
  | { type: 'access/oauth-retry' }
  | { type: 'access/oauth-check-status' }
  // Scan-to-link establishes a device-linked session outside the gate chain.
  | { type: 'device-link/grant' }
  | { type: 'conv/togglePin'; id: string }
  | { type: 'conv/toggleMute'; id: string }
  | { type: 'chat/send'; conversationId: string; text: string; images?: string[]; replyTo?: { who: string; text: string } }
  | { type: 'chat/send-voice'; conversationId: string; voice: { url: string; durationSeconds: number } }
  | { type: 'message/react'; conversationId: string; messageId: string; kind: import('./model').ReactionKind }
  | { type: 'message/pin'; conversationId: string; messageId: string }
  | { type: 'message/markLater'; conversationId: string; messageId: string }
  | { type: 'message/edit'; conversationId: string; messageId: string; text: string }
  | { type: 'message/recall'; conversationId: string; messageId: string }
  | { type: 'message/hide'; conversationId: string; messageIds: string[] }
  | { type: 'message/forward'; messages: { text: string }[]; toConversationId: string }
  | { type: 'call/start'; conversationId: string; media: MediaKind }
  | { type: 'call/connect' }
  | { type: 'call/accept' }
  | { type: 'call/toggleMic' }
  | { type: 'call/toggleCamera' }
  | { type: 'call/tick-elapsed' }
  | { type: 'call/end' };

let commentSeq = 0;
let localSeq = 0;

/** Monotonic id for viewer-created local entities (contacts, groups, posts…).
    Prefixes differ per entity kind, so one counter guarantees uniqueness. */
export function nextLocalId(): number {
  return localSeq++;
}

/** Apply a fixture gate submission: a GRANTED decision admits into the shell;
    every other result stays on the gate, carrying the Station's error key. */
function applyGateResult(
  state: AppState,
  result: { decision: AccessDecision; granted: boolean; errorKey: string | null },
): AppState {
  if (result.granted) {
    return {
      ...state,
      signedOut: false,
      route: { tab: 'chats' },
      access: {
        ...state.access,
        loading: false,
        errorKey: null,
        decision: result.decision,
        oauthPhase: 'idle',
        oauthErrorKey: null,
        oauthStarted: false,
      },
    };
  }
  return {
    ...state,
    access: {
      ...state.access,
      loading: false,
      decision: result.decision,
      errorKey: result.errorKey,
    },
  };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'tab':
      // Leaving the messages surface cannot leave its sheet floating; the
      // reducer closes the overlay with the route change.
      return { ...state, route: { tab: action.tab }, chatsSheet: 'none' };

    case 'navigate':
      return { ...state, route: action.route, chatsSheet: 'none' };

    case 'back':
      return { ...backFrom(state), chatsSheet: 'none' };

    case 'chats/sheet':
      return { ...state, chatsSheet: action.sheet };

    case 'contact/add': {
      const name = action.name.trim();
      if (!name || state.people.some(p => p.id === action.id || p.name === name)) return state;
      const person = {
        id: action.id, name, tone: identityTone(name),
        role: action.role?.trim() || '新联系人', online: false,
      };
      return { ...state, people: [person, ...state.people] };
    }

    case 'group/start': {
      const name = action.name.trim();
      if (!name || action.memberIds.length === 0 || state.conversations.some(c => c.id === action.id)) {
        return state;
      }
      const byId = new Map(state.people.map(p => [p.id, p]));
      const members = [
        { id: 'viewer', name: ME.name, tone: ME.tone },
        ...action.memberIds
          .map(id => byId.get(id))
          .filter((p): p is NonNullable<typeof p> => Boolean(p))
          .map(p => ({ id: p.id, name: p.name, tone: p.tone })),
      ];
      const conversation = {
        id: action.id, name, preview: '', time: '刚刚', unread: 0,
        tone: ME.tone, kind: 'group' as const, members,
      };
      // The new group is a real catalog entity: it opens as a thread and also
      // appears in the contacts 群聊 section with its composite member tiles.
      const group = {
        id: action.id, name, members: members.length, tone: ME.tone, memberTiles: members,
      };
      return {
        ...state,
        chatsSheet: 'none',
        conversations: [conversation, ...state.conversations],
        groups: [group, ...state.groups.filter(g => g.id !== action.id)],
        messages: { ...state.messages, [action.id]: [] },
        route: { tab: 'chats', conversationId: action.id },
      };
    }

    case 'composer/open':
      return { ...state, composerOpen: true };
    case 'composer/close':
      return {
        ...state,
        composerOpen: false,
        composerDraft: '',
        composerAudience: 'public',
        composerActorIds: [],
        composerImages: [],
      };
    case 'composer/draft':
      return { ...state, composerDraft: action.value };
    case 'composer/audience':
      return { ...state, composerAudience: action.audience };
    case 'composer/target':
      return action.circle !== undefined
        ? { ...state, composerCircleId: action.circle }
        : { ...state, composerGroupId: action.group ?? '' };
    case 'composer/toggleActor':
      return {
        ...state,
        composerActorIds: state.composerActorIds.includes(action.id)
          ? state.composerActorIds.filter(x => x !== action.id)
          : [...state.composerActorIds, action.id],
      };

    case 'composer/addImages': {
      // Hard cap 9 (desktop MAX_IMAGES): ignore picks beyond remaining room.
      const room = 9 - state.composerImages.length;
      if (room <= 0) return state;
      return {
        ...state,
        composerImages: [...state.composerImages, ...action.images.slice(0, room)],
      };
    }
    case 'composer/removeImage':
      return {
        ...state,
        composerImages: state.composerImages.filter((_, i) => i !== action.index),
      };

    case 'moment/publish': {
      const text = state.composerDraft.trim();
      if (!text) return state;
      const audience = state.composerAudience;
      const reason: TrustReason = audience === 'self'
        ? 'self'
        : audience === 'circle'
          ? 'circle'
          : audience === 'public'
            ? 'public'
            : 'following';
      const circle = state.circles.find(c => c.id === state.composerCircleId);
      const group = state.audienceGroups.find(g => g.id === state.composerGroupId);
      const actors = state.composerActorIds
        .map(id => state.momentPeople.find(p => p.id === id)?.name)
        .filter((n): n is string => Boolean(n));
      const post = {
        id: `mo-local-${localSeq++}`,
        author: ME.name, tone: ME.tone, source: 'local' as const, reason,
        audience,
        circle: audience === 'circle' ? circle?.name : undefined,
        group: audience === 'group' ? group?.name : undefined,
        audienceActors: actors.length ? actors : undefined,
        at: '刚刚',
        text,
        images: state.composerImages.length ? state.composerImages : undefined,
        reactions: {},
        comments: [],
      };
      return {
        ...state,
        moments: [post, ...state.moments],
        composerOpen: false,
        composerDraft: '',
        composerAudience: 'public',
        composerActorIds: [],
        composerImages: [],
      };
    }

    // Multi-select reactions, identical semantics to desktop moments:
    // choosing a held kind removes it; other held kinds stay counted.
    case 'moment/toggleReaction':
      return {
        ...state,
        moments: state.moments.map(m => {
          if (m.id !== action.id) return m;
          const held = new Set(m.viewerReactions ?? []);
          const reactions = { ...m.reactions };
          if (held.has(action.kind)) {
            held.delete(action.kind);
            const current = reactions[action.kind] ?? 0;
            if (current <= 1) delete reactions[action.kind];
            else reactions[action.kind] = current - 1;
          } else {
            held.add(action.kind);
            reactions[action.kind] = (reactions[action.kind] ?? 0) + 1;
          }
          const viewerReactions = [...held];
          return { ...m, reactions, viewerReactions: viewerReactions.length ? viewerReactions : undefined };
        }),
      };

    case 'moment/toggleComments':
      return {
        ...state,
        commentsCollapsed: {
          ...state.commentsCollapsed,
          [action.id]: !state.commentsCollapsed[action.id],
        },
      };

    case 'moment/commentDraft':
      return { ...state, commentDrafts: { ...state.commentDrafts, [action.id]: action.value } };

    case 'moment/addComment': {
      const text = action.text.trim();
      if (!text) return state;
      const comment: MomentComment = {
        id: `cm-local-${commentSeq++}`, author: ME.name, tone: ME.tone, text, at: '刚刚',
      };
      return {
        ...state,
        moments: state.moments.map(m => m.id === action.id ? { ...m, comments: [...m.comments, comment] } : m),
        commentsCollapsed: { ...state.commentsCollapsed, [action.id]: false },
        commentDrafts: { ...state.commentDrafts, [action.id]: '' },
      };
    }

    case 'moment/delete':
      return { ...state, moments: state.moments.filter(m => m.id !== action.id) };

    case 'circle/create': {
      const name = action.name.trim();
      if (!name) return state;
      return {
        ...state,
        circles: [...state.circles, {
          id: `c-local-${localSeq++}`,
          name,
          desc: '',
          members: [{ id: 'viewer', name: ME.name, tone: ME.tone }],
        }],
      };
    }

    case 'circle/save': {
      const memberById = (memberId: string) => {
        const existing = state.circles.find(c => c.id === action.id)?.members.find(m => m.id === memberId);
        if (existing) return existing;
        const person = state.momentPeople.find(p => p.id === memberId);
        return person
          ? { id: person.id, name: person.name, tone: person.tone }
          : { id: memberId, name: memberId, tone: ME.tone };
      };
      return {
        ...state,
        circles: state.circles.map(c => c.id === action.id
          ? {
              ...c,
              name: action.draft.name,
              desc: action.draft.desc.trim(),
              members: action.draft.memberIds.map(memberById),
            }
          : c),
      };
    }

    case 'circle/delete':
      return { ...state, circles: state.circles.filter(c => c.id !== action.id) };

    case 'setting/set':
      return { ...state, settings: { ...state.settings, [action.key]: action.value } };

    case 'station/select':
      return { ...state, currentStationId: action.id };

    case 'station/add': {
      // Real-device contract: the single input is a Station URL / private
      // connection code; the label is derived, never typed. Invalid input or a
      // duplicate origin is rejected (no-op; the dialog surfaces the reason).
      const accessInput = buildStationAccessInput(action.url);
      if (!accessInput) return state;
      const identity = stationIdentityKey(accessInput);
      if (state.stations.some(st => stationIdentityKey(st.handle) === identity)) return state;
      const station = {
        id: `s-local-${localSeq++}`,
        name: deriveStationLabel(accessInput, 'Station'),
        handle: accessInput,
        // The real app resolves online asynchronously after identity discovery;
        // the prototype simulates a successful discovery as available.
        online: true,
        // Manually added Stations default to the full credential policy.
        gateProfile: 'login-full' as GateProfileId,
      };
      // Adding a station connects to it, so the new selection is immediately
      // reflected on the identity card and settings row.
      return { ...state, stations: [...state.stations, station], currentStationId: station.id };
    }

    case 'auth/signOut':
      // Local prototype gate: close every overlay/call, drop the access
      // attempt and return to the me root; the host renders the signed-out
      // gate instead of the app.
      return {
        ...state,
        signedOut: true,
        access: emptyAccessState(),
        route: { tab: 'me' },
        chatsSheet: 'none',
        composerOpen: false,
        call: { status: 'idle' },
      };

    // ── Access gate fixture machine ──────────────────────────────────────
    // Admission is GRANTED-only: no action flips signedOut without a decision
    // in ACCESS_DECISION_GRANTED (or a device-linked session from scanning).
    case 'access/start':
      return {
        ...state,
        access: { ...state.access, phase: 'handshake', loading: true, errorKey: null },
      };

    case 'access/apply':
      return {
        ...state,
        access: {
          ...state.access,
          phase: 'gate',
          loading: false,
          profile: action.profile,
          attemptId: action.decision.attemptId,
          decision: action.decision,
          errorKey: null,
          oauthPhase: 'idle',
          oauthErrorKey: null,
          oauthStarted: false,
        },
      };

    case 'access/submit-login': {
      if (!state.access.decision) return state;
      const result = submitLoginFixture(state.access.decision, {
        email: action.email,
        password: action.password,
      });
      return applyGateResult(state, result);
    }

    case 'access/submit-invite': {
      if (!state.access.decision) return state;
      const result = submitInviteFixture(state.access.decision, action.code);
      // Invite redemption only advances the gate chain; it never admits on its
      // own, so a non-granted result stays inside the gate with its error.
      return applyGateResult(state, result);
    }

    case 'access/submit-schema': {
      if (!state.access.decision) return state;
      const result = submitSchemaFixture(state.access.decision, action.values);
      return applyGateResult(state, result);
    }

    case 'access/refresh': {
      if (!state.access.decision || !state.access.profile) return state;
      return {
        ...state,
        access: {
          ...state.access,
          loading: false,
          errorKey: null,
          decision: refreshFixtureDecision(state.access.decision, state.access.profile),
        },
      };
    }

    case 'access/abandon':
      // Local-first navigation back to the Station picker; the attempt itself
      // is Station-scoped and expires on its own (mirrors abandonAccessAttempt).
      return { ...state, access: emptyAccessState() };

    case 'access/remembered':
      return { ...state, access: { ...state.access, rememberedEmails: action.emails } };

    case 'access/oauth-start':
      return {
        ...state,
        access: {
          ...state.access,
          loading: true,
          oauthStarted: true,
          oauthPhase: 'starting',
          oauthErrorKey: null,
        },
      };

    case 'access/oauth-tick': {
      // Fixture-seeded evidence phases (oauthStarted=false) stay frozen.
      if (!state.access.oauthStarted) return state;
      const phase = nextOAuthPhase(state.access.oauthPhase);
      if (phase === 'active_session' && state.access.decision) {
        return {
          ...state,
          signedOut: false,
          route: { tab: 'chats' },
          access: {
            ...state.access,
            loading: false,
            oauthStarted: false,
            oauthPhase: phase,
            decision: grantFixtureDecision(state.access.decision),
          },
        };
      }
      return { ...state, access: { ...state.access, oauthPhase: phase } };
    }

    case 'access/oauth-cancel':
      return {
        ...state,
        access: {
          ...state.access,
          loading: false,
          oauthStarted: false,
          oauthPhase: 'idle',
          oauthErrorKey: null,
        },
      };

    case 'access/oauth-retry':
      return {
        ...state,
        access: {
          ...state.access,
          loading: true,
          oauthStarted: true,
          oauthPhase: 'starting',
          oauthErrorKey: null,
        },
      };

    case 'access/oauth-check-status': {
      // Uncertain delivery re-evaluates once; the next tick either grants or
      // surfaces the failure, same recovery semantics as refreshOAuthStatus.
      if (!state.access.oauthStarted) return state;
      const phase = nextOAuthPhase(state.access.oauthPhase);
      if (phase === 'active_session' && state.access.decision) {
        return {
          ...state,
          signedOut: false,
          route: { tab: 'chats' },
          access: {
            ...state.access,
            loading: false,
            oauthStarted: false,
            oauthPhase: phase,
            decision: grantFixtureDecision(state.access.decision),
          },
        };
      }
      return { ...state, access: { ...state.access, oauthPhase: phase } };
    }

    case 'device-link/grant':
      // Scan-to-link produces a device-linked native session directly; no
      // Station access gate is involved in that protocol.
      return { ...state, signedOut: false, access: emptyAccessState(), route: { tab: 'chats' } };

    case 'conv/togglePin':
      return {
        ...state,
        conversations: state.conversations.map(c => c.id === action.id ? { ...c, pinned: !c.pinned } : c),
      };

    case 'conv/toggleMute':
      return {
        ...state,
        conversations: state.conversations.map(c => c.id === action.id ? { ...c, muted: !c.muted } : c),
      };

    case 'chat/send': {
      const text = action.text.trim();
      const images = action.images ?? [];
      if (!text && images.length === 0) return state;
      const message: ChatMessage = {
        id: `msg-local-${localSeq++}`, mine: true, text, time: '',
        images: images.length ? images : undefined,
        replyTo: action.replyTo,
        ts: Date.now(),
      };

      // A direct thread entered from a contact without a chat-list row is
      // synthesized on demand; the first message promotes it into the list so
      // the new contact's conversation is a real, revisit-able session.
      let conversations = state.conversations;
      if (!conversations.some(c => c.id === action.conversationId)
        && action.conversationId.startsWith('direct-')) {
        const person = state.people.find(p => p.id === action.conversationId.slice('direct-'.length));
        if (person) {
          conversations = [{
            id: action.conversationId, name: person.name,
            preview: text || (images.length ? '[图片]' : ''), time: '刚刚', unread: 0,
            tone: person.tone, kind: 'person' as const, online: person.online,
          }, ...conversations];
        }
      } else if (conversations.some(c => c.id === action.conversationId)) {
        conversations = conversations.map(c => c.id === action.conversationId
          ? { ...c, preview: text || (images.length ? '[图片]' : c.preview), time: '刚刚' }
          : c);
      }

      return {
        ...state,
        conversations,
        messages: { ...state.messages, [action.conversationId]: [...(state.messages[action.conversationId] ?? []), message] },
      };
    }

    case 'chat/send-voice': {
      const message: ChatMessage = {
        id: `msg-local-${localSeq++}`, mine: true, text: '', time: '',
        voice: action.voice, ts: Date.now(),
      };
      let conversations = state.conversations;
      if (!conversations.some(c => c.id === action.conversationId)
        && action.conversationId.startsWith('direct-')) {
        const person = state.people.find(p => p.id === action.conversationId.slice('direct-'.length));
        if (person) {
          conversations = [{
            id: action.conversationId, name: person.name,
            preview: '[语音]', time: '刚刚', unread: 0,
            tone: person.tone, kind: 'person' as const, online: person.online,
          }, ...conversations];
        }
      } else if (conversations.some(c => c.id === action.conversationId)) {
        conversations = conversations.map(c => c.id === action.conversationId
          ? { ...c, preview: '[语音]', time: '刚刚' }
          : c);
      }
      return {
        ...state,
        conversations,
        messages: { ...state.messages, [action.conversationId]: [...(state.messages[action.conversationId] ?? []), message] },
      };
    }

    case 'message/react': {
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: applyViewerReaction(
            state.messages[action.conversationId] ?? [],
            action.messageId,
            action.kind,
          ),
        },
      };
    }

    case 'message/pin':
    case 'message/markLater': {
      const flag = action.type === 'message/pin' ? 'pinned' as const : 'markedForLater' as const;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: (state.messages[action.conversationId] ?? []).map(m =>
            m.id === action.messageId ? { ...m, [flag]: !m[flag] } : m),
        },
      };
    }

    case 'message/edit': {
      const text = action.text.trim();
      if (!text) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: (state.messages[action.conversationId] ?? []).map(m =>
            m.id === action.messageId ? { ...m, text, edited: true } : m),
        },
        conversations: state.conversations.map(c => c.id === action.conversationId ? { ...c, preview: text, time: '刚刚' } : c),
      };
    }

    case 'message/recall': {
      // EditMessageIntent/RetractMessageIntent local equivalent: the bubble
      // collapses into the same centered notice the desktop surface renders.
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: (state.messages[action.conversationId] ?? []).map(m =>
            m.id === action.messageId
              ? { ...m, recalled: true, text: '', images: undefined, reactions: emptyReactionState(), replyTo: undefined }
              : m),
        },
      };
    }

    case 'message/hide': {
      // HideMessageForActorIntent: removal is local to this viewer only.
      const hidden = new Set(action.messageIds);
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.conversationId]: (state.messages[action.conversationId] ?? []).filter(m => !hidden.has(m.id)),
        },
      };
    }

    case 'message/forward': {
      if (action.messages.length === 0) return state;
      const forwarded: ChatMessage[] = action.messages.map((m, index) => ({
        id: `local-fwd-${localSeq}-${index}`, mine: true, text: `转发：${m.text}`, time: '刚刚', ts: Date.now(),
      }));
      localSeq++;
      const preview = forwarded[forwarded.length - 1].text;
      return {
        ...state,
        messages: { ...state.messages, [action.toConversationId]: [...(state.messages[action.toConversationId] ?? []), ...forwarded] },
        conversations: state.conversations.map(c => c.id === action.toConversationId ? { ...c, preview, time: '刚刚' } : c),
      };
    }

    case 'call/start':
      return { ...state, call: { status: 'outgoing', conversationId: action.conversationId, media: action.media } };
    case 'call/connect': {
      const call = state.call;
      if (call.status !== 'outgoing') return state;
      return { ...state, call: { status: 'connecting', conversationId: call.conversationId, media: call.media } };
    }
    case 'call/accept': {
      const call = state.call;
      if (call.status !== 'connecting') return state;
      return { ...state, call: { status: 'active', conversationId: call.conversationId, media: call.media, micMuted: false, cameraOff: false, elapsed: 0 } };
    }
    case 'call/toggleMic': {
      const call = state.call;
      if (call.status !== 'active') return state;
      return { ...state, call: { ...call, micMuted: !call.micMuted } };
    }
    case 'call/toggleCamera': {
      const call = state.call;
      if (call.status !== 'active') return state;
      return { ...state, call: { ...call, cameraOff: !call.cameraOff } };
    }
    case 'call/tick-elapsed': {
      const call = state.call;
      if (call.status !== 'active') return state;
      return { ...state, call: { ...call, elapsed: call.elapsed + 1 } };
    }
    case 'call/end':
      return { ...state, call: { status: 'idle' } };

    default:
      return state;
  }
}

function backFrom(state: AppState): AppState {
  const { route } = state;
  // Detail pages pop to their tab root; conversation pops to the chat list.
  if (route.tab === 'me' && route.setting) return { ...state, route: { tab: 'me' } };
  if (route.tab === 'chats' && (route.conversationId || route.contactDetail)) {
    return { ...state, route: { tab: 'chats' } };
  }
  return state;
}

/** Whether the bottom tab bar is visible — hidden on any pushed sub-page. */
export function tabBarVisible(state: AppState): boolean {
  const { route } = state;
  if (state.call.status !== 'idle') return false;
  if (route.tab === 'chats' && (route.conversationId || route.contactDetail)) return false;
  if (route.tab === 'me' && route.setting) return false;
  return true;
}

export { createInitialState };
export type { CallState };
