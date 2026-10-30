/**
 * DesignDirections — skin switcher for Peers Touch (framework-level theme).
 *
 * - Navigation is the REAL desktop shell rail (same icons/order), not redesigned.
 * - One single social content surface (moments + conversations, human-first),
 *   NOT a work/task scenario.
 * - Skins are plain CSS-variable token sets; the tab bar switches data-skin.
 *   This is how theming must live in the framework: structure stays identical,
 *   only surface/primary/accent/type variables change.
 *
 * Draft candidate values; nothing is promoted to tokens until owner accepts.
 */
import { useState, type ChangeEvent } from 'react';
import {
  Search, MessageCircle, Bot, Sparkles, Bell, Settings,
  Heart, MessageCircleMore, Share, Plus, Upload, ImageIcon, type LucideIcon,
} from 'lucide-react';
import './design-directions.css';

type Skin = {
  id: string;
  name: string;
  desc: string;
};

/**
 * Skin registry. The token sets themselves live ONLY in design-directions.css
 * under `.sk-shell[data-skin="<id>"]`; the tab bar switches that attribute.
 * `default` mirrors the current product baseline for A/B; `warm` is the new
 * intimate, friend-circle, warm-paper candidate chosen by the owner.
 */
const SKINS: Skin[] = [
  {
    id: 'default',
    name: '当前默认',
    desc: '现有产品基线，用于对照',
  },
  {
    id: 'warm',
    name: '亲密 · 暖（候选）',
    desc: '朋友圈式温暖 · 暖米白纸感 · 暖墨 · 柔和强调',
  },
  {
    id: 'glass',
    name: '轻透 Glass（候选）',
    desc: '玻璃材质 glassmorphism · 半透明白面 · 毛玻璃 · 浅青柔光，仅建议用于浮层/入口',
  },
];

/** Preset custom wallpapers (QQ-skin style). Independent of the color skin:
 *  they paint a layer INSIDE the shell; translucent panels float above. */
const WALLPAPERS: { id: string; name: string; value: string }[] = [
  { id: 'none', name: '无背景', value: 'none' },
  { id: 'dusk', name: '暮色', value: 'linear-gradient(135deg,#f6d8b8,#e7a98e 45%,#b08bb8)' },
  { id: 'mint', name: '青野', value: 'linear-gradient(135deg,#cdeede,#a7d7cf 50%,#bcd0f2)' },
  { id: 'night', name: '夜航', value: 'radial-gradient(120% 120% at 20% 0%,#3a4a63,#1c2536 70%)' },
];

const NAV: { icon: LucideIcon; key: string }[] = [
  { icon: Search, key: 'search' },
  { icon: MessageCircle, key: 'chat' },
  { icon: Bot, key: 'agent' },
  { icon: Sparkles, key: 'moments' },
];

type Moment = {
  who: string; meta: string; text: string;
  likes: number; replies: number; tone: string; initial: string;
};
const MOMENTS: Moment[] = [
  {
    who: '林晚', meta: '刚刚 · 来自上海', likes: 24, replies: 6, initial: '林', tone: '#c98a5a',
    text: '周末把阳台的薄荷分了三盆，留一盆给自己。把生活过成喜欢的样子，不需要很大的事。',
  },
  {
    who: '周禾', meta: '2 小时前 · 同站', likes: 58, replies: 12, initial: '周', tone: '#7f9c7a',
    text: '和邻居们一起整理了小区的共享书架，今天有人放了一本我找了很久的诗集。人和人这样接上的感觉真好。',
  },
  {
    who: '联邦运维', meta: '今天 · 联邦', likes: 11, replies: 2, initial: '联', tone: '#6f8fa6',
    text: '你关注的两个站点之间已经可以互发动态了，数据仍然保存在各自的站点，只是建立了可信连接。',
  },
];

