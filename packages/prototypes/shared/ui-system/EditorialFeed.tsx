import { useMemo, useState } from 'react';
import './editorial-feed.css';

/* Editorial Paper — north-star product surface.
   A federated social "periodical": warm paper, masthead, continuous letter
   feed, and one signature — the provenance postmark that says WHERE a post
   comes from. Components live inside real editorial layout, never a card wall. */

type Station = { id: string; name: string; handle: string; state: 'local' | 'federated' | 'relay'; hops: number; tone: 'ink' | 'pine' | 'clay' };

const stations: Station[] = [
  { id: 'home', name: 'home-station', handle: 'home', state: 'local', hops: 0, tone: 'ink' },
  { id: 'garden', name: 'garden 小区站', handle: 'garden', state: 'federated', hops: 1, tone: 'pine' },
  { id: 'relay', name: 'remote-relay', handle: 'relay', state: 'relay', hops: 2, tone: 'pine' },
];

type Entry = {
  id: string; author: string; stationId: string; verified: boolean; time: string;
  text: string; art?: 'mint'; stationName: string;
  replies: number; reposts: number;
  reactions: { id: string; glyph: string; label: string; count: number }[];
};

const initialEntries: Entry[] = [
  {
    id: 'e1', author: '陈屿', stationId: 'relay', stationName: 'remote-relay', verified: true, time: '09:24', replies: 3, reposts: 1,
    text: '第三盆薄荷也活了。分盆的时候把老根留在旧盆，新剪的枝插在素烧盆里，放在朝北的窗台——两周，根扎稳了。\n\n跨站交换的不只是植物，是“在哪种光里能活”这件事的经验。',
    art: 'mint',
    reactions: [{ id: 'leaf', glyph: '❧', label: '同感', count: 12 }, { id: 'repost2', glyph: '↗', label: '转发', count: 1 }],
  },
  {
    id: 'e2', author: '小区生活群', stationId: 'garden', stationName: 'garden 小区站', verified: true, time: '08:50', replies: 26, reposts: 4,
    text: '本周日下午，凉亭办第二次种子交换。今年多了番茄老种和几种香草，欢迎带上你留的种子，或只来坐坐也好。',
    reactions: [{ id: 'go', glyph: '✦', label: '想去', count: 23 }],
  },
  {
    id: 'e3', author: 'lin · 连南', stationId: 'relay', stationName: 'remote-relay', verified: false, time: '昨天', replies: 0, reposts: 0,
    text: '第一次从两跳之外收到一条动态，没有平台、没有推荐流，只有一个可验证的出处。慢一点，但知道它从哪来。',
    reactions: [{ id: 'nod', glyph: '·', label: '共鸣', count: 5 }],
  },
];

function Glyph({ name, size = 16 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'search': return <svg {...common}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case 'pen': return <svg {...common}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>;
    case 'check': return <svg {...common}><path d="m4 12 5 5L20 6" /></svg>;
    case 'reply': return <svg {...common}><path d="M9 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14" /><path d="m13 6-4 4 4 4" /></svg>;
    case 'repost': return <svg {...common}><path d="m17 2 4 4-4 4" /><path d="M3 11V9a4 4 0 0 1 4-4h14" /><path d="m7 22-4-4 4-4" /><path d="M21 13v2a4 4 0 0 1-4 4H3" /></svg>;
    case 'bookmark': return <svg {...common}><path d="M19 21 12 16l-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" /></svg>;
    case 'nodes': return <svg {...common}><circle cx="5" cy="6" r="2.2" /><circle cx="19" cy="6" r="2.2" /><circle cx="12" cy="18" r="2.2" /><path d="M6.8 7.4 10.4 16M17.2 7.4 13.6 16M7 6h10" /></svg>;
    case 'arrow': return <svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case 'mint': return <svg {...common} strokeWidth={1.4}><path d="M12 21V8" /><path d="M12 12C9 12 6.5 10 6 6c3.5.3 6 2.5 6 6Z" /><path d="M12 9c3 0 5.5-2 6-6-3.5.3-6 2.5-6 6Z" /><path d="M7 21h10" /></svg>;
    default: return null;
  }
}

