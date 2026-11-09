import { Markdown, type MarkdownProps } from '@peers-touch/ui';
import { InlineThinkingTag } from './messages/InlineThinkingTag';

// North-star feature parity for chat bodies: math (KaTeX), mermaid diagrams,
// footnotes and GitHub-style alerts are all first-class peers Markdown features.
const CHAT_FEATURES: NonNullable<MarkdownProps['features']> = {
  math: true,
  diagrams: true,
  footnotes: true,
  alerts: true,
};

// Preserve the bespoke localized collapsible reasoning block instead of the
// primitive's default <details> summary.
const renderChatReasoning: MarkdownProps['renderReasoning'] = (text) => (
  <InlineThinkingTag>{text}</InlineThinkingTag>
);

// Inline markdown images render as previewable resources.
const resolveChatImage: MarkdownProps['resolveImage'] = (image) => ({
  resourceId: image.source,
  name: image.alt || 'image',
  source: image.source,
  state: 'available',
});

/**
 * Chat message markdown, backed by the peers Markdown engine (marked +
 * DOMPurify + KaTeX + mermaid). Applies the chat feature set, the localized
 * reasoning block and image resolution; call sites may override any prop
 * (streaming, codeActions, style/className, …).
 */
export function LazyMarkdown({
  features,
  renderReasoning,
  resolveImage,
  ...props
}: MarkdownProps) {
  return (
    <Markdown
      features={{ ...CHAT_FEATURES, ...features }}
      renderReasoning={renderReasoning ?? renderChatReasoning}
      resolveImage={resolveImage ?? resolveChatImage}
      {...props}
    />
  );
}
