import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const wrapperSource = readFileSync(
  new URL('./LazyMarkdown.tsx', import.meta.url),
  'utf8',
);
const assistantSource = readFileSync(
  new URL('./messages/AssistantMessage.tsx', import.meta.url),
  'utf8',
);
const userSource = readFileSync(
  new URL('./messages/UserMessage.tsx', import.meta.url),
  'utf8',
);

describe('chat markdown engine alignment (peers Markdown primitive)', () => {
  it('backs the wrapper with the peers Markdown, not the lobehub engine', () => {
    expect(wrapperSource).toContain(
      "import { Markdown, type MarkdownProps } from '@peers-touch/ui';",
    );
    expect(wrapperSource).not.toContain('@lobehub');
    expect(wrapperSource).not.toContain('React.lazy');
  });

  it('enables the north-star feature set and the localized reasoning block', () => {
    expect(wrapperSource).toMatch(/math:\s*true/);
    expect(wrapperSource).toMatch(/diagrams:\s*true/);
    expect(wrapperSource).toMatch(/footnotes:\s*true/);
    expect(wrapperSource).toMatch(/alerts:\s*true/);
    expect(wrapperSource).toContain('InlineThinkingTag');
    expect(wrapperSource).toContain('renderReasoning');
    expect(wrapperSource).toContain('resolveImage');
  });

  it('drives the assistant body with content/streaming and peers codeActions', () => {
    expect(assistantSource).toContain('content={message.content}');
    expect(assistantSource).toContain('streaming={message.loading}');
    expect(assistantSource).toContain('codeActions={(block) =>');
    // Code block action contracts survive the engine swap.
    expect(assistantSource).toContain('actionId="code-block-export"');
    expect(assistantSource).toContain('actionId="code-block-run"');
    expect(assistantSource).toContain(
      'handleExportCodeBlock(block.code, block.language)',
    );
    expect(assistantSource).toContain(
      'handleRunCodeBlock(block.code, block.language)',
    );
    expect(assistantSource).not.toContain('actionsRender');
    expect(assistantSource).not.toContain('componentProps');
  });

  it('uses the peers content prop at every body call site', () => {
    expect(userSource).toContain('content={message.content}');
    expect(userSource).not.toContain('chatMarkdownProps');
  });
});
