import type { MarkdownProps } from '@lobehub/ui';

type ChatMarkdownConfig = Pick<
  MarkdownProps,
  | 'enableLatex'
  | 'enableMermaid'
  | 'enableImageGallery'
  | 'enableGithubAlert'
  | 'enableCustomFootnotes'
  | 'streamSmoothingPreset'
>;

export const chatMarkdownProps: ChatMarkdownConfig = {
  enableLatex: true,
  enableMermaid: true,
  enableImageGallery: true,
  enableGithubAlert: true,
  enableCustomFootnotes: true,
  streamSmoothingPreset: 'balanced',
};
