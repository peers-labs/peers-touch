// Source-contract: conversation chrome geometry vs the north-star prototype —
// the compact chat header band (52px, baseline title, 34px ghost actions) and
// the composer tool cluster (1px rhythm, 34px circles, recording danger wash).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return chatCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('conversation header (north-star .sk-chat-head parity)', () => {
  it('uses a slim 48px band with a small 6/20 inset and the faint column hairline', () => {
    const head = rule('.sc-chat-head');
    expect(head).toContain('min-height: 48px');
    expect(head).toContain('padding: 6px 20px');
    expect(head).toContain('border-bottom: 1px solid var(--pt-column-hairline)');
  });

  it('places title + annotation on one baseline row at 15.5px', () => {
    const name = rule('.sc-chat-head-name');
    expect(name).toContain('align-items: baseline');
    const strong = rule('.sc-chat-head-name strong');
    expect(strong).toContain('font-size: 15.5px');
    expect(strong).toContain('font-weight: 650');
    expect(strong).toContain('flex-shrink: 1');
  });

  it('renders the three ghost actions at 34px / r8 with 6px rhythm', () => {
    expect(rule('.sc-chat-head-actions')).toContain('gap: 6px');
    const action = rule('.sc-chat-head-actions .sc-head-action');
    expect(action).toContain('width: 34px');
    expect(action).toContain('height: 34px');
    expect(action).toContain('min-height: 34px');
    expect(action).toContain('border-radius: 8px');
    expect(rule('.sc-chat-head-actions .sc-head-action:hover')).toContain(
      'background: color-mix(in srgb, var(--pt-text) 7%, transparent)',
    );
    expect(rule('.sc-chat-head-actions .sc-head-action[aria-expanded=\'true\']')).toContain(
      'background: color-mix(in srgb, var(--pt-primary) 10%, transparent)',
    );
  });
});

describe('composer tool cluster (north-star .sk-composer-tools parity)', () => {
  it('spaces tools at 1px and keeps 34px circular quiet targets', () => {
    // Match the standalone rule, not the `.sc-composer__row .sc-composer__tools`
    // positioning block that appears earlier in the stylesheet.
    const toolsRule = chatCss.match(
      /(?:^|\})\s*\.sc-composer__tools\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(toolsRule).toContain('gap: 1px');
    const tool = rule('.sc-composer__tool.pt-button');
    expect(tool).toContain('width: 34px');
    expect(tool).toContain('height: 34px');
    expect(tool).toContain('border-radius: 999px');
  });

  it('marks the recording tool with the danger glyph on a 10% danger wash', () => {
    const recording = rule('.sc-composer__tool.is-recording.pt-button');
    expect(recording).toContain('color: var(--pt-danger)');
    expect(recording).toContain(
      'background: color-mix(in srgb, var(--pt-danger) 10%, transparent)',
    );
  });
});
