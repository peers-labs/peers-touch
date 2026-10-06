// @ts-nocheck -- fixtures intentionally cover the Native projection boundary.

import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import {
  PostSchema,
  TextPostSchema,
  TimelinePageOutcome,
} from '../../gen/proto/domain/social/post_pb';
import {
  composeHomeFeedState,
  privateMomentFeedPost,
} from './privateMomentFeedProjection';

const baseProjection = {
  contentId: 'content-1',
  generation: 'generation-1',
  authorPtid: 'ptid:alice',
  audienceKind: 'FRIENDS',
  state: 'CONTENT_READY',
  createdAtMillis: 200,
};

describe('private Moment feed projection', () => {
  it.each([
    ['TEXT', { kind: 'TEXT', text: 'text' }, 'textPost'],
    ['IMAGE', { kind: 'IMAGE', text: 'image', media: [] }, 'imagePost'],
    ['VIDEO', { kind: 'VIDEO', text: 'video', media: [] }, 'videoPost'],
    ['LINK', {
      kind: 'LINK', text: 'link', url: 'https://example.com', title: 'Example',
    }, 'linkPost'],
    ['POLL', {
      kind: 'POLL',
      text: 'poll',
      question: 'Choose',
      options: ['A', 'B'],
      minChoices: 1,
      maxChoices: 1,
      expiresAtSeconds: 60,
    }, 'pollPost'],
    ['REPOST', {
      kind: 'REPOST',
      comment: 'again',
      sourcePostId: 'source-1',
      sourceAuthorPtid: 'ptid:bob',
      sourceKind: 'TEXT',
      sourceText: 'source',
    }, 'repostPost'],
    ['LOCATION', {
      kind: 'LOCATION',
      text: 'here',
      name: 'Place',
      latitude: '1.5',
      longitude: '2.5',
      address: 'Address',
      media: [],
    }, 'locationPost'],
  ])('keeps %s as an explicit canonical Post content kind', (_kind, content, expected) => {
    const post = privateMomentFeedPost({
      ...baseProjection,
      postId: `post-${expected}`,
      content,
    });

    expect(post?.content.case).toBe(expected);
  });

  it('deduplicates public and private rows by canonical Post ID', () => {
    const publicPost = create(PostSchema, {
      id: 'post-shared',
      content: {
        case: 'textPost',
        value: create(TextPostSchema, { text: 'encrypted shell' }),
      },
    });
    const home = {
      posts: [publicPost],
      postIndex: new Map([['post-shared', 0]]),
      feedExplanations: new Map(),
      reactionMutations: new Map(),
      selectedDetail: null,
      commentsByPost: new Map(),
      cursor: 'home-cursor',
      hasMore: true,
      pageOutcome: TimelinePageOutcome.ITEMS,
      loadState: 'idle',
      errorMessage: '',
      failure: null,
    };
    const composed = composeHomeFeedState(home, {
      postsById: {
        'post-shared': {
          ...baseProjection,
          postId: 'post-shared',
          content: { kind: 'TEXT', text: 'decrypted content' },
        },
      },
    });

    expect(composed.posts).toHaveLength(1);
    expect(composed.posts[0].content.value.text).toBe('decrypted content');
    expect(composed.cursor).toBe('home-cursor');
  });
});
