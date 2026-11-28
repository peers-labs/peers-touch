/**
 * PublicProfileCard — Desktop production adapter for the composite
 * IdentityProfileCard.
 *
 * The export name and PublicProfileModel/ProfileCardVariant contracts are
 * preserved so the three consumers (MessageSenderProfileCard author,
 * UserProfilePopover self, ChatDetailPanel sheet) need no changes — only this
 * file's internals switch from hand-written DOM to the shared composite.
 *
 * This file OWNS:
 *   - PublicProfileModel → IdentityProfileModel mapping
 *   - UserSquareAvatar construction (avatarSlot; native avatar host-owned)
 *   - Clipboard write + feedback toast (onCopyTechnical; UI feedback stays host)
 *   - pp-* legacy class injection via SurfaceHooks (CMP-D03) so profileCard.css
 *     and the native gate selectors keep resolving
 *
 * This file does NOT own: card DOM, three-variant grammar, technical-details
 * disclosure or moments rendering — the composite owns those.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IdentityProfileCard } from '@peers-touch/ui-composite';
import type {
  CompositeTranslate, IdentityProfileIntents, IdentityProfileModel,
  IdentityRegionKey, IdentityRelation, SurfaceHooks,
} from '@peers-touch/ui-composite';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { notifyError, notifySuccess } from '../../ui/feedback';

import './profileCard.css';

// ─── Model (public contract preserved) ──────────────────────────────────────

export interface PublicProfileModel {
  displayName: string;
  avatar?: string;
  /** Banner/background image URL. Empty renders the primary wash. */
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
  relationTone?: 'success' | 'warning' | 'processing' | 'default' | (string & {});
  badges?: { label: string; tone: 'success' | 'warning' | (string & {}) }[];
  stats?: { label: string; value: number }[];
}

export type ProfileCardVariant = 'self' | 'author' | 'sheet';

interface PublicProfileCardProps {
  profile: PublicProfileModel;
  /** Primary action row (Add friend / Message / Manage account …), host-owned. */
  actions?: ReactNode;
  variant?: ProfileCardVariant;
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

async function copyText(value: string, copiedLabel: string, copyFailedLabel: string): Promise<void> {
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
      if (!document.execCommand('copy')) throw new Error('clipboard copy command failed');
    } finally {
      textarea.remove();
    }
  };
  try {
    await copy();
    notifySuccess(copiedLabel);
  } catch {
    notifyError(copyFailedLabel);
  }
}

export function PublicProfileCard({ profile, actions, variant = 'author' }: PublicProfileCardProps) {
  const { t } = useTranslation('chat');
  const avatarGeometry: Record<ProfileCardVariant, { size: number; radius: number }> = {
    self: { size: 64, radius: 16 },
    author: { size: 44, radius: 12 },
    sheet: { size: 72, radius: 18 },
  };
  const geometry = avatarGeometry[variant];

  const model: IdentityProfileModel = {
    displayName: profile.displayName,
    isSelf: variant === 'self',
    avatarSlot: (
      <UserSquareAvatar
        remoteUrl={profile.avatar}
        actorPtid={profile.did || null}
        name={profile.displayName}
        size={geometry.size}
        radius={geometry.radius}
        background="var(--pt-subtle)"
        fallback={getInitial(profile.displayName)}
        style={{
          color: 'var(--pt-secondary)',
          fontSize: Math.round(geometry.size * 0.4),
          fontWeight: 700,
        }}
      />
    ),
    handle: profile.username
      ? { localPart: profile.username, home: profile.homeStationDomain?.trim() || undefined }
      : undefined,
    stationLines: (profile.identityMetadata ?? []).filter(Boolean),
    bio: profile.bio,
    relation: profile.relationLabel
      ? { label: profile.relationLabel, tone: profile.relationTone as IdentityRelation['tone'] }
      : undefined,
    badges: profile.badges?.map(badge => ({ label: badge.label, tone: badge.tone })),
    stats: profile.stats,
    tags: profile.tags,
    links: (profile.links ?? []).filter((link): link is { label?: string; url: string } => Boolean(link.url)),
    joined: profile.joined,
    region: profile.region,
    headerImage: profile.header?.trim() || undefined,
    technicalDetails: profile.technicalDetails,
    technicalDetailsLabel: profile.technicalDetailsLabel,
    avatarPtid: profile.did || '',
    avatarSrc: profile.avatar || '',
  };

  const intents: IdentityProfileIntents = {
    onCopyTechnical(detailId) {
      const detail = profile.technicalDetails?.find(item => item.id === detailId);
      if (detail) void copyText(detail.value, detail.copiedLabel, detail.copyFailedLabel);
    },
  };

  // Inject the legacy pp-* classes so profileCard.css and parent popover shells
  // keep resolving while the composite owns the ptc-* structure and tokens.
  const hooks: SurfaceHooks<IdentityRegionKey> = {
    classNames: {
      card: `pp-card pp-card--${variant}`,
      banner: 'pp-self-banner',
      avatar: variant === 'self' ? 'pp-self-avatar' : variant === 'sheet' ? 'pp-sheet-avatar' : undefined,
      bio: 'pp-bio',
      relation: 'pp-pills',
      stats: 'pp-stats',
      links: 'pp-links',
      actions: 'pp-actions',
      technicalDetails: 'pp-details',
      technicalDetail: 'pp-details__row',
    },
    dataAttributes: {},
  };

  return (
    <IdentityProfileCard
      variant={variant}
      profile={model}
      actionsSlot={actions}
      intents={intents}
      t={t as unknown as CompositeTranslate}
      hooks={hooks}
    />
  );
}
