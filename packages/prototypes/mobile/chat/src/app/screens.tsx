/**
 * MobileApp screens — thin, stateless views derived from AppState.
 * Every screen receives `state` and `dispatch`; business rules live in
 * state.ts, entities in model.ts. Local component state is limited to the
 * composer text field of a thread (not committed until sent).
 */
import { useState, type ReactNode } from 'react';
import {
  Avatar, Badge, Button, Dialog, FilePicker, Icon, IconButton, ListRow, ListSection, Segmented,
  Select, Switch, Tag, TextArea, TextField,
} from '@peers-touch/ui';
import type { Action } from './state';
import type { AppState, Conversation, Group, Moment, Person, SearchHit } from './model';
import { AVATAR_PINE, currentStation, ME, messagesFor, PROFILE, SEED_PEOPLE } from './model';
import { ActionSheet, DetailHero, DetailShell, IdentityAvatar, SubHeader } from './primitives';

type Dispatch = (a: Action) => void;

function SearchTrigger({ placeholder, onOpen }: { placeholder: string; onOpen: () => void }) {
  // A read-only library TextField owns the field chrome; focus/click opens the
  // real search screen (iOS pattern), so no native control is hand-rolled.
  return (
    <TextField className="ma-search-trigger" aria-label={placeholder} placeholder={placeholder}
      value="" readOnly leading={<Icon iconId="search" size={16} />}
      onFocus={onOpen} onClick={onOpen} />
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
  // View-local scope, mirroring desktop's rail tab: the two segments live in
  // ONE messages surface; contacts never get their own bottom tab.
  const [pane, setPane] = useState<ChatPane>('chats');
  return (
    <div className="ma-page">
      <header className="ma-topbar ma-chats-topbar">
        <Segmented<ChatPane> label="消息范围" className="ma-chats-segmented"
          value={pane}
          options={[
            { value: 'chats', label: '消息' },
            { value: 'contacts', label: '联系人' },
          ]}
          onValueChange={value => setPane(value ?? 'chats')} />
        <IconButton actionId="ma.new-chat" iconId="plus" label="新会话" emphasis="quiet" iconSize={20}
          className="ma-chats-add"
          onActivate={() => dispatch({ type: 'newChat/open' })} />
      </header>
      <div className="ma-search">
        <SearchTrigger placeholder={pane === 'contacts' ? '搜索联系人、群聊' : '搜索会话、联系人、动态'}
          onOpen={() => dispatch({ type: 'search/open' })} />
      </div>
      {pane === 'chats' ? (
        <ul className="ma-flat-list">
          {state.conversations.map(c => (
            <li key={c.id}>
              <PressRow ariaLabel={c.name}
                onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', conversationId: c.id } })}
                icon={<IdentityAvatar name={c.name} size={46} tone={c.tone} online={c.online} group={c.group} />}
                label={<span className="ma-row-line">
                  <span className="ma-row-title">{c.name}</span>
                  <span className="ma-row-time">{c.time}</span>
                </span>}
                control={c.unread > 0 ? <Badge count={c.unread} /> : undefined}
                description={<span className="ma-row-sub">{c.preview}</span>} />
            </li>
          ))}
        </ul>
      ) : (
        <ContactsPane state={state} dispatch={dispatch} />
      )}
    </div>
  );
}

/* Contacts segment — same group/people catalog the desktop rail's contacts
   tab shows, composed inside the messages surface. */
function ContactsPane({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <>
      <section className="ma-group-block">
        <h3 className="ma-index">群聊 · {state.groups.length}</h3>
        <ul className="ma-flat-list">
          {state.groups.map(g => (
            <li key={g.id}><PressRow ariaLabel={g.name}
              onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'group', id: g.id } } })}
              icon={<IdentityAvatar name={g.name} size={44} tone={g.tone} group />}
              label={<span className="ma-row-title">{g.name}</span>}
              description={`${g.members} 位成员`}
              control={<Icon iconId="chevron-right" size={17} />} /></li>
          ))}
        </ul>
      </section>
      <section className="ma-group-block">
        <h3 className="ma-index">联系人 · {state.people.length}</h3>
        <ul className="ma-flat-list">
          {state.people.map(p => (
            <li key={p.id}><PressRow ariaLabel={p.name}
              onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'person', id: p.id } } })}
              icon={<IdentityAvatar name={p.name} size={44} tone={p.tone} online={p.online} />}
              label={<span className="ma-row-title">{p.name}</span>}
              description={p.role}
              control={<Icon iconId="chevron-right" size={17} />} /></li>
          ))}
        </ul>
      </section>
    </>
  );
}

