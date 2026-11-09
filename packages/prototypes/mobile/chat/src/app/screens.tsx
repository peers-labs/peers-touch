/**
 * MobileApp screens — thin, stateless views derived from AppState.
 *
 * Interaction grammar mirrors the desktop north-star surfaces ONE-FOR-ONE:
 * the messages header is the ChatRail row (compact icon segmented, an
 * in-place search morph, a plus Menu), and the moments sub-bar is the
 * MomentsFeature scope island (feed/circles, a search tile that expands in
 * place, a primary plus, the 最新/热门 chip). Search never navigates: the
 * icon expands into the same row and filters the live list locally.
 */
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import {
  Alert, Avatar, AvatarGroup, BottomSheet, Button, Dialog, Empty, Field, FilePicker, GroupAvatar,
  Icon, IconButton, ListRow, ListSection, Menu, MobileNavBar, Popover, Segmented, Select,
  Spin, Switch, Tag, TextArea, TextField,
} from '@peers-touch/ui';
import type { IconId } from '@peers-touch/ui';
import {
  REACTION_CATALOG, REACTION_BY_KIND, reactionLabel,
  QUICK_REACTION_KINDS, emojiForKind, orderedKinds,
  messageActionGroups, reportReasonKey, REPORT_REASONS,
  type MessageActionId,
  type ReactionKind,
} from '../../../../shared/chat-domain';
import { setPrefs, useT, type StringKey } from '../../../../shared/ui-system/prefs';
import {
  COMPOSER_EMOJIS, loadRecentEmojis, nextRecentEmojis, persistRecentEmojis,
} from '../../../../shared/ui-system/chat/emoji-palette';
import {
  formatVoiceDuration, useVoiceRecorder, VoicePlayer,
} from '../../../../shared/ui-system/chat/VoiceNote';
import {
  buildStationAccessInput, isPrivateConnection, normalizeStationUrl, stationIdentityKey,
} from './stationLink';
import {
  buildFixtureDecision, loadRememberedEmails,
} from './accessGate';
import { AccessGateView } from './AccessGateView';
import { nextLocalId, type Action, type CircleDraft } from './state';
import type {
  AppState, AudienceKind, ChatMessage, Circle, Conversation, Group, Moment, Person,
} from './model';
import { currentStation, ME, messagesFor, PROFILE } from './model';

type Dispatch = (a: Action) => void;

/** Person avatar: the peers-ui Avatar owns shape and presence punctuation. */
function PersonAvatar({ name, size, tone, online }: {
  name: string; size: number; tone: string; online?: boolean;
}) {
  return <Avatar name={name} size={size} background={tone} presence={online} />;
}

/** Pushed secondary-page scaffold: library nav bar over a scrolling body. */
function DetailPage({ title, onBack, action, children }: {
  title: string; onBack: () => void; action?: ReactNode; children: ReactNode;
}) {
  const { t } = useT();
  return (
    <div className="ma-page ma-detail">
      <MobileNavBar title={title} backLabel={t('common.back')} onBack={onBack} actions={action} />
      <div className="ma-detail-body">{children}</div>
    </div>
  );
}

/* Interactive list rows: the peers-ui ListRow primitive carries content; the
   local wrapper only adds the press/focus contract shared by every list. */
function PressRow({ onClick, icon, label, description, control, ariaLabel }: {
  onClick: () => void; icon?: ReactNode; label: ReactNode; description?: ReactNode;
  control?: ReactNode; ariaLabel?: string;
}) {
  return (
    <ListRow className="ma-row" role="button" tabIndex={0} aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      icon={icon} label={label} description={description} control={control} />
  );
}

/* ── Chats (messages + contacts, desktop ChatRail parity) ─────────────── */
type ChatPane = 'chats' | 'contacts';

export function ChatsScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const { t } = useT();
  // View-local scope, mirroring desktop's rail tab: the two segments live in
  // ONE messages surface; contacts never get their own bottom tab.
  const [pane, setPane] = useState<ChatPane>('chats');
  // In-place rail search — the SAME local-filter grammar as the desktop
  // ChatRail: the icon morphs into a field occupying this header row, the
  // list filters live below, and closing restores the segmented. No page.
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  // The + menu opens REAL flows (add contact / start group), never the search.
  // Sheet open state lives in AppState so the host can suppress the tab bar
  // while the sheet physically covers its strip.
  const closeSheet = () => dispatch({ type: 'chats/sheet', sheet: 'none' });
  const q = query.trim().toLowerCase();
  const closeSearch = () => { setSearchOpen(false); setQuery(''); };

  const sortedSessions = [...state.conversations].sort(
    (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false),
  );
  const visibleSessions = q
    ? sortedSessions.filter(c => [c.name, c.preview].join(' ').toLowerCase().includes(q))
    : sortedSessions;
  const visibleGroups = q
    ? state.groups.filter(g => [g.name, ...g.memberTiles.map(m => m.name)].join(' ').toLowerCase().includes(q))
    : state.groups;
  const visiblePeople = q
    ? state.people.filter(p => [p.name, p.role].join(' ').toLowerCase().includes(q))
    : state.people;

  return (
    <div className="ma-page">
      <header className="ma-rail-header" data-rail-search={searchOpen ? 'active' : 'idle'}>
        {searchOpen ? (
          <>
            <span className="ma-rail-search">
              <TextField density="compact" leading={<Icon iconId="search" size={14} />} autoFocus
                aria-label={t('rail.search')} placeholder={pane === 'contacts' ? t('mobile.search.contacts') : t('mobile.search.chats')}
                value={query} onValueChange={setQuery}
                onKeyDown={event => { if (event.key === 'Escape') closeSearch(); }} />
            </span>
            <Button actionId="ma.rail-search-close" emphasis="quiet" density="compact"
              className="ma-search-cancel" label={t('common.cancel')} onActivate={closeSearch} />
          </>
        ) : (
          <>
            <div className="ma-rail-tabs">
              <Segmented<ChatPane> className="ma-chat-subnav" aria-label={t('mobile.tabScope')}
                density="compact"
                value={pane}
                options={[
                  { value: 'chats', label: <span className="ma-subnav-label"><Icon iconId="message-circle" size={13} />{t('tab.chats')}</span> },
                  { value: 'contacts', label: <span className="ma-subnav-label"><Icon iconId="users" size={13} />{t('tab.contacts')}</span> },
                ]}
                onValueChange={value => setPane(value ?? 'chats')} />
            </div>
            <IconButton actionId="ma.rail-search" iconId="search" iconSize={17}
              className="ma-rail-icon-tile" label={t('rail.search')} emphasis="quiet"
              onActivate={() => setSearchOpen(true)} />
            <Menu placement="bottom" actions={[
              { id: 'ma.new-person', label: t('mobile.newContact'), leading: <Icon iconId="user-plus" size={14} />,
                onActivate: () => dispatch({ type: 'chats/sheet', sheet: 'add-contact' }) },
              { id: 'ma.new-group', label: t('mobile.newGroup'), leading: <Icon iconId="users" size={14} />,
                onActivate: () => dispatch({ type: 'chats/sheet', sheet: 'start-group' }) },
            ]}>
              <IconButton actionId="ma.new-menu" iconId="plus" iconSize={19}
                className="ma-rail-icon-tile" label={t('mobile.newChatMenu')} emphasis="quiet" />
            </Menu>
          </>
        )}
      </header>

      {pane === 'chats' ? (
        <ul className="ma-conv-list" data-session-count={visibleSessions.length}>
          {visibleSessions.map(c => (
            <SessionRow key={c.id} conversation={c} dispatch={dispatch} onPick={closeSearch} />
          ))}
          {visibleSessions.length === 0 && <li className="ma-list-empty"><Empty description={t('session.empty')} /></li>}
        </ul>
      ) : (
        <ContactsPane groups={visibleGroups} people={visiblePeople} dispatch={dispatch} />
      )}

      <AddContactSheet open={state.chatsSheet === 'add-contact'} state={state} dispatch={dispatch}
        onClose={closeSheet}
        onAdded={() => { closeSheet(); setPane('contacts'); }} />
      <StartGroupSheet open={state.chatsSheet === 'start-group'} state={state} dispatch={dispatch}
        onClose={closeSheet} />
    </div>
  );
}

/** Add a contact by name (local prototype; no federation round-trip). Adds to
    the people catalog; "添加并发消息" also opens the new 1:1 thread. */
function AddContactSheet({ open, state, dispatch, onClose, onAdded }: {
  open: boolean; state: AppState; dispatch: Dispatch; onClose: () => void;
  onAdded?: (personId: string) => void;
}) {
  const { t } = useT();
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const trimmed = name.trim();
  const duplicate = Boolean(trimmed) && state.people.some(p => p.name === trimmed);
  const blocked = !trimmed || duplicate
    ? duplicate ? t('mobile.contact.duplicate') : t('mobile.contact.nameRequired')
    : undefined;
  const reset = () => { setName(''); setRole(''); };

  const build = () => {
    const id = `local-person-${nextLocalId()}`;
    dispatch({ type: 'contact/add', id, name: trimmed, role: role.trim() || undefined });
    return id;
  };

  return (
    <BottomSheet open={open} title={t('mobile.newContact')} onDismiss={() => { reset(); onClose(); }}>
      <div className="ma-form-stack">
        <Field label={t('mobile.contact.nickname')}><TextField aria-label={t('mobile.contact.nicknameAria')} placeholder={t('mobile.contact.nicknamePh')} value={name}
          onValueChange={setName} onEnter={event => event.preventDefault()} /></Field>
        <Field label={t('mobile.contact.note')}><TextField aria-label={t('mobile.contact.noteAria')} placeholder={t('mobile.contact.notePh')} value={role}
          onValueChange={setRole} /></Field>
        <div className="ma-form-foot">
          <Button actionId="contact.add.cancel" emphasis="quiet" onActivate={() => { reset(); onClose(); }}>{t('common.cancel')}</Button>
          <Button actionId="contact.add.chat" label={t('mobile.addAndChat')} emphasis="secondary" density="compact"
            availability={blocked ? { kind: 'disabled', reason: blocked } : undefined}
            onActivate={() => {
              const id = build(); reset(); onClose();
              dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'person', id } } });
            }} />
          <Button actionId="contact.add.confirm" label={t('mobile.add')} emphasis="primary" density="compact"
            availability={blocked ? { kind: 'disabled', reason: blocked } : undefined}
            onActivate={() => { const id = build(); reset(); onAdded?.(id); }} />
        </div>
      </div>
    </BottomSheet>
  );
}

/** Start a group chat: name it (optional) and pick existing people; the
    reducer creates the composite-avatar group conversation and opens it. */
function StartGroupSheet({ open, state, dispatch, onClose }: {
  open: boolean; state: AppState; dispatch: Dispatch; onClose: () => void;
}) {
  const { t, locale } = useT();
  const [groupName, setGroupName] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) => setPicked(list => list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const close = () => { setGroupName(''); setPicked([]); onClose(); };
  const autoName = picked.length
    ? t('mobile.group.autoName', { names: state.people.filter(p => picked.includes(p.id)).slice(0, 2).map(p => p.name).join(locale === 'en' ? ', ' : '、') })
    : '';
  const finalName = groupName.trim() || autoName;

  return (
    <BottomSheet open={open} title={t('mobile.newGroup')} onDismiss={close}>
      <div className="ma-form-stack">
        <Field label={t('mobile.group.nameField')}><TextField aria-label={t('mobile.group.nameAria')} placeholder={autoName || t('mobile.group.namePh')}
          value={groupName} onValueChange={setGroupName} /></Field>
        <div className="ma-picker-label">{t('mobile.group.pickMembers', { n: picked.length })}</div>
        <div className="ma-person-picker">
          {state.people.map(person => {
            const chosen = picked.includes(person.id);
            return (
              <Button key={person.id} actionId={`group.pick.${person.id}`}
                emphasis={chosen ? 'secondary' : 'quiet'} density="compact"
                className={`ma-person-pick${chosen ? ' is-chosen' : ''}`} aria-pressed={chosen}
                leading={<Avatar name={person.name} background={person.tone} size={24} style={{ borderRadius: 7 }} aria-hidden="true" />}
                trailing={chosen ? <Icon iconId="check" size={13} aria-hidden="true" /> : undefined}
                onActivate={() => toggle(person.id)}>
                {person.name}
              </Button>
            );
          })}
        </div>
        <div className="ma-form-foot">
          <Button actionId="group.start.cancel" emphasis="quiet" onActivate={close}>{t('common.cancel')}</Button>
          <Button actionId="group.start.confirm" label={t('mobile.newGroup')} emphasis="primary" density="compact"
            availability={picked.length === 0
              ? { kind: 'disabled', reason: t('mobile.group.oneRequired') }
              : undefined}
            onActivate={() => {
              dispatch({ type: 'group/start', id: `local-group-${nextLocalId()}`, name: finalName, memberIds: picked });
              close();
            }} />
        </div>
      </div>
    </BottomSheet>
  );
}

