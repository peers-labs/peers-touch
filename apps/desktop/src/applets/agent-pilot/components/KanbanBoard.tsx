/**
 * Agent Pilot — Kanban board with @dnd-kit
 */
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { KanbanColumn } from './KanbanColumn';
import type { Issue, ProjectStatus } from '../types';
import { updateIssueStatus } from '../api';

interface Props {
  statuses: ProjectStatus[];
  itemsByStatus: Record<string, Issue[]>;
  tagsByIssue?: Record<string, import('../types').Tag[]>;
  workspacesByIssue?: Record<string, string[]>;
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onAddIssue?: (statusId: string) => void;
  onIssueClick?: (issue: Issue) => void;
  onDragEnd?: () => void; // refetch callback
}

export function KanbanBoard({
  statuses,
  itemsByStatus,
  tagsByIssue = {},
  workspacesByIssue = {},
  selectedIds = new Set(),
  onToggleSelect,
  onAddIssue,
  onIssueClick,
  onDragEnd: refetch,
}: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const issueId = active.id as string;
    const destStatusId = over.id as string;
    const sourceData = active.data.current as { issue?: Issue; statusId?: string } | undefined;
    const sourceStatusId = sourceData?.statusId;
    if (!sourceStatusId || sourceStatusId === destStatusId) return;

    try {
      await updateIssueStatus(issueId, destStatusId);
      refetch?.();
    } catch {
      // Ignore for now; could show toast
    }
  };

  const visibleStatuses = statuses
    .filter((s) => !s.hidden)
    .sort((a, b) => a.sort_order - b.sort_order);

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div
        style={{
          display: 'flex',
          gap: 16,
          overflowX: 'auto',
          padding: '8px 0',
          minHeight: 400,
        }}
      >
        {visibleStatuses.map((status) => (
          <KanbanColumn
            key={status.id}
            status={status}
            issues={itemsByStatus[status.id] ?? []}
            tagsByIssue={tagsByIssue}
            workspacesByIssue={workspacesByIssue}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onAddIssue={onAddIssue}
            onIssueClick={onIssueClick}
          />
        ))}
      </div>
    </DndContext>
  );
}
