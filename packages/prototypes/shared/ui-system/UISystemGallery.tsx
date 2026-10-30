import { useEffect, useMemo, useRef, useState } from 'react';
import {
  capabilityCatalogue, UIProvider, Button, TextField, Field, Heading, Text, Tag,
  expressionCandidateVariables, type ThemeMode,
} from '@peers-touch/ui';
import { FoundationReview } from './FoundationReview';
import { AgentStyleStudy } from './AgentStyleStudy';
import { FoundationSpecimens, FoundationSpecimen, foundationIds } from './FoundationSpecimens';
import { BaseElementKit } from './BaseElementKit';
import { ConsumerFoundationKit } from './ConsumerFoundationKit';
import { EditorialFeed } from './EditorialFeed';
import { DesignDirections } from './DesignDirections';
import './gallery.css';
import './view-bar.css';

const categories: Record<string, string> = {
  action: '动作', input: '输入与选择', content: '阅读', identity: '身份与资产',
  feedback: '反馈', layout: '布局', disclosure: '展开', navigation: '导航',
  overlay: '浮层', media: '媒体', code: '代码与图表', runtime: '运行时', domain: '业务组合',
};
type Stage = 'foundation' | 'advanced' | 'composition';
type NorthStarView = 'northstar' | 'directions' | 'elements' | 'consumer' | 'expression' | 'basics' | 'foundations' | 'catalogue';
const VIEW_IDS: NorthStarView[] = ['northstar', 'directions', 'elements', 'consumer', 'expression', 'basics', 'foundations', 'catalogue'];
function initialView(): NorthStarView {
  const requested = new URLSearchParams(window.location.search).get('eles');
  return (VIEW_IDS as string[]).includes(requested ?? '') ? requested as NorthStarView : 'directions';
}
const stageLabels: Record<Stage, string> = { foundation: '基础', advanced: '高级', composition: '业务组合' };
function stageOf(entry: typeof capabilityCatalogue[number]): Stage {
  if (foundationIds.has(entry.id)) return 'foundation';
  return entry.category === 'domain' ? 'composition' : 'advanced';
}
function initialSelection() {
  const id = new URLSearchParams(window.location.search).get('ele');
  return capabilityCatalogue.some(entry => entry.id === id) ? id! : 'ui.spec.text';
}

export function UISystemGallery() {
  const [theme, setTheme] = useState<ThemeMode>('light');
  const [view, setView] = useState<NorthStarView>(initialView);

  // Keep the URL in sync for EVERY view, including directions/elements which
  // render without the inner Gallery (whose effect used to own this). Without
  // it the entry points could not be deep-linked or restored.
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('eles', view);
    if (view !== 'catalogue') url.searchParams.delete('ele');
    window.history.replaceState(null, '', url);
  }, [view]);

  const counts = {
    all: capabilityCatalogue.length,
    foundation: capabilityCatalogue.filter(entry => stageOf(entry) === 'foundation').length,
  };
  const views: { id: NorthStarView; label: string }[] = [
    { id: 'northstar', label: '北极星 · 往来' },
    { id: 'elements', label: '基础元素' },
    { id: 'consumer', label: '消费端全集' },
    { id: 'basics', label: `基础组件 ${counts.foundation}` },
    { id: 'expression', label: '表达样本' },
    { id: 'foundations', label: '基础拆解' },
    { id: 'catalogue', label: `元素全集 ${counts.all}` },
    { id: 'directions', label: '皮肤与背景' },
  ];

  return (
    <UIProvider theme="light" className="ui-view-provider">
      <div className="ui-view-shell" data-current-view={view}>
        <nav className="ui-view-bar" role="group" aria-label="Frontend Eles 视图切换">
          {views.map(item => (
            <Button key={item.id} actionId={`view.${item.id}`} emphasis="quiet"
              aria-pressed={view === item.id} onActivate={() => setView(item.id)}>{item.label}</Button>
          ))}
        </nav>
        <div className="ui-view-body">
          {view === 'northstar' && <EditorialFeed onExit={() => setView('elements')} />}
          {view === 'directions' && <DesignDirections />}
          {view === 'elements' && <BaseElementKit />}
          {view === 'consumer' && <ConsumerFoundationKit />}
          {view !== 'directions' && view !== 'elements' && view !== 'consumer' && view !== 'northstar' && (
            <UIProvider theme={theme} className="ui-gallery-provider pt-expression-candidate"
              style={expressionCandidateVariables(theme === 'dark' ? 'dark' : 'light')}>
              <Gallery theme={theme} setTheme={setTheme} view={view} setView={setView} />
            </UIProvider>
          )}
        </div>
      </div>
    </UIProvider>
  );
}

