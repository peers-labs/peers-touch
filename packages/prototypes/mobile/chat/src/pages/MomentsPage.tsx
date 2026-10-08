import { useState } from 'react';
import { Avatar, Card, Typography } from 'antd';
import {
  ArrowLeft,
  Globe2,
  Heart,
  ImagePlus,
  Lock,
  MessageCircle,
  Send,
  Share2,
  X,
} from 'lucide-react';
import type { Moment, MomentComment, ReactionKind } from '../types';
import { GRADIENTS, REACTION_EMOJI } from '../types';
import { demoMoments } from '../data';

const { Text } = Typography;

export function MomentsPage() {
  const [moments, setMoments] = useState<Moment[]>(demoMoments);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const [selectedMomentId, setSelectedMomentId] = useState<string | null>(null);
  const [showNewPost, setShowNewPost] = useState(false);
  const [newPostText, setNewPostText] = useState('');
  const [audience, setAudience] = useState<'followers' | 'self' | null>(null);
  const [mediaAttached, setMediaAttached] = useState(false);
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

  function handleNewPost() {
    const text = newPostText.trim();
    if ((!text && !mediaAttached) || !audience) return;
    const newMoment: Moment = {
      id: `mo-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
      avatarGradient: GRADIENTS[0],
      time: 'Just now',
      text: text || 'Shared a new image.',
      images: mediaAttached ? [GRADIENTS[0]] : undefined,
      likes: 0,
      reactionCounts: {},
      comments: [],
    };
    setMoments((prev) => [newMoment, ...prev]);
    setNewPostText('');
    setAudience(null);
    setMediaAttached(false);
    setShowNewPost(false);
  }

  function handleAddComment(momentId: string) {
    const text = (commentInputs[momentId] ?? '').trim();
    if (!text) return;
    const newComment: MomentComment = {
      id: `c-${Date.now()}`,
      name: 'Alice Chen',
      avatar: 'AC',
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
  const selectedMoment = moments.find((moment) => moment.id === selectedMomentId);

  if (selectedMoment) {
    return (
      <div className="mp-page">
        <header className="mp-header">
          <button
            type="button"
            className="mp-header-action"
            aria-label="Back to Moments"
            onClick={() => setSelectedMomentId(null)}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="mp-header-title">Post</h1>
        </header>
        <main className="mp-moment-detail">
          <Card className="mp-moment-card mp-moment-detail-card" variant="borderless">
            <div className="mp-moment-header">
              <Avatar size={42} style={{ background: selectedMoment.avatarGradient, borderRadius: 14 }}>
                {selectedMoment.avatar}
              </Avatar>
              <div className="mp-moment-author">
                <Text strong className="mp-moment-name">{selectedMoment.name}</Text>
                <Text type="secondary" className="mp-moment-time">{selectedMoment.time}</Text>
              </div>
            </div>
            <p className="mp-moment-text">{selectedMoment.text}</p>
            {selectedMoment.images && renderImageGrid(selectedMoment.images)}
            <div className="mp-moment-comments mp-moment-detail-comments">
              <Text strong>Comments</Text>
              {selectedMoment.comments.length > 0 ? selectedMoment.comments.map((comment) => (
                <div key={comment.id} className="mp-moment-comment">
                  <Avatar size={28} style={{ background: comment.avatarGradient, borderRadius: 8 }}>
                    {comment.avatar}
                  </Avatar>
                  <div className="mp-moment-comment-body">
                    <Text strong className="mp-moment-comment-name">{comment.name}</Text>
                    <span className="mp-moment-comment-text">{comment.text}</span>
                    <Text type="secondary" className="mp-moment-comment-time">{comment.time}</Text>
                  </div>
                </div>
              )) : (
                <Text type="secondary">No comments yet. Be the first to comment.</Text>
              )}
            </div>
            <div className="mp-moment-comment-input-row">
              <input
                type="text"
                className="mp-moment-comment-input"
                placeholder="Add a comment..."
                value={commentInputs[selectedMoment.id] ?? ''}
                onChange={(event) => setCommentInputs((current) => ({
                  ...current,
                  [selectedMoment.id]: event.target.value,
                }))}
              />
              <button
                type="button"
                className={`mp-moment-comment-send ${(commentInputs[selectedMoment.id] ?? '').trim() ? 'active' : ''}`}
                onClick={() => handleAddComment(selectedMoment.id)}
                aria-label="Send comment"
              >
                <Send size={14} />
              </button>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="mp-page">
      <header className="mp-header">
        <h1 className="mp-header-title">Moments</h1>
        <button type="button" className="mp-header-action" aria-label="New post" onClick={() => setShowNewPost(!showNewPost)}>
          <ImagePlus size={20} />
        </button>
      </header>

      <div className="mp-moments-feed">
        {moments.map((moment) => {
          const visibleComments = moment.comments.slice(0, 2);
          const totalReactions = Object.values(moment.reactionCounts ?? {}).reduce((a, b) => a + (b ?? 0), 0);
          return (
            <Card key={moment.id} className="mp-moment-card" variant="borderless">
              <div className="mp-moment-header">
                <Avatar size={42} style={{ background: moment.avatarGradient, borderRadius: 14 }}>{moment.avatar}</Avatar>
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
                    onClick={() => setReactionPickerId(reactionPickerId === moment.id ? null : moment.id)}
                  >
                    <Heart size={18} fill={moment.myReaction ? 'currentColor' : 'none'} />
                  </button>
                  <button type="button" className="mp-moment-action" onClick={() => setSelectedMomentId(moment.id)}>
                    <MessageCircle size={18} />
                    {moment.comments.length > 0 && <span>{moment.comments.length}</span>}
                  </button>
                  <button type="button" className="mp-moment-action mp-moment-action--share" disabled title="Share coming soon">
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
                      <Avatar size={28} style={{ background: c.avatarGradient, borderRadius: 8 }}>{c.avatar}</Avatar>
                      <div className="mp-moment-comment-body">
                        <Text strong className="mp-moment-comment-name">{c.name}</Text>
                        <span className="mp-moment-comment-text">{c.text}</span>
                        <Text type="secondary" className="mp-moment-comment-time">{c.time}</Text>
                      </div>
                    </div>
                  ))}
                  {moment.comments.length > 2 && (
                    <button type="button" className="mp-moment-comment-more" onClick={() => setSelectedMomentId(moment.id)}>
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
                  onClick={() => handleAddComment(moment.id)}
                >
                  <Send size={14} />
                </button>
              </div>
            </Card>
          );
        })}
      </div>
      {showNewPost && (
        <div className="mp-moment-composer-backdrop">
          <section
            className="mp-new-post-card mp-moment-composer-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mp-moment-composer-title"
          >
            <header className="mp-moment-composer-header">
              <h2 id="mp-moment-composer-title">New moment</h2>
              <button
                type="button"
                className="mp-header-action"
                aria-label="Close composer"
                onClick={() => setShowNewPost(false)}
              >
                <X size={20} />
              </button>
            </header>
            <div className="mp-moment-audience">
              <Text strong>Audience</Text>
              {!audience && <Text type="secondary">Choose who can see this moment.</Text>}
              <div className="mp-moment-audience-options">
                <button
                  type="button"
                  className={audience === 'followers' ? 'active' : ''}
                  onClick={() => setAudience('followers')}
                >
                  <Globe2 size={15} /> Followers
                </button>
                <button
                  type="button"
                  className={audience === 'self' ? 'active' : ''}
                  onClick={() => setAudience('self')}
                >
                  <Lock size={15} /> Only me
                </button>
              </div>
            </div>
            <textarea
              className="mp-new-post-textarea"
              placeholder="What's on your mind?"
              value={newPostText}
              onChange={(e) => setNewPostText(e.target.value)}
              rows={4}
            />
            {mediaAttached && (
              <div className="mp-moment-composer-media">
                <ImagePlus size={28} />
                <Text strong>Image ready</Text>
                <button type="button" aria-label="Remove image" onClick={() => setMediaAttached(false)}>
                  <X size={16} />
                </button>
              </div>
            )}
            <div className="mp-new-post-actions">
              <button
                type="button"
                className="mp-new-post-cancel"
                onClick={() => setMediaAttached(true)}
              >
                <ImagePlus size={15} /> Add image
              </button>
              <button
                type="button"
                className="mp-new-post-submit"
                onClick={handleNewPost}
                disabled={(!newPostText.trim() && !mediaAttached) || !audience}
              >
                Publish
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
