import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from './icon';
import { Button, IconButton } from './actions';
import { Select } from './selection';
import { Field, NumberField, TextField } from './fields';
import { DateTimeField } from './advanced-fields';
import './moments.css';

export interface MomentComposerImage {
  id: string;
  src: string;
  alt: string;
  status?: ReactNode;
  error?: string;
  onRetry?: () => void;
}

/** Drafts, upload decisions and publish commands stay with the consumer. */
export function MomentComposerSurface({ editor, images, toolbar, poll, audience, status, footer,
  onRemoveImage, disabled, copy, className = '', ...props }: HTMLAttributes<HTMLDivElement> & {
  editor: ReactNode; images: readonly MomentComposerImage[]; toolbar: ReactNode;
  audience: ReactNode; poll?: ReactNode; status?: ReactNode; footer: ReactNode; disabled?: boolean;
  onRemoveImage: (id: string) => void; copy: { removeImage: string; retryImage: string };
}) {
  return <div {...props} className={`sk-compose ${className}`}>
    {editor}
    {images.length > 0 && <div className="sk-compose-thumbs" data-compose-image-count={images.length}>
      {images.map((image, index) => <span className="sk-compose-thumb" key={image.id}
        data-upload-error={Boolean(image.error)} aria-busy={Boolean(image.status) && !image.error}>
        <img src={image.src} alt={image.alt} />
        {image.status && <span className="sk-compose-image-status" role="status">{image.status}</span>}
        {image.error && <Button actionId={`compose.image.retry.${index}`} emphasis="quiet"
          className="sk-compose-image-retry" label={copy.retryImage} title={image.error}
          availability={disabled || !image.onRetry ? { kind: 'disabled', reason: image.error } : undefined}
          onActivate={image.onRetry} />}
        <IconButton actionId={`compose.image.remove.${index}`} iconId="close" iconSize={12}
          density="compact" emphasis="quiet" label={copy.removeImage}
          className="sk-compose-thumb-remove"
          availability={disabled ? { kind: 'disabled', reason: copy.removeImage } : undefined}
          onActivate={() => onRemoveImage(image.id)} />
      </span>)}
    </div>}
    <div className="sk-compose-toolbar" data-compose-file-input>{toolbar}</div>
    {poll}
    {audience}
    {status}
    <div className="sk-compose-footer">{footer}</div>
  </div>;
}

export interface MomentPollDraftValue {
  question: string;
  options: string[];
  minChoices: number;
  maxChoices: number;
  expiresAtSeconds: number;
}

export type MomentPollDraftError = 'question' | 'options' | 'choices' | 'expiry';

/** Form validity only. Signing, authorization and source-time admission remain with the consumer. */
export function momentPollDraftError(value: MomentPollDraftValue, now = Date.now()): MomentPollDraftError | undefined {
  const size = (text: string) => new TextEncoder().encode(text).length;
  if (!value.question.trim() || size(value.question.trim()) > 1000) return 'question';
  const options = value.options.map(option => option.trim());
  if (options.length < 2 || options.length > 10 || new Set(options).size !== options.length
    || options.some(option => !option || size(option) > 500)) return 'options';
  if (!Number.isInteger(value.minChoices) || !Number.isInteger(value.maxChoices)
    || value.minChoices < 1 || value.maxChoices < value.minChoices || value.maxChoices > options.length) return 'choices';
  const expiry = value.expiresAtSeconds * 1000;
  if (!Number.isSafeInteger(value.expiresAtSeconds) || expiry <= now || expiry > now + 30 * 86400000) return 'expiry';
}

export function createMomentPollDraft(now = Date.now()): MomentPollDraftValue {
  return { question: '', options: ['', ''], minChoices: 1, maxChoices: 1,
    expiresAtSeconds: Math.floor(now / 1000) + 86400 };
}

