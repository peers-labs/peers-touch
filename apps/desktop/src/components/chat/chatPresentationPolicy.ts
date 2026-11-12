import type { ResolvedChatComposerCapabilities } from '@peers-touch/client-chat-core';

export type DesktopChatVisualSurface = 'desktop-main' | 'desktop-thread';

export interface DesktopChatVisualLayout {
  readonly surface: DesktopChatVisualSurface;
  readonly avatarSize: number;
  readonly avatarGap: number;
  readonly avatarRadius: number;
  readonly ownRowMaxWidth: string;
  readonly peerRowMaxWidth: string;
  readonly groupPeerRowMaxWidth: string;
  readonly bubbleMinWidth: number;
  readonly bubblePadding: string;
  readonly ownBubbleRadius: string;
  readonly peerBubbleRadius: string;
  readonly mediaBubblePadding: string;
  readonly hoverActionBridgeHeight: number;
  readonly hoverActionBridgeInsetX: number;
  readonly composerOuterPadding: string;
  readonly composerShellRadius: number;
  readonly composerShellShadow: string;
  readonly composerInputMinHeight: number;
  readonly composerInputExpandedMinHeight: string;
  readonly composerInputExpandedMaxHeight: string;
  readonly composerToolButtonSize: number;
  readonly composerHasAttachmentTools: boolean;
}

export const DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN:
ResolvedChatComposerCapabilities = {
  emoji: true,
  file: true,
  screenshot: true,
  voice: true,
};

export const DESKTOP_CHAT_COMPOSER_CAPABILITIES_THREAD:
ResolvedChatComposerCapabilities = {
  ...DESKTOP_CHAT_COMPOSER_CAPABILITIES_MAIN,
};

const DESKTOP_CHAT_LAYOUT_MAIN: DesktopChatVisualLayout = {
  surface: 'desktop-main',
  // Prototype .sk-msg-avatar in ConversationView: 32px, 9px row gap.
  avatarSize: 32,
  avatarGap: 9,
  // Direct-chat avatar radius (--sk-avatar-radius 11); group rows pass an
  // explicit 8px in ChatMessageRow to match the prototype group tile.
  avatarRadius: 11,
  // Prototype .sk-msg max-width: 78%. The px cap is a desktop readability
  // guard for very wide windows; the percentage stays on the prototype value.
  ownRowMaxWidth: 'min(78%, 740px)',
  peerRowMaxWidth: 'min(78%, 740px)',
  // Desktop extension: group context rows may breathe wider (locked by
  // desktop visual policy test); the prototype itself keeps one 78% width.
  groupPeerRowMaxWidth: 'min(82%, 800px)',
  bubbleMinWidth: 0,
  // Prototype design-directions.css .sk-msg-bubble: padding 10px 14px.
  bubblePadding: '10px 14px',
  ownBubbleRadius: '16px 16px 6px 16px',
  peerBubbleRadius: '16px 16px 16px 6px',
  mediaBubblePadding: '0',
  hoverActionBridgeHeight: 18,
  hoverActionBridgeInsetX: 180,
  // Prototype .sk-conv-view frame: composer zone shares the 22px horizontal
  // inset with the message stream; 6px top joins the stream's 6px bottom into
  // the 12px stream↔composer gap and 12px is the bottom frame inset.
  composerOuterPadding: '6px 22px 12px',
  // Prototype sk-composer: a quiet rounded 18px shell, no float shadow.
  composerShellRadius: 18,
  composerShellShadow: 'none',
  composerInputMinHeight: 38,
  composerInputExpandedMinHeight: 'min(360px, 44vh)',
  composerInputExpandedMaxHeight: 'min(520px, 58vh)',
  composerToolButtonSize: 34,
  composerHasAttachmentTools: true,
};

const DESKTOP_CHAT_LAYOUT_THREAD: DesktopChatVisualLayout = {
  ...DESKTOP_CHAT_LAYOUT_MAIN,
  surface: 'desktop-thread',
  avatarSize: 30,
  avatarGap: 7,
  avatarRadius: 9,
  ownRowMaxWidth: 'min(92%, 320px)',
  peerRowMaxWidth: 'min(92%, 320px)',
  groupPeerRowMaxWidth: 'min(92%, 320px)',
  bubblePadding: '8px 10px',
  ownBubbleRadius: '14px 14px 5px 14px',
  peerBubbleRadius: '14px 14px 14px 5px',
};

export function desktopChatLayoutForSurface(
  surface: DesktopChatVisualSurface,
): DesktopChatVisualLayout {
  return surface === 'desktop-main'
    ? DESKTOP_CHAT_LAYOUT_MAIN
    : DESKTOP_CHAT_LAYOUT_THREAD;
}

export function desktopChatMessageRowMaxWidth(
  layout: DesktopChatVisualLayout,
  input: { readonly own: boolean; readonly groupPeer?: boolean },
): string {
  if (input.own) return layout.ownRowMaxWidth;
  return input.groupPeer
    ? layout.groupPeerRowMaxWidth
    : layout.peerRowMaxWidth;
}

export function desktopChatVisualCssVars(
  layout: DesktopChatVisualLayout,
): Record<string, string> {
  return {
    '--chat-message-avatar-size': `${layout.avatarSize}px`,
    '--chat-message-avatar-gap': `${layout.avatarGap}px`,
    '--chat-message-avatar-radius': `${layout.avatarRadius}px`,
    '--chat-message-bubble-min-width': `${layout.bubbleMinWidth}px`,
    '--chat-message-bubble-max-width': layout.peerRowMaxWidth,
    '--chat-message-bubble-padding': layout.bubblePadding,
    '--chat-message-bubble-radius-peer': layout.peerBubbleRadius,
    '--chat-message-bubble-radius-own': layout.ownBubbleRadius,
    '--chat-message-media-padding': layout.mediaBubblePadding,
    '--chat-composer-outer-padding': layout.composerOuterPadding,
    '--chat-composer-radius': `${layout.composerShellRadius}px`,
    '--chat-composer-shadow': layout.composerShellShadow,
    '--chat-composer-input-min-height': `${layout.composerInputMinHeight}px`,
    '--chat-composer-input-expanded-min-height':
      layout.composerInputExpandedMinHeight,
    '--chat-composer-input-expanded-max-height':
      layout.composerInputExpandedMaxHeight,
    '--chat-composer-tool-button-size':
      `${layout.composerToolButtonSize}px`,
  };
}
