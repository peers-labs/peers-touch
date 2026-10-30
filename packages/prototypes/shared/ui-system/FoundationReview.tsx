import { useEffect, useState, type CSSProperties } from 'react';
import {
  Button, Icon, UIProvider, foundationCandidates, foundationCandidateVariables,
  type FoundationCandidate, type IconId,
} from '@peers-touch/ui';
import './foundation-review.css';

const dimensions = [
  { id: 'type', title: '文字', english: 'Typography', question: '先读到什么，再读到什么？', detail: '比较标题、正文与元信息的比例，以及中英文的连续阅读。', refs: ['ui.spec.text'] },
  { id: 'geometry', title: '几何', english: 'Geometry', question: '每个尺寸，都属于同一家族。', detail: '比较圆角方形、尺寸比例与留白。控制和身份不用全圆或胶囊。', refs: ['ui.spec.avatar', 'ui.spec.actionicon'] },
  { id: 'color', title: '色彩', english: 'Color', question: '色彩只在需要时说话。', detail: '比较中性色、文字对比、强调色和状态。不靠颜色单独表达意义。', refs: ['ui.spec.text', 'ui.spec.tag', 'ui.spec.badge'] },
  { id: 'icon', title: '图标', english: 'Iconography', question: '线条、字重与光学中心。', detail: '复用同一语义资产比较线重与尺寸；完整图标集将在确认后逐项重做。', refs: ['ui.spec.icon', 'ui.spec.filetypeicon'] },
  { id: 'surface', title: '表面', english: 'Surface', question: '用层次，让关系清楚。', detail: '比较连续阅读、轻分组与抬升浮层。玻璃不进入日常内容面。', refs: ['ui.spec.block', 'ui.spec.card', 'ui.spec.divider'] },
  { id: 'layout', title: '布局', english: 'Layout', question: '让阅读轴始终保持稳定。', detail: '比较共同轨道、混合行高、元信息和窄屏重排。相同内容使用相同语义结构。', refs: ['ui.spec.flex', 'ui.spec.grid', 'ui.spec.header'] },
] as const;
type DimensionId = typeof dimensions[number]['id'];

function initialDimension(): DimensionId {
  const value = new URLSearchParams(window.location.search).get('foundation');
  return dimensions.find(item => item.id === value)?.id ?? 'type';
}

function Glyph({ id, candidate, size = 20 }: { id: IconId; candidate: FoundationCandidate; size?: number }) {
  return <Icon iconId={id} size={size} strokeWidth={candidate.geometry.iconStroke}/>;
}

function DocumentRows({ candidate, expanded = false }: { candidate: FoundationCandidate; expanded?: boolean }) {
  const rows = [
    ['file-text', '产品论点', '今天'],
    ['message-square', expanded ? '共享想法与需要继续讨论的设计问题' : '共同讨论', '昨天'],
    ['folder-open', '项目资料', '周一'],
  ] as const;
  return <div className="fd-document-list">{rows.map(([icon, label, time]) =>
    <div className="fd-document-row" key={icon}>
      <span className="fd-row-icon"><Glyph id={icon} candidate={candidate}/></span>
      <span className="fd-row-text"><strong>{label}</strong>{expanded && <small>林舟与陈雨 · 共同编辑</small>}</span>
      <time>{time}</time><span className="fd-row-end"><Glyph id="chevron-right" candidate={candidate} size={16}/></span>
    </div>)}</div>;
}

