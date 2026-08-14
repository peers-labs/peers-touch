/**
 * Notebook Store — Zustand state management for the Notebook / Pages feature.
 *
 * Wraps backend API calls (via desktop_api) with normalized client-side state,
 * optimistic updates, and search. Replaces ad-hoc useState management in NotesPage.
 *
 * Persistence: Backend (Rust/Station) is the source of truth. This store caches
 * the document list in memory and keeps it consistent through CRUD operations.
 */

import { createDesktopStore } from './createDesktopStore';
import { api, type NotebookDocument, type NotebookDocumentWithTopic } from '../services/desktop_api';
import { log } from '../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NotebookPage {
  id: string;
  title: string;
  content: string;
  agentId: string;
  topicId: string;
  topicTitle: string;
  createdAt: number;
  updatedAt: number;
}

export interface NotebookState {
  /** All loaded pages, keyed by id for O(1) lookup */
  pages: Map<string, NotebookPage>;
  /** Ordered list of page ids (sorted by updatedAt desc) */
  sortedIds: string[];
  /** Currently active/selected page id */
  activePageId: string | null;
  /** Search query for filtering */
  searchQuery: string;
  /** Loading state for initial list fetch */
  listLoading: boolean;
  /** Saving state for the active page */
  saving: boolean;
  /** Whether the active page has unsaved changes */
  dirty: boolean;
}

export interface NotebookActions {
  // ── Lifecycle ──
  loadPages: () => Promise<void>;

  // ── CRUD ──
  createPage: (title?: string, topicId?: string) => Promise<string | null>;
  updatePage: (id: string, title: string, content: string) => Promise<boolean>;
  deletePage: (id: string) => Promise<boolean>;
  renamePage: (id: string, newTitle: string) => Promise<boolean>;

  // ── Navigation ──
  selectPage: (id: string | null) => void;
  setActiveContent: (title: string, content: string) => void;
  markDirty: (dirty: boolean) => void;

  // ── Search ──
  setSearchQuery: (query: string) => void;
  getFilteredPages: () => NotebookPage[];

  // ── Derived ──
  getActivePage: () => NotebookPage | undefined;
  getRecentPages: (limit?: number) => NotebookPage[];
}

export type NotebookStore = NotebookState & NotebookActions;

// ── Helpers ────────────────────────────────────────────────────────────────

function toNotebookPage(doc: NotebookDocumentWithTopic): NotebookPage {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    agentId: doc.agent_id || '',
    topicId: doc.topic_id || '',
    topicTitle: doc.topic_title || '',
    createdAt: new Date(doc.created_at).getTime(),
    updatedAt: new Date(doc.updated_at).getTime(),
  };
}

function toNotebookPageFromBase(doc: NotebookDocument): NotebookPage {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    agentId: '',
    topicId: '',
    topicTitle: '',
    createdAt: new Date(doc.created_at).getTime(),
    updatedAt: new Date(doc.updated_at).getTime(),
  };
}

function buildSortedIds(pages: Map<string, NotebookPage>): string[] {
  return Array.from(pages.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => p.id);
}

// ── Store ──────────────────────────────────────────────────────────────────

export const useNotebookStore = createDesktopStore<NotebookStore>(
  'notebook',
  (set, get) => ({
    // ── Initial State ──
    pages: new Map(),
    sortedIds: [],
    activePageId: null,
    searchQuery: '',
    listLoading: false,
    saving: false,
    dirty: false,

    // ── Lifecycle ──
    loadPages: async () => {
      set({ listLoading: true });
      try {
        const docs = await api.listAllDocuments();
        const pages = new Map<string, NotebookPage>();
        for (const doc of docs) {
          pages.set(doc.id, toNotebookPage(doc));
        }
        set({ pages, sortedIds: buildSortedIds(pages), listLoading: false });
      } catch (err) {
        log.error('notebook.loadPages', 'Failed to load notebook pages', { err });
        set({ listLoading: false });
        throw err;
      }
    },

    // ── CRUD ──
    createPage: async (title?: string, topicId?: string) => {
      const effectiveTitle = title || '';
      const effectiveTopicId = topicId || '_notes';
      try {
        const doc = await api.createDocument(effectiveTopicId, effectiveTitle, '', 'note');
        const page = toNotebookPageFromBase(doc);
        page.topicId = effectiveTopicId;

        const { pages } = get();
        const nextPages = new Map(pages);
        nextPages.set(page.id, page);
        set({
          pages: nextPages,
          sortedIds: buildSortedIds(nextPages),
          activePageId: page.id,
          dirty: false,
        });
        return page.id;
      } catch (err) {
        log.error('notebook.createPage', 'Failed to create page', { err });
        return null;
      }
    },

    updatePage: async (id: string, title: string, content: string) => {
      set({ saving: true });
      try {
        await api.updateDocument(id, title, content);

        const { pages } = get();
        const existing = pages.get(id);
        if (existing) {
          const nextPages = new Map(pages);
          nextPages.set(id, {
            ...existing,
            title,
            content,
            updatedAt: Date.now(),
          });
          set({
            pages: nextPages,
            sortedIds: buildSortedIds(nextPages),
            saving: false,
            dirty: false,
          });
        } else {
          set({ saving: false, dirty: false });
        }
        return true;
      } catch (err) {
        log.error('notebook.updatePage', 'Failed to update page', { id, err });
        set({ saving: false });
        return false;
      }
    },

    deletePage: async (id: string) => {
      try {
        await api.deleteDocument(id);

        const { pages, activePageId } = get();
        const nextPages = new Map(pages);
        nextPages.delete(id);
        set({
          pages: nextPages,
          sortedIds: buildSortedIds(nextPages),
          activePageId: activePageId === id ? null : activePageId,
          dirty: activePageId === id ? false : get().dirty,
        });
        return true;
      } catch (err) {
        log.error('notebook.deletePage', 'Failed to delete page', { id, err });
        return false;
      }
    },

    renamePage: async (id: string, newTitle: string) => {
      const { pages } = get();
      const existing = pages.get(id);
      if (!existing) return false;
      return get().updatePage(id, newTitle, existing.content);
    },

    // ── Navigation ──
    selectPage: (id: string | null) => {
      set({ activePageId: id, dirty: false });
    },

    setActiveContent: (title: string, content: string) => {
      const { activePageId, pages } = get();
      if (!activePageId) return;
      const existing = pages.get(activePageId);
      if (!existing) return;

      const nextPages = new Map(pages);
      nextPages.set(activePageId, { ...existing, title, content });
      set({ pages: nextPages, dirty: true });
    },

    markDirty: (dirty: boolean) => {
      set({ dirty });
    },

    // ── Search ──
    setSearchQuery: (query: string) => {
      set({ searchQuery: query });
    },

    getFilteredPages: () => {
      const { pages, sortedIds, searchQuery } = get();
      if (!searchQuery) {
        return sortedIds.map((id) => pages.get(id)!).filter(Boolean);
      }
      const q = searchQuery.toLowerCase();
      return sortedIds
        .map((id) => pages.get(id)!)
        .filter(
          (p) =>
            p &&
            (p.title.toLowerCase().includes(q) ||
              p.content.toLowerCase().includes(q) ||
              p.topicTitle.toLowerCase().includes(q)),
        );
    },

    // ── Derived ──
    getActivePage: () => {
      const { activePageId, pages } = get();
      if (!activePageId) return undefined;
      return pages.get(activePageId);
    },

    getRecentPages: (limit = 12) => {
      const { sortedIds, pages } = get();
      return sortedIds.slice(0, limit).map((id) => pages.get(id)!).filter(Boolean);
    },
  }),
);
