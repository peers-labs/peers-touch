/**
 * Agent Pilot — Main Page
 *
 * Plan tasks with Kanban, run Coding Agents in workspaces, review diffs, ship via PR.
 */
import type { AppletPageProps } from '@peers-touch/applet-sdk';
import { KanbanPage } from './pages/KanbanPage';

export function AgentPilotPage(props: AppletPageProps) {
  return <KanbanPage {...props} />;
}
