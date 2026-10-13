import { useState } from 'react';
import { Typography } from 'antd';
import { Heart, ImagePlus, MessageCircle, Send, Share2 } from 'lucide-react';
import type { AvatarRenderState, Moment, MomentComment, ReactionKind } from '../types';
import { GRADIENTS, REACTION_EMOJI } from '../types';
import { demoAvatarUrls, demoMoments } from '../data';
import { IdentityAvatar } from '../components/IdentityAvatar';

const { Text } = Typography;

export function MomentsPage({ avatarState }: { avatarState: AvatarRenderState }) {
  const [moments, setMoments] = useState<Moment[]>(demoMoments);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPostText, setNewPostText] = useState('');
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});

  function toggleReaction(id: string, kind: ReactionKind) {
    setMoments((prev) => prev.map((m) => {
      if (m.id !== id) return m;
      const counts = { ...(m.reactionCounts ?? {}) };
      if (m.myReaction === kind) {
        counts[kind] = (counts[kind] ?? 1) - 1;
        if (counts[kind] <= 0) delete counts[kind];
        return { ...m, myReaction: undefined, reactionCounts: counts, likes: m.likes - 1 };
      }
      if (m.myReaction) {
        const prev = m.myReaction;
        counts[prev] = (counts[prev] ?? 1) - 1;
        if ((counts[prev] ?? 0) <= 0) delete counts[prev];
      }
      counts[kind] = (counts[kind] ?? 0) + 1;
      return { ...m, myReaction: kind, reactionCounts: counts, likes: m.likes + (m.myReaction ? 0 : 1) };
    }));
    setReactionPickerId(null);
  }

  function toggleComments(id: string) {
    setExpandedComments((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleNewPost() {
    const text = newPostText.trim();
    if (!text) return;
    const newMoment: Moment = {
      id: `mo-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      avatarGradient: GRADIENTS[0],
      time: 'Just now',
      text,
      likes: 0,
      reactionCounts: {},
      comments: [],
    };
    setMoments((prev) => [newMoment, ...prev]);
    setNewPostText('');
    setShowNewPost(false);
  }

  function handleAddComment(momentId: string) {
    const text = (commentInputs[momentId] ?? '').trim();
    if (!text) return;
    const newComment: MomentComment = {
      id: `c-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarUrl: demoAvatarUrls.alice,
      avatarGradient: GRADIENTS[0],
      text,
      time: 'Just now',
    };
    setMoments((prev) => prev.map((m) =>
      m.id === momentId ? { ...m, comments: [...m.comments, newComment] } : m,
    ));
    setCommentInputs((prev) => ({ ...prev, [momentId]: '' }));
  }

  function renderImageGrid(images: string[]) {
    const count = images.length;
    if (count === 1) {
      return <div className="mp-moment-image mp-moment-image--single" style={{ background: images[0] }} />;
    }
    if (count === 2) {
      return (
        <div className="mp-moment-grid mp-moment-grid--2">
          {images.map((img, i) => <div key={i} className="mp-moment-image" style={{ background: img }} />)}
        </div>
      );
    }
    return (
      <div className="mp-moment-grid mp-moment-grid--3">
        {images.map((img, i) => <div key={i} className="mp-moment-image" style={{ background: img }} />)}
      </div>
    );
  }

  const reactionList: ReactionKind[] = ['like', 'love', 'laugh', 'wow', 'celebrate'];

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Moments</h1>
        <button type="button" className="mp-header-action" aria-label="New post" onClick={() => setShowNewPost(!showNewPost)}>
          <ImagePlus size={20} />
        </button>
      </header>

      {showNewPost && (
        <div className="mp-new-post-card">
          <textarea
            className="mp-new-post-textarea"
            placeholder="What's on your mind?"
            value={newPostText}
            onChange={(e) => setNewPostText(e.target.value)}
            rows={3}
          />
          <div className="mp-new-post-actions">
            <button type="button" className="mp-new-post-cancel" onClick={() => { setShowNewPost(false); setNewPostText(''); }}>Cancel</button>
            <button type="button" className="mp-new-post-submit" onClick={handleNewPost} disabled={!newPostText.trim()}>Post</button>
          </div>
        </div>
      )}

      <div className="mp-moments-feed">
        {moments.map((moment) => {
          const showComments = expandedComments.has(moment.id) || moment.comments.length <= 2;
          const visibleComments = showComments ? moment.comments : moment.comments.slice(0, 2);
          const totalReactions = Object.values(moment.reactionCounts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
          return (
            <article key={moment.id} className="mp-moment-card">
              <div className="mp-moment-header">
                <IdentityAvatar name={moment.name} initials={moment.avatar}
                  src={moment.avatarUrl} size={42} renderState={avatarState} />
                <div className="mp-moment-author">
                  <Text strong className="mp-moment-name">{moment.name}</Text>
                  <Text type="secondary" className="mp-moment-time">{moment.time}</Text>
                </div>
              </div>
              <p className="mp-moment-text">{moment.text}</p>
              {moment.images && renderImageGrid(moment.images)}

              {totalReactions > 0 && (
                <div className="mp-moment-reaction-summary">
                  {reactionList.map((kind) => {
                    const count = moment.reactionCounts?.[kind] ?? 0;
                    if (count === 0) return null;
                    return (
                      <span key={kind} className={`mp-moment-reaction-tag ${moment.myReaction === kind ? 'mine' : ''}`}>
                        {REACTION_EMOJI[kind]} {count}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="mp-moment-actions">
                <div className="mp-moment-action-group">
                  <button
                    type="button"
                    className={`mp-moment-action ${moment.myReaction ? 'reacted' : ''}`}
                    aria-label="React to post"
                    onClick={() => setReactionPickerId(reactionPickerId === moment.id ? null : moment.id)}
                  >
                    <Heart size={18} fill={moment.myReaction ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" className="mp-moment-action" aria-label="Show comments" onClick={() => toggleComments(moment.id)}>
                    <MessageCircle size={18} />
                    {moment.comments.length > 0 && <span>{moment.comments.length}</span>}
                  </button>
                  <button type="button" className="mp-moment-action mp-moment-action--share" disabled
                    aria-label="Share unavailable" title="Share coming soon">
                    <Share2 size={18} />
                  </button>
                </div>

                {reactionPickerId === moment.id && (
                  <div className="mp-moment-reaction-picker">
                    {reactionList.map((kind) => (
                      <button
                        key={kind}
                        type="button"
                        className={`mp-moment-reaction-picker-btn ${moment.myReaction === kind ? 'active' : ''}`}
                        aria-label={`React with ${kind}`}
                        onClick={() => toggleReaction(moment.id, kind)}
                      >
                        {REACTION_EMOJI[kind]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {moment.comments.length > 0 && (
                <div className="mp-moment-comments">
                  {visibleComments.map((c) => (
                    <div key={c.id} className="mp-moment-comment">
                      <IdentityAvatar name={c.name} initials={c.avatar} src={c.avatarUrl}
                        size={28} renderState={avatarState} />
                      <div className="mp-moment-comment-body">
                        <Text strong className="mp-moment-comment-name">{c.name}</Text>
                        <span className="mp-moment-comment-text">{c.text}</span>
                        <Text type="secondary" className="mp-moment-comment-time">{c.time}</Text>
                      </div>
                    </div>
                  ))}
                  {!showComments && moment.comments.length > 2 && (
                    <button type="button" className="mp-moment-comment-more" onClick={() => toggleComments(moment.id)}>
                      View all {moment.comments.length} comments
                    </button>
                  )}
                </div>
              )}

              {/* Inline comment input */}
              <div className="mp-moment-comment-input-row">
                <input
                  type="text"
                  className="mp-moment-comment-input"
                  placeholder="Add a comment..."
                  value={commentInputs[moment.id] ?? ''}
                  onChange={(e) => setCommentInputs((prev) => ({ ...prev, [moment.id]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAddComment(moment.id); } }}
                />
                <button
                  type="button"
                  className={`mp-moment-comment-send ${(commentInputs[moment.id] ?? '').trim() ? 'active' : ''}`}
                  aria-label="Send comment"
                  onClick={() => handleAddComment(moment.id)}
                >
                  <Send size={14} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
