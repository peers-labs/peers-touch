import { useEffect, useId, useState, type ReactNode } from 'react';
import { Button } from './actions';
import { Checkbox, Radio } from './selection';
import './moments.css';

export interface MomentPollProps {
  postId: string;
  question: string;
  options: readonly { text: string; votes?: bigint | number }[];
  minChoices: number;
  maxChoices: number;
  confirmedChoices: readonly number[];
  totalVotes?: bigint | number;
  closed: boolean;
  disabled?: boolean;
  pending?: boolean;
  unresolved?: boolean;
  status?: ReactNode;
  error?: ReactNode;
  onSubmit?: (options: number[]) => void;
  onRetry?: () => void;
  copy: {
    submit: string; replace: string; cancel: string; retry: string; closed: string;
    choices: (minimum: number, maximum: number) => string;
    total: (votes: string) => string;
  };
}

/** Only unsubmitted choices are local. Counts and command state are owner-qualified props. */
export function MomentPoll({ postId, question, options, minChoices, maxChoices, confirmedChoices,
  totalVotes, closed, disabled, pending, unresolved, status, error, onSubmit, onRetry, copy }: MomentPollProps) {
  const name = useId(), description = useId();
  const confirmedKey = confirmedChoices.join(',');
  const [selected, setSelected] = useState<number[]>(() => [...confirmedChoices]);
  useEffect(() => { setSelected(confirmedKey ? confirmedKey.split(',').map(Number) : []); }, [confirmedKey]);
  const frozen = disabled || closed || pending || unresolved || !onSubmit;
  const changed = selected.join(',') !== confirmedKey;
  const valid = selected.length >= minChoices && selected.length <= maxChoices;
  const toggle = (index: number, checked: boolean) => setSelected(old => maxChoices === 1 ? [index]
    : checked ? [...old, index].sort((a, b) => a - b) : old.filter(value => value !== index));
  return <section className="sk-poll" data-acceptance-id="social-poll" data-post-id={postId}
    data-poll-state={pending ? 'pending' : unresolved ? 'unresolved' : closed ? 'closed' : 'ready'}
    aria-label={question} aria-busy={pending || undefined}>
    <strong>{question}</strong>
    <span id={description} className="sk-poll-meta">{closed ? copy.closed : copy.choices(minChoices, maxChoices)}</span>
    <div className="sk-poll-options" role={maxChoices === 1 ? 'radiogroup' : 'group'}
      aria-label={question} aria-describedby={description}>
      {options.map((option, index) => {
        const Control = maxChoices === 1 ? Radio : Checkbox;
        return <div className="sk-poll-option" key={index} data-poll-option={index}>
          <Control name={name} checked={selected.includes(index)} disabled={frozen}
            aria-label={option.text} label={option.text}
            onChange={event => toggle(index, event.target.checked)} />
          {option.votes !== undefined && <span className="sk-poll-count" data-poll-count={String(option.votes)}>
            {String(option.votes)}
          </span>}
        </div>;
      })}
    </div>
    {totalVotes !== undefined && <span className="sk-poll-meta" data-poll-voters={String(totalVotes)}>
      {copy.total(String(totalVotes))}
    </span>}
    <div className="sk-poll-actions">
      {!closed && onSubmit && <Button actionId={`moment.poll.submit.${postId}`} emphasis="primary" density="compact"
        label={confirmedChoices.length ? copy.replace : copy.submit} execution={pending ? 'pending' : 'idle'}
        data-acceptance-id="social-poll-submit"
        availability={frozen || !valid || !changed ? { kind: 'disabled', reason: copy.choices(minChoices, maxChoices) } : undefined}
        onActivate={() => onSubmit([...selected])} />}
      {changed && !pending && !unresolved && <Button actionId={`moment.poll.cancel.${postId}`}
        emphasis="quiet" density="compact" label={copy.cancel} onActivate={() => setSelected([...confirmedChoices])} />}
      {onRetry && !pending && <Button actionId={`moment.poll.retry.${postId}`} emphasis="quiet" density="compact"
        label={copy.retry} data-acceptance-id="social-poll-retry" onActivate={onRetry} />}
    </div>
    {status && <span className="sk-poll-meta" role="status">{status}</span>}
    {error && <span className="sk-poll-meta" role="alert">{error}</span>}
  </section>;
}
