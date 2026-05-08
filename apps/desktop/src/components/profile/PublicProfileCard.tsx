import type { ReactNode } from 'react';
import { Flexbox } from 'react-layout-kit';
import { Button, toast } from '@lobehub/ui';
import { Tag, theme, Typography } from 'antd';
import { CalendarDays, Copy, Link2, MapPin } from 'lucide-react';

import { UserSquareAvatar } from '../common/UserSquareAvatar';

const { Text, Title, Paragraph } = Typography;

export interface PublicProfileStat {
  label: string;
  value: number;
}

export interface PublicProfileLink {
  label: string;
  url: string;
}

export interface PublicProfileBadge {
  label: string;
  tone?: 'success' | 'processing' | 'default' | 'warning';
}

export interface PublicProfileModel {
  displayName: string;
  username?: string;
  avatar?: string;
  header?: string;
  bio?: string;
  did?: string;
  createdAt?: string;
  region?: string;
  tags?: string[];
  links?: PublicProfileLink[];
  stats?: PublicProfileStat[];
  relationLabel?: string;
  relationTone?: 'success' | 'processing' | 'default' | 'warning';
  badges?: PublicProfileBadge[];
}

interface PublicProfileCardProps {
  profile: PublicProfileModel;
  actions?: ReactNode;
  avatarNode?: ReactNode;
  headerNode?: ReactNode;
  compact?: boolean;
}

function formatDate(date?: string): string {
  if (!date) return '';
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) return '';
  return value.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
  });
}

function shortIdentifier(value?: string): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

function copyPublicIdentifier(value: string): void {
  navigator.clipboard.writeText(value).then(
    () => toast.success('Copied'),
    () => toast.error('Copy failed'),
  );
}

export function PublicProfileCard({
  profile,
  actions,
  avatarNode,
  headerNode,
  compact = false,
}: PublicProfileCardProps) {
  const { token } = theme.useToken();
  const title = profile.displayName || profile.username || profile.did || 'Unknown';
  const createdAt = formatDate(profile.createdAt);
  const didShort = shortIdentifier(profile.did);
  const safeTags = (profile.tags ?? []).filter(Boolean).slice(0, 6);
  const safeLinks = (profile.links ?? []).filter((link) => link.label || link.url).slice(0, 4);
  const badges: PublicProfileBadge[] = [
    ...(profile.relationLabel ? [{ label: profile.relationLabel, tone: profile.relationTone }] : []),
    ...(profile.badges ?? []),
  ];

  return (
    <Flexbox
      style={{
        width: compact ? 420 : 640,
        maxWidth: '100%',
        overflow: 'hidden',
        borderRadius: 18,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: token.boxShadowTertiary,
      }}
    >
      {headerNode ?? (
        <div
          style={{
            height: compact ? 108 : 132,
            background: profile.header
              ? `url(${profile.header}) center/cover no-repeat`
              : `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, ${token.colorFillQuaternary} 100%)`,
          }}
        />
      )}

      <Flexbox gap={18} style={{ padding: compact ? '0 24px 24px' : '0 28px 28px' }}>
        <Flexbox horizontal gap={18} align="flex-end" style={{ marginTop: -38, minWidth: 0 }}>
          <div style={{ flexShrink: 0 }}>
            {avatarNode ?? (
              <UserSquareAvatar
                remoteUrl={profile.avatar}
                name={title}
                size={compact ? 76 : 88}
                radius={14}
                border={`3px solid ${token.colorBgContainer}`}
              />
            )}
          </div>

          <Flexbox flex={1} gap={6} style={{ minWidth: 0, paddingBottom: 4 }}>
            <Flexbox horizontal align="center" gap={10} style={{ minWidth: 0, flexWrap: 'wrap' }}>
              <Title level={4} ellipsis style={{ margin: 0, maxWidth: '100%' }}>
                {title}
              </Title>
              {badges.map((badge) => (
                <Tag key={badge.label} color={badge.tone ?? 'default'} style={{ margin: 0 }}>
                  {badge.label}
                </Tag>
              ))}
            </Flexbox>
            {profile.username ? (
              <Text type="secondary" style={{ fontSize: 13 }}>
                @{profile.username}
              </Text>
            ) : null}
          </Flexbox>
        </Flexbox>

        {profile.stats && profile.stats.length > 0 ? (
          <Flexbox horizontal gap={10} style={{ flexWrap: 'wrap' }}>
            {profile.stats.map((stat) => (
              <Flexbox
                key={stat.label}
                align="center"
                gap={2}
                style={{
                  flex: '1 1 92px',
                  minWidth: 88,
                  padding: '8px 12px',
                  borderRadius: 10,
                  background: token.colorFillQuaternary,
                }}
              >
                <Text strong style={{ fontSize: 17, lineHeight: 1.15 }}>
                  {stat.value}
                </Text>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {stat.label}
                </Text>
              </Flexbox>
            ))}
          </Flexbox>
        ) : null}

        {profile.bio ? (
          <Paragraph
            type="secondary"
            style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}
            ellipsis={compact ? { rows: 3, expandable: true } : undefined}
          >
            {profile.bio}
          </Paragraph>
        ) : null}

        <Flexbox gap={8}>
          {didShort ? (
            <Flexbox
              horizontal
              align="center"
              gap={8}
              style={{
                padding: '9px 12px',
                borderRadius: 10,
                background: token.colorFillQuaternary,
                minWidth: 0,
              }}
            >
              <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>DID</Text>
              <Text ellipsis={{ tooltip: profile.did }} style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                {didShort}
              </Text>
              {profile.did ? (
                <Button
                  type="text"
                  size="small"
                  icon={<Copy size={13} />}
                  onClick={() => copyPublicIdentifier(profile.did!)}
                  style={{ flexShrink: 0 }}
                />
              ) : null}
            </Flexbox>
          ) : null}

          <Flexbox horizontal gap={8} style={{ flexWrap: 'wrap' }}>
            {createdAt ? (
              <Flexbox horizontal align="center" gap={6} style={{ color: token.colorTextSecondary }}>
                <CalendarDays size={13} />
                <Text type="secondary" style={{ fontSize: 12 }}>{createdAt}</Text>
              </Flexbox>
            ) : null}
            {profile.region ? (
              <Flexbox horizontal align="center" gap={6} style={{ color: token.colorTextSecondary }}>
                <MapPin size={13} />
                <Text type="secondary" style={{ fontSize: 12 }}>{profile.region}</Text>
              </Flexbox>
            ) : null}
          </Flexbox>
        </Flexbox>

        {safeTags.length > 0 ? (
          <Flexbox horizontal gap={6} style={{ flexWrap: 'wrap' }}>
            {safeTags.map((tag) => (
              <Tag key={tag} style={{ margin: 0 }}>{tag}</Tag>
            ))}
          </Flexbox>
        ) : null}

        {safeLinks.length > 0 ? (
          <Flexbox gap={6}>
            {safeLinks.map((link) => (
              <a
                key={`${link.label}:${link.url}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: token.colorText, textDecoration: 'none' }}
              >
                <Flexbox
                  horizontal
                  align="center"
                  gap={8}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    background: token.colorFillQuaternary,
                  }}
                >
                  <Link2 size={13} style={{ color: token.colorTextSecondary, flexShrink: 0 }} />
                  <Text ellipsis style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
                    {link.label || link.url}
                  </Text>
                </Flexbox>
              </a>
            ))}
          </Flexbox>
        ) : null}

        {actions ? <div style={{ marginTop: 2 }}>{actions}</div> : null}
      </Flexbox>
    </Flexbox>
  );
}
