/**
 * Conversation-owned working state. The assembly never owns user content.
 * One bucket per live conversation, one active DOM; deletion owns disposal.
 */
import type { AttachmentDraft } from './ComposerAttachments';
import { SEED_THREADS, type ChatMessage, type ThreadReply } from './chat-data';
import type { RecordedVoice } from './VoiceNote';

export type ComposerWorkingState = {
  text: string;
  editText: string;
  expanded: boolean;
  voice: RecordedVoice | null;
  caret: { start: number; end: number };
};
type WorkingSnapshot = {
  composer: ComposerWorkingState;
  controls: { reply: ChatMessage | null; edit: ChatMessage | null };
  attachments: AttachmentDraft[];
  threads: Record<string, ThreadReply[]>;
  threadDrafts: Record<string, string>;
};
export type ReadingAnchor = { messageId: string | null; offset: number; top: number; atTail: boolean };

export class ConversationWorkingState {
  snapshot: WorkingSnapshot = {
    composer: { text: '', editText: '', expanded: false, voice: null, caret: { start: 0, end: 0 } },
    controls: { reply: null, edit: null },
    attachments: [],
    threads: SEED_THREADS,
    threadDrafts: {},
  };
  readonly timers = new Map<string, number>();
  private readonly urls = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  reading: ReadingAnchor = { messageId: null, offset: 0, top: 0, atTail: true };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(next: WorkingSnapshot) {
    if (this.disposed) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  patchComposer(patch: Partial<ComposerWorkingState>) {
    if (patch.voice?.url.startsWith('blob:')) this.urls.add(patch.voice.url);
    this.publish({ ...this.snapshot, composer: { ...this.snapshot.composer, ...patch } });
  }
  patchControls(patch: Partial<WorkingSnapshot['controls']>) {
    this.publish({ ...this.snapshot, controls: { ...this.snapshot.controls, ...patch } });
  }
  setAttachments(update: AttachmentDraft[] | ((current: AttachmentDraft[]) => AttachmentDraft[])) {
    const next = typeof update === 'function' ? update(this.snapshot.attachments) : update;
    for (const draft of next) {
      if (draft.previewUrl?.startsWith('blob:')) this.urls.add(draft.previewUrl);
    }
    this.publish({ ...this.snapshot, attachments: next });
  }
  releaseUrl(url: string | null | undefined) {
    if (!url || !this.urls.delete(url)) return;
    URL.revokeObjectURL(url);
  }
  setThreadDraft(id: string, text: string) {
    this.publish({ ...this.snapshot, threadDrafts: { ...this.snapshot.threadDrafts, [id]: text } });
  }
  replyInThread(id: string, reply: ThreadReply) {
    this.publish({ ...this.snapshot, threads: {
      ...this.snapshot.threads, [id]: [...(this.snapshot.threads[id] ?? []), reply],
    } });
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
    }
    this.timers.clear();
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.listeners.clear();
  }
}

export class ConversationWorkingSet {
  private readonly buckets = new Map<string, ConversationWorkingState>();
  get(id: string) {
    let bucket = this.buckets.get(id);
    if (!bucket) {
      bucket = new ConversationWorkingState();
      this.buckets.set(id, bucket);
    }
    return bucket;
  }
  drop(id: string) {
    this.buckets.get(id)?.dispose();
    this.buckets.delete(id);
  }
  dispose() {
    for (const bucket of this.buckets.values()) bucket.dispose();
    this.buckets.clear();
  }
}
