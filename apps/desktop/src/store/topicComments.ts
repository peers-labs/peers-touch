import { createDesktopStore } from './createDesktopStore';

export interface TopicComment {
  id: string;
  topicKey: string;
  content: string;
  createdAt: number;
}

interface TopicCommentState {
  commentsByTopic: Record<string, TopicComment[]>;
  draft: string;
}

interface TopicCommentActions {
  addComment: (topicKey: string, content: string) => void;
  deleteComment: (topicKey: string, commentId: string) => void;
  setDraft: (content: string) => void;
  loadComments: (topicKey: string) => void;
}

const STORAGE_KEY = 'peers-agent-topic-comments';

function persistComments(commentsByTopic: Record<string, TopicComment[]>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(commentsByTopic));
  } catch { /* storage full or unavailable */ }
}

function loadPersistedComments(): Record<string, TopicComment[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export const useTopicCommentStore = createDesktopStore<TopicCommentState & TopicCommentActions>(
  'topicComment',
  (set, get) => ({
    commentsByTopic: loadPersistedComments(),
    draft: '',

    addComment: (topicKey: string, content: string) => {
      if (!content.trim()) return;
      const comment: TopicComment = {
        id: `tc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        topicKey,
        content: content.trim(),
        createdAt: Date.now(),
      };
      const updated = {
        ...get().commentsByTopic,
        [topicKey]: [...(get().commentsByTopic[topicKey] || []), comment],
      };
      set({ commentsByTopic: updated, draft: '' });
      persistComments(updated);
    },

    deleteComment: (topicKey: string, commentId: string) => {
      const existing = get().commentsByTopic[topicKey] || [];
      const updated = {
        ...get().commentsByTopic,
        [topicKey]: existing.filter((c) => c.id !== commentId),
      };
      set({ commentsByTopic: updated });
      persistComments(updated);
    },

    setDraft: (content: string) => {
      set({ draft: content });
    },

    loadComments: () => {
      set({ commentsByTopic: loadPersistedComments() });
    },
  }),
);
