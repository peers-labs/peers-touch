import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ChatStorageSettings.tsx', import.meta.url), 'utf8');

describe('ChatStorageSettings batch clear surface', () => {
  it('exposes explicit selection, confirmation, progress, and retry controls', () => {
    for (const selector of [
      'data-chat-storage-batch-manage',
      'data-chat-storage-batch-select-all',
      'data-chat-storage-conversation-select',
      'data-chat-storage-batch-clear',
      'data-chat-storage-batch-confirm',
      'data-chat-storage-batch-estimated-bytes',
      'data-chat-storage-batch-selected-count',
      'data-chat-storage-batch-scope',
      'data-chat-storage-batch-confirm-apply',
      'data-chat-storage-batch-progress',
      'data-chat-storage-batch-completed',
      'data-chat-storage-batch-total',
      'data-chat-storage-batch-result',
      'data-chat-storage-batch-retry',
      'data-chat-storage-reclaimable-bytes',
    ]) {
      expect(source).toContain(selector);
    }
  });

  it('delegates deletion to the runtime batch owner', () => {
    expect(source).toContain('chatStorageProjectionRuntime.clearConversations(');
    expect(source).not.toContain('api.chatStorageClearConversation');
  });

  it('invalidates stale async batch callbacks when the storage scope changes', () => {
    expect(source).toContain('const batchAttemptRef = useRef(0);');
    expect(source).toContain('batchAttemptRef.current += 1;');
    expect(source).toContain('if (batchAttemptRef.current !== attempt) return;');
    expect(source).toContain(
      'if (batchAttemptRef.current === attempt) setBatchRunning(false);',
    );
  });
});
