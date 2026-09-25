import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Avatar, Input, Typography } from 'antd';
import {
  ArrowLeft, Check, CheckCheck, ChevronRight, Clock,
  Copy, CornerUpLeft, EyeOff, File, Flag as FlagIcon, Forward,
  Image as ImageIcon, Laugh, ListChecks, LockKeyhole,
  MessageSquare, Mic, MoreVertical, Pencil, Phone, PhoneOff, Pin, Play, Plus,
  RotateCcw, Send, ShieldX, Square, Video, X,
} from 'lucide-react';
import type { Conversation, Message, MessageStatus, ReactionKind } from '../types';
import { REACTION_EMOJI, REACTION_EMOJI_EXTENDED, FULL_EMOJI_GRID } from '../types';
import { demoMessages } from '../data';
import { ThreadView } from '../components/ThreadView';
import { ForwardPicker } from '../components/ForwardPicker';
import { ChatHistorySearch } from '../components/ChatHistorySearch';
import { PrototypeListWindow, type PrototypeListHandle } from '../components/PrototypeListWindow';
import type { PrototypeListMemory } from '../listPresentation';
import type { SearchDemoControl } from '../searchDemo';
import copy from '../../../../../locales/en/common.json';

const { Text } = Typography;
const messageKey = (message: Message) => message.id;