/* ── Thread ───────────────────────────────────────────────────────────── */
export function ThreadScreen({ state, dispatch, conversation }: { state: AppState; dispatch: Dispatch; conversation: Conversation }) {
  const [draft, setDraft] = useState('');
  const messages = messagesFor(state, conversation.id);
  return (
    <div className="ma-page ma-thread">
      <SubHeader title={conversation.name} onBack={() => dispatch({ type: 'back' })} actions={<>
        <IconButton actionId="ma.call.audio" iconId="phone" label="语音通话" emphasis="quiet" iconSize={19}
          onActivate={() => dispatch({ type: 'call/start', conversationId: conversation.id, media: 'audio' })} />
        <IconButton actionId="ma.call.video" iconId="video" label="视频通话" emphasis="quiet" iconSize={20}
          onActivate={() => dispatch({ type: 'call/start', conversationId: conversation.id, media: 'video' })} />
        <IconButton actionId="ma.more" iconId="more-horizontal" label="更多" emphasis="quiet" iconSize={20} />
      </>} />
      <div className="ma-messages">
        {messages.map(m => (
          <div key={m.id} className={`ma-msg ${m.mine ? 'mine' : 'peer'}`}>
            {!m.mine && <Avatar name={conversation.name[0]} size={28} background={conversation.tone} />}
            <div className={`ma-bubble${m.file ? ' is-file' : ''}`}>
              {m.file ? (
                <span className="ma-file"><Icon iconId="file-text" size={20} />
                  <span><strong>{m.file.name}</strong><em>{m.file.size}</em></span></span>
              ) : m.text}
            </div>
          </div>
        ))}
        <div className="ma-msg peer"><Avatar name={conversation.name[0]} size={28} background={conversation.tone} /><div className="ma-bubble ma-typing"><i /><i /><i /></div></div>
      </div>
      <div className="ma-composer">
        <IconButton actionId="ma.attach" iconId="plus" label="添加" emphasis="quiet" iconSize={22} />
        <TextField aria-label="消息" placeholder="发消息…" value={draft} onChange={e => setDraft(e.target.value)} />
        <IconButton actionId="ma.send" iconId="send" label="发送" emphasis={draft ? 'primary' : 'quiet'} iconSize={20}
          availability={draft ? undefined : { kind: 'disabled', reason: '请输入内容' }}
          onActivate={() => { dispatch({ type: 'chat/send', conversationId: conversation.id, text: draft }); setDraft(''); }} />
      </div>
    </div>
  );
}

/* ── Moments ──────────────────────────────────────────────────────────── */
const MOMENT_MENU: { id: string; label: string; danger?: boolean }[] = [
  { id: 'share', label: '转发' },
  { id: 'not-interested', label: '不感兴趣' },
  { id: 'report', label: '举报', danger: true },
];

/* ── Agent (reserved slot; no mobile Agent surface yet) ─────────────────
   The tab position is real and navigable; the body is an honest placeholder,
   not a mocked assistant. Replace this screen when the mobile Agent lands. */
export function AgentReservedScreen() {
  return (
    <div className="ma-page ma-agent">
      <header className="ma-topbar"><h1>Agent</h1></header>
      <div className="ma-agent-reserved" data-agent-reserved>
        <span className="ma-agent-glyph" aria-hidden="true"><Icon iconId="bot" size={30} /></span>
        <strong>Agent 入口预留</strong>
        <p>手机端 Agent 尚未接入，这个位置已为它保留。</p>
      </div>
    </div>
  );
}

