import { ReactNode, useEffect, useState } from 'react';
import { theme, Typography } from 'antd';
import { X } from 'lucide-react';

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
  onClose?: () => void;
  closeLabel?: string;
}

export function SocialComposer({
  title,
  hint,
  children,
  tone = 'soft',
  compact,
  onClose,
  closeLabel,
}: SocialComposerProps) {
  const { token } = theme.useToken();

  // Brief border highlight when the composer first appears, so the user's
  // eye is drawn to the surface that just opened from the New Post button.
  const [highlight, setHighlight] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setHighlight(false), 1200);
    return () => window.clearTimeout(timer);
  }, []);

  const borderColor = highlight ? token.colorPrimary : token.colorBorderSecondary;
  const outerStyle =
    tone === 'soft'
      ? {
          background: token.colorBgContainer,
          borderRadius: 14,
          padding: compact ? 10 : 12,
          border: `1px solid ${borderColor}`,
          boxShadow: highlight ? `0 0 0 3px ${token.colorPrimaryBg}` : 'none',
          transition: 'border-color 0.4s ease, box-shadow 0.4s ease',
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
      {(title || hint || onClose) && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
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
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              title={closeLabel}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 24,
                height: 24,
                border: 'none',
                borderRadius: 8,
                background: 'transparent',
                color: token.colorTextSecondary,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
