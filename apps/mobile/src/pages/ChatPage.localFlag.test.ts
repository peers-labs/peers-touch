import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  new URL('./ChatPage.tsx', import.meta.url),
  'utf8',
);
const flagSource = readFileSync(
  new URL('../features/chat/messageFlagState.ts', import.meta.url),
  'utf8',
);

describe('device-local message flag surface', () => {
  it('keeps flag persistence outside Station and Messaging Engine commands', () => {
    expect(flagSource).toContain('.repositories.messageFlags');
    expect(flagSource).toContain('createMobileActorStorageRuntime');
    expect(flagSource).not.toContain('chatCommands');
    expect(flagSource).not.toContain('mobileCommands');
    expect(flagSource).not.toContain('/actor/');
  });

  it('renders explicit device scope in metadata and the message action sheet', () => {
    expect(pageSource).toContain("t('mobile.chat.flaggedOnDevice')");
    expect(pageSource).toContain("'mobile.chat.unflagOnDevice'");
    expect(pageSource).toContain("'mobile.chat.flagOnDevice'");
    expect(pageSource).toContain('data-message-local-flag="true"');
    expect(pageSource).toContain('<MessageActionSheet');
  });
});
