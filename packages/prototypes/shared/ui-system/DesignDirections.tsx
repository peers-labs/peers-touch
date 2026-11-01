/**
 * DesignDirections — the Peers Touch desktop-prototype NORTH STAR.
 *
 * One real app window frame (60px icon rail + workbench). Components are
 * built and trained ONE AT A TIME here before promotion into peers-ui:
 * product boundary → six-dimension/state contract → specimen → probe gate
 * → human verdict → token/knowledge. No speculative Peers-unrelated
 * business screens live in the frame.
 *
 * Rail search is the GlobalSearchOverlay invocation (inc 24): an overlay,
 * never a page — ⌘K/⌘F or the rail search button summon a closed-domain
 * command surface; picking a result routes back to the object.
 *
 * Skins are CSS-variable token sets (data-skin); wallpapers are a second
 * independent dimension. Draft values; nothing is promoted until accepted.
 */
import { useEffect, useState, type CSSProperties, type ChangeEvent } from 'react';
import {
  Search, MessageCircle, Sparkles, Settings,
  Upload, ImageIcon,
  type LucideIcon,
} from 'lucide-react';
import { UIProvider } from '@peers-touch/ui';
import { MomentsFeature } from './moments/MomentsFeature';
import { SettingsFeature } from './settings/SettingsFeature';
import type { SettingsNavigationRequest } from './settings/SettingsFeature';
import { ChatFeature } from './chat/ChatFeature';
import type { ChatNavigationRequest } from './chat/ChatFeature';
import { GlobalSearchOverlay } from './search/GlobalSearchOverlay';
import type { GlobalSearchTarget } from './search/GlobalSearchOverlay';
import { NotificationBell } from './notifications/NotificationBell';
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

type RailTab = 'moments' | 'chat' | 'settings';
const RAIL_NAV: { icon: LucideIcon; key: RailTab; labelKey: 'tab.chats' | 'nav.moments' }[] = [
  { icon: MessageCircle, key: 'chat', labelKey: 'tab.chats' },
  { icon: Sparkles, key: 'moments', labelKey: 'nav.moments' },
];

export function DesignDirections() {
  const [skinId, setSkinId] = useState('glass');
  const [wallpaper, setWallpaper] = useState<string>('none');
  const [wallName, setWallName] = useState<string>('无背景');
  const [railTab, setRailTab] = useState<RailTab>('moments');
  const [searchOpen, setSearchOpen] = useState(false);
  const [chatNav, setChatNav] = useState<ChatNavigationRequest | null>(null);
  const [settingsNav, setSettingsNav] = useState<SettingsNavigationRequest | null>(null);
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

  // Global summon: ⌘K / ⌘F / Ctrl+K. Ignore IME composition keydown.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.key === 'k' || event.key === 'K' || event.key === 'f' || event.key === 'F') {
        event.preventDefault();
        setSearchOpen(open => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Route a search result back to its owning object surface.
  const handleSearchNavigate = (target: GlobalSearchTarget) => {
    const nonce = Date.now();
    switch (target.kind) {
      case 'conversation':
        setChatNav({ nonce, kind: 'conversation', conversationId: target.conversationId, messageId: target.messageId });
        setRailTab('chat');
        break;
      case 'person':
        setChatNav({ nonce, kind: 'person', personId: target.personId });
        setRailTab('chat');
        break;
      case 'moment':
        setRailTab('moments');
        break;
      case 'settings':
        setSettingsNav({ nonce, group: target.group, section: target.section });
        setRailTab('settings');
        break;
      case 'action':
        if (target.action === 'new-chat') setRailTab('chat');
        else setRailTab('moments');
        break;
    }
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
            <button type="button"
              className={`sk-rail-icon${searchOpen ? ' is-active' : ''}`}
              aria-label={t('nav.search')}
              aria-haspopup="dialog"
              aria-expanded={searchOpen}
              data-global-search-trigger
              onClick={() => setSearchOpen(true)}>
              <Search size={19} strokeWidth={1.7} />
            </button>
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
            <NotificationBell />
            <button type="button"
              className={`sk-rail-icon${railTab === 'settings' ? ' is-active' : ''}`}
              data-rail-target="settings"
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
                  {railTab === 'moments' ? '社交 · 动态' : t('head.settingsEyebrow')}
                </span>
                <h1>
                  {railTab === 'moments' ? '朋友圈动态' : t('head.settingsTitle')}
                </h1>
              </div>
            </header>
          )}

          {isChat ? (
            <ChatFeature navigation={chatNav} />
          ) : railTab === 'moments' ? (
            <MomentsFeature />
          ) : (
            <SettingsFeature navigation={settingsNav} />
          )}
        </main>
      </div>

      <GlobalSearchOverlay
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={handleSearchNavigate} />
      </UIProvider>
    </div>
  );
}
