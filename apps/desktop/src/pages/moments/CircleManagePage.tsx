import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Tag } from '@lobehub/ui';
import {
  Card,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Spin,
  Space,
  Typography,
  message,
  theme,
} from 'antd';
import { Pencil, Plus, Search, Trash2, UserPlus, UsersRound, X } from 'lucide-react';
import {
  useActiveDiscoverySlice,
  useActiveMomentsSlice,
} from '../../components/moments/useActiveMomentsStore';
import { UserSquareAvatar } from '../../components/common/UserSquareAvatar';
import { FederatedHandle } from '../../components/FederatedHandle';
import { SocialEmptyState } from '../../components/moments/surfaces';
import type { DiscoveryUser } from '../../store/discovery';

const { Paragraph, Text } = Typography;

// CircleManageView — publisher-private audience lists + add/rename/
// delete + member management. "Circle" remains the protocol term;
// the UI uses audience language and resolves people through search.
//
// What works in P2:
//   - Create / rename / delete circle (full CRUD against the
//     `social_circles` table).
//   - Add / remove members selected by identity search (the selected
//     PTID remains an internal command value).
//
// What doesn't (deferred to P3):
//   - PUBLISHING to a circle audience — the AudiencePicker greys
//     CIRCLE because the server-side membership check is a noop in
//     P1/P2. Once ActorResolver lands, the publisher flow works end
//     to end without changes here.

interface CircleEditState {
  circleId?: string;
  name: string;
  description: string;
}

export function CircleManageView() {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();
  const {
    circles,
    circlesLoading,
    circleMembers,
    createCircle,
    renameCircle,
    deleteCircle,
    addCircleMember,
    removeCircleMember,
  } = useActiveMomentsSlice((s) => ({
    circles: s.circles,
    circlesLoading: s.circlesLoading,
    circleMembers: s.circleMembers,
    createCircle: s.createCircle,
    renameCircle: s.renameCircle,
    deleteCircle: s.deleteCircle,
    addCircleMember: s.addCircleMember,
    removeCircleMember: s.removeCircleMember,
  }));
  const { usersById, profileLoadingById, loadUserProfile } = useActiveDiscoverySlice((s) => ({
    usersById: s.usersById,
    profileLoadingById: s.profileLoadingById,
    loadUserProfile: s.loadUserProfile,
  }));

  const [editing, setEditing] = useState<CircleEditState | null>(null);
  const [memberPickerCircleId, setMemberPickerCircleId] = useState<string | null>(null);

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      message.warning(t('moments.circle.nameRequired'));
      return;
    }
    try {
      if (editing.circleId) {
        await renameCircle(editing.circleId, name, editing.description.trim() || undefined);
      } else {
        await createCircle(name, editing.description.trim() || undefined);
      }
      message.success(
        editing.circleId
          ? t('moments.circle.renamed')
          : t('moments.circle.created'),
      );
      setEditing(null);
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleAddMember = async (circleId: string, actorPtid: string) => {
    try {
      await addCircleMember(circleId, actorPtid);
      await loadUserProfile(actorPtid);
      setMemberPickerCircleId(null);
    } catch (err) {
      message.error(String(err));
    }
  };

  return (
    <div>
      <Space
        wrap
        style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}
      >
        <Text strong style={{ fontSize: 16 }}>
          {t('moments.action.manageCircles')}
        </Text>
        <Button
          type="primary"
          icon={<Plus size={14} />}
          onClick={() => setEditing({ name: '', description: '' })}
        >
          {t('moments.circle.create')}
        </Button>
      </Space>
      <Paragraph
        type="secondary"
        style={{ margin: '-4px 0 16px', maxWidth: 680, lineHeight: 1.6 }}
      >
        {t('moments.circle.explanation')}
      </Paragraph>

      {!circlesLoading && circles.length === 0 && (
        <Empty description={t('moments.placeholder.circleEmpty')} />
      )}

      {circles.map((c) => {
        const id = String(c.id ?? '');
        const members = circleMembers[id] ?? [];
        return (
          <Card
            key={id}
            size="small"
            style={{ marginBottom: 10, borderRadius: 16 }}
            title={
              <Space>
                <UsersRound size={14} />
                <Text strong>{c.name}</Text>
                <Tag>{members.length}</Tag>
              </Space>
            }
            extra={
              <Space size={4}>
                <Button
                  size="small"
                  type="text"
                  icon={<Pencil size={13} />}
                  onClick={() =>
                    setEditing({
                      circleId: id,
                      name: c.name,
                      description: c.description ?? '',
                    })
                  }
                />
                <Popconfirm
                  title={t('moments.circle.delete')}
                  okType="danger"
                  onConfirm={async () => {
                    try {
                      await deleteCircle(id);
                    } catch (err) {
                      message.error(String(err));
                    }
                  }}
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<Trash2 size={13} />}
                  />
                </Popconfirm>
              </Space>
            }
          >
            {c.description && (
              <Text type="secondary" style={{ fontSize: 13 }}>
                {c.description}
              </Text>
            )}
            <List
              size="small"
              dataSource={members}
              renderItem={(m) => (
                <List.Item
                  actions={[
                    <Button
                      key="del"
                      size="small"
                      type="link"
                      danger
                      onClick={() =>
                        removeCircleMember(id, m.actorPtid).catch((err) =>
                          message.error(String(err)),
                        )
                      }
                    >
                      {t('moments.circle.remove')}
                    </Button>,
                  ]}
                >
                  <CircleMemberIdentity
                    actorPtid={m.actorPtid}
                    user={usersById[m.actorPtid]}
                    loading={!!profileLoadingById[m.actorPtid]}
                    fallbackLabel={t('moments.circle.memberUnavailable')}
                  />
                </List.Item>
              )}
              locale={{
                emptyText: (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('moments.circle.noMembers')}
                  </Text>
                ),
              }}
              style={{ marginTop: 8 }}
            />
            {memberPickerCircleId === id ? (
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: token.borderRadiusLG,
                  background: token.colorFillQuaternary,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
                  <Button
                    type="text"
                    size="small"
                    icon={<X size={14} />}
                    aria-label={t('moments.compose.close')}
                    onClick={() => setMemberPickerCircleId(null)}
                  />
                </div>
                <CircleMemberPicker
                  excludedPtids={new Set(members.map((member) => member.actorPtid))}
                  onAdd={(actorPtid) => handleAddMember(id, actorPtid)}
                />
              </div>
            ) : (
              <Button
                type="text"
                icon={<UserPlus size={14} />}
                style={{ marginTop: 8 }}
                onClick={() => setMemberPickerCircleId(id)}
              >
                {t('moments.circle.addPeople')}
              </Button>
            )}
          </Card>
        );
      })}

      <Modal
        open={!!editing}
        title={
          editing?.circleId
            ? t('moments.circle.rename')
            : t('moments.circle.create')
        }
        onCancel={() => setEditing(null)}
        onOk={handleSave}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Input
            placeholder={t('moments.circle.namePlaceholder')}
            value={editing?.name ?? ''}
            onChange={(e) =>
              setEditing((s) => (s ? { ...s, name: e.target.value } : s))
            }
            autoFocus
          />
          <Input.TextArea
            placeholder={t('moments.circle.descriptionPlaceholder')}
            value={editing?.description ?? ''}
            onChange={(e) =>
              setEditing((s) => (s ? { ...s, description: e.target.value } : s))
            }
            autoSize={{ minRows: 2, maxRows: 4 }}
          />
        </Space>
      </Modal>
    </div>
  );
}

