/**
 * Increment 11 — conversation frame: header with call/search/info entries,
 * a right-side conversation detail sheet, in-conversation message search,
 * and a thread panel with live replies. Calls open the shared call overlay
 * (increment 14 extends it with incoming and group calls).
 *
 * Increment 44 realigns the detail sheet with the desktop ChatDetailPanel:
 * sheet header shares the chat header line, the group hero owns avatar
 * change + inline name edit (owner/admin gated), settings use plain icons,
 * announcement row removed (no such entry in the shipping UI), and danger
 * actions are dissolve/leave for groups.
 */
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useDismissOutside } from '../use-dismiss-outside';
import {
  BellOff, Bookmark, ChevronLeft, Eraser, File as FileIcon,
  Image as ImageIcon, LogOut, Phone, Pin, Smartphone, Trash2,
  UserPlus, Users, Video,
} from 'lucide-react';
import {
  Avatar, Button, Checkbox, Dialog, Empty, IconButton, Switch, TextArea, TextField, Toggle,
} from '@peers-touch/ui';
import type { CallKind } from './CallOverlay';
import type { ChatMessage, Conversation, GroupMemberSeed, ThreadReply } from './chat-data';
import { CHAT_BACKGROUND_PRESETS, VIEWER_NAME } from './chat-data';
import { GroupAvatarComposite } from './GroupAvatar';
import { useT, locTag, type Translate } from '../prefs';

/* ── Header — desktop ChatArea parity: name only, no avatar
   (the avatar already lives beside each peer bubble); the back chevron is
   rendered but CSS-hidden above the phone breakpoint (persistent two-pane). */

export function ConversationHeader({ conversation, infoOpen,
  onBack, onAudio, onVideo, onInfo }: {
  conversation: Conversation;
  infoOpen?: boolean;
  onBack: () => void;
  onAudio: () => void;
  onVideo: () => void;
  onInfo: () => void;
}) {
  const { t } = useT();
  const subtitle = conversation.kind === 'group'
    ? t('conv.members', { n: conversation.members?.length ?? 0 })
    : conversation.muted
      ? t('conv.muted')
      : conversation.online === false ? t('conv.offline') : t('conv.online');
  return (
    <header className="sk-chat-head" data-conversation-open="true">
      <button type="button" className="sk-chat-back" aria-label={t('conv.back')}
        data-action-id="chat.back-to-list" onClick={onBack}><ChevronLeft size={18} /></button>
      <div className="sk-chat-head-id">
        <div className="sk-chat-head-name">
          <strong>{conversation.name}</strong>
          <span data-head-subtitle>{subtitle}</span>
        </div>
      </div>
      <div className="sk-chat-head-actions">
        <IconButton iconId="phone" iconSize={19} label={t('conv.callAudio')} actionId="chat.call-audio"
          density="comfortable" emphasis="quiet" className="sk-head-action"
          onActivate={onAudio} />
        <IconButton iconId="video" iconSize={19} label={t('conv.callVideo')} actionId="chat.call-video"
          density="comfortable" emphasis="quiet" className="sk-head-action"
          onActivate={onVideo} />
        <IconButton iconId="info" iconSize={19} label={t('conv.info')}
          actionId="chat.open-info"
          density="comfortable" emphasis="quiet" className={`sk-head-action${infoOpen ? ' is-active' : ''}`}
          aria-expanded={infoOpen} onActivate={onInfo} />
      </div>
    </header>
  );
}

/* ── Detail sheet — desktop ChatDetailPanel parity. Plain 15px icons, no
   invented icon tiles; every mutation is real local state. ──────────── */

const ROLE_RANK = { owner: 0, admin: 1, member: 2 } as const;
type GroupRole = 'owner' | 'admin' | 'member';
type DangerKind = 'clear' | 'delete' | 'dissolve' | 'leave';
type MemberConfirm = { kind: 'remove' | 'transfer'; member: GroupMemberSeed } | null;

type TranslationKey = Parameters<Translate>[0];
const roleLabelKey = (role: GroupRole): TranslationKey =>
  role === 'owner' ? 'profile.roleOwner' : role === 'admin' ? 'profile.roleAdmin' : 'profile.roleMember';
