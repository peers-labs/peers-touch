import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const pickerSource = readFileSync(new URL('./ForwardPickerModal.tsx', import.meta.url), 'utf8');
const enChat = readFileSync(new URL('../../../../../packages/locales/en/chat.json', import.meta.url), 'utf8');
const zhChat = readFileSync(new URL('../../../../../packages/locales/zh-CN/chat.json', import.meta.url), 'utf8');

describe('forward picker i18n + primitive parity', () => {
  it('uses locale keys instead of hardcoded English kind labels', () => {
    expect(pickerSource).not.toContain('Group ·');
    expect(pickerSource).not.toMatch(/['"]Direct['"]\s*\)/);
    expect(pickerSource).toContain("t('chat.social.messageArea.forwardKindGroup'");
    expect(pickerSource).toContain("t('chat.social.messageArea.forwardKindDirect'");
  });

  it('defines the kind keys in both locales (parity)', () => {
    expect(enChat).toContain('chat.social.messageArea.forwardKindGroup');
    expect(enChat).toContain('chat.social.messageArea.forwardKindDirect');
    expect(zhChat).toContain('chat.social.messageArea.forwardKindGroup');
    expect(zhChat).toContain('chat.social.messageArea.forwardKindDirect');
  });

  it('composes peers Dialog/TextField/Empty, not native form controls', () => {
    expect(pickerSource).toMatch(/from '@peers-touch\/ui'/);
    expect(pickerSource).toContain('<Dialog');
    expect(pickerSource).toContain('<PtTextField');
    expect(pickerSource).toContain('<PtEmpty');
    expect(pickerSource).not.toContain('<select');
  });
});
