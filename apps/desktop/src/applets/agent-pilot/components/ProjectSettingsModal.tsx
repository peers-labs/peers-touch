/**
 * Agent Pilot — Project settings: edit statuses and tags
 */
import { useState, useEffect, useCallback } from 'react';
import { Modal, Tabs, List, Button, Input, message } from 'antd';
import { Trash2 } from 'lucide-react';
import {
  listProjectStatuses,
  listTags,
  createStatus,
  deleteStatus,
  createTag,
  deleteTag,
} from '../api';
import type { Project, ProjectStatus, Tag } from '../types';

interface Props {
  open: boolean;
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}

export function ProjectSettingsModal({ open, project, onClose, onSaved }: Props) {
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [newStatusName, setNewStatusName] = useState('');
  const [newTagName, setNewTagName] = useState('');

  const load = useCallback(async () => {
    if (!project?.id) return;
    try {
      const [s, t] = await Promise.all([
        listProjectStatuses(project.id),
        listTags(project.id),
      ]);
      setStatuses(s);
      setTags(t);
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [project?.id]);

  useEffect(() => {
    if (open && project) load();
  }, [open, project, load]);

  const handleAddStatus = async () => {
    if (!project?.id || !newStatusName.trim()) return;
    try {
      await createStatus({ project_id: project.id, name: newStatusName.trim() });
      setNewStatusName('');
      load();
      onSaved();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDeleteStatus = async (id: string) => {
    if (!confirm('Delete this status? Issues using it may need reassignment.')) return;
    try {
      await deleteStatus(id);
      load();
      onSaved();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleAddTag = async () => {
    if (!project?.id || !newTagName.trim()) return;
    try {
      await createTag({ project_id: project.id, name: newTagName.trim() });
      setNewTagName('');
      load();
      onSaved();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDeleteTag = async (id: string) => {
    try {
      await deleteTag(id);
      load();
      onSaved();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <Modal
      title={`Settings: ${project?.name ?? ''}`}
      open={open}
      onCancel={onClose}
      footer={null}
      width={500}
    >
      <Tabs
        items={[
          {
            key: 'statuses',
            label: 'Statuses',
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <Input
                    placeholder="New status name"
                    value={newStatusName}
                    onChange={(e) => setNewStatusName(e.target.value)}
                    onPressEnter={handleAddStatus}
                  />
                  <Button type="primary" onClick={handleAddStatus}>
                    Add
                  </Button>
                </div>
                <List
                  size="small"
                  dataSource={statuses}
                  renderItem={(s) => (
                    <List.Item
                      actions={[
                        <Button key="del" type="text" danger size="small" icon={<Trash2 size={12} />} onClick={() => handleDeleteStatus(s.id)} />,
                      ]}
                    >
                      <span style={{ color: s.color, fontWeight: 500 }}>●</span> {s.name}
                    </List.Item>
                  )}
                />
              </div>
            ),
          },
          {
            key: 'tags',
            label: 'Tags',
            children: (
              <div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <Input
                    placeholder="New tag name"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onPressEnter={handleAddTag}
                  />
                  <Button type="primary" onClick={handleAddTag}>
                    Add
                  </Button>
                </div>
                <List
                  size="small"
                  dataSource={tags}
                  renderItem={(t) => (
                    <List.Item
                      actions={[
                        <Button key="del" type="text" danger size="small" icon={<Trash2 size={12} />} onClick={() => handleDeleteTag(t.id)} />,
                      ]}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: 12,
                          height: 12,
                          borderRadius: 2,
                          background: t.color,
                          marginRight: 8,
                        }}
                      />
                      {t.name}
                    </List.Item>
                  )}
                />
              </div>
            ),
          },
        ]}
      />
    </Modal>
  );
}
