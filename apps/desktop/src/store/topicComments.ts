import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { api, type StationTopicCommentRow } from '../services/desktop_api';

export interface TopicComment {
  id: string;
  topicKey: string;
  content: string;
  authorId: string;
  createdAt: number;
}

interface TopicCommentState {
  commentsByTopic: Record<string, TopicComment[]>;
  draft: string;
}

interface TopicCommentActions {
  addComment: (topicKey: string, content: string) => Promise<void>;
  deleteComment: (topicKey: string, commentId: string) => Promise<void>;
  setDraft: (content: string) => void;
  loadComments: (topicKey: string) => Promise<void>;
}

// Maps the raw Station row (Go PascalCase) into the UI TopicComment shape.
function rowToComment(row: StationTopicCommentRow): TopicComment {
  return {
    id: row.ID,
    topicKey: row.TopicKey,
    content: row.Content,
    authorId: row.AuthorID,
    createdAt: new Date(row.CreatedAt).getTime(),
  };
}

// Topic Comments store — Station-backed (X4). CRUD persists to Station via the
// ecosystem topic-comment API; comments are keyed by topicKey and refreshed from
// Station truth after each mutation. Comment editing is intentionally unsupported
// (no Station update endpoint — comments are immutable once posted).
export const useTopicCommentStore = createDesktopStore<TopicCommentState & TopicCommentActions>(
  'topicComment',
  (set, get) => ({
    commentsByTopic: {},
    draft: '',

    addComment: async (topicKey: string, content: string) => {
      if (!content.trim()) return;
      try {
        await api.createTopicCommentRemote({ topic_key: topicKey, content: content.trim() });
        set({ draft: '' });
        await get().loadComments(topicKey);
      } catch (error) {
        log.error('topicComment', 'Failed to create comment', { topicKey, error });
      }
    },

    deleteComment: async (topicKey: string, commentId: string) => {
      try {
        await api.deleteTopicCommentRemote({ topic_key: topicKey, comment_id: commentId });
        await get().loadComments(topicKey);
      } catch (error) {
        log.error('topicComment', 'Failed to delete comment', { topicKey, commentId, error });
      }
    },

    setDraft: (content: string) => {
      set({ draft: content });
    },

    loadComments: async (topicKey: string) => {
      try {
        const rows = await api.listTopicCommentsRemote(topicKey);
        set((state) => ({
          commentsByTopic: { ...state.commentsByTopic, [topicKey]: rows.map(rowToComment) },
        }));
      } catch (error) {
        log.error('topicComment', 'Failed to load comments', { topicKey, error });
      }
    },
  }),
);
