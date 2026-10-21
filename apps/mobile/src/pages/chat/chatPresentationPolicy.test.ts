import { describe, expect, it } from 'vitest';
import {
  canSubmitChatComposerDraft,
  resolveChatComposerCapabilities,
} from '@peers-touch/client-chat-core';

import {
  MOBILE_CHAT_COMPOSER_CAPABILITIES_MAIN,
  mobileChatLayoutForSurface,
  mobileChatVisualCssVars,
} from './chatPresentationPolicy';

describe('Mobile chat presentation policy', () => {
  it('admits file composition without Desktop-only capture tools', () => {
    expect(
      resolveChatComposerCapabilities(
        MOBILE_CHAT_COMPOSER_CAPABILITIES_MAIN,
      ),
    ).toEqual({
      emoji: true,
      file: true,
      screenshot: false,
      voice: false,
    });
    expect(canSubmitChatComposerDraft({
      text: '',
      attachmentCount: 1,
      capabilities: MOBILE_CHAT_COMPOSER_CAPABILITIES_MAIN,
    })).toBe(true);
  });

  it('keeps Mobile geometry in the Mobile form shell', () => {
    const layout = mobileChatLayoutForSurface('mobile-main');
    const cssVars = mobileChatVisualCssVars(layout);

    expect(layout.avatarSize).toBe(38);
    expect(layout.avatarGap).toBe(7);
    expect(layout.composerHasAttachmentTools).toBe(false);
    expect(layout.composerShellRadius).toBe(12);
    expect(cssVars['--chat-message-avatar-size']).toBe('38px');
    expect(cssVars['--chat-message-bubble-radius-own'])
      .toBe('17px 17px 5px 17px');
    expect(cssVars['--chat-composer-tool-button-size']).toBe('40px');
    expect(cssVars['--chat-composer-input-expanded-min-height'])
      .toBe('min(280px, 42vh)');
  });
});
