/**
 * Agent Pilot — Workspaces list + create
 */
import { useState, useEffect, useCallback } from 'react';
import { Button, List, Input, message } from 'antd';
import { Plus } from 'lucide-react';
import { listWorkspaces, createWorkspace, deleteWorkspace, duplicateWorkspace } from '../api';
import type { Workspace } from '../types';

interface Props {
  onBack?: () => void;
}

export function WorkspacesPage({ onBack }: Props) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [createName, setCreateName] = useState('');

  const load = useCallback(async () => {
    try {
      const list = await listWorkspaces({ archived: showArchived });
      setWorkspaces(list);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!createName.trim()) return;
    try {
      await createWorkspace({ name: createName.trim(), branch: 'main' });
      setCreateName('');
      message.success('Workspace created');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete workspace?')) return;
    try {
      await deleteWorkspace(id);
      message.success('Deleted');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await duplicateWorkspace(id);
      message.success('Workspace duplicated');
      load();
    } catch (e) {
      message.error((e as Error).message);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      {onBack && (
        <Button type="text" onClick={onBack} style={{ marginBottom: 16 }}>
          Back
        </Button>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <Input
          placeholder="Workspace name"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          onPressEnter={handleCreate}
          style={{ width: 200 }}
        />
        <Button type="primary" icon={<Plus size={14} />} onClick={handleCreate}>
          Create workspace
        </Button>
        <Button type="text" onClick={() => setShowArchived((a) => !a)}>
          {showArchived ? 'Hide archived' : 'Show archived'}
        </Button>
      </div>
      <List
        loading={loading}
        dataSource={workspaces}
        renderItem={(w) => (
          <List.Item
            actions={[
              <Button key="dup" size="small" onClick={() => handleDuplicate(w.id)}>
                Duplicate
              </Button>,
              <Button key="del" size="small" danger onClick={() => handleDelete(w.id)}>
                Delete
              </Button>,
            ]}
          >
            <List.Item.Meta
              title={w.name ?? w.id}
              description={`Branch: ${w.branch}${w.archived ? ' (archived)' : ''}`}
            />
          </List.Item>
        )}
      />
    </div>
  );
}
