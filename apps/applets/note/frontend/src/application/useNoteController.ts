import { useCallback, useEffect, useState } from '@lynx-js/react';
import type { Note } from '../domain/note';
import { clearDraft, loadDraft, saveDraft } from '../infrastructure/capability/draftRepository';
import { createNote, deleteNote, listNotes, restoreNote, searchNotes, updateNote } from '../infrastructure/capability/serviceClient';
import { t } from '../infrastructure/i18n/messages';

export type NoteViewMode = 'list' | 'search' | 'deleted';
export type NoteEditorMode = 'create' | 'edit';

export interface NoteEditorState {
  mode: NoteEditorMode;
  targetNoteId: string;
  title: string;
  content: string;
  resetKey: number;
  draftLoaded: boolean;
}

export interface NoteControllerState {
  notes: Note[];
  selectedNoteId: string;
  mode: NoteViewMode;
  loading: boolean;
  error: string;
  searchQuery: string;
  searchResetKey: number;
  editor: NoteEditorState;
}

export interface NoteController extends NoteControllerState {
  selectedNote: Note | undefined;
  load: () => Promise<void>;
  search: () => Promise<void>;
  clearSearch: () => Promise<void>;
  selectNote: (noteId: string) => void;
  startCreate: () => void;
  startEditSelected: () => void;
  updateEditorTitle: (title: string) => void;
  updateEditorContent: (content: string) => void;
  updateSearchQuery: (query: string) => void;
  saveEditor: () => Promise<void>;
  deleteSelected: () => Promise<void>;
  loadDeleted: () => Promise<void>;
  restoreSelected: () => Promise<void>;
}

function createEmptyEditor(resetKey = 0): NoteEditorState {
  return {
    mode: 'create',
    targetNoteId: '',
    title: '',
    content: '',
    resetKey,
    draftLoaded: false,
  };
}

function createEditorFromDraft(mode: NoteEditorMode, targetNoteId: string, resetKey: number, draft?: { title: string; content: string } | null): NoteEditorState {
  return {
    mode,
    targetNoteId,
    title: draft?.title ?? '',
    content: draft?.content ?? '',
    resetKey,
    draftLoaded: Boolean(draft && (draft.title.trim() || draft.content.trim())),
  };
}

function normalizeErrorKey(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('PERMISSION_DENIED')) return 'note.error.permissionDenied';
    if (error.message.includes('TIMEOUT') || error.message.includes('timeout')) return 'note.error.timeout';
    if (error.message.includes('NOT_FOUND') || error.message.includes('not found')) return 'note.error.notFound';
    if (error.message.includes('CONFLICT') || error.message.includes('conflict')) return 'note.error.conflict';
    if (error.message.startsWith('note.error.')) return error.message;
  }
  return 'note.error.operationFailed';
}

