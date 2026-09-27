import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

const pageSource = source('../ChatPage.tsx');
const pageContentSource = source('./ChatPageContent.tsx');
const messageSectionSource = source('./ChatMessageSectionBoundary.tsx');
const messagePresentationSource = source('./ChatMessagePresentation.tsx');
const overlayHostSource = source('./ChatOverlayHost.tsx');
const senderTypingFeedbackSource = source('./SenderTypingFeedback.tsx');
const bottomOcclusionSource = source('./chatBottomOcclusion.ts');
const stylesSource = source('../../styles.css');
const extractedSources = [
  pageContentSource,
  messageSectionSource,
  messagePresentationSource,
  overlayHostSource,
  senderTypingFeedbackSource,
  bottomOcclusionSource,
].join('\n');

describe('Chat component ownership boundaries', () => {
  it('keeps store, command, attachment I/O, and navigation ownership in ChatPage', () => {
    expect(pageSource).toContain('useSocialStore');
    expect(pageSource).toContain('useGroupStore');
    expect(pageSource).toContain('useAuthStore');
    expect(pageSource).toContain('dispatchSendMessage');
    expect(pageSource).toContain('messagingOpenAttachment');
    expect(pageSource).toContain('saveRouteQuery');

    expect(extractedSources).not.toMatch(/\buse(?:Auth|Social|Group)Store\b/);
    expect(extractedSources).not.toMatch(/\bdispatch[A-Z]\w+/);
    expect(extractedSources).not.toMatch(/\bmessaging(?:Open|Stage|Discard)Attachment/);
    expect(extractedSources).not.toContain('getDraftRestorationPort');
    expect(extractedSources).not.toContain('/app/navigation');
    expect(extractedSources).not.toContain('/runtimes/');
  });

  it('maps Chat through explicit page, section, and overlay owners', () => {
    expect(pageSource).toContain('<ChatThreadPageContent');
    expect(pageSource).toContain('<ChatConversationListPageContent');
    expect(pageSource).toContain('<ChatMessageSectionBoundary');
    expect(pageSource).toContain('<ChatOverlayHost>');
    expect(pageContentSource).toContain('export function ChatThreadPageContent');
    expect(pageContentSource).toContain('export function ChatConversationListPageContent');
    expect(messageSectionSource).toContain('export function ChatMessageSectionBoundary');
    expect(overlayHostSource).toContain('export function ChatOverlayHost');
  });

  it('preserves one bounded message viewport and on-visit overlay teardown', () => {
    const productionSources = `${pageSource}\n${extractedSources}`;
    expect(productionSources.match(/data-message-viewport/g)).toHaveLength(1);
    expect(messageSectionSource).toContain('initial="end"');
    expect(messageSectionSource).toContain('controllerRef={controllerRef}');
    expect(stylesSource).toMatch(/\.chat-thread-page\s*\{[\s\S]*?overflow-y:\s*hidden/);
    expect(stylesSource).toMatch(/\.message-list\s*\{[\s\S]*?overflow-y:\s*auto/);
    expect(overlayHostSource).toContain('if (!open) return null');
    expect(overlayHostSource).toContain('if (!message) return null');
    expect(overlayHostSource).toContain('group-management-sheet');
  });

  it('composes measured bottom layers and exposes recoverable sender typing', () => {
    expect(pageSource).toContain('useChatBottomOcclusion');
    expect(pageSource).toContain('chatBottomOcclusion.composerRef');
    expect(pageSource).toContain('chatBottomOcclusion.inputPanelRef');
    expect(pageContentSource).toContain('data-chat-keyboard-overlap');
    expect(pageContentSource).toContain('data-chat-tabbar-visible');
    expect(stylesSource).toContain('var(--chat-bottom-occlusion)');
    expect(stylesSource).not.toContain(
      'padding: 10px 8px calc(var(--safe-area-bottom) + 92px)',
    );

    expect(pageSource).toContain('<SenderTypingFeedback');
    expect(pageSource).toContain('dispatchSenderTypingRequest');
    expect(pageSource).not.toContain('void sendTypingState');
    expect(senderTypingFeedbackSource).toContain('data-sender-typing-state');
    expect(senderTypingFeedbackSource).toContain('onClick={onRetry}');
  });

  it('keeps the established selectors and accessibility semantics', () => {
    const productionSources = `${pageSource}\n${extractedSources}`;
    for (const selector of [
      'message-bubble-row',
      'message-meta-row',
      'message-composer',
      'chat-action-sheet',
      'group-management-panel',
      'data-message-ulid',
      'data-scroll-anchor-id',
    ]) {
      expect(productionSources).toContain(selector);
    }
    expect(overlayHostSource).toContain('role="dialog"');
    expect(overlayHostSource).toContain('aria-modal="true"');
  });
});
