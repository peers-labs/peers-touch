import { demoAvatarUrls, demoMediaBackgrounds, demoMoments } from '../data';
import type { Moment, MomentComment } from '../types';

const PEOPLE = [
  { name: 'Bob Zhang', avatar: 'BZ', avatarUrl: demoAvatarUrls.bob },
  { name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol },
  { name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma },
  { name: 'David Wu', avatar: 'DW', avatarUrl: demoAvatarUrls.david },
];

const EXTRA_COMMENTS: MomentComment[] = Array.from({ length: 10 }, (_, index) => ({
  id: `extra-${index + 1}`,
  name: PEOPLE[index % PEOPLE.length].name,
  avatar: PEOPLE[index % PEOPLE.length].avatar,
  avatarUrl: PEOPLE[index % PEOPLE.length].avatarUrl,
  text: `A concise follow-up on the launch, note ${index + 1}.`,
  time: `${index + 2}h`,
}));

export function preparedMomentsData(): Moment[] {
  const base = demoMoments.map((moment, index) => ({
    ...moment,
    source: index === 0 ? 'alice.station' : 'bob.remote',
    audience: index === 0 ? 'Friends' : 'Public',
    reason: index === 0 ? 'You are friends' : 'Explore',
    remote: index !== 0,
    contentKind: moment.images?.length ? 'image' as const : 'text' as const,
    comments: index === 0 ? [...moment.comments, ...EXTRA_COMMENTS] : moment.comments,
  }));
  return [
    ...base,
    {
      id: 'mo-poll', name: 'Grace Kim', avatar: 'GK', avatarUrl: demoAvatarUrls.grace, time: '3 days ago',
      text: 'Help us choose the next community meetup format.',
      source: 'grace.remote', audience: 'Followers', reason: 'You follow Grace', remote: true,
      contentKind: 'poll', poll: { question: 'Which format works best?', options: ['Workshop', 'Open space', 'Lightning talks'],
        minChoices: 1, maxChoices: 2, confirmedChoices: [], voteCounts: [0, 0, 0], voterCount: 0, closed: false },
      likes: 12, reactionCounts: { love: 12 }, comments: [],
    },
    {
      id: 'mo-link', name: 'David Wu', avatar: 'DW', avatarUrl: demoAvatarUrls.david, time: '4 days ago',
      text: 'A practical guide to resilient federation.',
      source: 'alice.station', audience: 'Public', reason: 'Explore',
      contentKind: 'link', link: { title: 'Building resilient federated networks', url: 'peers.example/research/federation' },
      likes: 18, reactionCounts: { love: 18 }, comments: [],
    },
    {
      id: 'mo-location', name: 'Emma Liu', avatar: 'EL', avatarUrl: demoAvatarUrls.emma, time: '5 days ago',
      text: 'A quiet place for the next design walk.',
      source: 'eve.remote', audience: 'Friends', reason: 'You are friends', remote: true,
      contentKind: 'location', location: { name: 'Waterfront Park', address: '18 Harbor Walk' },
      likes: 21, reactionCounts: { love: 21 }, comments: [],
    },
    {
      id: 'mo-repost', name: 'Bob Lee', avatar: 'BL', time: '6 days ago',
      text: 'Worth reading before our architecture review.',
      source: 'bob.remote', audience: 'Friends', reason: 'You are friends', remote: true,
      contentKind: 'repost', repost: { author: 'Alice Chen', text: 'A short note on keeping one source of truth across client projections.' },
      likes: 9, reactionCounts: { love: 9 }, comments: [],
    },
    {
      id: 'mo-video', name: 'Carol Li', avatar: 'CL', avatarUrl: demoAvatarUrls.carol, time: '1 week ago',
      text: 'Prototype walkthrough from this morning.',
      source: 'alice.station', audience: 'Circle', reason: 'Studio circle',
      contentKind: 'video', videoLabel: '01:42', likes: 16, reactionCounts: { love: 16 }, comments: [],
    },
  ];
}

// Re-export media backgrounds for the composer.
export { demoMediaBackgrounds, demoAvatarUrls };
