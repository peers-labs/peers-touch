import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { defaultChatActionState } from '../../features/chat/chatActionState';
import { ChatActionSheet } from './ChatOverlayHost';
import {
  chatActionStateMatchesPatch,
  conversationSettingsFeedback,
} from './conversationSettingsState';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

const NOOP = () => undefined;
const actionSheetProps = {
  open: true,
  state: defaultChatActionState(),
  onClose: NOOP,
  onSearch: NOOP,
  onToggleMute: NOOP,
  onToggleSticky: NOOP,
  onToggleAlert: NOOP,
  onSelectBackground: NOOP,
  onClearHistory: NOOP,
  isFriendThread: true,
  onManageGroup: NOOP,
  peerBlocked: false,
  onBlockPeer: NOOP,
  onUnblockPeer: NOOP,
  onRetrySettings: NOOP,
} as const;

describe('conversation settings command feedback', () => {
  it('accepts committed state only when the Station projection matches the patch', () => {
    const projected = {
      ...defaultChatActionState(),
      muted: true,
      background: 'paper' as const,
    };

    expect(chatActionStateMatchesPatch(projected, { muted: true })).toBe(true);
    expect(chatActionStateMatchesPatch(projected, { muted: false })).toBe(false);
    expect(chatActionStateMatchesPatch(undefined, { muted: true })).toBe(false);
    expect(chatActionStateMatchesPatch(projected, {})).toBe(false);
  });

  it.each([
    ['pending', 'mobile.settings.dirty.saving'],
    ['retrying', 'mobile.chat.commandRetrying'],
    ['committed', 'mobile.settings.dirty.saved'],
    ['failed', 'mobile.settings.dirty.saveFailed'],
  ] as const)('renders the %s state explicitly', (phase, expectedCopy) => {
    const markup = renderToStaticMarkup(
      <ChatActionSheet
        {...actionSheetProps}
        settingsFeedback={conversationSettingsFeedback(
          'friend:conversation-1',
          phase,
          { muted: true },
        )}
      />,
    );

    expect(markup).toContain(`data-conversation-settings-state="${phase}"`);
    expect(markup).toContain(expectedCopy);
    expect(markup.includes('common.action.retry')).toBe(phase === 'failed');
  });

  it('confirms Station/store readback before publishing committed feedback or fallback', () => {
    const pageSource = readFileSync(new URL('../ChatPage.tsx', import.meta.url), 'utf8');
    const start = pageSource.indexOf('const updateChatActionState = async');
    const end = pageSource.indexOf('const scrollToMessage = async', start);
    const updateSource = pageSource.slice(start, end);

    expect(updateSource).toContain('useSocialStore.getState().conversationSettings');
    expect(updateSource).not.toContain('useGroupStore');
    expect(updateSource).toContain("if (mode === 'retry')");
    expect(updateSource.indexOf('.loadConversationSettings')).toBeLessThan(
      updateSource.indexOf('await updateFriendConversationSettings'),
    );
    expect(updateSource.indexOf('chatActionStateMatchesPatch')).toBeLessThan(
      updateSource.indexOf("conversationSettingsFeedback(key, 'committed'"),
    );
    expect(updateSource.indexOf("conversationSettingsFeedback(key, 'committed'")).toBeLessThan(
      updateSource.indexOf('saveChatActionStates'),
    );
  });
});
