import { Markdown, type MarkdownProps } from '@lobehub/ui';

export function LazyMarkdown({ children, ...props }: MarkdownProps) {
  return <Markdown {...props}>{children}</Markdown>;
}
