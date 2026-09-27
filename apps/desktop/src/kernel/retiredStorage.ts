const RETIRED_STORAGE_KEYS = ['peers-ai-custom-plugins'] as const;

export function purgeRetiredStorage(
  storage: Pick<Storage, 'removeItem'> = window.localStorage,
): void {
  for (const key of RETIRED_STORAGE_KEYS) {
    storage.removeItem(key);
  }
}
