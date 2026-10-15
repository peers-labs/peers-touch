import { Audience_Kind, type Audience } from '../../gen/proto/domain/social/post_pb';

export interface AudienceRemoteContext {
  remoteFriendPtids: ReadonlySet<string>;
  remoteFollowerPtids: ReadonlySet<string>;
  selectedCircleMemberPtids: readonly string[];
  selectedGroupHasRemote: boolean;
}

export function isAudienceSelectionComplete(audience: Audience): boolean {
  switch (audience.kind) {
    case Audience_Kind.CIRCLE:
      return audience.target.case === 'circleId' && audience.target.value > 0n;
    case Audience_Kind.GROUP:
      return audience.target.case === 'groupConversationId'
        && Boolean(audience.target.value.trim());
    case Audience_Kind.CUSTOM_ALLOW:
      return audience.actorPtids.length > 0;
    case Audience_Kind.CUSTOM_DENY:
      return audience.baseKind === Audience_Kind.FOLLOWERS
        && audience.actorPtids.length > 0;
    case Audience_Kind.KIND_UNSPECIFIED:
      return false;
    default:
      return true;
  }
}

export function audienceMayReachRemote(
  audience: Audience,
  context: AudienceRemoteContext,
): boolean {
  switch (audience.kind) {
    case Audience_Kind.FRIENDS:
      return context.remoteFriendPtids.size > 0;
    case Audience_Kind.FOLLOWERS:
      return context.remoteFollowerPtids.size > 0;
    case Audience_Kind.CIRCLE:
      return context.selectedCircleMemberPtids.some(
        (actorPtid) => context.remoteFriendPtids.has(actorPtid)
          || context.remoteFollowerPtids.has(actorPtid),
      );
    case Audience_Kind.GROUP:
      return context.selectedGroupHasRemote;
    case Audience_Kind.CUSTOM_ALLOW:
      return audience.actorPtids.some(
        (actorPtid) => context.remoteFriendPtids.has(actorPtid)
          || context.remoteFollowerPtids.has(actorPtid),
      );
    case Audience_Kind.CUSTOM_DENY: {
      const denied = new Set(audience.actorPtids);
      return [...context.remoteFollowerPtids].some(
        (actorPtid) => !denied.has(actorPtid),
      );
    }
    default:
      return false;
  }
}
