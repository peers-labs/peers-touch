import type { ComponentProps } from 'react';

import { MomentCommentsSection } from './MomentCommentsSection';

type MomentCommentsSectionProps = ComponentProps<typeof MomentCommentsSection>;

type MomentInlineCommentsProps = Omit<MomentCommentsSectionProps, 'mode'>;

export function MomentInlineComments(props: MomentInlineCommentsProps) {
  return <MomentCommentsSection {...props} mode="inline" />;
}
