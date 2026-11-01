import { afterEach, describe, expect, it, vi } from 'vitest';

import { isDocumentHidden, onDocumentForeground } from './documentVisibility';

interface FakeDocument {
  hidden: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}

function stubDocument(hidden: boolean): FakeDocument {
  const fake: FakeDocument = {
    hidden,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal('document', fake);
  return fake;
}

describe('document visibility gate', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports false when no renderer document exists', () => {
    expect(isDocumentHidden()).toBe(false);
  });

  it('reports the current hidden state', () => {
    const fake = stubDocument(true);
    expect(isDocumentHidden()).toBe(true);
    fake.hidden = false;
    expect(isDocumentHidden()).toBe(false);
  });

  it('subscribes a visibilitychange listener that filters hidden transitions', () => {
    const fake = stubDocument(true);
    const handler = vi.fn();
    const unsubscribe = onDocumentForeground(handler);

    expect(fake.addEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      expect.any(Function),
    );
    const listener = fake.addEventListener.mock.calls[0][1] as () => void;

    listener();
    expect(handler).not.toHaveBeenCalled();

    fake.hidden = false;
    listener();
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    expect(fake.removeEventListener).toHaveBeenCalledWith(
      'visibilitychange',
      listener,
    );
  });

  it('unsubscribe is a no-op without a renderer document', () => {
    expect(() => onDocumentForeground(() => {})()).not.toThrow();
  });
});
