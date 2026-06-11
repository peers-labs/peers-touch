/**
 * Agent Pilot Applet — Frontend Extension
 *
 * Plan tasks with Kanban, run Coding Agents in workspaces, review diffs, ship via PR.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AgentPilotPage } from './Page';

const root = document.getElementById('root');
if (!root) {
  throw new Error('agent-pilot root element is missing');
}

createRoot(root).render(createElement(AgentPilotPage, {}));
