import { useCallback, useEffect, useState } from '@lynx-js/react';
import type { Note } from '../domain/note';
import { createNote, deleteNote, listNotes, searchNotes } from '../infrastructure/capability/serviceClient';
import { t } from '../infrastructure/i18n/messages';

export type NoteViewMode = 'list' | 'search';

export interface NoteControllerState {
  notes: Note[];
  selectedNoteId: string;
  mode: NoteViewMode;
  loading: boolean;
  error: string;
}

export interface NoteController extends NoteControllerState {
  selectedNote: Note | undefined;
  load: () => Promise<void>;
  createSample: () => Promise<void>;
  searchSample: () => Promise<void>;
  clearSearch: () => Promise<void>;
  selectNote: (noteId: string) => void;
  deleteSelected: () => Promise<void>;
}

export function useNoteController(): NoteController {
  const [state, setState] = useState<NoteControllerState>({
    notes: [],
    selectedNoteId: '',
    mode: 'list',
    loading: true,
    error: '',
  });

  const selectedNote = state.notes.find((note) => note.noteId === state.selectedNoteId);

  const setError = useCallback((error: unknown) => {
    setState((current) => ({
      ...current,
      loading: false,
      error: error instanceof Error ? t(error.message) : t('note.error.operationFailed'),
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

  const createSample = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const note = await createNote(t('note.sample.title'), t('note.sample.content'));
      setState((current) => ({
        ...current,
        notes: [note, ...current.notes.filter((item) => item.noteId !== note.noteId)],
        selectedNoteId: note.noteId,
        mode: 'list',
        loading: false,
        error: '',
      }));
    } catch (error) {
      setError(error);
    }
  }, [setError]);

  const searchSample = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const page = await searchNotes(t('note.sample.searchQuery'));
      applyNotes(page.items, 'search');
    } catch (error) {
      setError(error);
    }
  }, [applyNotes, setError]);

  const clearSearch = useCallback(async () => {
    await load();
  }, [load]);

  const selectNote = useCallback((noteId: string) => {
    setState((current) => ({ ...current, selectedNoteId: noteId }));
  }, []);

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

  useEffect(() => {
    void load();
  }, [load]);

  return {
    ...state,
    selectedNote,
    load,
    createSample,
    searchSample,
    clearSearch,
    selectNote,
    deleteSelected,
  };
}
