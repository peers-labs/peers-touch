/**
 * Agent Pilot — Issue card (draggable)
 */
import { useDraggable } from '@dnd-kit/core';
import { theme, Card } from 'antd';
import type { Issue } from '../types';

interface Props {
  issue: Issue;
  onClick?: () => void;
}

export function IssueCard({ issue, onClick }: Props) {
  const { token } = theme.useToken();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: issue.id,
    data: { issue, statusId: issue.status_id },
  });

  return (
    <Card
      ref={setNodeRef}
      size="small"
      style={{
        marginBottom: 8,
        cursor: 'grab',
        opacity: isDragging ? 0.5 : 1,
        borderColor: isDragging ? token.colorPrimary : undefined,
      }}
      {...attributes}
      {...listeners}
      onClick={onClick}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            color: token.colorTextSecondary,
            flexShrink: 0,
          }}
        >
          {issue.simple_id}
        </span>
        <span style={{ flex: 1, fontWeight: 500 }}>{issue.title}</span>
        {issue.priority && (
          <span
            style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              background: token.colorFillSecondary,
              color: token.colorTextSecondary,
            }}
          >
            {issue.priority}
          </span>
        )}
      </div>
      {issue.description && (
        <div
          style={{
            marginTop: 4,
            fontSize: 12,
            color: token.colorTextSecondary,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {issue.description}
        </div>
      )}
    </Card>
  );
}
