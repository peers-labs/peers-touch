// Source-contract: call surfaces keep the desktop's real WebRTC architecture
// (global non-blocking tray, compact/chat/fullscreen modes) while sharing the
// north-star CallOverlay visual grammar: 22px tray edge, 16px radius,
// borderless tile controls with primary-wash hover, 188px video pane and the
// 76x56 self-view tile. Native acceptance data hooks must stay intact.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const callSurfaceSource = readFileSync(new URL('./CallSurface.tsx', import.meta.url), 'utf8');
const groupCallSource = readFileSync(new URL('./GroupCallSurface.tsx', import.meta.url), 'utf8');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return chatCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('1:1 call HUD grammar (north-star .sk-call-hud parity)', () => {
  it('anchors the compact and incoming trays 22px from the edge with 16px radius', () => {
    expect(callSurfaceSource).toMatch(/const CALL_TRAY_EDGE = 22;/);
    for (const selector of ['.sc-call--compact', '.sc-call--tray']) {
      const rule = ruleFor(selector);
      expect(rule).toContain('right: 22px');
      expect(rule).toContain('bottom: 22px');
      expect(rule).toContain('border-radius: 16px');
    }
  });

  it('renders neutral controls as borderless tiles with primary-wash hover and pressed state', () => {
    const buttonRule = ruleFor('.sc-call__btn');
    expect(buttonRule).toContain('border: 0');
    expect(buttonRule).toContain('background: var(--pt-subtle)');
    const hoverRule = ruleFor('.sc-call__btn:hover');
    expect(hoverRule).toContain(
      'background: color-mix(in srgb, var(--pt-primary) 14%, var(--pt-subtle))',
    );
    expect(hoverRule).toContain('color: var(--pt-primary)');
    const pressedRule = ruleFor(".sc-call__btn[aria-pressed='true']");
    expect(pressedRule).toContain('background: #e4e7ec');
  });

  it('uses the prototype fixed telecom hues for accept and hangup/decline', () => {
    // .sk-call-ctl.is-accept is #3f9142; .is-decline/.is-hangup is #b0413a,
    // and hover keeps the flat color. These are call constants, not tokens.
    expect(ruleFor('.sc-call__btn--success')).toContain('background: #3f9142');
    expect(ruleFor('.sc-call__btn--success:hover')).toContain('background: #3f9142');
    expect(ruleFor('.sc-call__btn--danger')).toContain('background: #b0413a');
    expect(ruleFor('.sc-call__btn--danger:hover')).toContain('background: #b0413a');
  });

  it('uses the 188px video pane and 76x56 self-view tile with the white-28 frame', () => {
    expect(ruleFor('.sc-call__video')).toContain('height: 188px');
    const selfRule = ruleFor(
      ".sc-call__video > video[data-chat-call-local-video]",
    );
    expect(selfRule).toContain('width: 76px');
    expect(selfRule).toContain('height: 56px');
    expect(selfRule).toContain('border-radius: 8px');
    expect(selfRule).toContain('border: 1px solid rgba(255, 255, 255, 0.28)');
  });

  it('uses prototype type scale with tabular duration numerals', () => {
    const bodyRule = chatCss.match(
      /\.sc-call__bar-body span,\s*\.sc-call__tray-body span\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(bodyRule).toContain('font-size: 11.5px');
    expect(bodyRule).toContain('font-variant-numeric: tabular-nums');
    const strongRule = chatCss.match(
      /\.sc-call__bar-body strong,\s*\.sc-call__tray-body strong\s*\{[^}]*\}/,
    )?.[0] ?? '';
    expect(strongRule).toContain('font-size: 13.5px');
  });

  it('keeps the native gate data hooks and display-mode targets', () => {
    expect(callSurfaceSource).toContain('data-chat-call-surface');
    expect(callSurfaceSource).toContain('data-chat-call-display-mode-target');
    expect(callSurfaceSource).toContain('data-chat-call-remote-video');
    expect(callSurfaceSource).toContain('data-chat-call-local-video');
    expect(callSurfaceSource).toContain('data-chat-call-remote-audio');
  });
});

describe('group call surface grammar (north-star .sk-call-grid parity)', () => {
  it('uses the shared 16px tray radius with 10px grid gaps and 16px participant tiles', () => {
    expect(ruleFor('.sc-gcall')).toContain('border-radius: 16px');
    expect(ruleFor('.sc-gcall__grid')).toContain('gap: 10px');
    expect(ruleFor('.sc-gcall__tile')).toContain('border-radius: 16px');
  });

  it('animates the speaking ring with the prototype 0.15s border-color transition', () => {
    expect(ruleFor('.sc-gcall__tile')).toContain('transition: border-color 0.15s');
    expect(chatCss).toContain('.sc-gcall__tile.is-speaking { border: 2px solid var(--pt-primary); }');
  });

  it('keeps the group-call native hooks', () => {
    expect(groupCallSource).toContain('data-group-call-surface');
    expect(groupCallSource).toContain('data-group-call-participant');
    expect(groupCallSource).toContain('data-group-call-display-mode-target');
  });
});