export function MomentsScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [feed, setFeed] = useState<'following' | 'nearby'>('following');
  return (
    <div className="ma-page">
      <header className="ma-topbar">
        <Segmented value={feed} onValueChange={v => setFeed(v as 'following' | 'nearby')}
          options={[{ value: 'following', label: '关注' }, { value: 'nearby', label: '附近' }]} />
        <IconButton actionId="ma.new-moment" iconId="camera" label="发动态" emphasis="quiet" iconSize={20} onActivate={() => dispatch({ type: 'composer/open' })} />
      </header>
      <ul className="ma-moments">
        {state.moments.map(m => <MomentCard key={m.id} moment={m} state={state} dispatch={dispatch} />)}
      </ul>

      <ActionSheet title="发动态" open={state.composerOpen} onClose={() => dispatch({ type: 'composer/close' })}>
        <div className="ma-composer-sheet">
          <TextArea aria-label="动态内容" value={state.composerDraft} onChange={e => dispatch({ type: 'composer/draft', value: e.target.value })}
            minimumRows={4} autoFocus placeholder="分享今天邻里间的一件小事…" characterCount maxLength={280} />
          <div className="ma-composer-audience">
            <span className="ma-composer-audience-label">可见范围</span>
            <Segmented value={state.composerAudience} onValueChange={v => dispatch({ type: 'composer/audience', audience: v as 'neighbors' | 'public' })}
              options={[{ value: 'neighbors', label: '仅邻居' }, { value: 'public', label: '附近公开' }]} />
          </div>
          <div className="ma-composer-foot">
            <Button actionId="ma.moment.cancel" emphasis="quiet" onActivate={() => dispatch({ type: 'composer/close' })}>取消</Button>
            <Button actionId="ma.moment.publish" emphasis="primary"
              availability={state.composerDraft.trim() ? undefined : { kind: 'disabled', reason: '写点内容再发布' }}
              onActivate={() => dispatch({ type: 'moment/publish', text: state.composerDraft })}>发布</Button>
          </div>
        </div>
      </ActionSheet>
    </div>
  );
}

function MomentCard({ moment, state, dispatch }: { moment: Moment; state: AppState; dispatch: Dispatch }) {
  const expanded = Boolean(state.expandedComments[moment.id]);
  const draft = state.commentDrafts[moment.id] ?? '';
  return (
    <li className="ma-moment">
      <div className="ma-moment-head">
        <Avatar name={moment.author[0]} size={38} background={moment.tone} />
        <span className="ma-moment-who"><strong>{moment.author}</strong><em>{moment.time}</em></span>
        <IconButton actionId={`ma.moment.more.${moment.id}`} iconId="more-horizontal" label="更多" emphasis="quiet" density="compact" iconSize={17}
          onActivate={() => dispatch({ type: 'moment/openMenu', id: state.openMomentMenu === moment.id ? null : moment.id })} />
      </div>
      {state.openMomentMenu === moment.id && (
        <div className="ma-inline-menu" role="menu">
          {MOMENT_MENU.map(item => (
            <Button key={item.id} actionId={`ma.moment.menu.${item.id}`} role="menuitem"
              emphasis="quiet" density="compact" tone={item.danger ? 'danger' : undefined}
              className={`ma-inline-menu-item${item.danger ? ' is-danger' : ''}`}
              onActivate={() => dispatch({ type: 'moment/openMenu', id: null })}>{item.label}</Button>
          ))}
        </div>
      )}
      <p className="ma-moment-text">{moment.text}</p>
      <div className="ma-moment-foot">
        <Button actionId={`ma.like.${moment.id}`} emphasis="quiet" density="compact" tone={moment.liked ? 'danger' : undefined}
          leading={<Icon iconId="heart" size={16} />} onActivate={() => dispatch({ type: 'moment/toggleLike', id: moment.id })}>{moment.likes}</Button>
        <Button actionId={`ma.comment.${moment.id}`} emphasis="quiet" density="compact" leading={<Icon iconId="message-circle" size={16} />}
          aria-expanded={expanded} onActivate={() => dispatch({ type: 'moment/toggleComments', id: moment.id })}>{moment.comments.length}</Button>
      </div>

      {/* Comments expand IN PLACE — a pushed comment page would be a prohibited enhanced chain. */}
      {expanded && (
        <div className="ma-comments" data-comments={moment.id}>
          {moment.comments.length === 0 && <p className="ma-comments-empty">还没有评论，说点什么。</p>}
          <ul className="ma-comments-list">
            {moment.comments.map(c => (
              <li key={c.id} className="ma-comment">
                <Avatar name={c.author[0]} size={28} background={c.tone} />
                <span className="ma-comment-body"><strong>{c.author}</strong><span>{c.text}</span><em>{c.time}</em></span>
              </li>
            ))}
          </ul>
          <div className="ma-comment-input">
            <TextField aria-label="写评论" placeholder="写评论…" value={draft} onChange={e => dispatch({ type: 'moment/commentDraft', id: moment.id, value: e.target.value })} />
            <IconButton actionId={`ma.comment.send.${moment.id}`} iconId="send" label="发送评论" emphasis={draft.trim() ? 'primary' : 'quiet'} iconSize={18}
              availability={draft.trim() ? undefined : { kind: 'disabled', reason: '请输入评论' }}
              onActivate={() => dispatch({ type: 'moment/addComment', id: moment.id, text: draft })} />
          </div>
        </div>
      )}
    </li>
  );
}