function MintArt() {
  return (
    <figure className="pe-art" aria-label="素烧盆里的薄荷">
      <svg viewBox="0 0 640 320" role="img">
        <defs>
          <linearGradient id="peSky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f0e9d8" /><stop offset="1" stopColor="#e6dbc4" />
          </linearGradient>
        </defs>
        <rect width="640" height="320" rx="16" fill="url(#peSky)" />
        {/* windowsill */}
        <line x1="64" y1="268" x2="576" y2="268" stroke="#c9bda3" strokeWidth="1.5" />
        {/* main plant */}
        <g stroke="#3f6550" fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M330 262V120" />
          <path d="M330 158c-46 2-78-26-84-72 44 2 76 28 84 72Z" fill="#557c60" fillOpacity="0.22" />
          <path d="M331 140c46-4 74-38 78-86-44 8-70 40-78 86Z" fill="#5f8769" fillOpacity="0.2" />
          <path d="M330 196c-34 0-58-22-64-54 32 0 56 18 64 54Z" fill="#557c60" fillOpacity="0.16" />
          <path d="M330 232c28-4 46-24 50-52-28 2-44 22-50 52Z" fill="#5f8769" fillOpacity="0.14" />
        </g>
        {/* small second pot */}
        <g stroke="#3f6550" fill="none" strokeWidth="1.8" strokeLinecap="round" opacity="0.85">
          <path d="M196 262v-34M196 244c-16 0-26-12-28-30 16 2 26 14 28 30ZM197 240c15-2 24-15 26-31-15 3-23 15-26 31Z" fill="#557c60" fillOpacity="0.16" />
        </g>
        <path d="M296 262h70l-9 40h-52Z" fill="#c9b792" />
        <path d="M289 262h84v9h-84Z" fill="#b7a47c" />
        <path d="M176 262h40l-6 26h-28Z" fill="#d7c9a8" />
        <path d="M172 262h48v7h-48Z" fill="#c3b28d" />
        <g fill="#8a8175" opacity="0.6"><circle cx="118" cy="86" r="2" /><circle cx="506" cy="70" r="2.4" /><circle cx="548" cy="132" r="1.8" /><circle cx="470" cy="150" r="1.6" /></g>
      </svg>
      <figcaption>朝北的窗台 · 素烧盆 · 第二周</figcaption>
    </figure>
  );
}

function Avatar({ name, tone = 'ink', large = false }: { name: string; tone?: Station['tone']; large?: boolean }) {
  // Signature identity from the reference: layered translucent glass planes
  // behind a front paper tile (the stacked-card motif), not a flat dot.
  return <span className={`pe-avatar pe-avatar--${tone} ${large ? 'is-large' : ''}`} aria-hidden>
    <span className="pe-avatar-plane pe-avatar-plane--back" />
    <span className="pe-avatar-plane pe-avatar-plane--mid" />
    <span className="pe-avatar-face">{name.slice(0, 1)}</span>
  </span>;
}

function Postmark({ station }: { station: Station }) {
  // Signature: an editorial provenance mark — where the letter is from.
  const label = station.state === 'local' ? '本站' : station.state === 'relay' ? `跨 ${station.hops} 跳` : '联邦';
  return <span className={`pe-postmark pe-postmark--${station.tone}`} title={`来源：${station.name}`}>
    <Glyph name="nodes" size={12} /><span>{label}</span>
  </span>;
}

