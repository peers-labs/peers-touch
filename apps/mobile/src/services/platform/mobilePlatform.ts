import {
  getSecureStorageValue,
  removeSecureStorageValue,
  setSecureStorageValue,
} from '../mobileCommands';

export interface SecureStoragePort {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

export interface MobilePlatform {
  readonly name: string;
  readonly secureStorage: SecureStoragePort;
}

export function createTauriMobilePlatform(): MobilePlatform {
  return {
    name: 'tauri-ios',
    secureStorage: {
      set: setSecureStorageValue,
      get: getSecureStorageValue,
      remove: removeSecureStorageValue,
    },
  };
}
