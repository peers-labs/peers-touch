/**
 * PublicProfileCard — the single identity-card surface for self, peer and
 * group profiles (rail popover, message-avatar popover, chat detail sheet).
 *
 * Three variants carry the three north-star prototype grammars:
 *   - `self`   rail self popover: cover banner, overlapping avatar
 *              (prototype SelfCardPopover / .sk-self-card)
 *   - `author` quick identity popover opened from a message avatar
 *              (prototype IdentityCard / .sk-author-card)
 *   - `sheet`  centered hero inside the chat detail side sheet
 *              (prototype .sk-profile-hero)
 *
 * The card is strictly declarative: it renders the data bag and whatever
 * `actions` node the caller passes. It MUST NOT branch on self/friend/
 * stranger or own any relationship or management logic — that decision
 * lives in the caller (see ProfilePrimaryAction). Raw identity values stay
 * behind an opt-in expandable disclosure (CHAT-UR09) so casual users never
 * see developer plumbing.
 */

import type { CSSProperties, ReactNode } from 'react';
import { IconButton, Tooltip as PtTooltip } from '@peers-touch/ui';
import { Link2 } from 'lucide-react';
import { UserSquareAvatar } from '../common/UserSquareAvatar';
import { FederatedHandle } from '../FederatedHandle';
import { notifyError, notifySuccess } from '../../ui/feedback';
import './profileCard.css';

// ─── Model ──────────────────────────────────────────────────────────────────

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

// ─── Props ──────────────────────────────────────────────────────────────────

export type ProfileCardVariant = 'self' | 'author' | 'sheet';

