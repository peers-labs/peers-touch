import { sdk } from '@peers-touch/applet-sdk';
import type { Note, NotePage } from '../../domain/note';

export async function requestNoteService(
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  query?: Record<string, string | number | boolean>,
) {
  return sdk.network.request({
    service: 'note',
    method,
    path,
    query,
    body,
  });
}

type NoteItemResponse = {
  item?: Note;
};

type NotePageResponse = {
  items?: Note[];
  nextPageToken?: string;
};

export async function listNotes(): Promise<NotePage> {
  const response = await requestNoteService('/v1/notes', 'GET');
  return normalizePage(response.body as NotePageResponse);
}

export async function searchNotes(query: string): Promise<NotePage> {
  const response = await requestNoteService('/v1/notes:search', 'GET', undefined, { q: query });
  return normalizePage(response.body as NotePageResponse);
}

export async function createNote(title: string, content: string): Promise<Note> {
  const response = await requestNoteService('/v1/notes', 'POST', { title, content });
  return normalizeItem(response.body as NoteItemResponse);
}

export async function deleteNote(noteId: string): Promise<void> {
  await requestNoteService(`/v1/notes/${noteId}`, 'DELETE');
}

function normalizePage(response: NotePageResponse): NotePage {
  return {
    items: Array.isArray(response.items) ? response.items : [],
    nextPageToken: response.nextPageToken ?? '',
  };
}

function normalizeItem(response: NoteItemResponse): Note {
  if (!response.item) {
    throw new Error('note.error.invalidResponse');
  }
  return response.item;
}