const CHATS = [
  { name: '林晚', last: '诗集散会我帮你留了位置', unread: 2, tone: '#c98a5a' },
  { name: '小区生活群', last: '周禾：周末书架见', unread: 0, tone: '#7f9c7a' },
  { name: '陈屿', last: '[图片]', unread: 1, tone: '#b07f8e' },
];

export function DesignDirections() {
  const [skinId, setSkinId] = useState('warm');
  const [wallpaper, setWallpaper] = useState<string>('none'); // css background or dataURL
  const [wallName, setWallName] = useState<string>('无背景');
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

  // shell-internal background:
  //  - "无背景" disables BOTH the wallpaper and the skin ambient glow,
  //    leaving only the skin's flat shell base color.
  //  - a preset/upload shows the wallpaper (skin glow stays as ambient).
  const noWallpaper = wallpaper === 'none';
  // Skin tokens live only in CSS under .sk-shell[data-skin] (single source of
  // truth); inline style carries runtime wallpaper state exclusively.
  const shellStyle = {
    '--sk-wallpaper': noWallpaper ? 'none' : wallpaper,
    '--sk-shell-glow': noWallpaper ? 'none' : undefined,
  } as React.CSSProperties;

  return (
    <div className="sk-page">
      {/* External control area stays NEUTRAL — skin never colors outside the frame */}
      <div className="sk-switcher">
        <div className="sk-switcher-label">
          <strong>界面皮肤</strong>
          <span>配色 / 材质 · 只作用于窗框内部，外部不变</span>
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

      {/* Skin variables are scoped to the shell only */}
      <div className="sk-shell" data-skin={skin.id}
        data-wallpaper={noWallpaper ? 'none' : 'image'} style={shellStyle}>
        {/* shell-internal independent backdrop: glow + wallpaper, panels float above */}
        <div className="sk-shell-bg" aria-hidden="true">
          <div className="sk-shell-glow" />
          <div className="sk-shell-wall" />
        </div>

        <nav className="sk-rail" aria-label="主导航">
          <div className="sk-rail-avatar">P</div>
          <div className="sk-rail-group">
            {NAV.map((n, i) => {
              const Icon = n.icon;
              return (
                <span key={n.key} className={`sk-rail-icon${i === 3 ? ' is-active' : ''}`}>
                  <Icon size={19} strokeWidth={1.7} />
                </span>
              );
            })}
          </div>
          <span className="sk-rail-spacer" />
          <div className="sk-rail-group">
            <span className="sk-rail-icon"><Bell size={19} strokeWidth={1.7} /></span>
            <span className="sk-rail-icon"><Settings size={19} strokeWidth={1.7} /></span>
          </div>
        </nav>

        {/* social content: moments (human-first), no work copy */}
        <main className="sk-feed">
          <header className="sk-feed-head">
            <h1>动态</h1>
            <button type="button" className="sk-compose"><Plus size={15} /> 发动态</button>
          </header>
          <div className="sk-feed-list">
            {MOMENTS.map(m => (
              <article key={m.who} className="sk-moment">
                <span className="sk-moment-avatar" style={{ background: m.tone }}>{m.initial}</span>
                <div className="sk-moment-body">
                  <div className="sk-moment-meta"><strong>{m.who}</strong><span>{m.meta}</span></div>
                  <p className="sk-moment-text">{m.text}</p>
                  <div className="sk-moment-actions">
                    <span><Heart size={15} /> {m.likes}</span>
                    <span><MessageCircleMore size={15} /> {m.replies}</span>
                    <span><Share size={15} /> 分享</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </main>

        {/* conversation rail */}
        <aside className="sk-chats">
          <h2>最近对话</h2>
          <div className="sk-chat-list">
            {CHATS.map(c => (
              <div key={c.name} className="sk-chat">
                <span className="sk-chat-avatar" style={{ background: c.tone }}>{c.name.slice(0, 1)}</span>
                <span className="sk-chat-text">
                  <strong>{c.name}</strong>
                  <span>{c.last}</span>
                </span>
                {c.unread > 0 && <span className="sk-badge">{c.unread}</span>}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
