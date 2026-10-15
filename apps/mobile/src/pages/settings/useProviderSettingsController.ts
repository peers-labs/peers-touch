import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { AgentProviderInfo, AvailableModelInfo } from '../../gen/proto/domain/agent/provider_pb';
import { createAgentSettingsGateway } from '../../services/gateways/agentSettingsGateway';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import type { SettingsDraftOwner } from './SettingsExitBoundary';

export interface ProviderDraft {
  readonly id: string;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly protocol: string;
  readonly enabled: boolean;
}

const newProvider: ProviderDraft = {
  id: '', displayName: '', baseUrl: '', protocol: 'openai-compatible', enabled: true,
};

function providerDraft(value: AgentProviderInfo): ProviderDraft {
  return { id: value.id, displayName: value.name, baseUrl: value.baseUrl,
    protocol: value.protocol, enabled: value.enabled };
}

function errorKey(error: unknown): string {
  return error instanceof AgentSettingsError ? error.errorKey : 'mobile.settings.agent.requestFailed';
}

/** A selected-section controller. No global store, polling loop, or secret cache. */
export function useProviderSettingsController(session: MobileAuthSession | null) {
  const gateway = useMemo(() => session ? createAgentSettingsGateway(session) : null, [session]);
  const [providers, setProviders] = useState<readonly AgentProviderInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const readRevision = useRef(0);
  const saving = useRef(false);
  const original = providers.find((entry) => entry.id === selectedId) ?? null;
  const dirty = draft !== null && (
    apiKey !== ''
    || JSON.stringify(draft) !== JSON.stringify(
      selectedId === '' ? newProvider : original ? providerDraft(original) : null,
    )
  );

  const load = useCallback(async () => {
    const signal = lifetime.current?.signal;
    if (!gateway || !signal || signal.aborted) {
      setLoading(false);
      setReadError('mobile.settings.agent.requestFailed');
      return;
    }
    const revision = ++readRevision.current;
    setLoading(true);
    setReadError(null);
    try {
      const nextProviders = await gateway.listProviders(signal);
      if (signal.aborted || revision !== readRevision.current) return;
      setProviders(nextProviders.providers);
    } catch (error) {
      if (!signal.aborted && revision === readRevision.current) setReadError(errorKey(error));
    } finally {
      if (!signal.aborted && revision === readRevision.current) setLoading(false);
    }
  }, [gateway]);

  useEffect(() => {
    lifetime.current = new AbortController();
    void load();
    return () => {
      lifetime.current?.abort();
      readRevision.current += 1;
    };
  }, [load]);

  const select = (id: string | null) => {
    if (saving.current) return;
    setSelectedId(id);
    setDraft(id === '' ? newProvider : providerDraftOrNull(providers, id));
    setApiKey('');
    setSaveStatus('idle');
    setSaveError(null);
    setConflict(false);
  };
  const discard = () => select(selectedId === '' ? null : selectedId);
  const reload = async () => {
    await load();
    // Retain a conflict draft until the user explicitly discards it. A
    // provider version readback is never permission to overwrite local edits.
  };
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!gateway || !draft || saving.current) return false;
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return false;
    const intended = { ...draft, id: draft.id.trim(), displayName: draft.displayName.trim(), baseUrl: draft.baseUrl.trim() };
    if (!intended.id || !intended.displayName || !validProviderUrl(intended.baseUrl)) {
      setSaveError('mobile.settings.agent.invalidProvider');
      setSaveStatus('error');
      return false;
    }
    saving.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    setConflict(false);
    try {
      if (selectedId === '') {
        const created = await gateway.createProvider({
          providerId: intended.id, displayName: intended.displayName,
          baseUrl: intended.baseUrl, protocol: intended.protocol,
        }, signal);
        if (!created.provider) throw new AgentSettingsError(null);
        if (!intended.enabled) {
          await gateway.updateProvider({
            providerId: intended.id, version: created.provider.version, enabled: false,
          }, signal);
        }
      } else {
        if (!original) throw new AgentSettingsError(null);
        await gateway.updateProvider({
          providerId: original.id, version: original.version,
          displayName: intended.displayName, baseUrl: intended.baseUrl,
          enabled: intended.enabled,
        }, signal);
      }
      if (apiKey.trim()) {
        const keyResult = await gateway.setCredential(intended.id, apiKey.trim(), signal);
        if (!keyResult.status?.configured) throw new AgentSettingsError(null);
      }
      const readback = await gateway.getProvider(intended.id, signal);
      if (!readback.provider) throw new AgentSettingsError(null);
      if (signal.aborted) return false;
      const saved = readback.provider;
      if (JSON.stringify(providerDraft(saved)) !== JSON.stringify(intended)) {
        throw new AgentSettingsError(409);
      }
      setProviders((current) => [...current.filter((entry) => entry.id !== saved.id), saved]);
      setSelectedId(saved.id);
      setDraft(providerDraft(saved));
      setApiKey('');
      setSaveStatus('saved');
      return true;
    } catch (error) {
      if (signal.aborted) return false;
      // A lost write response may already have committed. Read by stable
      // provider identity before permitting a retry; do not duplicate create.
      try {
        const readback = await gateway.getProvider(intended.id, signal);
        if (readback.provider && !signal.aborted) {
          const saved = readback.provider;
          setProviders((current) => [...current.filter((entry) => entry.id !== saved.id), saved]);
          setSelectedId(saved.id);
          const matches = JSON.stringify(providerDraft(saved)) === JSON.stringify(intended);
          if (matches && !apiKey.trim()) {
            setDraft(providerDraft(saved));
            setApiKey('');
            setSaveStatus('saved');
            return true;
          }
        }
      } catch { /* The exact draft remains available for explicit retry. */ }
      setConflict(error instanceof AgentSettingsError && error.status === 409);
      setSaveError(errorKey(error));
      setSaveStatus('error');
      return false;
    } finally {
      saving.current = false;
    }
  };

  const remove = async (): Promise<boolean> => {
    const signal = lifetime.current?.signal;
    if (!gateway || !original || original.source !== 'custom' || dirty || saving.current
      || !signal || signal.aborted) return false;
    saving.current = true;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      await gateway.deleteProvider(original.id, original.version, signal);
      const readback = await gateway.listProviders(signal);
      if (signal.aborted) return false;
      if (readback.providers.some((entry) => entry.id === original.id)) {
        throw new AgentSettingsError(null);
      }
      setProviders(readback.providers);
      setSelectedId(null);
      setDraft(null);
      setApiKey('');
      setSaveStatus('saved');
      return true;
    } catch (error) {
      if (!signal.aborted) {
        setSaveError(errorKey(error));
        setSaveStatus('error');
      }
      return false;
    } finally {
      saving.current = false;
    }
  };

  const owner: SettingsDraftOwner = {
    dirty, conflict, saveStatus, saveError, save, discard, reload,
  };
  return {
    providers, selectedId, draft, apiKey, loading, readError, owner,
    select, reload, remove, setApiKey,
    patch: (patch: Partial<ProviderDraft>) => {
      if (saving.current) return;
      setDraft((current) => current ? { ...current, ...patch } : null);
      setSaveStatus('idle');
      setSaveError(null);
    },
  };
}

function providerDraftOrNull(providers: readonly AgentProviderInfo[], id: string | null): ProviderDraft | null {
  const value = providers.find((entry) => entry.id === id);
  return value ? providerDraft(value) : null;
}

function validProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && !url.username && !url.password && !url.hash;
  } catch { return false; }
}

export function useAvailableModelsController(session: MobileAuthSession | null) {
  const gateway = useMemo(() => session ? createAgentSettingsGateway(session) : null, [session]);
  const [models, setModels] = useState<readonly AvailableModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const reload = useCallback(async () => {
    request.current?.abort();
    const current = new AbortController();
    request.current = current;
    setLoading(true);
    setError(null);
    try {
      if (!gateway) throw new AgentSettingsError(null);
      const response = await gateway.listAvailableModels(current.signal);
      if (!current.signal.aborted) setModels(response.models);
    } catch (failure) {
      if (!current.signal.aborted) setError(errorKey(failure));
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }, [gateway]);
  useEffect(() => {
    void reload();
    return () => request.current?.abort();
  }, [reload]);
  return { models, loading, error, reload };
}