function Specimen({ dimension, candidate, expanded }: { dimension: DimensionId; candidate: FoundationCandidate; expanded: boolean }) {
  if (dimension === 'type') return <div className="fd-type-sample">
    <span className="fd-meta">共同创作 / SHARED WORK</span>
    <h3>把想法，变成<br/>共同的行动。</h3>
    <p className="fd-lead">{expanded ? '把值得继续讨论的想法与资料留在一起，让每位参与者都能理解上下文，并清楚知道下一步。' : '让资料、讨论和下一步，留在同一个地方。'}</p>
    <div className="fd-type-reading"><h4>从一份共享文档开始</h4>
      <p>内容先被看见，结构随后解释它。我们用稳定的层级与留白，让共同创作保持清楚。</p>
      <p lang="en">{expanded ? 'Keep the full context of a shared idea readable as it grows. Longer translations should wrap without hiding the meaning or compressing the surrounding structure.' : 'Keep the idea and its context together. Make the next step clear.'}</p>
    </div>
    <div className="fd-byline">林舟 · 今天 09:41 <span>仅参与者可见</span></div>
  </div>;
  if (dimension === 'geometry') return <div className="fd-geometry-sample">
    <div className="fd-scale">{[24, 36, 44, 64].map(size => <div key={size}>
      <span className="fd-geometry-object" style={{ width: size, height: size, borderRadius: size * candidate.geometry.avatarRatio }}><Glyph id="user" candidate={candidate} size={size >= 44 ? 24 : 16}/></span>
      <small>{size}</small>
    </div>)}</div>
    <div className="fd-rule-caption">同一家族 · 圆角随尺寸变化</div>
    <div className="fd-geometry-outline"><div><Glyph id="folder-open" candidate={candidate}/><strong>共享空间</strong></div>
      <p>{expanded ? '轮廓承载对象的关系，内边距给长内容留出连续阅读的空间。' : '轮廓承载关系，内边距承载阅读。'}</p></div>
    <dl className="fd-value-notes"><div><dt>控制圆角</dt><dd>{candidate.geometry.controlRadius}px</dd></div>
      <div><dt>表面圆角</dt><dd>{candidate.geometry.surfaceRadius}px</dd></div><div><dt>内容内距</dt><dd>{candidate.geometry.inset}px</dd></div></dl>
  </div>;
  if (dimension === 'color') {
    const roles = [
      ['text', '主要文字', '先看见内容'], ['secondary', '辅助文字', '读懂上下文'],
      ['primary', '主要动作', '找到下一步'], ['borderStrong', '边界', '区分相邻关系'],
      ['success', '完成', '资料已保存'], ['warning', '注意', '需要继续处理'],
    ] as const;
    return <div className="fd-color-sample"><p className="fd-lead">一处强调，其余安静。</p>
      {roles.map(([role, title, copy]) => <div className="fd-color-row" key={role}>
        <span className="fd-swatch" style={{ background: `var(--pt-${role})` }}/><span><strong>{title}</strong><small>{copy}</small></span>
        <span className="fd-color-role">{role}</span>
      </div>)}
      <p className="fd-status"><span style={{ color: 'var(--pt-success)' }}><Glyph id="check" candidate={candidate} size={16}/></span>资料已保存 · 有文字与形状的状态</p>
    </div>;
  }
  if (dimension === 'icon') return <div className="fd-icon-sample">
    <div className="fd-icon-grid">{(['search', 'plus', 'message-square', 'file-text', 'settings', 'user', 'check', 'folder-open'] as IconId[]).map(id =>
      <span key={id}><Glyph id={id} candidate={candidate} size={24}/></span>)}</div>
    <div className="fd-icon-scales">{[16, 20, 24].map(size => <div key={size}><Glyph id="search" candidate={candidate} size={size}/><small>{size}px</small></div>)}</div>
    <div className="fd-icon-labels">{(['共同讨论', '项目资料', '个人设置'] as const).map((title, index) => <div key={title}>
      <Glyph id={(['message-square', 'folder-open', 'settings'] as IconId[])[index]} candidate={candidate}/><span>{title}</span>
    </div>)}</div>
    <p className="fd-rule-caption">候选线重 {candidate.geometry.iconStroke} · 24px 语义网格</p>
  </div>;
  if (dimension === 'surface') return <div className="fd-surface-sample">
    <div className="fd-surface-reading"><span className="fd-meta">阅读表面</span><h4>项目资料</h4><DocumentRows candidate={candidate}/></div>
    <div className="fd-surface-subtle"><Glyph id="users" candidate={candidate}/><p>与参与者共享<br/><small>关系清楚，内容保持连续。</small></p></div>
    <div className="fd-surface-raised"><span className="fd-meta">抬升浮层 / 仅示意</span>
      <div><Glyph id="user" candidate={candidate}/><span>仅参与者可见</span><Glyph id="check" candidate={candidate} size={16}/></div></div>
  </div>;
  return <div className="fd-layout-sample"><div className="fd-layout-title">
    <span className="fd-meta">共享空间</span><h3>项目资料</h3><p>{expanded ? '把文档、共同讨论和项目资料放在连续的阅读轨道中。' : '文档、讨论与资料，沿同一条轴。'}</p></div>
    <DocumentRows candidate={candidate} expanded/>
    <div className="fd-layout-footer"><Glyph id="users" candidate={candidate} size={16}/><span>仅参与者可见</span><span>3 项</span></div>
    <p className="fd-rule-caption">主体 / 元信息 / 末端动作 · 共同轨道</p>
  </div>;
}

