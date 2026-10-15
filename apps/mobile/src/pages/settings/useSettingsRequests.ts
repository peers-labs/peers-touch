import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentSettingsError } from '../../services/gateways/agentSettingsRpc';

const settingsErrorKey = (failure: unknown) => failure instanceof AgentSettingsError
  ? failure.errorKey : 'mobile.settings.agent.requestFailed';

/** One selected section owns cancellation and feedback, without a global cache. */
export function useSettingsRequests(identity: unknown, errorKey = settingsErrorKey) {
  const lifetime = useRef<AbortController | null>(null);
  const currentWrite = useRef<symbol | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    currentWrite.current = null;
    setBusy(false);
    setError(null);
    setConflict(false);
    return () => controller.abort();
  }, [identity]);

  const run = useCallback(async <Result,>(
    action: (signal: AbortSignal) => Promise<Result>,
    write = false,
  ): Promise<Result | null> => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted || currentWrite.current) return null;
    const token = write ? Symbol() : null;
    if (token) {
      currentWrite.current = token;
      setBusy(true);
    }
    setError(null);
    setConflict(false);
    try {
      const result = await action(signal);
      return signal.aborted ? null : result;
    } catch (failure) {
      if (!signal.aborted) {
        setError(errorKey(failure));
        setConflict(failure instanceof AgentSettingsError && failure.status === 409);
      }
      return null;
    } finally {
      if (token && currentWrite.current === token) {
        currentWrite.current = null;
        if (!signal.aborted) setBusy(false);
      }
    }
    // Identity changes invalidate the section's readers as well as writers.
  }, [identity, errorKey]);
  const clearError = () => { setError(null); setConflict(false); };
  return { run, busy, error, conflict, clearError };
}
