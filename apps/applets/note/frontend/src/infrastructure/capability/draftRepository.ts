import { sdk } from '@peers-touch/applet-sdk';

export interface NoteDraft {
  title: string;
  content: string;
}

const CREATE_DRAFT_KEY = 'note.draft.create';
const EDIT_DRAFT_PREFIX = 'note.draft.edit.';

function draftKey(noteId?: string): string {
  return noteId ? `${EDIT_DRAFT_PREFIX}${noteId}` : CREATE_DRAFT_KEY;
}

export async function loadDraft(noteId?: string): Promise<NoteDraft | null> {
  const draft = await sdk.storage.get<Partial<NoteDraft>>(draftKey(noteId));
  if (!draft || typeof draft !== 'object') {
    return null;
  }
  return {
    title: typeof draft.title === 'string' ? draft.title : '',
    content: typeof draft.content === 'string' ? draft.content : '',
  };
}

export async function saveDraft(draft: NoteDraft, noteId?: string): Promise<void> {
  if (!draft.title.trim() && !draft.content.trim()) {
    await clearDraft(noteId);
    return;
  }
  await sdk.storage.set(draftKey(noteId), draft);
}

export async function clearDraft(noteId?: string): Promise<void> {
  await sdk.storage.remove(draftKey(noteId));
}