function localDateTime(seconds: number): string {
  if (!seconds) return '';
  const date = new Date(seconds * 1000);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Controlled poll draft, composed from the same shared fields as every other composer. */
export function MomentPollComposer({ value, onChange, disabled, error, copy }: {
  value: MomentPollDraftValue; onChange: (value: MomentPollDraftValue) => void; disabled?: boolean; error?: string;
  copy: { question: string; option: (index: number) => string; add: string; remove: string;
    minimum: string; maximum: string; expiry: string; description: string };
}) {
  return <div className="sk-compose-poll" data-acceptance-id="social-poll-composer">
    <Field label={copy.question}><TextField value={value.question} disabled={disabled}
      data-acceptance-id="social-poll-question" onValueChange={question => onChange({ ...value, question })} /></Field>
    {value.options.map((option, index) => <div key={index} className="sk-compose-poll-option">
      <Field label={copy.option(index + 1)}><TextField value={option} disabled={disabled}
        data-acceptance-id={`social-poll-draft-option-${index}`}
        onValueChange={text => onChange({ ...value, options: value.options.map((old, i) => i === index ? text : old) })} /></Field>
      <IconButton actionId={`compose.poll.remove.${index}`} iconId="close" label={copy.remove}
        emphasis="quiet" density="compact"
        availability={disabled || value.options.length <= 2 ? { kind: 'disabled', reason: copy.description } : undefined}
        onActivate={() => {
          const options = value.options.filter((_, i) => i !== index);
          const maxChoices = Math.min(value.maxChoices, options.length);
          onChange({ ...value, options, maxChoices, minChoices: Math.min(value.minChoices, maxChoices) });
        }} />
    </div>)}
    <Button actionId="compose.poll.add-option" label={copy.add} emphasis="quiet" density="compact"
      availability={disabled || value.options.length >= 10 ? { kind: 'disabled', reason: copy.description } : undefined}
      onActivate={() => onChange({ ...value, options: [...value.options, ''] })} />
    <div className="sk-compose-poll-rules">
      <Field label={copy.minimum}><NumberField value={value.minChoices} min={1} max={value.maxChoices} step={1}
        disabled={disabled} data-acceptance-id="social-poll-minimum"
        onValueChange={minChoices => onChange({ ...value, minChoices: minChoices ?? 0 })} /></Field>
      <Field label={copy.maximum}><NumberField value={value.maxChoices} min={value.minChoices} max={value.options.length} step={1}
        disabled={disabled} data-acceptance-id="social-poll-maximum"
        onValueChange={maxChoices => onChange({ ...value, maxChoices: maxChoices ?? 0 })} /></Field>
    </div>
    <DateTimeField label={copy.expiry} value={localDateTime(value.expiresAtSeconds)} disabled={disabled}
      onValueChange={next => onChange({ ...value, expiresAtSeconds: next ? Math.floor(new Date(next).getTime() / 1000) : 0 })} />
    <span className="sk-poll-meta">{copy.description}</span>
    {error && <span className="sk-poll-meta" role="alert">{error}</span>}
  </div>;
}

export interface MomentAudiencePerson { id: string; label: string; avatar?: ReactNode }
export interface MomentAudienceTarget {
  label: string; value?: string; options: readonly { value: string; label: string }[];
  missing: string; onChange: (id: string) => void;
}

/** Controlled audience selection; protocol validity belongs to the original owner. */
export function MomentAudiencePicker({ value, options, onChange, target, people = [],
  actorIds = [], onToggleActor, disabled, copy }: {
  value: string; options: readonly { value: string; label: string }[];
  onChange: (value: string) => void; target?: MomentAudienceTarget;
  people?: readonly MomentAudiencePerson[]; actorIds?: readonly string[];
  onToggleActor?: (id: string) => void; disabled?: boolean;
  copy: { audience: string; people?: string; noPeople?: string };
}) {
  return <div className="sk-compose-audience">
    <Select<string> label={copy.audience} aria-label={copy.audience} data-moments-audience-kind
      options={[...options]} value={value} disabled={disabled}
      onValueChange={next => onChange(String(Array.isArray(next) ? next[0] : next))} />
    {target && (target.options.length ? <Select<string> label={target.label}
      aria-label={target.label} data-moments-audience-target
      options={[...target.options]} value={target.value ?? ''} disabled={disabled}
      onValueChange={next => target.onChange(String(Array.isArray(next) ? next[0] : next))} />
      : <span className="sk-circle-missing">{target.missing}</span>)}
    {onToggleActor && <fieldset className="sk-audience-actors" data-audience-actors={value}
      data-moments-audience-actors disabled={disabled}>
      <legend>{copy.people}</legend>
      {people.length ? people.map(person => {
        const chosen = actorIds.includes(person.id);
        return <Button key={person.id} actionId={`compose.actor.${person.id}`}
          emphasis={chosen ? 'secondary' : 'quiet'} density="compact"
          className={`sk-audience-actor${chosen ? ' is-chosen' : ''}`}
          aria-pressed={chosen} data-actor-id={person.id} leading={person.avatar}
          trailing={chosen ? <Icon iconId="check" size={13} /> : undefined}
          availability={disabled ? { kind: 'disabled', reason: copy.people ?? copy.audience } : undefined}
          onActivate={() => onToggleActor(person.id)}>{person.label}</Button>;
      }) : <span className="sk-circle-missing">{copy.noPeople}</span>}
    </fieldset>}
  </div>;
}
