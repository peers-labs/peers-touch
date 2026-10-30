/**
 * DesignDirections — the Peers Touch desktop-prototype NORTH STAR.
 *
 * One real app window frame (60px icon rail + workbench). Components are
 * built and trained ONE AT A TIME here before promotion into peers-ui:
 * product boundary → six-dimension/state contract → specimen → probe gate
 * → human verdict → token/knowledge. No speculative Peers-unrelated
 * business screens live in the frame.
 *
 * Current component under training: SearchField.
 *
 * Skins are CSS-variable token sets (data-skin); wallpapers are a second
 * independent dimension. Draft values; nothing is promoted until accepted.
 */
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type KeyboardEvent } from 'react';
import {
  Search, MessageCircle, Sparkles, Bell, Settings,
  Upload, ImageIcon, X, UserPlus, MessagesSquare,
  type LucideIcon,
} from 'lucide-react';
import { Avatar, Badge, Button, Dialog, Empty, IconButton, TextArea, UIProvider } from '@peers-touch/ui';
import { MomentsFeature } from './moments/MomentsFeature';
import './design-directions.css';

type Skin = { id: string; name: string; desc: string };

/* UIProvider injects its own --pt-* tokens inline on the same root; pass this
   bridge via style (which merges after them) so peers-ui components follow the
   active skin both in the frame and in portaled overlays. */
const PT_BRIDGE = {
  '--pt-primary': 'var(--sk-primary)',
  '--pt-onPrimary': 'var(--sk-primary-ink)',
  '--pt-text': 'var(--sk-text)',
  '--pt-text-secondary': 'var(--sk-text-2)',
  '--pt-text-tertiary': 'var(--sk-text-3)',
  '--pt-surface': 'var(--sk-raised)',
  '--pt-subtle': 'var(--sk-tile)',
  '--pt-radius-md': 'var(--sk-avatar-radius)',
  '--pt-focus-ring': 'var(--sk-focus-ring)',
} as CSSProperties;

const SKINS: Skin[] = [
  { id: 'default', name: '当前默认', desc: '现有产品基线，用于对照' },
  { id: 'warm', name: '亲密 · 暖（候选）', desc: '朋友圈式温暖 · 暖米白纸感 · 暖墨 · 柔和强调' },
  {
    id: 'glass',
    name: '松绿 · 北极星',
    desc: '北极星语法 · 松绿玻璃 · 近黑胶囊 · 单琥珀强调 · 大数值，desktop 原型在此上演进',
  },
];

const WALLPAPERS: { id: string; name: string; value: string }[] = [
  { id: 'none', name: '无背景', value: 'none' },
  { id: 'dusk', name: '暮色', value: 'linear-gradient(135deg,#f6d8b8,#e7a98e 45%,#b08bb8)' },
  { id: 'mint', name: '青野', value: 'linear-gradient(135deg,#cdeede,#a7d7cf 50%,#bcd0f2)' },
  { id: 'night', name: '夜航', value: 'radial-gradient(120% 120% at 20% 0%,#3a4a63,#1c2536 70%)' },
];

type RailTab = 'moments' | 'search' | 'chat';
const RAIL_NAV: { icon: LucideIcon; key: RailTab; label: string }[] = [
  { icon: Search, key: 'search', label: '搜索' },
  { icon: MessageCircle, key: 'chat', label: '消息' },
  { icon: Sparkles, key: 'moments', label: '动态' },
];

/* SearchField — the first component trained in the frame.
   Spec: docs/.../components/search-field.md. The specimen is a plain styled
   host (rounded-square, token-painted) wrapping a borderless native input;
   keyboard focus is shown on the rounded host, never a square UA outline. */
