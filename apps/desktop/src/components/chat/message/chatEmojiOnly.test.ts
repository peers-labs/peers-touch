import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isBareEmojiOnlyMessage, isEmojiOnlyText } from './chatMessageModel';
import type { ChatMessage } from './chatMessageModel';

function baseMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    ulid: 'm1',
    content: '',
    attachments: [],
    ...overrides,
  } as unknown as ChatMessage;
}

describe('emoji-only message grammar (north-star .sk-emoji-only-bubble parity)', () => {
  it('detects short pure-emoji text and rejects letters/mixed text', () => {
    expect(isEmojiOnlyText('😀')).toBe(true);
    expect(isEmojiOnlyText('🎉 🔥 ')).toBe(true);
    expect(isEmojiOnlyText('👨‍👩‍👧‍👦')).toBe(true);
    expect(isEmojiOnlyText('hello 😀')).toBe(false);
    expect(isEmojiOnlyText('')).toBe(false);
    expect(isEmojiOnlyText('a')).toBe(false);
  });

  it('treats an emoji-only text message as bare only when no attachments/service/recall', () => {
    expect(isBareEmojiOnlyMessage(baseMessage({ content: '😀' }))).toBe(true);
    expect(isBareEmojiOnlyMessage(baseMessage({
      content: '😀',
      attachments: [{ cid: 'a1' }] as unknown as ChatMessage['attachments'],
    }))).toBe(false);
    expect(isBareEmojiOnlyMessage(baseMessage({
      content: '😀',
      serviceMessage: { kind: 'x' } as unknown as ChatMessage['serviceMessage'],
    }))).toBe(false);
    expect(isBareEmojiOnlyMessage(baseMessage({ content: 'hi' }))).toBe(false);
  });

  it('renders the bare glyph with no bubble box and a 34/42 class, not inline sizing', () => {
    const rowSource = readFileSync(new URL('./ChatMessageRow.tsx', import.meta.url), 'utf8');
    const contentSource = readFileSync(new URL('./ChatMessageContent.tsx', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../../../ui/chat.css', import.meta.url), 'utf8');
    expect(rowSource).toContain('data-emoji-only={emojiOnlyBare || undefined}');
    expect(rowSource).toMatch(/emojiOnlyBare\s*\?\s*'transparent'/);
    expect(contentSource).toContain("className={isBareEmojiOnlyMessage(message) ? 'sc-emoji-only-bubble' : undefined}");
    expect(contentSource).not.toContain('fontSize: 32');
    expect(css).toMatch(/\.sc-emoji-only-bubble\s*\{[^}]*font-size:\s*34px/);
  });
});
