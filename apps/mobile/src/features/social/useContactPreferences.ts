import { useSyncExternalStore } from 'react';
import { mobileContactPreferences } from '../../runtimes/contactPreferencesRuntime';

const SERVER_SNAPSHOT = mobileContactPreferences.read();
export function useContactPreferences() {
  return useSyncExternalStore(
    mobileContactPreferences.subscribe, mobileContactPreferences.read, () => SERVER_SNAPSHOT,
  );
}
