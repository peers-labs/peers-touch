import type { Post, ReactionSummary } from '../gen/proto/domain/social/post_pb';
import type { TimelineSort } from '../services/social_api';

/** Compose the two acquired feed windows without changing either source's cursor. */
export function selectMomentsTimeline(homeIds: readonly string[], publicIds: readonly string[],
  postsById: Readonly<Record<string, Post>>, sort: TimelineSort,
  reactionsByPost: Readonly<Record<string, ReactionSummary[]>> = {}): Post[] {
  const seen = new Set<string>();
  const posts: Post[] = [];
  for (const id of [...homeIds, ...publicIds]) {
    const post = postsById[id];
    if (!post || post.isDeleted) continue;
    const identity = post.publicFeedRef || post.id;
    if (seen.has(identity)) continue;
    seen.add(identity); posts.push(post);
  }
  const time = (post: Post) => Number(post.createdAt?.seconds ?? 0n) * 1000 + Number(post.createdAt?.nanos ?? 0) / 1_000_000;
  const reactions = (post: Post) => (reactionsByPost[post.id] ?? post.reactions)
    .reduce((total, reaction) => total + Number(reaction.count), 0);
  return posts.sort((a, b) => (sort === 'hot' ? reactions(b) - reactions(a) : 0)
    || time(b) - time(a) || a.id.localeCompare(b.id));
}

export function momentSearchText(post: Post): string {
  const content = post.content;
  const text = content.case === 'repostPost' ? content.value.comment : content.case ? content.value.text : '';
  return [text, post.author?.displayName, post.author?.username, post.author?.homeStationDomain].filter(Boolean).join('\n').toLocaleLowerCase();
}
