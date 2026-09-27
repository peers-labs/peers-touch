// @ts-nocheck -- Vitest is supplied by the repository test runner.

import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from '@bufbuild/protobuf';
import {
  ImageAttachmentSchema,
  ImagePostSchema,
  PostSchema,
} from '../../gen/proto/domain/social/post_pb';

const composerMocks = vi.hoisted(() => ({
  draft: {
    draftRestored: false,
    hasDraft: false,
    saveDraft: vi.fn(),
    persistDraftNow: vi.fn(async () => true),
    discardDraft: vi.fn(async () => true),
    restoreDraft: vi.fn(async () => null),
    retryPersistence: vi.fn(async () => true),
    saving: false,
    discarding: false,
    persistenceFailure: null,
  },
}));

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../features/social/useMomentsDraft', () => ({
  useMomentsDraft: () => composerMocks.draft,
}));

import {
  canPublishMoment,
  createRestoredMomentImages,
  hasAuthoritativeImageReadback,
  MomentComposer,
} from './MomentComposer';

function renderMomentComposer(): string {
  return renderToStaticMarkup(React.createElement(MomentComposer, {
    session: {
      stationPeerId: 'station-1',
      actorRef: { ptid: 'ptid:alice' },
    },
    gateway: {
      createMoment: vi.fn(),
    },
    onPublished: vi.fn(),
  }));
}

describe('Moment composer media restoration', () => {
  beforeEach(() => {
    composerMocks.draft.draftRestored = false;
    composerMocks.draft.hasDraft = false;
    composerMocks.draft.saving = false;
    composerMocks.draft.discarding = false;
    composerMocks.draft.persistenceFailure = null;
    composerMocks.draft.saveDraft.mockClear();
    composerMocks.draft.persistDraftNow.mockClear();
    composerMocks.draft.discardDraft.mockClear();
    composerMocks.draft.restoreDraft.mockClear();
    composerMocks.draft.retryPersistence.mockClear();
  });

  it('restores uploaded references without retaining raw File objects', () => {
    const restored = createRestoredMomentImages([
      'cid:encrypted-image-1',
      'cid:encrypted-image-2',
    ]);

    expect(restored).toHaveLength(2);
    expect(restored.map((item) => item.persistedRef)).toEqual([
      'cid:encrypted-image-1',
      'cid:encrypted-image-2',
    ]);
    expect(restored.every((item) => item.source === 'restored-reference')).toBe(true);
    expect(restored.every((item) => !('file' in item))).toBe(true);
    expect(restored.every((item) => item.image === undefined)).toBe(true);
  });

  it('allows image-only publication after every upload completes', () => {
    expect(canPublishMoment('', 1, 0, 0, false)).toBe(true);
    expect(canPublishMoment('', 0, 0, 0, false)).toBe(false);
    expect(canPublishMoment('', 1, 1, 0, false)).toBe(false);
  });

  it('requires every submitted image reference in the authoritative post', () => {
    const submitted = createRestoredMomentImages([
      'cid:encrypted-image-1',
      'cid:encrypted-image-2',
    ]);
    const post = create(PostSchema, {
      content: {
        case: 'imagePost',
        value: create(ImagePostSchema, {
          text: '',
          images: [
            create(ImageAttachmentSchema, {
              id: 'cid:encrypted-image-1',
              url: 'cid:encrypted-image-1',
            }),
            create(ImageAttachmentSchema, {
              id: 'cid:encrypted-image-2',
              url: 'cid:encrypted-image-2',
            }),
          ],
        }),
      },
    });

    expect(hasAuthoritativeImageReadback(post, submitted)).toBe(true);
    expect(hasAuthoritativeImageReadback(
      create(PostSchema, {
        content: {
          case: 'imagePost',
          value: create(ImagePostSchema, {
            text: '',
            images: post.content.case === 'imagePost'
              ? post.content.value.images.slice(0, 1)
              : [],
          }),
        },
      }),
      submitted,
    )).toBe(false);
  });

  it('keeps a persistence failure visible with retry and explicit discard', () => {
    composerMocks.draft.hasDraft = true;
    composerMocks.draft.persistenceFailure = {
      operation: 'save',
      message: 'draft store unavailable',
    };

    const markup = renderMomentComposer();

    expect(markup).toContain('data-draft-failure="save"');
    expect(markup).toContain('draft store unavailable');
    expect(markup).toContain('common.action.retry');
    expect(markup).toContain('mobile.moments.composer.discardDraft');
  });

  it('requires durable draft persistence before starting publication', () => {
    const source = readFileSync(
      new URL('./MomentComposer.tsx', import.meta.url),
      'utf8',
    );
    const persistIndex = source.indexOf('await persistDraftNow(');
    const publishIndex = source.indexOf('await gateway.createMoment(');

    expect(persistIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(persistIndex);
    expect(source).toContain('if (removed) completePublishedMoment(publishedPost)');
  });

  it('keeps Moments authoring on the opaque native media path', () => {
    const source = readFileSync(
      new URL('./MomentComposer.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('pickNativeMedia({');
    expect(source).toContain('uploadNativeMomentMedia({');
    expect(source).toContain('discardNativeMomentMedia({');
    expect(source).not.toContain('type="file"');
    expect(source).not.toContain('URL.createObjectURL');
    expect(source).not.toContain('uploadMobileMomentImage');
    expect(source).not.toContain('body_bytes');
  });
});
