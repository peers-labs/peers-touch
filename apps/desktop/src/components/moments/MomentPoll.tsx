import { useTranslation } from 'react-i18next';
import { MomentPoll as PeerMomentPoll } from '@peers-touch/ui';
import type { Post } from '../../gen/proto/domain/social/post_pb';
import { useActiveMomentsSlice } from './useActiveMomentsStore';
import { pollErrorKey } from '../../services/pollCommandState';

export function MomentPoll({ post }: { post: Post }) {
  const { t } = useTranslation('moments');
  const { command, vote, retry } = useActiveMomentsSlice(state => ({
    command: state.pollCommands[post.id], vote: state.votePoll, retry: state.retryPoll,
  }));
  if (post.content.case !== 'pollPost' || !post.content.value.poll) return null;
  const { poll, result } = post.content.value;
  const unresolved = command && ['unknown', 'admission', 'readback'].includes(command.state);
  return <PeerMomentPoll postId={post.id} question={poll.question}
    options={poll.options.map((text, index) => ({ text, votes: result?.options[index]?.votes }))}
    minChoices={poll.minChoices} maxChoices={poll.maxChoices} confirmedChoices={result?.userVotes ?? []}
    totalVotes={result?.totalVotes} closed={result?.isExpired ?? false}
    disabled={!post.publicFeedRef || post.isDeleted} pending={command?.state === 'pending'} unresolved={Boolean(unresolved)}
    status={command && command.state !== 'rejected' ? t(`moments.poll.state.${command.state}`) : undefined}
    error={command?.state === 'rejected' ? t(pollErrorKey(command.error)) : undefined}
    onSubmit={options => { void vote(post.id, options).catch(() => undefined); }}
    onRetry={unresolved ? () => { void retry(post.id).catch(() => undefined); } : undefined}
    copy={{ submit: t('moments.poll.submit'), replace: t('moments.poll.replace'),
      cancel: t('moments.poll.cancel'), retry: t('moments.poll.retry'), closed: t('moments.poll.closed'),
      choices: (min, max) => t('moments.poll.choices', { min, max }),
      total: votes => t('moments.poll.total', { votes }) }} />;
}