export function ChatThread({ conversation, onBack, initialMessages = demoMessages, listMemory, searchDemo }: {
  conversation: Conversation;
  onBack: () => void;
  initialMessages?: Message[];
  listMemory: PrototypeListMemory;
  searchDemo?: SearchDemoControl;
}) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [inputValue, setInputValue] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [actionSheetMessage, setActionSheetMessage] = useState<Message | null>(null);
  const [isTyping] = useState(initialMessages.length > 0);
  const [threadMessage, setThreadMessage] = useState<Message | null>(null);
  const [chatTab, setChatTab] = useState<'chat' | 'pinned'>('chat');
  const [showEmojiGrid, setShowEmojiGrid] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [toastKey, setToastKey] = useState(0);
  const [showChatDetails, setShowChatDetails] = useState(false);
  const [detailsView, setDetailsView] = useState<'main' | 'search' | 'media'>('main');
  const [targetMessageId, setTargetMessageId] = useState<string | null>(null);
  const [targetUnavailable, setTargetUnavailable] = useState(false);
  const messageWindow = useRef<PrototypeListHandle>(null);
  const [isMuted, setIsMuted] = useState(conversation.muted ?? false);
  const [isStickyTop, setIsStickyTop] = useState(conversation.pinned ?? false);
  const [isBlocked, setIsBlocked] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'clear' | 'block' | 'report' | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
  const [voiceDraft, setVoiceDraft] = useState<{ durationSeconds: number } | null>(null);
  const [callState, setCallState] = useState<'idle' | 'outgoing' | 'active'>('idle');
  const [callKind, setCallKind] = useState<'audio' | 'video'>('audio');

  useEffect(() => {
    if (!voiceRecording) return undefined;
    const timer = window.setInterval(() => setVoiceSeconds((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [voiceRecording]);

  useEffect(() => {
    if (callState !== 'outgoing') return undefined;
    const timer = window.setTimeout(() => setCallState('active'), 700);
    return () => window.clearTimeout(timer);
  }, [callState]);

  useLayoutEffect(() => {
    if (!targetMessageId || showChatDetails || threadMessage || chatTab !== 'chat') return;
    setTargetUnavailable(!messageWindow.current?.reveal(targetMessageId));
    setTargetMessageId(null);
  }, [targetMessageId, showChatDetails, threadMessage, chatTab]);

  function handleSend() {
    const text = inputValue.trim();
    if (!text && !voiceDraft) return;

    if (editingMessage) {
      setMessages((prev) => prev.map((m) =>
        m.id === editingMessage.id ? { ...m, text } : m,
      ));
      setEditingMessage(null);
      setInputValue('');
      return;
    }

    const newMsg: Message = {
      id: `m-${Date.now()}`,
      mine: true,
      text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'sent',
      voice: voiceDraft ?? undefined,
      reply: replyTo ? { name: replyTo.mine ? 'You' : conversation.name, text: replyTo.text || (replyTo.image ? '[Photo]' : '[File]') } : undefined,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputValue('');
    setVoiceDraft(null);
    setReplyTo(null);
  }

  function startVoiceRecording() {
    setVoiceDraft(null);
    setVoiceSeconds(0);
    setVoiceRecording(true);
  }

  function finishVoiceRecording() {
    setVoiceRecording(false);
    setVoiceDraft({ durationSeconds: Math.max(1, voiceSeconds) });
  }

  function cancelVoiceRecording() {
    setVoiceRecording(false);
    setVoiceSeconds(0);
  }

  function startCall(kind: 'audio' | 'video') {
    setCallKind(kind);
    setCallState('outgoing');
  }

  function handleAction(action: string) {
    if (!actionSheetMessage) return;
    if (action === 'reply') {
      setReplyTo(actionSheetMessage);
    } else if (action === 'thread') {
      setThreadMessage(actionSheetMessage);
    } else if (action === 'forward') {
      setForwardMessage(actionSheetMessage);
    } else if (action === 'copy') {
      if (actionSheetMessage.text) {
        navigator.clipboard.writeText(actionSheetMessage.text);
      }
      showToast('Copied to clipboard');
    } else if (action === 'edit') {
      setEditingMessage(actionSheetMessage);
      setInputValue(actionSheetMessage.text ?? '');
    } else if (action === 'hide-for-me') {
      setMessages((prev) => prev.filter((m) => m.id !== actionSheetMessage.id));
      showToast(copy['mobile.chat.deleteForMe']);
    } else if (action === 'moderate') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id
          ? { ...m, moderated: true, text: undefined, image: undefined, file: undefined }
          : m,
      ));
      showToast(copy['mobile.chat.moderatedMessage']);
    } else if (action === 'recall') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id ? { ...m, recalled: true, text: undefined, image: undefined, file: undefined } : m,
      ));
    } else if (action === 'pin') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id ? { ...m, pinned: !m.pinned } : m,
      ));
    } else if (action === 'multiselect') {
      showToast('Select messages to forward or delete');
    } else if (action === 'flag') {
      setMessages((prev) => prev.map((m) =>
        m.id === actionSheetMessage.id ? { ...m, flagged: !m.flagged } : m,
      ));
    }
    setActionSheetMessage(null);
    setShowEmojiGrid(false);
  }

  function showToast(msg: string) {
    setToastMessage(msg);
    setToastKey((k) => k + 1);
  }

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => setToastMessage(null), 2100);
      return () => clearTimeout(timer);
    }
  }, [toastMessage, toastKey]);

  function handleReaction(msgId: string, kind: ReactionKind) {
    setMessages((prev) => prev.map((m) => {
      if (m.id !== msgId) return m;
      const existing = m.reactions ?? [];
      const found = existing.find((r) => r.kind === kind);
      if (found && found.byMe) {
        // Remove my reaction
        const updated = existing
          .map((r) => r.kind === kind ? { ...r, byMe: false, count: r.count - 1 } : r)
          .filter((r) => r.count > 0);
        return { ...m, reactions: updated };
      }
      if (found) {
        return { ...m, reactions: existing.map((r) => r.kind === kind ? { ...r, byMe: true, count: r.count + 1 } : r) };
      }
      return { ...m, reactions: [...existing, { kind, byMe: true, count: 1 }] };
    }));
    setActionSheetMessage(null);
    setShowEmojiGrid(false);
  }

  function handleEmojiReaction(msgId: string, emoji: string) {
    const emojiToKind: Record<string, ReactionKind> = { '\u{1F44D}': 'like', '\u{2764}\u{FE0F}': 'love', '\u{1F604}': 'laugh', '\u{1F62E}': 'wow', '\u{1F389}': 'celebrate' };
    const kind = emojiToKind[emoji] ?? 'like';
    handleReaction(msgId, kind);
  }

  function renderReceipt(status?: MessageStatus) {
    if (status === 'read') return <CheckCheck size={14} className="mp-receipt mp-receipt--read" />;
    if (status === 'delivered') return <CheckCheck size={14} className="mp-receipt" />;
    if (status === 'sent') return <Check size={14} className="mp-receipt" />;
    return <Clock size={13} className="mp-receipt mp-receipt--pending" />;
  }

  const pinnedMessage = messages.find((m) => m.pinned && !m.dateLabel && !m.recalled && !m.moderated);
  const pinnedMessages = messages.filter((m) => m.pinned && !m.dateLabel && !m.recalled && !m.moderated);

  return (
    <div className="mp-thread">
      {!showChatDetails && !threadMessage && (
        <>
      <header className="mp-thread-header">
        <button type="button" className="mp-thread-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={22} />
        </button>
        <div className="mp-thread-contact">
          <Avatar size={36} style={{ background: conversation.avatarGradient, borderRadius: 10 }}>
            {conversation.avatar}
          </Avatar>
          <div className="mp-thread-contact-info">
            <Text strong className="mp-thread-name">{conversation.name}</Text>
            <span className="mp-thread-e2ee">
              <LockKeyhole size={10} />
              <span>End-to-end encrypted</span>
            </span>
          </div>
        </div>
        <button type="button" className="mp-thread-action" aria-label="Audio call" onClick={() => startCall('audio')}>
          <Phone size={19} />
        </button>
        <button type="button" className="mp-thread-action" aria-label="Video call" onClick={() => startCall('video')}>
          <Video size={19} />
        </button>
        <button type="button" className="mp-thread-action" aria-label="More" onClick={() => setShowChatDetails(true)}>
          <MoreVertical size={19} />
        </button>
      </header>

      {/* Chat / Pinned tab bar */}
      <div className="mp-chat-tabs">
        <button type="button" className={`mp-chat-tab ${chatTab === 'chat' ? 'active' : ''}`} onClick={() => setChatTab('chat')}>Chat</button>
        <button type="button" className={`mp-chat-tab ${chatTab === 'pinned' ? 'active' : ''}`} onClick={() => setChatTab('pinned')}>Pinned</button>
      </div>

      {chatTab === 'pinned' && (
        <div className="mp-pinned-list">
          {pinnedMessages.length === 0 ? (
            <div className="mp-chat-tab-content">No pinned messages</div>
          ) : (
            pinnedMessages.map((pm) => (
              <div key={pm.id} className="mp-pinned-item">
                <div className="mp-pinned-item-sender">{pm.mine ? 'You' : conversation.name}</div>
                <div className="mp-pinned-item-text">{pm.text || '[Media]'}</div>
              </div>
            ))
          )}
        </div>
      )}

      {chatTab === 'chat' && (
        <>
          {pinnedMessage && (
            <div className="mp-pinned-banner">
              <Pin size={13} />
              <div className="mp-pinned-banner-content">
                <Text type="secondary" className="mp-pinned-banner-label">Pinned message</Text>
                <Text className="mp-pinned-banner-text" ellipsis>{pinnedMessage.text || '[Media]'}</Text>
              </div>
            </div>
          )}

          <div className="mp-thread-messages" data-prototype-page="messages">
            {targetUnavailable && (
              <Text type="secondary" role="status">{copy['mobile.chat.messageUnavailable']}</Text>
            )}
            {messages.length === 0 && (
              <Text type="secondary" role="status">{copy['mobile.chat.emptyThread']}</Text>
            )}
            <PrototypeListWindow items={messages} itemKey={messageKey}
              surfaceKey={`messages:${conversation.key}`} memory={listMemory} size={200} initial="end"
              controllerRef={messageWindow}>
            {(window) => window.map((msg) => {
              if (msg.dateLabel) {
                return (
                  <div key={msg.id} className="mp-date-separator" data-scroll-anchor-id={msg.id}>
                    <span className="mp-date-pill">{msg.dateLabel}</span>
                  </div>
                );
              }
              if (msg.recalled || msg.moderated) {
                return (
                  <div key={msg.id} className={`mp-message-row ${msg.mine ? 'mine' : 'peer'}`}
                    data-scroll-anchor-id={msg.id}>
                    <div className="mp-recalled-notice">
                      {msg.moderated ? <ShieldX size={12} /> : <RotateCcw size={12} />}
                      <span>
                        {msg.moderated
                          ? copy['mobile.chat.moderatedMessage']
                          : msg.mine
                            ? 'You recalled a message'
                            : `${conversation.name} recalled a message`}
                      </span>
                    </div>
                  </div>
                );
              }
              return (
                <div key={msg.id} className={`mp-message-row ${msg.mine ? 'mine' : 'peer'}`}
                  data-scroll-anchor-id={msg.id}>
                  {!msg.mine && (
                    <Avatar size={36} className="mp-message-avatar" style={{ background: conversation.avatarGradient, borderRadius: 10 }}>
                      {conversation.avatar}
                    </Avatar>
                  )}
                  <div className="mp-message-content" style={{ position: 'relative' }}>
                    {msg.flagged && (
                      <span className="mp-message-flag" title="Flagged on this device">
                        <FlagIcon size={12} fill="#f59e0b" />
                      </span>
                    )}
                    {msg.reply && (
                      <div className="mp-reply-quote">
                        <span className="mp-reply-name">{msg.reply.name}</span>
                        <span className="mp-reply-text">{msg.reply.text}</span>
                      </div>
                    )}
                    {msg.image && (
                      <div className="mp-message-image" style={{ background: msg.image }}>
                        <ImageIcon size={28} color="rgba(255,255,255,0.7)" />
                      </div>
                    )}
                    {msg.file && (
                      <div className="mp-message-file">
                        <div className="mp-file-icon"><File size={22} /></div>
                        <div className="mp-file-info">
                          <Text strong className="mp-file-name">{msg.file.name}</Text>
                          <Text type="secondary" className="mp-file-size">{msg.file.size}</Text>
                        </div>
                      </div>
                    )}
                    {msg.voice && (
                      <div className="mp-message-voice">
                        <button type="button" aria-label="Play voice message"><Play size={16} /></button>
                        <span>{formatVoiceDuration(msg.voice.durationSeconds)}</span>
                        <div className="mp-voice-progress"><span /></div>
                      </div>
                    )}
                    {msg.text && (
                      <div className="mp-bubble" onContextMenu={(e) => { e.preventDefault(); setActionSheetMessage(msg); }}>
                        {msg.pinned && <Pin size={11} className="mp-bubble-pin" />}
                        {msg.text}
                      </div>
                    )}
                    {msg.threadCount && msg.threadCount > 0 && (
                      <button type="button" className="mp-thread-badge" onClick={() => setThreadMessage(msg)}>
                        <MessageSquare size={12} />
                        <span>{copy['mobile.chat.threadReplyCount'].replace('{{count}}', String(msg.threadCount))}</span>
                      </button>
                    )}
                    {msg.reactions && msg.reactions.length > 0 && (
                      <div className="mp-reaction-row">
                        {msg.reactions.map((r) => (
                          <button
                            key={r.kind}
                            type="button"
                            className={`mp-reaction-chip ${r.byMe ? 'mine' : ''}`}
                            onClick={() => handleReaction(msg.id, r.kind)}
                          >
                            <span>{REACTION_EMOJI[r.kind]}</span>
                            <span className="mp-reaction-count">{r.count}</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="mp-reaction-add"
                          onClick={() => setActionSheetMessage(msg)}
                          aria-label="Add reaction"
                        >
                          <Laugh size={15} />
                        </button>
                      </div>
                    )}
                    <div className={`mp-message-meta ${msg.mine ? 'mine' : 'peer'}`}>
                      <span className="mp-message-time">{msg.time}</span>
                      {msg.mine && renderReceipt(msg.status)}
                    </div>
                  </div>
                </div>
              );
            })}
            </PrototypeListWindow>

            {isTyping && messages.length <= 200 && (
              <div className="mp-message-row peer">
                <Avatar size={36} className="mp-message-avatar" style={{ background: conversation.avatarGradient, borderRadius: 10 }}>
                  {conversation.avatar}
                </Avatar>
                <div className="mp-typing-bubble">
                  <span className="mp-typing-dot" /><span className="mp-typing-dot" /><span className="mp-typing-dot" />
                </div>
              </div>
            )}
          </div>

          {replyTo && (
            <div className="mp-reply-banner">
              <CornerUpLeft size={16} className="mp-reply-banner-icon" />
              <div className="mp-reply-banner-content">
                <Text strong className="mp-reply-banner-name">Replying to {replyTo.mine ? 'yourself' : conversation.name}</Text>
                <Text type="secondary" className="mp-reply-banner-text">{replyTo.text || (replyTo.image ? '[Photo]' : '[File]')}</Text>
              </div>
              <button type="button" className="mp-reply-banner-close" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X size={16} />
              </button>
            </div>
          )}

          {editingMessage && (
            <div className="mp-reply-banner">
              <Pencil size={16} className="mp-reply-banner-icon" />
              <div className="mp-reply-banner-content">
                <Text strong className="mp-reply-banner-name">Editing message</Text>
                <Text type="secondary" className="mp-reply-banner-text">{editingMessage.text}</Text>
              </div>
              <button type="button" className="mp-reply-banner-close" onClick={() => { setEditingMessage(null); setInputValue(''); }} aria-label="Cancel edit">
                <X size={16} />
              </button>
            </div>
          )}

          {(voiceRecording || voiceDraft) && (
            <div className="mp-voice-composer">
              <div className="mp-voice-composer-status">
                <span className={`mp-voice-status-dot ${voiceRecording ? 'recording' : ''}`} />
                <Text strong>
                  {voiceRecording
                    ? `Recording ${voiceSeconds}s`
                    : `Voice preview ${formatVoiceDuration(voiceDraft?.durationSeconds ?? 0)}`}
                </Text>
              </div>
              <div className="mp-voice-composer-actions">
                {voiceDraft && <button type="button" aria-label="Preview voice message"><Play size={16} /></button>}
                <button type="button" aria-label="Cancel voice message" onClick={() => { cancelVoiceRecording(); setVoiceDraft(null); }}><X size={16} /></button>
                {voiceRecording && <button type="button" aria-label="Use recording" onClick={finishVoiceRecording}><Square size={15} /></button>}
              </div>
            </div>
          )}

          <div className="mp-composer">
            <button type="button" className="mp-composer-attach" aria-label="Attach"><Plus size={22} /></button>
            <button type="button" className={`mp-composer-voice ${voiceRecording ? 'active' : ''}`} aria-label={voiceRecording ? 'Stop recording' : 'Record voice message'} onClick={voiceRecording ? finishVoiceRecording : startVoiceRecording}><Mic size={19} /></button>
            <Input.TextArea
              className="mp-composer-input"
              value={inputValue}
              placeholder="Message"
              autoSize={{ minRows: 1, maxRows: 4 }}
              disabled={voiceRecording}
              onChange={(e) => setInputValue(e.target.value)}
              onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
            />
            <button type="button" className={`mp-composer-send ${inputValue.trim() || voiceDraft ? 'active' : ''}`} onClick={handleSend} aria-label="Send">
              <Send size={18} />
            </button>
          </div>
        </>
      )}
        </>
      )}

      {callState !== 'idle' && (
        <div className="mp-call-surface" role="dialog" aria-modal="true" aria-label="Call">
          <div className="mp-call-avatar">
            {callKind === 'video' ? <Video size={30} /> : <Phone size={30} />}
          </div>
          <div className="mp-call-copy">
            <strong>{conversation.name}</strong>
            <span>{callState === 'outgoing' ? 'Calling...' : 'Connected'}</span>
          </div>
          <button type="button" className="mp-call-end" aria-label="End call" onClick={() => setCallState('idle')}>
            <PhoneOff size={22} />
          </button>
        </div>
      )}

      {/* Toast notification */}
      {toastMessage && <div key={toastKey} className="mp-toast">{toastMessage}</div>}

      {/* Feishu-style action sheet */}
      {actionSheetMessage && (
        <div className="mp-action-sheet-backdrop" onClick={() => { setActionSheetMessage(null); setShowEmojiGrid(false); }}>
          <div className="mp-action-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="mp-action-sheet-handle" />

            {/* Reaction row */}
            {!actionSheetMessage.recalled && !actionSheetMessage.moderated && (
              <div className="mp-reaction-bar-wrapper">
                <div className="mp-reaction-bar">
                  {REACTION_EMOJI_EXTENDED.map((emoji, idx) => {
                    return (
                      <button
                        key={idx}
                        type="button"
                        className="mp-reaction-bar-btn"
                        onClick={() => handleEmojiReaction(actionSheetMessage.id, emoji)}
                      >
                        {emoji}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  className="mp-reaction-more-btn"
                  onClick={() => setShowEmojiGrid(!showEmojiGrid)}
                >
                  ···
                </button>
              </div>
            )}

            {/* Full emoji grid */}
            {showEmojiGrid && (
              <div className="mp-emoji-grid">
                {FULL_EMOJI_GRID.map((emoji, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleEmojiReaction(actionSheetMessage.id, emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {/* Quick action grid: Reply, Forward, Reply in Thread, Copy */}
            <div className="mp-quick-actions-grid">
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('reply')}>
                <CornerUpLeft size={20} />
                <span>Reply</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('forward')}>
                <Forward size={20} />
                <span>Forward</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('thread')}>
                <MessageSquare size={20} />
                <span>Thread</span>
              </button>
              <button type="button" className="mp-quick-action-btn" onClick={() => handleAction('copy')}>
                <Copy size={20} />
                <span>Copy</span>
              </button>
            </div>

            {/* List action groups */}
            {actionSheetMessage.mine && !actionSheetMessage.moderated && (
              <div className="mp-action-group">
                <button type="button" className="mp-action-item" onClick={() => handleAction('recall')}>
                  <RotateCcw size={19} /><span>Recall</span>
                </button>
                <button type="button" className="mp-action-item" onClick={() => handleAction('edit')}>
                  <Pencil size={19} /><span>Edit Message</span>
                </button>
              </div>
            )}

            <div className="mp-action-group">
              <button type="button" className="mp-action-item" onClick={() => handleAction('multiselect')}>
                <ListChecks size={19} /><span>Multiselect</span>
              </button>
              <button type="button" className="mp-action-item" onClick={() => handleAction('flag')}>
                <FlagIcon size={19} />
                <span>{actionSheetMessage.flagged ? 'Unflag on this device' : 'Flag on this device'}</span>
              </button>
            </div>

            <div className="mp-action-group">
              <button type="button" className="mp-action-item" onClick={() => handleAction('pin')}>
                <Pin size={19} /><span>{actionSheetMessage.pinned ? 'Unpin' : 'Pin'}</span>
              </button>
            </div>

            <div className="mp-action-group">
              {conversation.canModerate && !actionSheetMessage.moderated && (
                <button type="button" className="mp-action-item danger" onClick={() => handleAction('moderate')}>
                  <ShieldX size={19} /><span>{copy['mobile.chat.moderate']}</span>
                </button>
              )}
              <button type="button" className="mp-action-item danger" onClick={() => handleAction('hide-for-me')}>
                <EyeOff size={19} /><span>{copy['mobile.chat.deleteForMe']}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Forward Picker Modal */}
      {forwardMessage && (
        <ForwardPicker
          onSelect={(name) => {
            showToast(`Forwarded to ${name}`);
            setForwardMessage(null);
          }}
          onClose={() => setForwardMessage(null)}
        />
      )}

      {/* Chat Details Panel */}
      {showChatDetails && (
        <div className="mp-chat-details">
          <header className="mp-chat-details-header">
            <button type="button" className="mp-thread-back" onClick={() => {
              if (detailsView !== 'main') { setDetailsView('main'); }
              else { setShowChatDetails(false); }
            }} aria-label="Back">
              <ArrowLeft size={22} />
            </button>
            <span className="mp-chat-details-title">
              {detailsView === 'main' && 'Details'}
              {detailsView === 'search' && 'Search Chat'}
              {detailsView === 'media' && 'Shared Media'}
            </span>
          </header>

          {/* Main Details View */}
          {detailsView === 'main' && (
            <div className="mp-chat-details-body">
              <div className="mp-chat-details-profile">
                <Avatar size={56} style={{ background: conversation.avatarGradient, borderRadius: 16 }}>
                  {conversation.avatar}
                </Avatar>
                <Text strong style={{ fontSize: 16, marginTop: 8 }}>{conversation.name}</Text>
                {conversation.isGroup && <Text type="secondary">{conversation.memberCount} members</Text>}
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={() => setDetailsView('search')}>
                  <span>Search Chat History</span>
                  <ChevronRight size={16} color="#9ca0ab" />
                </button>
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={() => setIsMuted(!isMuted)}>
                  <span>Mute Notifications</span>
                  <div className={`mp-toggle ${isMuted ? 'active' : ''}`}>
                    <div className="mp-toggle-thumb" />
                  </div>
                </button>
                <button type="button" className="mp-chat-details-item" onClick={() => setIsStickyTop(!isStickyTop)}>
                  <span>Sticky on Top</span>
                  <div className={`mp-toggle ${isStickyTop ? 'active' : ''}`}>
                    <div className="mp-toggle-thumb" />
                  </div>
                </button>
              </div>

              <div className="mp-chat-details-section">
              <button type="button" className="mp-chat-details-item" onClick={() => setDetailsView('media')}>
                <span>Shared Media</span>
                <ChevronRight size={16} color="#9ca0ab" />
              </button>
            </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item" onClick={() => setConfirmAction('clear')}>
                  <span>Clear Chat History</span>
                </button>
              </div>

              <div className="mp-chat-details-section">
                <button type="button" className="mp-chat-details-item danger" onClick={() => setConfirmAction('block')}>
                  <span>{isBlocked ? 'Unblock Contact' : 'Block Contact'}</span>
                </button>
                <button type="button" className="mp-chat-details-item danger" onClick={() => setConfirmAction('report')}>
                  <span>Report</span>
                </button>
              </div>
            </div>
          )}

          {/* Search Chat History Sub-view */}
          {detailsView === 'search' && (
            <ChatHistorySearch messages={messages} conversationKey={conversation.key}
              peerName={conversation.name} memory={listMemory} searchDemo={searchDemo} onSelect={(id) => {
                setTargetMessageId(id);
                setChatTab('chat');
                setDetailsView('main');
                setShowChatDetails(false);
              }} />
          )}

          {/* Shared Media Sub-view */}
          {detailsView === 'media' && (
            <div className="mp-chat-details-body">
              <div className="mp-details-media-grid">
                {messages.filter((m) => m.image && !m.recalled && !m.moderated).length > 0 ? (
                  messages.filter((m) => m.image && !m.recalled && !m.moderated).map((m) => (
                    <div key={m.id} className="mp-details-media-thumb">
                      <img src={m.image} alt="" />
                    </div>
                  ))
                ) : (
                  <div className="mp-details-empty" style={{ gridColumn: '1/-1' }}>No shared photos yet</div>
                )}
              </div>
            </div>
          )}

          {/* Confirm Dialog */}
          {confirmAction && (
            <div className="mp-confirm-backdrop" onClick={() => setConfirmAction(null)}>
              <div className="mp-confirm-dialog" onClick={(e) => e.stopPropagation()}>
                <div className="mp-confirm-title">
                  {confirmAction === 'clear' && 'Clear Chat History?'}
                  {confirmAction === 'block' && (isBlocked ? 'Unblock Contact?' : 'Block Contact?')}
                  {confirmAction === 'report' && 'Report this contact?'}
                </div>
                <div className="mp-confirm-desc">
                  {confirmAction === 'clear' && 'All messages will be permanently deleted. This cannot be undone.'}
                  {confirmAction === 'block' && (isBlocked ? `${conversation.name} will be able to message you again.` : `${conversation.name} will no longer be able to send you messages.`)}
                  {confirmAction === 'report' && 'This will be reported to our safety team for review.'}
                </div>
                <div className="mp-confirm-actions">
                  <button type="button" className="mp-confirm-btn" onClick={() => setConfirmAction(null)}>Cancel</button>
                  <button type="button" className="mp-confirm-btn mp-confirm-btn--danger" onClick={() => {
                    if (confirmAction === 'clear') {
                      setMessages([]);
                      showToast('Chat history cleared');
                    } else if (confirmAction === 'block') {
                      setIsBlocked(!isBlocked);
                      showToast(isBlocked ? 'Contact unblocked' : 'Contact blocked');
                    } else if (confirmAction === 'report') {
                      showToast('Report submitted');
                    }
                    setConfirmAction(null);
                  }}>
                    {confirmAction === 'clear' && 'Clear'}
                    {confirmAction === 'block' && (isBlocked ? 'Unblock' : 'Block')}
                    {confirmAction === 'report' && 'Report'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Thread View overlay */}
      {threadMessage && (
        <ThreadView message={threadMessage} conversation={conversation} onBack={() => setThreadMessage(null)} />
      )}
    </div>
  );
}

function formatVoiceDuration(durationSeconds: number): string {
  const rounded = Math.max(0, Math.round(durationSeconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}
