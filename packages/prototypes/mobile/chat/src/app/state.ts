/**
 * MobileApp state — one pure reducer over a discriminated action union.
 *
 * This mirrors the main product's unidirectional flow: screens dispatch
 * intents, all mutations happen here immutably, and the view is derived from
 * AppState. No component holds business state; local-only UI (e.g. an input
 * draft not yet committed) is the only exception and is modeled explicitly.
 */
import type { AppState, CallState, MediaKind, MomentComment, Route, TabId } from './model';
import { createInitialState, ME } from './model';

export type Action =
  | { type: 'tab'; tab: TabId }
  | { type: 'navigate'; route: Route }
  | { type: 'back' }
  | { type: 'search/open' }
  | { type: 'search/close' }
  | { type: 'newChat/open' }
  | { type: 'newChat/close' }
  | { type: 'composer/open' }
  | { type: 'composer/close' }
  | { type: 'composer/draft'; value: string }
  | { type: 'composer/audience'; audience: 'neighbors' | 'public' }
  | { type: 'moment/publish'; text: string }
  | { type: 'moment/toggleLike'; id: string }
  | { type: 'moment/toggleComments'; id: string }
  | { type: 'moment/commentDraft'; id: string; value: string }
  | { type: 'moment/addComment'; id: string; text: string }
  | { type: 'moment/openMenu'; id: string | null }
  | { type: 'setting/set'; key: keyof AppState['settings']; value: string | boolean }
  | { type: 'station/select'; id: string }
  | { type: 'station/add'; name: string; handle: string }
  | { type: 'auth/signOut' }
  | { type: 'auth/signIn' }
  | { type: 'chat/send'; conversationId: string; text: string }
  | { type: 'call/start'; conversationId: string; media: MediaKind }
  | { type: 'call/accept' }
  | { type: 'call/toggleMic' }
  | { type: 'call/toggleCamera' }
  | { type: 'call/tick-elapsed' }
  | { type: 'call/end' };

let commentSeq = 0;

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'tab':
      return { ...state, route: { tab: action.tab }, openMomentMenu: null };

    case 'navigate':
      return { ...state, route: action.route, searchOpen: false, newChatOpen: false };

    case 'back':
      return backFrom(state);

    case 'search/open':
      return { ...state, searchOpen: true };
    case 'search/close':
      return { ...state, searchOpen: false };

    case 'newChat/open':
      return { ...state, newChatOpen: true };
    case 'newChat/close':
      return { ...state, newChatOpen: false };

    case 'composer/open':
      return { ...state, composerOpen: true };
    case 'composer/close':
      return { ...state, composerOpen: false, composerDraft: '' };
    case 'composer/draft':
      return { ...state, composerDraft: action.value };
    case 'composer/audience':
      return { ...state, composerAudience: action.audience };

    case 'moment/publish': {
      const text = action.text.trim();
      if (!text) return state;
      const moment = {
        id: `mo-local-${Date.now()}`, author: ME.name, tone: ME.tone, time: '刚刚',
        text, likes: 0, liked: false, comments: [],
      };
      return { ...state, moments: [moment, ...state.moments], composerOpen: false, composerDraft: '' };
    }

    case 'moment/toggleLike':
      return {
        ...state,
        moments: state.moments.map(m => m.id === action.id
          ? { ...m, liked: !m.liked, likes: m.likes + (m.liked ? -1 : 1) }
          : m),
      };

    case 'moment/toggleComments':
      return { ...state, expandedComments: { ...state.expandedComments, [action.id]: !state.expandedComments[action.id] } };

    case 'moment/commentDraft':
      return { ...state, commentDrafts: { ...state.commentDrafts, [action.id]: action.value } };

    case 'moment/addComment': {
      const text = action.text.trim();
      if (!text) return state;
      const comment: MomentComment = { id: `cm-local-${commentSeq++}`, author: ME.name, tone: ME.tone, text, time: '刚刚' };
      return {
        ...state,
        moments: state.moments.map(m => m.id === action.id ? { ...m, comments: [...m.comments, comment] } : m),
        expandedComments: { ...state.expandedComments, [action.id]: true },
        commentDrafts: { ...state.commentDrafts, [action.id]: '' },
      };
    }

    case 'moment/openMenu':
      return { ...state, openMomentMenu: action.id };

    case 'setting/set':
      return { ...state, settings: { ...state.settings, [action.key]: action.value } };

    case 'station/select':
      return { ...state, currentStationId: action.id };

    case 'station/add': {
      const name = action.name.trim();
      const handle = action.handle.trim();
      if (!name) return state;
      const station = {
        id: `s-local-${Date.now()}`, name, handle: handle || '手动添加', online: true,
      };
      // Adding a station connects to it, so the new selection is immediately
      // reflected on the identity card and settings row.
      return { ...state, stations: [...state.stations, station], currentStationId: station.id };
    }

    case 'auth/signOut':
      // Local prototype gate: close every overlay/call and return to the me
      // root; the host renders the signed-out gate instead of the app.
      return {
        ...state,
        signedOut: true,
        route: { tab: 'me' },
        searchOpen: false,
        newChatOpen: false,
        composerOpen: false,
        call: { status: 'idle' },
      };

    case 'auth/signIn':
      return { ...state, signedOut: false, route: { tab: 'chats' } };

    case 'chat/send': {
      const text = action.text.trim();
      if (!text) return state;
      const message = { id: `msg-local-${Date.now()}`, mine: true, text, time: '' };
      return {
        ...state,
        messages: { ...state.messages, [action.conversationId]: [...(state.messages[action.conversationId] ?? []), message] },
      };
    }

    case 'call/start':
      return { ...state, call: { status: 'outgoing', conversationId: action.conversationId, media: action.media } };
    case 'call/accept': {
      const call = state.call;
      if (call.status !== 'outgoing') return state;
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