/* ── Contact / group detail ───────────────────────────────────────────── */
function NavRow({ label, description, onActivate }: { label: string; description?: string; onActivate: () => void }) {
  return (
    <ListRow label={label} description={description} role="button" tabIndex={0} onClick={onActivate}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); } }}
      control={<Icon iconId="chevron-right" size={17} />} />
  );
}

export function ContactDetailScreen({ person, state, dispatch }: { person: Person; state: AppState; dispatch: Dispatch }) {
  return (
    <DetailShell title="联系人" onBack={() => dispatch({ type: 'back' })}>
      <DetailHero name={person.name} meta={person.role} tone={person.tone} />
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
    </DetailShell>
  );
}

export function GroupDetailScreen({ group, dispatch }: { group: Group; state: AppState; dispatch: Dispatch }) {
  const previewMembers = SEED_PEOPLE.slice(0, 4);
  return (
    <DetailShell title="群聊" onBack={() => dispatch({ type: 'back' })} action={<IconButton actionId="ma.group.more" iconId="more-horizontal" label="更多" emphasis="quiet" iconSize={20} />}>
      <DetailHero name={group.name} meta={`${group.members} 位成员`} tone={group.tone} group />
      <div className="ma-detail-actions">
        <span className="ma-detail-primary">
          <Button actionId="ma.group.message" emphasis="primary" fullWidth leading={<Icon iconId="message-circle" size={17} />}
            onActivate={() => dispatch({ type: 'navigate', route: { tab: 'chats', conversationId: `group-${group.id}` } })}>发消息</Button>
        </span>
      </div>
      <section className="ma-group-block ma-detail-list">
        <h3 className="ma-index">成员 · {group.members}</h3>
        <ul className="ma-flat-list">
          {previewMembers.map(p => {
            return (
              <li key={p.id}><PressRow ariaLabel={p.name}
                onClick={() => dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'person', id: p.id } } })}
                icon={<IdentityAvatar name={p.name} size={40} tone={p.tone} online={p.online} />}
                label={<span className="ma-row-title">{p.name}</span>}
                description={p.role}
                control={<Icon iconId="chevron-right" size={16} />} /></li>
            );
          })}
          <li><PressRow ariaLabel="添加成员" onClick={() => undefined}
            icon={<span className="ma-add-icon"><Icon iconId="user-plus" size={18} /></span>}
            label={<span className="ma-row-title">添加成员</span>} /></li>
        </ul>
      </section>
    </DetailShell>
  );
}

