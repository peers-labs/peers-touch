import { useSocialStore } from './socialStore';

export async function dispatchFollowUser(targetPtid: string): Promise<void> {
  await useSocialStore.getState().followUser(targetPtid);
}

export async function dispatchUnfollowUser(targetPtid: string): Promise<void> {
  await useSocialStore.getState().unfollowUser(targetPtid);
}
