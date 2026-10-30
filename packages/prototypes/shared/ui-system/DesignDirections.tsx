/**
 * DesignDirections — the Peers Touch desktop-prototype NORTH STAR.
 *
 * One real app window frame (60px icon rail + scrolling federation feed +
 * conversation rail) that will keep evolving toward the Desktop prototype;
 * the element collection is refined from the surfaces proven here.
 *
 * - Navigation is the REAL desktop shell rail (same icons/order), not redesigned.
 * - Feed carries Peers-native objects: my station, federation dispatch
 *   (scope / object type / max hops / settings), live topology, moments.
 * - Skins remain plain CSS-variable token sets; the tab bar switches
 *   data-skin. Structure stays identical, only surface/action/accent/type
 *   variables change. Wallpapers are a second independent dimension.
 *
 * Draft candidate values; nothing is promoted to tokens until owner accepts.
 */
import { useState, type CSSProperties, type ChangeEvent } from 'react';
import {
  Search, MessageCircle, Bot, Sparkles, Bell, Settings,
  Heart, MessageCircleMore, Share, Plus, Upload, ImageIcon,
  ChevronDown, Inbox, Users, Clock, Thermometer, Activity, Send, Mic,
  MoreHorizontal, UserPlus, type LucideIcon,
} from 'lucide-react';
import './design-directions.css';

type Skin = {
  id: string;
  name: string;
  desc: string;
};

/**
 * Skin registry. Token sets live ONLY in design-directions.css under
 * `.sk-shell[data-skin="<id>"]`. `default` mirrors the current product
 * baseline for A/B; `warm` is the intimate friend-circle candidate;
 * `glass` is the north-star grammar (pine canvas, near-black action pills,
 * one amber accent, large light numerals) the desktop prototype grows on.
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
    name: '松绿 · 北极星',
    desc: '北极星语法 · 松绿玻璃 · 近黑胶囊 · 单琥珀强调 · 大数值，desktop 原型在此上演进',
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

const STACK_TONES = ['#3f6550', '#a1824b', '#4a6170', '#5d5a44', '#3f6550'];
const STACK_INITIALS = ['陈', '群', '林', '苏', '周'];

const STAT_TILES: { icon: LucideIcon; name: string; value: string }[] = [
  { icon: Clock, name: '运行天数', value: '128' },
  { icon: Activity, name: '今日动态', value: '1,074' },
  { icon: Thermometer, name: '本地气温', value: '29°' },
];

/* Peers-native identity "photos": illustration tiles, no external imagery.
   Motifs live in the safe center so xMidYMid slice never crops them. */
function ObjectArt({ kind }: { kind: 'person' | 'group' | 'relay' }) {
  return (
    <svg viewBox="0 0 200 160" preserveAspectRatio="xMidYMid slice" className="sk-art" aria-hidden="true">
      <defs>
        <linearGradient id={`art-${kind}`} x1="0" y1="0" x2="1" y2="1">
          {kind === 'person' && <><stop offset="0" stopColor="#dfeee7" /><stop offset="1" stopColor="#b6d2c4" /></>}
          {kind === 'group' && <><stop offset="0" stopColor="#eef0dc" /><stop offset="1" stopColor="#d3d8a8" /></>}
          {kind === 'relay' && <><stop offset="0" stopColor="#dde9ee" /><stop offset="1" stopColor="#aec8d4" /></>}
        </linearGradient>
      </defs>
      <rect width="200" height="160" fill={`url(#art-${kind})`} />
      <g stroke="#2c4a3c" strokeWidth="1.8" fill="none" opacity="0.8" strokeLinecap="round">
        {kind === 'person' && <>
          <circle cx="100" cy="60" r="16" fill="#fffef7" />
          <path d="M68 120c5-23 59-23 64 0" fill="#fffef7" />
        </>}
        {kind === 'group' && <>
          <circle cx="82" cy="62" r="13" fill="#fffef7" /><circle cx="118" cy="62" r="13" fill="#fffef7" />
          <path d="M54 118c4-18 46-18 50 0M96 118c4-18 46-18 50 0" fill="#fffef7" />
        </>}
        {kind === 'relay' && <>
          <circle cx="62" cy="76" r="10" fill="#fffef7" /><circle cx="138" cy="76" r="10" fill="#fffef7" />
          <path d="M72 76h56M100 54v42" /><circle cx="100" cy="54" r="7" fill="#e8a117" stroke="none" />
        </>}
      </g>
    </svg>
  );
}

