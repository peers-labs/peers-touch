/**
 * Agent Pilot — Kanban column (droppable)
 */
import { useDroppable } from '@dnd-kit/core';
import { theme, Button } from 'antd';
import { Plus } from 'lucide-react';
import type { ProjectStatus } from '../types';
import { IssueCard } from './IssueCard';
import type { Issue } from '../types';

interface Props {
  status: ProjectStatus;
  issues: Issue[];
  onAddIssue?: (statusId: string) => void;
  onIssueClick?: (issue: Issue) => void;
}

export function KanbanColumn({ status, issues, onAddIssue, onIssueClick }: Props) {
  const { token } = theme.useToken();
  const { setNodeRef, isOver } = useDroppable({
    id: status.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        flex: '0 0 280px',
        minWidth: 280,
        background: isOver ? token.colorFillQuaternary : token.colorFillTertiary,
        borderRadius: token.borderRadiusLG,
        padding: 12,
        border: `2px dashed ${isOver ? token.colorPrimary : 'transparent'}`,
        transition: 'all 0.15s',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: status.color || token.colorPrimary,
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{status.name}</span>
          <span
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              background: token.colorFillSecondary,
              padding: '2px 6px',
              borderRadius: 4,
            }}
          >
            {issues.length}
          </span>
        </div>
        {onAddIssue && (
          <Button
            type="text"
            size="small"
            icon={<Plus size={14} />}
            onClick={() => onAddIssue(status.id)}
            aria-label="Add issue"
          />
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 40 }}>
        {issues.map((issue) => (
          <IssueCard
            key={issue.id}
            issue={issue}
            onClick={() => onIssueClick?.(issue)}
          />
        ))}
      </div>
    </div>
  );
}
