import { describe, expect, it } from 'vitest';
import { extractMessageArtifacts, type ChatMessage } from './chat';

function assistantMessage(content: string): ChatMessage {
  return {
    id: 'msg-artifact-test',
    role: 'assistant',
    content,
    timestamp: 1781680000000,
  };
}

describe('chat message artifacts', () => {
  it('extracts code, diagram, and structured artifacts from fenced blocks', () => {
    const artifacts = extractMessageArtifacts(assistantMessage([
      'Here are outputs:',
      '```ts',
      'export const value = 1;',
      '```',
      '```mermaid',
      'graph TD; A-->B;',
      '```',
      '```json',
      '{"ok": true}',
      '```',
    ].join('\n')));

    expect(artifacts).toHaveLength(3);
    expect(artifacts.map((artifact) => artifact.kind)).toEqual(['code', 'diagram', 'structured']);
    expect(artifacts.map((artifact) => artifact.language)).toEqual(['ts', 'mermaid', 'json']);
    expect(artifacts[0].messageId).toBe('msg-artifact-test');
  });

  it('promotes long markdown answers into document artifacts with message provenance', () => {
    const content = [
      '# Product Brief',
      '',
      'This generated document describes the artifact surface.',
      '',
      '## Goals',
      '',
      'A'.repeat(700),
    ].join('\n');

    const artifacts = extractMessageArtifacts(assistantMessage(content));

    expect(artifacts[0]).toMatchObject({
      id: 'msg-artifact-test:document',
      messageId: 'msg-artifact-test',
      kind: 'document',
      language: 'markdown',
      content,
    });
  });

  it('does not extract artifacts from user messages', () => {
    const artifacts = extractMessageArtifacts({
      ...assistantMessage('```ts\nconst unsafe = false;\n```'),
      role: 'user',
    });

    expect(artifacts).toEqual([]);
  });
});
