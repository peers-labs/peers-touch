import { invoke } from '@tauri-apps/api/core';

export async function setSecureStorageValue(key: string, value: string): Promise<void> {
  await invoke('secure_storage_set', { key, value });
}

export async function getSecureStorageValue(key: string): Promise<string | null> {
  return invoke<string | null>('secure_storage_get', { key });
}

export async function removeSecureStorageValue(key: string): Promise<void> {
  await invoke('secure_storage_remove', { key });
}
