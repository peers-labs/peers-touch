import {
  api,
  type ToolInfo,
} from './desktop_api';

export type { ToolInfo };

export class ToolService {
  async list(): Promise<ToolInfo[]> {
    return api.listTools();
  }
}

export const toolService = new ToolService();
