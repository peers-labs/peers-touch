import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./AssistantMessage.tsx', import.meta.url),
  'utf8',
);

describe('assistant activity duration visibility', () => {
  it('treats a zero-second completed turn as runtime diagnostics', () => {
    expect(source).toContain('message.processDuration != null');
    expect(source).not.toContain('!!message.processDuration');
  });
});
