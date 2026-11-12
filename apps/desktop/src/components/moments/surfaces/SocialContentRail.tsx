import { ReactNode } from 'react';

// SocialContentRail — vertical flow for the single Social content column.
//
// Page-level width, padding, and background belong to the page shell
// (MomentsApp / .pt-social). This primitive only owns the consistent vertical
// rhythm between composer, feed/detail content, and list states.

export interface SocialContentRailProps {
  children?: ReactNode;
  /** Accepted for call-site compatibility; layout no longer branches on it. */
  narrow?: boolean;
  compact?: boolean;
}

export function SocialContentRail({ children }: SocialContentRailProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--pt-space-md)',
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}
