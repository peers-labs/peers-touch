import { useTranslation } from 'react-i18next';
import { MomentPoll as PeerMomentPoll } from '@peers-touch/ui';
import { ReactionKind, type Post } from '../../gen/proto/domain/social/post_pb';
import { useActiveMomentsSlice } from './useActiveMomentsStore';
import { pollErrorKey } from '../../services/pollCommandState';
import { privateReactionTargetKey } from '../../services/privateMomentsNative';
import { usePrivateMomentsStore } from '../../store/privateMoments';

export function MomentPoll({ post }: { post: Post }) {
  const { t } = useTranslation('moments');
  const { command, vote, retry } = useActiveMomentsSlice(state => ({
    command: state.pollCommands[post.id], vote: state.votePoll, retry: state.retryPoll,
  }));
  const privateContent = usePrivateMomentsStore(state => state.postsById[post.id]?.content);
  const privateCommand = usePrivateMomentsStore(state =>
    state.reactionCommands[privateReactionTargetKey(post.id, '', ReactionKind.REACTION_UNSPECIFIED)]);
  const privatePoll = privateContent?.kind === 'POLL' ? privateContent : undefined;
  const publicPoll = post.content.case === 'pollPost' ? post.content.value : undefined;
  const poll = privatePoll ?? publicPoll?.poll;
  if (!poll) return null;
  const result = publicPoll?.result;
  const state = privatePoll
    ? privateCommand && ({ REACTION_PENDING: privateCommand.commandId ? 'unknown' : 'pending', REACTION_RETRYING: 'pending',
        REACTION_REJECTED: 'rejected', REACTION_COMMITTED: 'committed' } as const)[privateCommand.state]
    : command?.state;
  const unresolved = Boolean(state && ['unknown', 'admission', 'readback'].includes(state));
  return <PeerMomentPoll postId={post.id} question={poll.question}
    options={poll.options.map((text, index) => ({ text, votes: privatePoll?.result
      ? BigInt(privatePoll.result.voteCounts[index]) : result?.options[index]?.votes }))}
    minChoices={poll.minChoices} maxChoices={poll.maxChoices}
    confirmedChoices={privatePoll?.result?.selectedOptions ?? result?.userVotes ?? []}
    totalVotes={privatePoll?.result ? BigInt(privatePoll.result.voterCount) : result?.totalVotes}
    closed={privatePoll ? privatePoll.expiresAtSeconds * 1000 <= Date.now() : result?.isExpired ?? false}
    disabled={post.isDeleted || (privatePoll ? !privatePoll.opaqueOptionIds?.length : !post.publicFeedRef)}
    pending={state === 'pending'} unresolved={unresolved}
    status={state && state !== 'rejected' ? t(`moments.poll.state.${state}`) : undefined}
    error={state === 'rejected' ? t(pollErrorKey(privatePoll ? privateCommand?.errorCode : command?.error)) : undefined}
    onSubmit={options => { void vote(post.id, options).catch(() => undefined); }}
    onRetry={unresolved ? () => { void retry(post.id).catch(() => undefined); } : undefined}
    copy={{ submit: t('moments.poll.submit'), replace: t('moments.poll.replace'),
      cancel: t('moments.poll.cancel'), retry: t('moments.poll.retry'), closed: t('moments.poll.closed'),
      choices: (min, max) => t('moments.poll.choices', { min, max }),
      total: votes => t('moments.poll.total', { votes }) }} />;
}
