/**
 * Agent Pilot — List view of issues (table)
 */
import { theme, Table, Checkbox } from 'antd';
import type { Issue, ProjectStatus, Tag } from '../types';

interface Props {
  issues: Issue[];
  statuses: ProjectStatus[];
  tagsByIssue: Record<string, Tag[]>;
  workspacesByIssue?: Record<string, string[]>;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
  onIssueClick: (issue: Issue) => void;
}

export function ListView({
  issues,
  statuses,
  tagsByIssue,
  workspacesByIssue = {},
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onIssueClick,
}: Props) {
  const { token } = theme.useToken();
  const statusMap = Object.fromEntries(statuses.map((s) => [s.id, s.name]));

  const columns = [
    {
      title: (
        <Checkbox
          checked={issues.length > 0 && issues.every((i) => selectedIds.has(i.id))}
          indeterminate={selectedIds.size > 0 && selectedIds.size < issues.length}
          onChange={(e) => onToggleSelectAll(e.target.checked)}
        />
      ),
      width: 40,
      render: (_: unknown, r: Issue) => (
        <Checkbox
          checked={selectedIds.has(r.id)}
          onChange={() => onToggleSelect(r.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      title: 'ID',
      dataIndex: 'simple_id',
      width: 90,
      render: (v: string) => (
        <span style={{ fontSize: 12, color: token.colorTextSecondary }}>{v}</span>
      ),
    },
    {
      title: 'Title',
      dataIndex: 'title',
      ellipsis: true,
      render: (v: string, r: Issue) => (
        <span
          style={{ fontWeight: 500, cursor: 'pointer' }}
          onClick={() => onIssueClick(r)}
          onKeyDown={(e) => e.key === 'Enter' && onIssueClick(r)}
          role="button"
          tabIndex={0}
        >
          {v}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status_id',
      width: 110,
      render: (v: string) => statusMap[v] ?? v,
    },
    {
      title: 'Priority',
      dataIndex: 'priority',
      width: 90,
      render: (v: string) =>
        v ? (
          <span
            style={{
              fontSize: 11,
              padding: '1px 6px',
              borderRadius: 4,
              background: token.colorFillSecondary,
            }}
          >
            {v}
          </span>
        ) : null,
    },
    {
      title: 'Assignee',
      dataIndex: 'assignee',
      width: 100,
      render: (v: string) => (v ? `@${v}` : null),
    },
    {
      title: 'WS',
      key: 'workspaces',
      width: 50,
      render: (_: unknown, r: Issue) => {
        const count = (workspacesByIssue[r.id] ?? []).length;
        return count > 0 ? `📁×${count}` : null;
      },
    },
    {
      title: 'Tags',
      key: 'tags',
      width: 140,
      render: (_: unknown, r: Issue) => {
        const tags = tagsByIssue[r.id] ?? [];
        return (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
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
          </span>
        );
      },
    },
  ];

  return (
    <Table
      size="small"
      dataSource={issues}
      columns={columns}
      rowKey="id"
      pagination={false}
      showHeader
      onRow={(r) => ({
        style: { cursor: 'pointer' },
        onClick: () => onIssueClick(r),
      })}
    />
  );
}
