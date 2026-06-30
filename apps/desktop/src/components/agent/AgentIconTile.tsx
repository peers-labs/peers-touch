import { theme } from 'antd';
import {
  AlertTriangle,
  Bot,
  BrainCircuit,
  Code2,
  FileText,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { Agent } from '../../services/desktop_api';

export type AgentIconSource = Partial<Pick<Agent, 'title' | 'name' | 'description' | 'tags'>>;

export function getAgentIcon(agent?: AgentIconSource | null): LucideIcon {
  const source = [agent?.title, agent?.name, agent?.description, agent?.tags].join(' ').toLowerCase();
  if (/risk|review|verify|validate|test|风险|评审|验证|测试/.test(source)) return AlertTriangle;
  if (/code|build|implement|dev|实现|代码|开发/.test(source)) return Code2;
  if (/research|search|source|资料|研究|检索/.test(source)) return Search;
  if (/summary|report|write|doc|总结|报告|文档/.test(source)) return FileText;
  if (/architect|design|plan|架构|设计|规划/.test(source)) return BrainCircuit;
  return Bot;
}

export function AgentIconTile({
  agent,
  size,
  selected = false,
  subtle = false,
}: {
  agent?: AgentIconSource | null;
  size: number;
  selected?: boolean;
  subtle?: boolean;
}) {
  const { token } = theme.useToken();
  const Icon = getAgentIcon(agent);
  const color = selected ? token.colorPrimary : token.colorTextSecondary;

  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: Math.max(8, Math.round(size * 0.3)),
        background: selected ? token.colorPrimaryBg : subtle ? 'transparent' : token.colorFillQuaternary,
        color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <Icon size={Math.max(14, Math.round(size * 0.5))} />
    </span>
  );
}
