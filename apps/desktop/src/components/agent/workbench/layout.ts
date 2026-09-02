export const AGENT_WORKBENCH_NARROW_WIDTH = 900;

export interface AgentWorkbenchLayout {
  narrow: boolean;
  agentRail: 'expanded' | 'collapsed';
  topicRail: 'expanded' | 'collapsed' | 'hidden';
  inspectorVisible: boolean;
}

export function deriveAgentWorkbenchLayout(
  width: number,
  agentRailOpen: boolean,
  topicRailOpen: boolean,
): AgentWorkbenchLayout {
  const narrow = width > 0 && width < AGENT_WORKBENCH_NARROW_WIDTH;
  return {
    narrow,
    agentRail: narrow || !agentRailOpen ? 'collapsed' : 'expanded',
    topicRail: narrow ? 'hidden' : topicRailOpen ? 'expanded' : 'collapsed',
    inspectorVisible: !narrow,
  };
}
