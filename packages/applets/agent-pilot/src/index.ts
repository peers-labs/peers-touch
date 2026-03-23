/**
 * Agent Pilot Applet — Frontend Extension
 *
 * Plan tasks with Kanban, run Coding Agents in workspaces, review diffs, ship via PR.
 */
import { Plane } from 'lucide-react';
import { registerApplet } from '../registry';
import { AgentPilotPage } from './Page';

registerApplet({
  id: 'agent-pilot',
  page: AgentPilotPage,
  sidebarIcon: Plane,
});
