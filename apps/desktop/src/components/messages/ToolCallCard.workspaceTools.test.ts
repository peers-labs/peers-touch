import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./ToolCallCard.tsx', import.meta.url),
  'utf8',
);

describe('workspace write/edit/shell tool cards', () => {
  it('renders dedicated cards for the three new tools', () => {
    expect(source).toContain("tool.name === 'local_file_write'");
    expect(source).toContain("tool.name === 'local_file_edit'");
    expect(source).toContain("tool.name === 'local_shell_exec'");
    expect(source).toContain('data-pt-agent-tool="workspace-file"');
    expect(source).toContain('data-pt-agent-tool="workspace-shell"');
  });

  it('previews edit diff with old/new strings and write content', () => {
    expect(source).toContain("args?.old_string");
    expect(source).toContain("args?.new_string");
    expect(source).toContain("args?.content");
    expect(source).toContain('chat.message.toolCall.workspace.edit');
  });

  it('shows command line and exit code from the receipt', () => {
    expect(source).toContain('args?.command');
    expect(source).toContain('output.exit_code');
    expect(source).toContain('chat.message.toolCall.workspace.exit');
  });
});
