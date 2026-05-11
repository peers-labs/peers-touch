import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Empty,
  Input,
  List,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Typography,
  message,
} from 'antd';
import { Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { useMomentsStore } from '../../store/moments';

const { Text } = Typography;

// CircleManageView — list publisher's own circles + add/rename/
// delete + member management.
//
// What works in P2:
//   - Create / rename / delete circle (full CRUD against the
//     `social_circles` table).
//   - Add / remove members by DID (bulk via `add_members` / paginated
//     listing via `list_members`).
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
  const circles = useMomentsStore((s) => s.circles);
  const circlesLoading = useMomentsStore((s) => s.circlesLoading);
  const circleMembers = useMomentsStore((s) => s.circleMembers);
  const createCircle = useMomentsStore((s) => s.createCircle);
  const renameCircle = useMomentsStore((s) => s.renameCircle);
  const deleteCircle = useMomentsStore((s) => s.deleteCircle);
  const addCircleMember = useMomentsStore((s) => s.addCircleMember);
  const removeCircleMember = useMomentsStore((s) => s.removeCircleMember);

  const [editing, setEditing] = useState<CircleEditState | null>(null);
  const [memberInput, setMemberInput] = useState<Record<string, string>>({});

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      message.warning(t('moments.circle.nameRequired', { defaultValue: 'Name required' }));
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
          ? t('moments.circle.renamed', { defaultValue: 'Renamed' })
          : t('moments.circle.created', { defaultValue: 'Created' }),
      );
      setEditing(null);
    } catch (err) {
      message.error(String(err));
    }
  };

  const handleAddMember = async (circleId: string) => {
    const did = (memberInput[circleId] ?? '').trim();
    if (!did) {
      message.warning(t('moments.circle.memberDidRequired', { defaultValue: 'Enter a DID' }));
      return;
    }
    try {
      await addCircleMember(circleId, did);
      setMemberInput((m) => ({ ...m, [circleId]: '' }));
    } catch (err) {
      message.error(String(err));
    }
  };

  return (
    <div>
      <Space style={{ marginBottom: 16, justifyContent: 'space-between', width: '100%' }}>
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
            style={{ marginBottom: 12 }}
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
                        removeCircleMember(id, m.actorDid).catch((err) =>
                          message.error(String(err)),
                        )
                      }
                    >
                      {t('moments.circle.remove', { defaultValue: 'Remove' })}
                    </Button>,
                  ]}
                >
                  <Text style={{ fontSize: 13 }}>{m.actorDid}</Text>
                </List.Item>
              )}
              locale={{
                emptyText: (
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {t('moments.circle.noMembers', { defaultValue: 'No members yet' })}
                  </Text>
                ),
              }}
              style={{ marginTop: 8 }}
            />
            <Space.Compact style={{ width: '100%', marginTop: 8 }}>
              <Input
                placeholder={t('moments.circle.addMemberPlaceholder', {
                  defaultValue: 'did:peers:...',
                })}
                value={memberInput[id] ?? ''}
                onChange={(e) => setMemberInput((m) => ({ ...m, [id]: e.target.value }))}
                onPressEnter={() => handleAddMember(id)}
              />
              <Button onClick={() => handleAddMember(id)}>
                {t('moments.circle.addMember', { defaultValue: 'Add' })}
              </Button>
            </Space.Compact>
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
