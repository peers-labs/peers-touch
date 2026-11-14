import { create, toBinary } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { FeedPollDefinitionSchema, type FeedPollDefinition } from '../gen/proto/domain/social/feed_log_pb';
import { type CreatePollPostRequest } from '../gen/proto/domain/social/post_pb';
import { PollResultSchema, PollOptionResultSchema, type PollResult } from '../gen/proto/domain/social/poll_pb';

// Pure projection rules. Native authenticates original definitions and Home
// admissions; the original PublicFeedProjection owns all disposable maps.
export function publicPollDefinition(request: CreatePollPostRequest, createdAt: bigint): FeedPollDefinition {
  const minimum = request.minChoices || 1;
  const maximum = request.maxChoices || (request.multipleChoice ? request.options.length : 1);
  const explicit = request.expiresAtUnixMs;
  if (createdAt <= 0n || explicit < 0n
    || (explicit > 0n && request.durationHours !== 0)
    || (explicit === 0n && (request.durationHours < 1 || request.durationHours > 720))
    || !Number.isInteger(request.durationHours) || !Number.isInteger(minimum) || !Number.isInteger(maximum)
    || minimum < 1 || maximum < minimum || maximum > request.options.length
    || request.multipleChoice !== (maximum > 1) || request.options.length < 2 || request.options.length > 10
    || !request.question || request.question.trim() !== request.question
    || new TextEncoder().encode(request.question).length > 1000) {
    throw new Error('FEED_INVALID');
  }
  const distinct = new Set<string>();
  for (const option of request.options) {
    if (!option || option.trim() !== option || new TextEncoder().encode(option).length > 500 || distinct.has(option)) {
      throw new Error('FEED_INVALID');
    }
    distinct.add(option);
  }
  const expires = explicit || createdAt + BigInt(request.durationHours) * 3_600_000n;
  if (expires <= createdAt || expires - createdAt > 30n * 24n * 3_600_000n) throw new Error('FEED_INVALID');
  return create(FeedPollDefinitionSchema, { question: request.question, options: [...request.options],
    minChoices: minimum, maxChoices: maximum, expiresAtUnixMs: expires });
}

export async function publicPollDefinitionHash(definition: FeedPollDefinition): Promise<Uint8Array> {
  const domain = new TextEncoder().encode('peers-touch/social-feed/poll-definition/v1\0');
  const wire = toBinary(FeedPollDefinitionSchema, definition);
  const bytes = new Uint8Array(domain.length + wire.length);
  bytes.set(domain);
  bytes.set(wire, domain.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export type PublicPollBallotVersion = {
  postRef: string; actor: string; sequence: bigint; options: readonly number[];
};

export function publicPollResult(definition: FeedPollDefinition, postRef: string, viewer: string,
  ballots: Iterable<PublicPollBallotVersion>, now: number): PollResult {
  const counts = definition.options.map(() => 0n);
  const actors = new Set<string>();
  let viewerChoices: number[] = [];
  for (const ballot of ballots) {
    if (ballot.postRef !== postRef) continue;
    if (!ballot.actor || actors.has(ballot.actor) || ballot.sequence <= 0n
      || ballot.options.length < definition.minChoices || ballot.options.length > definition.maxChoices) {
      throw new Error('FEED_INVALID_RESPONSE');
    }
    let previous = -1;
    for (const option of ballot.options) {
      if (!Number.isInteger(option) || option <= previous || option < 0 || option >= counts.length) {
        throw new Error('FEED_INVALID_RESPONSE');
      }
      counts[option]++;
      previous = option;
    }
    actors.add(ballot.actor);
    if (ballot.actor === viewer) viewerChoices = [...ballot.options];
  }
  const expiresAt = new Date(Number(definition.expiresAtUnixMs));
  if (!Number.isSafeInteger(now) || !Number.isFinite(expiresAt.getTime())) throw new Error('FEED_INVALID_RESPONSE');
  return create(PollResultSchema, { postId: postRef, totalVotes: BigInt(actors.size),
    options: definition.options.map((text, index) => create(PollOptionResultSchema, {
      index, text, votes: counts[index], percentage: actors.size ? Number(counts[index]) / actors.size * 100 : 0,
    })),
    hasVoted: viewerChoices.length > 0, userVotes: viewerChoices, expiresAt: timestampFromDate(expiresAt),
    isExpired: BigInt(now) >= definition.expiresAtUnixMs });
}