export function FoundationReview({ theme, onCatalogue }: { theme: 'light' | 'dark'; onCatalogue: (id?: string) => void }) {
  const [dimension, setDimension] = useState<DimensionId>(initialDimension);
  const [solo, setSolo] = useState<string | null>(() => {
    const value = new URLSearchParams(window.location.search).get('direction');
    return foundationCandidates.some(candidate => candidate.id === value) ? value : null;
  });
  const [expanded, setExpanded] = useState(false);
  const current = dimensions.find(item => item.id === dimension)!;
  const shown = solo ? foundationCandidates.filter(candidate => candidate.id === solo) : foundationCandidates;
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('foundation', dimension);
    url.searchParams.set('eles', 'foundations');
    url.searchParams.delete('ele');
    if (solo) url.searchParams.set('direction', solo); else url.searchParams.delete('direction');
    window.history.replaceState(null, '', url);
  }, [dimension, solo]);

  return <main className="fd-review" data-foundation-review>
    <div className="fd-review-intro"><div><span className="fd-overline">01 / DESIGN FOUNDATIONS</span><h2>先确定我们的语言。</h2>
      <p>三种方向，相同内容。逐项建立自己的设计基准。</p></div>
      <span className="fd-draft">基础候选 · 待确认</span></div>
    <nav className="fd-dimensions" aria-label="设计基础维度">{dimensions.map((item, index) =>
      <Button key={item.id} actionId={`foundation.dimension.${item.id}`} emphasis="quiet" aria-pressed={item.id === dimension}
        onActivate={() => setDimension(item.id)}><span>{String(index + 1).padStart(2, '0')}</span>{item.title}</Button>)}</nav>
    <div className="fd-review-heading"><div><span className="fd-overline">{current.english}</span><h3>{current.question}</h3><p>{current.detail}</p></div>
      <Button actionId="foundation.expand" emphasis="quiet" aria-pressed={expanded} onActivate={() => setExpanded(value => !value)}>{expanded ? '标准文案' : '扩展文案'}</Button></div>
    <div className="fd-directions-toolbar" role="group" aria-label="方向查看">
      <Button actionId="foundation.compare" emphasis="quiet" aria-pressed={!solo} onActivate={() => setSolo(null)}>并排比较</Button>
      {foundationCandidates.map(candidate => <Button key={candidate.id} actionId={`foundation.solo.${candidate.id}`} emphasis="quiet"
        aria-pressed={solo === candidate.id} onActivate={() => setSolo(candidate.id)}>单看{candidate.name}</Button>)}
    </div>
    <div className="fd-comparison" data-view={solo ? 'solo' : 'compare'}>
      {shown.map(candidate => <section key={candidate.id} className="fd-direction" data-candidate-id={candidate.id} data-candidate-status={candidate.status}>
        <header className="fd-direction-heading"><span>{String(foundationCandidates.indexOf(candidate) + 1).padStart(2, '0')}</span>
          <div><h4>{candidate.name}<small>{candidate.subtitle}</small></h4><p>{candidate.intent}</p></div></header>
        <UIProvider theme={theme} className="fd-candidate-provider" style={foundationCandidateVariables(candidate, theme) as CSSProperties}>
          <div className="fd-sheet" data-dimension={dimension} data-expanded={expanded} inert>
            <div className="fd-sheet-top"><span>PEERS</span><Glyph id="folder-open" candidate={candidate} size={18}/></div>
            <Specimen dimension={dimension} candidate={candidate} expanded={expanded}/>
          </div>
        </UIProvider>
        <p className="fd-direction-foot">候选 {candidate.subtitle} · 尚未成为设计基准</p>
      </section>)}
    </div>
    <footer className="fd-review-context"><details><summary>本项定义与整体计划</summary>
      <p>UI-F01 · EDX 的设计基准输入层。基础确认 → 组件 → 高级组合 → 交互与动效 → Agent 使用与独立效果验证。</p>
      <div className="fd-contract-links">{current.refs.map(id => <Button key={id} actionId={`foundation.contract.${id}`} emphasis="inline" onActivate={() => onCatalogue(id)}>{id}</Button>)}</div>
      <p>所有候选均为 draft，仅供样本审阅。正式组件、业务与原生行为、独立评审和框架收益尚未证明。</p>
    </details></footer>
  </main>;
}
