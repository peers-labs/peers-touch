// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { create } from '@bufbuild/protobuf';
import { describe, expect, it, vi } from 'vitest';
import { PostSchema } from '../../gen/proto/domain/social/post_pb';
import { MomentFeedItem } from './MomentFeedItem';

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

describe('Moment feed item', () => {
  it('routes every published image through the encrypted media renderer', () => {
    const contentSource = readFileSync(
      new URL('./MomentContent.tsx', import.meta.url),
      'utf8',
    );

    expect(contentSource).toContain('<MomentImage');
    expect(contentSource).toContain('attachment={images[0]}');
    expect(contentSource).toContain('attachment={image}');
    expect(contentSource).not.toContain(
      'src={images[0].thumbnailUrl || images[0].url}',
    );
    expect(contentSource).not.toContain(
      'src={image.thumbnailUrl || image.url}',
    );
  });

  it('delegates comments, author delete, navigation, and media without mounting a composer', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );
    const contentSource = readFileSync(
      new URL('./MomentContent.tsx', import.meta.url),
      'utf8',
    );
    const actionsSource = readFileSync(
      new URL('./MomentActionsSheet.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('onOpenComments(post.id)');
    expect(source).toContain('onOpenAuthor?.(');
    expect(source).toContain(
      '<MomentContent post={post} onOpenMedia={onOpenMedia}',
    );
    expect(contentSource).toContain('onOpenMedia?.(');
    expect(source).toContain('onDelete(post.id)');
    expect(source).toContain('<MomentActionsSheet');
    expect(actionsSource).toContain('<Trash2');
    expect(actionsSource).toContain('moments-actions-sheet');
    expect(actionsSource).toContain('onPointerDown={onClose}');
    expect(actionsSource).not.toContain('moments-actions-cancel');
    expect(source).toContain('setShowActions(true)');
    expect(source).toContain('<Share2');
    expect(source).toContain(
      'className="moments-action moments-action--share"',
    );
    expect(source).toMatch(/moments-action--share"[\s\S]*?disabled/);
    expect(source).not.toContain('moments-comment-input-row');
    expect(source).not.toContain('onOpenDetail');
    expect(source).toContain('setShowReactionPicker(false)');
  });

  it('keeps transport addresses out of author metadata and uses loaded comment truth', () => {
    const post = create(PostSchema, {
      id: 'post-1',
      authorPtid: 'ptid:bob',
      author: {
        id: 'ptid:bob',
        displayName: 'Bob',
        homeStationDomain: '10.37.221.38:18132',
      },
      reactions: [],
    });
    const markup = renderToStaticMarkup(createElement(MomentFeedItem, {
      post,
      commentCount: 3,
      explanation: {
        source: { stationDomain: '10.37.221.38:18132' },
      },
      onReact: () => undefined,
      onOpenComments: () => undefined,
    }));

    expect(markup).not.toContain('10.37.221.38:18132');
    expect(markup).toContain('mobile.moments.audience.public');
    expect(markup).toContain('moments-action-count');
    expect(markup).toContain('>3<');
  });

  it('keeps reaction and mutation feedback from changing article geometry', () => {
    const source = readFileSync(
      new URL('./MomentFeedItem.tsx', import.meta.url),
      'utf8',
    );
    const styles = readFileSync(
      new URL('./Moments.css', import.meta.url),
      'utf8',
    );

    expect(source).toContain('className="moments-reaction-summary"');
    expect(source).not.toContain('moments-reaction-picker');
    expect(styles).toMatch(
      /\.moments-actions\s*\{[\s\S]*?min-height:\s*44px;/,
    );
    expect(styles).toMatch(
      /\.moments-reaction-status\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*1px;/,
    );
  });

  it('uses the prototype action cluster and inline comment control geometry', () => {
    const styles = readFileSync(
      new URL('./Moments.css', import.meta.url),
      'utf8',
    );

    const actionGroup =
      styles.match(/\.moments-action-group\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(actionGroup).not.toContain('width: 100%');
    expect(actionGroup).toContain('justify-content: flex-end');
    expect(actionGroup).toContain('margin-left: auto');
    expect(styles).toMatch(
      /\.moments-reaction-summary\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline[\s\S]*?margin-top:\s*8px;[\s\S]*?padding:\s*6px 0 0;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline \.moments-comment-input-field > input[\s\S]*?height:\s*38px;[\s\S]*?font-size:\s*13px !important;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline \.moments-comment-input-field > input[\s\S]*?border-radius:\s*10px;/,
    );
    expect(styles).toMatch(
      /\.moments-comments-section--inline \.moments-comments-input > button[\s\S]*?border-radius:\s*10px;/,
    );
    const inputBlock =
      styles.match(
        /\.moments-comments-section--inline \.moments-comment-input-field > input\s*\{([\s\S]*?)\n\}/,
      )?.[1] ?? '';
    const sendBlock =
      styles.match(
        /\.moments-comments-section--inline \.moments-comments-input > button\s*\{([\s\S]*?)\n\}/,
      )?.[1] ?? '';
    expect(inputBlock).not.toMatch(/border-radius:\s*(?:50%|999px)/);
    expect(sendBlock).not.toMatch(/border-radius:\s*(?:50%|999px)/);
  });

  it('renders five independent reaction counts through the same chip, without a duplicate heart total', () => {
    const post = create(PostSchema, {
      id: 'post-1',
      reactions: [1, 2, 3, 4, 5].map((kind) => ({
        kind, count: BigInt(kind), reactedByViewer: kind === 1 || kind === 2,
      })),
    });
    const markup = renderToStaticMarkup(createElement(MomentFeedItem, {
      post, onReact: () => undefined, onOpenComments: () => undefined,
    }));
    for (const emoji of ['👍', '❤️', '😄', '😮', '🎉']) {
      expect(markup).toContain(`data-reaction-chip="${emoji}"`);
    }
    expect(markup.match(/class="mobile-reaction-count"/g)).toHaveLength(5);
    expect(markup.match(/aria-pressed="true"/g)).toHaveLength(2);
    expect(markup).not.toContain('moments-reaction-tag');
  });

  it('keeps existing reactions visible but non-interactive while a command outcome is unresolved', () => {
    const post = create(PostSchema, {
      id: 'post-1',
      reactions: [{ kind: 2, count: 3n, reactedByViewer: true }],
    });
    const markup = renderToStaticMarkup(createElement(MomentFeedItem, {
      post, onReact: () => undefined, onOpenComments: () => undefined,
      reactionMutation: { status: 'unknown-outcome', reactionKind: 2 },
    }));
    expect(markup).toContain('data-reaction-chip="❤️"');
    expect(markup.match(/aria-busy="true"/g)).toHaveLength(2);
    expect(markup).toContain('mobile.moments.reaction.unknownOutcome');
  });
});
