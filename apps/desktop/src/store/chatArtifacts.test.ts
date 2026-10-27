import { describe, expect, it } from 'vitest';
import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { TurnArtifactSchema } from '../gen/proto/domain/agent/agent_pb';
import { extractMessageArtifacts, type ChatMessage } from './chat';
import { projectTurnArtifact } from './chatArtifacts';

function assistantMessage(content: string): ChatMessage {
  return {
    id: 'msg-artifact-test',
    role: 'assistant',
    content,
    timestamp: 1781680000000,
  };
}

describe('chat code-block presentations', () => {
  it('extracts code, diagram, and structured presentations from fenced blocks', () => {
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

describe('Station turn artifact projection', () => {
  it('marks only the producing device local while preserving the Station copy', () => {
    const artifact = create(TurnArtifactSchema, {
      artifactId: 'artifact-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      toolCallId: 'tool-1',
      kind: 1,
      name: 'report.md',
      size: 42n,
      sha256: 'a'.repeat(64),
      locator: {
        clientLocalRef: 'artifact-local-1',
        clientDeviceId: 'device-origin',
        stationObjectRef: 'cas/aa/report.md',
      },
      createdAt: timestampFromDate(new Date('2026-10-25T00:00:00Z')),
    });

    expect(projectTurnArtifact(artifact, 'device-origin')).toMatchObject({
      id: 'artifact-1',
      localAvailable: true,
      stationObjectRef: 'cas/aa/report.md',
    });
    expect(projectTurnArtifact(artifact, 'device-other')).toMatchObject({
      localAvailable: false,
      stationObjectRef: 'cas/aa/report.md',
    });
  });
});