/* Station banner photo: home node with federation signals, illustration only. */
function StationArt({ liked, onToggleLike }: { liked: boolean; onToggleLike: () => void }) {
  return (
    <div className="sk-station-art">
      <svg viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id="station-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e4f0ea" /><stop offset="1" stopColor="#c4dccf" />
          </linearGradient>
        </defs>
        <rect width="320" height="200" fill="url(#station-sky)" />
        <circle cx="92" cy="42" r="10" fill="#e8a117" />
        <path d="M0 166h320" stroke="#9fbfae" strokeWidth="1.4" />
        <g stroke="#23402f" strokeWidth="1.8" fill="#f6fbf8" strokeLinejoin="round">
          <path d="M146 166V126l28-22 28 22v40" fill="#f6fbf8" />
          <path d="M136 129l38-30 38 30" fill="none" />
          <rect x="164" y="138" width="20" height="28" rx="1.5" fill="#dfeee7" />
        </g>
        <g stroke="#23402f" strokeWidth="1.6" fill="none" opacity="0.82" strokeLinecap="round">
          <path d="M140 108H86" strokeDasharray="2 4" />
          <circle cx="78" cy="108" r="5" fill="#0d100d" stroke="none" />
          <path d="M210 108h30" strokeDasharray="2 4" />
          <circle cx="244" cy="108" r="5" fill="#0d100d" stroke="none" />
          <path d="M251 101a12 12 0 0 1 0 14M257 95a20 20 0 0 1 0 26" />
        </g>
      </svg>
      <button type="button" className={`sk-heart${liked ? ' is-on' : ''}`} aria-label="收藏站点" aria-pressed={liked} onClick={onToggleLike}>
        <Heart size={15} strokeWidth={1.8} />
      </button>
      <div className="sk-gauge" aria-label="联邦可达用户 8.5k">
        <svg viewBox="0 0 120 64"><path d="M10 60a50 50 0 0 1 100 0" fill="none" stroke="rgba(255,255,255,.55)" strokeWidth="7" strokeLinecap="round" />
          <path d="M10 60a50 50 0 0 1 100 0" fill="none" stroke="#e8a117" strokeWidth="7" strokeLinecap="round" strokeDasharray="118 157" /></svg>
        <span className="sk-gauge-num">8.5k</span>
      </div>
    </div>
  );
}

