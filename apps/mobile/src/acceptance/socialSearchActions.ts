import { readActiveMobileSocialFacade } from '../features/social/mobileSocialFacade';
import { useAuthStore } from '../features/auth/authStore';
import { blockSocialUser, unblockSocialUser } from '../features/social/socialRuntime';

export interface MobileSocialSearchAcceptanceContracts {
  'moments.delete': {
    input: { postId: string };
    output: { postId: string; deleted: boolean };
  };
  'social.block': { input: { actorPtid: string }; output: { actorPtid: string } };
  'social.unblock': { input: { actorPtid: string }; output: { actorPtid: string } };
}

// Fixture mutation through the original Social intent; Search has no write port.
export const mobileSocialSearchAcceptanceActions = {
  'social.block': async ({ actorPtid }: { actorPtid: string }) => {
    if (!actorPtid || actorPtid.trim() !== actorPtid) throw new Error('acceptance.mobile.invalidActor');
    await blockSocialUser(actorPtid);
    return { actorPtid };
  },
  'social.unblock': async ({ actorPtid }: { actorPtid: string }) => {
    if (!actorPtid || actorPtid.trim() !== actorPtid) throw new Error('acceptance.mobile.invalidActor');
    await unblockSocialUser(actorPtid);
    return { actorPtid };
  },
  'moments.delete': async ({ postId }: { postId: string }) => {
    if (!postId || postId.trim() !== postId) throw new Error('acceptance.mobile.invalidPostId');
    const facade = readActiveMobileSocialFacade(useAuthStore.getState().session);
    if (!facade) throw new Error('acceptance.mobile.activeSocialFacadeRequired');
    return { postId, deleted: await facade.intents.deleteMoment(postId) };
  },
};
