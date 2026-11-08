import { MomentPoll as PeerMomentPoll } from '@peers-touch/ui';
import '@peers-touch/ui/styles.css';
import { useMobileI18n } from '../../app/mobileI18n';
import { useSocialExperience } from '../../features/social/useSocialExperience';
import { ReactionKind, type Post } from '../../gen/proto/domain/social/post_pb';
import { privateReactionTargetKey } from '../../runtimes/privateMomentsRuntime';

function errorKey(code?: string): string {
  if (code?.includes('POLL_CLOSED')) return 'moments.poll.closedError';
  if (code?.includes('INVALID_SELECTION')) return 'moments.poll.selectionError';
  if (code?.includes('DEFINITION')) return 'moments.poll.definitionChanged';
  if (code?.includes('NOT_A_POLL') || code?.includes('NOT_AUTHORIZED') || code?.includes('REVOKED')) return 'moments.poll.unavailable';
  return 'moments.poll.retryError';
}

export function MomentPoll({ post }: { post: Post }) {
  const { t } = useMobileI18n();
  const { facade, projection } = useSocialExperience();
  const privateSocial = projection?.runtime.privateSocial;
  const content = privateSocial?.postsById[post.id]?.content;
  const privatePoll = content?.kind === 'POLL' ? content : undefined;
  const publicPoll = post.content.case === 'pollPost' ? post.content.value : undefined;
  const poll = privatePoll ?? publicPoll?.poll;
  if (!poll) return null;
  const key = privateReactionTargetKey(post.id, '', ReactionKind.REACTION_UNSPECIFIED);
  const command = privateSocial?.reactionCommands.find(value => value.postId === post.id && value.operation === 'VOTE_POLL');
  const pending = privateSocial?.reactionPendingTargets.includes(key) || command?.state === 'REACTION_RETRYING';
  const unresolved = command?.state === 'REACTION_UNKNOWN_OUTCOME' || command?.state === 'REACTION_PENDING';
  const rejected = command?.state === 'REACTION_REJECTED';
  const state = pending ? 'pending' : unresolved ? 'unknown' : command?.state === 'REACTION_COMMITTED' ? 'committed' : undefined;
  const localError = privateSocial?.reactionErrorsByTarget[key];
  return <PeerMomentPoll postId={post.id} question={poll.question}
    options={poll.options.map((text, index) => ({ text,
      votes: privatePoll?.result ? BigInt(privatePoll.result.voteCounts[index]) : publicPoll?.result?.options[index]?.votes }))}
    minChoices={poll.minChoices} maxChoices={poll.maxChoices}
    confirmedChoices={privatePoll?.result?.selectedOptions ?? publicPoll?.result?.userVotes ?? []}
    totalVotes={privatePoll?.result ? BigInt(privatePoll.result.voterCount) : publicPoll?.result?.totalVotes}
    closed={privatePoll ? privatePoll.expiresAtSeconds * 1000 <= Date.now() : publicPoll?.result?.isExpired ?? false}
    disabled={post.isDeleted || !privatePoll?.opaqueOptionIds?.length || !facade}
    pending={Boolean(pending)} unresolved={Boolean(unresolved)}
    status={state ? t(`moments.poll.state.${state}`) : undefined}
    error={rejected || localError ? t(errorKey(command?.errorCode ?? localError)) : undefined}
    onSubmit={privatePoll && facade ? options => { void facade.intents.votePoll(post.id, options).catch(() => undefined); } : undefined}
    onRetry={unresolved && facade ? () => { void facade.intents.retryPoll(post.id).catch(() => undefined); } : undefined}
    copy={{ submit: t('moments.poll.submit'), replace: t('moments.poll.replace'), cancel: t('moments.poll.cancel'),
      retry: t('moments.poll.retry'), closed: t('moments.poll.closed'),
      choices: (min, max) => t('moments.poll.choices', { min, max }),
      total: votes => t('moments.poll.total', { votes }) }} />;
}
