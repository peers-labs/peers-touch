/**
 * Port contract for IdentityProfileCard (composite package public surface).
 *
 * Three surface grammars share one component:
 *   - self   rail self popover (cover banner + overlapping avatar)
 *   - author quick identity popover (avatar head + optional moments strip)
 *   - sheet  centered hero inside the chat detail side sheet
 *
 * The card is strictly declarative: it renders the view model and whatever
 * nodes the host injects through avatarSlot / actionsSlot. Relationship logic,
 * native avatar resolution, clipboard feedback and popover shells stay in the
 * host. The component holds only the technical-details disclosure phase.
 *
 * Design references:
 *   design.md CMP-D02 (pure display + UI transients)
 *   design.md CMP-D06 (native avatar never enters the package)
 *   data-model.md §3 (port contract + selector preservation list)
 */
import type { ReactNode } from 'react';
import type { CompositeTranslate } from '../i18n';
import type { SurfaceHooks } from '../hooks';

// ── View model ─────────────────────────────────────────────────────────────

export type ProfileVariant = 'self' | 'author' | 'sheet';

export interface IdentityTechnicalDetail {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
  copiedLabel: string;
  copyFailedLabel: string;
}

export interface IdentityMoment {
  id: string;
  text: string;
  image?: string;
  at?: string;
}

export interface IdentityRelation {
  label: string;
  tone?: 'success' | 'warning' | 'processing' | 'default';
}

export interface IdentityProfileModel {
  displayName: string;
  /** Native avatar stays host-owned (CMP-D06); composite only places the node. */
  avatarSlot: ReactNode;
  handle?: { localPart: string; home?: string };
  stationLines?: string[];
  bio?: string;
  relation?: IdentityRelation;
  badges?: { label: string; tone?: string }[];
  stats?: { label: string; value: number }[];
  tags?: string[];
  links?: { label?: string; url: string }[];
  joined?: string;
  region?: string;
  /** Self banner image URL; absent renders the primary-token wash. */
  headerImage?: string;
  technicalDetails?: IdentityTechnicalDetail[];
  technicalDetailsLabel?: string;
  /** author variant only: latest-moments strip; self/sheet omit it. */
  moments?: IdentityMoment[];
  isSelf: boolean;
  /** Gate identity markers projected onto the root node (production selectors). */
  avatarPtid?: string;
  avatarSrc?: string;
}

// ── Intents (side-effects flow out; the component never performs them) ──────

export interface IdentityProfileIntents {
  /** Clipboard write + toast feedback are owned by the host. */
  onCopyTechnical?(detailId: string): void;
  onOpenMoment?(momentId: string): void;
  onOpenProfile?(): void;
}

// ── Region keys (CMP-D03 hook mapping) ─────────────────────────────────────

export type IdentityRegionKey =
  | 'card' | 'banner' | 'avatar' | 'handle' | 'bio' | 'relation'
  | 'stats' | 'links' | 'actions' | 'technicalDetails' | 'technicalDetail'
  | 'copyButton' | 'moments' | 'momentTile';

// ── Component props ─────────────────────────────────────────────────────────

export interface IdentityProfileCardProps {
  variant: ProfileVariant;
  profile: IdentityProfileModel;
  /** Relationship action row (follow/message/block/friend requests): host-owned. */
  actionsSlot?: ReactNode;
  intents: IdentityProfileIntents;
  t: CompositeTranslate;
  hooks?: SurfaceHooks<IdentityRegionKey>;
}

export type { ReactNode };
