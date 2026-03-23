/**
 * Agent Pilot — Issue card (draggable)
 */
import { useDraggable } from '@dnd-kit/core';
import { theme, Card, Checkbox } from 'antd';
import type { Issue, Tag } from '../types';

interface Props {
  issue: Issue;
  tags?: Tag[];
  workspaceCount?: number;
  selected?: boolean;
  onToggleSelect?: () => void;
  onClick?: () => void;
}

export function IssueCard({ issue, tags = [], workspaceCount = 0, selected, onToggleSelect, onClick }: Props) {
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
        {onToggleSelect && (
          <Checkbox
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect();
            }}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <span
          style={{
            fontSize: 11,
            color: token.colorTextSecondary,
            flexShrink: 0,
          }}
        >
          {issue.parent_issue_id ? '↳ ' : ''}
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
      {(issue.assignee || tags.length > 0 || workspaceCount > 0) && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4, alignItems: 'center' }}>
          {issue.assignee && (
            <span
              style={{
                fontSize: 10,
                color: token.colorTextSecondary,
                background: token.colorFillTertiary,
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              @{issue.assignee}
            </span>
          )}
          {workspaceCount > 0 && (
            <span
              style={{
                fontSize: 10,
                color: token.colorTextSecondary,
                background: token.colorFillTertiary,
                padding: '1px 6px',
                borderRadius: 4,
              }}
              title={`${workspaceCount} workspace(s)`}
            >
              📁×{workspaceCount}
            </span>
          )}
          {tags.map((t) => (
            <span
              key={t.id}
              style={{
                fontSize: 10,
                padding: '1px 6px',
                borderRadius: 4,
                background: t.color || token.colorFillSecondary,
                color: '#fff',
              }}
            >
              {t.name}
            </span>
          ))}
        </div>
      )}
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
