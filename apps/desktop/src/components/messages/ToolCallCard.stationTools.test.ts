import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./ToolCallCard.tsx', import.meta.url),
  'utf8',
);

describe('station builtin tool cards (web_fetch / todo)', () => {
  it('renders dedicated todo and web fetch activities', () => {
    expect(source).toContain("tool.name === 'todo_write'");
    expect(source).toContain("tool.name === 'todo_update'");
    expect(source).toContain("tool.name === 'web_fetch'");
    expect(source).toContain('data-pt-agent-tool="todo"');
    expect(source).toContain('data-pt-agent-tool="web-fetch"');
  });

  it('shows checklist progress from the latest tool result', () => {
    expect(source).toContain('parseTodoPayload(tool.result)');
    expect(source).toContain("item.status === 'completed'");
    expect(source).toContain('chat.message.toolCall.todo.progress');
  });

  it('shows the fetched URL and HTTP status without raw blocks', () => {
    expect(source).toContain('chat.message.toolCall.webFetch.status');
    // Dedicated cards replace the generic arguments/result pre blocks.
    const genericArgsGuard = source.match(
      /tool\.args && tool\.name !== 'ask_user'[\s\S]{0,200}web_fetch/,
    );
    expect(genericArgsGuard).not.toBeNull();
    const genericResultGuard = source.match(
      /tool\.result && tool\.name !== 'ask_user'[\s\S]{0,200}web_fetch/,
    );
    expect(genericResultGuard).not.toBeNull();
  });
});
