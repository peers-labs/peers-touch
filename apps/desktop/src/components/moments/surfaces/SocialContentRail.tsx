import { ReactNode } from 'react';
import { theme } from 'antd';

// SocialContentRail — the single primary content column for Social.
//
// Design contract:
//   - One content rail owns title, scope bar, composer, feed,
//     detail, and comments. Nothing escapes its bounds.
//   - Alignment lives in this component; consumers don't re-declare
//     width, padding, or maxWidth.
//   - Narrow (mobile/half-screen) collapses to full-bleed column.
//
// Visual contract:
//   - background = colorBgLayout (the page plane), same as the
//     surrounding shell.
//   - The rail has no visible border; its boundary is expressed
//     through whitespace/context margin.
//   - Child sections flow top-to-bottom with consistent spacing.

export interface SocialContentRailProps {
  children?: ReactNode;
  narrow?: boolean;
  compact?: boolean;
}

export function SocialContentRail({ children, narrow, compact }: SocialContentRailProps) {
  const { token } = theme.useToken();

  const verticalGap = compact ? 10 : 14;
  const horizontalPad = compact ? 12 : 16;
  const railMaxWidth = narrow ? 720 : 760;

  return (
    <div
      style={{
        width: '100%',
        maxWidth: railMaxWidth,
        margin: '0 auto',
        padding: `${verticalGap}px ${horizontalPad}px ${verticalGap + 40}px`,
        display: 'flex',
        flexDirection: 'column',
        gap: verticalGap,
        background: token.colorBgLayout,
      }}
    >
      {children}
    </div>
  );
}

// SocialSection — a logical section inside the rail. Sections are
// separated by spacing from the parent rail; they do NOT use
// distinct card borders unless the semantic context calls for one.
export interface SocialSectionProps {
  children?: ReactNode;
  /**
   * A section can have a subtle background to mark an action area
   * (e.g. the composer). Defaults to `plain` (no surface).
   */
  tone?: 'plain' | 'soft' | 'emphasis';
  style?: React.CSSProperties;
}

export function SocialSection({ children, tone = 'plain', style }: SocialSectionProps) {
  const { token } = theme.useToken();

  const toneStyles: Record<NonNullable<SocialSectionProps['tone']>, React.CSSProperties> = {
    plain: {},
    soft: {
      background: token.colorBgContainer,
      borderRadius: 14,
      padding: 12,
    },
    emphasis: {
      background: token.colorBgContainer,
      border: `1px solid ${token.colorBorderSecondary}`,
      borderRadius: 14,
      padding: 14,
    },
  };

  return <div style={{ ...toneStyles[tone], ...style }}>{children}</div>;
}

// SocialScopeDivider — a thin hairline between major sections.
// Prefer this over `margin + border` on individual children so the
// visual boundary is owned by the surface contract.
export function SocialScopeDivider() {
  const { token } = theme.useToken();
  return (
    <div
      aria-hidden
      style={{
        height: 1,
        margin: '4px 0',
        background: token.colorBorderSecondary,
        opacity: 0.6,
      }}
    />
  );
}
