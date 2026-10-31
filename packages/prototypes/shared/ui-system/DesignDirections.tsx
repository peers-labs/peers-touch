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
  Search, MessageCircle, Sparkles, Settings,
  Upload, ImageIcon, X,
  type LucideIcon,
} from 'lucide-react';
import { UIProvider } from '@peers-touch/ui';
import { MomentsFeature } from './moments/MomentsFeature';
import { SettingsFeature } from './settings/SettingsFeature';
import { ChatFeature } from './chat/ChatFeature';
import { makeTranslate, usePrefs } from './prefs';
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

type RailTab = 'moments' | 'search' | 'chat' | 'settings';
const RAIL_NAV: { icon: LucideIcon; key: RailTab; labelKey: 'nav.search' | 'tab.chats' | 'nav.moments' }[] = [
  { icon: Search, key: 'search', labelKey: 'nav.search' },
  { icon: MessageCircle, key: 'chat', labelKey: 'tab.chats' },
  { icon: Sparkles, key: 'moments', labelKey: 'nav.moments' },
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


export function DesignDirections() {
  const [skinId, setSkinId] = useState('glass');
  const [wallpaper, setWallpaper] = useState<string>('none');
  const [wallName, setWallName] = useState<string>('无背景');
  const [railTab, setRailTab] = useState<RailTab>('search');
  const [liveQuery, setLiveQuery] = useState('');
  const prefs = usePrefs();
  const t = makeTranslate(prefs.locale);

  const isChat = railTab === 'chat';

  const skin = SKINS.find(s => s.id === skinId) ?? SKINS[0];

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
                  aria-label={t(n.labelKey)} aria-current={railTab === n.key ? 'page' : undefined}
                  onClick={() => setRailTab(n.key)}>
                  <Icon size={19} strokeWidth={1.7} />
                </button>
              );
            })}
          </div>
          <span className="sk-rail-spacer" />
          <div className="sk-rail-group">
            <button type="button"
              className={`sk-rail-icon${railTab === 'settings' ? ' is-active' : ''}`}
              aria-label={t('nav.settings')} aria-current={railTab === 'settings' ? 'page' : undefined}
              onClick={() => setRailTab('settings')}>
              <Settings size={19} strokeWidth={1.7} />
            </button>
          </div>
        </nav>

        <main className={`sk-feed${isChat ? ' is-chat' : ''}`}>
          {!isChat && (
            <header className="sk-feed-head">
              <div className="sk-head-title">
                <span className="sk-eyebrow">
                  {railTab === 'moments' ? '社交 · 动态'
                    : railTab === 'settings' ? t('head.settingsEyebrow') : '组件训练'}
                </span>
                <h1>
                  {railTab === 'moments' ? '朋友圈动态'
                    : railTab === 'settings' ? t('head.settingsTitle') : 'SearchField · 搜索框'}
                </h1>
              </div>
            </header>
          )}

          {isChat ? (
            <ChatFeature />
          ) : railTab === 'moments' ? (
            <MomentsFeature />
          ) : railTab === 'settings' ? (
            <SettingsFeature />
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
      </div>
      </UIProvider>
    </div>
  );
}
