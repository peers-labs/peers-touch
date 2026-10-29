import type { CSSProperties, ReactNode } from 'react';
import { pageColumnWidth, type PageWidthTier } from './pageWidth';

interface PageColumnProps {
  tier?: PageWidthTier;
  children: ReactNode;
  style?: CSSProperties;
  /** Optional stable anchor for acceptance selectors. */
  'data-testid'?: string;
}

/**
 * Centered responsive content column shared by full-height pages.
 * Owns horizontal centering and the edge gutter; pages own vertical rhythm.
 */
export function PageColumn({ tier = 'standard', children, style, ...rest }: PageColumnProps) {
  return (
    <div
      data-pt-page-column={tier}
      style={{
        width: pageColumnWidth(tier),
        maxWidth: '100%',
        minWidth: 0,
        marginInline: 'auto',
        boxSizing: 'border-box',
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