function CircleMemberPicker({
  excludedPtids,
  onAdd,
}: {
  excludedPtids: ReadonlySet<string>;
  onAdd: (actorPtid: string) => Promise<void>;
}) {
  const { t } = useTranslation('moments');
  const [query, setQuery] = useState('');
  const [addingPtid, setAddingPtid] = useState<string | null>(null);
  const { resultQuery, results, searching, searchError, searchUsers } = useActiveDiscoverySlice((s) => ({
    resultQuery: s.query,
    results: s.results,
    searching: s.searching,
    searchError: s.searchError,
    searchUsers: s.searchUsers,
  }));

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void searchUsers(query);
    }, 280);
    return () => window.clearTimeout(handle);
  }, [query, searchUsers]);

  const normalizedQuery = query.trim();
  const candidates = resultQuery === normalizedQuery
    ? results.filter((user) => !excludedPtids.has(user.id))
    : [];

  return (
    <div data-moments-circle-person-picker>
      <Input
        prefix={<Search size={15} />}
        placeholder={t('moments.circle.searchPeoplePlaceholder')}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoFocus
        allowClear
      />
      {searching && resultQuery === normalizedQuery && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 14 }}>
          <Spin size="small" />
        </div>
      )}
      {!searching && normalizedQuery && searchError && resultQuery === normalizedQuery && (
        <SocialEmptyState
          compact
          kind="degraded"
          primaryAction={{
            label: t('moments.empty.try-again'),
            onClick: () => void searchUsers(normalizedQuery),
          }}
        />
      )}
      {!searching && normalizedQuery && !searchError && resultQuery === normalizedQuery && candidates.length === 0 && (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={t('moments.circle.noPeopleFound')}
          styles={{ image: { height: 36 } }}
        />
      )}
      {!searching && normalizedQuery && !searchError && candidates.length > 0 && (
        <List
          size="small"
          dataSource={candidates}
          renderItem={(user) => (
            <List.Item
              key={user.id}
              actions={[
                <Button
                  key="add"
                  size="small"
                  type="primary"
                  loading={addingPtid === user.id}
                  disabled={!!addingPtid}
                  onClick={async () => {
                    setAddingPtid(user.id);
                    try {
                      await onAdd(user.id);
                    } finally {
                      setAddingPtid(null);
                    }
                  }}
                >
                  {t('moments.circle.addMember')}
                </Button>,
              ]}
            >
              <CircleMemberIdentity
                actorPtid={user.id}
                user={user}
                fallbackLabel={t('moments.circle.memberUnavailable')}
              />
            </List.Item>
          )}
        />
      )}
    </div>
  );
}

function CircleMemberIdentity({
  actorPtid,
  user,
  loading,
  fallbackLabel,
}: {
  actorPtid: string;
  user?: DiscoveryUser;
  loading?: boolean;
  fallbackLabel: string;
}) {
  if (loading && !user) {
    return <Spin size="small" />;
  }

  const displayName = user?.displayName || user?.username || fallbackLabel;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <UserSquareAvatar
        remoteUrl={user?.avatar}
        name={displayName}
        size={32}
        radius={8}
      />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Text strong ellipsis style={{ maxWidth: 320 }}>
          {displayName}
        </Text>
        {user?.username && (
          <FederatedHandle
            localPart={user.username}
            home={user.homeStationDomain}
            fontSize={12}
          />
        )}
        {!user?.username && actorPtid && (
          <Text type="secondary" ellipsis style={{ maxWidth: 320, fontSize: 12 }}>
            {actorPtid}
          </Text>
        )}
      </div>
    </div>
  );
}