/* ── Me / settings ────────────────────────────────────────────────────── */
export function MeScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const s = state.settings;
  const station = currentStation(state);
  const [avatar, setAvatar] = useState('');
  const [banner, setBanner] = useState('');
  const [signOutOpen, setSignOutOpen] = useState(false);
  const readBanner = (files: readonly File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setBanner(String(reader.result));
    reader.readAsDataURL(file);
  };
  const readAvatar = (files: readonly File[]) => {
    const file = files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setAvatar(String(reader.result));
    reader.readAsDataURL(file);
  };
  return (
    <div className="ma-page ma-me">
      {/* Identity — desktop Settings › Identity parity: banner, avatar on its
          lower edge with a card ring, tags, stats, and copyable identity.
          Change affordances are small translucent overlay icons — identity
          content owns the visual weight (owner view, no competing chrome). */}
      <header className="ma-profile" data-me-profile>
        <div className="ma-profile-banner" data-has-image={banner ? 'true' : 'false'}>
          {banner && <img src={banner} alt="" />}
          <span className="ma-profile-banner-action">
            <FilePicker iconOnly iconId="image" accept="image/*" label="更换头图" onFiles={readBanner} />
          </span>
        </div>
        <div className="ma-profile-body">
          <div className="ma-profile-id">
            <div className="ma-profile-avatar">
              <Avatar name={ME.name} source={avatar || undefined} size={72} background={ME.tone}
                style={{
                  borderRadius: 20,
                  boxShadow: '0 0 0 3px var(--pt-surface), 0 4px 12px rgba(15,23,42,.16)',
                }} />
              <span className="ma-profile-avatar-action">
                <FilePicker iconOnly iconId="camera" accept="image/*" label="更换头像" onFiles={readAvatar} />
              </span>
            </div>
            <div className="ma-profile-meta">
              <div className="ma-profile-names">
                <strong>{ME.name}</strong>
                <Tag tone="info">{PROFILE.username}</Tag>
                <Tag>{PROFILE.localTag}</Tag>
              </div>
              <div className="ma-profile-stats">
                <span><strong>{PROFILE.posts}</strong>动态</span>
                <span><strong>{PROFILE.follows}</strong>关注</span>
                <span><strong>{PROFILE.followers}</strong>粉丝</span>
                <em className="ma-profile-joined">{PROFILE.joined} 加入</em>
              </div>
            </div>
          </div>
          <div className="ma-profile-fields">
            <div className="ma-profile-field">
              <span>首选用户名</span>
              <code>{PROFILE.username}</code>
              <span className="ma-profile-copy">
                <IconButton iconId="copy" iconSize={13} density="compact" emphasis="quiet"
                  actionId="me.copy-username" label="复制用户名"
                  onActivate={() => { void navigator.clipboard?.writeText(PROFILE.username.slice(1)); }} />
              </span>
            </div>
            <div className="ma-profile-field">
              <span>所属站点</span>
              <code>{station.name}</code>
            </div>
            <div className="ma-profile-field">
              <span>PTID</span>
              <code>{PROFILE.ptid}</code>
              <span className="ma-profile-copy">
                <IconButton iconId="copy" iconSize={13} density="compact" emphasis="quiet"
                  actionId="me.copy-ptid" label="复制 PTID"
                  onActivate={() => { void navigator.clipboard?.writeText(PROFILE.ptid); }} />
              </span>
            </div>
          </div>
        </div>
      </header>
      <ListSection className="ma-settings" title="通知与隐私" description="这些默认只影响本机与本站。">
        <ListRow label="消息通知" description="在本机通道接收提醒。" control={<Switch checked={s.notify} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'notify', value: v })} aria-label="消息通知" />} />
        <ListRow label="提示音" control={<Switch checked={s.sound} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'sound', value: v })} aria-label="提示音" />} />
        <ListRow label="已读回执" control={<Switch checked={s.readReceipt} onCheckedChange={v => dispatch({ type: 'setting/set', key: 'readReceipt', value: v })} aria-label="已读回执" />} />
        <ListRow label="自动锁定" control={<Select appearance="ghost" aria-label="自动锁定" value={s.autoLock} onValueChange={v => dispatch({ type: 'setting/set', key: 'autoLock', value: String(v) })}
          options={[{ value: '1m', label: '1 分钟后' }, { value: '5m', label: '5 分钟后' }, { value: 'never', label: '永不' }]} />} />
      </ListSection>
      <ListSection className="ma-settings" title="网络与站点">
        <NavRow label="当前站点"
          description={`${station.name} · ${station.online ? '已连接' : '离线'} · 可切换或添加站点`}
          onActivate={() => dispatch({ type: 'navigate', route: { tab: 'me', setting: 'station' } })} />
        <ListRow label="端到端加密" control={<span className="ma-ok">已开启</span>} />
      </ListSection>
      <ListSection className="ma-settings" title="通用">
        <ListRow label="界面语言" control={<Select appearance="ghost" aria-label="界面语言" value={s.language} onValueChange={v => dispatch({ type: 'setting/set', key: 'language', value: String(v) })}
          options={[{ value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' }]} />} />
        <NavRow label="关于 Peers Touch" onActivate={() => dispatch({ type: 'navigate', route: { tab: 'me', setting: 'about' } })} />
      </ListSection>

      <div className="ma-settings ma-signout">
        <Button actionId="me.signout" tone="danger" emphasis="secondary" fullWidth
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

/** Signed-out gate — honest local auth state: the app is replaced by this
    surface until the user signs back in. */
export function SignedOutScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const station = currentStation(state);
  return (
    <div className="ma-page ma-signedout" data-signed-out>
      <span className="ma-signedout-glyph"><Icon iconId="lock" size={30} /></span>
      <h1>{ME.name}</h1>
      <p>{PROFILE.username} · {station.name}</p>
      <p className="ma-signedout-note">已退出登录 · 会话数据保留在本机</p>
      <Button actionId="auth.signin" emphasis="primary" fullWidth
        leading={<Icon iconId="log-out" size={16} />}
        onActivate={() => dispatch({ type: 'auth/signIn' })}>
        重新登录
      </Button>
    </div>
  );
}

export function StationScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const station = currentStation(state);
  const submit = () => {
    if (!name.trim()) return;
    dispatch({ type: 'station/add', name, handle });
    setAddOpen(false);
    setName('');
    setHandle('');
  };
  return (
    <DetailShell title="站点" onBack={() => dispatch({ type: 'back' })}>
      <ListSection className="ma-settings" title="我的站点"
        description={`当前连接：${station.name}。切换后离线消息继续暂存在原站点，上线后投递。`}>
        {state.stations.map(st => (
          <ListRow key={st.id} onClick={() => dispatch({ type: 'station/select', id: st.id })} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dispatch({ type: 'station/select', id: st.id }); } }}
            label={<span className="ma-station-name">{st.name}{!st.online && <Tag tone="neutral">离线</Tag>}</span>}
            description={st.handle}
            control={state.currentStationId === st.id ? <Icon iconId="check" size={18} /> : <span className="ma-station-dot" data-online={st.online || undefined} />} />
        ))}
      </ListSection>
      <div className="ma-settings ma-danger-zone">
        <Button actionId="ma.station.add" emphasis="secondary" fullWidth leading={<Icon iconId="plus" size={16} />}
          onActivate={() => setAddOpen(true)}>添加站点</Button>
      </div>

      <Dialog open={addOpen} title="添加站点" description="输入站点名称与地址；添加后会立即连接并切为当前站点。"
        onDismiss={() => setAddOpen(false)}
        footer={
          <>
            <Button actionId="ma.station.add.cancel" emphasis="quiet" label="取消" onActivate={() => setAddOpen(false)} />
            <Button actionId="ma.station.add.confirm" emphasis="primary" label="添加并连接"
              availability={name.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入站点名称' }}
              onActivate={submit} />
          </>
        }>
        <div className="ma-station-form">
          <TextField aria-label="站点名称" placeholder="如：河边书架站" value={name}
            onValueChange={setName} onEnter={event => { event.preventDefault(); submit(); }} />
          <TextField aria-label="站点地址" placeholder="如：hebian.local · 两跳外（可选）" value={handle}
            onValueChange={setHandle} onEnter={event => { event.preventDefault(); submit(); }} />
        </div>
      </Dialog>
    </DetailShell>
  );
}