export function EditorialFeed({ onExit }: { onExit?: () => void }) {
  const [tab, setTab] = useState<'all' | 'following' | 'stations'>('all');
  const [draft, setDraft] = useState('');
  const [liked, setLiked] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState(false);

  const entries = useMemo(() => initialEntries.filter(e =>
    tab === 'all' ? true : tab === 'following' ? e.stationId !== 'relay' || e.verified : true), [tab]);

  const stationOf = (id: string) => stations.find(s => s.id === id)!;

  return (
    <div className="pe">
      <header className="pe-mast">
        <div className="pe-mast-inner">
          <div className="pe-wordmark">
            <span className="pe-wordmark-mark"><Glyph name="nodes" size={17} /></span>
            <span className="pe-wordmark-name">peers<em>往来</em></span>
          </div>
          <nav className="pe-topnav" aria-label="主导航">
            {([['all', '全部'], ['following', '关注'], ['stations', '站点']] as const).map(([id, label]) => (
              <button key={id} className={`pe-topnav-item ${tab === id ? 'is-active' : ''}`} aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          <div className="pe-mast-actions">
            <label className="pe-search">
              <Glyph name="search" size={15} />
              <input placeholder="搜索人、站点、动态" aria-label="搜索" />
            </label>
            <button className="pe-publish"><Glyph name="pen" size={15} />写动态</button>
            {onExit && <button className="pe-exit" onClick={onExit} aria-label="返回元素库">元素库</button>}
          </div>
        </div>
      </header>

      <main className="pe-page">
        <aside className="pe-rail pe-rail-left" aria-label="身份与目录">
          <section className="pe-id">
            <div className="pe-id-row">
              <Avatar name="林" tone="ink" />
              <div className="pe-id-meta">
                <strong>林晚</strong>
                <span>@linwan · home</span>
              </div>
            </div>
            <dl className="pe-stats">
              <div><dt>连接</dt><dd>2</dd></div>
              <div><dt>站点</dt><dd>3</dd></div>
              <div><dt>本月往来</dt><dd>128</dd></div>
            </dl>
          </section>
          <nav className="pe-toc" aria-label="目录">
            {['今日往来', '我的草稿', '书签与回响', '可信连接', '站点目录'].map((item, i) => (
              <a key={item} className={i === 0 ? 'is-current' : ''} href="#feed">
                <span className="pe-toc-index">0{i + 1}</span>{item}
              </a>
            ))}
          </nav>
          <p className="pe-rail-note">数据保存在你的站点，只与可信连接同步可达性——没有中央时间线。</p>
        </aside>

        <section className="pe-feed" id="feed" aria-label="联邦动态流">
          <header className="pe-feed-head">
            <p className="pe-eyebrow">联邦刊物 · 来自三个站点</p>
            <h1>今日<em>往来</em></h1>
            <time>2026 年 10 月 30 日 · 周五</time>
          </header>

          <div className={`pe-composer ${focused ? 'is-focused' : ''}`}>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="写点什么，寄给你的网络…"
              aria-label="新动态" rows={2} />
            <div className="pe-composer-foot">
              <span className="pe-composer-to"><Glyph name="nodes" size={13} />发到 全部连接</span>
              <button className="pe-publish pe-publish--sm" disabled={!draft.trim()}><Glyph name="arrow" size={14} />寄出</button>
            </div>
          </div>

          <ol className="pe-entries">
            {entries.map(entry => {
              const station = stationOf(entry.stationId);
              return (
                <li key={entry.id} className="pe-entry">
                  <div className="pe-entry-head">
                    <Avatar name={entry.author.slice(0, 1)} tone={station.tone} />
                    <div className="pe-byline">
                      <span className="pe-byline-author">{entry.author}
                        {entry.verified && <span className="pe-verified" title="身份已验证"><Glyph name="check" size={12} /></span>}
                      </span>
                      <span className="pe-byline-source">@{entry.stationName} · {entry.time}</span>
                    </div>
                    <Postmark station={station} />
                  </div>
                  <p className="pe-entry-text">{entry.text.split('\n\n').map((para, i) => <span key={i} className="pe-entry-para">{para}</span>)}</p>
                  {entry.art === 'mint' && <MintArt />}
                  <footer className="pe-entry-foot">
                    <button className={`pe-react ${liked[entry.id] ? 'is-on' : ''}`} onClick={() => setLiked(s => ({ ...s, [entry.id]: !s[entry.id] }))}>
                      <span className="pe-react-glyph">❧</span> 同感 <b>{entry.reactions[0].count + (liked[entry.id] ? 1 : 0)}</b>
                    </button>
                    <button className="pe-react"><Glyph name="reply" size={15} /> 回复 <b>{entry.replies}</b></button>
                    <button className="pe-react"><Glyph name="repost" size={15} /> 转发 <b>{entry.reposts}</b></button>
                    <button className="pe-react pe-react--end"><Glyph name="bookmark" size={15} /> 收藏</button>
                  </footer>
                </li>
              );
            })}
          </ol>
          <p className="pe-feed-end">— 以上是你可信网络里此刻的全部往来，按时间排列 —</p>
        </section>

        <aside className="pe-rail pe-rail-right" aria-label="此刻与来源">
          <section className="pe-now">
            <strong>128</strong><span>今日跨站动态</span>
            <div><strong>02</strong><span>连接站点</span></div>
            <div><strong>03</strong><span>待回响</span></div>
          </section>
          <section className="pe-stations">
            <h2>连接中的站点</h2>
            <ul>
              {stations.map(s => (
                <li key={s.id}>
                  <span className={`pe-dot pe-dot--${s.tone}`} />
                  <span className="pe-station-name">{s.name}</span>
                  <span className="pe-station-meta">{s.state === 'local' ? '本机' : `${s.hops} 跳`}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="pe-provenance-note">
            <Postmark station={stations[2]} />
            <p>每条动态都附带可验证的<strong>出处</strong>：作者、站点、与你的距离。你看到的不是算法排序，而是一张你自己认得的网络。</p>
          </section>
        </aside>
      </main>
    </div>
  );
}
