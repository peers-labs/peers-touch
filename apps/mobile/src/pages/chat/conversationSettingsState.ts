import type { ChatActionState } from '../../features/chat/chatActionState';

export type ConversationSettingsPhase =
  | 'idle'
  | 'pending'
  | 'retrying'
  | 'committed'
  | 'failed';

export interface ConversationSettingsFeedback {
  readonly conversationKey: string;
  readonly phase: ConversationSettingsPhase;
  readonly patch: Partial<ChatActionState> | null;
}

export const IDLE_CONVERSATION_SETTINGS_FEEDBACK: ConversationSettingsFeedback = {
  conversationKey: '',
  phase: 'idle',
  patch: null,
};

export function conversationSettingsFeedback(
  conversationKey: string,
  phase: Exclude<ConversationSettingsPhase, 'idle'>,
  patch: Partial<ChatActionState>,
): ConversationSettingsFeedback {
  return {
    conversationKey,
    phase,
    patch: { ...patch },
  };
}

export function chatActionStateMatchesPatch(
  projected: ChatActionState | undefined,
  patch: Partial<ChatActionState>,
): projected is ChatActionState {
  if (!projected) return false;
  const keys = Object.keys(patch) as Array<keyof ChatActionState>;
  return keys.length > 0 && keys.every((key) => projected[key] === patch[key]);
}
