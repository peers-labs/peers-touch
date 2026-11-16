/**
 * Increment 13 — attachment draft staging for the chat composer. Files picked
 * from the local picker (or pasted/dropped) stage through uploading → ready;
 * oversized files fail once on the first attempt and succeed on retry, which
 * exercises the same failed/retry/remove lifecycle as the desktop composer
 * without a Tauri staging backend. All previews are local object URLs.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { AlertCircle, File as FileIcon, Image as ImageIcon, Loader2, RotateCcw, Trash2, Video } from 'lucide-react';
import type { MessageAttachment } from './chat-data';
import { useT } from '../prefs';
import type { ConversationWorkingState } from './conversation-working-state';

// Local-example policy: a file this large fails its first staging attempt.
const FAIL_FIRST_ATTEMPT_BYTES = 8 * 1024 * 1024;
const PROGRESS_TICK_MS = 180;

export type DraftStatus = 'uploading' | 'ready' | 'failed';

export type AttachmentDraft = MessageAttachment & {
  status: DraftStatus;
  progress: number;
  attempt: number;
};

function mediaKind(file: File): MessageAttachment['kind'] {
  return file.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name) ? 'image'
    : file.type.startsWith('video/') ? 'file' // videos stage as generic files in the prototype
      : 'file';
}

export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let draftSeq = 0;

export function useAttachmentDrafts(working: ConversationWorkingState) {
  const drafts = useSyncExternalStore(working.subscribe, () => working.snapshot.attachments);
  const setDrafts = useCallback((update: AttachmentDraft[] | ((list: AttachmentDraft[]) => AttachmentDraft[])) =>
    working.setAttachments(update), [working]);
  const timersRef = { current: working.timers };

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearInterval(timer);
      timersRef.current.delete(id);
    }
  }, [working]);

  const patch = useCallback((id: string, next: Partial<AttachmentDraft>) => {
    setDrafts(list => list.map(item => (item.id === id ? { ...item, ...next } : item)));
  }, [setDrafts]);

  const stage = useCallback((id: string) => {
    const current = working.snapshot.attachments.find(item => item.id === id);
    if (!current) return;
    const attempt = current.attempt + 1;
    clearTimer(id);
    patch(id, { status: 'uploading', progress: 8, attempt });
    // Deterministic local-example failure, recoverable via retry.
    if (current.size >= FAIL_FIRST_ATTEMPT_BYTES && attempt === 1) {
      const timer = window.setTimeout(() => {
        clearTimer(id);
        patch(id, { status: 'failed', progress: 0 });
      }, 420);
      timersRef.current.set(id, timer);
      return;
    }
    const timer = window.setInterval(() => {
      const now = working.snapshot.attachments.find(item => item.id === id);
      if (!now || now.status !== 'uploading') {
        clearTimer(id);
        return;
      }
      const next = Math.min(100, now.progress + 16 + Math.round(Math.random() * 14));
      if (next >= 100) {
        clearTimer(id);
        patch(id, { status: 'ready', progress: 100 });
      } else {
        patch(id, { progress: next });
      }
    }, PROGRESS_TICK_MS);
    timersRef.current.set(id, timer);
  }, [clearTimer, patch, working]);

  const addFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const added: AttachmentDraft[] = files.map(file => {
      const kind = mediaKind(file);
      return {
        id: `draft-${Date.now()}-${draftSeq++}`,
        kind,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        previewUrl: kind === 'image' ? URL.createObjectURL(file) : null,
        status: 'uploading',
        progress: 4,
        attempt: 0,
      };
    });
    setDrafts(list => [...list, ...added]);
    added.forEach(item => stage(item.id));
  }, [stage, setDrafts]);

  const removeDraft = useCallback((id: string) => {
    clearTimer(id);
    setDrafts(list => {
      const target = list.find(item => item.id === id);
      working.releaseUrl(target?.previewUrl);
      return list.filter(item => item.id !== id);
    });
  }, [clearTimer, setDrafts]);

  const retryDraft = useCallback((id: string) => stage(id), [stage]);

  // On send, preview URLs transfer to the posted message and must stay
  // alive; only explicit draft removal reclaims a URL.
  const clearDrafts = useCallback((revokeUrls = false) => {
    timersRef.current.forEach(timer => window.clearInterval(timer));
    timersRef.current.clear();
    setDrafts(list => {
      if (revokeUrls) {
        list.forEach(item => {
          working.releaseUrl(item.previewUrl);
        });
      }
      return [];
    });
  }, [setDrafts, working]);

  const ready = drafts.filter(item => item.status === 'ready');
  return {
    drafts, ready,
    uploading: drafts.some(item => item.status === 'uploading'),
    failed: drafts.some(item => item.status === 'failed'),
    addFiles, removeDraft, retryDraft, clearDrafts,
  };
}

/* ── Draft strip ───────────────────────────────────────── */

function DraftIcon({ draft, size = 16 }: { draft: AttachmentDraft; size?: number }) {
  if (draft.status === 'uploading') return <Loader2 size={size} className="sk-spin" />;
  if (draft.status === 'failed') return <AlertCircle size={size} />;
  if (draft.kind === 'image') return <ImageIcon size={size} />;
  if (draft.mime.startsWith('video/')) return <Video size={size} />;
  return <FileIcon size={size} />;
}

export function AttachmentDraftStrip({ drafts, onRemove, onRetry }: {
  drafts: AttachmentDraft[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  const { t } = useT();
  if (drafts.length === 0) return null;
  return (
    <div className="sk-draft-strip" data-draft-count={drafts.length}>
      {drafts.map(draft => (
        <div key={draft.id}
          className={`sk-draft-card${draft.status === 'failed' ? ' is-failed' : ''}`}
          data-draft-id={draft.id}
          data-draft-status={draft.status}>
          <div className="sk-draft-thumb">
            {draft.previewUrl
              ? <img src={draft.previewUrl} alt={draft.name} />
              : <DraftIcon draft={draft} size={20} />}
            {draft.status === 'uploading' && (
              <span className="sk-draft-progress" data-progress={draft.progress}>
                <span style={{ width: `${draft.progress}%` }} />
              </span>
            )}
          </div>
          <div className="sk-draft-meta">
            <strong title={draft.name}>{draft.kind === 'image' ? t('draft.image') : draft.name}</strong>
            <span>
              {draft.status === 'uploading' ? t('draft.uploading', { n: draft.progress })
                : draft.status === 'failed' ? t('draft.failed', { size: formatAttachmentSize(draft.size) })
                  : formatAttachmentSize(draft.size)}
            </span>
          </div>
          <div className="sk-draft-actions">
            {draft.status === 'failed' && (
              <button type="button" className="sk-draft-op" aria-label={t('draft.retry')}
                data-draft-retry onClick={() => onRetry(draft.id)}><RotateCcw size={13} /></button>
            )}
            <button type="button" className="sk-draft-op" aria-label={t('draft.remove')}
              data-draft-remove onClick={() => onRemove(draft.id)}><Trash2 size={13} /></button>
          </div>
        </div>
      ))}
    </div>
  );
}
