// @ts-nocheck -- Vitest is supplied by the repository test runner.

import { describe, expect, it, vi } from 'vitest';

import { MobileDraftSurfaceKind } from '../../gen/proto/domain/mobile/reliability_pb';
import { Audience_Kind } from '../../gen/proto/domain/social/post_pb';
import {
  buildMomentDraftEnvelope,
  discardMomentDraft,
  persistMomentDraft,
  readMomentDraftEnvelope,
  readOwnedMomentDraftEnvelope,
} from './useMomentsDraft';

describe('Moment draft generated contract', () => {
  it('round-trips text, audience, and successful uploaded references', () => {
    const envelope = buildMomentDraftEnvelope(
      {
        stationPeerId: 'station-1',
        actorPtid: 'ptid:alice',
      },
      {
        text: 'Draft with uploads',
        audienceKind: Audience_Kind.FOLLOWERS,
        mediaRefs: ['cid:image-1', 'cid:image-2', 'cid:image-1'],
      },
      1_700_000_000_000,
    );

    expect(envelope.payload.case).toBe('moment');
    expect(envelope.payload.value.mediaRefs.map((reference) => reference.blobId)).toEqual([
      'cid:image-1',
      'cid:image-2',
    ]);
    expect(envelope.payload.value.mediaRefs.every((reference) => !('file' in reference))).toBe(true);
    expect(readMomentDraftEnvelope(envelope)).toEqual({
      text: 'Draft with uploads',
      audienceKind: Audience_Kind.FOLLOWERS,
      mediaRefs: ['cid:image-1', 'cid:image-2'],
      savedAtMs: 1_700_000_000_000,
    });
  });

  it('accepts delivery only for the exact Station and actor consumer scope', () => {
    const envelope = buildMomentDraftEnvelope(
      {
        stationPeerId: 'station-1',
        actorPtid: 'ptid:alice',
      },
      {
        text: 'Scoped draft',
        audienceKind: Audience_Kind.PUBLIC,
        mediaRefs: [],
      },
      1_700_000_000_000,
    );

    expect(readOwnedMomentDraftEnvelope(envelope, {
      stationPeerId: 'station-1',
      actorPtid: 'ptid:alice',
    }).text).toBe('Scoped draft');
    expect(() => readOwnedMomentDraftEnvelope(envelope, {
      stationPeerId: 'station-2',
      actorPtid: 'ptid:alice',
    })).toThrow('mobile.reliability.draftScopeMismatch');
  });

  it('persists the complete draft through the generated exact-scope envelope', async () => {
    const save = vi.fn(async () => undefined);

    await persistMomentDraft(
      { save },
      {
        stationPeerId: 'station-1',
        actorPtid: 'ptid:alice',
      },
      {
        text: 'Keep this after a failed publish',
        audienceKind: Audience_Kind.FOLLOWERS,
        mediaRefs: ['cid:successful-upload'],
      },
      1_700_000_000_000,
    );

    expect(save).toHaveBeenCalledOnce();
    expect(readMomentDraftEnvelope(save.mock.calls[0][0])).toEqual({
      text: 'Keep this after a failed publish',
      audienceKind: Audience_Kind.FOLLOWERS,
      mediaRefs: ['cid:successful-upload'],
      savedAtMs: 1_700_000_000_000,
    });
  });

  it('propagates save failure so the hook can retain a retryable failure', async () => {
    await expect(persistMomentDraft(
      {
        save: vi.fn(async () => {
          throw new Error('draft store unavailable');
        }),
      },
      {
        stationPeerId: 'station-1',
        actorPtid: 'ptid:alice',
      },
      {
        text: 'Still editing',
        audienceKind: Audience_Kind.PUBLIC,
        mediaRefs: [],
      },
      1_700_000_000_000,
    )).rejects.toThrow('draft store unavailable');
  });

  it('discards only the exact Moment composer draft scope', async () => {
    const remove = vi.fn(async () => false);

    await discardMomentDraft(
      { remove },
      {
        stationPeerId: 'station-1',
        actorPtid: 'ptid:alice',
      },
    );

    expect(remove).toHaveBeenCalledExactlyOnceWith(
      'station-1',
      'ptid:alice',
      MobileDraftSurfaceKind.MOMENT_COMPOSER,
      'compose',
    );
  });
});