function Gallery({ theme, setTheme, view, setView }: {
  theme: ThemeMode; setTheme: (value: ThemeMode) => void;
  view: NorthStarView; setView: (value: NorthStarView) => void;
}) {
  const [selected, setSelected] = useState(initialSelection);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Stage | 'all'>('all');
  const main = useRef<HTMLElement>(null);
  const current = capabilityCatalogue.find(entry => entry.id === selected)!;
  const stage = stageOf(current);
  const filtered = useMemo(() => capabilityCatalogue.filter(entry =>
    (filter === 'all' || stageOf(entry) === filter) &&
    `${entry.id} ${entry.title} ${entry.anatomy} ${entry.exports.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())),
  [filter, query]);
  const counts = {
    all: capabilityCatalogue.length,
    foundation: capabilityCatalogue.filter(entry => stageOf(entry) === 'foundation').length,
    advanced: capabilityCatalogue.filter(entry => stageOf(entry) === 'advanced').length,
    composition: capabilityCatalogue.filter(entry => stageOf(entry) === 'composition').length,
  };
  const index = capabilityCatalogue.findIndex(entry => entry.id === selected);
  const reviewIndex = filtered.findIndex(entry => entry.id === selected);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('eles', view);
    if (view === 'catalogue') url.searchParams.set('ele', selected);
    else url.searchParams.delete('ele');
    if (view !== 'expression') url.searchParams.delete('sample');
    window.history.replaceState(null, '', url);
    main.current?.scrollTo({ top: 0 });
  }, [selected, view]);

  function openCatalogue(id?: string) {
    if (id) {
      setSelected(id);
      setFilter('all');
      setQuery('');
    }
    setView('catalogue');
  }

  function changeFilter(next: Stage | 'all') {
    setFilter(next);
    if (next !== 'all' && stageOf(current) !== next) {
      const first = capabilityCatalogue.find(entry => stageOf(entry) === next);
      if (first) setSelected(first.id);
    }
  }

  return <div className="ui-gallery" data-ui-gallery data-review-phase={view === 'expression' || view === 'basics' ? 'expression' : 'foundation'}>
    <header className="ui-gallery-header">
      <div><span className="ui-gallery-eyebrow">PEERS / FRONTEND ELEMENTS</span>
        <Heading level={1}>Frontend Eles</Heading>
        <Text tone="secondary">Agent 元素表达 · {counts.all} 项完整目录</Text></div>
      <div className="ui-gallery-theme" role="group" aria-label="主题">
        {(['light', 'dark'] as const).map(value => <Button key={value} actionId={`gallery.theme.${value}`}
          emphasis="quiet" aria-pressed={theme === value} onActivate={() => setTheme(value)}>{value === 'light' ? '浅色' : '深色'}</Button>)}
      </div>
    </header>
    {view === 'basics' ? <FoundationSpecimens onCatalogue={openCatalogue}/> :
      view === 'expression' ? <AgentStyleStudy onCatalogue={openCatalogue}/> :
      view === 'foundations' ? <FoundationReview theme={theme === 'dark' ? 'dark' : 'light'} onCatalogue={openCatalogue}/> : <>
    <div className="ui-gallery-filters" role="group" aria-label="目录范围">
      {(['all', 'foundation', 'advanced', 'composition'] as const).map(value =>
        <Button key={value} actionId={`gallery.filter.${value}`} emphasis="quiet" aria-pressed={filter === value}
          onActivate={() => changeFilter(value)}>{value === 'all' ? '全集' : stageLabels[value]} {counts[value]}</Button>)}
    </div>
    <div className="ui-gallery-body">
      <aside className="ui-gallery-nav" aria-label="元素与组件目录">
        <Field label="查找组件"><TextField value={query} onChange={event => setQuery(event.target.value)}
          placeholder="名称、用途或合同 ID"/></Field>
        <Text className="ui-gallery-result-count" tone="secondary">{filtered.length} / {counts.all} 项</Text>
        {Object.entries(categories).map(([category, label]) => {
          const entries = filtered.filter(entry => entry.category === category);
          return entries.length > 0 && <section key={category} className="ui-gallery-nav-group"><h3>{label} · {entries.length}</h3>
            {entries.map(entry => <Button key={entry.id} actionId={`gallery.${entry.id}`} emphasis="quiet"
              data-catalogue-id={entry.id} aria-pressed={selected === entry.id} onActivate={() => setSelected(entry.id)}>
              <span className="ui-gallery-nav-title">{entry.title}</span>
              <span className="ui-gallery-nav-stage">{stageLabels[stageOf(entry)]}</span>
            </Button>)}
          </section>;
        })}
        {filtered.length === 0 && <p className="ui-gallery-search-empty" role="status">没有匹配项，请调整关键词。</p>}
      </aside>
      <main className="ui-gallery-main" ref={main}>
        <div className="ui-gallery-mobile-picker"><label>选择元素或组件
          <select aria-label="选择元素或组件" value={selected} onChange={event => setSelected(event.target.value)}>
            {Object.entries(categories).map(([category, label]) => <optgroup key={category} label={label}>
              {capabilityCatalogue.filter(entry => entry.category === category).map(entry =>
                <option key={entry.id} value={entry.id}>{entry.title} · {stageLabels[stageOf(entry)]}</option>)}
            </optgroup>)}
          </select>
        </label></div>
        <div className="ui-gallery-spec-heading" id="ui-gallery-contract">
          <div><Text tone="secondary">{String(index + 1).padStart(3, '0')} / {counts.all} · {categories[current.category]} · {stageLabels[stage]}</Text>
            <Heading>{current.title}</Heading><p>{current.anatomy}</p><code>{current.id}</code></div>
          <Tag data-review-status="pending">待逐项确认</Tag>
        </div>
        <section className="ui-gallery-stage" data-specimen-id={current.id} data-specimen-stage={stage}
          aria-label={`${current.title} ${stage === 'foundation' ? '组件样本' : '阶段定义'}`}>
          {stage === 'foundation' ? <FoundationSpecimen key={current.id} id={current.id}/> : <div className="ui-gallery-future">
            <span className="ui-gallery-eyebrow">{stageLabels[stage]}阶段</span>
            <Heading level={3}>定义已收录，样本待后续制作</Heading>
            <p>先逐项确认设计基础，再进入{stageLabels[stage]}样本。当前可查看本项的完整定义。</p>
            <p>交互、状态切换与恢复流程在各自阶段继续展开。</p>
          </div>}
        </section>
        <p className="ui-gallery-note">{stage === 'foundation' ? '本项样式与交互样本已制作，待逐项审阅。' : '本项目前提供完整定义，样本待后续制作。'}消费者迁移已暂停。</p>
        <nav className="ui-gallery-review-nav" aria-label="逐项浏览">
          <Button actionId="gallery.previous" label="上一项" availability={reviewIndex <= 0 ? {kind: 'disabled', reason: '当前范围的第一项'} : undefined}
            onActivate={() => setSelected(filtered[reviewIndex - 1].id)}/>
          <Text tone="secondary">{reviewIndex >= 0 ? `${reviewIndex + 1} / ${filtered.length}` : '当前项不在筛选范围'}</Text>
          <Button actionId="gallery.next" label="下一项" availability={reviewIndex < 0 || reviewIndex >= filtered.length - 1 ? {kind: 'disabled', reason: '当前范围没有下一项'} : undefined}
            onActivate={() => setSelected(filtered[reviewIndex + 1].id)}/>
        </nav>
        <div className="ui-gallery-contract-details" key={current.id}>
          <details open><summary>变体、状态与合法组合</summary>
            <p>{current.statePolicy}</p><ul>{current.variantAxes.map(axis => <li key={axis}>{axis}</li>)}</ul>
            <p>不合法组合：{current.invalidCombinations}</p></details>
          <details><summary>键盘、极值与生命周期定义</summary>
            <p>{current.accessibility}</p><p>{current.extremeData}</p><p>{current.lifecycleAndCleanup}</p><p>{current.geometryAndMotion}</p></details>
          <details><summary>Owner、源码与合同</summary>
            <p>{current.ownerBoundary}</p>
            <pre><code>{current.exports.length ? `import { ${current.exports.join(', ')} } from '@peers-touch/ui';` :
              '业务组合由对应业务模块维护，复用公共基础控件。'}</code></pre>
            <p>{current.implementationRefs.join(' · ')}</p><p>{current.specRef}</p>
            <p>本轮用户确认：待确认。真实业务、原生平台与完整交互证据：UNPROVEN。</p></details>
        </div>
      </main>
    </div></>}
  </div>;
}
