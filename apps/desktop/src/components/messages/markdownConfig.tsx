import type { MarkdownProps } from '@lobehub/ui';
import { InlineThinkingTag } from './InlineThinkingTag';

type ChatMarkdownConfig = Pick<
  MarkdownProps,
  | 'enableLatex'
  | 'enableMermaid'
  | 'enableImageGallery'
  | 'enableGithubAlert'
  | 'enableCustomFootnotes'
  | 'streamSmoothingPreset'
  | 'allowHtml'
  | 'allowHtmlList'
  | 'components'
>;

// Inline custom-tag renderers for the message body (I3: Markdown inline tag
// pipeline, aligning with LobeHub's markdownElements). `allowHtml` + a
// whitelisted tag lets the model emit `<think>...</think>` in the content
// stream and have it rendered as a collapsible reasoning block. Additional
// inline tags (tool/artifact chips) can be registered here later.
//
// `think` is a custom element outside the built-in ElementType union, so the
// whitelist entry is cast; the components map keys are already `Record<string, FC>`.
export const chatMarkdownProps: ChatMarkdownConfig = {
  enableLatex: true,
  enableMermaid: true,
  enableImageGallery: true,
  enableGithubAlert: true,
  enableCustomFootnotes: true,
  streamSmoothingPreset: 'balanced',
  allowHtml: true,
  allowHtmlList: ['think' as unknown as NonNullable<ChatMarkdownConfig['allowHtmlList']>[number]],
  components: {
    think: InlineThinkingTag,
  },
};
