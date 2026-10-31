/**
 * Chat dialogs: find-a-person picker (increment 3) and create-group modal
 * (increment 10). Both append real local conversations and switch the rail
 * to the new session; create-group simulates one transient failure with
 * an inline retry path like the desktop modal.
 */
import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Checkbox, Dialog, Empty, TextField } from '@peers-touch/ui';
import type { Conversation, Person } from './chat-data';
import { useT } from '../prefs';

/* ── Find people ──────────────────────────────────────── */

export function PickPersonDialog({ open, people, existingIds, onDismiss, onPick }: {
  open: boolean;
  people: Person[];
  existingIds: Set<string>;
  onDismiss: () => void;
  onPick: (person: Person) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => people.filter(p =>
    `${p.name} ${p.station ?? ''} ${p.bio}`.toLowerCase().includes(query.trim().toLowerCase())), [people, query]);

  return (
    <Dialog open={open} onDismiss={onDismiss} title={t('picker.title')} width={420}
      description={t('picker.desc')} closeLabel={t('common.close')}
      footer={<Button actionId="picker-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={onDismiss} />}>
      <div className="sk-picker">
        <TextField value={query} aria-label={t('picker.searchAria')} placeholder={t('picker.searchAria')}
          onValueChange={setQuery} leading={undefined} clearable onClear={() => setQuery('')} />
        <ul className="sk-picker-list">
          {filtered.map(p => (
            <li key={p.id}>
              <button type="button" className="sk-picker-row"
                data-contact-id={p.id}
                onClick={() => onPick(p)}>
                <Avatar name={p.name} background={p.tone} size={36}
                  style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
                <span className="sk-picker-meta">
                  <strong>{p.name}</strong>
                  <span>{p.station} · {p.bio}</span>
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="sk-picker-empty"><Empty description={t('picker.empty')} /></li>
          )}
        </ul>
        <p className="sk-picker-note">
          {existingIds.size > 0
            ? t('picker.existingHint', { n: existingIds.size })
            : t('picker.newHint')}
        </p>
      </div>
    </Dialog>
  );
}

/* ── Create group ─────────────────────────────────────── */

export function CreateGroupDialog({ open, people, onDismiss, onCreate }: {
  open: boolean;
  people: Person[];
  onDismiss: () => void;
  onCreate: (group: Conversation) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setName(''); setSelected(new Set()); setFailed(false); setSubmitting(false); };
  const close = () => { reset(); onDismiss(); };
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  // Encrypted group chats are station-local until federated MLS groups ship;
  // selecting a federated contact blocks creation with a specific reason
  // (desktop parity: a network member can't be added to a group chat yet).
  const federatedSelected = people
    .filter(p => selected.has(p.id) && p.station !== '本站');
  const blocked = federatedSelected.length > 0;

  const submit = () => {
    if (!name.trim() || selected.size === 0 || blocked) return;
    if (!failed) {
      setFailed(true);
      return;
    }
    setSubmitting(true);
    window.setTimeout(() => {
      const members = people.filter(p => selected.has(p.id)).map(p => ({ name: p.name, tone: p.tone }));
      onCreate({
        id: `local-${Date.now()}`, name: name.trim(), last: t('group.createdLast'), lastAt: t('time.justNow'),
        lastTs: Date.now(), unread: 0, tone: '#7d8c4a', kind: 'group',
        members: [{ name: '林野', tone: '#22302a' }, ...members],
      });
      close();
    }, 600);
  };

  return (
    <Dialog open={open} onDismiss={close} title={t('group.dialogTitle')} width={460} closeLabel={t('common.close')}
      description={t('group.dialogDesc')}
      footer={
        <>
          <Button actionId="group.cancel" emphasis="quiet" label={t('common.cancel')} onActivate={close} />
          <Button actionId="group.submit" emphasis="primary" label={failed ? t('group.retry') : t('common.create')}
            execution={submitting ? 'pending' : 'idle'}
            availability={!name.trim() || selected.size === 0
              ? { kind: 'disabled', reason: t('group.needFields') }
              : blocked
                ? { kind: 'disabled', reason: t('group.federationReason') }
                : undefined}
            onActivate={submit} />
        </>
      }>
      <div className="sk-group-dialog" data-create-group data-create-group-error={failed ? 'true' : 'false'}
        data-federation-blocked={blocked ? 'true' : 'false'}>
        {blocked && (
          <Alert tone="danger" title={t('group.fedTitle')} data-federation-alert
            description={t('group.fedDesc', { names: federatedSelected.map(p => p.name).join('、') })} />
        )}
        {!blocked && failed && <Alert tone="danger" title={t('group.failedTitle')} description={t('group.failedDesc')} />}
        <TextField aria-label={t('group.nameAria')} placeholder={t('group.namePlaceholder')} value={name}
          onValueChange={setName} data-group-name={name} />
        <div className="sk-group-members">
          {people.map(person => {
            const federated = person.station !== '本站';
            return (
              <label key={person.id} className="sk-group-member" data-contact-ptid={person.id}
                data-federated={federated ? 'true' : 'false'}>
                <Checkbox checked={selected.has(person.id)} onCheckedChange={() => toggle(person.id)} />
                <Avatar name={person.name} background={person.tone} size={28} style={{ borderRadius: 8 }} />
                <span>{person.name}</span>
                {federated && <span className="sk-member-federation">{person.station}</span>}
              </label>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
