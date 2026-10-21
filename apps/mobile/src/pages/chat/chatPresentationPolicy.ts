import type { ResolvedChatComposerCapabilities } from '@peers-touch/client-chat-core';

export type MobileChatVisualSurface = 'mobile-main' | 'mobile-thread';

export interface MobileChatVisualLayout {
  readonly surface: MobileChatVisualSurface;
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
  readonly composerOuterPadding: string;
  readonly composerShellRadius: number;
  readonly composerShellShadow: string;
  readonly composerInputMinHeight: number;
  readonly composerInputExpandedMinHeight: string;
  readonly composerInputExpandedMaxHeight: string;
  readonly composerToolButtonSize: number;
  readonly composerHasAttachmentTools: boolean;
}

export const MOBILE_CHAT_COMPOSER_CAPABILITIES_MAIN:
ResolvedChatComposerCapabilities = {
  emoji: true,
  file: true,
  screenshot: false,
  voice: false,
};

export const MOBILE_CHAT_COMPOSER_CAPABILITIES_THREAD:
ResolvedChatComposerCapabilities = {
  ...MOBILE_CHAT_COMPOSER_CAPABILITIES_MAIN,
};

const MOBILE_CHAT_LAYOUT_MAIN: MobileChatVisualLayout = {
  surface: 'mobile-main',
  avatarSize: 38,
  avatarGap: 7,
  avatarRadius: 12,
  ownRowMaxWidth: '78%',
  peerRowMaxWidth: '78%',
  groupPeerRowMaxWidth: '78%',
  bubbleMinWidth: 56,
  bubblePadding: '7px 9px 5px',
  ownBubbleRadius: '17px 17px 5px 17px',
  peerBubbleRadius: '17px 17px 17px 5px',
  mediaBubblePadding: '0',
  composerOuterPadding: '8px 10px 10px',
  composerShellRadius: 12,
  composerShellShadow: '0 -8px 26px rgba(15, 23, 42, 0.08)',
  composerInputMinHeight: 38,
  composerInputExpandedMinHeight: 'min(280px, 42vh)',
  composerInputExpandedMaxHeight: 'min(420px, 56vh)',
  composerToolButtonSize: 40,
  composerHasAttachmentTools: false,
};

const MOBILE_CHAT_LAYOUT_THREAD: MobileChatVisualLayout = {
  ...MOBILE_CHAT_LAYOUT_MAIN,
  surface: 'mobile-thread',
  avatarSize: 34,
  avatarGap: 7,
  avatarRadius: 10,
  ownRowMaxWidth: '82%',
  peerRowMaxWidth: '82%',
  groupPeerRowMaxWidth: '82%',
  bubbleMinWidth: 44,
  bubblePadding: '7px 10px 6px',
  ownBubbleRadius: '16px 16px 5px 16px',
  peerBubbleRadius: '16px 16px 16px 5px',
  composerOuterPadding: '8px 10px 10px',
  composerToolButtonSize: 38,
};

export function mobileChatLayoutForSurface(
  surface: MobileChatVisualSurface,
): MobileChatVisualLayout {
  return surface === 'mobile-main'
    ? MOBILE_CHAT_LAYOUT_MAIN
    : MOBILE_CHAT_LAYOUT_THREAD;
}

export function mobileChatVisualCssVars(
  layout: MobileChatVisualLayout,
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
