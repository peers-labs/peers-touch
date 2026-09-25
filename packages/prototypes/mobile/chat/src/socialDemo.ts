import { demoContacts, demoConversations } from './data';
import type { Contact, Conversation } from './types';

export type SocialEvidenceScenario =
  | 'social-unavailable'
  | 'find-people-no-membership'
  | 'find-people-member'
  | 'contact-direct'
  | 'request-unknown';

export const socialEvidenceScenarios: SocialEvidenceScenario[] = [
  'social-unavailable',
  'find-people-no-membership',
  'find-people-member',
  'contact-direct',
  'request-unknown',
];

export const demoRequestContact = demoContacts.find((contact) => contact.key === 'frank')!;
export const demoPeopleHandle = `@${demoRequestContact.key}@local.station`;
const demoFederation = { id: 'demo-federation-local', name: 'Mobile Development' };

export interface DemoFriendRequest {
  readonly intentId: string;
  readonly contactKey: string;
  readonly federationId: string;
  readonly status: 'pending' | 'unknown' | 'reconciling' | 'sent' | 'accepted';
}

export interface SocialDemoState {
  readonly runtime: 'ready' | 'failed' | 'retrying';
  readonly federations: ReadonlyArray<typeof demoFederation>;
  readonly contacts: Contact[];
  readonly conversations: Conversation[];
  readonly request: DemoFriendRequest | null;
  readonly direct: {
    readonly contactKey: string;
    readonly status: 'preparing' | 'failed' | 'ready';
    readonly conversation?: Conversation;
  } | null;
}

export type SocialDemoAction =
  | { type: 'reset'; scenario: string }
  | { type: 'retry-runtime' }
  | { type: 'resolve-runtime'; outcome: 'ready' | 'failed' }
  | { type: 'send-request'; contactKey: string; federationId: string }
  | { type: 'resolve-request'; outcome: 'sent' | 'unknown' }
  | { type: 'check-request' }
  | { type: 'accept-request' }
  | { type: 'open-direct'; contactKey: string }
  | { type: 'resolve-direct'; outcome: 'ready' | 'failed' }
  | { type: 'close-direct' };

export function createSocialDemo(scenario: string): SocialDemoState {
  const newRequest = scenario === 'find-people-no-membership'
    || scenario === 'find-people-member'
    || scenario === 'request-unknown';
  return {
    runtime: scenario === 'social-unavailable' ? 'failed' : 'ready',
    federations: scenario === 'find-people-no-membership' ? [] : [demoFederation],
    contacts: newRequest
      ? demoContacts.filter((contact) => contact.key !== demoRequestContact.key)
      : [...demoContacts],
    conversations: [...demoConversations],
    request: scenario === 'request-unknown' ? {
      intentId: 'demo-friend-request-frank',
      contactKey: demoRequestContact.key,
      federationId: demoFederation.id,
      status: 'unknown',
    } : null,
    direct: null,
  };
}

// These transitions are evidence controls, never simulated network callbacks.
export function socialDemoReducer(state: SocialDemoState, action: SocialDemoAction): SocialDemoState {
  switch (action.type) {
    case 'reset':
      return createSocialDemo(action.scenario);
    case 'retry-runtime':
      return state.runtime === 'failed' ? { ...state, runtime: 'retrying' } : state;
    case 'resolve-runtime':
      return state.runtime === 'retrying' ? { ...state, runtime: action.outcome } : state;
    case 'send-request':
      if (state.runtime !== 'ready' || state.request
        || action.contactKey !== demoRequestContact.key
        || state.contacts.some((contact) => contact.key === action.contactKey)
        || !state.federations.some((federation) => federation.id === action.federationId)) return state;
      return {
        ...state,
        request: {
          intentId: 'demo-friend-request-frank',
          contactKey: action.contactKey,
          federationId: action.federationId,
          status: 'pending',
        },
      };
    case 'resolve-request':
      if (!state.request || !['pending', 'reconciling'].includes(state.request.status)) return state;
      return { ...state, request: { ...state.request, status: action.outcome } };
    case 'check-request':
      return state.request?.status === 'unknown'
        ? { ...state, request: { ...state.request, status: 'reconciling' } }
        : state;
    case 'accept-request':
      if (state.request?.status !== 'sent') return state;
      return {
        ...state,
        request: { ...state.request, status: 'accepted' },
        contacts: [...state.contacts, demoRequestContact],
      };
    case 'open-direct':
      if (state.runtime !== 'ready' || state.direct?.status === 'preparing'
        || !state.federations.length
        || !state.contacts.some((contact) => contact.key === action.contactKey)) return state;
      return { ...state, direct: { contactKey: action.contactKey, status: 'preparing' } };
    case 'resolve-direct': {
      if (state.direct?.status !== 'preparing') return state;
      if (action.outcome === 'failed') {
        return { ...state, direct: { ...state.direct, status: 'failed' } };
      }
      const contact = state.contacts.find((entry) => entry.key === state.direct?.contactKey);
      if (!contact) return state;
      const existing = state.conversations.find((conversation) =>
        conversation.key === contact.key || conversation.key === `demo-direct-${contact.key}`);
      const conversation: Conversation = existing ?? {
        key: `demo-direct-${contact.key}`,
        name: contact.name,
        avatar: contact.avatar,
        avatarGradient: contact.avatarGradient,
        online: contact.online,
        lastMessage: '',
        time: '',
        unread: 0,
      };
      return {
        ...state,
        direct: { ...state.direct, status: 'ready', conversation },
        conversations: existing ? state.conversations : [conversation, ...state.conversations],
      };
    }
    case 'close-direct':
      return { ...state, direct: null };
  }
}
