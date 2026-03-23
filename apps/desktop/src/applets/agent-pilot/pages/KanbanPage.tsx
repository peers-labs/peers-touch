/**
 * Agent Pilot — Kanban page (project board, create/edit issue)
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { theme, Button, Select, Input, message, Spin, Segmented } from 'antd';
import { Plus, Search, LayoutGrid, List, Settings, Command } from 'lucide-react';
import {
  listProjects,
  listProjectStatuses,
  listIssues,
  listTags,
  createTag,
  createIssue,
  createProject,
  updateIssue,
  deleteIssue,
  duplicateIssue,
  bulkUpdateIssues,
} from '../api';
import type { Issue, Project, ProjectStatus, Tag } from '../types';
import { KanbanBoard } from '../components/KanbanBoard';
import { ListView } from '../components/ListView';
import { BulkActionBar } from '../components/BulkActionBar';
import { IssueFormModal } from '../components/IssueFormModal';
import { IssueDetailDrawer } from '../components/IssueDetailDrawer';
import { ProjectSettingsModal } from '../components/ProjectSettingsModal';
import { CommandBar } from '../components/CommandBar';
import { getKV, setKV } from '../api';

interface Props {
  onBack?: () => void;
  onPin?: () => void;
  pinned?: boolean;
}

const SORT_OPTIONS = [
  { label: 'Sort order', value: 'sort_order' },
  { label: 'Priority', value: 'priority' },
  { label: 'Created', value: 'created_at' },
  { label: 'Updated', value: 'updated_at' },
];

export function KanbanPage({ onBack, onPin, pinned }: Props) {
  const { token } = theme.useToken();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagsByIssue, setTagsByIssue] = useState<Record<string, Tag[]>>({});
  const [workspacesByIssue, setWorkspacesByIssue] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState('sort_order');
  const [sortDesc, setSortDesc] = useState(false);
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueModalMode, setIssueModalMode] = useState<'create' | 'edit'>('create');
  const [issueModalInitial, setIssueModalInitial] = useState<Partial<Issue> | undefined>();
  const [issueModalDefaultStatusId, setIssueModalDefaultStatusId] = useState<string | undefined>();
  const [drawerIssue, setDrawerIssue] = useState<Issue | null>(null);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      if (list.length > 0 && !selectedProjectId) {
        setSelectedProjectId(list[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedProjectId]);

  const loadStatuses = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const list = await listProjectStatuses(selectedProjectId);
      setStatuses(list);
      if (list.length === 0) {
        const list2 = await listProjectStatuses(selectedProjectId);
        setStatuses(list2);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedProjectId]);

  const loadIssues = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const { issues: list, tags_by_issue, workspaces_by_issue } = await listIssues({
        project_id: selectedProjectId,
        limit: 500,
        offset: 0,
      });
      setIssues(list);
      setTagsByIssue(tags_by_issue ?? {});
      setWorkspacesByIssue(workspaces_by_issue ?? {});
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedProjectId]);

  const loadTags = useCallback(async () => {
    if (!selectedProjectId) return;
    try {
      const list = await listTags(selectedProjectId);
      setTags(list);
    } catch (e) {
      // ignore
    }
  }, [selectedProjectId]);

  const KV_KEY = 'kanban_filters';

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      await loadProjects();
      try {
        const raw = await getKV(KV_KEY);
        if (raw) {
          const p = JSON.parse(raw);
          if (p.search !== undefined) setSearch(p.search);
          if (p.priorityFilter !== undefined) setPriorityFilter(p.priorityFilter || null);
          if (p.assigneeFilter !== undefined) setAssigneeFilter(p.assigneeFilter || null);
          if (p.tagFilter !== undefined) setTagFilter(p.tagFilter || null);
          if (p.sortBy !== undefined) setSortBy(p.sortBy);
          if (p.sortDesc !== undefined) setSortDesc(p.sortDesc);
          if (p.viewMode !== undefined) setViewMode(p.viewMode);
        }
      } catch {
        // ignore
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandBarOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const payload = JSON.stringify({
      search,
      priorityFilter,
      assigneeFilter,
      tagFilter,
      sortBy,
      sortDesc,
      viewMode,
    });
    setKV(KV_KEY, payload).catch(() => {});
  }, [search, priorityFilter, assigneeFilter, tagFilter, sortBy, sortDesc, viewMode]);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    (async () => {
      await Promise.all([loadStatuses(), loadIssues(), loadTags()]);
      setLoading(false);
    })();
  }, [selectedProjectId, loadStatuses, loadIssues, loadTags]);

  const refetch = useCallback(() => {
    loadStatuses();
    loadIssues();
    loadTags();
  }, [loadStatuses, loadIssues, loadTags]);

  const filteredAndSortedIssues = useMemo(() => {
    let out = [...issues];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          (i.description?.toLowerCase().includes(q) ?? false) ||
          (i.assignee?.toLowerCase().includes(q) ?? false),
      );
    }
    if (priorityFilter) {
      out = out.filter((i) => i.priority === priorityFilter);
    }
    if (assigneeFilter) {
      out = out.filter((i) => (i.assignee ?? '').toLowerCase() === assigneeFilter.toLowerCase());
    }
    if (tagFilter) {
      out = out.filter((i) => {
        const issueTags = tagsByIssue[i.id] ?? [];
        return issueTags.some((t) => t.id === tagFilter);
      });
    }
    out.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'priority': {
          const order: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
          cmp = (order[a.priority ?? ''] ?? 99) - (order[b.priority ?? ''] ?? 99);
          break;
        }
        case 'created_at':
          cmp = (a.created_at || '').localeCompare(b.created_at || '');
          break;
        case 'updated_at':
          cmp = (a.updated_at || '').localeCompare(b.updated_at || '');
          break;
        default:
          cmp = a.sort_order - b.sort_order;
      }
      return sortDesc ? -cmp : cmp;
    });
    return out;
  }, [issues, search, priorityFilter, assigneeFilter, tagFilter, tagsByIssue, sortBy, sortDesc]);

  const itemsByStatus: Record<string, Issue[]> = useMemo(() => {
    const out: Record<string, Issue[]> = {};
    for (const s of statuses) {
      out[s.id] = filteredAndSortedIssues
        .filter((i) => i.status_id === s.id)
        .sort((a, b) => a.sort_order - b.sort_order);
    }
    return out;
  }, [statuses, filteredAndSortedIssues]);

  const handleAddIssue = useCallback(
    (statusId?: string) => {
      setIssueModalMode('create');
      setIssueModalInitial(undefined);
      setIssueModalDefaultStatusId(statusId ?? statuses[0]?.id);
      setIssueModalOpen(true);
    },
    [statuses],
  );

  const handleIssueClick = useCallback((issue: Issue) => {
    setDrawerIssue(issue);
  }, []);

  const handleEditFromDrawer = useCallback((issue: Issue) => {
    setDrawerIssue(null);
    setIssueModalMode('edit');
    setIssueModalInitial(issue);
    setIssueModalDefaultStatusId(issue.status_id);
    setIssueModalOpen(true);
  }, []);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleToggleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedIds(new Set(filteredAndSortedIssues.map((i) => i.id)));
      } else {
        setSelectedIds(new Set());
      }
    },
    [filteredAndSortedIssues],
  );

  const handleBulkStatusChange = useCallback(
    async (statusId: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      try {
        await bulkUpdateIssues(ids, { status_id: statusId });
        message.success('Status updated');
        setSelectedIds(new Set());
        refetch();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
    [selectedIds, refetch],
  );

  const handleBulkPriorityChange = useCallback(
    async (priority: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      try {
        await bulkUpdateIssues(ids, { priority });
        message.success('Priority updated');
        setSelectedIds(new Set());
        refetch();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
    [selectedIds, refetch],
  );

  const handleBulkAssigneeChange = useCallback(
    async (assignee: string) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      try {
        await bulkUpdateIssues(ids, { assignee });
        message.success('Assignee updated');
        setSelectedIds(new Set());
        refetch();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
    [selectedIds, refetch],
  );

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} issue(s)?`)) return;
    try {
      for (const id of ids) {
        await deleteIssue(id);
      }
      message.success('Deleted');
      setSelectedIds(new Set());
      refetch();
    } catch (e) {
      message.error((e as Error).message);
    }
  }, [selectedIds, refetch]);

  const handleCreateTag = useCallback(
    async (name: string) => {
      if (!selectedProjectId) throw new Error('No project');
      return createTag({ project_id: selectedProjectId, name });
    },
    [selectedProjectId],
  );

  const handleIssueModalOk = useCallback(
    async (values: {
      title: string;
      description?: string;
      status_id: string;
      priority?: string;
      assignee?: string;
      parent_issue_id?: string;
      tag_ids?: string[];
    }) => {
      if (!selectedProjectId) return;
      try {
        if (issueModalMode === 'create') {
          await createIssue({
            project_id: selectedProjectId,
            title: values.title,
            description: values.description,
            status_id: values.status_id,
            priority: values.priority,
            assignee: values.assignee,
            parent_issue_id: values.parent_issue_id,
            tag_ids: values.tag_ids,
          });
          message.success('Issue created');
        } else if (issueModalInitial?.id) {
          await updateIssue(issueModalInitial.id, {
            title: values.title,
            description: values.description,
            status_id: values.status_id,
            priority: values.priority,
            assignee: values.assignee,
            parent_issue_id: values.parent_issue_id,
            tag_ids: values.tag_ids,
          });
          message.success('Issue updated');
        }
        setIssueModalOpen(false);
        refetch();
      } catch (e) {
        message.error((e as Error).message);
      }
    },
    [selectedProjectId, issueModalMode, issueModalInitial, refetch],
  );

  const handleCreateProject = useCallback(async () => {
    const name = prompt('Project name');
    if (!name?.trim()) return;
    try {
      const p = await createProject({ name: name.trim() });
      setProjects((prev) => [...prev, p].sort((a, b) => a.sort_order - b.sort_order));
      setSelectedProjectId(p.id);
      message.success('Project created');
    } catch (e) {
      message.error((e as Error).message);
    }
  }, []);

  const initialTagIds = issueModalInitial?.id ? (tagsByIssue[issueModalInitial.id] ?? []).map((t) => t.id) : [];

  if (loading && projects.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <p style={{ color: token.colorError }}>{error}</p>
        <Button onClick={() => loadProjects()}>Retry</Button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '16px 24px',
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        {onBack && (
          <Button type="text" onClick={onBack} size="small">
            Back
          </Button>
        )}
        <Select
          placeholder="Select project"
          value={selectedProjectId}
          onChange={setSelectedProjectId}
          style={{ minWidth: 200 }}
          options={projects.map((p) => ({ label: p.name, value: p.id }))}
          notFoundContent="No projects"
        />
        <Button type="primary" icon={<Plus size={14} />} onClick={handleCreateProject}>
          New project
        </Button>
        <Button icon={<Plus size={14} />} onClick={() => handleAddIssue()}>
          New issue
        </Button>
        {selectedProjectId && (
          <Button
            type="text"
            icon={<Settings size={14} />}
            onClick={() => setProjectSettingsOpen(true)}
            title="Project settings"
          />
        )}
        <Button
          type="text"
          icon={<Command size={14} />}
          onClick={() => setCommandBarOpen(true)}
          title="Command bar (⌘K)"
        />
        <Input
          placeholder="Search..."
          prefix={<Search size={14} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 180 }}
          allowClear
        />
        <Select
          placeholder="Priority"
          value={priorityFilter}
          onChange={setPriorityFilter}
          style={{ width: 120 }}
          allowClear
          options={[
            { label: 'Low', value: 'low' },
            { label: 'Medium', value: 'medium' },
            { label: 'High', value: 'high' },
            { label: 'Urgent', value: 'urgent' },
          ]}
        />
        <Select
          placeholder="Assignee"
          value={assigneeFilter}
          onChange={setAssigneeFilter}
          style={{ width: 120 }}
          allowClear
          options={Array.from(new Set(issues.map((i) => i.assignee).filter((a): a is string => !!a)))
            .sort()
            .map((a) => ({ label: `@${a}`, value: a }))}
        />
        <Select
          placeholder="Tag"
          value={tagFilter}
          onChange={setTagFilter}
          style={{ width: 120 }}
          allowClear
          options={tags.map((t) => ({ label: t.name, value: t.id }))}
        />
        <Segmented
          value={viewMode}
          onChange={(v) => setViewMode(v as 'kanban' | 'list')}
          options={[
            { label: <LayoutGrid size={14} />, value: 'kanban' },
            { label: <List size={14} />, value: 'list' },
          ]}
        />
        <Select
          value={sortBy}
          onChange={(v) => setSortBy(v)}
          style={{ width: 120 }}
          options={SORT_OPTIONS}
        />
        <Button type="text" size="small" onClick={() => setSortDesc((d) => !d)}>
          {sortDesc ? '↓' : '↑'}
        </Button>
        <div style={{ flex: 1 }} />
        {onPin && (
          <Button type="text" size="small" onClick={onPin}>
            {pinned ? 'Unpin' : 'Pin'} to sidebar
          </Button>
        )}
      </div>

      <BulkActionBar
        selectedCount={selectedIds.size}
        statuses={statuses}
        onBulkStatusChange={handleBulkStatusChange}
        onBulkPriorityChange={handleBulkPriorityChange}
        onBulkAssigneeChange={handleBulkAssigneeChange}
        onBulkDelete={handleBulkDelete}
        onClearSelection={() => setSelectedIds(new Set())}
      />

      <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
        {!selectedProjectId ? (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: 200,
              color: token.colorTextSecondary,
            }}
          >
            Select or create a project
          </div>
        ) : loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
            <Spin />
          </div>
        ) : viewMode === 'list' ? (
          <ListView
            issues={filteredAndSortedIssues}
            statuses={statuses}
            tagsByIssue={tagsByIssue}
            workspacesByIssue={workspacesByIssue}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            onIssueClick={handleIssueClick}
          />
        ) : (
          <KanbanBoard
            statuses={statuses}
            itemsByStatus={itemsByStatus}
            tagsByIssue={tagsByIssue}
            workspacesByIssue={workspacesByIssue}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onAddIssue={handleAddIssue}
            onIssueClick={handleIssueClick}
            onDragEnd={refetch}
          />
        )}
      </div>

      <IssueFormModal
        open={issueModalOpen}
        mode={issueModalMode}
        projectId={selectedProjectId ?? ''}
        statuses={statuses}
        tags={tags}
        allIssues={issues}
        onCreateTag={handleCreateTag}
        initial={issueModalInitial}
        initialTagIds={initialTagIds}
        defaultStatusId={issueModalDefaultStatusId}
        onDelete={
          issueModalMode === 'edit' && issueModalInitial?.id
            ? async (id) => {
                await deleteIssue(id);
                message.success('Issue deleted');
                setIssueModalOpen(false);
                refetch();
              }
            : undefined
        }
        onDuplicate={
          issueModalMode === 'edit' && issueModalInitial?.id
            ? async (id) => {
                await duplicateIssue(id);
                message.success('Issue duplicated');
                setIssueModalOpen(false);
                refetch();
              }
            : undefined
        }
        onOk={handleIssueModalOk}
        onCancel={() => setIssueModalOpen(false)}
      />

      <IssueDetailDrawer
        open={!!drawerIssue}
        issue={drawerIssue}
        tags={drawerIssue ? (tagsByIssue[drawerIssue.id] ?? []) : []}
        onClose={() => setDrawerIssue(null)}
        onRefresh={refetch}
        onEdit={handleEditFromDrawer}
      />

      <ProjectSettingsModal
        open={projectSettingsOpen}
        project={projects.find((p) => p.id === selectedProjectId) ?? null}
        onClose={() => setProjectSettingsOpen(false)}
        onSaved={refetch}
      />

      <CommandBar
        open={commandBarOpen}
        onClose={() => setCommandBarOpen(false)}
        actions={[
          { id: 'new-issue', label: 'New issue', shortcut: '⌘N', run: () => handleAddIssue() },
          { id: 'new-project', label: 'New project', run: handleCreateProject },
          { id: 'settings', label: 'Project settings', run: () => setProjectSettingsOpen(true) },
        ]}
      />
    </div>
  );
}
