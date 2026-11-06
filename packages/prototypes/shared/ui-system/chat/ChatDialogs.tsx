/**
 * Chat dialogs: find-a-person picker (increment 3, headless + federated
 * directory in increment 35) and create-group modal (increment 10).
 * The picker is a headless modal: the first thing on screen is the search
 * field (autofocus) and the results — no title, description, footer or tip.
 * Known people list by default; typing additionally searches the federated
 * catalog (or resolves an exact @user@host), and a federation-only scope
 * hides known contacts. Federated rows send a friend request instead of
 * opening a chat. Create-group simulates one transient failure with an
 * inline retry path like the desktop modal.
 */
import { useEffect, useMemo, useState } from 'react';
import { Globe, Search, ShieldCheck } from 'lucide-react';
import { Alert, Avatar, Button, Checkbox, Dialog, Empty, IconButton, Segmented, Tag, TextField } from '@peers-touch/ui';
import type { Conversation, FederatedActor, Person } from './chat-data';
import { IDENTITY_INK, IDENTITY_PINE } from './chat-data';
import { useT } from '../prefs';

/* ── Find people ──────────────────────────────────────── */

type PickerScope = 'all' | 'federation';

// Desktop parity: an @-prefixed query with a host is an exact handle
// resolution; anything else is a catalog/contact prefix query.
const HANDLE_RE = /^@([a-zA-Z0-9._-]+)@([a-zA-Z0-9.-]+(?::\d+)?)$/;

export function PickPersonDialog({ open, people, directory, friends, selfName, onDismiss, onPick }: {
  open: boolean;
  people: Person[];
  directory: FederatedActor[];
  /** Already-friend identities; a directory match renders a disabled Friends state. */
  friends: Person[];
  /** Current viewer name; a self match renders a disabled You state. */
  selfName: string;
  onDismiss: () => void;
  onPick: (person: Person) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<PickerScope>('all');
  const [pending, setPending] = useState<Set<string>>(new Set());

  // Desktop parity: every open starts a clean search (destroyOnHidden).
  useEffect(() => {
    if (open) { setQuery(''); setScope('all'); setPending(new Set()); }
  }, [open]);

  const q = query.trim().toLowerCase();
  const handleMatch = q.startsWith('@') ? HANDLE_RE.exec(q) : null;

  const knownMatches = useMemo(() => {
    if (scope !== 'all' || !q || handleMatch) return scope === 'all' && !q ? people : [];
    return people.filter(p =>
      `${p.name} ${p.station ?? ''} ${p.bio}`.toLowerCase().includes(q));
  }, [people, q, scope, handleMatch]);

  const federatedMatches = useMemo(() => {
    if (handleMatch) {
      const canonical = q;
      return directory.filter(a => a.handle.toLowerCase() === canonical);
    }
    if (!q) return [];
    return directory.filter(a =>
      `${a.name} ${a.handle} ${a.station} ${a.bio}`.toLowerCase().includes(q));
  }, [directory, q, handleMatch]);

  const idleKnown = scope === 'all' && !q;
  const visibleKnown = idleKnown ? people : knownMatches;
  const showKnown = scope === 'all';
  const showSections = showKnown && visibleKnown.length > 0 && federatedMatches.length > 0;
  const total = visibleKnown.length + federatedMatches.length;

  return (
    <Dialog open={open} onDismiss={onDismiss} title="" width={420}
      closeLabel={t('common.close')} className="sk-picker-dialog">
      <div className="sk-picker" data-picker-scope={scope}>
        <div className="sk-picker-search">
          <TextField value={query} autoFocus
            aria-label={t('picker.searchAria')} placeholder={t('picker.placeholder')}
            leading={<Search size={14} />} data-picker-query={query}
            onValueChange={setQuery} />
          <IconButton actionId="picker.close" iconId="close" iconSize={15} density="compact"
            emphasis="quiet" label={t('common.close')} onActivate={onDismiss} />
        </div>
        <Segmented<PickerScope> className="sk-picker-scope" density="compact"
          aria-label="picker-scope" value={scope} onValueChange={value => setScope(value ?? 'all')}
          options={[
            { value: 'all', label: t('picker.scopeAll') },
            { value: 'federation', label: <span className="sk-picker-scope-fed"><Globe size={11} />{t('picker.scopeFederation')}</span> },
          ]} />
        <div className="sk-picker-results">
          {showKnown && visibleKnown.length > 0 && (
            <>
              {showSections && <span className="sk-picker-section">{t('picker.sectionKnown')}</span>}
              <ul className="sk-picker-list">
                {visibleKnown.map(p => (
                  <li key={p.id}>
                    <button type="button" className="sk-picker-row" data-contact-id={p.id}
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
              </ul>
            </>
          )}
          {federatedMatches.length > 0 && (
            <>
              {showSections && <span className="sk-picker-section">{t('picker.sectionFederation')}</span>}
              <ul className="sk-picker-list">
                {federatedMatches.map(a => {
                  const isPending = pending.has(a.id);
                  const isFriend = friends.some(f => f.name === a.name && f.station === a.station);
                  const isSelf = a.name === selfName;
                  const state = isSelf ? 'self' : isFriend ? 'friend' : isPending ? 'pending' : 'available';
                  return (
                    <li key={a.id}>
                      <div className="sk-fed-row" data-fed-id={a.id} data-fed-state={state}>
                        <Avatar name={a.name} background={a.tone} size={36}
                          style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
                        <span className="sk-picker-meta">
                          <span className="sk-fed-name-line">
                            <strong>{a.name}</strong>
                            <Tag tone="success"><ShieldCheck size={10} />{t('picker.tagVerified')}</Tag>
                            <Tag tone="neutral">{a.station}</Tag>
                          </span>
                          <span className="sk-fed-handle">{a.handle}</span>
                          <span className="sk-fed-ptid" data-fed-ptid>{a.id}</span>
                        </span>
                        <Button actionId={`picker.fedsend.${a.id}`}
                          emphasis={state === 'available' ? 'primary' : 'secondary'}
                          density="compact"
                          label={isSelf ? t('picker.self') : isFriend ? t('picker.alreadyFriend')
                            : isPending ? t('picker.pending') : t('picker.sendRequest')}
                          availability={state === 'available'
                            ? undefined
                            : { kind: 'disabled', reason: state }}
                          onActivate={() => setPending(prev => new Set(prev).add(a.id))} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {total === 0 && (
            <div className="sk-picker-empty">
              <Empty description={scope === 'federation' && !q ? t('picker.fedEmpty') : t('picker.empty')} />
            </div>
          )}
        </div>
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
        lastTs: Date.now(), unread: 0, tone: IDENTITY_INK, kind: 'group',
        members: [{ name: '林野', tone: IDENTITY_PINE, role: 'owner' }, ...members],
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
