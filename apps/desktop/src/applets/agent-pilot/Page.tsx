/**
 * Agent Pilot — Main Page
 *
 * Plan tasks with Kanban, run Coding Agents in workspaces, review diffs, ship via PR.
 */
import { useState } from 'react';
import { Tabs } from 'antd';
import type { AppletPageProps } from '../registry';
import { KanbanPage } from './pages/KanbanPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { ReposPage } from './pages/ReposPage';

export function AgentPilotPage(props: AppletPageProps) {
  const [tab, setTab] = useState('kanban');

  return (
    <Tabs
      activeKey={tab}
      onChange={setTab}
      items={[
        { key: 'kanban', label: 'Kanban', children: <KanbanPage {...props} /> },
        { key: 'workspaces', label: 'Workspaces', children: <WorkspacesPage /> },
        { key: 'repos', label: 'Repos', children: <ReposPage /> },
      ]}
      style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    />
  );
}
