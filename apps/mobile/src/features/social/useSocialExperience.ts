import { useCallback, useSyncExternalStore } from 'react';

import {
  readActiveMobileSocialFacade,
  subscribeActiveMobileSocialFacade,
} from './mobileSocialFacade';

export function useSocialExperience() {
  const facade = useSyncExternalStore(
    subscribeActiveMobileSocialFacade,
    readActiveMobileSocialFacade,
    readActiveMobileSocialFacade,
  );
  const subscribe = useCallback(
    (listener: () => void) => facade?.subscribe(listener) ?? (() => undefined),
    [facade],
  );
  const readProjection = useCallback(
    () => facade?.state() ?? null,
    [facade],
  );
  const projection = useSyncExternalStore(
    subscribe,
    readProjection,
    readProjection,
  );

  return { facade, projection };
}
