/**
 * Mapping helpers for PublicProfileCard.
 *
 * Keeps AccountProfile → PublicProfileModel composition in one place so the
 * self popover, contact detail and message-avatar card show the same
 * practical fields from one precedence order. Presentation-only: no fetch,
 * no store access.
 */
import type { AccountProfile } from '../../services/desktop_api';
import {
  canonicalProfileAvatar,
  remoteProfileHandle,
} from '../../store/socialProfileProjection';
import type { PublicProfileModel } from './PublicProfileCard';

export interface ProfileStatLabels {
  posts: string;
  followers: string;
  following: string;
}

function localPart(handle: string): string {
  const parts = handle.replace(/^@/, '').split('@');
  return parts[0] || '';
}

function homeDomain(handle: string, profile: AccountProfile): string {
  const parts = handle.replace(/^@/, '').split('@');
  return (parts[1] || profile.home_station_domain || '').trim();
}

export function accountProfileStats(
  remote: Pick<AccountProfile, 'statuses_count' | 'followers_count' | 'following_count'>,
  labels: ProfileStatLabels,
): { label: string; value: number }[] {
  const stats: { label: string; value: number }[] = [];
  if (typeof remote.statuses_count === 'number') {
    stats.push({ label: labels.posts, value: remote.statuses_count });
  }
  if (typeof remote.followers_count === 'number') {
    stats.push({ label: labels.followers, value: remote.followers_count });
  }
  if (typeof remote.following_count === 'number') {
    stats.push({ label: labels.following, value: remote.following_count });
  }
  return stats;
}

export function formatJoinedDate(
  createdAt: string | undefined,
  joinedLabel: string,
): string | undefined {
  const value = createdAt?.trim();
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${joinedLabel} ${date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })}`;
}

/**
 * Merge a lightweight projection fallback with the rich Station AccountProfile.
 * Station fields win when present; the fallback keeps name/avatar visible
 * during the network round-trip.
 */
export function mergeAccountProfile(
  fallback: PublicProfileModel,
  remote: AccountProfile,
  labels: ProfileStatLabels,
  joinedLabel: string,
): PublicProfileModel {
  const handle = remoteProfileHandle(remote);
  const stats = accountProfileStats(remote, labels);
  const joined = formatJoinedDate(remote.created_at, joinedLabel);
  return {
    ...fallback,
    displayName: remote.display_name?.trim() || fallback.displayName,
    // Avatar feeds the native asset owner: key on the transport-independent
    // canonical identity so per-process projection-token rotation never
    // blanks the frame. Header stays on the projected URL — it is consumed
    // directly as a CSS background, not through the avatar asset owner.
    avatar: canonicalProfileAvatar(remote) || fallback.avatar,
    header: remote.header?.trim() || fallback.header,
    username: remote.username?.trim() || localPart(handle) || fallback.username,
    homeStationDomain: homeDomain(handle, remote) || fallback.homeStationDomain,
    bio: remote.note?.trim() || fallback.bio,
    did: remote.id?.trim() || fallback.did,
    joined: joined ? `${joinedLabel} ${joined}` : fallback.joined,
    region: remote.region?.trim() || fallback.region,
    tags: (remote.tags ?? []).filter(Boolean),
    links: (remote.links ?? []).filter((link) => link && (link.label || link.url)),
    stats: stats.length > 0 ? stats : fallback.stats,
  };
}
