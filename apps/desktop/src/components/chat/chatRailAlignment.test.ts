// Source-contract: the chat rail must match the north-star prototype's
// element usage — a two-person Users glyph on the contacts segment, and the
// per-row hover actions absolutely positioned against their own row (not the
// rail container).
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const listSource = readFileSync(new URL('./ChatSessionList.tsx', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./ChatDetailPanel.tsx', import.meta.url), 'utf8');
const createGroupSource = readFileSync(new URL('./CreateGroupModal.tsx', import.meta.url), 'utf8');
const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const prototypeRailSource = readFileSync(
  new URL('../../../../../packages/prototypes/shared/ui-system/chat/ChatRail.tsx', import.meta.url),
  'utf8',
);
const prototypeChatCss = readFileSync(
  new URL('../../../../../packages/prototypes/shared/ui-system/chat/chat.css', import.meta.url),
  'utf8',
);

function collectTsxSources(dirUrl: URL): string[] {
  return readdirSync(dirUrl, { withFileTypes: true }).flatMap((entry) => {
    const entryUrl = new URL(entry.isDirectory() ? `${entry.name}/` : entry.name, dirUrl);
    if (entry.isDirectory()) return collectTsxSources(entryUrl);
    if (!entry.name.endsWith('.tsx') || entry.name.endsWith('.test.tsx')) return [];
    return [readFileSync(entryUrl, 'utf8')];
  });
}

const chatComponentSources = collectTsxSources(new URL('./', import.meta.url));

describe('chat rail prototype alignment', () => {
  it('uses the two-person users glyph for the contacts segment', () => {
    expect(listSource).toMatch(/value: 'contacts'[\s\S]*?iconId="users"/);
    expect(listSource).not.toMatch(/value: 'contacts'[\s\S]*?iconId="contact"/);
    expect(listSource).toMatch(/value: 'chats'[\s\S]*?iconId="message-circle"/);
  });

  it('keeps the Recent label mounted while searching so the list does not jump', () => {
    // Prototype always renders <h2 class="sk-conv-title">; a searchOpen-gated
    // title unmounts (~30px) and makes the whole list shift on open.
    expect(listSource).toContain('<h2 className="sc-rail-title">');
    expect(listSource).not.toContain('{!searchOpen && <h2');
  });

  it('anchors hover quick actions to the row, not the rail container', () => {
    const rowRule = chatCss.match(/\.sc-session-row\s*\{[^}]*\}/)?.[0] ?? '';
    expect(rowRule).toMatch(/position:\s*relative/);
    expect(chatCss).toMatch(/\.sc-session-row__actions\s*\{[^}]*position:\s*absolute/);
  });

  it('keeps only a three-dot row action and moves status tags to the bottom-right in both hosts', () => {
    // Quick pin/mute buttons are removed: the three-dot menu owns every action.
    expect(listSource).not.toContain('actionId={`session.pin-');
    expect(listSource).not.toContain('actionId={`session.mute-');
    expect(listSource).toContain('actionId={`session.more-');
    expect(prototypeRailSource).not.toContain('data-row-action="pin"');
    expect(prototypeRailSource).not.toContain('data-row-action="mute"');
    expect(prototypeRailSource).toContain('data-row-action="more"');
    // pin-off still appears inside the context menus (state-correct glyph).
    expect(listSource).toContain("iconId: isPinned ? 'pin-off' : 'pin'");
    expect(prototypeRailSource).toContain(
      "leading: c.pinned ? <PinOff size={14} /> : <Pin size={14} />",
    );
    // Status tags live on the bottom line, not the name line, and yield the
    // corner to the three-dot tile on hover/focus.
    expect(listSource).toContain('sc-session-row__flags');
    const nameBlock = listSource.match(
      /className="sc-session-row__name"[\s\S]*?<\/span>\s*<span className="sc-session-row__time"/,
    )?.[0] ?? '';
    expect(nameBlock).not.toContain('sc-session-row__flag');
    expect(chatCss).toContain('.sc-session-row:focus-within .sc-session-row__flags');
    expect(prototypeRailSource).toMatch(
      /<span className="sk-conv-preview">[\s\S]*?sk-conv-flags/,
    );
    expect(prototypeChatCss).toContain('.sk-conv-item:focus-within .sk-conv-flags');
    // The single-tile lane is ~36px, not the old three-button 88px.
    expect(chatCss).toMatch(
      /\.sc-session-row:focus-within \.sc-session-row__preview\s*\{[^}]*margin-right: 36px;/,
    );
    expect(prototypeChatCss).toMatch(
      /\.sk-conv-item:focus-within \.sk-conv-preview\s*\{[^}]*margin-right: 36px;/,
    );
    // Hidden action pills must not intercept row clicks.
    const actionsRule = prototypeChatCss.match(/\.sk-conv-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(actionsRule).toContain('pointer-events: none');
  });

  it('holds icon-only segmented tiles at a fixed size and slides instead of squashing', () => {
    const primitiveCss = readFileSync(
      new URL('../../../../../packages/ui/web/src/styles.css', import.meta.url),
      'utf8',
    );
    const iconOnlyRule = primitiveCss.match(
      /\.pt-segmented\[data-icon-only='true'\]>\.pt-button\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(iconOnlyRule).toContain('flex:0 0 auto');
    expect(iconOnlyRule).toContain('width:var(--pt-control-compact)');
    expect(primitiveCss).toMatch(
      /\.pt-segmented\[data-icon-only='true'\]\s*\{[^}]*overflow-x:auto/,
    );
  });

  it('renders session preview at the prototype 11.5px muted scale', () => {
    // Prototype .sk-conv-meta span = 11.5px / sk-text-3 (muted); desktop
    // previously rendered 12px secondary.
    const preview = chatCss.match(/\.sc-session-row__preview\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(preview).toContain('font-size: 11.5px');
    expect(preview).toContain('color: var(--pt-muted)');
  });

  it('keeps rail header tiles frameless with the prototype 7% ink hover wash', () => {
    expect(listSource).toContain('className="sc-rail-icon"');
    const flatten = chatCss.match(
      /\.pt-button\.sc-rail-icon:hover,\s*\.pt-button\.sc-rail-icon:active,[\s\S]*?\.pt-button\.sc-rail-icon\[aria-pressed='true'\]\s*\{([^}]*)\}/,
    )?.[1] ?? '';
    expect(flatten).toContain('border-color: transparent');
    const hover = chatCss.match(/\.pt-button\.sc-rail-icon:hover\s*\{([^}]*)\}/g) ?? [];
    const washRule = hover.find((rule) => rule.includes('color-mix')) ?? '';
    expect(washRule).toContain('color-mix(in srgb, var(--pt-text) 7%, transparent)');
    expect(washRule).toContain('color: var(--pt-text)');
  });

  it('uses the canonical peers Switch for detail mute/pin toggles', () => {
    expect(detailSource).toMatch(/Switch as PtSwitch/);
    expect(detailSource).toMatch(/<PtSwitch[\s\S]*?onCheckedChange=\{onChange\}/);
    expect(detailSource).not.toContain('role="switch"');
    // The bespoke track/thumb overrides must not fight the canonical pt-switch.
    expect(chatCss).not.toMatch(/\.sc-detail-switch\.is-on/);
  });

  it('uses the canonical peers Checkbox for create-group member pick', () => {
    expect(createGroupSource).toMatch(/Checkbox as PtCheckbox/);
    expect(createGroupSource).toMatch(/<PtCheckbox[\s\S]*?onCheckedChange=\{\(\) => toggleSelect/);
    // Prototype .sk-group-member grammar: a label wraps the peers Checkbox,
    // no hand-drawn tick and no fake role=button row.
    expect(createGroupSource).toMatch(/<label[\s\S]*?className=\{`sc-create-group__contact/);
    expect(createGroupSource).not.toContain('sc-create-group__check" aria-hidden');
    expect(createGroupSource).toMatch(/data-chat-create-group-contact=\{contact\.actorPtid\}/);
    expect(createGroupSource).not.toContain('aria-pressed={selected}');
    expect(chatCss).not.toMatch(/\.sc-create-group__contact\.is-selected \.sc-create-group__check\s*\{/);
  });

  it('uses canonical peers TextField for inline rename/remark/nickname editors', () => {
    expect(detailSource).toMatch(/TextField as PtTextField/);
    expect(detailSource).toMatch(/data-chat-group-name-editor/);
    expect(detailSource).toMatch(/data-chat-group-remark-editor/);
    // No bare native text inputs remain for these editors.
    expect(detailSource).not.toContain('<input');
    expect(detailSource).toMatch(/onValueChange=\{setEditNameValue\}/);
    expect(detailSource).toMatch(/onValueChange=\{setEditRemarkValue\}/);
    expect(detailSource).toMatch(/onValueChange=\{setEditMyNicknameValue\}/);
    // The field frame is neutralized to an underline edit.
    expect(chatCss).toMatch(/\.pt-field-frame:has\(\.sc-inline-edit\)/);
  });

  it('uses the canonical peers TextArea for the group description editor', () => {
    expect(detailSource).toMatch(/TextArea as PtTextArea/);
    const editorBlock = detailSource.match(
      /<PtTextArea[\s\S]*?data-chat-group-description-editor[\s\S]*?\/>/,
    )?.[0] ?? '';
    expect(editorBlock).toMatch(/framing="embedded"/);
    expect(editorBlock).toMatch(/className="sc-detail__description-input"/);
    // The embedded frame is neutralized and the bordered box rides on the
    // canonical pt-textarea instead of a hand-rolled native control.
    expect(chatCss).toMatch(/\.pt-field-frame:has\(\.sc-detail__description-input\)/);
    expect(chatCss).toMatch(/\.sc-detail__description-input\.pt-textarea\s*\{/);
    expect(chatCss).not.toMatch(/\.sc-detail__description-edit textarea\s*\{/);
  });

  it('keeps every chat multiline/choice control on peers primitives, not native textarea/select', () => {
    // Native range inputs remain allowed: the prototype voice seek also uses
    // a bare input[type=range]. The ban covers multiline and choice controls.
    for (const source of chatComponentSources) {
      expect(source).not.toMatch(/<textarea\b/);
      expect(source).not.toMatch(/<select\b/);
    }
  });
});
