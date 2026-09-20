/**
 * PublicProfileCard — a reusable profile card for displaying user or group
 * identity in chat detail panels, contact views, and other surfaces.
 *
 * Designed to be driven entirely by the `PublicProfileModel` data bag so
 * different callers (friend chat detail, group detail, contacts panel) can
 * compose the same visual without coupling to specific store shapes.
 */

import type { ReactNode } from 'react';
import { Button, toast } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Tooltip, theme, Typography } from 'antd';
import { Copy } from 'lucide-react';

const { Text } = Typography;

// ─── Model ──────────────────────────────────────────────────────────────────

export interface PublicProfileModel {
  displayName: string;
  avatar?: string;
  header?: string;
  username?: string;
  bio?: string;
  did?: string;
  createdAt?: string;
  region?: string;
  identityMetadata?: string[];
  technicalDetails?: {
    id: string;
    label: string;
    value: string;
    copyLabel: string;
    copiedLabel: string;
    copyFailedLabel: string;
  }[];
  technicalDetailsLabel?: string;
  tags?: string[];
  links?: { label?: string; url?: string }[];
  relationLabel?: string;
  relationTone?: 'default' | 'success' | 'warning' | 'processing' | (string & {});
  badges?: { label: string; tone: 'success' | 'warning' | (string & {}) }[];
  stats?: { label: string; value: number }[];
}

// ─── Props ──────────────────────────────────────────────────────────────────

