import { Audience_Kind, type Post, type ReactionSummary } from '../gen/proto/domain/social/post_pb';
import { isReadablePrivateMomentProjection, type PrivateMomentProjection } from '../services/privateMomentsNative';
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

export interface MomentSearchIdentity {
  actorPtid: string;
  displayName?: string;
  username?: string;
  homeStationName?: string;
  homeStationDomain?: string;
}

export function momentSearchText(post: Post, projection?: PrivateMomentProjection,
  identity?: MomentSearchIdentity): string {
  const content = post.content;
  const audience = post.audience?.kind;
  const isPrivate = audience !== undefined && audience !== Audience_Kind.PUBLIC
    && audience !== Audience_Kind.KIND_UNSPECIFIED;
  const privateContent = projection?.postId === post.id && projection.authorPtid === post.authorPtid
    && projection.audienceKind !== 'UNKNOWN' && isReadablePrivateMomentProjection(projection)
    ? projection.content : undefined;
  const text = isPrivate
    ? privateContent?.kind === 'REPOST' ? privateContent.comment : privateContent?.text
    : content.case === 'repostPost' ? content.value.comment : content.case ? content.value.text : '';
  const authorPtid = post.authorPtid || post.author?.id || '';
  const author = identity?.actorPtid === authorPtid ? identity : undefined;
  return [text, author?.displayName, author?.username, author?.homeStationName,
    author?.homeStationDomain].filter(Boolean).join('\n').toLocaleLowerCase();
}