export function AboutScreen({ dispatch }: { state: AppState; dispatch: Dispatch }) {
  return (
    <DetailShell title="关于" onBack={() => dispatch({ type: 'back' })}>
      <DetailHero name="Peers Touch" meta="去中心化邻里网络 · 原型" tone={AVATAR_PINE} />
      <ListSection className="ma-settings" title="版本">
        <ListRow label="客户端" control={<span className="ma-version">0.1.0 · pine</span>} />
        <NavRow label="开源许可" onActivate={() => undefined} />
        <NavRow label="隐私与安全白皮书" onActivate={() => undefined} />
      </ListSection>
    </DetailShell>
  );
}

/* ── Global search ────────────────────────────────────────────────────── */
type SearchScope = 'all' | 'chats' | 'people' | 'moments';

export function buildSearchHits(state: AppState, scope: SearchScope, query: string): SearchHit[] {
  const q = query.trim();
  const match = (text: string) => !q || text.includes(q);
  const hits: SearchHit[] = [];
  if (scope === 'all' || scope === 'chats') {
    state.conversations.forEach(c => { if (match(c.name) || match(c.preview)) hits.push({ kind: 'conversation', id: c.id, title: c.name, sub: c.preview, tone: c.tone, group: c.group, online: c.online }); });
  }
  if (scope === 'all' || scope === 'people') {
    state.groups.forEach(g => { if (match(g.name)) hits.push({ kind: 'group', id: g.id, title: g.name, sub: `${g.members} 位成员`, tone: g.tone, group: true }); });
    state.people.forEach(p => { if (match(p.name) || match(p.role)) hits.push({ kind: 'person', id: p.id, title: p.name, sub: p.role, tone: p.tone, online: p.online }); });
  }
  if (scope === 'all' || scope === 'moments') {
    state.moments.forEach(m => { if (match(m.author) || match(m.text)) hits.push({ kind: 'moment', id: m.id, title: m.author, sub: m.text, tone: m.tone }); });
  }
  return hits;
}

