import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

// --- Types ---

export type InterventionType = 'text' | 'choice' | 'confirm';

export interface InterventionRequest {
  id: string;
  sessionKey: string;
  messageId: string;
  prompt: string;
  type: InterventionType;
  choices?: string[];
  defaultValue?: string;
  createdAt: number;
}

interface InterventionState {
  activeIntervention: InterventionRequest | null;
  draft: string;
  history: InterventionRequest[];
}

interface InterventionActions {
  requestIntervention: (request: Omit<InterventionRequest, 'id' | 'createdAt'>) => void;
  triggerIntervention: (request: Omit<InterventionRequest, 'id' | 'createdAt'>) => void;
  setDraft: (value: string) => void;
  submit: () => void;
  cancel: () => void;
  selectChoice: (choice: string) => void;
  confirm: (accepted: boolean) => void;
}

type InterventionStore = InterventionState & InterventionActions;

// --- Constants ---

const MAX_HISTORY_SIZE = 20;

// --- Store ---

/**
 * Lazily resolve the chat store to avoid circular dependency
 * (handler.ts -> intervention.ts -> chat.ts -> streaming/index.ts -> handler.ts)
 */
function getChatStore() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useChatStore } = require('./chat') as { useChatStore: { getState: () => { currentSessionKey: string; sendMessage: (content: string) => void } } };
  return useChatStore.getState();
}

export const useInterventionStore = createDesktopStore<InterventionStore>(
  'intervention',
  (set, get) => ({
    activeIntervention: null,
    draft: '',
    history: [],

    requestIntervention: (request) => {
      const intervention: InterventionRequest = {
        ...request,
        id: `intervention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: Date.now(),
      };
      log.info('intervention', 'Intervention requested', {
        id: intervention.id,
        type: intervention.type,
        sessionKey: intervention.sessionKey,
      });
      set({
        activeIntervention: intervention,
        draft: intervention.defaultValue || '',
      });
    },

    triggerIntervention: (request) => {
      get().requestIntervention(request);
    },

    setDraft: (value) => {
      set({ draft: value });
    },

    submit: () => {
      const { activeIntervention, draft } = get();
      if (!activeIntervention) return;
      if (!draft.trim()) return;

      log.info('intervention', 'Intervention submitted', {
        id: activeIntervention.id,
        type: activeIntervention.type,
      });

      submitResponseAsMessage(activeIntervention, draft.trim());
      archiveIntervention(set, get, activeIntervention);
    },

    cancel: () => {
      const { activeIntervention } = get();
      if (!activeIntervention) return;

      log.info('intervention', 'Intervention cancelled', {
        id: activeIntervention.id,
      });

      archiveIntervention(set, get, activeIntervention);
    },

    selectChoice: (choice) => {
      const { activeIntervention } = get();
      if (!activeIntervention) return;
      if (activeIntervention.type !== 'choice') return;

      log.info('intervention', 'Intervention choice selected', {
        id: activeIntervention.id,
        choice,
      });

      submitResponseAsMessage(activeIntervention, choice);
      archiveIntervention(set, get, activeIntervention);
    },

    confirm: (accepted) => {
      const { activeIntervention } = get();
      if (!activeIntervention) return;
      if (activeIntervention.type !== 'confirm') return;

      const response = accepted ? 'yes' : 'no';
      log.info('intervention', 'Intervention confirmed', {
        id: activeIntervention.id,
        accepted,
      });

      submitResponseAsMessage(activeIntervention, response);
      archiveIntervention(set, get, activeIntervention);
    },
  }),
);

// --- Helpers ---

function submitResponseAsMessage(intervention: InterventionRequest, content: string): void {
  const chatState = getChatStore();
  if (chatState.currentSessionKey === intervention.sessionKey) {
    chatState.sendMessage(content);
  }
}

function archiveIntervention(
  set: (partial: Partial<InterventionState>) => void,
  get: () => InterventionStore,
  intervention: InterventionRequest,
): void {
  const { history } = get();
  const updatedHistory = [intervention, ...history].slice(0, MAX_HISTORY_SIZE);
  set({
    activeIntervention: null,
    draft: '',
    history: updatedHistory,
  });
}
