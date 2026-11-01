/**
 * PublicProfileCard — the single identity-card surface for self, peer and
 * group profiles (popover, contact detail, chat detail panel).
 *
 * Visual parity with the self popover: banner background, overlapping
 * avatar, name + federated handle, intro, practical metadata and one
 * primary action row.
 *
 * The card is strictly declarative: it renders the data bag and whatever
 * `actions` node the caller passes. It MUST NOT branch on self/friend/
 * stranger or own any relationship or management logic — that decision
 * lives in the caller (see ProfilePrimaryAction). Raw identity values stay
 * behind an opt-in expandable disclosure (CHAT-UR09) so casual users never
 * see developer plumbing.
 */

import type { ReactNode } from 'react';
import { Button, toast } from '@lobehub/ui';
import { Flexbox } from 'react-layout-kit';
import { Divider, Tooltip, theme, Typography } from 'antd';
import { Copy, Link2 } from 'lucide-react';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';

const { Text } = Typography;

// ─── Model ──────────────────────────────────────────────────────────────────

export interface PublicProfileModel {
  displayName: string;
  avatar?: string;
  /** Banner/background image URL. Empty renders the neutral gradient. */
  header?: string;
  /** Bare username; combined with homeStationDomain into the @user@host handle. */
  username?: string;
  /** host[:port] for the federated handle. */
  homeStationDomain?: string;
  bio?: string;
  /** Owner actor PTID; drives avatar asset resolution and the avatar DOM marker. */
  did?: string;
  /** Formatted join date string (caller formats for the active locale). */
  joined?: string;
  region?: string;
  /** Readable identity lines (e.g. Home Station display name). */
  identityMetadata?: string[];
  /** Raw identity values, rendered only in an expandable disclosure. */
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
  profile: PublicProfileModel;
  /**
   * Primary action row (Add friend / Message / Manage account …). The card
   * never derives this from the model; callers compose the node and own its
   * behaviour.
   */
  actions?: ReactNode;
  /** Compact density for popovers. */
  compact?: boolean;
  /** Replace the avatar slot (e.g. group composite avatar). */
  avatarNode?: ReactNode;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
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

function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

export function PublicProfileCard({ profile, actions, compact = true, avatarNode }: PublicProfileCardProps) {
  const { token } = theme.useToken();
  const avatarSize = compact ? 56 : 72;
  const avatarRadius = compact ? 14 : 18;
  const bannerHeight = compact ? 84 : 104;
  const links = (profile.links ?? []).filter((link) => link.url && safeUrl(link.url));

  return (
    <Flexbox
      data-chat-profile-card
      data-chat-avatar-ptid={profile.did || ''}
      data-chat-avatar-src={profile.avatar || ''}
      gap={0}
      style={{ width: '100%', overflow: 'hidden' }}
    >
      {/* Banner */}
      <div
        data-chat-profile-banner={profile.header ? 'image' : 'gradient'}
        style={{
          width: '100%',
          height: bannerHeight,
          borderRadius: 12,
          background: profile.header
            ? `url(${profile.header}) center/cover no-repeat, ${token.colorFillQuaternary}`
            : `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorBgLayout} 100%)`,
          flexShrink: 0,
        }}
      />

      <Flexbox gap={12} style={{ padding: '0 4px' }}>
        {/* Avatar overlaps the banner; name/handle sit beside it on the body
            background so a two-line name never lands on the image. */}
        <Flexbox horizontal gap={12} align="flex-start" style={{ marginTop: -avatarSize / 2 }}>
          {avatarNode ?? (
            <div
              style={{
                marginTop: 0,
                borderRadius: avatarRadius + 2,
                lineHeight: 0,
                boxShadow: `0 0 0 2px ${token.colorBgContainer}`,
                flexShrink: 0,
              }}
            >
              <UserSquareAvatar
                remoteUrl={profile.avatar}
                actorPtid={profile.did || null}
                name={profile.displayName}
                size={avatarSize}
                radius={avatarRadius}
                background={token.colorFillSecondary}
                fallback={getInitial(profile.displayName)}
                style={{
                  color: token.colorTextSecondary,
                  fontSize: Math.round(avatarSize * 0.4),
                  fontWeight: 700,
                }}
              />
            </div>
          )}

          <Flexbox gap={2} style={{ paddingTop: avatarSize / 2 + 4, minWidth: 0, flex: 1 }}>
            <Text
              strong
              ellipsis={{ tooltip: profile.displayName }}
              style={{ fontSize: compact ? 16 : 18, lineHeight: 1.3 }}
            >
              {profile.displayName}
            </Text>
            <FederatedHandle
              localPart={profile.username ?? ''}
              home={profile.homeStationDomain}
              fontSize={12}
            />
          </Flexbox>
        </Flexbox>

        {profile.identityMetadata && profile.identityMetadata.length > 0 ? (
          <Flexbox gap={2} style={{ maxWidth: '100%' }}>
            {profile.identityMetadata.filter(Boolean).map((value) => (
              <Text
                key={value}
                type="secondary"
                ellipsis={{ tooltip: value }}
                style={{ fontSize: 11, lineHeight: 1.3, maxWidth: '100%' }}
              >
                {value}
              </Text>
            ))}
          </Flexbox>
        ) : null}

        {/* Intro */}
        {profile.bio ? (
          <Text
            ellipsis={{ tooltip: profile.bio }}
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: token.colorText,
              maxWidth: '100%',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {profile.bio}
          </Text>
        ) : null}

        {/* Relation badge */}
        {profile.relationLabel ? (
          <Flexbox horizontal>
            <Text
              data-chat-profile-relation={profile.relationLabel}
              style={{
                fontSize: 11,
                padding: '2px 10px',
                borderRadius: 999,
                background: toneToBg(profile.relationTone, token),
                color: toneToColor(profile.relationTone, token),
                fontWeight: 500,
              }}
            >
              {profile.relationLabel}
            </Text>
          </Flexbox>
        ) : null}

        {/* Badges */}
        {profile.badges && profile.badges.length > 0 ? (
          <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
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
        ) : null}

        {/* Practical stats */}
        {profile.stats && profile.stats.length > 0 ? (
          <Flexbox horizontal gap={18} style={{ flexWrap: 'wrap' }}>
            {profile.stats.map((stat) => (
              <Flexbox key={stat.label} gap={0}>
                <Text strong style={{ fontSize: 15, lineHeight: 1.2 }}>{stat.value}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>{stat.label}</Text>
              </Flexbox>
            ))}
          </Flexbox>
        ) : null}

        {/* Joined / region */}
        {(profile.joined || profile.region) ? (
          <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
            {profile.joined ? (
              <Text type="secondary" style={{ fontSize: 11 }}>{profile.joined}</Text>
            ) : null}
            {profile.region ? (
              <Text type="secondary" style={{ fontSize: 11 }}>{profile.region}</Text>
            ) : null}
          </Flexbox>
        ) : null}

        {/* Tags */}
        {profile.tags && profile.tags.length > 0 ? (
          <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
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
        ) : null}

        {/* Links */}
        {links.length > 0 ? (
          <Flexbox gap={4}>
            {links.map((link, index) => {
              const href = safeUrl(link.url as string);
              if (!href) return null;
              return (
                <a
                  key={`${href}-${index}`}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 12,
                    color: token.colorPrimary,
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Link2 size={12} style={{ flexShrink: 0 }} />
                  {link.label?.trim() || href}
                </a>
              );
            })}
          </Flexbox>
        ) : null}

        {actions ? (
          <>
            <Divider style={{ margin: '4px 0 0' }} />
            <Flexbox style={{ width: '100%' }}>{actions}</Flexbox>
          </>
        ) : null}

        {/* Raw identity disclosure — CHAT-UR09: expandable/copyable only. */}
        {profile.technicalDetails && profile.technicalDetails.length > 0 ? (
          <details data-chat-profile-technical-details style={{ color: token.colorTextSecondary }}>
            <summary
              style={{
                cursor: 'pointer',
                fontSize: 12,
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
                  <Text type="secondary" style={{ flexShrink: 0, fontSize: 11 }}>
                    {detail.label}
                  </Text>
                  <Text
                    ellipsis={{ tooltip: detail.value }}
                    style={{ flex: 1, minWidth: 0, fontFamily: 'monospace', fontSize: 11 }}
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
                        void copyText(detail.value, detail.copiedLabel, detail.copyFailedLabel);
                      }}
                    />
                  </Tooltip>
                </Flexbox>
              ))}
            </Flexbox>
          </details>
        ) : null}
      </Flexbox>
    </Flexbox>
  );
}
