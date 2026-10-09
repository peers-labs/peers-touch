import { create } from '@bufbuild/protobuf';

import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';
import type { PrivateSocialAudience } from '../../services/mobileCommands';

export type SocialAudienceChoice =
  | 'PUBLIC'
  | 'FOLLOWERS'
  | 'FRIENDS'
  | 'CIRCLE'
  | 'GROUP'
  | 'CUSTOM_ALLOW'
  | 'CUSTOM_DENY'
  | 'DIRECT'
  | 'SELF';

export interface SocialAudienceChoiceOption {
  readonly id: SocialAudienceChoice;
  readonly labelKey: string;
}

export interface SocialAudienceTarget {
  readonly circleId?: string;
  readonly groupConversationId?: string;
  readonly actorPtids?: readonly string[];
}

export const SOCIAL_AUDIENCE_CHOICES: readonly SocialAudienceChoiceOption[] = [
  { id: 'PUBLIC', labelKey: 'mobile.moments.audience.public' },
  { id: 'FOLLOWERS', labelKey: 'mobile.moments.audience.followers' },
  { id: 'FRIENDS', labelKey: 'mobile.moments.audience.friends' },
  { id: 'CIRCLE', labelKey: 'mobile.moments.audience.circle' },
  { id: 'GROUP', labelKey: 'mobile.moments.audience.group' },
  { id: 'CUSTOM_ALLOW', labelKey: 'mobile.moments.audience.customAllow' },
  { id: 'CUSTOM_DENY', labelKey: 'mobile.moments.audience.customDeny' },
  { id: 'DIRECT', labelKey: 'mobile.moments.audience.direct' },
  { id: 'SELF', labelKey: 'mobile.moments.audience.self' },
] as const;

export function buildSocialAudience(
  choice: SocialAudienceChoice,
  target: SocialAudienceTarget = {},
): Audience {
  switch (choice) {
    case 'PUBLIC':
      return create(AudienceSchema, { kind: Audience_Kind.PUBLIC });
    case 'FOLLOWERS':
      return create(AudienceSchema, { kind: Audience_Kind.FOLLOWERS });
    case 'FRIENDS':
      return create(AudienceSchema, { kind: Audience_Kind.FRIENDS });
    case 'SELF':
      return create(AudienceSchema, { kind: Audience_Kind.SELF });
    case 'CIRCLE': {
      const circleId = parseCircleId(target.circleId);
      return create(AudienceSchema, {
        kind: Audience_Kind.CIRCLE,
        target: { case: 'circleId', value: circleId },
      });
    }
    case 'GROUP': {
      const groupConversationId = requireStableValue(
        target.groupConversationId,
        'mobile.moments.audience.groupRequired',
      );
      return create(AudienceSchema, {
        kind: Audience_Kind.GROUP,
        target: { case: 'groupConversationId', value: groupConversationId },
      });
    }
    case 'DIRECT': {
      const actorPtids = normalizeActorPtids(target.actorPtids);
      if (actorPtids.length !== 1) {
        throw new Error('mobile.moments.audience.directRequired');
      }
      return create(AudienceSchema, {
        kind: Audience_Kind.CUSTOM_ALLOW,
        actorPtids,
      });
    }
    case 'CUSTOM_ALLOW': {
      const actorPtids = requireActorPtids(target.actorPtids);
      return create(AudienceSchema, {
        kind: Audience_Kind.CUSTOM_ALLOW,
        actorPtids,
      });
    }
    case 'CUSTOM_DENY': {
      const actorPtids = requireActorPtids(target.actorPtids);
      return create(AudienceSchema, {
        kind: Audience_Kind.CUSTOM_DENY,
        actorPtids,
        baseKind: Audience_Kind.FOLLOWERS,
      });
    }
  }
}

export function normalizeSocialAudience(audience: Audience): Audience {
  switch (audience.kind) {
    case Audience_Kind.PUBLIC:
      return buildSocialAudience('PUBLIC');
    case Audience_Kind.FOLLOWERS:
      return buildSocialAudience('FOLLOWERS');
    case Audience_Kind.FRIENDS:
      return buildSocialAudience('FRIENDS');
    case Audience_Kind.SELF:
      return buildSocialAudience('SELF');
    case Audience_Kind.CIRCLE:
      if (audience.target.case !== 'circleId') {
        throw new Error('mobile.moments.audience.circleRequired');
      }
      return buildSocialAudience('CIRCLE', {
        circleId: audience.target.value.toString(),
      });
    case Audience_Kind.GROUP:
      if (audience.target.case !== 'groupConversationId') {
        throw new Error('mobile.moments.audience.groupRequired');
      }
      return buildSocialAudience('GROUP', {
        groupConversationId: audience.target.value,
      });
    case Audience_Kind.CUSTOM_ALLOW:
      return buildSocialAudience('CUSTOM_ALLOW', {
        actorPtids: audience.actorPtids,
      });
    case Audience_Kind.CUSTOM_DENY:
      if (audience.baseKind !== Audience_Kind.FOLLOWERS) {
        throw new Error('mobile.moments.audience.customDenyBaseInvalid');
      }
      return buildSocialAudience('CUSTOM_DENY', {
        actorPtids: audience.actorPtids,
      });
    default:
      throw new Error('mobile.moments.audience.unsupported');
  }
}

