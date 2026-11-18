import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from './icon';
import { Button, IconButton } from './actions';
import { Select } from './selection';
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
export function MomentComposerSurface({ editor, images, toolbar, audience, status, footer,
  onRemoveImage, disabled, copy, className = '', ...props }: HTMLAttributes<HTMLDivElement> & {
  editor: ReactNode; images: readonly MomentComposerImage[]; toolbar: ReactNode;
  audience: ReactNode; status?: ReactNode; footer: ReactNode; disabled?: boolean;
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
    {audience}
    {status}
    <div className="sk-compose-footer">{footer}</div>
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
