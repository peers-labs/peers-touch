import { useEffect, useRef, useState } from 'react';
import { getAuthEpoch } from '../api/client';
import { aiError } from '../api/ai';

/** Fence a visible administrator form across validation, writes and refresh. */
export function useControlPlaneAction(refresh?: () => Promise<void>) {
  const scope = useRef(getAuthEpoch());
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const current = () => mounted.current && scope.current === getAuthEpoch();
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    if (!current()) return false;
    setBusy(true); setError('');
    try {
      await action();
      if (!current()) return false;
      if (refresh) await refresh();
      return current();
    } catch (e) {
      if (current()) setError(aiError(e));
      return false;
    } finally {
      if (current()) setBusy(false);
    }
  };
  return { busy, error, setError, run, current };
}
