/**
 * Chat dialogs: find-a-person picker (increment 3) and create-group modal
 * (increment 10). Both append real local conversations and switch the rail
 * to the new session; create-group simulates one transient failure with
 * an inline retry path like the desktop modal.
 */
import { useMemo, useState } from 'react';
import { Alert, Avatar, Button, Checkbox, Dialog, Empty, TextField } from '@peers-touch/ui';
import type { Conversation, Person } from './chat-data';

/* ── Find people ──────────────────────────────────────── */

export function PickPersonDialog({ open, people, existingIds, onDismiss, onPick }: {
  open: boolean;
  people: Person[];
  existingIds: Set<string>;
  onDismiss: () => void;
  onPick: (person: Person) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => people.filter(p =>
    `${p.name} ${p.station ?? ''} ${p.bio}`.toLowerCase().includes(query.trim().toLowerCase())), [people, query]);

  return (
    <Dialog open={open} onDismiss={onDismiss} title="新建会话" width={420}
      description="选择一位联系人，或选联邦公开对象开始单聊（本地示例）" closeLabel="关闭"
      footer={<Button actionId="picker-cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />}>
      <div className="sk-picker">
        <TextField value={query} aria-label="搜索联系人" placeholder="搜索联系人"
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
            <li className="sk-picker-empty"><Empty description="没有匹配的联系人" /></li>
          )}
        </ul>
        <p className="sk-picker-note">
          {existingIds.size > 0 ? `已有最近会话 ${existingIds.size} 个；选择联系人会直接打开或新建。` : '新联系人会创建一条本地会话。'}
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

  const submit = () => {
    if (!name.trim() || selected.size === 0) return;
    if (!failed) {
      setFailed(true);
      return;
    }
    setSubmitting(true);
    window.setTimeout(() => {
      const members = people.filter(p => selected.has(p.id)).map(p => ({ name: p.name, tone: p.tone }));
      onCreate({
        id: `local-${Date.now()}`, name: name.trim(), last: '群聊已创建', lastAt: '刚刚',
        unread: 0, tone: '#7d8c4a', kind: 'group', members: [{ name: '林野', tone: '#22302a' }, ...members],
      });
      close();
    }, 600);
  };

  return (
    <Dialog open={open} onDismiss={close} title="创建群聊" width={460} closeLabel="关闭"
      description="选择成员并命名群聊"
      footer={
        <>
          <Button actionId="group.cancel" emphasis="quiet" label="取消" onActivate={close} />
          <Button actionId="group.submit" emphasis="primary" label={failed ? '重试创建' : '创建'}
            execution={submitting ? 'pending' : 'idle'}
            availability={!name.trim() || selected.size === 0
              ? { kind: 'disabled', reason: '需要群名与至少 1 名成员' } : undefined}
            onActivate={submit} />
        </>
      }>
      <div className="sk-group-dialog" data-create-group data-create-group-error={failed ? 'true' : 'false'}>
        {failed && <Alert tone="danger" title="创建失败" description="网络异常（模拟），请重试。" />}
        <TextField aria-label="群名称" placeholder="群名称，如：夜跑小队" value={name}
          onValueChange={setName} data-group-name={name} />
        <div className="sk-group-members">
          {people.map(person => (
            <label key={person.id} className="sk-group-member" data-contact-ptid={person.id}>
              <Checkbox checked={selected.has(person.id)} onCheckedChange={() => toggle(person.id)} />
              <Avatar name={person.name} background={person.tone} size={28} style={{ borderRadius: 8 }} />
              <span>{person.name}</span>
            </label>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* ── Contact detail (center pane) ─────────────────────── */

export function ContactDetailPane({ person, onMessage }: {
  person: Person;
  onMessage: (person: Person) => void;
}) {
  return (
    <div className="sk-contact-detail" data-contact-detail-kind="person">
      <Avatar name={person.name} background={person.tone} size={72} style={{ borderRadius: 20 }} />
      <h2>{person.name}</h2>
      <Tag2 station={person.station} />
      <p className="sk-contact-bio">{person.bio}</p>
      <Button actionId="contact.message" emphasis="primary"
        label="发消息" onActivate={() => onMessage(person)} />
    </div>
  );
}

function Tag2({ station }: { station?: string }) {
  return <span className="sk-contact-station">{station ?? '本站'}</span>;
}
