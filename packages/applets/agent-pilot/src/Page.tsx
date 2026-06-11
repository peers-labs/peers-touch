/**
 * Agent Pilot — Main Page
 *
 * Plan tasks with Kanban, run Coding Agents in workspaces, review diffs, ship via PR.
 */
import { KanbanPage } from './pages/KanbanPage';

interface AgentPilotPageProps {
  onBack?: () => void;
  onPin?: () => void;
  pinned?: boolean;
}

export function AgentPilotPage(props: AgentPilotPageProps) {
  return <KanbanPage {...props} />;
}
