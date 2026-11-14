import { useSessionStore } from '../../store/session';
import { useSocialChatStore } from '../../store/socialChat';
import { useMomentsStore } from '../../store/moments';
import { usePrivateMomentsStore } from '../../store/privateMoments';
import { resolveFederationStationName, useFederationStore } from '../../store/federation';
import { actorDisplayName } from '../../store/socialProfileProjection';
import { reconcileMomentsProjection } from '../../runtimes/momentsRuntime';

function requireNativeScope(): void {
  const actorPtid = useSessionStore.getState().currentUser?.actorPtid;
  const privateState = usePrivateMomentsStore.getState();
  if (!actorPtid || privateState.platform !== 'native'
    || privateState.scope.actorPtid !== actorPtid) {
    throw new Error('moments.acceptance.nativeScopeMissing');
  }
}

/** Supporting input authority; the Social UI owner asserts actual search results. */
export async function feedSearchIdentities(input: { postIds: string[] }) {
  requireNativeScope();
  if (!Array.isArray(input?.postIds) || !input.postIds.length
    || input.postIds.some(id => !id?.trim())) {
    throw new Error('moments.acceptance.postIdMissing');
  }
  const posts = useMomentsStore.getState().postsById;
  const chat = useSocialChatStore.getState();
  const federation = useFederationStore.getState();
  const currentUserPtid = chat.currentUserPtid
    || useSessionStore.getState().currentUser?.actorPtid;
  return {
    identities: input.postIds.map(postId => {
      const post = posts[postId];
      const actorPtid = post?.authorPtid || post?.author?.id;
      if (!actorPtid) throw new Error('moments.acceptance.authorIdentityMissing');
      const isSelf = actorPtid === currentUserPtid;
      const profile = chat.peerProfiles[actorPtid];
      const stationPeerId = isSelf
        ? federation.self?.home_station_peer_id : profile?.home_station_peer_id;
      return {
        postId,
        actorPtid,
        displayName: actorDisplayName(isSelf
          ? chat.currentUserProfile?.displayName : profile?.display_name),
        username: (isSelf ? chat.currentUserProfile?.username : profile?.username) ?? '',
        homeStationName: resolveFederationStationName({
          actorPtid, stationPeerId, actorStationEntries: federation.actorStationEntries,
        }),
        homeStationDomain: (isSelf
          ? federation.self?.home_station_domain : profile?.home_station_domain) ?? '',
      };
    }),
  };
}

/** Exercise the existing missed-event refresh owner, without replacing its state. */
export async function reconcileFeedProjection() {
  requireNativeScope();
  await reconcileMomentsProjection('acceptance-social-feed-stability');
  requireNativeScope();
  return { reconciled: true };
}
