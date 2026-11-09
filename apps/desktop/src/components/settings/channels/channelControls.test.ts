import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const managementSource = readFileSync(
  new URL('./ChannelManagementPanels.tsx', import.meta.url),
  'utf8',
);
const provisioningSource = readFileSync(
  new URL('./ChannelProvisioningPanel.tsx', import.meta.url),
  'utf8',
);
const larkSource = readFileSync(
  new URL('./LarkChannelsSettings.tsx', import.meta.url),
  'utf8',
);
const stylesheet = readFileSync(
  new URL('./LarkChannelsSettings.css', import.meta.url),
  'utf8',
);

const panelSources = [managementSource, provisioningSource, larkSource];

describe('channel settings control alignment (peers Select primitive)', () => {
  it('replaces every native select with the peers Select primitive', () => {
    for (const source of panelSources) {
      expect(source).not.toMatch(/<select/);
      expect(source).not.toMatch(/<option/);
      expect(source).toMatch(/import\s*\{[^}]*\bSelect\b[^}]*\}\s*from '@peers-touch\/ui'/);
    }
  });

  it('renders flat settings-row pickers with the ghost appearance grammar', () => {
    // access mode, group response mode, output mode
    expect(managementSource.match(/appearance="ghost"/g)).toHaveLength(3);
  });

  it('models optional chat/agent pickers as clearable placeholder selects', () => {
    // route chat, message source chat, automation destination chat
    expect(managementSource.match(/\bclearable\b/g)).toHaveLength(3);
    // binding agent picker, test-target picker
    expect(larkSource.match(/\bclearable\b/g)).toHaveLength(2);
  });

  it('keeps the recovery focus hand-off on a public control id, not a native ref', () => {
    expect(larkSource).not.toContain('HTMLSelectElement');
    expect(larkSource).not.toContain('agentSelectRef');
    expect(larkSource).toContain('AGENT_SELECT_CONTROL_ID');
    expect(larkSource).toContain('document.getElementById(AGENT_SELECT_CONTROL_ID)');
  });

  it('leaves no dead native-select CSS rules while keeping the row width contract', () => {
    // Bare element selector only; .pt-select / user-select must stay allowed.
    expect(stylesheet).not.toMatch(/(?<![\w-])select\b/);
    expect(stylesheet).toContain('.pt-channel-setting-row .pt-select');
  });
});

describe('channel settings control alignment (peers field/button primitives)', () => {
  it('uses no native inputs, textareas, or selects in any channel panel', () => {
    for (const source of panelSources) {
      expect(source).not.toMatch(/<input/);
      expect(source).not.toMatch(/<textarea/);
      expect(source).not.toMatch(/<select/);
    }
  });

  it('backs every text field/area with the peers TextField/TextArea primitives', () => {
    expect(provisioningSource).toContain('TextField');
    expect(provisioningSource).not.toMatch(/<input/);
    expect(managementSource).toMatch(/import\s*\{[^}]*\bTextField\b[^}]*\}\s*from '@peers-touch\/ui'/);
    expect(managementSource).toMatch(/import\s*\{[^}]*\bTextArea\b[^}]*\}\s*from '@peers-touch\/ui'/);
    expect(larkSource).toMatch(/import\s*\{[^}]*\bTextArea\b[^}]*\}\s*from '@peers-touch\/ui'/);
  });

  it('renders icon-only row/nav actions as peers IconButton glyphs', () => {
    // panel back, route edit/delete, automation run/edit/delete, notice dismiss
    expect(managementSource).toContain('IconButton');
    expect(managementSource).toContain('iconId="arrow-left"');
    expect(managementSource).toContain('iconId="pencil-line"');
    expect(managementSource).toContain('iconId="delete"');
    expect(managementSource).toContain('iconId="play"');
    expect(larkSource).toContain('iconId="close"');
  });

  it('keeps only the two full-width navigation cards as bespoke card surfaces', () => {
    // Management/provisioning panels have no native buttons left.
    expect(managementSource).not.toMatch(/<button/);
    expect(provisioningSource).not.toMatch(/<button/);
    // Lark keeps the intent row and the connection collection card — the
    // prototype models the same rows as custom cards, not peers Buttons.
    expect(larkSource.match(/<button/g)).toHaveLength(2);
    expect(larkSource).toContain('className="pt-channel-intent-row"');
    expect(larkSource).toContain('className="pt-channel-connection-row"');
  });

  it('lets .pt-field-frame own the field box instead of repainting inner inputs', () => {
    expect(stylesheet).not.toMatch(/\.pt-channel\s+input\b/);
    expect(stylesheet).not.toMatch(/\.pt-channel\s+textarea\b/);
    expect(stylesheet).not.toMatch(/\.pt-channel-provision-modal\s+input\b/);
    expect(stylesheet).toContain('.pt-channel .pt-field-frame');
  });
});

describe('channel settings theme alignment (north-star token grammar)', () => {
  it('binds the local accent variable to the ink primary token in both scopes', () => {
    const accentDeclarations = stylesheet.match(/--channel-accent:\s*[^;]+;/g) ?? [];
    expect(accentDeclarations.length).toBeGreaterThanOrEqual(2);
    for (const declaration of accentDeclarations) {
      expect(declaration).toContain('var(--pt-primary)');
    }
  });

  it('keeps no off-palette brand hues outside the functional QR white', () => {
    // Superseded purple direction, teal Lark tile, navy ink, dead grey fallback.
    expect(stylesheet).not.toContain('#6b5bd6');
    expect(stylesheet).not.toContain('#00d6b9');
    expect(stylesheet).not.toContain('#123b56');
    expect(stylesheet).not.toContain('#8a8f99');
    // QR tiles legitimately stay white for scanner contrast; strip those
    // blocks (and comments) before asserting no other hex color survives.
    const withoutQrTiles = stylesheet
      .replace(/\.pt-channel-qr\s*\{[^}]*\}/g, '')
      .replace(/\.pt-channel-personal-qr\s*>\s*\[data-schema-qr\]\s*\{[^}]*\}/g, '');
    const codeOnly = withoutQrTiles.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(codeOnly).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('renders the Lark identity mark as the same neutral accent tile as the agent mark', () => {
    // The shared layout rule shares its selector with the agent mark; anchor
    // on the color block itself.
    const larkMarkRule = stylesheet.match(
      /\.pt-channel-lark-mark\s*\{[^}]*color-mix\(in srgb, var\(--channel-accent\) 14%, transparent\)[^}]*\}/,
    )?.[0] ?? '';
    expect(larkMarkRule).toContain('color: var(--channel-accent)');
    expect(larkMarkRule).not.toMatch(/background:\s*#/);
  });
});
