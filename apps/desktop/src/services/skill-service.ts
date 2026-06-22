import {
  api,
  type SkillListItem,
  type SkillRecord,
  type BuiltinSkillInfo,
  type BuiltinSkillRecord,
  type SkillImportResult,
  type SkillImportBatchResult,
  type MarketSkillEntry,
  type MarketSkillDetail,
} from './desktop_api';

export type { SkillListItem, SkillRecord, BuiltinSkillInfo, SkillImportResult, SkillImportBatchResult, MarketSkillEntry, MarketSkillDetail };

export class SkillService {
  async list(source?: string): Promise<{ skills: SkillListItem[]; builtin: BuiltinSkillInfo[] }> {
    return api.listSkills(source);
  }

  async search(query: string, limit?: number): Promise<{ skills: SkillListItem[] }> {
    return api.searchSkills(query, limit);
  }

  async get(id: string): Promise<SkillRecord> {
    return api.getSkill(id);
  }

  async getBuiltin(identifier: string): Promise<BuiltinSkillRecord> {
    return api.getBuiltinSkill(identifier);
  }

  async create(name: string, content: string): Promise<SkillImportResult> {
    return api.createSkill(name, content);
  }

  async update(id: string, data: Partial<SkillRecord>): Promise<{ ok: boolean }> {
    return api.updateSkill(id, data);
  }

  async delete(id: string): Promise<{ ok: boolean }> {
    return api.deleteSkill(id);
  }

  async toggle(id: string, enabled: boolean): Promise<{ ok: boolean }> {
    return api.toggleSkill(id, enabled);
  }

  async importFromAddress(address: string, oauthProvider?: string): Promise<SkillImportBatchResult> {
    return api.importSkillFromAddress(address, oauthProvider);
  }

  async importFromGitHub(owner: string, repo: string, branch?: string, filePath?: string): Promise<SkillImportResult> {
    return api.importSkillFromGitHub(owner, repo, branch, filePath);
  }

  async importFromZIP(file: File): Promise<SkillImportResult> {
    return api.importSkillFromZIP(file);
  }

  async listMarketSkills(marketId: string, q?: string): Promise<{ skills: MarketSkillEntry[]; total: number }> {
    return api.listMarketSkills(marketId, q);
  }

  async getMarketSkillDetail(marketId: string, filePath: string): Promise<MarketSkillDetail> {
    return api.getMarketSkillDetail(marketId, filePath);
  }

  async installMarketSkill(marketId: string, filePath: string): Promise<SkillImportResult> {
    return api.installMarketSkill(marketId, filePath);
  }
}

export const skillService = new SkillService();
