import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CapacityWarning, formatCapacityBytes } from './CapacityWarning';

describe('CapacityWarning', () => {
  it('reports byte exhaustion without claiming the record limit is full', () => {
    const t = vi.fn((key: string) => key);

    const markup = renderToStaticMarkup(
      <CapacityWarning
        state={{
          kind: 'capacity-read-only',
          currentDepth: 64,
          maxCapacity: 512,
          currentBytes: 16_700_000,
          maxBytes: 16_777_216,
          exhaustionCauses: ['byte-capacity'],
        }}
        t={t}
      />,
    );

    expect(markup).toContain('mobile.recovery.capacityWarning.bodyBytes');
    expect(t).toHaveBeenCalledWith(
      'mobile.recovery.capacityWarning.bodyBytes',
      expect.objectContaining({
        current: 64,
        max: 512,
        currentBytes: '15.9 MiB',
        maxBytes: '16 MiB',
      }),
    );
  });

  it('uses the combined message only when both limits are exhausted', () => {
    const t = vi.fn((key: string) => key);
    renderToStaticMarkup(
      <CapacityWarning
        state={{
          kind: 'capacity-read-only',
          currentDepth: 512,
          maxCapacity: 512,
          currentBytes: 16_777_216,
          maxBytes: 16_777_216,
          exhaustionCauses: ['record-count', 'byte-capacity'],
        }}
        t={t}
      />,
    );

    expect(t).toHaveBeenCalledWith(
      'mobile.recovery.capacityWarning.bodyBoth',
      expect.any(Object),
    );
  });

  it('formats native byte counts deterministically', () => {
    expect(formatCapacityBytes(512)).toBe('512 B');
    expect(formatCapacityBytes(1536)).toBe('1.5 KiB');
    expect(formatCapacityBytes(16_777_216)).toBe('16 MiB');
  });
});
