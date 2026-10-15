import { demoMoments } from './data';
import type { Moment } from './types';

export type SocialTab = 'feed' | 'explore' | 'circles';

export type SocialView =
  | { kind: 'tab'; tab: SocialTab }
  | { kind: 'detail'; momentId: string; from: SocialTab; returnTo: 'tab' | 'search' }
  | { kind: 'search'; from: SocialTab }
  | { kind: 'circle-manage'; from: 'circles' }
  | { kind: 'circle-detail'; circleId: string; from: 'circles' };

export type Circle = {
  id: string;
  name: string;
  description: string;
  memberKeys: string[];
};

export type MomentsPageState = {
  moments: Moment[];
  view: SocialView;
  sort: 'recent' | 'hot';
  searchQuery: string;
  followed: Set<string>;
  commentDrafts: Record<string, string>;
  expandedCommentIds: Set<string>;
  circles: Circle[];
  refreshRevision: number;
  lastRefreshedAt: number | null;
};

export function createInitialMomentsPageState(): MomentsPageState {
  return {
    moments: demoMoments,
    view: { kind: 'tab', tab: 'feed' },
    sort: 'recent',
    searchQuery: '',
    followed: new Set(['carol', 'emma']),
    commentDrafts: {},
    expandedCommentIds: new Set(),
    circles: [
      {
        id: 'close-friends',
        name: 'Close Friends',
        description: 'People I know personally.',
        memberKeys: ['carol', 'emma'],
      },
      {
        id: 'design',
        name: 'Design peers',
        description: 'Product and design collaborators.',
        memberKeys: ['carol', 'emma'],
      },
    ],
    refreshRevision: 0,
    lastRefreshedAt: null,
  };
}
