import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { SkillManifest } from '../../gen/proto/domain/agent/skill_pb';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import type { SettingsDraftOwner } from './SettingsExitBoundary';
import { useAgentKnowledgeScope } from './useAgentKnowledgeScope';
import { useSettingsRequests } from './useSettingsRequests';

export interface SkillDraft {
  readonly name: string;
  readonly description: string;
  readonly content: string;
  readonly enabled: boolean;
}
const emptyDraft: SkillDraft = { name: '', description: '', content: '', enabled: true };
const toDraft = (entry: SkillManifest): SkillDraft => ({
  name: entry.name, description: entry.description, content: entry.content, enabled: entry.enabled,
});
const matches = (entry: SkillManifest, draft: SkillDraft) => JSON.stringify(toDraft(entry)) === JSON.stringify(draft);

export function useSkillSettingsController(session: MobileAuthSession | null) {
  const scope = useAgentKnowledgeScope(session);
  const { gateway, agentId } = scope;
  const identity = useMemo(() => ({ gateway, agentId }), [gateway, agentId]);
  const requests = useSettingsRequests(identity);
  const [skills, setSkills] = useState<readonly SkillManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillManifest | null>(null);
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const readRevision = useRef(0);
  const detailRevision = useRef(0);
  const original = selectedSkill;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(original ? toDraft(original) : emptyDraft);
  const loadList = useCallback(async () => {
    const revision = ++readRevision.current;
    setLoading(true);
    const response = gateway && agentId
      ? await requests.run((signal) => gateway.listSkills(agentId, signal)) : null;
    if (revision !== readRevision.current) return;
    if (response) setSkills(response.skills);
    setLoading(false);
  }, [gateway, agentId, requests.run]);
  useEffect(() => {
    setSkills([]);
    setDraft(null);
    setSelectedId(null);
    setSelectedSkill(null);
    setDetailLoading(false);
    void loadList();
    return () => { readRevision.current += 1; detailRevision.current += 1; };
  }, [loadList]);
  const select = async (id: string | null) => {
    if (requests.busy) return;
    const revision = ++detailRevision.current;
    setSelectedId(id);
    setSelectedSkill(null);
    setDraft(id === '' ? emptyDraft : null);
    setDetailLoading(false);
    setSaveStatus('idle');
    requests.clearError();
    if (!id || !gateway) return;
    setDetailLoading(true);
    // Tier-one list records intentionally omit instructions. Editing always
    // starts from the complete, freshly read tier-two record.
    const response = await requests.run((signal) => gateway.getSkill(agentId, id, signal));
    if (revision !== detailRevision.current) return;
    if (response?.skill) {
      setSelectedSkill(response.skill);
      setDraft(toDraft(response.skill));
    }
    setDetailLoading(false);
  };
  const reload = async () => {
    await loadList();
    if (!gateway || !selectedId) return;
    const revision = detailRevision.current;
    const response = await requests.run((signal) => gateway.getSkill(agentId, selectedId, signal));
    const nextSkill = response?.skill;
    if (revision !== detailRevision.current || !nextSkill) return;
    setSelectedSkill(nextSkill);
    setDraft((current) => current ?? toDraft(nextSkill));
  };
  const discard = () => {
    if (!original) { void select(null); return; }
    setDraft(toDraft(original));
    setSaveStatus('idle');
    requests.clearError();
  };
  const accept = (entry: SkillManifest) => {
    setSkills((current) => [...current.filter((value) => value.skillId !== entry.skillId), entry]);
    setSelectedId(entry.skillId);
    setSelectedSkill(entry);
    setDraft(toDraft(entry));
    setSaveStatus('saved');
  };
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!draft || !gateway || !agentId) return false;
    const intended = { ...draft, name: draft.name.trim() };
    const result = await requests.run(async (signal) => {
      if (!intended.name || !intended.content.trim()) throw new AgentSettingsError(null, 'mobile.settings.skills.invalidSkill');
      let skillId = original?.skillId ?? '';
      if (original) {
        const current = await gateway.getSkill(agentId, skillId, signal);
        if (!current.skill || current.skill.version !== original.version) throw new AgentSettingsError(409);
        await gateway.updateSkill({ agentId, skillId, ...intended }, signal);
      } else {
        // Install has no idempotency field. Resolve by durable name/content
        // before issuing it again after an uncertain response.
        const existing = (await gateway.listSkills(agentId, signal)).skills.find((value) => value.name === intended.name);
        if (existing) {
          if (existing.content !== intended.content) throw new AgentSettingsError(409);
          skillId = existing.skillId;
        } else {
          try {
            const installed = await gateway.installSkill({
              agentId, name: intended.name, content: intended.content, source: 'mobile', trustLevel: 'community',
            }, signal);
            if (!installed.installed || !installed.skillId) throw new AgentSettingsError(null);
            skillId = installed.skillId;
          } catch (failure) {
            const recovered = (await gateway.listSkills(agentId, signal)).skills.find(
              (value) => value.name === intended.name && value.content === intended.content,
            );
            if (!recovered) throw failure;
            skillId = recovered.skillId;
          }
        }
        await gateway.updateSkill({ agentId, skillId, description: intended.description, enabled: intended.enabled }, signal);
      }
      const response = await gateway.getSkill(agentId, skillId, signal);
      if (!response.skill || !matches(response.skill, intended)) throw new AgentSettingsError(409);
      return response.skill;
    }, true);
    if (!result) { setSaveStatus('error'); return false; }
    accept(result);
    return true;
  };
  const toggle = async (entry: SkillManifest) => {
    if (!gateway || dirty) return;
    const response = await requests.run(async (signal) => {
      const updated = await gateway.updateSkill({ agentId, skillId: entry.skillId, enabled: !entry.enabled }, signal);
      const readback = await gateway.getSkill(agentId, entry.skillId, signal);
      if (!updated.success || !readback.skill || readback.skill.enabled === entry.enabled) throw new AgentSettingsError(null);
      return readback.skill;
    }, true);
    if (response) setSkills((current) => current.map((value) => value.skillId === response.skillId ? response : value));
  };
  const remove = async (): Promise<boolean> => {
    if (!gateway || !original || dirty) return false;
    const response = await requests.run(async (signal) => {
      await gateway.deleteSkill(agentId, original.skillId, signal);
      const readback = await gateway.listSkills(agentId, signal);
      if (readback.skills.some((value) => value.skillId === original.skillId)) throw new AgentSettingsError(null);
      return readback.skills;
    }, true);
    if (!response) return false;
    setSkills(response);
    setSelectedId(null);
    setSelectedSkill(null);
    setDraft(null);
    return true;
  };
  const owner: SettingsDraftOwner = {
    dirty, conflict: requests.conflict, saveStatus: requests.busy ? 'saving' : saveStatus,
    saveError: requests.error, save, discard, reload,
  };
  return { agents: scope.agents, agentId, selectAgent: scope.setAgentId, skills, original,
    selectedId, draft, detailLoading, loading: loading || scope.loading, busy: requests.busy,
    error: requests.error ?? scope.requests.error, owner, reload, select, save, toggle, remove,
    patch: (patch: Partial<SkillDraft>) => {
      if (requests.busy) return;
      setDraft((current) => current ? { ...current, ...patch } : null);
      setSaveStatus('idle');
      requests.clearError();
    },
  };
}
