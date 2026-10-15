import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from '@bufbuild/protobuf';
import type { Agent } from '../../gen/proto/domain/agent/agent_pb';
import { MemoryPreferencesSchema, type MemoryPreferences } from '../../gen/proto/domain/agent/memory_pb';
import type { AgentKnowledgeGateway } from '../../services/gateways/agentKnowledgeGateway';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import {
  defaultMemoryPreferences, readMemoryPreferences, sameMemoryPreferences, writeMemoryPreferences,
} from '../../services/gateways/memoryPreferences';
import type { SettingsDraftOwner } from './SettingsExitBoundary';
import { useSettingsRequests } from './useSettingsRequests';

export function useMemoryPreferencesController(gateway: AgentKnowledgeGateway | null, agentId: string) {
  const identity = useMemo(() => ({ gateway, agentId }), [gateway, agentId]);
  const requests = useSettingsRequests(identity);
  const [server, setServer] = useState<Agent | null>(null);
  const [draft, setDraft] = useState<MemoryPreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const revision = useRef(0);
  const original = useMemo(() => server ? readMemoryPreferences(server.configJson) : null, [server]);
  const dirty = Boolean(original && draft && !sameMemoryPreferences(original, draft));
  const reload = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    const result = gateway && agentId ? await requests.run(async (signal) => {
      const response = await gateway.getAgent(agentId, signal);
      if (!response.agent) throw new AgentSettingsError(null);
      return { agent: response.agent, preferences: readMemoryPreferences(response.agent.configJson) };
    }) : null;
    if (current !== revision.current) return;
    if (result) {
      setServer(result.agent);
      setDraft(result.preferences);
      setSaveStatus('idle');
    }
    setLoading(false);
  }, [gateway, agentId, requests.run]);
  useEffect(() => {
    setServer(null);
    setDraft(null);
    void reload();
    return () => { revision.current += 1; };
  }, [reload]);

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!gateway || !server || !draft) return false;
    const result = await requests.run(async (signal) => {
      const current = (await gateway.getAgent(agentId, signal)).agent;
      if (!current || current.version !== server.version) throw new AgentSettingsError(409);
      const configJson = writeMemoryPreferences(current.configJson, draft);
      await gateway.updateAgent({
        agentId, name: current.name, title: current.title, description: current.description,
        providerId: current.providerId, modelName: current.modelName, effort: current.effort,
        thinkingMode: current.thinkingMode, visibility: current.visibility,
        configJson, version: current.version,
      }, signal);
      const readback = (await gateway.getAgent(agentId, signal)).agent;
      if (!readback || !sameMemoryPreferences(readMemoryPreferences(readback.configJson), draft)) {
        throw new AgentSettingsError(409);
      }
      return readback;
    }, true);
    if (!result) { setSaveStatus('error'); return false; }
    setServer(result);
    setDraft(readMemoryPreferences(result.configJson));
    setSaveStatus('saved');
    return true;
  };
  const owner: SettingsDraftOwner = {
    dirty, conflict: requests.conflict,
    saveStatus: requests.busy ? 'saving' : saveStatus, saveError: requests.error,
    save, reload,
    discard: () => {
      setDraft(original ? create(MemoryPreferencesSchema, original) : null);
      setSaveStatus('idle');
      requests.clearError();
    },
  };
  return {
    draft, loading, busy: requests.busy, error: requests.error, owner,
    patch: (patch: Partial<MemoryPreferences>) => {
      if (requests.busy) return;
      setDraft((current) => current ? create(MemoryPreferencesSchema, { ...current, ...patch }) : null);
      setSaveStatus('idle');
      requests.clearError();
    },
    reset: () => {
      if (requests.busy) return;
      setDraft(defaultMemoryPreferences());
      setSaveStatus('idle');
      requests.clearError();
    },
  };
}