export function socialAudienceChoiceFromAudience(
  audience: Audience,
): SocialAudienceChoice {
  const normalized = normalizeSocialAudience(audience);
  switch (normalized.kind) {
    case Audience_Kind.PUBLIC:
      return 'PUBLIC';
    case Audience_Kind.FOLLOWERS:
      return 'FOLLOWERS';
    case Audience_Kind.FRIENDS:
      return 'FRIENDS';
    case Audience_Kind.CIRCLE:
      return 'CIRCLE';
    case Audience_Kind.GROUP:
      return 'GROUP';
    case Audience_Kind.CUSTOM_ALLOW:
      return normalized.actorPtids.length === 1 ? 'DIRECT' : 'CUSTOM_ALLOW';
    case Audience_Kind.CUSTOM_DENY:
      return 'CUSTOM_DENY';
    case Audience_Kind.SELF:
      return 'SELF';
    default:
      throw new Error('mobile.moments.audience.unsupported');
  }
}

export function socialAudienceTargetFromAudience(
  audience: Audience,
): SocialAudienceTarget {
  const normalized = normalizeSocialAudience(audience);
  if (normalized.target.case === 'circleId') {
    return { circleId: normalized.target.value.toString() };
  }
  if (normalized.target.case === 'groupConversationId') {
    return { groupConversationId: normalized.target.value };
  }
  if (
    normalized.kind === Audience_Kind.CUSTOM_ALLOW
    || normalized.kind === Audience_Kind.CUSTOM_DENY
  ) {
    return { actorPtids: normalized.actorPtids };
  }
  return {};
}

export function isPublicSocialAudience(audience: Audience): boolean {
  return normalizeSocialAudience(audience).kind === Audience_Kind.PUBLIC;
}

export function toPrivateSocialAudience(
  audience: Audience,
): PrivateSocialAudience {
  const normalized = normalizeSocialAudience(audience);
  switch (normalized.kind) {
    case Audience_Kind.FOLLOWERS:
      return { kind: 'FOLLOWERS' };
    case Audience_Kind.FRIENDS:
      return { kind: 'FRIENDS' };
    case Audience_Kind.SELF:
      return { kind: 'SELF' };
    case Audience_Kind.CIRCLE:
      return {
        kind: 'CIRCLE',
        circleId: normalized.target.case === 'circleId'
          ? normalized.target.value.toString()
          : '',
      };
    case Audience_Kind.GROUP:
      return {
        kind: 'GROUP',
        groupConversationId: normalized.target.case === 'groupConversationId'
          ? normalized.target.value
          : '',
      };
    case Audience_Kind.CUSTOM_ALLOW:
      return { kind: 'CUSTOM_ALLOW', actorPtids: [...normalized.actorPtids] };
    case Audience_Kind.CUSTOM_DENY:
      return {
        kind: 'CUSTOM_DENY',
        actorPtids: [...normalized.actorPtids],
        baseKind: 'FOLLOWERS',
      };
    case Audience_Kind.PUBLIC:
      throw new Error('mobile.moments.audience.publicIsNotPrivate');
    default:
      throw new Error('mobile.moments.audience.unsupported');
  }
}

function parseCircleId(value: string | undefined): bigint {
  const stable = requireStableValue(
    value,
    'mobile.moments.audience.circleRequired',
  );
  if (!/^[1-9]\d*$/.test(stable)) {
    throw new Error('mobile.moments.audience.circleRequired');
  }
  return BigInt(stable);
}

function requireActorPtids(values: readonly string[] | undefined): string[] {
  const actorPtids = normalizeActorPtids(values);
  if (actorPtids.length === 0) {
    throw new Error('mobile.moments.audience.recipientsRequired');
  }
  return actorPtids;
}

function normalizeActorPtids(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => (
    requireStableValue(value, 'mobile.moments.audience.recipientsRequired')
  )))];
}

function requireStableValue(
  value: string | undefined,
  errorCode: string,
): string {
  if (!value || value.trim() !== value) throw new Error(errorCode);
  return value;
}
