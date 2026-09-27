import { describe, expect, it, vi } from 'vitest';
import { purgeRetiredStorage } from './retiredStorage';

describe('purgeRetiredStorage', () => {
  it('deletes retired credential-bearing storage without reading it', () => {
    const removeItem = vi.fn();
    const storage = { removeItem };

    purgeRetiredStorage(storage);

    expect(removeItem).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledWith('peers-ai-custom-plugins');
  });

  it('fails closed when credential deletion is unavailable', () => {
    const failure = new Error('storage unavailable');
    const storage = {
      removeItem: vi.fn(() => {
        throw failure;
      }),
    };

    expect(() => purgeRetiredStorage(storage)).toThrow(failure);
  });
});
