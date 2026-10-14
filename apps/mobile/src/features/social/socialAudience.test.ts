// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it } from 'vitest';

import { Audience_Kind } from '../../gen/proto/domain/social/post_pb';
import {
  SOCIAL_AUDIENCE_CHOICES,
  buildSocialAudience,
  normalizeSocialAudience,
  socialAudienceChoiceFromAudience,
  socialAudienceTargetFromAudience,
  toPrivateSocialAudience,
} from './socialAudience';

describe('canonical Mobile Social Audience', () => {
  it('exposes every canonical kind plus the Direct preset', () => {
    expect(SOCIAL_AUDIENCE_CHOICES.map((option) => option.id)).toEqual([
      'PUBLIC',
      'FOLLOWERS',
      'FRIENDS',
      'CIRCLE',
      'GROUP',
      'CUSTOM_ALLOW',
      'CUSTOM_DENY',
      'DIRECT',
      'SELF',
    ]);
  });

  it('builds target-bearing generated Audience values', () => {
    const circle = buildSocialAudience('CIRCLE', { circleId: '7' });
    const group = buildSocialAudience('GROUP', {
      groupConversationId: 'conversation-1',
    });
    const direct = buildSocialAudience('DIRECT', {
      actorPtids: ['ptid:bob'],
    });

    expect(circle).toMatchObject({
      kind: Audience_Kind.CIRCLE,
      target: { case: 'circleId', value: 7n },
    });
    expect(group).toMatchObject({
      kind: Audience_Kind.GROUP,
      target: { case: 'groupConversationId', value: 'conversation-1' },
    });
    expect(direct).toMatchObject({
      kind: Audience_Kind.CUSTOM_ALLOW,
      actorPtids: ['ptid:bob'],
    });
    expect(socialAudienceChoiceFromAudience(direct)).toBe('DIRECT');
    expect(socialAudienceTargetFromAudience(direct)).toEqual({
      actorPtids: ['ptid:bob'],
    });
  });

  it('maps private kinds without permitting a public fallback', () => {
    expect(toPrivateSocialAudience(buildSocialAudience('FOLLOWERS')))
      .toEqual({ kind: 'FOLLOWERS' });
    expect(toPrivateSocialAudience(buildSocialAudience('CUSTOM_DENY', {
      actorPtids: ['ptid:bob', 'ptid:bob', 'ptid:carol'],
    }))).toEqual({
      kind: 'CUSTOM_DENY',
      actorPtids: ['ptid:bob', 'ptid:carol'],
      baseKind: 'FOLLOWERS',
    });
    expect(() => toPrivateSocialAudience(buildSocialAudience('PUBLIC')))
      .toThrow('mobile.moments.audience.publicIsNotPrivate');
  });

  it('fails closed for incomplete or unsupported Audience values', () => {
    expect(() => buildSocialAudience('CIRCLE', { circleId: '0' }))
      .toThrow('mobile.moments.audience.circleRequired');
    expect(() => buildSocialAudience('DIRECT', {
      actorPtids: ['ptid:bob', 'ptid:carol'],
    })).toThrow('mobile.moments.audience.directRequired');
    expect(() => normalizeSocialAudience({
      kind: Audience_Kind.CUSTOM_DENY,
      actorPtids: ['ptid:bob'],
      baseKind: Audience_Kind.PUBLIC,
      target: { case: undefined },
    })).toThrow('mobile.moments.audience.customDenyBaseInvalid');
  });
});
