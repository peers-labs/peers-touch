import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import { Audience_Kind, PostSchema } from '../gen/proto/domain/social/post_pb';
import type { PrivateMomentProjection } from '../services/privateMomentsNative';
import { momentSearchText } from './momentsTimeline';

const post = create(PostSchema, {
  id: 'private-post', authorPtid: 'ptid:bob',
  audience: { kind: Audience_Kind.FRIENDS },
  author: { id: 'ptid:bob', displayName: 'Stale author', username: 'old',
    homeStationDomain: 'old.example' },
  content: { case: 'textPost', value: { text: 'forbidden shell plaintext' } },
});
const projection: PrivateMomentProjection = {
  postId: post.id, contentId: post.id, authorPtid: 'ptid:bob', generation: '1',
  audienceKind: 'FRIENDS', state: 'CONTENT_READY', mentions: [],
  content: { kind: 'TEXT', text: 'Authorized body' },
};

describe('Moments acquired timeline search', () => {
  it('uses the resolved canonical author and Station while keeping private content at its owner', () => {
    const text = momentSearchText(post, projection, {
      actorPtid: 'ptid:bob', displayName: 'Bob current', username: 'bob',
      homeStationName: 'Aspen Station', homeStationDomain: 'aspen.example',
    });
    expect(text).toBe('authorized body\nbob current\nbob\naspen station\naspen.example');
    expect(text).not.toContain('stale');
    expect(text).not.toContain('old.example');
    expect(text).not.toContain('forbidden');
    expect(projection.content).toEqual({ kind: 'TEXT', text: 'Authorized body' });
  });

  it('rejects another actor identity and ignores stale embedded author metadata', () => {
    expect(momentSearchText(post, projection, {
      actorPtid: 'ptid:alice', displayName: 'Alice', homeStationName: 'Other Station',
    })).toBe('authorized body');
    expect(momentSearchText(post, projection)).toBe('authorized body');
  });

  it.each(['NOT_FOUND_OR_NOT_AUTHORIZED', 'DELETED_OR_REVOKED', 'RECOVERY_REQUIRED'] as const)(
    'does not search retained plaintext in a %s projection', (state) => {
      expect(momentSearchText(post, { ...projection, state })).toBe('');
    },
  );

  it('rejects a private projection for another resource or author', () => {
    expect(momentSearchText(post, { ...projection, postId: 'other-post' })).toBe('');
    expect(momentSearchText(post, { ...projection, authorPtid: 'ptid:alice' })).toBe('');
    expect(momentSearchText(post, { ...projection, audienceKind: 'UNKNOWN' })).toBe('');
  });

  it('retains public-body search without treating private projection text as public', () => {
    const publicPost = create(PostSchema, {
      id: post.id, authorPtid: 'ptid:bob', audience: { kind: Audience_Kind.PUBLIC },
      content: { case: 'textPost', value: { text: 'Public body' } },
    });
    expect(momentSearchText(publicPost, projection, {
      actorPtid: 'ptid:bob', displayName: 'Bob',
    })).toBe('public body\nbob');
  });
});