function SessionRow({ conversation: c, dispatch, onPick }: {
  conversation: Conversation; dispatch: Dispatch; onPick: () => void;
}) {
  const { t } = useT();
  return (
    <li className="ma-conv-item" data-pinned={c.pinned ? 'true' : 'false'} data-muted={c.muted ? 'true' : 'false'}>
      <button type="button" className="ma-conv-row"
        onClick={() => { onPick(); dispatch({ type: 'navigate', route: { tab: 'chats', conversationId: c.id } }); }}>
        <span className="ma-conv-avatar">
          {c.kind === 'group'
            ? <GroupAvatar name={c.name} members={c.members ?? []} size={44} />
            : <PersonAvatar name={c.name} size={44} tone={c.tone} online={c.online} />}
          {c.unread > 0 && (
            <span className={`ma-unread-badge${c.muted ? ' is-muted' : ''}`} data-unread={c.unread}>
              {c.unread > 99 ? '99+' : c.unread}
            </span>
          )}
        </span>
        <span className="ma-conv-meta">
          <span className="ma-conv-name-line">
            <strong>{c.name}</strong>
            <span className="ma-conv-flags">
              {c.pinned && <Icon iconId="pin" size={11} />}
              {c.muted && <Icon iconId="bell-off" size={11} />}
            </span>
          </span>
          <span className="ma-conv-preview">
            <span className="ma-conv-last">{c.preview}</span>
            <time>{c.time}</time>
          </span>
        </span>
      </button>
      <span className="ma-conv-actions">
        <Menu placement="bottom" actions={[
          { id: 'pin', label: c.pinned ? t('session.unpin') : t('session.pin'), leading: <Icon iconId="pin" size={13} />,
            onActivate: () => dispatch({ type: 'conv/togglePin', id: c.id }) },
          { id: 'mute', label: c.muted ? t('session.unmute') : t('session.mute'), leading: <Icon iconId="bell-off" size={13} />,
            onActivate: () => dispatch({ type: 'conv/toggleMute', id: c.id }) },
        ]}>
          <IconButton actionId={`ma.session.more.${c.id}`} iconId="more-horizontal" iconSize={14}
            density="compact" emphasis="quiet" label={t('session.moreActions')} />
        </Menu>
      </span>
    </li>
  );
}

/* Contacts segment — same group/people catalog the desktop rail's contacts
   tab shows. Rows carry NO trailing chevron on desktop; neither do these. */
function ContactsPane({ groups, people, dispatch }: {
  groups: Group[]; people: Person[]; dispatch: Dispatch;
}) {
  const { t } = useT();
  return (
    <div className="ma-contacts">
      <section className="ma-group-block">
        <h3 className="ma-index">{t('mobile.groupsCount', { n: groups.length })}</h3>
        <ul className="ma-conv-list">
          {groups.map(g => (
            <li key={g.id} className="ma-contact-group">
              <button type="button" className="ma-contact-row"
                onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'group', id: g.id } } })}>
                <GroupAvatar name={g.name} members={g.memberTiles} size={42} />
                <span className="ma-conv-meta">
                  <span className="ma-conv-name-line"><strong>{g.name}</strong></span>
                  <span className="ma-conv-preview"><span className="ma-conv-last">{t('contacts.membersCount', { n: g.members })}</span></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="ma-group-block">
        <h3 className="ma-index">{t('contacts.friends', { n: people.length })}</h3>
        <ul className="ma-conv-list">
          {people.map(p => (
            <li key={p.id} className="ma-contact-friend">
              <button type="button" className="ma-contact-row"
                onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'person', id: p.id } } })}>
                <PersonAvatar name={p.name} size={42} tone={p.tone} online={p.online} />
                <span className="ma-conv-meta">
                  <span className="ma-conv-name-line"><strong>{p.name}</strong></span>
                  <span className="ma-conv-preview"><span className="ma-conv-last">{p.role}</span></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      {groups.length === 0 && people.length === 0 && <Empty description={t('mobile.noContactMatch')} />}
    </div>
  );
}

/* ── Thread ───────────────────────────────────────────────────────────── */

/**
 * Mobile composer emoji palette. Reads the SAME shared composer palette as the
 * desktop composer (recent + general-purpose emojis) — never the chat-domain
 * reaction catalog, which is only for pinning a reaction onto a message.
 * Cells use peers-ui Button so no native <button> is added to the surface.
 */
function MobileEmojiPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const { t } = useT();
  const [recent, setRecent] = useState<string[]>(loadRecentEmojis);
  const pick = (emoji: string) => {
    const next = nextRecentEmojis(recent, emoji);
    setRecent(next);
    persistRecentEmojis(next);
    onPick(emoji);
  };
  const renderCell = (emoji: string, keyPrefix: string, index: number) => (
    <Button key={`${keyPrefix}-${index}`} actionId={`composer.emoji.${keyPrefix}.${index}`}
      emphasis="quiet" density="compact" className="ma-chat-emoji-cell"
      aria-label={t('composer.emojiInsert', { emoji })} onActivate={() => pick(emoji)}>
      <span aria-hidden="true">{emoji}</span>
    </Button>
  );
  return (
    <div className="ma-chat-emoji-panel" data-emoji-panel>
      {recent.length > 0 && (
        <div className="ma-emoji-group" data-emoji-recent>
          <span className="ma-emoji-group-label">{t('composer.emojiRecent')}</span>
          <div className="ma-emoji-grid">{recent.map((e, i) => renderCell(e, 'recent', i))}</div>
        </div>
      )}
      <div className="ma-emoji-group">
        <span className="ma-emoji-group-label">{t('composer.emojiAll')}</span>
        <div className="ma-emoji-grid">{COMPOSER_EMOJIS.map((e, i) => renderCell(e, 'all', i))}</div>
      </div>
    </div>
  );
}

