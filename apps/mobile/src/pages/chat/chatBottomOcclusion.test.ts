import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  chatInputPanelState,
  createChatBottomOcclusionStyle,
  visualKeyboardOverlap,
} from './chatBottomOcclusion';

describe('Chat bottom occlusion model', () => {
  it('tracks keyboard-open and keyboard-closed transitions through one variable', () => {
    const keyboardClosed = createChatBottomOcclusionStyle({
      composerHeight: 58,
      inputPanelHeight: 0,
      keyboardOverlapHeight: visualKeyboardOverlap(844, 844, 0),
      tabBarVisible: false,
    });
    const keyboardOpen = createChatBottomOcclusionStyle({
      composerHeight: 58,
      inputPanelHeight: 0,
      keyboardOverlapHeight: visualKeyboardOverlap(844, 500, 44),
      tabBarVisible: false,
    });

    expect(keyboardClosed['--chat-visual-keyboard-overlap']).toBe('0px');
    expect(keyboardOpen['--chat-visual-keyboard-overlap']).toBe('300px');
    expect(keyboardOpen['--chat-composer-measured-height']).toBe('58px');
  });

  it('moves emoji and attachment panels through the same measured panel slot', () => {
    expect(chatInputPanelState({
      emojiOpen: false,
      attachmentOpen: false,
    })).toBe('none');
    expect(chatInputPanelState({
      emojiOpen: true,
      attachmentOpen: false,
    })).toBe('emoji');
    expect(chatInputPanelState({
      emojiOpen: false,
      attachmentOpen: true,
    })).toBe('attachment');
    expect(chatInputPanelState({
      emojiOpen: true,
      attachmentOpen: true,
    })).toBe('emoji-attachment');

    const emojiPanel = createChatBottomOcclusionStyle({
      composerHeight: 58,
      inputPanelHeight: 172,
      keyboardOverlapHeight: 0,
      tabBarVisible: false,
    });
    const attachmentPanel = createChatBottomOcclusionStyle({
      composerHeight: 58,
      inputPanelHeight: 96,
      keyboardOverlapHeight: 0,
      tabBarVisible: false,
    });

    expect(emojiPanel['--chat-input-panel-measured-height']).toBe('172px');
    expect(attachmentPanel['--chat-input-panel-measured-height']).toBe('96px');
  });

  it('includes the bottom-tab token only while the tab is visible', () => {
    const hiddenTab = createChatBottomOcclusionStyle({
      composerHeight: null,
      inputPanelHeight: null,
      keyboardOverlapHeight: 0,
      tabBarVisible: false,
    });
    const visibleTab = createChatBottomOcclusionStyle({
      composerHeight: null,
      inputPanelHeight: null,
      keyboardOverlapHeight: 0,
      tabBarVisible: true,
    });

    expect(hiddenTab['--chat-composer-measured-height']).toBe(
      'var(--chat-composer-min-height)',
    );
    expect(hiddenTab['--chat-bottom-tab-contribution']).toBe('0px');
    expect(visibleTab['--chat-bottom-tab-contribution']).toBe(
      'var(--tabbar-height)',
    );
  });

  it('composes every source into the message viewport clearance', () => {
    const styles = readFileSync(
      new URL('../../styles.css', import.meta.url),
      'utf8',
    );
    const formula = styles.slice(
      styles.indexOf('--chat-bottom-occlusion:'),
      styles.indexOf(';', styles.indexOf('--chat-bottom-occlusion:')) + 1,
    );

    expect(formula).toContain('--chat-composer-measured-height');
    expect(formula).toContain('--chat-input-panel-measured-height');
    expect(formula).toContain('--chat-visual-keyboard-overlap');
    expect(formula).toContain('--chat-bottom-tab-contribution');
    expect(formula).toContain('--safe-area-bottom');
    expect(formula).toContain('--chat-scroll-bottom-clearance');
  });
});
