import { ReactNode } from 'react';
import { theme, Typography } from 'antd';

// SocialComposer — a "what's on your mind" block inside a feed or thread.
//
// This is NOT a full-blown form. Instead, it's a container surface
// with a title, a slot for the actual editor (MomentComposer or any
// future editor), and a hint line.
//
// Why:
//   - The UI Identity contract says "one continuous surface" — this
//     surface owns the background, radius, and padding that the
//     composer editor lives in.
//   - The editor (textarea, attachments, audience selector, submit
//     button) is pluggable. This component doesn't couple the surface
//     styling with a specific editor implementation.

const { Text } = Typography;

export interface SocialComposerProps {
  title?: string;
  hint?: string;
  children?: ReactNode;
  tone?: 'plain' | 'soft';
  compact?: boolean;
}

export function SocialComposer({ title, hint, children, tone = 'soft', compact }: SocialComposerProps) {
  const { token } = theme.useToken();

  const outerStyle =
    tone === 'soft'
      ? {
          background: token.colorBgContainer,
          borderRadius: 14,
          padding: compact ? 10 : 12,
          border: `1px solid ${token.colorBorderSecondary}`,
        }
      : {};

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        ...outerStyle,
      }}
    >
      {(title || hint) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {title && (
            <Text strong style={{ fontSize: 13 }}>
              {title}
            </Text>
          )}
          {hint && (
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {hint}
            </Text>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