function SearchField({
  value, defaultValue = '', placeholder, disabled = false, onValueChange,
}: {
  value?: string;
  defaultValue?: string;
  placeholder: string;
  disabled?: boolean;
  onValueChange?: (next: string) => void;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const controlled = value !== undefined;
  const current = controlled ? value : internal;
  const setValue = (next: string) => {
    if (!controlled) setInternal(next);
    onValueChange?.(next);
  };
  return (
    <label className={`sf-field${disabled ? ' is-disabled' : ''}`} data-state={current ? 'filled' : 'empty'}>
      <Search size={15} className="sf-leading" aria-hidden="true" />
      <input
        type="search"
        value={current}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={placeholder}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
      />
      {current && !disabled && (
        <button type="button" className="sf-clear" aria-label="清除搜索" onClick={() => setValue('')}>
          <X size={13} />
        </button>
      )}
    </label>
  );
}

const SEARCHFIELD_STATES: { id: string; name: string; expect: string }[] = [
  { id: 'empty', name: '默认 · 空', expect: '前导搜索图标 + placeholder，松绿填充砖，无描边' },
  { id: 'focus', name: '聚焦', expect: '焦点环画在圆角宿主上（2px），内嵌 input 无方形 outline' },
  { id: 'filled', name: '输入中', expect: '右侧出现清除按钮，点击清空并把焦点还给输入框' },
  { id: 'disabled', name: '禁用', expect: '降低不透明度，不可聚焦，不出现清除按钮' },
  { id: 'long', name: '长占位', expect: '超长文本省略号截断，不撑破宿主、无横向溢出' },
];

/* Increment 1 — ConversationRail (chat/social), composed from peers-ui.
   Real desktop source: pages/SocialChatPage.tsx. AI chat is explicitly out
   of scope. Fixtures are local; no station/runtime wiring. */
type Conversation = {
  id: string; name: string; last: string; unread: number; tone: string; kind: 'person' | 'group';
};
const CONVERSATIONS: Conversation[] = [
  { id: 'cv-chenyu', name: '陈屿', last: '[图片]', unread: 1, tone: '#3f6550', kind: 'person' },
  { id: 'cv-qun', name: '小区生活群', last: '周禾：周末书架见', unread: 0, tone: '#a1824b', kind: 'group' },
  { id: 'cv-linwan', name: '林晚', last: '诗集散会我帮你留了位置', unread: 2, tone: '#4a6170', kind: 'person' },
  { id: 'cv-suhe', name: '苏禾', last: '薄荷分盆成功了，谢谢你', unread: 0, tone: '#5d5a44', kind: 'person' },
  { id: 'cv-zhouhe', name: '周禾', last: '共享书架今日开放', unread: 0, tone: '#3f6550', kind: 'person' },
  { id: 'cv-linnan', name: 'lin · 连南', last: '两跳外的连接已建立', unread: 0, tone: '#4a6170', kind: 'person' },
  { id: 'cv-seed', name: '种子交换群', last: '本周日种子交换，记得来', unread: 0, tone: '#a1824b', kind: 'group' },
  { id: 'cv-ops', name: '联邦运维', last: '关注站点已可互发动态', unread: 0, tone: '#6f8fa6', kind: 'group' },
];

function ConversationRail({
  conversations, selectedId, onSelect, onNew,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = conversations.filter(c =>
    `${c.name} ${c.last}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <aside className="sk-conv-rail" aria-label="会话列表">
      <div className="sk-conv-search">
        <SearchField value={query} onValueChange={setQuery} placeholder="搜索联系人、站点" />
      </div>
      <div className="sk-conv-new">
        <Button actionId="sk.new-conversation" emphasis="primary" fullWidth
          leading={<UserPlus size={15} />} label="新建会话" onActivate={onNew} />
      </div>
      <h2 className="sk-conv-title">最近对话{query ? ` · 筛选“${query}”` : ''}</h2>
      <ul className="sk-conv-list">
        {filtered.map(c => (
          <li key={c.id}>
            <button type="button"
              className={`sk-conv-row${selectedId === c.id ? ' is-selected' : ''}`}
              aria-current={selectedId === c.id ? 'true' : undefined}
              onClick={() => onSelect(c.id)}>
              <Badge count={c.unread} label={`${c.unread} 条未读`}>
                <Avatar name={c.name} background={c.tone} size={38}
                  style={{ borderRadius: 'var(--sk-avatar-radius)' }}
                  aria-label={c.kind === 'group' ? `群 ${c.name}` : c.name} />
              </Badge>
              <span className="sk-conv-meta">
                <strong>{c.name}</strong>
                <span>{c.last}</span>
              </span>
            </button>
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="sk-conv-empty">
            <Empty description="没有匹配的会话" />
          </li>
        )}
      </ul>
    </aside>
  );
}

/* Increment 2 — ConversationView: message stream + composer, composed from
   peers-ui. Calls/attachments/thread/detail panels from the legacy
   SocialChatPage are explicitly deferred; this is human 1:1/group text only. */
type ChatMessage = { id: string; from: 'me' | 'peer'; text: string; at: string };

const SEED_MESSAGES: Record<string, ChatMessage[]> = {
  'cv-chenyu': [
    { id: 'm1', from: 'peer', text: '周末种子交换你要来吗？我带了上次说的番茄籽。', at: '09:21' },
    { id: 'm2', from: 'me', text: '来，我把薄荷分一盆给你。', at: '09:24' },
    { id: 'm3', from: 'peer', text: '[图片]', at: '09:25' },
  ],
  'cv-qun': [
    { id: 'm1', from: 'peer', text: '周禾：周末书架见，记得带想交换的书。', at: '昨天' },
  ],
  'cv-linwan': [
    { id: 'm1', from: 'peer', text: '诗集散会我帮你留了位置。', at: '08:40' },
  ],
};

function ConversationView({ conversation, messages, onSend }: {
  conversation: Conversation;
  messages: ChatMessage[];
  onSend: (text: string) => void;
}) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, conversation.id]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
  };
  const onEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    send();
  };

  return (
    <section className="sk-conv-view" aria-label={`与 ${conversation.name} 的对话`}>
      <div className="sk-msg-stream" ref={scrollRef}>
        {messages.map(m => (
          <div key={m.id} className={`sk-msg sk-msg-${m.from}`}>
            {m.from === 'peer' && (
              <Avatar name={conversation.name} background={conversation.tone} size={32}
                className="sk-msg-avatar" style={{ borderRadius: 'var(--sk-avatar-radius)' }} />
            )}
            <div className="sk-msg-bubble">
              <p>{m.text}</p>
              <time>{m.at}</time>
            </div>
          </div>
        ))}
      </div>
      <div className="sk-composer">
        <TextArea framing="embedded" minimumRows={1} maximumRows={4}
          className="sk-composer-input" value={draft} aria-label="输入消息"
          data-composer-value={draft}
          placeholder={`发消息给 ${conversation.name}`}
          onValueChange={setDraft} onEnter={onEnter} />
        <IconButton iconId="send" iconSize={16} label="发送消息"
          actionId="sk.send-message" emphasis="primary"
          availability={draft.trim() ? { kind: 'enabled' } : { kind: 'disabled', reason: '请输入消息' }}
          onActivate={send} />
      </div>
    </section>
  );
}

/* Increment 3 — start conversation / contact picker (peers-ui Dialog). */
const EXTRA_PEOPLE: Conversation[] = [
  { id: 'cv-ayan', name: '阿砚', last: '还没聊过', unread: 0, tone: '#7a6a92', kind: 'person' },
  { id: 'cv-laozhou', name: '老周', last: '还没聊过', unread: 0, tone: '#8a7a55', kind: 'person' },
];

function ContactPickerDialog({ open, people, existingIds, onDismiss, onPick }: {
  open: boolean;
  people: Conversation[];
  existingIds: Set<string>;
  onDismiss: () => void;
  onPick: (person: Conversation) => void;
}) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (open) setQuery(''); }, [open]);
  const filtered = people.filter(p => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Dialog open={open} onDismiss={onDismiss} title="新建会话"
      description="选择一位联系人开始对话（本地示例）" width={420}
      closeLabel="关闭"
      footer={<Button actionId="sk.picker-cancel" emphasis="quiet" label="取消" onActivate={onDismiss} />}>
      <div className="sk-picker">
        <SearchField value={query} onValueChange={setQuery} placeholder="搜索联系人" />
        <ul className="sk-picker-list">
          {filtered.map(p => (
            <li key={p.id}>
              <button type="button" className="sk-picker-row" onClick={() => onPick(p)}>
                <Avatar name={p.name} background={p.tone} size={36}
                  style={{ borderRadius: 'var(--sk-avatar-radius)' }} aria-label={p.name} />
                <span className="sk-conv-meta">
                  <strong>{p.name}</strong>
                  <span>{existingIds.has(p.id) ? '最近对话' : '新联系人'}</span>
                </span>
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li className="sk-conv-empty"><Empty description="没有匹配的联系人" /></li>
          )}
        </ul>
      </div>
    </Dialog>
  );
}

export function DesignDirections() {
  const [skinId, setSkinId] = useState('glass');
  const [wallpaper, setWallpaper] = useState<string>('none');
  const [wallName, setWallName] = useState<string>('无背景');
  const [railTab, setRailTab] = useState<RailTab>('search');
  const [liveQuery, setLiveQuery] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>(CONVERSATIONS);
  const [selectedConv, setSelectedConv] = useState<string | null>(null);
  const [messagesByConv, setMessagesByConv] = useState<Record<string, ChatMessage[]>>(SEED_MESSAGES);
  const [pickerOpen, setPickerOpen] = useState(false);

  const selectedConversation = conversations.find(c => c.id === selectedConv) ?? null;

  const openConversation = (id: string) => {
    setRailTab('chat');
    setSelectedConv(id);
    setConversations(list => list.map(c => (c.id === id ? { ...c, unread: 0 } : c)));
  };
  const newConversation = () => {
    setRailTab('chat');
    setSelectedConv(null);
    setPickerOpen(true);
  };
  const pickPerson = (person: Conversation) => {
    setPickerOpen(false);
    setConversations(list => (list.some(c => c.id === person.id)
      ? list
      : [person, ...list]));
    openConversation(person.id);
  };
  const sendMessage = (text: string) => {
    if (!selectedConv) return;
    const now = new Date();
    const at = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const msg: ChatMessage = {
      id: `local-${Date.now()}`, from: 'me', text, at,
    };
    setMessagesByConv(map => ({ ...map, [selectedConv]: [...(map[selectedConv] ?? []), msg] }));
  };
  const isChat = railTab === 'chat';

  const skin = SKINS.find(s => s.id === skinId) ?? SKINS[0];
  const peoplePool = [...EXTRA_PEOPLE, ...conversations];
  const existingIds = new Set(conversations.map(c => c.id));

  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setWallpaper(`center / cover no-repeat url("${String(reader.result)}")`);
      setWallName(file.name.slice(0, 18));
    };
    reader.readAsDataURL(file);
  };

  const noWallpaper = wallpaper === 'none';
  const shellStyle = {
    '--sk-wallpaper': noWallpaper ? 'none' : wallpaper,
    '--sk-shell-glow': noWallpaper ? 'none' : undefined,
  } as CSSProperties;

  return (
    <div className="sk-page">
      <div className="sk-switcher">
        <div className="sk-switcher-label">
          <strong>界面皮肤 · 桌面原型北极星</strong>
          <span>配色 / 材质 · 只作用于窗框内部，外部不变 · 组件逐个训练，元素集随之沉淀</span>
        </div>
        <div className="sk-tabs" role="tablist" aria-label="界面皮肤">
          {SKINS.map(s => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === skinId}
              className={`sk-tab${s.id === skinId ? ' is-active' : ''}`}
              onClick={() => setSkinId(s.id)}>{s.name}</button>
          ))}
        </div>

        <div className="sk-wall">
          <span className="sk-wall-label"><ImageIcon size={13} /> 自定义背景（QQ 皮肤玩法）</span>
          <div className="sk-wall-presets">
            {WALLPAPERS.map(w => (
              <button key={w.id} type="button"
                className={`sk-wall-chip${wallName === w.name ? ' is-active' : ''}`}
                onClick={() => { setWallpaper(w.value); setWallName(w.name); }}>{w.name}</button>
            ))}
          </div>
          <label className="sk-wall-upload">
            <Upload size={13} /> 上传图片
            <input type="file" accept="image/*" onChange={onUpload} hidden />
          </label>
          <span className="sk-wall-current">{wallName}</span>
        </div>

        <p className="sk-skin-desc">{skin.desc}</p>
      </div>

      <UIProvider theme="light" className={`sk-theme sk-skin-${skinId}`} style={PT_BRIDGE}>
      <div className="sk-shell"
        data-wallpaper={noWallpaper ? 'none' : 'image'} style={shellStyle}>
        <div className="sk-shell-bg" aria-hidden="true">
          <div className="sk-shell-glow" />
          <div className="sk-shell-wall" />
        </div>

        <nav className="sk-rail" aria-label="主导航">
          <div className="sk-rail-avatar">林</div>
          <div className="sk-rail-group">
            {RAIL_NAV.map(n => {
              const Icon = n.icon;
              return (
                <button key={n.key} type="button" className={`sk-rail-icon${railTab === n.key ? ' is-active' : ''}`}
                  aria-label={n.label} aria-current={railTab === n.key ? 'page' : undefined}
                  onClick={() => setRailTab(n.key)}>
                  <Icon size={19} strokeWidth={1.7} />
                </button>
              );
            })}
          </div>
          <span className="sk-rail-spacer" />
          <div className="sk-rail-group">
            <button type="button" className="sk-rail-icon" aria-label="通知"><Bell size={19} strokeWidth={1.7} /></button>
            <button type="button" className="sk-rail-icon" aria-label="设置"><Settings size={19} strokeWidth={1.7} /></button>
          </div>
        </nav>

        <main className="sk-feed">
          <header className="sk-feed-head">
            <div className="sk-head-title">
              <span className="sk-eyebrow">
                {isChat ? '消息' : railTab === 'moments' ? '社交 · 动态' : '组件训练'}
              </span>
              <h1>
                {isChat
                  ? (selectedConversation ? selectedConversation.name : '消息')
                  : railTab === 'moments' ? '朋友圈动态' : 'SearchField · 搜索框'}
              </h1>
            </div>
          </header>

          {isChat ? (
            selectedConversation ? (
              <ConversationView
                conversation={selectedConversation}
                messages={messagesByConv[selectedConversation.id] ?? []}
                onSend={sendMessage} />
            ) : (
              <div className="sk-conversation">
                <Empty className="sk-conversation-empty"
                  icon={<MessagesSquare size={28} strokeWidth={1.5} />}
                  description="从左侧选择一个会话，或新建会话" />
              </div>
            )
          ) : railTab === 'moments' ? (
            <MomentsFeature />
          ) : (
            <div className="sk-feed-list">
              <section className="sk-card sk-contract">
                <span className="sk-eyebrow">产品边界</span>
                <h2>什么时候用 / 什么时候不用</h2>
                <p>
                  用于在当前范围内按名称、站点或连接即时过滤；输入只改变本地视图，不发起业务写请求。
                  不承担导航跳转、命令执行或全局设置——那些属于命令面板与设置页。空查询必须回到完整列表。
                </p>
                <div className="sk-contract-grid">
                  <div><strong>几何</strong><span>方圆宿主，控件圆角取 <code>--sk-radius-control</code>；高 40，内边距 13。</span></div>
                  <div><strong>表面</strong><span>松绿/材质填充砖（<code>--sk-tile</code>），无 1px 描边，靠材质分层。</span></div>
                  <div><strong>色彩</strong><span>前导图标与占位用三级文字；聚焦环取 <code>--sk-focus-ring</code>。</span></div>
                  <div><strong>状态</strong><span>empty / focus / filled(+清除) / disabled / 长文本，共 5 态。</span></div>
                </div>
              </section>

              <section className="sk-card sk-specimens">
                <span className="sk-eyebrow">样本 · 同一 renderer 跨皮肤</span>
                <h2>状态矩阵</h2>
                <ul className="sf-state-list">
                  {SEARCHFIELD_STATES.map(s => (
                    <li key={s.id}>
                      <div className="sf-state-head"><strong>{s.name}</strong><span>{s.expect}</span></div>
                      {s.id === 'empty' && <SearchField placeholder="搜索联系人、站点" />}
                      {s.id === 'focus' && <SearchField placeholder="聚焦态：Tab 键查看焦点环" />}
                      {s.id === 'filled' && <SearchField defaultValue="林晚" placeholder="搜索联系人、站点" />}
                      {s.id === 'disabled' && <SearchField placeholder="当前不可搜索" disabled />}
                      {s.id === 'long' && <SearchField placeholder="搜索联系人、站点、群组、中继节点、联邦范围内的全部可达对象与往来记录" />}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="sk-card sk-live">
                <span className="sk-eyebrow">活样本 · 真实受控状态</span>
                <h2>在会话轨中的实际形态见「消息」轨</h2>
                <div className="sf-live-bar">
                  <SearchField value={liveQuery} onValueChange={setLiveQuery} placeholder="搜索联系人、站点" />
                  <span className="sf-live-echo" aria-live="polite">
                    {liveQuery ? `正在按“${liveQuery}”过滤（本地示例）` : '输入以查看实时值回显'}
                  </span>
                </div>
              </section>
            </div>
          )}
        </main>

        {isChat && (
          <ConversationRail conversations={conversations}
            selectedId={selectedConv} onSelect={openConversation} onNew={newConversation} />
        )}
      </div>
      <ContactPickerDialog open={pickerOpen} people={peoplePool} existingIds={existingIds}
        onDismiss={() => setPickerOpen(false)} onPick={pickPerson} />
      </UIProvider>
    </div>
  );
}
