/**
 * Agent Pilot — Kanban page (project board, create/edit issue)
 */
import { useState, useEffect, useCallback } from 'react';
import { theme, Button, Select, message, Spin } from 'antd';
import { Plus } from 'lucide-react';
import {
  listProjects,
  listProjectStatuses,
  listIssues,
  createIssue,
  createProject,
  updateIssue,
} from '../api';
import type { Issue, Project, ProjectStatus } from '../types';
import { KanbanBoard } from '../components/KanbanBoard';
import { IssueFormModal } from '../components/IssueFormModal';

interface Props {
  onBack?: () => void;
  onPin?: () => void;
  pinned?: boolean;
}

export function KanbanPage({ onBack, onPin, pinned }: Props) {
  const { token } = theme.useToken();

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<ProjectStatus[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [issueModalOpen, setIssueModalOpen] = useState(false);
  const [issueModalMode, setIssueModalMode] = useState<'create' | 'edit'>('create');
  const [issueModalInitial, setIssueModalInitial] = useState<Partial<Issue> | undefined>();
  const [issueModalDefaultStatusId, setIssueModalDefaultStatusId] = useState<string | undefined>();

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
        // Backend ensures default statuses on create-project; may need to refetch
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
      const { issues: list } = await listIssues({
        project_id: selectedProjectId,
        limit: 500,
        offset: 0,
      });
      setIssues(list);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      await loadProjects();
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    setLoading(true);
    (async () => {
      await Promise.all([loadStatuses(), loadIssues()]);
      setLoading(false);
    })();
  }, [selectedProjectId, loadStatuses, loadIssues]);

  const refetch = useCallback(() => {
    loadStatuses();
    loadIssues();
  }, [loadStatuses, loadIssues]);

  const itemsByStatus: Record<string, Issue[]> = {};
  for (const s of statuses) {
    itemsByStatus[s.id] = issues
      .filter((i) => i.status_id === s.id)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

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
    setIssueModalMode('edit');
    setIssueModalInitial(issue);
    setIssueModalDefaultStatusId(issue.status_id);
    setIssueModalOpen(true);
  }, []);

  const handleIssueModalOk = useCallback(
    async (values: { title: string; description?: string; status_id: string; priority?: string }) => {
      if (!selectedProjectId) return;
      try {
        if (issueModalMode === 'create') {
          await createIssue({
            project_id: selectedProjectId,
            title: values.title,
            description: values.description,
            status_id: values.status_id,
            priority: values.priority,
          });
          message.success('Issue created');
        } else if (issueModalInitial?.id) {
          await updateIssue(issueModalInitial.id, {
            title: values.title,
            description: values.description,
            status_id: values.status_id,
            priority: values.priority,
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
        <div style={{ flex: 1 }} />
        {onPin && (
          <Button type="text" size="small" onClick={onPin}>
            {pinned ? 'Unpin' : 'Pin'} to sidebar
          </Button>
        )}
      </div>

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
        ) : (
          <KanbanBoard
            statuses={statuses}
            itemsByStatus={itemsByStatus}
            onAddIssue={handleAddIssue}
            onIssueClick={handleIssueClick}
            onDragEnd={refetch}
          />
        )}
      </div>

      <IssueFormModal
        open={issueModalOpen}
        mode={issueModalMode}
        statuses={statuses}
        initial={issueModalInitial}
        defaultStatusId={issueModalDefaultStatusId}
        onOk={handleIssueModalOk}
        onCancel={() => setIssueModalOpen(false)}
      />
    </div>
  );
}
