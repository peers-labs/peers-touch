// Source-contract: the conversation stage is a full-bleed continuation of the
// catalog rail — one uniform surface from the first-level nav boundary to the
// window edge. A floating card (margin gutter, border, radius or shadow) was
// explicitly rejected: it made the stage read as a foreign box on grey canvas.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(
  new URL('../../ui/chat.css', import.meta.url),
  'utf8',
);

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return stylesheet.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('conversation stage surface (wide surfaces)', () => {
  it('shares the rail surface material and fills its whole flex cell', () => {
    const stage = rule('.sc-conversation');
    expect(stage).toContain('background: var(--pt-surface)');
    expect(stage).toContain('flex: 1');
    expect(stage).toContain('height: 100%');
    expect(stage).toContain('overflow: hidden');
  });

  it('carries no card frame: no margin, border, radius or shadow declarations', () => {
    const stage = rule('.sc-conversation');
    // Match actual declarations, not the explanatory comment text.
    expect(stage).not.toMatch(/\bmargin\s*:/);
    expect(stage).not.toMatch(/\bborder(-radius)?\s*:/);
    expect(stage).not.toMatch(/\bbox-shadow\s*:/);
  });

  it('keeps the empty state on the same surface material', () => {
    expect(rule('.sc-conversation--empty')).toContain(
      'background: var(--pt-surface)',
    );
  });

  it('covers every conversation variant through the shared class', () => {
    const component = readFileSync(
      new URL('./ChatMessageArea.tsx', import.meta.url),
      'utf8',
    );
    expect(component).toContain('className="sc-conversation sc-conversation--empty"');
    expect(component.match(/className="sc-conversation"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('conversation stage surface (720px single-pane slide)', () => {
  it('becomes a borderless full-stage sliding overlay in narrow mode', () => {
    const narrowRule = stylesheet.match(
      /\.sc-chat\[data-narrow='true'\]\[data-narrow-open='true'\] \.sc-conversation\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(narrowRule).toContain('transform: translateX(0)');
    expect(narrowRule).toContain('visibility: visible');
    // The resting rule positions the pane as a full-stage overlay without
    // reintroducing a card frame.
    const parkedRule = stylesheet.match(
      /\.sc-chat\[data-narrow='true'\] \.sc-conversation\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(parkedRule).toContain('position: absolute');
    expect(parkedRule).toContain('inset: 0');
    expect(parkedRule).toContain('translateX(100%)');
    expect(parkedRule).not.toMatch(/\bmargin\s*:/);
    expect(parkedRule).not.toMatch(/\bborder(-radius)?\s*:/);
    expect(parkedRule).not.toMatch(/\bbox-shadow\s*:/);
  });
});