interface PublicProfileCardProps {
  profile: PublicProfileModel;
  /**
   * Primary action row (Add friend / Message / Manage account …). The card
   * never derives this from the model; callers compose the node and own its
   * behaviour.
   */
  actions?: ReactNode;
  /** Surface grammar; see class doc. */
  variant?: ProfileCardVariant;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function pillTone(tone: string | undefined): string {
  if (tone === 'success' || tone === 'warning' || tone === 'processing') return tone;
  return 'default';
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
    notifySuccess(copiedLabel);
  } catch {
    notifyError(copyFailedLabel);
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

export function PublicProfileCard({
  profile,
  actions,
  variant = 'author',
}: PublicProfileCardProps) {
  const links = (profile.links ?? []).filter((link) => link.url && safeUrl(link.url));
  const identityLines = (profile.identityMetadata ?? []).filter(Boolean);

  const avatarGeometry: Record<ProfileCardVariant, { size: number; radius: number }> = {
    self: { size: 64, radius: 16 },
    author: { size: 44, radius: 12 },
    sheet: { size: 72, radius: 18 },
  };
  const avatar = (
    <UserSquareAvatar
      remoteUrl={profile.avatar}
      actorPtid={profile.did || null}
      name={profile.displayName}
      size={avatarGeometry[variant].size}
      radius={avatarGeometry[variant].radius}
      background="var(--pt-subtle)"
      fallback={getInitial(profile.displayName)}
      style={{
        color: 'var(--pt-secondary)',
        fontSize: Math.round(avatarGeometry[variant].size * 0.4),
        fontWeight: 700,
      }}
    />
  );

  const handle = profile.username ? (
    <FederatedHandle
      localPart={profile.username}
      home={profile.homeStationDomain}
      fontSize={12}
    />
  ) : null;

  const bio = profile.bio ? (
    <p className="pp-bio" title={profile.bio}>{profile.bio}</p>
  ) : null;

  const relationPill = profile.relationLabel ? (
    <div className="pp-pills">
      <span
        className="pp-pill"
        data-chat-profile-relation={profile.relationLabel}
        data-tone={pillTone(profile.relationTone)}
      >
        {profile.relationLabel}
      </span>
    </div>
  ) : null;

  const badgePills = profile.badges && profile.badges.length > 0 ? (
    <div className="pp-pills">
      {profile.badges.map((badge) => (
        <span key={badge.label} className="pp-pill" data-tone={pillTone(badge.tone)}>
          {badge.label}
        </span>
      ))}
    </div>
  ) : null;

  const statBlock = profile.stats && profile.stats.length > 0 ? (
    <div className={`pp-stats pp-stats--${variant}`}>
      {profile.stats.map((stat) => (
        <span key={stat.label} className="pp-stat">
          <strong>{stat.value}</strong>
          {stat.label}
        </span>
      ))}
    </div>
  ) : null;

  const metaLine = (profile.joined || profile.region) ? (
    <div className="pp-meta-line">
      {profile.joined ? <span>{profile.joined}</span> : null}
      {profile.region ? <span>{profile.region}</span> : null}
    </div>
  ) : null;

  const tagPills = profile.tags && profile.tags.length > 0 ? (
    <div className="pp-pills">
      {profile.tags.map((tag) => (
        <span key={tag} className="pp-pill">{tag}</span>
      ))}
    </div>
  ) : null;

  const linkBlock = links.length > 0 ? (
    <div className="pp-links">
      {links.map((link, index) => {
        const href = safeUrl(link.url as string);
        if (!href) return null;
        return (
          <a
            key={`${href}-${index}`}
            className="pp-link"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            <Link2 size={12} style={{ flexShrink: 0 }} />
            <span>{link.label?.trim() || href}</span>
          </a>
        );
      })}
    </div>
  ) : null;

  const actionBlock = actions ? (
    <div className="pp-actions">{actions}</div>
  ) : null;

  const technicalDetails = profile.technicalDetails && profile.technicalDetails.length > 0 ? (
    <details className="pp-details" data-chat-profile-technical-details>
      <summary>{profile.technicalDetailsLabel}</summary>
      <div className="pp-details__rows">
        {profile.technicalDetails.map((detail) => (
          <div
            key={detail.id}
            className="pp-details__row"
            data-chat-profile-technical-detail={detail.id}
          >
            <span className="pp-details__label">{detail.label}</span>
            <span className="pp-details__value" title={detail.value}>{detail.value}</span>
            <PtTooltip label={detail.copyLabel}>
              <IconButton
                iconId="copy"
                iconSize={13}
                emphasis="quiet"
                density="compact"
                actionId={`profile.copy.${detail.id}`}
                label={detail.copyLabel}
                data-chat-profile-copy={detail.id}
                onActivate={() => {
                  void copyText(detail.value, detail.copiedLabel, detail.copyFailedLabel);
                }}
              />
            </PtTooltip>
          </div>
        ))}
      </div>
    </details>
  ) : null;

  const rootData = {
    'data-chat-profile-card': true,
    'data-chat-avatar-ptid': profile.did || '',
    'data-chat-avatar-src': profile.avatar || '',
  } as const;

  if (variant === 'self') {
    const bannerStyle: CSSProperties | undefined = profile.header
      ? { backgroundImage: `url("${profile.header}")` }
      : undefined;
    return (
      <div className="pp-card pp-card--self" {...rootData}>
        <div
          className="pp-self-banner"
          data-chat-profile-banner={profile.header ? 'image' : 'gradient'}
          style={bannerStyle}
        />
        <div className="pp-self-body">
          <div className="pp-self-avatar">{avatar}</div>
          <div className="pp-self-name" title={profile.displayName}>{profile.displayName}</div>
          {handle ? <div className="pp-self-handle">{handle}</div> : null}
          {identityLines.length > 0 ? (
            <div className="pp-self-identity">
              {identityLines.map((value) => (
                <span key={value} className="pp-author-station" title={value}>{value}</span>
              ))}
            </div>
          ) : null}
          {statBlock}
          {metaLine ? <div className="pp-self-joined">{metaLine}</div> : null}
          {bio}
          {relationPill}
          {badgePills}
          {tagPills}
          {linkBlock}
          {actionBlock}
          {technicalDetails}
        </div>
      </div>
    );
  }

  if (variant === 'sheet') {
    return (
      <div className="pp-card pp-card--sheet" {...rootData}>
        <section className="pp-sheet-hero" data-profile-identity>
          <div className="pp-sheet-avatar">{avatar}</div>
          <strong className="pp-sheet-name">{profile.displayName}</strong>
          <div className="pp-sheet-sub">
            {identityLines.map((value) => <span key={value}>{value}</span>)}
            {handle}
          </div>
        </section>
        <div className="pp-sheet-body">
          {bio}
          {relationPill}
          {badgePills}
          {statBlock}
          {metaLine}
          {tagPills}
          {linkBlock}
          {actionBlock}
          {technicalDetails}
        </div>
      </div>
    );
  }

  return (
    <div className="pp-card pp-card--author" {...rootData}>
      <header className="pp-author-head">
        {avatar}
        <div className="pp-author-idcol">
          <strong className="pp-author-name" title={profile.displayName}>
            {profile.displayName}
          </strong>
          {handle}
          {identityLines.map((value) => (
            <span key={value} className="pp-author-station" title={value}>{value}</span>
          ))}
        </div>
      </header>
      {bio}
      {relationPill}
      {badgePills}
      {statBlock}
      {metaLine}
      {tagPills}
      {linkBlock}
      {actionBlock}
      {technicalDetails}
    </div>
  );
}
