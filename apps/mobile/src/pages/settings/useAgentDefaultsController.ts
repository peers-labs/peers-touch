import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { Agent } from '../../gen/proto/domain/agent/agent_pb';
import type { AvailableModelInfo } from '../../gen/proto/domain/agent/provider_pb';
import { createAgentSettingsGateway } from '../../services/gateways/agentSettingsGateway';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import type { SettingsDraftOwner } from './SettingsExitBoundary';
import { useAgentKnowledgeScope } from './useAgentKnowledgeScope';
import { useSettingsRequests } from './useSettingsRequests';

type Defaults = Pick<Agent, 'providerId' | 'modelName' | 'effort' | 'thinkingMode'>;

const defaultsOf = (agent: Agent): Defaults => ({
  providerId: agent.providerId, modelName: agent.modelName,
  effort: agent.effort, thinkingMode: agent.thinkingMode,
});
const sameDefaults = (left: Defaults, right: Defaults) => Object.entries(left)
  .every(([key, value]) => right[key as keyof Defaults] === value);

/** Agent defaults are consumed by Station turn admission, never device form state. */
export function useAgentDefaultsController(session: MobileAuthSession | null) {
  const scope = useAgentKnowledgeScope(session);
  const { gateway, agentId } = scope;
  const modelsGateway = useMemo(() => session ? createAgentSettingsGateway(session) : null, [session]);
  const identity = useMemo(() => ({ gateway, agentId }), [gateway, agentId]);
  const requests = useSettingsRequests(identity);
  const [server, setServer] = useState<Agent | null>(null);
  const [draft, setDraft] = useState<Defaults | null>(null);
  const [models, setModels] = useState<readonly AvailableModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const revision = useRef(0);
  const dirty = Boolean(server && draft && !sameDefaults(defaultsOf(server), draft));

  const reload = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    const result = gateway && agentId ? await requests.run(
      (signal) => gateway.getAgent(agentId, signal),
    ) : null;
    if (current !== revision.current) return;
    if (result?.agent) {
      setServer(result.agent);
      setDraft(defaultsOf(result.agent));
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
  useEffect(() => {
    setModels([]);
    if (modelsGateway) void requests.run(
      (signal) => modelsGateway.listAvailableModels(signal),
    ).then((result) => { if (result) setModels(result.models); });
  }, [modelsGateway, requests.run]);

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!gateway || !server || !draft) return false;
    const result = await requests.run(async (signal) => {
      const modelChanged = draft.providerId !== server.providerId || draft.modelName !== server.modelName;
      if (modelChanged && (!draft.providerId || !draft.modelName || !models.some(
        (entry) => entry.enabled && entry.providerId === draft.providerId && entry.id === draft.modelName,
      ))) throw new AgentSettingsError(null, 'mobile.settings.general.modelRequired');
      const current = (await gateway.getAgent(agentId, signal)).agent;
      if (!current || current.version !== server.version) throw new AgentSettingsError(409);
      await gateway.updateAgent({
        agentId, name: current.name, title: current.title, description: current.description,
        visibility: current.visibility, configJson: current.configJson,
        ...draft, version: current.version,
      }, signal);
      const readback = (await gateway.getAgent(agentId, signal)).agent;
      if (!readback || !sameDefaults(defaultsOf(readback), draft)) throw new AgentSettingsError(409);
      return readback;
    }, true);
    if (!result) { setSaveStatus('error'); return false; }
    setServer(result);
    setDraft(defaultsOf(result));
    setSaveStatus('saved');
    return true;
  };
  const owner: SettingsDraftOwner = {
    dirty, conflict: requests.conflict,
    saveStatus: requests.busy ? 'saving' : saveStatus,
    saveError: requests.error, save, reload,
    discard: () => {
      setDraft(server ? defaultsOf(server) : null);
      setSaveStatus('idle');
      requests.clearError();
    },
  };
  return {
    agents: scope.agents, agentId, selectAgent: scope.setAgentId,
    loading: scope.loading || loading, busy: requests.busy,
    error: requests.error ?? scope.requests.error, draft, models, owner,
    patch: (patch: Partial<Defaults>) => {
      if (requests.busy) return;
      setDraft((current) => current ? { ...current, ...patch } : null);
      setSaveStatus('idle');
      requests.clearError();
    },
  };
}
