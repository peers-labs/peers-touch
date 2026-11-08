import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Dialog, Empty, MomentCircleCard, MomentCircleEditor, TextField,
  type MomentCircleDraft, type MomentCirclePerson } from '@peers-touch/ui';
import { message } from 'antd';
import { useActiveDiscoverySlice, useActiveMomentsSlice, useActiveRelationshipsSlice } from '../../components/moments/useActiveMomentsStore';
import { UserSquareAvatar } from '../../components/common/UserSquareAvatar';
import { actorDisplayName } from '../../store/socialProfileProjection';

/** Runtime supplies circles/profiles; the editor owns a cancellable draft only. */
export function CircleManageView({ query = '', createOpen = false, onCloseCreate }: {
  query?: string; createOpen?: boolean; onCloseCreate?: () => void;
}) {
  const { t } = useTranslation('moments');
  const { circles, circlesLoading, circleMembers, circleMembersErrors, createCircle, saveCircle, deleteCircle } = useActiveMomentsSlice(s => ({
    circles: s.circles, circlesLoading: s.circlesLoading, circleMembers: s.circleMembers,
    circleMembersErrors: s.circleMembersErrors,
    createCircle: s.createCircle, saveCircle: s.saveCircle, deleteCircle: s.deleteCircle,
  }));
  const { usersById, resultQuery, results, searching, searchError, searchUsers } = useActiveDiscoverySlice(s => ({
    usersById: s.usersById, resultQuery: s.query, results: s.results, searching: s.searching,
    searchError: s.searchError, searchUsers: s.searchUsers,
  }));
  const friends = useActiveRelationshipsSlice(s => s.mutualFriends);
  const [editing, setEditing] = useState<{ id?: string; draft: MomentCircleDraft } | null>(null);
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  useEffect(() => {
    if (createOpen) {
      setEditing({ draft: { name: '', description: '', memberIds: [] } });
      setSearch(''); setError(false); onCloseCreate?.();
    }
  }, [createOpen, onCloseCreate]);
  const normalizedSearch = search.trim();
  const candidates = normalizedSearch && resultQuery === normalizedSearch ? results : [];
  const person = (id: string, size = 30): MomentCirclePerson => {
    const user = usersById[id] ?? candidates.find(candidate => candidate.id === id);
    const friend = friends.find(entry => entry.actorPtid === id);
    const name = actorDisplayName(user?.displayName) || actorDisplayName(friend?.displayName)
      || actorDisplayName(user?.username, t('moments.circle.memberUnavailable'));
    return { id, name, detail: user?.homeStationDomain || friend?.homeStationDomain,
      avatar: <UserSquareAvatar actorPtid={id} name={name} remoteUrl={user?.avatar || undefined} size={size} radius={8} /> };
  };
  const q = query.trim().toLocaleLowerCase();
  const visible = circles.filter(circle => !q || [circle.name, circle.description,
    ...(circleMembers[String(circle.id)] ?? []).map(member => person(member.actorPtid).name),
  ].join('\n').toLocaleLowerCase().includes(q));
  const dismiss = () => { if (!pending) { setEditing(null); setSearch(''); setError(false); } };
  const save = async () => {
    if (!editing || pending || !editing.draft.name.trim()) return;
    setPending(true); setError(false);
    try {
      const { name, description, memberIds } = editing.draft;
      if (editing.id) await saveCircle(editing.id, name.trim(), description.trim(), memberIds);
      else await createCircle(name.trim());
      setEditing(null); setSearch('');
      message.success(t(editing.id ? 'moments.circle.saved' : 'moments.circle.created'));
    } catch { setError(true); }
    finally { setPending(false); }
  };
  const knownIds = [...new Set([
    ...(editing?.draft.memberIds ?? []),
    ...(editing?.id ? (circleMembers[editing.id] ?? []).map(member => member.actorPtid) : []),
    ...friends.map(friend => friend.actorPtid), ...candidates.map(candidate => candidate.id),
  ])];
  return <div className="moments-circles" aria-busy={circlesLoading}>
    {!circlesLoading && visible.length === 0 && <Empty description={q
      ? t('moments.search.noMatch', { query }) : t('moments.placeholder.circleEmpty')} />}
    <ul className="sk-circle-list">{visible.map(circle => {
      const id = String(circle.id);
      const members = (circleMembers[id] ?? []).map(member => person(member.actorPtid, 28));
      return <li key={id}><MomentCircleCard id={id} name={circle.name} description={circle.description}
        members={members} copy={{ manage: t('moments.circle.manageNamed', { name: circle.name }),
          members: t('moments.circle.memberCount', { count: Number(circle.memberCount) }) }}
        availability={!circleMembers[id] || circleMembersErrors[id]
          ? { kind: 'disabled', reason: t('moments.empty.unavailable.description') } : undefined}
        onOpen={() => { setEditing({ id, draft: { name: circle.name, description: circle.description,
          memberIds: members.map(member => member.id) } }); setSearch(''); setError(false); }} /></li>;
    })}</ul>
    {editing && <MomentCircleEditor id={editing.id} draft={editing.draft} pending={pending}
      people={knownIds.map(id => person(id))}
      onChange={draft => setEditing(previous => previous ? { ...previous, draft } : null)}
      onDismiss={dismiss} onSave={() => void save()} onDelete={editing.id ? () => setDeleteOpen(true) : undefined}
      candidatesHeader={<TextField aria-label={t('moments.circle.searchPeoplePlaceholder')}
        placeholder={t('moments.circle.searchPeoplePlaceholder')} value={search} disabled={pending}
        onValueChange={value => { setSearch(value); void searchUsers(value).catch(() => {}); }} />}
      status={error ? <Alert tone="warning" variant="inline" description={t('moments.circle.saveFailed')} /> : undefined}
      candidatesStatus={searching ? <span role="status">{t('moments.follow.loading')}</span>
          : searchError && normalizedSearch ? <Button actionId="circle.search-retry" emphasis="quiet"
            label={t('moments.empty.try-again')} onActivate={() => void searchUsers(search).catch(() => {})} /> : undefined}
      copy={{ title: t(editing.id ? 'moments.circle.manage' : 'moments.circle.create'),
        description: t('moments.circle.explanation'), close: t('moments.compose.close'),
        cancel: t('moments.compose.cancel'), save: t(editing.id ? 'moments.edit.save' : 'moments.circle.create'),
        name: t('moments.circle.namePlaceholder'), namePlaceholder: t('moments.circle.namePlaceholder'),
        descriptionLabel: t('moments.circle.descriptionPlaceholder'), descriptionPlaceholder: t('moments.circle.descriptionPlaceholder'),
        nameRequired: t('moments.circle.nameRequired'), members: count => t('moments.circle.memberCount', { count }),
        candidates: t('moments.circle.addPeople'), noCandidates: t('moments.circle.noPeopleFound'),
        self: t('moments.reason.self'), add: name => t('moments.circle.addNamed', { name }),
        remove: name => t('moments.circle.removeNamed', { name }), delete: t('moments.circle.delete') }} />}
    <Dialog open={deleteOpen} title={t('moments.circle.delete')} width={400}
      description={t('moments.circle.deleteDescription')} onDismiss={() => { if (!pending) setDeleteOpen(false); }}
      closeLabel={t('moments.compose.close')} footer={<>
        <Button actionId="circle.delete.cancel" emphasis="quiet" label={t('moments.compose.cancel')}
          onActivate={() => setDeleteOpen(false)} availability={pending ? { kind: 'disabled', reason: t('moments.reaction.pending') } : undefined} />
        <Button actionId="circle.delete.confirm" emphasis="primary" tone="danger"
          execution={pending ? 'pending' : 'idle'} label={t('moments.circle.delete')}
          onActivate={() => {
            if (!editing?.id || pending) return;
            setPending(true);
            void deleteCircle(editing.id).then(() => { setDeleteOpen(false); setEditing(null); })
              .catch(() => message.error(t('moments.circle.saveFailed'))).finally(() => setPending(false));
          }} />
      </>} />
  </div>;
}
