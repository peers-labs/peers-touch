// Single horizontal geometry owner for the Agent conversation surface.
//
// The confirmed prototype contract keeps two distinct tracks:
//   - the readable thread column, centered and width-capped;
//   - the grounded composer dock, near full-width inside a hairline bar.
// Every band of ChatPage (scroll body, composer bar) MUST derive its insets
// from these constants instead of redeclaring local widths.
// Source of truth: packages/prototypes/desktop/shell AgentChatPage
// (S_contentWidth / S_composerWidth) and composer.md §5.1.

export const CONVERSATION_CONTENT_WIDTH = 'min(760px, calc(100% - 40px))';
export const CONVERSATION_CONTENT_WIDTH_NARROW = 'calc(100% - 24px)';
export const CONVERSATION_DOCK_WIDTH = 'calc(100% - 12px)';

export function conversationContentWidth(narrow: boolean | undefined): string {
  return narrow ? CONVERSATION_CONTENT_WIDTH_NARROW : CONVERSATION_CONTENT_WIDTH;
}