const permissionKeys = (role: GroupRole): { title: TranslationKey; body: TranslationKey } => {
  if (role === 'owner') return { title: 'profile.permissionOwnerTitle', body: 'profile.permissionOwnerBody' };
  if (role === 'admin') return { title: 'profile.permissionAdminTitle', body: 'profile.permissionAdminBody' };
  return { title: 'profile.permissionMemberTitle', body: 'profile.permissionMemberBody' };
};

export function DetailSheet({ conversation, messages, people, onClose, onTogglePin, onToggleMute,
  onSearchMessages, onClearHistory, onDeleteConversation, onSimulateIncoming, onRenameConversation,
  onSetGroupAvatar, onSetMyNickname, onSetChatBackground, onAddGroupMembers, onRemoveGroupMember,
  onSetGroupMemberRole, onDissolve, onLeave, onLocateMessage }: {
  conversation: Conversation;
  messages: ChatMessage[];
  people: { id?: string; name: string; tone: string }[];
  onClose: () => void;
  onTogglePin: () => void;
  onToggleMute: () => void;
  onSearchMessages: () => void;
  onLocateMessage?: (messageId: string) => void;
  onClearHistory: () => void;
  onDeleteConversation: () => void;
  onSimulateIncoming?: (kind: CallKind, multiDevice?: boolean) => void;
  onRenameConversation: (name: string) => void;
  onSetGroupAvatar: (avatarImage: string) => void;
  onSetMyNickname: (nickname: string) => void;
  onSetChatBackground: (background: string, backgroundImage?: string) => void;
  onAddGroupMembers: (members: { name: string; tone: string }[]) => void;
  onRemoveGroupMember: (name: string) => void;
  onSetGroupMemberRole: (name: string, role: GroupRole) => void;
  onDissolve: () => void;
  onLeave: () => void;
}) {
  const [danger, setDanger] = useState<DangerKind | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(conversation.name);
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(conversation.myNickname ?? '');
  const [backgroundOpen, setBackgroundOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [memberConfirm, setMemberConfirm] = useState<MemberConfirm>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePickTarget = useRef<'avatar' | 'background'>('avatar');
  const { t } = useT();

  // Non-modal side sheet: press anywhere outside its scope to hide, like a
  // popover. The info ⓘ trigger is excluded so toggling never reopens it,
  // and portaled dialogs launched from the sheet are part of its scope
  // (their scrim must close the dialog only, not the sheet behind it).
  useDismissOutside(sheetRef, true, onClose, [
    "[data-action-id='chat.open-info']",
    '.pt-modal-layer',
  ]);

  const isGroup = conversation.kind === 'group';
  const members = useMemo(() => {
    const list = conversation.members ?? [];
    return [...list].sort((a, b) => ROLE_RANK[a.role ?? 'member'] - ROLE_RANK[b.role ?? 'member']);
  }, [conversation.members]);
  const myRole: GroupRole = members.find(m => m.name === VIEWER_NAME)?.role ?? 'member';
  const canManage = myRole === 'owner' || myRole === 'admin';

  const media = useMemo(() => messages.flatMap(m =>
    (m.attachments ?? []).filter(a => a.kind === 'image' && a.previewUrl)
      .map(a => ({ id: a.id, name: a.name, url: a.previewUrl as string }))), [messages]);
  const files = useMemo(() => messages.flatMap(m =>
    (m.attachments ?? []).filter(a => a.kind === 'file')
      .map(a => ({ id: a.id, name: a.name }))), [messages]);
  const markedMessages = useMemo(() => messages.filter(m => m.markedForLater && !m.recalled), [messages]);

  // Add-member candidates: station friends not already in the group.
  const addCandidates = useMemo(() => {
    const names = new Set(members.map(m => m.name));
    return people.filter(p => !names.has(p.name));
  }, [people, members]);

  // One hidden file input backs both the avatar camera and the background
  // upload (peers-ui has no file control; keep this single raw input).
  const pickFile = (target: 'avatar' | 'background') => {
    filePickTarget.current = target;
    fileInputRef.current?.click();
  };
  const onFilePicked = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      if (filePickTarget.current === 'avatar') onSetGroupAvatar(url);
      else onSetChatBackground('image', url);
    };
    reader.readAsDataURL(file);
  };

  const runDanger = () => {
    if (danger === 'clear') onClearHistory();
    if (danger === 'delete') onDeleteConversation();
    if (danger === 'dissolve') onDissolve();
    if (danger === 'leave') onLeave();
    setDanger(null);
  };

  const saveName = () => {
    const next = nameDraft.trim();
    if (next && next !== conversation.name) onRenameConversation(next);
    setEditingName(false);
  };
  const saveNickname = () => {
    onSetMyNickname(nicknameDraft);
    setEditingNickname(false);
  };
  const submitAdded = () => {
    const picked = addCandidates.filter(p => addSelected.has(p.name));
    if (picked.length) onAddGroupMembers(picked.map(p => ({ name: p.name, tone: p.tone })));
    setAddOpen(false);
    setAddSelected(new Set());
  };
  const runMemberConfirm = () => {
    if (!memberConfirm) return;
    if (memberConfirm.kind === 'remove') onRemoveGroupMember(memberConfirm.member.name);
    if (memberConfirm.kind === 'transfer') onSetGroupMemberRole(memberConfirm.member.name, 'owner');
    setMemberConfirm(null);
  };

  const dangerTitle = danger === 'clear' ? t('profile.clearTitle')
    : danger === 'delete' ? t('profile.deleteTitle')
      : danger === 'dissolve' ? t('profile.dissolveTitle') : t('profile.leaveTitle');
  const dangerBody = danger === 'clear' ? t('profile.clearBody')
    : danger === 'delete' ? t('profile.deleteBody')
      : danger === 'dissolve' ? t('profile.dissolveBody') : t('profile.leaveBody');
  const dangerOk = danger === 'clear' ? t('profile.clearOk')
    : danger === 'delete' ? t('profile.deleteOk')
      : danger === 'dissolve' ? t('profile.dissolveGroup') : t('profile.leaveGroup');

  const visibleMembers = showAll ? members : members.slice(0, 8);
  const permission = permissionKeys(myRole);

  return (
    <aside ref={sheetRef} className="sk-side-sheet sk-profile-sheet" aria-label={t('conv.info')} data-detail-panel="true"
      data-my-role={myRole}>
      <div className="sk-side-head">
        <strong>{isGroup ? t('profile.titleGroup') : t('profile.titlePerson')}</strong>
        {/* Background + message search are header icon actions (self-evident
            glyphs next to close), not two full settings rows. */}
        <span className="sk-side-head-actions">
          <IconButton className="sk-side-head-action" iconId="search" iconSize={16} label={t('profile.findMessages')}
            actionId="profile.search" data-profile-search
            emphasis="quiet" density="compact" onActivate={onSearchMessages} />
          <IconButton className="sk-side-head-action" iconId="image" iconSize={16} label={t('profile.chatBackground')}
            actionId="profile.background" data-profile-background
            emphasis="quiet" density="compact" onActivate={() => setBackgroundOpen(true)} />
          <IconButton className="sk-side-head-action" iconId="close" iconSize={16} label={t('profile.close')} actionId="chat.info-close"
            emphasis="quiet" density="compact" onActivate={onClose} />
        </span>
      </div>

      <div className="sk-side-body">
        {/* Identity hero — group avatar/name are inline-editable for managers */}
        <section className="sk-profile-hero" data-profile-identity>
          {isGroup ? (
            <div className="sk-profile-avatar-box">
              <GroupAvatarComposite members={members} label={t('profile.groupAvatar')} size={72}
                imageUrl={conversation.avatarImage} />
              {canManage && (
                <IconButton iconId="camera" iconSize={12} density="compact"
                  className="sk-profile-camera" actionId="profile.avatar-edit"
                  label={t('profile.changeAvatar')} onActivate={() => pickFile('avatar')} />
              )}
            </div>
          ) : (
            <Avatar name={conversation.name} background={conversation.tone} size={72}
              style={{ borderRadius: 18 }} />
          )}
          {isGroup && editingName ? (
            <TextField className="sk-inline-edit sk-profile-name-input" value={nameDraft}
              data-group-name-input autoFocus
              onValueChange={setNameDraft}
              onKeyDown={e => {
                if (e.key === 'Enter') saveName();
                if (e.key === 'Escape') setEditingName(false);
              }}
              onBlur={saveName} />
          ) : (
            isGroup ? (
              <Button emphasis="quiet" className="sk-profile-name" actionId="profile.edit-name"
                data-profile-edit-name={canManage ? 'true' : 'false'}
                availability={canManage ? undefined : { kind: 'disabled', reason: t('profile.permissionMemberTitle') }}
                onActivate={canManage ? () => { setNameDraft(conversation.name); setEditingName(true); } : undefined}>
                {conversation.name}
              </Button>
            ) : <strong className="sk-profile-name-static">{conversation.name}</strong>
          )}
          <span className="sk-profile-sub">
            {isGroup ? t('conv.members', { n: members.length })
              : conversation.muted ? t('conv.muted')
                : conversation.online === false ? t('conv.offline') : t('conv.online')}
          </span>
        </section>

        {/* My permission in this group (desktop permission section) */}
        {isGroup && (
          <section className="sk-profile-card sk-profile-permission" data-profile-permission>
            <div className="sk-profile-permission-row">
              <div className="sk-profile-permission-text">
                <strong>{t(permission.title)}</strong>
                <span>{t(permission.body)}</span>
              </div>
              <span className="sk-profile-role-tag" data-role={myRole}>{t(roleLabelKey(myRole))}</span>
            </div>
          </section>
        )}

        {/* Group members — ordered owner/admin first; the viewer is always present */}
        {isGroup && (
          <section className="sk-profile-card" data-profile-members>
            <span className="sk-profile-card-title">{t('profile.members', { n: members.length })}</span>
            <div className="sk-profile-members">
              {visibleMembers.map(member => (
                <div className="sk-profile-member" key={member.name}
                  data-role={member.role ?? 'member'} data-self={member.name === VIEWER_NAME ? 'true' : 'false'}>
                  <Avatar name={member.name} background={member.tone} size={38}
                    style={{ borderRadius: 11 }} />
                  <span className="sk-profile-member-name">
                    {member.name === VIEWER_NAME && conversation.myNickname ? conversation.myNickname : member.name}
                  </span>
                  {member.role && member.role !== 'member' && (
                    <span className="sk-profile-member-role">{t(roleLabelKey(member.role))}</span>
                  )}
                </div>
              ))}
            </div>
            {(canManage || members.length > 8) && (
              <div className="sk-profile-member-actions">
                {canManage && (
                  <Button emphasis="quiet" density="compact" className="sk-profile-add"
                    actionId="profile.add-member-open"
                    leading={<UserPlus size={13} />} label={t('profile.addMember')}
                    availability={addCandidates.length === 0
                      ? { kind: 'disabled', reason: t('profile.addMemberEmpty') }
                      : undefined}
                    onActivate={() => { setAddSelected(new Set()); setAddOpen(true); }} />
                )}
                <span className="sk-profile-member-links">
                  {members.length > 8 && (
                    <Button emphasis="quiet" density="compact" className="sk-profile-link"
                      actionId="profile.see-all"
                      label={showAll ? t('profile.showLess') : t('profile.seeAll')}
                      onActivate={() => setShowAll(v => !v)} />
                  )}
                  {canManage && (
                    <Button emphasis="quiet" density="compact" className="sk-profile-link"
                      actionId="profile.manage-members" label={t('profile.manageMembers')}
                      onActivate={() => setManageOpen(true)} />
                  )}
                </span>
              </div>
            )}
          </section>
        )}

        {/* Settings: nickname (group), mute, pin, chat background, search */}
        <section className="sk-profile-card sk-side-switches" data-profile-settings>
          {isGroup && (
            <div className="sk-setting-row" data-profile-nickname>
              <span className="sk-detail-icon"><Users size={15} /></span>
              <span className="sk-setting-label">{t('profile.myNickname')}</span>
              {editingNickname ? (
                <TextField className="sk-inline-edit sk-setting-input" value={nicknameDraft}
                  data-nickname-input autoFocus
                  placeholder={t('profile.myNicknamePlaceholder')}
                  onValueChange={setNicknameDraft}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveNickname();
                    if (e.key === 'Escape') setEditingNickname(false);
                  }}
                  onBlur={saveNickname} />
              ) : (
                <>
                  <span className="sk-setting-value">{conversation.myNickname || t('profile.myNicknameUnset')}</span>
                  <Button actionId="profile.edit-nickname" emphasis="quiet" density="compact"
                    label={t('common.edit')} onActivate={() => {
                      setNicknameDraft(conversation.myNickname ?? '');
                      setEditingNickname(true);
                    }} />
                </>
              )}
            </div>
          )}
          <div className="sk-setting-row">
            <span className="sk-detail-icon"><BellOff size={15} /></span>
            <span className="sk-setting-label">{t('profile.mute')}</span>
            <Switch checked={!!conversation.muted} aria-label={t('profile.mute')}
              data-profile-muted={conversation.muted ? 'true' : 'false'}
              onCheckedChange={onToggleMute} />
          </div>
          <div className="sk-setting-row">
            <span className="sk-detail-icon"><Pin size={15} /></span>
            <span className="sk-setting-label">{t('profile.pin')}</span>
            <Switch checked={!!conversation.pinned} aria-label={t('profile.pin')}
              data-profile-pinned={conversation.pinned ? 'true' : 'false'}
              onCheckedChange={onTogglePin} />
          </div>
        </section>

        {/* Marked for later — personal, this-device-only bookmarks */}
        {markedMessages.length > 0 && (
          <section className="sk-profile-card" data-profile-marked>
            <span className="sk-profile-card-title">
              {t('profile.markedMessages', { n: markedMessages.length })}
            </span>
            <div className="sk-profile-marked-list">
              {markedMessages.slice(0, 30).map(m => (
                <button key={m.id} type="button" className="sk-profile-marked-row"
                  data-marked-item={m.id}
                  onClick={() => onLocateMessage?.(m.id)}>
                  <Bookmark size={13} />
                  <span>{m.text.trim() || `[${m.kind ?? 'media'}]`}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Shared media & files — derived from real message attachments */}
        <section className="sk-profile-card" data-profile-media>
          <span className="sk-profile-card-title">{t('profile.media', { n: media.length })}</span>
          {media.length > 0 ? (
            <div className="sk-side-media sk-profile-media-grid">
              {media.slice(0, 6).map(item => (
                <button key={item.id} type="button" className="sk-side-thumb"
                  aria-label={item.name} data-shared-media={item.id}>
                  <img src={item.url} alt={item.name} />
                </button>
              ))}
            </div>
          ) : (
            <span className="sk-profile-empty"><ImageIcon size={13} /> {t('profile.noMedia')}</span>
          )}
          <span className="sk-profile-card-title sk-profile-files-title">{t('profile.files', { n: files.length })}</span>
          {files.length > 0 ? (
            <div className="sk-profile-files">
              {files.slice(0, 3).map(item => (
                <span key={item.id} className="sk-profile-file-row" data-shared-file={item.id}>
                  <FileIcon size={14} /> {item.name}
                </span>
              ))}
            </div>
          ) : (
            <span className="sk-profile-empty"><FileIcon size={13} /> {t('profile.noFiles')}</span>
          )}
        </section>

        {/* Incoming-call demos (1:1, prototype only) */}
        {conversation.kind === 'person' && onSimulateIncoming && (
          <section className="sk-profile-card sk-side-call-demo">
            <span className="sk-profile-card-title">{t('profile.callDemo')}</span>
            <div className="sk-side-call-demo-row">
              <Button emphasis="quiet" density="compact" leading={<Phone size={14} />} label={t('profile.callDemoAudio')}
                aria-label={t('profile.callDemoAudioAria')}
                actionId="chat.simulate-incoming-audio"
                onActivate={() => { onSimulateIncoming!('audio'); onClose(); }} />
              <Button emphasis="quiet" density="compact" leading={<Video size={14} />} label={t('profile.callDemoVideo')}
                aria-label={t('profile.callDemoVideoAria')}
                actionId="chat.simulate-incoming-video"
                onActivate={() => { onSimulateIncoming!('video'); onClose(); }} />
              <Button emphasis="quiet" density="compact" leading={<Smartphone size={14} />} label={t('profile.callDemoMulti')}
                aria-label={t('profile.callDemoMultiAria')}
                actionId="chat.simulate-incoming-multi"
                onActivate={() => { onSimulateIncoming!('audio', true); onClose(); }} />
            </div>
          </section>
        )}

        {/* Danger zone — groups dissolve (owner) or leave (other roles) */}
        <section className="sk-profile-card sk-profile-danger" data-profile-danger>
          <Button emphasis="quiet" tone="danger" className="sk-setting-row" actionId="profile.clear-history"
            leading={<span className="sk-detail-icon is-danger"><Eraser size={15} /></span>}
            label={t('profile.clearHistory')} onActivate={() => setDanger('clear')} />
          {isGroup ? (
            myRole === 'owner' ? (
              <Button emphasis="quiet" tone="danger" className="sk-setting-row is-danger"
                actionId="profile.dissolve-group"
                leading={<span className="sk-detail-icon is-danger"><Trash2 size={15} /></span>}
                label={t('profile.dissolveGroup')} onActivate={() => setDanger('dissolve')} />
            ) : (
              <Button emphasis="quiet" tone="danger" className="sk-setting-row is-danger"
                actionId="profile.leave-group"
                leading={<span className="sk-detail-icon is-danger"><LogOut size={15} /></span>}
                label={t('profile.leaveGroup')} onActivate={() => setDanger('leave')} />
            )
          ) : (
            <Button emphasis="quiet" tone="danger" className="sk-setting-row is-danger"
              actionId="profile.delete-conversation"
              leading={<span className="sk-detail-icon is-danger"><Trash2 size={15} /></span>}
              label={t('profile.deleteConversation')} onActivate={() => setDanger('delete')} />
          )}
        </section>
      </div>

      {/* Danger confirm (clear / delete / dissolve / leave) */}
      <Dialog open={danger !== null} onDismiss={() => setDanger(null)}
        title={dangerTitle} width={380} closeLabel={t('profile.cancel')}
        description={dangerBody}
        footer={
          <>
            <Button actionId="profile.confirm-cancel" emphasis="quiet" label={t('profile.cancel')}
              onActivate={() => setDanger(null)} />
            <Button actionId="profile.confirm-ok" emphasis="primary" tone="danger"
              label={dangerOk} onActivate={runDanger} />
          </>
        }>
        <span data-profile-confirm={danger ?? ''} />
      </Dialog>

      {/* Chat background */}
      <Dialog open={backgroundOpen} onDismiss={() => setBackgroundOpen(false)}
        title={t('profile.chatBackground')} width={420} closeLabel={t('common.close')}
        description={t('profile.backgroundDesc')}
        footer={
          <>
            <Button actionId="profile.bg-clear" emphasis="quiet" tone="danger" label={t('profile.clearBackground')}
              availability={(conversation.background && conversation.background !== 'default') || conversation.backgroundImage
                ? undefined : { kind: 'disabled', reason: t('profile.backgroundDefault') }}
              onActivate={() => onSetChatBackground('default', undefined)} />
            <Button actionId="profile.bg-done" emphasis="primary" label={t('common.done')}
              onActivate={() => setBackgroundOpen(false)} />
          </>
        }>
        <div className="sk-bg-picker" data-bg-picker>
          {CHAT_BACKGROUND_PRESETS.map(preset => (
            <Toggle key={preset.id} selected={conversation.background === preset.id}
              onSelectedChange={() => onSetChatBackground(preset.id, undefined)}
              className="sk-bg-swatch" actionId={`profile.bg-preset.${preset.id}`}
              aria-label={preset.id} data-bg-preset={preset.id}
              style={{ backgroundImage: preset.gradient }} />
          ))}
          <Button emphasis="quiet" className="sk-bg-upload" actionId="profile.bg-upload"
            leading={<ImageIcon size={15} />} label={t('profile.uploadBackground')}
            data-bg-upload onActivate={() => pickFile('background')} />
        </div>
      </Dialog>

      {/* Shared hidden file input for avatar/background uploads */}
      <input ref={fileInputRef} type="file" accept="image/*" hidden data-file-input
        onChange={e => { onFilePicked(e.target.files?.[0]); e.target.value = ''; }} />

      {/* Add members */}
      <Dialog open={addOpen} onDismiss={() => setAddOpen(false)}
        title={t('profile.addMember')} width={440} closeLabel={t('common.cancel')}
        description={t('profile.addMemberDesc')}
        footer={
          <>
            <Button actionId="profile.add-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setAddOpen(false)} />
            <Button actionId="profile.add-ok" emphasis="primary" label={t('common.create')}
              availability={addSelected.size > 0 ? undefined : { kind: 'disabled', reason: t('profile.addMemberEmpty') }}
              onActivate={submitAdded} />
          </>
        }>
        <div className="sk-member-manage" data-add-member-list>
          {addCandidates.length === 0 && <Empty description={t('profile.addMemberEmpty')} />}
          {addCandidates.map(candidate => (
            <label key={candidate.name} className="sk-member-manage-row" data-contact-name={candidate.name}>
              <Checkbox checked={addSelected.has(candidate.name)}
                onCheckedChange={() => setAddSelected(prev => {
                  const next = new Set(prev);
                  if (next.has(candidate.name)) next.delete(candidate.name); else next.add(candidate.name);
                  return next;
                })} />
              <Avatar name={candidate.name} background={candidate.tone} size={30}
                style={{ borderRadius: 9 }} />
              <span>{candidate.name}</span>
            </label>
          ))}
        </div>
      </Dialog>

      {/* Manage members */}
      <Dialog open={manageOpen} onDismiss={() => setManageOpen(false)}
        title={t('profile.manageMembers')} width={480} closeLabel={t('common.close')}
        footer={<Button actionId="profile.manage-done" emphasis="primary" label={t('common.done')}
          onActivate={() => setManageOpen(false)} />}>
        <div className="sk-member-manage" data-manage-member-list>
          {members.map(member => {
            const isSelf = member.name === VIEWER_NAME;
            const role = member.role ?? 'member';
            return (
              <div key={member.name} className="sk-member-manage-row" data-manage-member={member.name}
                data-manage-role={role}>
                <Avatar name={member.name} background={member.tone} size={30} style={{ borderRadius: 9 }} />
                <span className="sk-member-manage-name">
                  {isSelf && conversation.myNickname ? conversation.myNickname : member.name}
                </span>
                {role !== 'member' && <span className="sk-profile-role-tag" data-role={role}>{t(roleLabelKey(role))}</span>}
                {!isSelf && canManage && (
                  <span className="sk-member-manage-actions">
                    {myRole === 'owner' && (
                      <Button emphasis="quiet" density="compact"
                        actionId={`profile.member-role.${member.name}`}
                        label={role === 'admin' ? t('profile.demoteAdmin') : t('profile.promoteAdmin')}
                        onActivate={() => onSetGroupMemberRole(member.name, role === 'admin' ? 'member' : 'admin')} />
                    )}
                    {myRole === 'owner' && role !== 'owner' && (
                      <Button emphasis="quiet" density="compact" actionId={`profile.member-transfer.${member.name}`}
                        label={t('profile.transferOwner')}
                        onActivate={() => setMemberConfirm({ kind: 'transfer', member })} />
                    )}
                    <Button emphasis="quiet" density="compact" tone="danger"
                      actionId={`profile.member-remove.${member.name}`}
                      label={t('profile.removeMember')}
                      onActivate={() => setMemberConfirm({ kind: 'remove', member })} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Dialog>

      {/* Remove / transfer confirm */}
      <Dialog open={memberConfirm !== null} onDismiss={() => setMemberConfirm(null)}
        title={memberConfirm?.kind === 'transfer' ? t('profile.transferConfirmTitle') : t('profile.removeConfirmTitle')}
        width={400} closeLabel={t('common.cancel')}
        description={memberConfirm?.kind === 'transfer'
          ? t('profile.transferConfirmBody', { name: memberConfirm?.member.name ?? '' })
          : t('profile.removeConfirmBody', { name: memberConfirm?.member.name ?? '' })}
        footer={
          <>
            <Button actionId="profile.member-confirm-cancel" emphasis="quiet" label={t('common.cancel')}
              onActivate={() => setMemberConfirm(null)} />
            <Button actionId="profile.member-confirm-ok" emphasis="primary" tone="danger"
              label={memberConfirm?.kind === 'transfer' ? t('profile.transferOwner') : t('profile.removeMember')}
              onActivate={runMemberConfirm} />
          </>
        }>
        <span data-member-confirm={memberConfirm?.kind ?? ''} />
      </Dialog>
    </aside>
  );
}

/* ── Message search dialog ────────────────────────────── */

export function MessageSearchDialog({ open, messages, conversationName, onClose, onLocate }: {
  open: boolean;
  messages: ChatMessage[];
  conversationName: string;
  onClose: () => void;
  onLocate: (message: ChatMessage) => void;
}) {
  const { t } = useT();
  const [query, setQuery] = useState('');
  const results = useMemo(() => messages
    .filter(m => m.kind !== 'service')
    .filter(m => m.text.toLowerCase().includes(query.trim().toLowerCase())), [messages, query]);

  return (
    <Dialog open={open} onDismiss={onClose} title={t('ms.title', { name: conversationName })}
      width={460} closeLabel={t('common.close')}
      footer={<Button actionId="search-messages.close" emphasis="quiet" label={t('common.close')} onActivate={onClose} />}>
      <div className="sk-msg-search" data-message-search>
        <TextField className="sk-msg-search-input" aria-label={t('ms.aria')}
          placeholder={t('ms.placeholder')} value={query} onValueChange={setQuery}
          data-search-value={query} />
        <div className="sk-msg-search-list">
          {query.trim() && results.length === 0 && <Empty description={t('ms.empty')} />}
          {(!query.trim() ? messages.filter(m => m.kind !== 'service').slice(-5) : results).map(m => (
            <button key={m.id} type="button" className="sk-msg-search-row"
              data-message-id={m.id}
              onClick={() => { onLocate(m); onClose(); }}>
              <strong>{m.from === 'me' ? t('common.me') : (m.senderName ?? conversationName)}</strong>
              <span>{m.text}</span>
              <time>{m.at}</time>
            </button>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

/* ── Thread sheet ─────────────────────────────────────── */

export function ThreadSheet({ root, peerName, initialReplies, onClose, onReply }: {
  root: ChatMessage;
  peerName: string;
  initialReplies: ThreadReply[];
  onClose: () => void;
  onReply: (text: string) => void;
}) {
  const { t, locale } = useT();
  const [replies, setReplies] = useState<ThreadReply[]>(initialReplies);
  const [draft, setDraft] = useState('');
  const sheetRef = useRef<HTMLElement>(null);

  // Outside-scope press hides the thread sheet; the "查看话题" entry that
  // opens it is ignored so it acts as a plain toggle.
  useDismissOutside(sheetRef, true, onClose, '[data-thread-for]');

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const reply: ThreadReply = {
      id: `local-${Date.now()}`, from: 'me',
      at: new Date().toLocaleTimeString(locTag(locale), { hour: '2-digit', minute: '2-digit' }), text,
    };
    setReplies(list => [...list, reply]);
    setDraft('');
    onReply(text);
  };
  const onEnter = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    send();
  };

  return (
    <aside ref={sheetRef} className="sk-side-sheet sk-thread-sheet" aria-label={t('thread.aria')} data-thread-panel="true">
      <div className="sk-side-head">
        <strong>{t('thread.title', { n: replies.length })}</strong>
        <span className="sk-side-head-actions">
          <IconButton className="sk-side-head-action" iconId="close" iconSize={15} label={t('thread.close')} actionId="thread.close"
            emphasis="quiet" density="compact" onActivate={onClose} />
        </span>
      </div>
      <div className="sk-side-body">
        <div className="sk-thread-root">
          <strong>{root.from === 'me' ? t('common.me') : (root.senderName ?? peerName)}</strong>
          <p>{root.text}</p>
        </div>
        <div className="sk-thread-list">
          {replies.map(reply => (
            <div key={reply.id} className={`sk-thread-reply is-${reply.from}`}>
              {reply.from === 'peer' && <span className="sk-thread-who">{reply.senderName}</span>}
              <p>{reply.text}</p>
              <time>{reply.at}</time>
            </div>
          ))}
        </div>
      </div>
      <div className="sk-thread-composer">
        <TextArea framing="embedded" minimumRows={1} maximumRows={3} aria-label={t('thread.replyAria')}
          className="sk-thread-input" value={draft} onValueChange={setDraft}
          onEnter={onEnter} placeholder={t('thread.placeholder')} data-thread-draft={draft} />
        <IconButton iconId="send" iconSize={15} label={t('thread.send')} actionId="thread.send"
          emphasis="primary"
          availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: t('thread.sendDisabled') }}
          onActivate={send} />
      </div>
    </aside>
  );
}