const SEARCH_SECTIONS: { kind: SearchHit['kind']; label: string }[] = [
  { kind: 'conversation', label: '会话' },
  { kind: 'group', label: '群聊' },
  { kind: 'person', label: '联系人' },
  { kind: 'moment', label: '动态' },
];

export function SearchScreen({ state, dispatch }: { state: AppState; dispatch: Dispatch }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SearchScope>('all');
  const hits = buildSearchHits(state, scope, query);

  const choose = (hit: SearchHit) => {
    if (hit.kind === 'conversation') dispatch({ type: 'navigate', route: { tab: 'chats', conversationId: hit.id } });
    else if (hit.kind === 'person') dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'person', id: hit.id } } });
    else if (hit.kind === 'group') dispatch({ type: 'navigate', route: { tab: 'chats', contactDetail: { kind: 'group', id: hit.id } } });
    else dispatch({ type: 'tab', tab: 'moments' });
  };

  return (
    <div className="ma-page ma-search-page" data-search-page>
      <SubHeader title="搜索" onBack={() => dispatch({ type: 'search/close' })} />
      <div className="ma-search-input">
        <TextField aria-label="搜索" placeholder="搜索会话、联系人、动态" autoFocus clearable value={query} onValueChange={setQuery} onClear={() => setQuery('')} leading={<Icon iconId="search" size={16} />} />
      </div>
      <div className="ma-search-scope">
        <Segmented fullWidth value={scope} onValueChange={v => setScope(v as SearchScope)} options={[
          { value: 'all', label: '全部' }, { value: 'chats', label: '会话' }, { value: 'people', label: '联系人' }, { value: 'moments', label: '动态' },
        ]} />
      </div>
      <div className="ma-search-results">
        {hits.length === 0
          ? <div className="ma-search-empty">{query.trim() ? '没有匹配的结果' : '输入关键词，搜索会话、联系人与动态'}</div>
          : SEARCH_SECTIONS.map(section => {
            const rows = hits.filter(h => h.kind === section.kind);
            if (!rows.length) return null;
            return (
              <section key={section.kind} className="ma-group-block">
                <h3 className="ma-index">{section.label} · {rows.length}</h3>
                <ul className="ma-flat-list">
                  {rows.map(h => (
                    <li key={`${h.kind}-${h.id}`}><PressRow ariaLabel={h.title} onClick={() => choose(h)}
                      icon={<IdentityAvatar name={h.title} size={42} tone={h.tone} online={h.online} group={h.group} />}
                      label={<span className="ma-row-title">{h.title}</span>}
                      description={<span className="ma-search-sub">{h.sub}</span>}
                      control={<Icon iconId="chevron-right" size={16} />} /></li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </div>
  );
}
