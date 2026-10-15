import { readFileSync } from 'node:fs';
import { create } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';
import {
  Audience_Kind,
  AudienceSchema,
  type Audience,
} from '../../gen/proto/domain/social/post_pb';
import {
  audienceMayReachRemote,
  isAudienceSelectionComplete,
} from '../../components/moments/audienceSelection';

function audience(
  kind: Audience_Kind,
  fields: {
    target?: Audience['target'];
    actorPtids?: string[];
    baseKind?: Audience_Kind;
  } = {},
): Audience {
  return create(AudienceSchema, {
    kind,
    target: fields.target ?? { case: undefined },
    actorPtids: fields.actorPtids ?? [],
    baseKind: fields.baseKind ?? Audience_Kind.KIND_UNSPECIFIED,
  });
}

describe('federated private audience matrix', () => {
  it('accepts every complete v1 private audience shape', () => {
    const complete = [
      audience(Audience_Kind.FRIENDS),
      audience(Audience_Kind.FOLLOWERS),
      audience(Audience_Kind.CIRCLE, {
        target: { case: 'circleId', value: 42n },
      }),
      audience(Audience_Kind.GROUP, {
        target: {
          case: 'groupConversationId',
          value: 'group-conversation',
        },
      }),
      audience(Audience_Kind.CUSTOM_ALLOW, {
        actorPtids: ['ptid:bob'],
      }),
      audience(Audience_Kind.CUSTOM_DENY, {
        actorPtids: ['ptid:eve'],
        baseKind: Audience_Kind.FOLLOWERS,
      }),
    ];
    expect(complete.every(isAudienceSelectionComplete)).toBe(true);
  });

  it('rejects incomplete typed targets and custom lists', () => {
    const incomplete = [
      audience(Audience_Kind.CIRCLE),
      audience(Audience_Kind.GROUP),
      audience(Audience_Kind.CUSTOM_ALLOW),
      audience(Audience_Kind.CUSTOM_DENY, {
        actorPtids: ['ptid:eve'],
        baseKind: Audience_Kind.PUBLIC,
      }),
    ];
    expect(incomplete.every((candidate) => (
      !isAudienceSelectionComplete(candidate)
    ))).toBe(true);
  });

  it('selects remote readiness for every audience that can reach a remote actor', () => {
    const context = {
      remoteFriendPtids: new Set(['ptid:bob']),
      remoteFollowerPtids: new Set(['ptid:bob', 'ptid:eve']),
      selectedCircleMemberPtids: ['ptid:local', 'ptid:bob'],
      selectedGroupHasRemote: true,
    };
    expect(audienceMayReachRemote(
      audience(Audience_Kind.FRIENDS),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.FOLLOWERS),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.CIRCLE, {
        target: { case: 'circleId', value: 42n },
      }),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.GROUP, {
        target: {
          case: 'groupConversationId',
          value: 'group-conversation',
        },
      }),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.CUSTOM_ALLOW, {
        actorPtids: ['ptid:bob'],
      }),
      context,
    )).toBe(true);
    expect(audienceMayReachRemote(
      audience(Audience_Kind.CUSTOM_DENY, {
        actorPtids: ['ptid:eve'],
        baseKind: Audience_Kind.FOLLOWERS,
      }),
      context,
    )).toBe(true);
  });

  it('keeps a fully local Group on the generic private readiness path', () => {
    expect(audienceMayReachRemote(
      audience(Audience_Kind.GROUP, {
        target: {
          case: 'groupConversationId',
          value: 'local-group',
        },
      }),
      {
        remoteFriendPtids: new Set(),
        remoteFollowerPtids: new Set(),
        selectedCircleMemberPtids: [],
        selectedGroupHasRemote: false,
      },
    )).toBe(false);
  });

  it('keeps candidate data in the owning runtimes and exposes stable selectors', () => {
    const picker = readFileSync(
      new URL('../../components/moments/AudiencePicker.tsx', import.meta.url),
      'utf8',
    );
    const descriptor = readFileSync(
      new URL('./MomentsApp.descriptor.tsx', import.meta.url),
      'utf8',
    );
    const socialRuntime = readFileSync(
      new URL('../../services/socialRealtime.ts', import.meta.url),
      'utf8',
    );
    const relationshipsStore = readFileSync(
      new URL('../../store/relationships.ts', import.meta.url),
      'utf8',
    );

    expect(picker).toContain('data-moments-audience-kind');
    expect(picker).toContain('data-moments-audience-target="circle"');
    expect(picker).toContain('data-moments-audience-target="group"');
    expect(picker).toContain('data-moments-audience-actors');
    expect(picker).toContain('baseKind: kind === Audience_Kind.CUSTOM_DENY');
    expect(descriptor).toContain("runtimes: ['moments', 'social', 'messaging']");
    expect(socialRuntime).toContain(
      'loadMutualFriends(actorPtid, refresh)',
    );
    expect(relationshipsStore).toContain('[normalizedActorPtid]: {');
    expect(relationshipsStore).toContain('generation !== relationshipsGeneration');
  });
});
