import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { EmbeddingStatusResponse, MemoryItem } from '../../gen/proto/domain/agent/memory_pb';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import type { SettingsDraftOwner } from './SettingsExitBoundary';
import { useAgentKnowledgeScope } from './useAgentKnowledgeScope';
import { useSettingsRequests } from './useSettingsRequests';

export function useMemorySettingsController(session: MobileAuthSession | null) {
  const scope = useAgentKnowledgeScope(session);
  const { gateway, agentId } = scope;
  const identity = useMemo(() => ({ gateway, agentId }), [gateway, agentId]);
  const requests = useSettingsRequests(identity);
  const [entries, setEntries] = useState<readonly MemoryItem[]>([]);
  const [embedding, setEmbedding] = useState<EmbeddingStatusResponse | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const revision = useRef(0);
  const original = entries.find((entry) => entry.memoryId === selectedId);
  const dirty = draft !== null && draft !== original?.content;
  const load = useCallback(async (nextPage: number) => {
    const current = ++revision.current;
    setLoading(true);
    const response = gateway && agentId
      ? await requests.run((signal) => gateway.listMemories(agentId, nextPage, signal)) : null;
    if (current !== revision.current) return;
    if (response) {
      setEntries((entries) => nextPage === 1 ? response.items : [...new Map(
        [...entries, ...response.items].map((entry) => [entry.memoryId, entry]),
      ).values()]);
      setTotal(response.total);
      setPage(nextPage);
    }
    setLoading(false);
  }, [gateway, agentId, requests.run]);
  const reload = useCallback(async () => { await load(1); }, [load]);
  useEffect(() => {
    setEntries([]);
    setTotal(0);
    setPage(0);
    setDraft(null);
    setSelectedId(null);
    void reload();
    return () => { revision.current += 1; };
  }, [reload]);
  useEffect(() => {
    setEmbedding(null);
    if (gateway) void requests.run((signal) => gateway.embeddingStatus(signal)).then((result) => {
      if (result) setEmbedding(result);
    });
  }, [gateway, requests.run]);
  const select = (id: string | null) => {
    if (requests.busy) return;
    setSelectedId(id);
    setDraft(entries.find((entry) => entry.memoryId === id)?.content ?? null);
    setSaveStatus('idle');
    requests.clearError();
  };
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!gateway || !original || draft === null) return false;
    const response = await requests.run(async (signal) => {
      if (!draft.trim()) throw new AgentSettingsError(null, 'mobile.settings.memory.emptyContent');
      const current = await gateway.getMemory(original.memoryId, signal);
      if (!current.item || current.item.agentId !== agentId || current.item.content !== original.content) {
        throw new AgentSettingsError(409);
      }
      await gateway.updateMemory(agentId, original.memoryId, draft, signal);
      const readback = await gateway.getMemory(original.memoryId, signal);
      if (!readback.item || readback.item.content !== draft) throw new AgentSettingsError(409);
      return readback.item;
    }, true);
    if (!response) { setSaveStatus('error'); return false; }
    setEntries((entries) => entries.map((entry) => entry.memoryId === response.memoryId ? response : entry));
    setDraft(response.content);
    setSaveStatus('saved');
    return true;
  };
  const remove = async (): Promise<boolean> => {
    if (!gateway || !original || dirty) return false;
    const response = await requests.run(async (signal) => {
      const result = await gateway.deleteMemory(agentId, original.memoryId, signal);
      if (!result.ok) throw new AgentSettingsError(null);
      return gateway.listMemories(agentId, 1, signal);
    }, true);
    if (!response) return false;
    setEntries(response.items);
    setTotal(response.total);
    setPage(1);
    setSelectedId(null);
    setDraft(null);
    return true;
  };
  const owner: SettingsDraftOwner = {
    dirty, conflict: requests.conflict, saveStatus: requests.busy ? 'saving' : saveStatus,
    saveError: requests.error, save, discard: () => select(selectedId), reload,
  };
  return { gateway, agents: scope.agents, agentId, selectAgent: scope.setAgentId,
    entries, embedding, total, hasMore: entries.length < total, loadMore: () => load(page + 1),
    loading: loading || scope.loading, busy: requests.busy, error: requests.error ?? scope.requests.error,
    selectedId, original, draft, owner, reload, select, remove,
    patch: (content: string) => {
      if (requests.busy) return;
      setDraft(content);
      setSaveStatus('idle');
      requests.clearError();
    },
  };
}
