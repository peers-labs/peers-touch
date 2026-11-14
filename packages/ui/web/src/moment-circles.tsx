import type { ReactNode } from 'react';
import type { Availability } from '@peers-touch/ui-contracts';
import { Button, IconButton } from './actions';
import { TextField } from './fields';
import { Dialog } from './overlays';
import { Icon } from './icon';
import './moments.css';

export interface MomentCirclePerson { id: string; name: string; avatar: ReactNode; detail?: string; self?: boolean }
export interface MomentCircleDraft { name: string; description: string; memberIds: string[] }

export function MomentCircleCard({ id, name, description, members, copy, onOpen, availability }: {
  id: string; name: string; description?: string; members: readonly MomentCirclePerson[];
  copy: { manage: string; members: string }; onOpen: () => void;
  availability?: Availability;
}) {
  return <Button actionId={`circle.manage.${id}`} emphasis="quiet" density="normal"
    fullWidth className="sk-post sk-circle-card" aria-label={copy.manage} onActivate={onOpen} availability={availability}>
    <span className="sk-circle-id">
      <strong className="sk-circle-name">{name}</strong>
      {description && <span className="sk-circle-desc">{description}</span>}
      <span className="sk-post-time">{copy.members}</span>
    </span>
    <span className="sk-circle-tail">
      <span className="sk-circle-avatars" aria-label={copy.members}>
        {members.slice(0, 5).map(member => <span key={member.id}>{member.avatar}</span>)}
      </span>
      <Icon iconId="chevron-right" size={15} className="sk-circle-chevron" />
    </span>
  </Button>;
}

export interface MomentCircleEditorCopy {
  title: string; description: string; close: string; cancel: string; save: string;
  name: string; namePlaceholder: string; descriptionLabel: string; descriptionPlaceholder: string;
  nameRequired: string; members: (count: number) => string; candidates: string; noCandidates: string;
  self: string; add: (name: string) => string; remove: (name: string) => string; delete: string;
}

/** Selection is a draft: no member command runs until the consumer saves. */
export function MomentCircleEditor({ id, draft, onChange, people, onDismiss, onSave, onDelete,
  candidatesHeader, candidatesStatus, status, pending, copy }: {
  id?: string; draft: MomentCircleDraft; onChange: (draft: MomentCircleDraft) => void;
  people: readonly MomentCirclePerson[]; onDismiss: () => void; onSave: () => void;
  onDelete?: () => void; candidatesHeader?: ReactNode; candidatesStatus?: ReactNode;
  status?: ReactNode;
  pending?: boolean; copy: MomentCircleEditorCopy;
}) {
  const candidates = people.filter(person => !draft.memberIds.includes(person.id));
  const setMembers = (memberIds: string[]) => onChange({ ...draft, memberIds });
  const availability = pending ? { kind: 'disabled' as const, reason: copy.save } : undefined;
  return <Dialog open title={copy.title} description={copy.description} width={id ? 460 : 400}
    onDismiss={() => { if (!pending) onDismiss(); }} closeLabel={copy.close}
    footer={<div className="sk-circle-manage-footer">
      {onDelete && <Button actionId={`circle.delete.${id}`} emphasis="quiet" tone="danger"
        label={copy.delete} availability={availability} onActivate={onDelete} />}
      <span className="sk-circle-footer-spacer" />
      <Button actionId={id ? 'circle.save-cancel' : 'circle.cancel'} emphasis="quiet"
        label={copy.cancel} availability={availability} onActivate={onDismiss} />
      <Button actionId={id ? 'circle.save' : 'circle.create'} emphasis="primary" label={copy.save}
        execution={pending ? 'pending' : 'idle'}
        availability={draft.name.trim() ? availability : { kind: 'disabled', reason: copy.nameRequired }}
        onActivate={onSave} />
    </div>}>
    <div className="sk-circle-manage">
      {status}
      <TextField className={id ? 'sk-circle-name-edit' : 'sk-circle-name-input'} aria-label={copy.name}
        data-circle-name={draft.name.trim()} placeholder={copy.namePlaceholder}
        value={draft.name} onValueChange={name => onChange({ ...draft, name })} disabled={pending} autoFocus
        onEnter={event => { event.preventDefault(); if (draft.name.trim() && !pending) onSave(); }} />
      {id && <TextField className="sk-circle-desc-edit" aria-label={copy.descriptionLabel}
        data-circle-desc={draft.description} placeholder={copy.descriptionPlaceholder}
        value={draft.description} onValueChange={description => onChange({ ...draft, description })}
        disabled={pending} />}
      {id && <div className="sk-circle-manage-members"
        data-circle-member-count={draft.memberIds.filter(memberId => !people.find(p => p.id === memberId)?.self).length}>
        <span className="sk-circle-manage-label">{copy.members(draft.memberIds.length)}</span>
        <ul className="sk-circle-member-list">{draft.memberIds.map(memberId => {
          const person = people.find(p => p.id === memberId);
          if (!person) return null;
          return <li key={memberId} className="sk-circle-member-row" data-circle-member={memberId}>
            {person.avatar}<strong className="sk-circle-member-name">{person.name}</strong>
            {person.self ? <span className="sk-circle-member-self">{copy.self}</span>
              : <IconButton actionId={`circle.member.remove.${id}.${memberId}`} iconId="user-minus"
                iconSize={14} density="compact" emphasis="quiet" label={copy.remove(person.name)}
                className="is-danger" availability={availability}
                onActivate={() => setMembers(draft.memberIds.filter(entry => entry !== memberId))} />}
          </li>;
        })}</ul>
      </div>}
      {id && <div className="sk-circle-candidates">
        <span className="sk-circle-manage-label">{copy.candidates}</span>
        {candidatesHeader}
        {candidatesStatus ?? (candidates.length === 0
          ? <span className="sk-circle-candidates-empty">{copy.noCandidates}</span>
          : <ul className="sk-circle-member-list">{candidates.map(person => <li key={person.id}
            className="sk-circle-member-row" data-circle-candidate={person.id}>
            {person.avatar}<span className="sk-circle-member-meta">
              <strong className="sk-circle-member-name">{person.name}</strong>
              {person.detail && <span className="sk-post-time">{person.detail}</span>}
            </span>
            <IconButton actionId={`circle.member.add.${id}.${person.id}`} iconId="user-plus"
              iconSize={14} density="compact" emphasis="quiet" label={copy.add(person.name)}
              availability={availability} onActivate={() => setMembers([...draft.memberIds, person.id])} />
          </li>)}</ul>)}
      </div>}
    </div>
  </Dialog>;
}
