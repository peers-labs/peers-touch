import { lazy, Suspense } from 'react';
import type { MarkdownProps } from '@lobehub/ui';

const MarkdownImpl = lazy(() =>
  import('@lobehub/ui').then((m) => ({ default: m.Markdown })),
);

export function LazyMarkdown({ children, ...props }: MarkdownProps) {
  return (
    <Suspense fallback={<div style={{ minHeight: 24 }} />}>
      <MarkdownImpl {...props}>{children}</MarkdownImpl>
    </Suspense>
  );
}
