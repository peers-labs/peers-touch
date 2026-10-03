import {
  api,
  type MCPServerItem,
  type MCPServerRecord,
} from './desktop_api';

export type { MCPServerItem, MCPServerRecord };

export interface MCPServerConfig {
  name: string;
  type: MCPServerRecord['type'];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  enabled?: boolean;
}

export class MCPService {
  async list(): Promise<MCPServerItem[]> {
    return api.listMCPServers();
  }

  async get(name: string): Promise<MCPServerRecord> {
    return api.getMCPServer(name);
  }

  async create(config: Partial<MCPServerRecord>): Promise<MCPServerRecord> {
    return api.createMCPServer(config);
  }

  async update(
    name: string,
    config: Partial<MCPServerRecord>,
  ): Promise<MCPServerRecord> {
    return api.updateMCPServer(name, config);
  }

  async delete(name: string): Promise<void> {
    await api.deleteMCPServer(name);
  }

  async toggle(name: string, enabled: boolean): Promise<MCPServerRecord> {
    return api.toggleMCPServer(name, enabled);
  }

  async refresh(name: string): Promise<MCPServerRecord> {
    return api.refreshMCPServer(name);
  }
}

export const mcpService = new MCPService();