export function DesignDirections() {
  const [skinId, setSkinId] = useState('glass');
  const [wallpaper, setWallpaper] = useState<string>('none'); // css background or dataURL
  const [wallName, setWallName] = useState<string>('无背景');
  const [scope, setScope] = useState<'local' | 'fed' | 'relay'>('fed');
  const [target, setTarget] = useState<'person' | 'group' | 'relay'>('person');
  const [hops, setHops] = useState(5);
  const [liked, setLiked] = useState(true);
  const skin = SKINS.find(s => s.id === skinId) ?? SKINS[0];
  const hopsPct = (hops / 7) * 100;

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
  // Skin tokens live only in CSS under .sk-shell[data-skin] (single source of
  // truth); inline style carries runtime wallpaper state exclusively.
  const shellStyle = {
    '--sk-wallpaper': noWallpaper ? 'none' : wallpaper,
    '--sk-shell-glow': noWallpaper ? 'none' : undefined,
  } as CSSProperties;

  return (
    <div className="sk-page">
      {/* External control area stays NEUTRAL — skin never colors outside the frame */}
      <div className="sk-switcher">
        <div className="sk-switcher-label">
          <strong>界面皮肤 · 桌面原型北极星</strong>
          <span>配色 / 材质 · 只作用于窗框内部，外部不变 · 窗框持续演进，元素集随之沉淀</span>
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
          <div className="sk-rail-avatar">林</div>
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

        {/* federation feed */}
        <main className="sk-feed">
          <header className="sk-feed-head">
            <div className="sk-head-title">
              <span className="sk-eyebrow">联邦网络</span>
              <h1>此刻的网络</h1>
            </div>
            <span className="sk-head-status"><strong>23</strong> 站点 · <strong>2</strong> 跳在线</span>
          </header>
          <div className="sk-feed-list">
            {/* my station */}
            <section className="sk-card sk-station">
              <StationArt liked={liked} onToggleLike={() => setLiked(v => !v)} />
              <div className="sk-station-body">
                <span className="sk-eyebrow">我的站点</span>
                <h2>home-station</h2>
                <p className="sk-sub">PTID 7f9c…31a2 · 3 位成员在线</p>
                <div className="sk-stat-row">
                  {STAT_TILES.map(t => {
                    const Icon = t.icon;
                    return (
                      <div className="sk-stat" key={t.name}>
                        <span className="sk-stat-ico"><Icon size={13} strokeWidth={1.8} /></span>
                        <span className="sk-stat-name">{t.name}</span>
                        <strong>{t.value}</strong>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* federation dispatch composer */}
            <section className="sk-card sk-composer">
              <header className="sk-composer-head">
                <div><span className="sk-eyebrow">往来</span><h2>发起往来</h2></div>
                <div className="sk-seg" role="tablist" aria-label="投递范围">
                  {([['local', '本站'], ['fed', '联邦'], ['relay', '中继']] as const).map(([id, t]) =>
                    <button key={id} type="button" role="tab" aria-selected={scope === id}
                      className={scope === id ? 'is-on' : ''} onClick={() => setScope(id)}>{t}</button>)}
                </div>
              </header>

              <p className="sk-field-label">对象类型</p>
              <div className="sk-types">
                {([['person', '联系人', 'person'], ['group', '群组', 'group'], ['relay', '站点', 'relay']] as const).map(([id, t, art]) =>
                  <button type="button" key={id} className={`sk-type${target === id ? ' is-on' : ''}`} aria-pressed={target === id} onClick={() => setTarget(id)}>
                    <ObjectArt kind={art} />
                    <span className="sk-type-tag">{t}</span>
                  </button>)}
              </div>

              <div className="sk-slider">
                <span className="sk-field-label">最大跳数</span>
                <span className="sk-slider-bubble" style={{ left: `${hopsPct}%` } as CSSProperties}>{hops}</span>
                <input type="range" min={0} max={7} value={hops} aria-label="最大跳数"
                  onChange={e => setHops(Number(e.target.value))}
                  style={{ '--sk-fill': `${hopsPct}%` } as CSSProperties} />
                <div className="sk-slider-scale">{[0, 1, 2, 3, 4, 5, 6, 7].map(n => <span key={n}>{n}</span>)}</div>
              </div>

              <p className="sk-field-label sk-settings-label">附加设置</p>
              <div className="sk-settings">
                <div className="sk-setting">
                  <div className="sk-setting-top"><span className="sk-setting-ico"><Inbox size={14} /></span><MoreHorizontal size={16} /></div>
                  <span className="sk-setting-name">本地留存</span>
                  <span className="sk-setting-num">325<i>条</i></span>
                </div>
                <div className="sk-setting">
                  <div className="sk-setting-top"><span className="sk-setting-ico"><Users size={14} /></span><MoreHorizontal size={16} /></div>
                  <span className="sk-setting-name">收件人</span>
                  <span className="sk-setting-num">3<i>位</i></span>
                </div>
                <div className="sk-setting">
                  <div className="sk-setting-top"><span className="sk-setting-ico"><Clock size={14} /></span><MoreHorizontal size={16} /></div>
                  <span className="sk-setting-name">有效期</span>
                  <span className="sk-setting-num">4/7<i>天</i></span>
                </div>
              </div>

              <div className="sk-selectors">
                <button type="button" className="sk-select"><span>起点站点</span><strong>home-station</strong><ChevronDown size={14} /></button>
                <div className="sk-select-row">
                  <button type="button" className="sk-select"><span>途经</span><strong>garden 小区</strong><ChevronDown size={14} /></button>
                  <button type="button" className="sk-select sk-select-add"><Plus size={14} /><strong>添加站点</strong></button>
                </div>
              </div>
              <button type="button" className="sk-publish"><Send size={15} />发布到网络</button>
            </section>

            {/* topology */}
            <section className="sk-card sk-topo">
              <header className="sk-topo-head">
                <div><span className="sk-eyebrow">联邦拓扑</span><h2>连接分布</h2></div>
                <div className="sk-legend">
                  <span><i className="d d-home" />本站</span><span><i className="d d-fed" />联邦</span><span><i className="d d-relay" />中继</span>
                </div>
              </header>
              <div className="sk-topo-canvas">
                <svg viewBox="0 0 640 220" aria-hidden="true">
                  <defs>
                    <radialGradient id="sk-heat" cx="50%" cy="50%" r="50%">
                      <stop offset="0" stopColor="#e8a117" stopOpacity="0.42" /><stop offset="1" stopColor="#e8a117" stopOpacity="0" />
                    </radialGradient>
                  </defs>
                  <rect width="640" height="220" rx="14" fill="#e9f1ed" />
                  <path d="M-10 178 C 120 150 210 198 330 166 S 560 118 660 150" fill="none" stroke="#cfe0e4" strokeWidth="18" opacity="0.7" />
                  <circle cx="396" cy="104" r="96" fill="url(#sk-heat)" />
                  <circle cx="396" cy="104" r="58" fill="none" stroke="#e8a117" strokeWidth="1.2" strokeDasharray="4 6" opacity="0.55" />
                  <g stroke="#9db9ab" strokeWidth="1.4" strokeDasharray="3 5">
                    <path d="M320 160 396 104M396 104 500 66M396 104 250 70M396 104 470 158M320 160 210 150M250 70 150 104M500 66 560 110M320 160 420 192M470 158 548 172M210 150 96 160" />
                  </g>
                  <g>
                    <circle cx="96" cy="160" r="9" fill="#fffef7" stroke="#cddcd2" /><text x="96" y="164" textAnchor="middle" fontSize="10" fill="#5d7169">4</text>
                    <circle cx="210" cy="150" r="9" fill="#fffef7" stroke="#cddcd2" /><text x="210" y="154" textAnchor="middle" fontSize="10" fill="#5d7169">6</text>
                    <circle cx="250" cy="70" r="10" fill="#fffef7" stroke="#cddcd2" /><text x="250" y="74" textAnchor="middle" fontSize="10" fill="#5d7169">5</text>
                    <circle cx="150" cy="104" r="10" fill="#fffef7" stroke="#cddcd2" /><text x="150" y="108" textAnchor="middle" fontSize="10" fill="#5d7169">2</text>
                    <circle cx="500" cy="66" r="11" fill="#fffef7" stroke="#cddcd2" /><text x="500" y="70" textAnchor="middle" fontSize="10" fill="#5d7169">3</text>
                    <circle cx="560" cy="110" r="10" fill="#fffef7" stroke="#cddcd2" /><text x="560" y="114" textAnchor="middle" fontSize="10" fill="#5d7169">9</text>
                    <circle cx="548" cy="172" r="9" fill="#fffef7" stroke="#cddcd2" /><text x="548" y="176" textAnchor="middle" fontSize="10" fill="#5d7169">8</text>
                    <circle cx="420" cy="192" r="9" fill="#fffef7" stroke="#cddcd2" /><text x="420" y="196" textAnchor="middle" fontSize="10" fill="#5d7169">1</text>
                    <circle cx="320" cy="160" r="13" fill="#0d100d" /><text x="320" y="165" textAnchor="middle" fontSize="11" fill="#eaf3ee">7</text>
                    <circle cx="470" cy="158" r="12" fill="#0d100d" /><text x="470" y="163" textAnchor="middle" fontSize="10" fill="#eaf3ee">12</text>
                  </g>
                </svg>
                <div className="sk-topo-pill"><strong>23</strong><span>站点</span><strong>128</strong><span>动态</span><strong>2</strong><span>跳</span></div>
              </div>
            </section>

            {/* human moments */}
            <div className="sk-feed-divider"><span>动态</span></div>
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
          <label className="sk-chat-search"><Search size={15} /><input placeholder="搜索联系人、站点" /></label>
          <div className="sk-tenants">
            <h3>连接</h3>
            <span className="sk-eyebrow">8 位连接此刻可达</span>
            <div className="sk-stack">
              {STACK_TONES.map((t, i) => <span key={i} className="sk-stack-item" style={{ background: t }}>{STACK_INITIALS[i]}</span>)}
              <span className="sk-stack-more">+3</span>
            </div>
            <button type="button" className="sk-request"><UserPlus size={15} />新建会话</button>
          </div>
          <h2 className="sk-chats-title">最近对话</h2>
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
