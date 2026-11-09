// Source-contract: the group detail members surface must follow the north-star
// prototype grammar — a five-column avatar grid (.sk-profile-members) with
// avatar-sized add/manage icon tiles inside the grid, and management dialog
// rows matching .sk-member-manage-row. Acceptance hooks stay on the tiles.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const chatCss = readFileSync(new URL('../../ui/chat.css', import.meta.url), 'utf8');
const detailSource = readFileSync(new URL('./ChatDetailPanel.tsx', import.meta.url), 'utf8');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return chatCss.match(new RegExp(`${escaped}\\s*\\{[^}]*\\}`))?.[0] ?? '';
}

describe('group member grid (north-star .sk-profile-members parity)', () => {
  it('lays members out as a five-column grid, not a wrapping flex row', () => {
    const gridRule = ruleFor('.sc-detail__member-previews');
    expect(gridRule).toContain('display: grid');
    expect(gridRule).toContain('grid-template-columns: repeat(5, 1fr)');
    expect(gridRule).toContain('gap: 10px 4px');
  });

  it('uses 38px / radius-11 grid avatars with the prototype name and role typography', () => {
    expect(detailSource).toMatch(/<MemberAvatar member=\{member\} size=\{38\} radius=\{11\} \/>/);

    const nameRule = ruleFor('.sc-detail-member__preview-name');
    expect(nameRule).toContain('font-size: 10.5px');
    expect(nameRule).toContain('max-width: 52px');
    expect(nameRule).toContain('color: var(--pt-secondary)');

    const roleRule = ruleFor('.sc-detail-member__preview-role');
    expect(roleRule).toContain('font-size: 9px');
    expect(roleRule).toContain('color: var(--pt-muted)');
    // Ownership is expressed by ordering; no warning/info colored role labels.
    expect(chatCss).not.toContain(".sc-detail-member__preview-role[data-role='owner']");
    expect(chatCss).not.toContain(".sc-detail-member__preview-role[data-role='admin']");
  });

  it('builds add/manage as avatar-sized peers IconButton tiles inside the grid', () => {
    expect(detailSource).toMatch(/<IconButton[\s\S]*?data-chat-group-add-member-open[\s\S]*?iconId="user-plus"/);
    expect(detailSource).toMatch(/<IconButton[\s\S]*?data-chat-group-manage-members[\s\S]*?iconId="settings"/);

    const tileButtonRule = ruleFor(
      '.sc-detail__member-previews .sc-detail-member__tile-button.pt-icon-button',
    );
    expect(tileButtonRule).toContain('width: 38px');
    expect(tileButtonRule).toContain('height: 38px');
    expect(tileButtonRule).toContain('border-radius: 11px');

    const addRule = ruleFor(
      '.sc-detail__member-previews .sc-detail-member__tile-button--add.pt-icon-button',
    );
    expect(addRule).toContain('1px dashed color-mix(in srgb, var(--pt-text) 28%, transparent)');
    expect(chatCss).toContain(
      ".sc-detail-member__tile-button--add.pt-icon-button[aria-disabled='true']",
    );

    const manageRule = ruleFor(
      '.sc-detail__member-previews .sc-detail-member__tile-button--manage.pt-icon-button',
    );
    expect(manageRule).toContain(
      'background: color-mix(in srgb, var(--pt-text) 6%, transparent)',
    );
  });

  it('never renders full-width text action rows under the member grid', () => {
    expect(detailSource).not.toContain('sc-detail__member-actions-row');
    expect(detailSource).not.toContain('sc-detail__member-links');
    expect(chatCss).not.toContain('.sc-detail__member-actions-row');
    expect(chatCss).not.toContain('.sc-detail__member-links');
    // The see-all affordance remains a quiet right-aligned link row.
    expect(detailSource).toContain('sc-detail-member__see-all');
  });
});

describe('member management dialog rows (north-star .sk-member-manage-row parity)', () => {
  it('caps the list at 52vh with a 2px row rhythm', () => {
    const managerRule = ruleFor('.sc-detail__member-manager');
    expect(managerRule).toContain('max-height: 52vh');
    expect(managerRule).toContain('gap: 2px');
    expect(managerRule).toContain('overflow: auto');
  });

  it('gives each row the prototype 7px 4px padding, 9px radius and 4% hover wash', () => {
    const rowRule = ruleFor('.sc-detail-member-item');
    expect(rowRule).toContain('padding: 7px 4px');
    expect(rowRule).toContain('border-radius: 9px');
    expect(chatCss).toMatch(
      /\.sc-detail-member-item:hover\s*\{\s*background:\s*color-mix\(in srgb, var\(--pt-text\) 4%, transparent\);\s*\}/,
    );
  });

  it('renders 30px / radius-9 avatars and regular-weight row names', () => {
    expect(detailSource).toMatch(/<MemberAvatar member=\{member\} size=\{30\} radius=\{9\} \/>/);
    const strongRule = ruleFor('.sc-detail-member-item__body strong');
    expect(strongRule).toContain('font-weight: 400');
    expect(strongRule).toContain('font-size: 13px');
  });

  it('shows the role capsule only for admins/owners in the prototype primary wash', () => {
    expect(detailSource).toMatch(/\{role >= MemberRole\.ADMIN \? \(\s*<PtTag className="sc-detail-member-item__role">/);
    const rolePillRule = ruleFor('.sc-detail-member-item__role.pt-tag');
    expect(rolePillRule).toContain('border-radius: 999px');
    expect(rolePillRule).toContain('padding: 2px 8px');
    expect(rolePillRule).toContain(
      'background: color-mix(in srgb, var(--pt-primary) 10%, transparent)',
    );
    expect(rolePillRule).toContain('color: var(--pt-primary)');
  });

  it('spaces row actions at the prototype 2px rhythm', () => {
    const actionsRule = ruleFor('.sc-detail-member-item__actions');
    expect(actionsRule).toContain('gap: 2px');
  });
});