export function useNoteController(): NoteController {
  const [state, setState] = useState<NoteControllerState>({
    notes: [],
    selectedNoteId: '',
    mode: 'list',
    loading: true,
    error: '',
    searchQuery: '',
    searchResetKey: 0,
    editor: createEmptyEditor(),
  });

  const selectedNote = state.notes.find((note) => note.noteId === state.selectedNoteId);

  const setError = useCallback((error: unknown) => {
    setState((current) => ({
      ...current,
      loading: false,
      error: t(normalizeErrorKey(error)),
    }));
  }, []);

  const setErrorKey = useCallback((key: string) => {
    setState((current) => ({
      ...current,
      loading: false,
      error: t(key),
    }));
  }, []);

  const applyNotes = useCallback((notes: Note[], mode: NoteViewMode) => {
    setState((current) => ({
      ...current,
      notes,
      mode,
      loading: false,
      error: '',
      selectedNoteId: notes.some((note) => note.noteId === current.selectedNoteId)
        ? current.selectedNoteId
        : notes[0]?.noteId ?? '',
    }));
  }, []);

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const page = await listNotes();
      applyNotes(page.items, 'list');
    } catch (error) {
      setError(error);
    }
  }, [applyNotes, setError]);

  const loadDeleted = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const page = await listNotes({ includeDeleted: true });
      applyNotes(page.items.filter((note) => Boolean(note.deletedAt)), 'deleted');
    } catch (error) {
      setError(error);
    }
  }, [applyNotes, setError]);

  const updateSearchQuery = useCallback((query: string) => {
    setState((current) => ({ ...current, searchQuery: query }));
  }, []);

  const search = useCallback(async () => {
    const query = state.searchQuery.trim();
    if (!query) {
      setErrorKey('note.error.searchQueryRequired');
      return;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const page = await searchNotes(query);
      applyNotes(page.items, 'search');
    } catch (error) {
      setError(error);
    }
  }, [applyNotes, setError, setErrorKey, state.searchQuery]);

  const clearSearch = useCallback(async () => {
    setState((current) => ({
      ...current,
      searchQuery: '',
      searchResetKey: current.searchResetKey + 1,
    }));
    await load();
  }, [load]);

  const selectNote = useCallback((noteId: string) => {
    setState((current) => ({ ...current, selectedNoteId: noteId }));
  }, []);

  const startCreate = useCallback(async () => {
    try {
      const draft = await loadDraft();
      setState((current) => ({
        ...current,
        error: '',
        editor: createEditorFromDraft('create', '', current.editor.resetKey + 1, draft),
      }));
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const persistEditorDraft = useCallback((editor: NoteEditorState) => {
    const noteId = editor.mode === 'edit' ? editor.targetNoteId : undefined;
    void saveDraft({ title: editor.title, content: editor.content }, noteId).catch(setError);
  }, [setError]);

  const updateEditorTitle = useCallback((title: string) => {
    setState((current) => {
      const editor = { ...current.editor, title, draftLoaded: false };
      persistEditorDraft(editor);
      return { ...current, editor };
    });
  }, [persistEditorDraft]);

  const updateEditorContent = useCallback((content: string) => {
    setState((current) => {
      const editor = { ...current.editor, content, draftLoaded: false };
      persistEditorDraft(editor);
      return { ...current, editor };
    });
  }, [persistEditorDraft]);

  const startEditSelected = useCallback(async () => {
    if (!selectedNote) {
      setErrorKey('note.error.noSelection');
      return;
    }
    try {
      const draft = await loadDraft(selectedNote.noteId);
      setState((current) => ({
        ...current,
        error: '',
        editor: createEditorFromDraft('edit', selectedNote.noteId, current.editor.resetKey + 1, draft),
      }));
    } catch (error) {
      setError(error);
    }
  }, [selectedNote, setError, setErrorKey]);

  const clearActiveDraft = useCallback(async (editor: NoteEditorState) => {
    await clearDraft(editor.mode === 'edit' ? editor.targetNoteId : undefined);
  }, []);

  const saveEditor = useCallback(async () => {
    const title = state.editor.title.trim();
    const content = state.editor.content.trim();
    if (state.editor.mode === 'create' && title === '' && content === '') {
      setErrorKey('note.error.emptyDraft');
      return;
    }

    const targetNote = state.notes.find((note) => note.noteId === state.editor.targetNoteId);
    if (state.editor.mode === 'edit' && !targetNote) {
      setErrorKey('note.error.noSelection');
      return;
    }

    if (state.editor.mode === 'edit' && targetNote && title === '' && content === '') {
      setErrorKey('note.error.noEditorChanges');
      return;
    }

    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const note = state.editor.mode === 'edit' && targetNote
        ? await updateNote(targetNote.noteId, {
          title: title || targetNote.title,
          content: content || targetNote.content,
        })
        : await createNote(title, content);
      await clearActiveDraft(state.editor);
      setState((current) => ({
        ...current,
        notes: [note, ...current.notes.filter((item) => item.noteId !== note.noteId)],
        selectedNoteId: note.noteId,
        mode: 'list',
        loading: false,
        error: '',
        editor: createEmptyEditor(current.editor.resetKey + 1),
      }));
    } catch (error) {
      setError(error);
    }
  }, [clearActiveDraft, setError, setErrorKey, state.editor, state.notes]);

  const deleteSelected = useCallback(async () => {
    if (!state.selectedNoteId) {
      return;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      await deleteNote(state.selectedNoteId);
      const page = await listNotes();
      applyNotes(page.items, 'list');
    } catch (error) {
      setError(error);
    }
  }, [applyNotes, setError, state.selectedNoteId]);

  const restoreSelected = useCallback(async () => {
    if (!state.selectedNoteId) {
      setErrorKey('note.error.noSelection');
      return;
    }
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const note = await restoreNote(state.selectedNoteId);
      const page = state.mode === 'deleted' ? await listNotes({ includeDeleted: true }) : await listNotes();
      const notes = state.mode === 'deleted' ? page.items.filter((item) => Boolean(item.deletedAt)) : page.items;
      setState((current) => ({
        ...current,
        notes,
        selectedNoteId: note.noteId,
        mode: state.mode,
        loading: false,
        error: '',
      }));
    } catch (error) {
      setError(error);
    }
  }, [setError, setErrorKey, state.mode, state.selectedNoteId]);

  useEffect(() => {
    void load();
    void startCreate();
  }, [load, startCreate]);

  return {
    ...state,
    selectedNote,
    load,
    search,
    clearSearch,
    selectNote,
    startCreate,
    startEditSelected,
    updateEditorTitle,
    updateEditorContent,
    updateSearchQuery,
    saveEditor,
    deleteSelected,
    loadDeleted,
    restoreSelected,
  };
}
