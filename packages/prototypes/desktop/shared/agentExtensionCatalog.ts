export type PrototypeExtensionKind = 'skill' | 'mcp';
export type PrototypeSkillSource = 'user' | 'github' | 'builtin' | 'market';
export type PrototypeScanState = 'passed' | 'warning';
export type PrototypeMcpTransport = 'stdio' | 'http' | 'sse';
export type PrototypeMcpTestState = 'idle' | 'testing' | 'ok' | 'error';

export interface PrototypeSkillCatalogItem {
  id: string;
  name: string;
  desc: string;
  source: PrototypeSkillSource;
  scan: PrototypeScanState;
  enabled: boolean;
  installed: boolean;
}

export interface PrototypeMcpCatalogItem {
  id: string;
  name: string;
  transport: PrototypeMcpTransport;
  endpoint: string;
  enabled: boolean;
  toolCount: number;
  tools: string[];
  test: PrototypeMcpTestState;
}

export interface PrototypeAgentExtension {
  id: string;
  kind: PrototypeExtensionKind;
  name: string;
  description: string;
}

export const PROTOTYPE_SKILLS: PrototypeSkillCatalogItem[] = [
  {
    id: 'skill.meeting-digest',
    name: 'Meeting digest',
    desc: 'Compress meeting notes into actionable items.',
    source: 'github',
    scan: 'passed',
    enabled: true,
    installed: true,
  },
  {
    id: 'skill.pdf-extract',
    name: 'PDF extract',
    desc: 'Extract structured fields from PDF documents.',
    source: 'user',
    scan: 'warning',
    enabled: true,
    installed: true,
  },
  {
    id: 'skill.web-research',
    name: 'Web research',
    desc: 'Search the web and synthesize cited findings.',
    source: 'builtin',
    scan: 'passed',
    enabled: true,
    installed: true,
  },
  {
    id: 'skill.code-review',
    name: 'Code review',
    desc: 'Review changes against the project contracts.',
    source: 'builtin',
    scan: 'passed',
    enabled: false,
    installed: true,
  },
  {
    id: 'skill.translate-pro',
    name: 'Translate pro',
    desc: 'Translate with consistent terminology.',
    source: 'market',
    scan: 'passed',
    enabled: false,
    installed: false,
  },
  {
    id: 'skill.sql-explain',
    name: 'SQL explain',
    desc: 'Explain and optimize SQL queries.',
    source: 'market',
    scan: 'passed',
    enabled: false,
    installed: false,
  },
  {
    id: 'skill.image-caption',
    name: 'Image caption',
    desc: 'Generate descriptive captions for images.',
    source: 'market',
    scan: 'passed',
    enabled: false,
    installed: false,
  },
];

export const PROTOTYPE_MCP_SERVERS: PrototypeMcpCatalogItem[] = [
  {
    id: 'mcp.integrated-browser',
    name: 'Integrated browser',
    transport: 'stdio',
    endpoint: 'npx @pt/mcp-browser',
    enabled: true,
    toolCount: 6,
    tools: ['navigate', 'click', 'snapshot', 'type', 'screenshot', 'evaluate'],
    test: 'ok',
  },
  {
    id: 'mcp.web-search',
    name: 'Web search',
    transport: 'http',
    endpoint: 'https://mcp.example.com/search',
    enabled: true,
    toolCount: 2,
    tools: ['search', 'fetch'],
    test: 'idle',
  },
  {
    id: 'mcp.filesystem',
    name: 'Filesystem',
    transport: 'stdio',
    endpoint: 'npx @pt/mcp-fs',
    enabled: false,
    toolCount: 4,
    tools: ['read', 'write', 'list', 'stat'],
    test: 'idle',
  },
];

export function buildAgentExtensionCatalog(targetSize = 0): PrototypeAgentExtension[] {
  const base: PrototypeAgentExtension[] = [
    ...PROTOTYPE_SKILLS
      .filter((skill) => skill.installed)
      .map((skill) => ({
        id: skill.id,
        kind: 'skill' as const,
        name: skill.name,
        description: skill.desc,
      })),
    ...PROTOTYPE_MCP_SERVERS.map((server) => ({
      id: server.id,
      kind: 'mcp' as const,
      name: server.name,
      description: `${server.transport.toUpperCase()} server with ${server.toolCount} tools.`,
    })),
  ];

  const currentSkillCount = base.filter((extension) => extension.kind === 'skill').length;
  const skillCount = Number.isFinite(targetSize)
    ? Math.max(currentSkillCount, Math.floor(targetSize))
    : currentSkillCount;

  for (let index = currentSkillCount; index < skillCount; index += 1) {
    base.push({
      id: `skill.review-${index + 1}`,
      kind: 'skill',
      name: `Review skill ${String(index + 1).padStart(3, '0')}`,
      description: 'Synthetic catalog entry used only for large-directory review.',
    });
  }

  return base;
}
