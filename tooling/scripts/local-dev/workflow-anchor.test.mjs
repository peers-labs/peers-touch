import assert from 'node:assert/strict';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assistantContainsAnchor,
  renderWorkflowAnchor,
} from './workflow-anchor.mjs';

function fixture() {
  return renderWorkflowAnchor(
    {
      executionRoot: '/private/work/peers-touch',
      workspaceId: '0123456789abcdef',
      role: 'OWNER',
      bindingDigest: 'a'.repeat(64),
      rootBindingDigest: 'a'.repeat(64),
    },
    {
      status: 'TERMINAL',
      tracked: true,
      binding: { planId: 'PLAN-1', planPath: 'docs/plan.md' },
      planPackage: {
        manifest: {
          status: 'completed',
          binding: { initialHead: 'initial' },
          tasks: [{ id: 'TASK-1', status: 'done' }],
        },
      },
      branch: 'main',
      head: 'head',
    },
  );
}

test('renders a deterministic anchor without exposing the absolute root', () => {
  const first = fixture();
  const second = fixture();
  assert.equal(first.content, second.content);
  assert.match(first.content, /pt-workflow-anchor:[0-9a-f]{64}/);
  assert.equal(first.content.includes('/private/work'), false);
});

test('finds the exact rendered anchor in a Cursor JSONL transcript tail', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'pt-anchor-transcript-'));
  try {
    const anchor = fixture();
    const transcript = path.join(temporary, 'transcript.jsonl');
    writeFileSync(
      transcript,
      `${JSON.stringify({ role: 'assistant', content: anchor.content })}\n`,
    );
    assert.equal(
      assistantContainsAnchor({ transcriptPath: transcript }, anchor),
      true,
    );
    assert.equal(
      assistantContainsAnchor(
        { lastAssistantMessage: `${anchor.content} changed` },
        { ...anchor, content: `${anchor.content}\nmissing` },
      ),
      false,
    );
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
