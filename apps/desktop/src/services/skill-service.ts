import { create } from '@bufbuild/protobuf';

import { ReadSkillResourceRequestSchema } from '../gen/proto/domain/agent/skill_pb';
import {
  api,
  type SkillListItem,
  type SkillRecord,
  type SkillResourceNode,
  type BuiltinSkillInfo,
  type BuiltinSkillRecord,
  type SkillImportResult,
  type SkillImportBatchResult,
  type MarketSkillEntry,
  type MarketSkillDetail,
} from './desktop_api';

export type { SkillListItem, SkillRecord, BuiltinSkillInfo, SkillImportResult, SkillImportBatchResult, MarketSkillEntry, MarketSkillDetail };

const STATION_RESOURCE_OWNER = 'station';
const CLIENT_RESOURCE_OWNER = 'client_capability';
const READABLE_RESOURCE_OWNERS = new Set([STATION_RESOURCE_OWNER, CLIENT_RESOURCE_OWNER]);

export interface VersionedSkillResourceInput {
  agentId: string;
  skillId: string;
  version: number;
  path: string;
  owner?: string;
  contentHash?: string;
}

/**
 * Station renders SKILL.md inline, stores only metadata for client-owned
 * resources, and never serves binary assets as text. The predicate is the
 * single gate shared by tree rendering and read dispatch.
 */
export function isTextResourceReadable(
  resource: Pick<SkillResourceNode, 'path' | 'role' | 'executionOwner'>,
): boolean {
  return resource.path !== 'SKILL.md'
    && resource.role !== 'asset'
    && !!resource.executionOwner
    && READABLE_RESOURCE_OWNERS.has(resource.executionOwner);
}

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

  /**
   * Resolves a pinned Skill resource against its declared execution owner.
   * Station-owned text is served from the immutable blob; client-owned text
   * is read from the local read-only managed package directory.
   */
  async readVersionedResource(input: VersionedSkillResourceInput): Promise<string> {
    if (input.owner === STATION_RESOURCE_OWNER) {
      const response = await api.readSkillResource(create(ReadSkillResourceRequestSchema, {
        agentId: input.agentId,
        skillId: input.skillId,
        version: input.version,
        path: input.path,
      }));
      return new TextDecoder().decode(response.content);
    }
    if (input.owner === CLIENT_RESOURCE_OWNER) {
      const response = await api.readManagedSkillResource({
        skillId: input.skillId,
        version: input.version,
        path: input.path,
        contentHash: input.contentHash,
      });
      return response.content;
    }
    throw new Error('agent.skill.resourceOwnerUnsupported');
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
