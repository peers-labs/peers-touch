export const AGENT_WORKBENCH_NARROW_WIDTH = 900;
export const AGENT_WORKBENCH_ULTRA_NARROW_WIDTH = 560;

export interface AgentWorkbenchLayout {
  narrow: boolean;
  ultraNarrow: boolean;
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
    ultraNarrow: width > 0 && width < AGENT_WORKBENCH_ULTRA_NARROW_WIDTH,
    agentRail: agentRailOpen ? 'expanded' : 'collapsed',
    topicRail: topicRailOpen && !(narrow && agentRailOpen) ? 'expanded' : 'collapsed',
    inspectorVisible: !narrow,
  };
}
