import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/desktop_api';
import type { AppletPins } from '../types/navigation';

export function useAppletPins(): AppletPins {
  const [pinnedApplets, setPinnedApplets] = useState<string[]>([]);

  useEffect(() => {
    api.getPreferences()
      .then((prefs) => setPinnedApplets(prefs.pinned_applets || []))
      .catch(() => {});
  }, []);

  const togglePin = useCallback((appletId: string) => {
    setPinnedApplets((prev) => {
      const next = prev.includes(appletId)
        ? prev.filter((id) => id !== appletId)
        : [...prev, appletId];
      api.setPreferences({ pinned_applets: next }).catch(() => {});
      return next;
    });
  }, []);

  return { pinnedApplets, togglePin };
}
