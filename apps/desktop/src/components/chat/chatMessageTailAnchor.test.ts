// Source-contract: a growing composer must push the message stream up (IM
// parity) rather than cover the last message. The composer emits a geometry
// signal at the moment its textarea height changes; the message area snapshots
// the tail-pin state before the flex reflow and re-anchors on the next frame.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const messageAreaSource = readFileSync(
  new URL('./ChatMessageArea.tsx', import.meta.url),
  'utf8',
);
const composerSource = readFileSync(
  new URL('./ChatComposer.tsx', import.meta.url),
  'utf8',
);

describe('composer growth → message tail re-anchor', () => {
  it('wires the composer geometry signal into the message area', () => {
    expect(composerSource).toContain('onComposerGeometryChange?: () => void');
    expect(messageAreaSource).toContain(
      'onComposerGeometryChange={handleComposerGeometryChange}',
    );
  });

  it('re-pins on the next frame only when the user was already at the tail', () => {
    // Snapshot before reflow: a shrink-induced scroll event must not be allowed
    // to suppress the re-anchor. Manual scroll-up (wasPinned === false) is
    // never overridden.
    expect(messageAreaSource).toContain('const handleComposerGeometryChange');
    const start = messageAreaSource.indexOf('const handleComposerGeometryChange');
    const block = messageAreaSource.slice(start, messageAreaSource.indexOf('useLayoutEffect', start));
    expect(block).toContain('const wasPinned = tailPinnedRef.current');
    expect(block).toContain('if (!wasPinned');
    expect(block).toContain('requestAnimationFrame');
    expect(block).toContain('scrollToMessageTail()');
    expect(block).toContain('tailPinnedRef.current = true');
  });
});