interface PublicProfileCardProps {
  compact?: boolean;
  profile: PublicProfileModel;
  avatarNode?: ReactNode;
  actions?: ReactNode;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitial(name: string): string {
  if (!name) return '?';
  return name.charAt(0).toUpperCase();
}

function toneToColor(tone: string | undefined, token: ReturnType<typeof theme.useToken>['token']): string {
  switch (tone) {
    case 'success': return token.colorSuccess;
    case 'warning': return token.colorWarning;
    case 'processing': return token.colorInfo;
    default: return token.colorTextSecondary;
  }
}

function toneToBg(tone: string | undefined, token: ReturnType<typeof theme.useToken>['token']): string {
  switch (tone) {
    case 'success': return token.colorSuccessBg;
    case 'warning': return token.colorWarningBg;
    case 'processing': return token.colorInfoBg;
    default: return token.colorFillTertiary;
  }
}

async function copyText(
  value: string,
  copiedLabel: string,
  copyFailedLabel: string,
): Promise<void> {
  const copy = async () => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      if (!document.execCommand('copy')) {
        throw new Error('clipboard copy command failed');
      }
    } finally {
      textarea.remove();
    }
  };
  try {
    await copy();
    toast.success(copiedLabel);
  } catch {
    toast.error(copyFailedLabel);
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PublicProfileCard({ compact, profile, avatarNode, actions }: PublicProfileCardProps) {
  const { token } = theme.useToken();
  const avatarSize = compact ? 64 : 88;
  const avatarRadius = compact ? 16 : 20;

  return (
    <Flexbox align="center" gap={compact ? 12 : 16}>
      {/* Avatar */}
      {avatarNode ?? (
        profile.avatar ? (
          <img
            data-chat-avatar-ptid={profile.did || ''}
            data-chat-avatar-src={profile.avatar}
            src={profile.avatar}
            alt={profile.displayName}
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarRadius,
              objectFit: 'cover',
              flexShrink: 0,
            }}
          />
        ) : (
          <Flexbox
            data-chat-avatar-ptid={profile.did || ''}
            data-chat-avatar-src=""
            align="center"
            justify="center"
            style={{
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarRadius,
              background: token.colorFillSecondary,
              color: token.colorTextSecondary,
              fontSize: compact ? 22 : 28,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {getInitial(profile.displayName)}
          </Flexbox>
        )
      )}

      {/* Display name */}
      <Text
        strong
        style={{
          fontSize: compact ? 16 : 20,
          textAlign: 'center',
          maxWidth: '100%',
          wordBreak: 'break-word',
        }}
      >
        {profile.displayName}
      </Text>

      {/* Username */}
      {profile.username && (
        <Text type="secondary" style={{ fontSize: 12, marginTop: -4 }}>
          @{profile.username}
        </Text>
      )}

      {profile.identityMetadata && profile.identityMetadata.length > 0 ? (
        <Flexbox align="center" gap={2} style={{ maxWidth: 320 }}>
          {profile.identityMetadata.filter(Boolean).map((value) => (
            <Text
              key={value}
              type="secondary"
              ellipsis={{ tooltip: value }}
              style={{
                fontSize: 11,
                lineHeight: 1.25,
                maxWidth: '100%',
              }}
            >
              {value}
            </Text>
          ))}
        </Flexbox>
      ) : null}

      {profile.technicalDetails && profile.technicalDetails.length > 0 ? (
        <details
          data-chat-profile-technical-details
          style={{
            width: 320,
            maxWidth: '100%',
            color: token.colorTextSecondary,
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              fontSize: 12,
              textAlign: 'center',
              userSelect: 'none',
            }}
          >
            {profile.technicalDetailsLabel}
          </summary>
          <Flexbox gap={6} style={{ paddingTop: 8 }}>
            {profile.technicalDetails.map((detail) => (
              <Flexbox
                key={detail.id}
                data-chat-profile-technical-detail={detail.id}
                horizontal
                align="center"
                gap={8}
                style={{
                  minWidth: 0,
                  padding: '6px 8px',
                  borderRadius: 6,
                  background: token.colorFillQuaternary,
                }}
              >
                <Text
                  type="secondary"
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                  }}
                >
                  {detail.label}
                </Text>
                <Text
                  ellipsis={{ tooltip: detail.value }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: 'monospace',
                    fontSize: 11,
                  }}
                >
                  {detail.value}
                </Text>
                <Tooltip title={detail.copyLabel}>
                  <Button
                    data-chat-profile-copy={detail.id}
                    type="text"
                    size="small"
                    icon={<Copy size={13} />}
                    aria-label={detail.copyLabel}
                    onClick={() => {
                      void copyText(
                        detail.value,
                        detail.copiedLabel,
                        detail.copyFailedLabel,
                      );
                    }}
                  />
                </Tooltip>
              </Flexbox>
            ))}
          </Flexbox>
        </details>
      ) : null}

      {/* Relation label / online indicator */}
      {profile.relationLabel && (
        <Text
          data-chat-profile-relation={profile.relationLabel}
          style={{
            fontSize: 12,
            color: toneToColor(profile.relationTone, token),
          }}
        >
          {profile.relationLabel}
        </Text>
      )}

      {/* Badges */}
      {profile.badges && profile.badges.length > 0 && (
        <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {profile.badges.map((badge) => (
            <Text
              key={badge.label}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 999,
                background: toneToBg(badge.tone, token),
                color: toneToColor(badge.tone, token),
                fontWeight: 500,
              }}
            >
              {badge.label}
            </Text>
          ))}
        </Flexbox>
      )}

      {/* Bio */}
      {profile.bio && (
        <Text
          type="secondary"
          style={{
            fontSize: 12,
            textAlign: 'center',
            maxWidth: 260,
            wordBreak: 'break-word',
          }}
        >
          {profile.bio}
        </Text>
      )}

      {/* Stats */}
      {profile.stats && profile.stats.length > 0 && (
        <Flexbox horizontal gap={16} style={{ justifyContent: 'center', marginTop: 4 }}>
          {profile.stats.map((stat) => (
            <Flexbox key={stat.label} align="center" gap={2}>
              <Text strong style={{ fontSize: 15 }}>{stat.value}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{stat.label}</Text>
            </Flexbox>
          ))}
        </Flexbox>
      )}

      {/* Tags */}
      {profile.tags && profile.tags.length > 0 && (
        <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
          {profile.tags.map((tag) => (
            <Text
              key={tag}
              style={{
                fontSize: 11,
                padding: '1px 8px',
                borderRadius: 999,
                background: token.colorFillTertiary,
                color: token.colorTextSecondary,
              }}
            >
              {tag}
            </Text>
          ))}
        </Flexbox>
      )}

      {/* Region */}
      {profile.region && (
        <Text type="secondary" style={{ fontSize: 11 }}>
          {profile.region}
        </Text>
      )}

      {/* Actions slot */}
      {actions && (
        <Flexbox style={{ width: '100%', marginTop: 8 }}>
          {actions}
        </Flexbox>
      )}
    </Flexbox>
  );
}