function ThreadComposer({ conversation, dispatch, replyTarget, editTarget, onClearTargets }: {
  conversation: Conversation;
  dispatch: Dispatch;
  replyTarget?: ChatMessage | null;
  editTarget?: ChatMessage | null;
  onClearTargets: () => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState(editTarget?.text ?? '');
  const [images, setImages] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [voiceError, setVoiceError] = useState<'denied' | 'unsupported' | null>(null);
  const [recordedVoice, setRecordedVoice] = useState<{ url: string; durationSeconds: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  const recorder = useVoiceRecorder(
    voice => { setRecordedVoice(voice); setVoiceError(null); },
    reason => setVoiceError(reason),
  );

  // Entering reply/edit from the long-press sheet prefills focus; the input is
  // an uncontrolled-to-state bridge, so sync once per target switch.
  useEffect(() => {
    setDraft(editTarget?.text ?? '');
    if (editTarget || replyTarget) requestAnimationFrame(() => textareaRef.current?.focus());
  }, [editTarget, replyTarget]);

  const canSend = draft.trim().length > 0 || images.length > 0;

  // Auto-grow mirrors the desktop composer one-for-one: the textarea tracks
  // its scrollHeight, clamped between a single-line floor and a row cap.
  // Expanding raises BOTH floor and cap so an empty composer still enlarges;
  // toggling only a max-height would leave the native rows=1 box stuck.
  const minRows = expanded ? 4 : 1;
  const maxRows = expanded ? 10 : 4;
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const lineHeight = parseFloat(cs.lineHeight) || 20;
    const blockPad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const minH = minRows * lineHeight + blockPad;
    const maxH = maxRows * lineHeight + blockPad;
    el.style.height = 'auto';
    const next = Math.min(Math.max(el.scrollHeight, minH), maxH);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxH + 1 ? 'auto' : 'hidden';
  }, [draft, expanded, minRows, maxRows]);

  const insertEmoji = (emoji: string) => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    setDraft(`${draft.slice(0, start)}${emoji}${draft.slice(end)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };

  const readFiles = async (files: readonly File[]) => {
    const room = 9 - images.length;
    const picked = await Promise.all(files.slice(0, room).map(readImageDataUrl));
    setImages(current => [...current, ...picked].slice(0, 9));
  };

  const send = () => {
    if (!canSend) return;
    if (editTarget) {
      dispatch({ type: 'message/edit', conversationId: conversation.id, messageId: editTarget.id, text: draft });
    } else {
      const who = replyTarget
        ? (replyTarget.mine ? ME.name : (replyTarget.senderName ?? conversation.name))
        : ME.name;
      dispatch({
        type: 'chat/send', conversationId: conversation.id, text: draft, images,
        replyTo: replyTarget ? { who, text: replyTarget.text } : undefined,
      });
    }
    setDraft('');
    setImages([]);
    onClearTargets();
  };

  const sendVoice = () => {
    if (!recordedVoice) return;
    dispatch({ type: 'chat/send-voice', conversationId: conversation.id, voice: recordedVoice });
    setRecordedVoice(null);
  };

  const discardVoice = () => {
    if (recordedVoice?.url.startsWith('blob:')) URL.revokeObjectURL(recordedVoice.url);
    setRecordedVoice(null);
  };

  const pickFile = () => fileInputRef.current?.click();
  const pickCamera = () => cameraInputRef.current?.click();

  const quoteSource = editTarget
    ? { who: ME.name, text: t('mobile.composer.editQuote') }
    : replyTarget
      ? { who: replyTarget.mine ? ME.name : (replyTarget.senderName ?? conversation.name), text: replyTarget.text }
      : null;

  const emojiPanel = <MobileEmojiPicker onPick={insertEmoji} />;

  const toolsDisabled = recorder.recording || !!recordedVoice || !!editTarget;

  return (
    <div className="ma-composer-zone">
      {quoteSource && (
        <div className="ma-composer-reply" data-composer-quote={editTarget ? 'edit' : 'reply'}>
          <span className="ma-composer-reply-text">
            <strong>{quoteSource.who}</strong>
            <span>{quoteSource.text}</span>
          </span>
          <IconButton actionId="ma.composer.quote-cancel" iconId="close" iconSize={14} density="compact"
            emphasis="quiet" label={t('mobile.cancelQuote')} onActivate={onClearTargets} />
        </div>
      )}
      {recorder.recording && (
        <div className="ma-voice-recording" data-voice-recording>
          <span className="ma-voice-dot" />
          <span>{t('composer.recording', { time: formatVoiceDuration(recorder.recordingSeconds) })}</span>
          <span className="ma-voice-rec-actions">
            <Button actionId="ma.voice.cancel" emphasis="quiet" density="compact"
              leading={<Icon iconId="close" size={13} />} onActivate={recorder.cancel}>
              {t('composer.recCancel')}
            </Button>
            <Button actionId="ma.voice.finish" emphasis="secondary" density="compact"
              leading={<Icon iconId="check" size={13} />} onActivate={recorder.finish}>
              {t('composer.recFinish')}
            </Button>
          </span>
        </div>
      )}
      {recordedVoice && !recorder.recording && (
        <div className="ma-voice-draft" data-voice-draft="preview">
          <VoicePlayer url={recordedVoice.url} durationSeconds={recordedVoice.durationSeconds} variant="preview" />
          <Button actionId="ma.voice.discard" emphasis="quiet" density="compact"
            aria-label={t('composer.discardVoice')} data-voice-discard onActivate={discardVoice}>
            <Icon iconId="delete" size={15} />
          </Button>
          <Button actionId="ma.voice.send" emphasis="primary" density="compact" data-voice-send onActivate={sendVoice}>
            {t('composer.sendShort')}
          </Button>
        </div>
      )}
      {voiceError && (
        <Alert className="ma-voice-error" tone="danger"
          title={t('composer.voiceErrorTitle')}
          description={voiceError === 'denied' ? t('composer.voiceDenied') : t('composer.voiceUnsupported')} />
      )}
      {images.length > 0 && (
        <div className="ma-compose-thumbs ma-chat-thumbs">
          {images.map((src, index) => (
            <span className="ma-compose-thumb" key={`${src.slice(0, 24)}-${index}`}>
              <img src={src} alt={t('mobile.imageToSend', { n: index + 1 })} />
              <IconButton actionId={`ma.chat.image.remove.${index}`} iconId="close" iconSize={12}
                density="compact" emphasis="quiet" label={t('mobile.removeImage')}
                className="ma-compose-thumb-remove" onActivate={() => setImages(list => list.filter((_, i) => i !== index))} />
            </span>
          ))}
        </div>
      )}

      {/* One framed composer, same anatomy as desktop (.sk-composer): the
          rounded host owns the border; tools/input/send all live inside. */}
      <div className="ma-composer" data-composer-mode={editTarget ? 'editing' : 'compose'}>
        <span className="ma-composer-tools">
          <Popover placement="top" content={emojiPanel}>
            <IconButton actionId="ma.chat.emoji" iconId="smile" label={t('composer.emoji')}
              emphasis="quiet" density="compact" iconSize={19}
              availability={toolsDisabled ? { kind: 'disabled', reason: t('mobile.sendReason') } : undefined} />
          </Popover>
          <Menu placement="top" actions={[
            { id: 'ma.attach.choose', label: t('mobile.chooseFile'), leading: <Icon iconId="folder-open" size={15} />,
              onActivate: pickFile },
            { id: 'ma.attach.camera', label: t('mobile.takePhoto'), leading: <Icon iconId="camera" size={15} />,
              onActivate: pickCamera },
          ]}>
            <IconButton actionId="ma.chat.attach" iconId="folder-open" label={t('mobile.fileButton')}
              emphasis="quiet" density="compact" iconSize={19}
              availability={toolsDisabled ? { kind: 'disabled', reason: t('mobile.sendReason') } : undefined} />
          </Menu>
          <IconButton actionId="ma.chat.voice" iconId="mic"
            label={recorder.recording ? t('composer.voiceStop') : t('composer.voice')}
            emphasis="quiet" density="compact" iconSize={19} aria-pressed={recorder.recording}
            availability={(!!recordedVoice || !!editTarget)
              ? { kind: 'disabled', reason: t('mobile.sendReason') } : undefined}
            onActivate={() => {
              setVoiceError(null);
              if (recorder.recording) recorder.finish();
              else void recorder.start();
            }} />
        </span>

        <span className="ma-composer-input-wrap">
          <TextArea
            ref={el => { textareaRef.current = el; }}
            framing="embedded" rows={1}
            className="ma-composer-input"
            aria-label={editTarget ? t('composer.editBanner') : t('mobile.inputAria')}
            placeholder={editTarget ? t('mobile.editPh') : t('mobile.sendPh')} value={draft}
            data-composer-value={draft}
            data-composer-expanded={expanded ? 'true' : 'false'}
            onValueChange={setDraft}
            disabled={recorder.recording || !!recordedVoice}
            onEnter={(event: KeyboardEvent<HTMLTextAreaElement>) => {
              event.preventDefault();
              send();
            }} />
        </span>

        {!editTarget && (
          <IconButton actionId="ma.chat.expand" iconId={expanded ? 'minimize-2' : 'maximize-2'}
            label={expanded ? t('composer.collapse') : t('composer.expand')}
            emphasis="quiet" density="compact" iconSize={16} aria-pressed={expanded}
            onActivate={() => setExpanded(v => !v)} />
        )}
        <IconButton actionId="ma.send" iconId="send" label={t('composer.sendShort')}
          emphasis={canSend ? 'primary' : 'quiet'} iconSize={17}
          availability={canSend ? undefined : { kind: 'disabled', reason: t('mobile.sendReason') }}
          onActivate={send} />
      </div>

      {/* Native pickers. The unrestricted input opens the OS document/photo
      chooser (which offers Files + Camera on mobile); the capture input goes
      straight to the camera. */}
      <input ref={fileInputRef} type="file" multiple hidden data-file-kind="file"
        onChange={event => { void readFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" hidden data-file-kind="camera"
        onChange={event => { void readFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
    </div>
  );
}

/** Same protocol window as the desktop surface (4m30s). */
const MUTATION_WINDOW_MS = 4 * 60_000 + 30_000;
function withinMutationWindow(message: ChatMessage, now = Date.now()): boolean {
  return !!message.mine && !!message.ts && now - message.ts <= MUTATION_WINDOW_MS;
}

/** Action glyphs stay local; labels/ownership/order all come from the shared
    catalog descriptor (action.labelKey → t()) so mobile never keeps a private
    Chinese copy of the desktop menu vocabulary. */
const ACTION_ICONS: Record<MessageActionId, IconId> = {
  reply: 'corner-up-left',
  forward: 'forward',
  thread: 'message-square',
  pin: 'pin',
  copy: 'copy',
  multiselect: 'list-checks',
  'mark-later': 'bookmark',
  edit: 'edit-note',
  recall: 'rotate-ccw',
  report: 'flag',
  moderate: 'shield-x',
  hide: 'eye-off',
};

function MessageReactionChips({ message, conversationId, dispatch }: {
  message: ChatMessage; conversationId: string; dispatch: Dispatch;
}) {
  const { locale } = useT();
  const state = message.reactions;
  const kinds = state ? orderedKinds(state) : [];
  if (!state || kinds.length === 0) return null;
  return (
    <div className="ma-msg-reactions">
      {kinds.map(kind => {
        const mine = state.viewer.includes(kind);
        return (
          <Button key={kind} actionId={`msg.reaction-chip.${message.id}.${kind}`}
            emphasis="quiet" density="compact"
            className="ma-msg-reaction" data-reaction-kind={kind} data-mine={mine ? '1' : '0'}
            aria-pressed={mine} aria-label={reactionLabel(kind, locale === 'en' ? 'en' : 'zh')}
            onActivate={() => dispatch({ type: 'message/react', conversationId, messageId: message.id, kind })}>
            <span aria-hidden="true">{emojiForKind(kind)}</span>
            <span>{state.counts[kind] ?? 0}</span>
          </Button>
        );
      })}
    </div>
  );
}

/** Long-press action sheet — the touch-form-factor twin of the desktop hover
    MessageActionBar: reaction strip, reply/forward quick row, grouped long
    tail, all derived from the shared chat-domain catalog. */
function MessageActionSheet({ message, onClose, onAction }: {
  message: ChatMessage | null;
  onClose: () => void;
  onAction: (action: string) => void;
}) {
  const { t, locale } = useT();
  const [expanded, setExpanded] = useState(false);
  const reactionLocale = locale === 'en' ? 'en' : 'zh';
  const groups = message
    ? messageActionGroups({
        mine: message.mine,
        canModerate: false,
        hasText: !!message.text.trim(),
        inMutationWindow: withinMutationWindow(message),
      })
    : [];
  const quickKinds = expanded ? REACTION_CATALOG.map(meta => meta.kind) : QUICK_REACTION_KINDS;

  return (
    <BottomSheet open={!!message} title={t('mobile.actionSheetTitle')} onDismiss={onClose}>
      {message && (
        <div className="ma-msg-sheet" data-msg-action-sheet data-mine={message.mine ? '1' : '0'}>
          <div className={`ma-react-head${expanded ? ' is-expanded' : ''}`}>
            <div className="ma-react-strip" data-message-react>
              {quickKinds.map(kind => (
                <Button key={kind} actionId={`msg.react.${kind}`} emphasis="quiet" density="compact"
                  className="ma-react-emoji" aria-label={reactionLabel(kind, reactionLocale)}
                  aria-pressed={message.reactions?.viewer.includes(kind) ?? false}
                  onActivate={() => onAction(`react:${kind}`)}>
                  <span aria-hidden="true">{emojiForKind(kind)}</span>
                </Button>
              ))}
            </div>
            {/* The expand/collapse toggle never occupies a reaction cell:
                collapsed it sits beside the horizontal quick row; expanded it
                rests under the 8-column grid so the 16 kinds align 2 × 8. */}
            <Button actionId="msg.react.expand" emphasis="quiet" density="compact"
              className="ma-react-all" aria-label={expanded ? t('mobile.reactions.collapse') : t('mobile.reactions.all')}
              onActivate={() => setExpanded(value => !value)}>
              <Icon iconId={expanded ? 'chevron-up' : 'smile'} size={16} />
            </Button>
          </div>

          <div className="ma-msg-sheet-quick">
            <Button actionId="msg.action.reply" emphasis="quiet" fullWidth
              leading={<Icon iconId="corner-up-left" size={15} />} label={t('action.reply')}
              onActivate={() => onAction('reply')} />
            <Button actionId="msg.action.forward" emphasis="quiet" fullWidth
              leading={<Icon iconId="forward" size={15} />} label={t('action.forward')}
              onActivate={() => onAction('forward')} />
          </div>

          <div className="ma-msg-sheet-menu">
            {groups.map((group, groupIndex) => (
              <div className="ma-sheet-group" data-action-group={group.group} key={group.group}>
                {groupIndex > 0 && <span className="ma-sheet-divider" aria-hidden="true" />}
                {group.actions.map(action => (
                  <Button key={action.id} actionId={`msg.action.${action.id}`}
                    emphasis="quiet" fullWidth density="comfortable"
                    className={`ma-sheet-row${action.danger ? ' is-danger' : ''}`}
                    tone={action.danger ? 'danger' : undefined}
                    leading={<Icon iconId={ACTION_ICONS[action.id]} size={16} />}
                    label={action.id === 'pin' && message.pinned ? t('session.unpin') : t(action.labelKey as StringKey)}
                    availability={action.enabled
                      ? undefined
                      : { kind: 'disabled', reason: t((action.disabledReasonKey ?? 'action.windowReason') as StringKey) }}
                    onActivate={() => onAction(action.id)} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function ForwardSheet({ open, count, conversations, excludeId, onClose, onForward }: {
  open: boolean;
  count: number;
  conversations: Conversation[];
  excludeId: string;
  onClose: () => void;
  onForward: (targetId: string) => void;
}) {
  const targets = conversations.filter(c => c.id !== excludeId);
  const { t } = useT();
  return (
    <BottomSheet open={open} title={count > 1 ? t('mobile.forward.count', { n: count }) : t('mobile.forward.title')} onDismiss={onClose}>
      <div className="ma-forward-list" data-forward-sheet>
        {targets.map(c => (
          <Button key={c.id} actionId={`msg.forward.to.${c.id}`} emphasis="quiet" fullWidth
            className="ma-forward-row"
            leading={<Icon iconId="forward" size={14} />} label={c.name}
            trailing={<Tag tone="neutral">{c.kind === 'group' ? t('mobile.kind.group') : t('kind.direct')}</Tag>}
            onActivate={() => onForward(c.id)} />
        ))}
        {targets.length === 0 && <Empty description={t('forward.empty')} />}
      </div>
    </BottomSheet>
  );
}

interface ThreadReply { id: string; mine: boolean; name: string; tone: string; text: string; }

function ThreadReplySheet({ root, replies, group, conversation, onClose, onSend }: {
  root: ChatMessage | null;
  replies: ThreadReply[];
  group: boolean;
  conversation: Conversation;
  onClose: () => void;
  onSend: (text: string) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState('');
  useEffect(() => { if (root) setDraft(''); }, [root]);
  const senderName = (m: ChatMessage) => (m.mine ? ME.name : (m.senderName ?? conversation.name));
  const senderTone = (m: ChatMessage) => (m.mine ? ME.tone : (group ? (m.senderTone ?? conversation.tone) : conversation.tone));
  return (
    <BottomSheet open={!!root} title={t('thread.aria')} onDismiss={onClose}>
      {root && (
        <div className="ma-thread-sheet" data-thread-sheet>
          <div className="ma-thread-root">
            <Avatar name={senderName(root)} size={30} background={senderTone(root)} style={{ borderRadius: group ? 8 : 10 }} />
            <div className="ma-msg-col">
              {group && <span className="ma-msg-sender">{senderName(root)}</span>}
              {root.text && <div className="ma-bubble">{root.text}</div>}
            </div>
          </div>
          <ul className="ma-thread-replies">
            {replies.map(r => (
              <li key={r.id} className={`ma-msg ${r.mine ? 'mine' : 'peer'}`}>
                <Avatar name={r.name} size={28} background={r.tone} style={{ borderRadius: group ? 8 : 10 }} />
                <div className="ma-msg-col"><div className="ma-bubble">{r.text}</div></div>
              </li>
            ))}
            {replies.length === 0 && <li className="ma-thread-empty" data-thread-empty>{t('mobile.thread.empty')}</li>}
          </ul>
          <div className="ma-thread-composer">
            <Popover placement="top" content={<MobileEmojiPicker onPick={emoji => setDraft(d => d + emoji)} />}>
              <IconButton actionId="ma.thread.emoji" iconId="smile" label={t('composer.emoji')}
                emphasis="quiet" iconSize={21} />
            </Popover>
            <TextField className="ma-thread-composer-input" aria-label={t('mobile.thread.reply')} placeholder={t('mobile.thread.replyPh')} value={draft}
              onValueChange={setDraft}
              onEnter={event => {
                event.preventDefault();
                if (draft.trim()) { onSend(draft); setDraft(''); }
              }} />
            <IconButton actionId="ma.thread.send" iconId="send" iconSize={18} label={t('composer.sendShort')}
              emphasis={draft.trim() ? 'primary' : 'quiet'}
              availability={draft.trim() ? undefined : { kind: 'disabled', reason: t('thread.sendDisabled') }}
              onActivate={() => { if (draft.trim()) { onSend(draft); setDraft(''); } }} />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function ReportSheet({ message, onClose, onSubmit }: {
  message: ChatMessage | null;
  onClose: () => void;
  onSubmit: (reasonCode: string) => void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState<string | null>(null);
  useEffect(() => { if (message) setReason(null); }, [message]);
  return (
    <BottomSheet open={!!message} title={t('report.title')} onDismiss={onClose}>
      {message && (
        <div className="ma-report-sheet" data-report-sheet>
          <p className="ma-report-body">{t('mobile.report.body')}</p>
          <div className="ma-report-reasons">
            {REPORT_REASONS.map(r => (
              <Button key={r} actionId={`msg.report.${r}`} emphasis="quiet" fullWidth
                className="ma-report-reason" aria-pressed={reason === r}
                data-selected={reason === r ? 'true' : 'false'}
                label={t(reportReasonKey(r) as StringKey)}
                leading={<Icon iconId={reason === r ? 'circle-check-big' : 'flag'} size={15} />}
                onActivate={() => setReason(r)} />
            ))}
          </div>
          <div className="ma-form-foot">
            <Button actionId="msg.report.cancel" emphasis="quiet" label={t('common.cancel')} onActivate={onClose} />
            <Button actionId="msg.report.submit" emphasis="primary" label={t('report.submit')}
              availability={reason ? undefined : { kind: 'disabled', reason: t('mobile.report.required') }}
              onActivate={() => reason && onSubmit(reason)} />
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

export function ThreadScreen({ state, dispatch, conversation }: { state: AppState; dispatch: Dispatch; conversation: Conversation }) {
  const { t } = useT();
  const messages = messagesFor(state, conversation.id);
  const group = conversation.kind === 'group';

  const [actionTarget, setActionTarget] = useState<ChatMessage | null>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [forwardTargets, setForwardTargets] = useState<ChatMessage[]>([]);
  const [reportTarget, setReportTarget] = useState<ChatMessage | null>(null);
  const [hideTargetIds, setHideTargetIds] = useState<string[] | null>(null);
  const [threadRoot, setThreadRoot] = useState<ChatMessage | null>(null);
  const [threadReplies, setThreadReplies] = useState<Record<string, ThreadReply[]>>({});
  const [selectIds, setSelectIds] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const pressFired = useRef(false);

  const flash = (text: string) => {
    setToast(text);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };
  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const cancelPress = () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    pressTimer.current = null;
    pressOrigin.current = null;
  };
  const startPress = (event: React.PointerEvent<HTMLDivElement>, message: ChatMessage) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    pressFired.current = false;
    pressOrigin.current = { x: event.clientX, y: event.clientY };
    pressTimer.current = window.setTimeout(() => {
      pressFired.current = true;
      if (navigator.vibrate) navigator.vibrate(8);
      setActionTarget(message);
    }, 420);
  };
  const movePress = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pressOrigin.current || pressTimer.current === null) return;
    if (Math.hypot(event.clientX - pressOrigin.current.x, event.clientY - pressOrigin.current.y) > 10) cancelPress();
  };
  const longPressProps = (message: ChatMessage) => ({
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => startPress(event, message),
    onPointerMove: movePress,
    onPointerUp: cancelPress,
    onPointerLeave: cancelPress,
    onPointerCancel: cancelPress,
    onClickCapture: (event: React.MouseEvent<HTMLDivElement>) => {
      if (pressFired.current) { event.preventDefault(); event.stopPropagation(); pressFired.current = false; }
    },
  });

  const handleSheetAction = (action: string) => {
    const target = actionTarget;
    if (!target) return;
    if (action.startsWith('react:')) {
      dispatch({
        type: 'message/react', conversationId: conversation.id, messageId: target.id,
        kind: action.slice('react:'.length) as ReactionKind,
      });
      setActionTarget(null);
      return;
    }
    const id = action as MessageActionId;
    switch (id) {
      case 'reply': setActionTarget(null); setEditTarget(null); setReplyTarget(target); break;
      case 'forward': setActionTarget(null); setForwardTargets([target]); break;
      case 'thread': setActionTarget(null); setThreadRoot(target); break;
      case 'pin':
        dispatch({ type: 'message/pin', conversationId: conversation.id, messageId: target.id });
        flash(target.pinned ? t('msg.unpinned') : t('msg.pinDone'));
        setActionTarget(null);
        break;
      case 'copy':
        void navigator.clipboard?.writeText(target.text);
        flash(t('action.copiedFlash'));
        setActionTarget(null);
        break;
      case 'multiselect': setActionTarget(null); setSelectIds([target.id]); break;
      case 'mark-later':
        dispatch({ type: 'message/markLater', conversationId: conversation.id, messageId: target.id });
        flash(target.markedForLater ? t('action.markLaterRemoved') : t('action.markLaterDone'));
        setActionTarget(null);
        break;
      case 'edit': setActionTarget(null); setReplyTarget(null); setEditTarget(target); break;
      case 'recall':
        dispatch({ type: 'message/recall', conversationId: conversation.id, messageId: target.id });
        setActionTarget(null);
        break;
      case 'report': setActionTarget(null); setReportTarget(target); break;
      case 'hide': setActionTarget(null); setHideTargetIds([target.id]); break;
      default: setActionTarget(null);
    }
  };

  const selectMode = selectIds.length > 0;
  const selectedSet = new Set(selectIds);
  const toggleSelect = (id: string) => setSelectIds(list =>
    list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
  const pinnedMessage = [...messages].reverse().find(m => m.pinned);
  const clearTargets = () => { setReplyTarget(null); setEditTarget(null); };

  return (
    <div className="ma-page ma-thread">
      <MobileNavBar title={conversation.name} backLabel={t('common.back')} onBack={() => dispatch({ type: 'back' })}
        actions={selectMode ? undefined : <>
          <IconButton actionId="ma.call.audio" iconId="phone" label={t('conv.callAudio')} emphasis="quiet" iconSize={19}
            onActivate={() => dispatch({ type: 'call/start', conversationId: conversation.id, media: 'audio' })} />
          <IconButton actionId="ma.call.video" iconId="video" label={t('conv.callVideo')} emphasis="quiet" iconSize={20}
            onActivate={() => dispatch({ type: 'call/start', conversationId: conversation.id, media: 'video' })} />
        </>} />

      {selectMode && (
        <div className="ma-bulk-bar" data-bulk-bar>
          <Button actionId="ma.bulk.exit" emphasis="quiet" label={t('mobile.bulk.exit')} onActivate={() => setSelectIds([])} />
          <span className="ma-bulk-count" data-bulk-count>{t('mobile.bulk.count', { n: selectIds.length })}</span>
          <span className="ma-bulk-spacer" />
          <Button actionId="ma.bulk.forward" emphasis="quiet" leading={<Icon iconId="forward" size={15} />}
            label={t('select.forward')}
            onActivate={() => setForwardTargets(messages.filter(m => selectedSet.has(m.id)))} />
          <Button actionId="ma.bulk.hide" emphasis="primary" tone="danger" leading={<Icon iconId="eye-off" size={15} />}
            label={t('select.hide')}
            onActivate={() => setHideTargetIds(selectIds)} />
        </div>
      )}

      {pinnedMessage && !selectMode && (
        <div className="ma-pin-banner" data-pin-banner>
          <Icon iconId="pin" size={13} />
          <span className="ma-pin-banner-text">
            <strong>{pinnedMessage.mine ? ME.name : (pinnedMessage.senderName ?? conversation.name)}</strong>
            <span>{pinnedMessage.text || t('preview.image')}</span>
          </span>
          <IconButton actionId="ma.pin.unpin" iconId="close" iconSize={13} density="compact" emphasis="quiet"
            label={t('session.unpin')}
            onActivate={() => dispatch({ type: 'message/pin', conversationId: conversation.id, messageId: pinnedMessage.id })} />
        </div>
      )}

      <div className="ma-messages">
        {messages.map(m => (m.service || m.recalled) ? (
          <div key={m.id} className="ma-msg-service" data-message-id={m.id}>
            {m.recalled ? (m.mine ? t('msg.recalledMe') : t('msg.recalledPeer')) : m.text}
          </div>
        ) : (
          <div key={m.id}
            className={`ma-msg ${m.mine ? 'mine' : 'peer'}${selectMode ? ' is-selectable' : ''}${selectedSet.has(m.id) ? ' is-selected' : ''}`}
            data-message-id={m.id}>
            <span className="ma-msg-avatar-slot" onClick={selectMode ? () => toggleSelect(m.id) : undefined}>
              {selectMode && (
                <span className={`ma-select-dot${selectedSet.has(m.id) ? ' is-on' : ''}`} data-select-dot
                  aria-hidden={!selectedSet.has(m.id)}>
                  {selectedSet.has(m.id) && <Icon iconId="check" size={12} />}
                </span>
              )}
              <Avatar
                name={m.mine ? ME.name : (m.senderName ?? conversation.name)}
                size={32}
                background={m.mine ? ME.tone : (group ? (m.senderTone ?? conversation.tone) : conversation.tone)}
                style={{ borderRadius: group ? 8 : 11 }} />
            </span>
            <div className="ma-msg-col" data-long-press-target
              {...(selectMode ? { onClick: () => toggleSelect(m.id) } : longPressProps(m))}>
              {group && !m.mine && <span className="ma-msg-sender">{m.senderName}</span>}
              {m.text && (
                <div className="ma-bubble" data-copied="false">
                  {m.replyTo && (
                    <span className="ma-msg-quote" data-msg-quote>
                      <strong>{m.replyTo.who}</strong>
                      <span>{m.replyTo.text}</span>
                    </span>
                  )}
                  {m.text}
                  {m.edited && <em className="ma-msg-edited" data-msg-edited>{t('msg.edited')}</em>}
                </div>
              )}
              {m.images && m.images.length > 0 && (
                <div className={`ma-chat-images ${m.images.length === 1 ? 'is-single' : ''} ma-grid-${Math.min(m.images.length, 9)}`}>
                  {m.images.map((src, i) => (
                    <span key={i} className="ma-chat-img"><img src={src} alt={t('mobile.chatImage', { n: i + 1 })} /></span>
                  ))}
                </div>
              )}
              {m.voice && (
                <div className="ma-bubble ma-voice-bubble" data-voice-bubble>
                  <VoicePlayer url={m.voice.url} durationSeconds={m.voice.durationSeconds} variant="bubble" />
                </div>
              )}
              <div className="ma-msg-flags">
                {m.markedForLater && (
                  <span className="ma-msg-flag" data-msg-marked><Icon iconId="bookmark" size={10} /> {t('action.markLater')}</span>
                )}
                {m.pinned && <span className="ma-msg-flag" data-msg-pinned-chip><Icon iconId="pin" size={10} /> {t('mobile.pinnedFlag')}</span>}
              </div>
              <MessageReactionChips message={m} conversationId={conversation.id} dispatch={dispatch} />
            </div>
          </div>
        ))}
        {!selectMode && (
          <div className="ma-msg peer">
            <Avatar name={conversation.name} size={32} background={conversation.tone} style={{ borderRadius: group ? 8 : 11 }} />
            <div className="ma-msg-col"><div className="ma-bubble ma-typing"><i /><i /><i /></div></div>
          </div>
        )}
      </div>

      {!selectMode && (
        <ThreadComposer conversation={conversation} dispatch={dispatch}
          replyTarget={replyTarget} editTarget={editTarget} onClearTargets={clearTargets} />
      )}

      <MessageActionSheet message={actionTarget} onClose={() => setActionTarget(null)} onAction={handleSheetAction} />
      <ForwardSheet open={forwardTargets.length > 0} count={forwardTargets.length}
        conversations={state.conversations} excludeId={conversation.id}
        onClose={() => setForwardTargets([])}
        onForward={targetId => {
          dispatch({
            type: 'message/forward',
            messages: forwardTargets.map(m => ({ text: m.text || t('preview.image') })),
            toConversationId: targetId,
          });
          const name = state.conversations.find(c => c.id === targetId)?.name ?? '';
          setForwardTargets([]);
          setSelectIds([]);
          flash(t('msg.forwarded', { name }));
        }} />
      <ThreadReplySheet root={threadRoot} group={group} conversation={conversation}
        replies={threadRoot ? (threadReplies[threadRoot.id] ?? []) : []}
        onClose={() => setThreadRoot(null)}
        onSend={text => {
          if (!threadRoot) return;
          const reply: ThreadReply = { id: `tr-local-${nextLocalId()}`, mine: true, name: ME.name, tone: ME.tone, text };
          setThreadReplies(map => ({ ...map, [threadRoot.id]: [...(map[threadRoot.id] ?? []), reply] }));
        }} />
      <ReportSheet message={reportTarget}
        onClose={() => setReportTarget(null)}
        onSubmit={() => { setReportTarget(null); flash(t('report.done')); }} />
      <Dialog open={!!hideTargetIds} onDismiss={() => setHideTargetIds(null)}
        title={hideTargetIds && hideTargetIds.length > 1 ? t('mobile.hide.title.bulk', { n: hideTargetIds.length }) : t('mobile.hide.title.one')}
        description={t('mobile.hide.body')}
        footer={<>
          <Button actionId="msg.hide-cancel" emphasis="quiet" label={t('common.cancel')} onActivate={() => setHideTargetIds(null)} />
          <Button actionId="msg.hide-confirm" emphasis="primary" tone="danger" label={t('action.hideForMe')}
            onActivate={() => {
              if (hideTargetIds) dispatch({ type: 'message/hide', conversationId: conversation.id, messageIds: hideTargetIds });
              setHideTargetIds(null);
              setSelectIds([]);
            }} />
        </>} />

      {toast && <div className="ma-toast" data-toast role="status">{toast}</div>}
    </div>
  );
}


/* ── Moments (desktop MomentsFeature parity) ──────────────────────────── */
type MomentsTab = 'feed' | 'circles';
type FeedSort = 'recent' | 'hot';

const TAB_OPTIONS: { value: MomentsTab; label: string }[] = [
  { value: 'feed', label: '动态' },
  { value: 'circles', label: '圈友' },
];
const TAB_SEARCH_PLACEHOLDER = '搜索动态与圈友';

const AUDIENCE_OPTIONS: { value: AudienceKind; label: string }[] = [
  { value: 'public', label: '公开 · 联邦可见' },
  { value: 'followers', label: '关注者' },
  { value: 'friends', label: '朋友（互相关注）' },
  { value: 'circle', label: '圈子（我的受众分组）' },
  { value: 'group', label: '群聊成员' },
  { value: 'allow', label: '部分可见（白名单）' },
  { value: 'deny', label: '不给谁看（黑名单）' },
  { value: 'self', label: '仅自己' },
];

const AUDIENCE_LABEL: Record<AudienceKind, string> = {
  public: '公开',
  followers: '关注者',
  friends: '朋友',
  circle: '圈子',
  group: '群聊',
  allow: '部分可见',
  deny: '不给谁看',
  self: '仅自己',
};
const REASON_LABEL: Record<'self' | 'following' | 'mutual' | 'circle' | 'public', string> = {
  self: '自己',
  following: '关注的人',
  mutual: '互相关注',
  circle: '同圈',
  public: '联邦公开',
};

function audienceIcon(audience: AudienceKind): IconId {
  if (audience === 'followers') return 'user-check';
  if (audience === 'friends') return 'users';
  if (audience === 'circle') return 'users-round';
  if (audience === 'group') return 'messages-square';
  if (audience === 'allow' || audience === 'deny') return 'users';
  if (audience === 'self') return 'lock';
  return 'globe';
}

/** Floating 最新/热门 chip — same role as desktop FeedSortFloat: at the top
    it is the order segmented; scrolled down the same anchored tile becomes a
    compact back-to-top control. */
function FeedSortFloat({ value, onChange, scrollRef }: {
  value: FeedSort; onChange: (v: FeedSort) => void; scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const sync = () => { frame = 0; setAtTop(scroller.scrollTop <= 4); };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(sync); };
    sync();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => { cancelAnimationFrame(frame); scroller.removeEventListener('scroll', onScroll); }; },
    [scrollRef]);
  return (
    <div className="ma-feed-sort-float" data-feed-mode={atTop ? 'sort' : 'top'}>
      {atTop ? (
        <Segmented<FeedSort> className="ma-feed-sort-pill" label="动态排序" density="compact"
          value={value}
          options={[{ value: 'recent', label: '最新' }, { value: 'hot', label: '热门' }]}
          onValueChange={next => onChange(next ?? 'recent')} />
      ) : (
        <Button actionId="feed.back-to-top" emphasis="quiet" density="compact" className="ma-feed-top"
          aria-label="回到最顶"
          onActivate={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
          <Icon iconId="arrow-up" size={16} />
        </Button>
      )}
    </div>
  );
}

export function MomentsScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const { t } = useT();
  const [tab, setTab] = useState<MomentsTab>('feed');
  const [query, setQuery] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [sort, setSort] = useState<FeedSort>('recent');
  const [circleCreateOpen, setCircleCreateOpen] = useState(false);
  const [circleManageId, setCircleManageId] = useState<string | null>(null);
  const [circleDeleteTarget, setCircleDeleteTarget] = useState<Circle | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const switchTab = (next: MomentsTab) => { setTab(next); setQuery(''); };
  const closeSearch = () => { setSearchActive(false); setQuery(''); };
  const q = query.trim().toLowerCase();

  const reactionTotal = (post: Moment) =>
    Object.values(post.reactions).reduce((sum, count) => sum + (count ?? 0), 0);
  const searchedTimeline = q
    ? state.moments.filter(m =>
      [m.author, m.text, m.station ?? ''].join(' ').toLowerCase().includes(q))
    : state.moments;
  const timeline = sort === 'hot'
    ? [...searchedTimeline].sort((a, b) => reactionTotal(b) - reactionTotal(a))
    : searchedTimeline;
  const searchedCircles = q
    ? state.circles.filter(c =>
      [c.name, c.desc, ...c.members.map(m => m.name)].join(' ').toLowerCase().includes(q))
    : state.circles;

  return (
    <div className="ma-page ma-moments-page">
      <div className="ma-moments-subbar" data-subbar-search={searchActive ? 'active' : 'idle'}>
        {searchActive ? (
          <>
            <span className="ma-subbar-search">
              <TextField className="ma-subbar-search-field" density="compact" autoFocus
                aria-label={TAB_SEARCH_PLACEHOLDER} placeholder={TAB_SEARCH_PLACEHOLDER}
                value={query} onValueChange={setQuery}
                leading={<Icon iconId="search" size={15} />}
                onKeyDown={event => { if (event.key === 'Escape') closeSearch(); }} />
            </span>
            <Button actionId="ma.subbar-search-close" emphasis="quiet" density="compact"
              className="ma-search-cancel" label={t('common.cancel')} onActivate={closeSearch} />
          </>
        ) : (
          <>
            <Segmented<MomentsTab> label="动态范围" density="compact" className="ma-scope-island"
              options={TAB_OPTIONS} value={tab}
              onValueChange={value => switchTab(value ?? 'feed')} />
            <IconButton actionId="ma.subbar-search" iconId="search" iconSize={17}
              className="ma-rail-icon-tile" label={t('rail.search')} emphasis="quiet"
              onActivate={() => setSearchActive(true)} />
            <IconButton actionId={tab === 'feed' ? 'moments.compose' : 'circle.open-create'}
              iconId="plus" iconSize={19} label={tab === 'feed' ? '发动态' : '新建圈子'}
              emphasis="quiet" className="ma-subbar-add"
              onActivate={() => (tab === 'feed'
                ? dispatch({ type: 'composer/open' })
                : setCircleCreateOpen(true))} />
          </>
        )}
      </div>

      {tab === 'feed' ? (
        <div className="ma-moments-scroll" ref={scrollRef}>
          {!q && <FeedSortFloat value={sort} onChange={setSort} scrollRef={scrollRef} />}
          {timeline.map(m => <MomentCard key={m.id} moment={m} state={state} dispatch={dispatch} />)}
          {timeline.length === 0 && <Empty description={`没有匹配「${query.trim()}」的动态`} />}
        </div>
      ) : (
        <div className="ma-moments-scroll">
          {searchedCircles.length === 0 ? (
            <Empty description={q ? `没有匹配「${query.trim()}」的圈子` : '还没有受众分组，点右上角「新建圈子」创建'} />
          ) : (
            <ul className="ma-circle-list">
              {searchedCircles.map(circle => (
                <li key={circle.id}>
                  <Button actionId={`circle.manage.${circle.id}`} emphasis="quiet" fullWidth
                    className="ma-circle-card" onActivate={() => setCircleManageId(circle.id)}>
                    <span className="ma-circle-id">
                      <strong>{circle.name}</strong>
                      {circle.desc && <span className="ma-circle-desc">{circle.desc}</span>}
                      <span className="ma-circle-time">{circle.members.length} 位成员</span>
                    </span>
                    <span className="ma-circle-tail">
                      <AvatarGroup className="ma-circle-avatars" aria-label={`${circle.name} 成员`}>
                        {circle.members.slice(0, 5).map(member => (
                          <Avatar key={member.id} name={member.name} background={member.tone}
                            size={28} style={{ borderRadius: 8 }} />
                        ))}
                      </AvatarGroup>
                      <Icon iconId="chevron-right" size={15} />
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ComposerSheet state={state} dispatch={dispatch} />

      <CircleCreateDialog open={circleCreateOpen} onDismiss={() => setCircleCreateOpen(false)}
        onCreate={name => { dispatch({ type: 'circle/create', name }); setCircleCreateOpen(false); }} />
      {circleManageId && state.circles.find(c => c.id === circleManageId) && (
        <CircleManageDialog key={circleManageId}
          circle={state.circles.find(c => c.id === circleManageId)!}
          state={state} dispatch={dispatch} onClose={() => setCircleManageId(null)}
          onRequestDelete={circle => { setCircleManageId(null); setCircleDeleteTarget(circle); }} />
      )}
      <Dialog open={circleDeleteTarget !== null} onDismiss={() => setCircleDeleteTarget(null)}
        title={`删除分组「${circleDeleteTarget?.name ?? ''}」？`}
        description="仅删除本地原型中的受众分组，不影响已发布动态的可见范围。"
        footer={<>
          <Button actionId="circle.delete-cancel" emphasis="quiet" label="取消" onActivate={() => setCircleDeleteTarget(null)} />
          <Button actionId="circle.delete-ok" emphasis="primary" tone="danger" label="删除"
            onActivate={() => {
              if (circleDeleteTarget) dispatch({ type: 'circle/delete', id: circleDeleteTarget.id });
              setCircleDeleteTarget(null);
            }} />
        </>} />
    </div>
  );
}

function CircleCreateDialog({ open, onDismiss, onCreate }: {
  open: boolean; onDismiss: () => void; onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();
  return (
    <Dialog open={open} onDismiss={() => { setName(''); onDismiss(); }} title="新建圈子"
      description="圈子是你的发布受众分组，成员不会收到通知（本地示例）"
      footer={<>
        <Button actionId="circle.cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />
        <Button actionId="circle.create" emphasis="primary" label="创建"
          availability={trimmed ? undefined : { kind: 'disabled', reason: '请输入圈子名称' }}
          onActivate={() => { onCreate(trimmed); setName(''); }} />
      </>}>
      <TextField aria-label="圈子名称" placeholder="例如：夜跑小队" value={name}
        onValueChange={setName} onEnter={event => { event.preventDefault(); if (trimmed) { onCreate(trimmed); setName(''); } }} />
    </Dialog>
  );
}

function CircleManageDialog({ circle, state, dispatch, onClose, onRequestDelete }: {
  circle: AppState['circles'][number]; state: AppState; dispatch: Dispatch; onClose: () => void;
  onRequestDelete: (circle: AppState['circles'][number]) => void;
}) {
  const [draft, setDraft] = useState<CircleDraft>({
    name: circle.name,
    desc: circle.desc,
    memberIds: circle.members.map(m => m.id),
  });
  const memberName = (id: string) =>
    circle.members.find(m => m.id === id)?.name ?? state.momentPeople.find(p => p.id === id)?.name ?? id;
  const memberTone = (id: string) =>
    circle.members.find(m => m.id === id)?.tone ?? state.momentPeople.find(p => p.id === id)?.tone ?? ME.tone;
  const candidates = state.momentPeople.filter(p => !draft.memberIds.includes(p.id));

  return (
    <Dialog open onDismiss={onClose} title="管理圈子"
      description="圈子是你的发布受众分组，成员不会收到通知（本地示例）"
      footer={
        <div className="ma-circle-manage-footer">
          <Button actionId="circle.delete" emphasis="quiet" tone="danger" label="删除分组"
            onActivate={() => onRequestDelete(circle)} />
          <span className="ma-circle-footer-spacer" />
          <Button actionId="circle.save-cancel" emphasis="quiet" label="取消" onActivate={onClose} />
          <Button actionId="circle.save" emphasis="primary" label="保存"
            availability={draft.name.trim() ? undefined : { kind: 'disabled', reason: '请输入圈子名称' }}
            onActivate={() => {
              dispatch({ type: 'circle/save', id: circle.id, draft: { ...draft, name: draft.name.trim() } });
              onClose();
            }} />
        </div>
      }>
      <div className="ma-circle-manage">
        <TextField aria-label="圈子名称" placeholder="圈子名称" value={draft.name}
          onValueChange={name => setDraft(d => ({ ...d, name }))} />
        <TextField aria-label="圈子描述" placeholder="描述（可选）" value={draft.desc}
          onValueChange={desc => setDraft(d => ({ ...d, desc }))} />
        <div className="ma-circle-manage-members">
          <span className="ma-circle-manage-label">成员 · {draft.memberIds.length}</span>
          <ul className="ma-circle-member-list">
            {draft.memberIds.map(id => (
              <li key={id} className="ma-circle-member-row">
                <Avatar name={memberName(id)} background={memberTone(id)} size={30}
                  style={{ borderRadius: 8 }} aria-hidden="true" />
                <strong className="ma-circle-member-name">{memberName(id)}</strong>
                {id === 'viewer'
                  ? <span className="ma-circle-member-self">我</span>
                  : (
                    <IconButton actionId={`circle.member.remove.${id}`} iconId="user-minus" iconSize={14}
                      density="compact" emphasis="quiet" tone="danger" label={`移除 ${memberName(id)}`}
                      onActivate={() => setDraft(d => ({ ...d, memberIds: d.memberIds.filter(m => m !== id) }))} />
                  )}
              </li>
            ))}
          </ul>
        </div>
        <div className="ma-circle-candidates">
          <span className="ma-circle-manage-label">添加已知人</span>
          {candidates.length === 0
            ? <span className="ma-circle-candidates-empty">已知人都已在分组里</span>
            : (
              <ul className="ma-circle-member-list">
                {candidates.map(person => (
                  <li key={person.id} className="ma-circle-member-row">
                    <Avatar name={person.name} background={person.tone} size={30}
                      style={{ borderRadius: 8 }} aria-hidden="true" />
                    <span className="ma-circle-member-meta">
                      <strong className="ma-circle-member-name">{person.name}</strong>
                      <span className="ma-circle-time">{person.station} · {person.bio}</span>
                    </span>
                    <IconButton actionId={`circle.member.add.${person.id}`} iconId="user-plus" iconSize={14}
                      density="compact" emphasis="quiet" label={`添加 ${person.name}`}
                      onActivate={() => setDraft(d => ({ ...d, memberIds: [...d.memberIds, person.id] }))} />
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>
    </Dialog>
  );
}

const MAX_COMPOSE_IMAGES = 9;

/** Read a picked image as a data URL — local, network-free attach, same as
    the desktop composer (no Station/OSS round-trip in the prototype). */
function readImageDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function ComposerSheet({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const images = state.composerImages;
  const audience = state.composerAudience;
  const circle = state.circles.find(c => c.id === state.composerCircleId) ?? state.circles[0];
  const group = state.audienceGroups.find(g => g.id === state.composerGroupId) ?? state.audienceGroups[0];
  const circleMissing = audience === 'circle' && state.circles.length === 0;
  const groupMissing = audience === 'group' && state.audienceGroups.length === 0;
  const actorsMissing = (audience === 'allow' || audience === 'deny') && state.composerActorIds.length === 0;
  const disabledReason = !state.composerDraft.trim()
    ? '请输入动态内容'
    : circleMissing
      ? '还没有圈子，先去圈友新建分组'
      : groupMissing
        ? '还没有可发布的群聊'
        : actorsMissing
          ? audience === 'allow' ? '白名单至少选择一位' : '黑名单至少选择一位'
          : undefined;

  return (
    <BottomSheet open={state.composerOpen} title="发动态" onDismiss={() => dispatch({ type: 'composer/close' })}>
      <div className="ma-composer-sheet">
        {/* Image attach is an in-field accessory on the textarea's own bottom
            rail (left, opposite the counter) — never a standalone pill row. */}
        <TextArea aria-label="动态内容" value={state.composerDraft}
          onChange={e => dispatch({ type: 'composer/draft', value: e.target.value })}
          minimumRows={4} autoFocus maxLength={280} characterCount
          placeholder="分享你身边正在发生的连接……"
          leadingAccessory={<>
            <FilePicker iconOnly iconId="image-plus"
              label={images.length > 0 ? `图片 ${images.length}/${MAX_COMPOSE_IMAGES}` : '添加图片'}
              accept="image/*" multiple disabled={images.length >= MAX_COMPOSE_IMAGES}
              onFiles={async files => {
                const room = MAX_COMPOSE_IMAGES - images.length;
                const picked = await Promise.all(files.slice(0, room).map(readImageDataUrl));
                dispatch({ type: 'composer/addImages', images: picked });
              }} />
            {images.length > 0 && <span className="pt-textarea-accessory-count">{images.length}/{MAX_COMPOSE_IMAGES}</span>}
          </>} />

        {images.length > 0 && (
          <div className="ma-compose-thumbs" data-compose-image-count={images.length}>
            {images.map((src, index) => (
              <span className="ma-compose-thumb" key={`${src.slice(0, 24)}-${index}`}>
                <img src={src} alt={`待发布图片 ${index + 1}`} />
                <IconButton actionId={`compose.image.remove.${index}`} iconId="close" iconSize={12}
                  density="compact" emphasis="quiet" label="移除图片"
                  className="ma-compose-thumb-remove"
                  onActivate={() => dispatch({ type: 'composer/removeImage', index })} />
              </span>
            ))}
          </div>
        )}

        <div className="ma-compose-audience">
          <Select<AudienceKind> aria-label="可见范围"
            options={AUDIENCE_OPTIONS} value={audience}
            onValueChange={value => dispatch({ type: 'composer/audience', audience: (Array.isArray(value) ? value[0] : value) ?? 'public' })} />
          {audience === 'circle' && (circle
            ? <Select<string> aria-label="选择圈子"
              options={state.circles.map(c => ({ value: c.id, label: c.name }))}
              value={circle.id}
              onValueChange={value => dispatch({ type: 'composer/target', circle: String(value) })} />
            : <span className="ma-circle-missing">还没有圈子，先去「圈友」新建分组</span>
          )}
          {audience === 'group' && (group
            ? <Select<string> aria-label="选择群聊"
              options={state.audienceGroups.map(g => ({ value: g.id, label: g.name }))}
              value={group.id}
              onValueChange={value => dispatch({ type: 'composer/target', group: String(value) })} />
            : <span className="ma-circle-missing">还没有可发布的群聊</span>
          )}
          {(audience === 'allow' || audience === 'deny') && (
            <fieldset className="ma-audience-actors" data-audience-actors={audience}>
              <legend>{audience === 'allow' ? '仅这些人可见' : '关注者中排除这些人'}</legend>
              {state.momentPeople.map(person => {
                const chosen = state.composerActorIds.includes(person.id);
                return (
                  <Button key={person.id} actionId={`compose.actor.${person.id}`}
                    emphasis={chosen ? 'secondary' : 'quiet'} density="compact"
                    className={`ma-audience-actor${chosen ? ' is-chosen' : ''}`}
                    aria-pressed={chosen}
                    leading={<Avatar name={person.name} background={person.tone} size={24} style={{ borderRadius: 7 }} aria-hidden="true" />}
                    trailing={chosen ? <Icon iconId="check" size={13} aria-hidden="true" /> : undefined}
                    onActivate={() => dispatch({ type: 'composer/toggleActor', id: person.id })}>
                    {person.name}
                  </Button>
                );
              })}
            </fieldset>
          )}
        </div>
        <div className="ma-composer-foot">
          <Button actionId="ma.moment.cancel" emphasis="quiet" onActivate={() => dispatch({ type: 'composer/close' })}>取消</Button>
          <Button actionId="ma.moment.publish" emphasis="primary"
            availability={disabledReason ? { kind: 'disabled', reason: disabledReason } : undefined}
            onActivate={() => dispatch({ type: 'moment/publish' })}>发布</Button>
        </div>
      </div>
    </BottomSheet>
  );
}

type EdgeMask = 'none' | 'start' | 'end' | 'both';

/** Bidirectional edge-fade for an overflow-x row: each end fades only while
    more content is hidden on that side (the project's scroll affordance
    rule — every horizontally overflowing row signals scrollability). */
function useEdgeMask(ref: RefObject<HTMLElement | null>, deps: unknown[]): EdgeMask {
  const [mask, setMask] = useState<EdgeMask>('none');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const canStart = el.scrollLeft > 2;
      const canEnd = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
      setMask(canStart && canEnd ? 'both' : canStart ? 'start' : canEnd ? 'end' : 'none');
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    el.addEventListener('scroll', sync, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return mask;
}

function MomentCard({ moment, state, dispatch }: { moment: Moment; state: AppState; dispatch: Dispatch }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Progressive disclosure on the narrow surface: the comment composer is
  // never painted until the reader taps the comment action — an empty input
  // row must not occupy vertical space by default ("不点就不显示").
  const [composerOpen, setComposerOpen] = useState(false);
  const commentInputRef = useRef<HTMLInputElement | null>(null);
  const reactionRef = useRef<HTMLDivElement | null>(null);
  const draft = state.commentDrafts[moment.id] ?? '';
  const commentsOpen = !state.commentsCollapsed[moment.id];

  const toggleComments = () => {
    if (commentsOpen && composerOpen) {
      dispatch({ type: 'moment/toggleComments', id: moment.id });
      setComposerOpen(false);
    } else {
      if (!commentsOpen) dispatch({ type: 'moment/toggleComments', id: moment.id });
      setComposerOpen(true);
      requestAnimationFrame(() => commentInputRef.current?.focus());
    }
  };
  const chosen = new Set(moment.viewerReactions ?? []);
  const totals = (Object.entries(moment.reactions) as [ReactionKind, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  const reactionMask = useEdgeMask(reactionRef, [JSON.stringify(moment.reactions)]);
  const commentCount = moment.comments.length;
  const ownPost = moment.author === ME.name;

  const segments = [
    moment.source === 'remote' && moment.station ? `来自 ${moment.station}` : '本站',
    moment.reason === 'public' ? null : REASON_LABEL[moment.reason],
    moment.audience === 'circle' && moment.circle
      ? `圈子 · ${moment.circle}`
      : moment.audience === 'group' && moment.group
        ? `群聊 · ${moment.group}`
        : AUDIENCE_LABEL[moment.audience],
  ].filter((s): s is string => Boolean(s));

  const picker = (
    <div className="ma-react-picker" role="group" aria-label="选择反应">
      {REACTION_CATALOG.map(meta => (
        <Button key={meta.kind} actionId={`moment.react.${meta.kind}`} emphasis="quiet" density="compact"
          className={chosen.has(meta.kind) ? 'is-liked' : undefined}
          aria-label={reactionLabel(meta.kind)} aria-pressed={chosen.has(meta.kind)}
          onActivate={() => dispatch({ type: 'moment/toggleReaction', id: moment.id, kind: meta.kind })}>
          <span aria-hidden="true">{meta.emoji}</span>
        </Button>
      ))}
    </div>
  );

  return (
    <article className="ma-moment" data-post-id={moment.id}>
      <div className="ma-moment-head">
        <Avatar name={moment.author} size={42} background={moment.tone} style={{ borderRadius: 12 }} />
        <span className="ma-moment-who">
          <strong>{moment.author}</strong>
          <em>{moment.at}</em>
        </span>
        {ownPost && (
          <Menu placement="bottom" label="动态操作" actions={[{
            id: `moment.delete.${moment.id}`, label: '删除动态', tone: 'danger',
            leading: <Icon iconId="delete" size={14} />,
            onActivate: () => setConfirmDelete(true),
          }]}>
            <IconButton actionId={`moment.menu.${moment.id}`} iconId="more-horizontal" iconSize={16}
              label="更多" emphasis="quiet" density="compact" />
          </Menu>
        )}
      </div>

      <div className="ma-trust">
        {segments.map((segment, index) => (
          <span className="ma-trust-seg" key={segment}>
            {index === segments.length - 1 && <Icon iconId={audienceIcon(moment.audience)} size={11} />}
            {segment}
            {index < segments.length - 1 && <span className="ma-trust-dot" aria-hidden="true">·</span>}
          </span>
        ))}
      </div>

      <p className="ma-moment-text">{moment.text}</p>
      {moment.images && moment.images.length > 0 && (
        <div className={`ma-post-images ma-grid-${Math.min(moment.images.length, 9)}`} data-count={moment.images.length}>
          {moment.images.map((src, i) => (
            <span key={`${moment.id}-img${i}`} className="ma-img-tile"><img src={src} alt="" loading="lazy" /></span>
          ))}
        </div>
      )}

      <div className="ma-moment-foot">
        <div className="ma-react-summary" ref={reactionRef} data-mask={totals.length ? reactionMask : 'none'}>
          {totals.map(([kind, count]) => {
            const meta = REACTION_BY_KIND.get(kind);
            if (!meta) return null;
            const selected = chosen.has(kind);
            return (
              <Button key={kind} actionId={`moment.reaction-chip.${moment.id}.${kind}`}
                emphasis="quiet" density="compact"
                className={`ma-react-chip${selected ? ' is-liked' : ''}`}
                aria-pressed={selected} data-reaction-kind={kind}
                onActivate={() => dispatch({ type: 'moment/toggleReaction', id: moment.id, kind })}>
                <span className="ma-react-emoji" aria-hidden="true">{meta.emoji}</span>
                <span className="ma-react-count">{count}</span>
              </Button>
            );
          })}
        </div>
        <span className="ma-post-action-buttons">
          <Popover placement="bottom" content={picker}>
            <Button actionId={`moment.reaction.${moment.id}`} emphasis="quiet" density="compact"
              leading={<Icon iconId="smile" size={15} />} aria-label="添加反应" aria-haspopup="dialog" />
          </Popover>
          <Button actionId={`moment.comments.${moment.id}`} emphasis="quiet" density="compact"
            leading={<Icon iconId="message-circle" size={15} />} label={String(commentCount)}
            aria-label={`${commentCount} 条评论`} aria-expanded={commentsOpen && composerOpen}
            onActivate={toggleComments} />
        </span>
      </div>

      {commentsOpen && (moment.comments.length > 0 || composerOpen) && (
        <div className="ma-comments" data-comments-open="true">
          {moment.comments.length > 0 && (
            <ul className="ma-comments-list">
              {[...moment.comments].reverse().map(c => (
                <li key={c.id} className="ma-comment">
                  <Avatar name={c.author} background={c.tone} size={30} style={{ borderRadius: 9 }} aria-hidden="true" />
                  <span className="ma-comment-body">
                    <span className="ma-comment-line">
                      <strong>{c.author}</strong>
                      <span>{c.text}</span>
                    </span>
                    <em>{c.at}</em>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {composerOpen && (
            <div className="ma-comment-input">
              <TextField ref={el => { commentInputRef.current = el; }}
                aria-label="写评论" placeholder="写评论……" value={draft}
                onValueChange={value => dispatch({ type: 'moment/commentDraft', id: moment.id, value })}
                onEnter={event => {
                  event.preventDefault();
                  const text = draft.trim();
                  if (text) dispatch({ type: 'moment/addComment', id: moment.id, text: draft });
                }} />
              <IconButton actionId={`comment.send.${moment.id}`} iconId="send" iconSize={15} label="发送评论"
                emphasis="primary"
                availability={draft.trim() ? undefined : { kind: 'disabled', reason: '请输入评论' }}
                onActivate={() => {
                  if (!draft.trim()) return;
                  dispatch({ type: 'moment/addComment', id: moment.id, text: draft });
                  requestAnimationFrame(() => commentInputRef.current?.focus());
                }} />
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmDelete} onDismiss={() => setConfirmDelete(false)} title="删除这条动态？"
        description="删除仅作用于本地原型视图。"
        footer={<>
          <Button actionId="moment.delete-cancel" emphasis="quiet" label="取消" onActivate={() => setConfirmDelete(false)} />
          <Button actionId="moment.delete-ok" emphasis="primary" tone="danger" label="删除"
            onActivate={() => { setConfirmDelete(false); dispatch({ type: 'moment/delete', id: moment.id }); }} />
        </>} />
    </article>
  );
}

/* ── Contact / group detail ───────────────────────────────────────────── */
function NavRow({ label, description, onActivate, actionId }: {
  label: string; description?: string; onActivate: () => void; actionId?: string;
}) {
  return (
    <ListRow label={label} description={description} role="button" tabIndex={0}
      data-action-id={actionId}
      onClick={onActivate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      control={<Icon iconId="chevron-right" size={17} />} />
  );
}

export function ContactDetailScreen({ person, state, dispatch }: { person: Person; state: AppState; dispatch: Dispatch }) {
  return (
    <DetailPage title="联系人" onBack={() => dispatch({ type: 'back' })}>
      <div className="ma-detail-hero">
        <PersonAvatar name={person.name} size={72} tone={person.tone} online={person.online} />
        <strong>{person.name}</strong>
        <em>{person.role}</em>
      </div>
      <div className="ma-detail-actions">
        <span className="ma-detail-primary">
          <Button actionId="ma.contact.message" emphasis="primary" fullWidth leading={<Icon iconId="message-circle" size={17} />}
            onActivate={() => dispatch({ type: 'navigate', route: { tab: 'chats', conversationId: `direct-${person.id}` } })}>发消息</Button>
        </span>
        <IconButton actionId="ma.contact.call" iconId="phone" label="语音通话" emphasis="secondary" iconSize={19}
          onActivate={() => dispatch({ type: 'call/start', conversationId: `direct-${person.id}`, media: 'audio' })} />
      </div>
      <ListSection className="ma-settings" title="通知与隐私">
        <ListRow label="消息免打扰" control={<Switch checked={!state.settings.notify} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'notify', value: !v })} aria-label="消息免打扰" />} />
        <ListRow label="发送已读回执" control={<Switch checked={state.settings.readReceipt} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'readReceipt', value: v })} aria-label="发送已读回执" />} />
      </ListSection>
      <div className="ma-settings ma-danger-zone">
        <Button actionId="ma.contact.block" emphasis="quiet" tone="danger" fullWidth leading={<Icon iconId="ban" size={16} />}>拉黑</Button>
      </div>
    </DetailPage>
  );
}

export function GroupDetailScreen({ group, state, dispatch }: { group: Group; state: AppState; dispatch: Dispatch }) {
  const previewMembers = state.people.slice(0, 4);
  return (
    <DetailPage title="群聊" onBack={() => dispatch({ type: 'back' })} action={<IconButton actionId="ma.group.more" iconId="more-horizontal" label="更多" emphasis="quiet" iconSize={20} />}>
      <div className="ma-detail-hero">
        <GroupAvatar name={group.name} size={72} members={group.memberTiles} />
        <strong>{group.name}</strong>
        <em>{`${group.members} 位成员`}</em>
      </div>
      <div className="ma-detail-actions">
        <span className="ma-detail-primary">
          <Button actionId="ma.group.message" emphasis="primary" fullWidth leading={<Icon iconId="message-circle" size={17} />}
            onActivate={() => dispatch({ type: 'navigate', route: { tab: 'chats', conversationId: `group-${group.id}` } })}>发消息</Button>
        </span>
      </div>
      <section className="ma-group-block ma-detail-list">
        <h3 className="ma-index">成员 · {group.members}</h3>
        <ul className="ma-flat-list">
          {previewMembers.map(p => (
            <li key={p.id}><PressRow ariaLabel={p.name}
              onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'person', id: p.id } } })}
              icon={<PersonAvatar name={p.name} size={40} tone={p.tone} online={p.online} />}
              label={<span className="ma-row-title">{p.name}</span>}
              description={p.role}
              control={<Icon iconId="chevron-right" size={16} />} /></li>
          ))}
          <li><PressRow ariaLabel="添加成员" onClick={() => undefined}
            icon={<span className="ma-add-icon"><Icon iconId="user-plus" size={18} /></span>}
            label={<span className="ma-row-title">添加成员</span>} /></li>
        </ul>
      </section>
    </DetailPage>
  );
}

/* ── Me / settings ────────────────────────────────────────────────────── */

/* One credential row on the pushed credentials page: field name + monotonic
   value (single-line ellipsis) + copy. The PTID string renders ONLY here. */
function CredentialRow({ credential, label, value, copyAction, copyValue }: {
  credential: string; label: string; value: string; copyAction: string; copyValue: string;
}) {
  return (
    <ListRow data-credential={credential}
      label={<span className="ma-cred-text">
        <span className="ma-cred-label">{label}</span>
        <code>{value}</code>
      </span>}
      control={<IconButton iconId="copy" iconSize={14} density="compact" emphasis="quiet"
        actionId={copyAction} label={`复制${label}`}
        onActivate={() => { void navigator.clipboard?.writeText(copyValue); }} />} />
  );
}

export function CredentialsScreen({ dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <DetailPage title="账号与凭证" onBack={() => dispatch({ type: 'back' })}>
      <div data-credentials-page>
        <ListSection inset className="ma-settings" title="身份凭证"
          description="用于跨站确认你的身份；长标识不显示在我的首页，只在此处查看与复制。">
          <CredentialRow credential="username" label="首选用户名" value={PROFILE.username}
            copyAction="me.copy-username" copyValue={PROFILE.username.slice(1)} />
          <CredentialRow credential="ptid" label="PTID" value={PROFILE.ptid}
            copyAction="me.copy-ptid" copyValue={PROFILE.ptid} />
          <ListRow data-credential="station" label="所属站点"
            control={<span className="ma-cred-station">{PROFILE.station}</span>} />
        </ListSection>
      </div>
    </DetailPage>
  );
}

export function MeScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const { t, locale } = useT();
  const s = state.settings;
  const station = currentStation(state);
  const [avatar, setAvatar] = useState('');
  const [cover, setCover] = useState('');
  const [signOutOpen, setSignOutOpen] = useState(false);
  const readImage = (setter: (dataUrl: string) => void) => (files: readonly File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setter(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="ma-page ma-me">
      {/* Layer 1 — identity hero: plant-artwork cover bleeds edge to edge,
          the avatar overlaps the cover's lower edge with a cutting ring.
          Identity facts carry the page; no settings actions live here.
          Both the cover and the avatar carry an image-change action. */}
      <header className="ma-hero" data-me-profile>
        {/* Identity-edit grammar mirrors desktop Settings › Identity
            (AccountSection): the SAME iconOnly FilePicker pencil chip pinned to
            each artwork's bottom-right corner — banner right:12/bottom:12,
            avatar right:6/bottom:6. On touch (hover:none) it stays reachable. */}
        <div className="ma-hero-cover" data-hero-cover
          style={{ backgroundImage: `url("${cover || PROFILE.cover}")` }}>
          <span className="ma-hero-cover-action">
            <FilePicker iconOnly iconId="edit" accept="image/*" label="更换封面" onFiles={readImage(setCover)} />
          </span>
        </div>
        <div className="ma-hero-body">
          <div className="ma-hero-avatar" data-hero-avatar>
            <Avatar name={ME.name} source={avatar || undefined} size={68} background={ME.tone}
              style={{ borderRadius: 18 }} />
            <span className="ma-hero-avatar-action">
              <FilePicker iconOnly iconId="edit" accept="image/*" label="更换头像" onFiles={readImage(setAvatar)} />
            </span>
          </div>
          <div className="ma-hero-name-row">
            <strong data-hero-name>{ME.name}</strong>
            <span data-hero-tag><Tag>{PROFILE.localTag}</Tag></span>
          </div>
          <div className="ma-hero-handle" data-hero-handle>{ME.handle}</div>
          <div className="ma-hero-stats" data-hero-stats>
            <span><strong>{PROFILE.posts}</strong> 动态</span>
            <span><strong>{PROFILE.follows}</strong> 关注</span>
            <span><strong>{PROFILE.followers}</strong> 粉丝</span>
            <em>{PROFILE.joined} 加入</em>
          </div>
        </div>
      </header>

      {/* Layer 2 — credentials demoted to one entry row; the long PTID string
          exists only on the pushed page, never on this first screen. */}
      <ListSection inset className="ma-settings ma-credentials-entry" aria-label="账号与凭证">
        <NavRow label="账号与凭证" actionId="me.credentials"
          description={`${PROFILE.username} · ${station.name}`}
          onActivate={() => dispatch({ type: 'navigate', route: { tab: 'me', setting: 'credentials' } })} />
      </ListSection>

      {/* Layer 3 — touch-consumption settings only. Producer/ops surfaces
          (AI providers, channels, logs, statistics) are deliberately absent. */}
      <ListSection inset className="ma-settings" data-section="preferences" title="偏好" description="这些默认只影响本机与本站。">
        <ListRow label="消息通知" description="在本机通道接收提醒。" control={<Switch checked={s.notify} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'notify', value: v })} aria-label="消息通知" />} />
        <ListRow label="提示音" control={<Switch checked={s.sound} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'sound', value: v })} aria-label="提示音" />} />
        <ListRow label="已读回执" control={<Switch checked={s.readReceipt} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'readReceipt', value: v })} aria-label="已读回执" />} />
        <ListRow label="自动锁定" control={<Select appearance="ghost" aria-label="自动锁定" value={s.autoLock} onValueChange={v => dispatch({ type: 'setting/set', key: 'autoLock', value: String(v) })}
          options={[{ value: '1m', label: '1 分钟后' }, { value: '5m', label: '5 分钟后' }, { value: 'never', label: '永不' }]} />} />
      </ListSection>
      <ListSection inset className="ma-settings" data-section="network" title="网络">
        <NavRow label="当前站点"
          description={`${station.name} · ${station.online ? '已连接' : '离线'} · 可切换或添加站点`}
          onActivate={() => dispatch({ type: 'navigate', route: { tab: 'me', setting: 'station' } })} />
        <ListRow label="端到端加密" control={<span className="ma-ok">已开启</span>} />
      </ListSection>
      <ListSection inset className="ma-settings" data-section="general" title="通用">
        <ListRow label={t('settings.language')} control={<Select appearance="ghost" aria-label={t('settings.language')} value={locale} onValueChange={v => setPrefs({ locale: v === 'en' ? 'en' : 'zh-CN' })}
          options={[{ value: 'zh-CN', label: t('settings.lang.zh') }, { value: 'en', label: t('settings.lang.en') }]} />} />
        <NavRow label="关于 Peers Touch" onActivate={() => dispatch({ type: 'navigate', route: { tab: 'me', setting: 'about' } })} />
      </ListSection>

      <div className="ma-settings ma-danger-zone" data-danger-zone>
        <Button actionId="me.signout" tone="danger" emphasis="quiet" fullWidth
          leading={<Icon iconId="log-out" size={16} />}
          onActivate={() => setSignOutOpen(true)}>
          退出登录
        </Button>
      </div>

      <Dialog open={signOutOpen} title="退出登录"
        description="将退出当前站点账号并回到登录页；本机会话数据保留，重新登录后继续。"
        onDismiss={() => setSignOutOpen(false)}
        footer={
          <>
            <Button actionId="me.signout.cancel" emphasis="quiet" label="取消" onActivate={() => setSignOutOpen(false)} />
            <Button actionId="me.signout.confirm" tone="danger" emphasis="primary" label="退出登录"
              onActivate={() => { setSignOutOpen(false); dispatch({ type: 'auth/signOut' }); }} />
          </>
        } />
    </div>
  );
}

/** Add-a-station dialog shared by the signed-out launch gate AND the in-app
    Station settings page. Mirrors the real device contract: the ONLY input is
    a Station URL (or private connection code); the display name is derived
    from the host, never typed. Validates the root-origin form, warns on plain
    HTTP and rejects duplicate origins. */
function StationAddDialog({ open, idPrefix, existingHandles, onClose, onSubmit }: {
  open: boolean;
  idPrefix: 'ma.station' | 'launch.station';
  existingHandles: readonly string[];
  onClose: () => void;
  onSubmit: (url: string) => void;
}) {
  const { t } = useT();
  const [url, setUrl] = useState('');
  useEffect(() => { if (open) setUrl(''); }, [open]);

  const trimmed = url.trim();
  const accessInput = trimmed ? buildStationAccessInput(trimmed) : null;
  const isPrivate = isPrivateConnection(trimmed);
  const invalid = trimmed.length > 0 && accessInput === null;
  const duplicate = accessInput !== null
    && existingHandles.some(handle => stationIdentityKey(handle) === stationIdentityKey(accessInput));
  const httpWarn = accessInput !== null && !isPrivate && normalizeStationUrl(trimmed)?.startsWith('http://');
  const canSubmit = accessInput !== null && !duplicate;

  const submit = () => {
    if (!canSubmit || !accessInput) return;
    onSubmit(accessInput);
    onClose();
  };

  return (
    <Dialog open={open} title={t('station.add.title')} description={t('station.add.desc')} onDismiss={onClose}
      footer={
        <>
          <Button actionId={`${idPrefix}.add.cancel`} emphasis="quiet" label={t('common.cancel')} onActivate={onClose} />
          <Button actionId={`${idPrefix}.add.confirm`} emphasis="primary" label={t('station.add.connect')}
            availability={canSubmit
              ? undefined
              : { kind: 'disabled', reason: duplicate ? t('station.add.duplicate') : t('station.add.invalid') }}
            onActivate={submit} />
        </>
      }>
      <div className="ma-station-form" data-station-form={invalid ? 'invalid' : duplicate ? 'duplicate' : 'valid'}>
        <Field validation={invalid || duplicate
          ? { state: 'invalid', message: duplicate ? t('station.add.duplicate') : t('station.add.invalid') }
          : { state: 'unchecked' }}>
          <TextField aria-label={t('station.add.inputLabel')} placeholder={t('station.add.placeholder')} value={url}
            aria-invalid={invalid || duplicate || undefined} autoFocus autoCapitalize="none" autoCorrect="off"
            spellCheck={false} inputMode="url"
            onValueChange={setUrl} onEnter={event => { event.preventDefault(); submit(); }} />
        </Field>
        {httpWarn && !invalid && !duplicate && (
          <p className="ma-station-http-warn" data-http-warning>{t('station.add.httpWarning')}</p>
        )}
      </div>
    </Dialog>
  );
}

/** First-run / signed-out launch gate — the ONE product entry surface:
    station selection, scan-to-link and the Station access decision gate live
    here (no second harness launch page). Replaces the whole app until a
    GRANTED access decision or device-linked session admits the viewer. */
export function SignedOutScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const { t, locale } = useT();
  const station = currentStation(state);
  const [scanOpen, setScanOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const access = state.access;

  // Handshake: the real client fetches an AccessDecision over RPC after
  // identity discovery. The prototype simulates that round trip with a short
  // deterministic delay, then injects the Station's fixture decision.
  useEffect(() => {
    if (access.phase !== 'handshake') return;
    const timer = window.setTimeout(() => {
      const attemptId = `attempt-${Date.now()}`;
      dispatch({
        type: 'access/apply',
        profile: station.gateProfile,
        decision: buildFixtureDecision(station.gateProfile, attemptId),
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [access.phase, station.gateProfile, dispatch]);

  // OAuth phase machine: the view owns the local timer for a USER-started
  // flow only; scenario-seeded evidence phases stay frozen for inspection.
  const oauthBusy = access.oauthStarted
    && access.oauthPhase !== 'idle'
    && access.oauthPhase !== 'active_session'
    && access.oauthPhase !== 'failed';
  useEffect(() => {
    if (!oauthBusy) return;
    const timer = window.setInterval(() => dispatch({ type: 'access/oauth-tick' }), 650);
    return () => window.clearInterval(timer);
  }, [oauthBusy, access.oauthPhase, access.oauthStarted, dispatch]);

  // Remembered emails are Station-scoped local history, loaded once per gate.
  useEffect(() => {
    if (access.phase !== 'gate') return;
    const emails = loadRememberedEmails(station.id);
    if (emails.length > 0 && emails.join('|') !== access.rememberedEmails.join('|')) {
      dispatch({ type: 'access/remembered', emails });
    }
  }, [access.phase, access.rememberedEmails, station.id, dispatch]);

  return (
    <div className="ma-page ma-launch" data-launch-page data-launch-phase={access.phase}>
      <div className="ma-launch-topbar">
        <IconButton actionId="launch.scan" iconId="scan-line" label={t('launch.scanAria')} emphasis="quiet" iconSize={22}
          onActivate={() => setScanOpen(true)} />
        <Button actionId="launch.lang" emphasis="quiet" density="compact" className="ma-launch-lang"
          aria-label={t('launch.langToggle')}
          onActivate={() => setPrefs({ locale: locale === 'en' ? 'zh-CN' : 'en' })}>
          {locale === 'en' ? t('lang.code.zh') : t('lang.code.en')}
        </Button>
      </div>

      <div className="ma-launch-brand">
        <span className="ma-launch-logo" data-launch-logo>Peers</span>
        <h1>{t('launch.title')}</h1>
      </div>

      {access.phase === 'idle' && (
        <div className="ma-launch-body">
          <div className="ma-launch-section-head">
            <strong>{t('launch.yourStations')}</strong>
          </div>
          <ul className="ma-station-pick-list">
            {state.stations.map(st => {
              const selected = st.id === state.currentStationId;
              return (
                <li key={st.id}>
                  <button type="button"
                    className={`ma-station-pick${selected ? ' is-selected' : ''}`}
                    data-station-online={st.online || undefined}
                    aria-pressed={selected}
                    onClick={() => dispatch({ type: 'station/select', id: st.id })}>
                    <Icon iconId="server" size={18} />
                    <span className="ma-station-pick-main">
                      <strong>{st.name}</strong>
                      <em>{st.handle}</em>
                    </span>
                    <span className={`ma-station-state${st.online ? ' is-online' : ''}`}>
                      {st.online ? t('launch.verified') : t('launch.verifying')}
                    </span>
                    {selected && <Icon iconId="check" size={17} />}
                  </button>
                </li>
              );
            })}
          </ul>
          <Button actionId="launch.station.add" emphasis="quiet" fullWidth className="ma-launch-add-station"
            leading={<Icon iconId="plus" size={16} />} onActivate={() => setAddOpen(true)}>
            {t('launch.addStation')}
          </Button>
          <Button actionId="launch.continue" emphasis="primary" fullWidth
            availability={station.online ? undefined : { kind: 'disabled', reason: t('launch.unreachable') }}
            onActivate={() => dispatch({ type: 'access/start' })}>
            {station.online ? t('launch.openStation', { name: station.name }) : t('launch.unreachable')}
          </Button>
        </div>
      )}

      {access.phase === 'handshake' && (
        <div className="ma-launch-body ma-launch-handshake" role="status" data-handshake>
          <Spin size="small" label={t('launch.verifying')} />
          <p>{t('launch.handshake')}</p>
        </div>
      )}

      {access.phase === 'gate' && access.decision && (
        <AccessGateView
          decision={access.decision}
          stationName={station.name}
          stationId={station.id}
          loading={access.loading}
          errorKey={access.errorKey as StringKey | null}
          oauthPhase={access.oauthPhase}
          oauthErrorKey={access.oauthErrorKey as StringKey | null}
          rememberedEmails={access.rememberedEmails}
          sessionExpired={access.sessionExpired}
          dispatch={dispatch} />
      )}

      {scanOpen && (
        <div className="ma-scan-overlay" data-scan-overlay role="dialog" aria-modal="true"
          aria-label={t('launch.scanTitle')}>
          <div className="ma-scan-topbar">
            <IconButton actionId="launch.scan.close" iconId="chevron-left" iconSize={24}
              emphasis="quiet" label={t('common.back')} onActivate={() => setScanOpen(false)} />
            <span className="ma-scan-title">{t('launch.scanTitle')}</span>
            <span className="ma-scan-topbar-spacer" aria-hidden="true" />
          </div>

          <div className="ma-scan-stage" aria-hidden="true">
            <div className="ma-scan-frame" data-scan-frame>
              <span className="ma-scan-corner is-tl" />
              <span className="ma-scan-corner is-tr" />
              <span className="ma-scan-corner is-bl" />
              <span className="ma-scan-corner is-br" />
              <span className="ma-scan-line" />
            </div>
          </div>

          <div className="ma-scan-footer">
            <p>{t('launch.scanBody')}</p>
            <Button actionId="launch.scan-confirm" className="ma-scan-confirm" emphasis="primary" fullWidth
              onActivate={() => { setScanOpen(false); dispatch({ type: 'device-link/grant' }); }}>
              {t('launch.scanConfirm')}
            </Button>
          </div>
        </div>
      )}

      <StationAddDialog open={addOpen} idPrefix="launch.station"
        existingHandles={state.stations.map(st => st.handle)}
        onClose={() => setAddOpen(false)}
        onSubmit={url => dispatch({ type: 'station/add', url })} />
    </div>
  );
}

export function StationScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const { t } = useT();
  const [addOpen, setAddOpen] = useState(false);
  const station = currentStation(state);
  return (
    <DetailPage title={t('station.title')} onBack={() => dispatch({ type: 'back' })}>
      <ListSection className="ma-settings" title={t('station.mine')}
        description={t('station.currentDesc', { name: station.name })}>
        {state.stations.map(st => (
          <ListRow key={st.id} onClick={() => dispatch({ type: 'station/select', id: st.id })} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch({ type: 'station/select', id: st.id }); } }}
            label={<span className="ma-station-name">{st.name}{!st.online && <Tag tone="neutral">{t('station.offline')}</Tag>}</span>}
            description={st.handle}
            control={state.currentStationId === st.id ? <Icon iconId="check" size={18} /> : <span className="ma-station-dot" data-online={st.online || undefined} />} />
        ))}
      </ListSection>
      <div className="ma-settings ma-danger-zone">
        <Button actionId="ma.station.add" emphasis="secondary" fullWidth leading={<Icon iconId="plus" size={16} />}
          onActivate={() => setAddOpen(true)}>{t('launch.addStation')}</Button>
      </div>

      <StationAddDialog open={addOpen} idPrefix="ma.station"
        existingHandles={state.stations.map(st => st.handle)}
        onClose={() => setAddOpen(false)}
        onSubmit={url => dispatch({ type: 'station/add', url })} />
    </DetailPage>
  );
}

export function AboutScreen({ dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <DetailPage title="关于" onBack={() => dispatch({ type: 'back' })}>
      <div className="ma-detail-hero">
        <Avatar name="Peers Touch" size={72} background={ME.tone} />
        <strong>Peers Touch</strong>
        <em>去中心化邻里网络 · 原型</em>
      </div>
      <ListSection className="ma-settings" title="版本">
        <ListRow label="客户端" control={<span className="ma-version">0.1.0 · pine</span>} />
        <NavRow label="开源许可" onActivate={() => undefined} />
        <NavRow label="隐私与安全白皮书" onActivate={() => undefined} />
      </ListSection>
    </DetailPage>
  );
}
