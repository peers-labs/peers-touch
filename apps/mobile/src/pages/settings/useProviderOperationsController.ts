import { useEffect, useMemo, useRef, useState } from 'react';
import type { MobileAuthSession } from '../../features/auth/authSession';
import type { AgentProviderInfo, ProviderModelInfo } from '../../gen/proto/domain/agent/provider_pb';
import type { CheckProviderResponse } from '../../gen/proto/domain/agent/provider_operations_pb';
import { createAgentSettingsGateway } from '../../services/gateways/agentSettingsGateway';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';
import type { SettingsDraftOwner } from './SettingsExitBoundary';

interface ModelDraft {
  readonly id: string;
  readonly displayName: string;
  readonly contextWindow: string;
}

/** Explicit probes are cancelled on selection/exit, never retried by polling. */
export function useProviderOperationsController(
  session: MobileAuthSession | null,
  provider: AgentProviderInfo | undefined,
  reloadProvider: () => Promise<void>,
) {
  const gateway = useMemo(() => session ? createAgentSettingsGateway(session) : null, [session]);
  const [candidates, setCandidates] = useState<readonly ProviderModelInfo[]>([]);
  const [modelDraft, setModelDraft] = useState<ModelDraft | null>(null);
  const [modelSelection, setModelSelection] = useState('');
  const [result, setResult] = useState<CheckProviderResponse | null>(null);
  const [activity, setActivity] = useState<'check' | 'discover' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const lifetime = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const saving = useRef(false);
  const providerId = provider?.id;
  const eligibleModels = provider?.models.filter((entry) => entry.enabled && entry.contextWindow > 1) ?? [];
  const modelId = eligibleModels.some((entry) => entry.id === modelSelection)
    ? modelSelection : eligibleModels[0]?.id ?? '';

  useEffect(() => {
    lifetime.current = new AbortController();
    setCandidates([]);
    setModelDraft(null);
    setModelSelection('');
    setResult(null);
    setError(null);
    setActivity(null);
    setSaveStatus('idle');
    setSaveError(null);
    return () => {
      lifetime.current?.abort();
      operation.current?.abort();
    };
  }, [gateway, providerId]);

  useEffect(() => {
    operation.current?.abort();
    setResult(null);
    setActivity(null);
  }, [provider?.version, modelId]);

  const probe = async (kind: 'check' | 'discover') => {
    if (!gateway || !provider || saving.current) return;
    operation.current?.abort();
    const request = new AbortController();
    operation.current = request;
    const signal = AbortSignal.any([request.signal, lifetime.current?.signal ?? request.signal]);
    setActivity(kind);
    setError(null);
    setResult(null);
    try {
      if (kind === 'check') {
        const checked = await gateway.checkProvider(provider.id, provider.version, modelId, signal);
        if (!signal.aborted) setResult(checked);
      } else {
        const discovered = await gateway.discoverModels(provider.id, provider.version, signal);
        if (!signal.aborted) setCandidates(discovered.models);
      }
    } catch (failure) {
      if (!signal.aborted) setError(failure instanceof AgentSettingsError
        ? failure.errorKey : 'mobile.settings.agent.requestFailed');
    } finally {
      if (!signal.aborted) setActivity(null);
    }
  };

  const discard = () => {
    if (saving.current) return;
    setModelDraft(null);
    setSaveStatus('idle');
    setSaveError(null);
    setConflict(false);
  };
  const owner: SettingsDraftOwner = {
    dirty: modelDraft !== null, conflict, saveStatus, saveError, discard, reload: reloadProvider,
    save: async () => {
      if (!modelDraft) return true;
      const signal = lifetime.current?.signal;
      if (!gateway || !providerId || !signal || signal.aborted || saving.current) return false;
      const intended = { id: modelDraft.id.trim(), displayName: modelDraft.displayName.trim(),
        contextWindow: Number(modelDraft.contextWindow) };
      if (!intended.id || !intended.displayName || !Number.isInteger(intended.contextWindow)
        || intended.contextWindow < 2 || intended.contextWindow > 2147483647) {
        setSaveStatus('error');
        setSaveError('mobile.settings.agent.invalidModel');
        return false;
      }
      saving.current = true;
      setSaveStatus('saving');
      setSaveError(null);
      try {
        const before = await gateway.getProvider(providerId, signal);
        if (!before.provider) throw new AgentSettingsError(null);
        const existing = before.provider.models.find((entry) => entry.id === intended.id);
        if (!existing) {
          await gateway.createModel({
            providerId, modelId: intended.id, displayName: intended.displayName,
            contextWindow: intended.contextWindow, enabled: true,
          }, signal);
        }
        const after = await gateway.getProvider(providerId, signal);
        const saved = after.provider?.models.find((entry) => entry.id === intended.id);
        if (!saved || saved.contextWindow !== intended.contextWindow
          || saved.displayName !== intended.displayName || !saved.enabled) {
          throw new AgentSettingsError(409);
        }
        if (signal.aborted) return false;
        await reloadProvider();
        setModelDraft(null);
        setModelSelection(intended.id);
        setSaveStatus('saved');
        setConflict(false);
        return true;
      } catch (failure) {
        if (!signal.aborted) {
          setConflict(failure instanceof AgentSettingsError && failure.status === 409);
          setSaveError(failure instanceof AgentSettingsError
            ? failure.errorKey : 'mobile.settings.agent.requestFailed');
          setSaveStatus('error');
        }
        return false;
      } finally {
        saving.current = false;
      }
    },
  };
  return {
    candidates, eligibleModels, modelId, setModelSelection, modelDraft, result, activity, error, owner,
    check: () => probe('check'), discover: () => probe('discover'),
    cancel: () => { operation.current?.abort(); setActivity(null); },
    editModel: (entry?: ProviderModelInfo) => {
      if (!saving.current) setModelDraft({
        id: entry?.id ?? '', displayName: entry?.displayName || entry?.id || '', contextWindow: '',
      });
    },
    patchModel: (patch: Partial<ModelDraft>) => {
      if (!saving.current) {
        setModelDraft((current) => current ? { ...current, ...patch } : null);
        setSaveStatus('idle');
        setSaveError(null);
      }
    },
  };
}
