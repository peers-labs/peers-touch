import { ReactNode } from 'react';
import { theme, Typography } from 'antd';
import { ChevronDown, ChevronUp } from 'lucide-react';

// SocialThreadSurface — the detail post + comments + composer.
//
// Rationale:
//   - Before: detail post was one card, comments another block,
//     composer a third card — three visually disconnected surfaces.
//   - After: one continuous surface with inner section padding and
//     subtle dividers. The reader's eye perceives one thread.
//
// Sections are intentionally declared by the consumer (post,
// comments, composer) but styled by the surface. This way,
// future changes to "thread look" live in one file.

const { Text } = Typography;

export interface SocialThreadSurfaceProps {
  children?: ReactNode;
}

export function SocialThreadSurface({ children }: SocialThreadSurfaceProps) {
  const { token } = theme.useToken();

  return (
    <div
      style={{
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: 14,
        padding: 18,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {children}
    </div>
  );
}

// SocialThreadHeader — the post header inside a thread surface.
// Renders author avatar + name + time; does NOT escape the surface.
export interface SocialThreadHeaderProps {
  authorName: string;
  authorHandle?: string;
  avatarUrl?: string;
  timestamp?: string;
  children?: ReactNode;
}

export function SocialThreadHeader({
  authorName,
  authorHandle,
  avatarUrl,
  timestamp,
  children,
}: SocialThreadHeaderProps) {
  const { token } = theme.useToken();

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div
        aria-hidden
        style={{
          width: 40,
          height: 40,
          borderRadius: '50%',
          background: token.colorFillSecondary,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 16,
          fontWeight: 600,
          color: token.colorTextSecondary,
          overflow: 'hidden',
          flexShrink: 0,
        }}
      >
        {avatarUrl ? (
          <img
            alt=""
            src={avatarUrl}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          authorName.slice(0, 1).toUpperCase()
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Text strong style={{ fontSize: 14, lineHeight: 1.4 }}>
          {authorName}
        </Text>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {authorHandle && (
            <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>{authorHandle}</Text>
          )}
          {timestamp && (
            <>
              <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>·</Text>
              <Text style={{ fontSize: 12, color: token.colorTextTertiary }}>{timestamp}</Text>
            </>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}

// SocialThreadBody — the primary text/media block for the post.
// Rendered without its own card border; the surface owns the border.
export interface SocialThreadBodyProps {
  children?: ReactNode;
}

export function SocialThreadBody({ children }: SocialThreadBodyProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingLeft: 52,
      }}
    >
      {children}
    </div>
  );
}

// SocialThreadDivider — a hairline between post body and comments /
// between comment groups. When onToggle is present, the divider also
// owns the comment-section disclosure affordance.
export interface SocialThreadDividerProps {
  label?: string;
  expanded?: boolean;
  controls?: string;
  onToggle?: () => void;
}

export function SocialThreadDivider({
  label,
  expanded,
  controls,
  onToggle,
}: SocialThreadDividerProps) {
  const { token } = theme.useToken();
  const labelNode = label && onToggle ? (
    <button
      type="button"
      data-moments-comments-toggle
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '4px 6px',
        border: 'none',
        background: 'transparent',
        color: token.colorTextSecondary,
        font: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      {label}
      {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
    </button>
  ) : (
    label && <Text style={{ fontSize: 11, color: token.colorTextTertiary }}>{label}</Text>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginLeft: 52,
        marginBottom: -4,
      }}
    >
      <div style={{ flex: 1, height: 1, background: token.colorBorderSecondary, opacity: 0.6 }} />
      {labelNode}
      <div style={{ flex: 1, height: 1, background: token.colorBorderSecondary, opacity: 0.6 }} />
    </div>
  );
}

// SocialThreadSection — a generic section inside the thread.
// Used for composer, comments group header, etc.
export interface SocialThreadSectionProps {
  children?: ReactNode;
  indent?: boolean;
}

export function SocialThreadSection({ children, indent }: SocialThreadSectionProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        paddingLeft: indent ? 52 : 0,
      }}
    >
      {children}
    </div>
  );
}
