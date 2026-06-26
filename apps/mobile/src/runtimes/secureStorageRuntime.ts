import type { SecureStoragePort } from '../services/platform/mobilePlatform';
import { readableErrorMessage } from '../utils/errorMessage';

const SMOKE_KEY = 'framework.secure-storage.smoke';
const SMOKE_VALUE = 'secure-storage-ready';

export type SecureStorageSmokeResult =
  | { status: 'ready'; value: string }
  | { status: 'unavailable'; reason: string };

export async function runSecureStorageSmoke(
  secureStorage: SecureStoragePort,
): Promise<SecureStorageSmokeResult> {
  try {
    await secureStorage.set(SMOKE_KEY, SMOKE_VALUE);
    const value = await secureStorage.get(SMOKE_KEY);
    await secureStorage.remove(SMOKE_KEY);

    if (value !== SMOKE_VALUE) {
      return {
        status: 'unavailable',
        reason: 'secure storage returned an unexpected smoke value',
      };
    }

    return { status: 'ready', value };
  } catch (error) {
    return {
      status: 'unavailable',
      reason: readableErrorMessage(error),
    };
  }
}
