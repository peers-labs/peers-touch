/**
 * Agent Pilot — Bulk action bar when items are selected
 */
import { useState } from 'react';
import { theme, Button, Select, Input, Space } from 'antd';
import { Trash2 } from 'lucide-react';
import type { ProjectStatus } from '../types';

interface Props {
  selectedCount: number;
  statuses: ProjectStatus[];
  onBulkStatusChange: (statusId: string) => void;
  onBulkPriorityChange: (priority: string) => void;
  onBulkAssigneeChange: (assignee: string) => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

export function BulkActionBar({
  selectedCount,
  statuses,
  onBulkStatusChange,
  onBulkPriorityChange,
  onBulkAssigneeChange,
  onBulkDelete,
  onClearSelection,
}: Props) {
  const { token } = theme.useToken();
  const [assigneeInput, setAssigneeInput] = useState('');

  const handleSetAssignee = () => {
    if (assigneeInput.trim()) {
      onBulkAssigneeChange(assigneeInput.trim());
      setAssigneeInput('');
    }
  };

  if (selectedCount === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '8px 16px',
        background: token.colorPrimaryBg,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <span style={{ fontSize: 13, color: token.colorTextSecondary }}>
        {selectedCount} selected
      </span>
      <Space>
        <Select
          placeholder="Set status"
          allowClear
          style={{ width: 140 }}
          options={statuses.map((s) => ({ label: s.name, value: s.id }))}
          onChange={(v) => v && onBulkStatusChange(v)}
        />
        <Select
          placeholder="Set priority"
          allowClear
          style={{ width: 120 }}
          options={PRIORITIES.map((p) => ({ label: p, value: p }))}
          onChange={(v) => v && onBulkPriorityChange(v)}
        />
        <Input
          placeholder="Assignee"
          value={assigneeInput}
          onChange={(e) => setAssigneeInput(e.target.value)}
          onPressEnter={handleSetAssignee}
          style={{ width: 120 }}
        />
        <Button size="small" onClick={handleSetAssignee}>
          Set
        </Button>
      </Space>
      <Button type="text" danger size="small" icon={<Trash2 size={14} />} onClick={onBulkDelete}>
        Delete
      </Button>
      <Button type="text" size="small" onClick={onClearSelection}>
        Clear selection
      </Button>
    </div>
  );
}
