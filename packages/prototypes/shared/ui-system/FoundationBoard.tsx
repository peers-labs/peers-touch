/**
 * FoundationBoard — 基础元素（组件）tab.
 *
 * Two honest layers only:
 *  1. The live north-star candidate TOKENS (resolved computed values, never a
 *     hand-painted palette) — color roles, geometry, elevation.
 *  2. The real CAPABILITY REGISTRY (registry.ts): every entry is implemented
 *     in @peers-touch/ui, vetted via specimen + prototype consumption, or a
 *     registered gap. No fabricated demos live here; reviewed state matrices
 *     belong to 样本 and compositions to 套件.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button, Text, northStarTheme } from '@peers-touch/ui';
import { CAPABILITIES, CATEGORIES, STATUS_LABEL, byStatus, type CapabilityRecord } from './registry';
import { ElementSamples, type SampleCondition } from './ElementSamples';

const SAMPLE_CONDITIONS: { value: SampleCondition; label: string }[] = [
  { value: 'normal', label: '标准' },
  { value: 'long', label: '长文案' },
  { value: 'disabled', label: '禁用' },
];

function useResolvedVar(varName: string, pseudo: 'color' | 'radius' | 'shadow' = 'color') {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    setValue(pseudo === 'radius' ? cs.borderTopLeftRadius
      : pseudo === 'shadow' ? cs.boxShadow : cs.backgroundColor);
  }, [varName, pseudo]);
  return { ref, value };
}

function Token({ name, token }: { name: string; token: string }) {
  const { ref, value } = useResolvedVar(token);
  return (
    <div className="nb-token">
      <span ref={ref} className="nb-token-chip" style={{ background: `var(${token})` }} />
      <span className="nb-token-meta">
        <span className="nb-token-name">{name}</span>
        <code className="nb-token-code">{value || token}</code>
      </span>
    </div>
  );
}

function Section({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="nb-section" data-nb-section={title}>
      <header className="nb-section-head"><h2>{title}</h2>{sub && <p>{sub}</p>}</header>
      <div className="nb-section-body">{children}</div>
    </section>
  );
}

const COLOR_ROWS: [string, string][] = [
  ['画布', '--pt-canvas'], ['阅读面', '--pt-surface'], ['次级面', '--pt-subtle'],
  ['浮层面', '--pt-raised'], ['主文字', '--pt-text'], ['次文字', '--pt-secondary'],
  ['弱文字', '--pt-muted'], ['主动作', '--pt-primary'], ['主动作上', '--pt-onPrimary'],
  ['主弱面', '--pt-primarySubtle'], ['发丝线', '--pt-border'], ['强描边', '--pt-borderStrong'],
  ['成功', '--pt-success'], ['警告', '--pt-warning'], ['危险', '--pt-danger'], ['信息', '--pt-info'],
];
const STATUS_COLORS: [string, string][] = [
  ['成功弱面', '--pt-successSubtle'], ['警告弱面', '--pt-warningSubtle'],
  ['危险弱面', '--pt-dangerSubtle'], ['信息弱面', '--pt-infoSubtle'],
];
const RADII: [string, string][] = [
  ['xs 标记', '--pt-radius-xs'], ['sm 紧凑控件', '--pt-radius-sm'],
  ['md 控件/头像', '--pt-radius-md'], ['lg 卡片/气泡', '--pt-radius-lg'],
  ['xl 窗口', '--pt-radius-xl'],
];
const SPACE = ['--pt-space-xxs', '--pt-space-xs', '--pt-space-sm', '--pt-space-md', '--pt-space-lg', '--pt-space-xl', '--pt-space-xxl'];
const CONTROLS: [string, string][] = [
  ['紧凑', '--pt-control-compact'], ['标准', '--pt-control-normal'], ['触摸', '--pt-control-comfortable'],
];

function GeomDemo({ token, radius }: { token: string; radius?: boolean }) {
  const { ref, value } = useResolvedVar(token, radius ? 'radius' : 'shadow');
  return (
    <div className="nb-geom">
      <span ref={ref} className="nb-geom-demo" style={radius
        ? { width: 34, height: 34, borderRadius: `var(${token})` }
        : { width: 34, height: 34, borderRadius: 8, boxShadow: `var(${token})`, background: 'var(--pt-surface)' }} />
      <span>{radius ? value : token.replace('--pt-shadow-', '')}</span>
      <code>{token}</code>
    </div>
  );
}

function ControlDemo({ token, name }: { token: string; name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    if (ref.current) setValue(getComputedStyle(ref.current).height);
  }, []);
  return (
    <div className="nb-geom">
      <span ref={ref} style={{
        display: 'block', width: 44, height: `var(${token})`,
        background: 'var(--pt-primary-subtle)', border: '1px solid var(--pt-border)', borderRadius: 6,
      }} />
      <span>{name}</span>
      <code>{value}</code>
    </div>
  );
}

function CategoryGroup({ category, records }: { category: string; records: CapabilityRecord[] }) {
  const [open, setOpen] = useState(records.some(r => r.status !== 'implemented'));
  return (
    <div className="nb-cat" data-open={open}>
      <Button actionId={`registry.category.${category}`} emphasis="quiet" className="nb-cat-head"
        aria-expanded={open} onActivate={() => setOpen(v => !v)}>
        <ChevronRight size={14} className="nb-chevron" />
        <strong>{category}</strong>
        <em>{records.length} 项 · 已验收 {records.filter(r => r.status === 'vetted').length} · 缺口 {records.filter(r => r.status === 'gap').length}</em>
      </Button>
      {open && <div className="nb-cat-body">
        {records.map(record => (
          <div className="nb-cap" key={record.id} data-cap={record.id} data-cap-status={record.status}>
            <span className="nb-cap-title">{record.title}</span>
            <code className="nb-cap-code" title={record.id}>{record.id}</code>
            <span className="nb-kind">{record.kind === 'primitive' ? '基础件' : '组合件'}</span>
            <span className="nb-cap-desc" title={record.status === 'gap' ? `需求来源：${record.neededBy ?? ''}` : (record.consumedBy?.join(' · ') ?? '')}>
              {record.status === 'gap' ? `需求来源：${record.neededBy ?? ''}` : record.consumedBy?.join(' · ')}
            </span>
            <span className="nb-status" data-status={record.status}>{STATUS_LABEL[record.status]}</span>
          </div>
        ))}
      </div>}
    </div>
  );
}

export function FoundationBoard() {
  const [condition, setCondition] = useState<SampleCondition>('normal');
  const counts = {
    vetted: byStatus('vetted').length,
    implemented: byStatus('implemented').length,
    gap: byStatus('gap').length,
  };
  return (
    <div className="nb-shell" data-nb="elements">
      <header className="nb-head">
        <div>
          <span className="nb-overline">PEERS / BASE ELEMENTS</span>
          <h1>基础元素（组件）</h1>
          <p>
            令牌当前为候选主题 <code>{northStarTheme.id}</code>（{northStarTheme.status} · 仅限原型与样本），
            由桌面原型人审通过的松绿玻璃语法晋升而来；生产默认仍是冷墨主题，两套并存，不隐式替换。
            能力登记只列真实存在的组件：已验收 {counts.vetted}（有样本且被原型消费）、实样待消费 {counts.implemented}（下方组件实样可跑、尚未被原型消费）、缺口 {counts.gap}。
          </p>
        </div>
      </header>

      <div className="nb-canvas">
        <Section title="颜色与表面" sub="直接渲染 var(--pt-*) 并读取实时计算值；色只为语义服务，主动作是近墨而非品牌色。">
          <div className="nb-token-grid">{COLOR_ROWS.map(([name, token]) => <Token key={token} name={name} token={token} />)}</div>
          <h3 className="nb-section-title" style={{ fontSize: 12, color: 'var(--pt-muted)', margin: '16px 0 8px', fontWeight: 650 }}>状态弱面</h3>
          <div className="nb-token-grid">{STATUS_COLORS.map(([name, token]) => <Token key={token} name={name} token={token} />)}</div>
        </Section>

        <Section title="几何" sub="圆角家族、间距节奏与控件高度；全圆只属于点状标记，不属于头像与交互容器。">
          <div className="nb-geom-row" style={{ marginBottom: 18 }}>
            {RADII.map(([name, token]) => <GeomDemo key={token} token={token} radius />)}
          </div>
          <div className="nb-geom-row" style={{ marginBottom: 18 }}>
            {SPACE.map(token => (
              <div className="nb-geom" key={token}>
                <span style={{
                  display: 'block', height: 10, width: `var(${token})`,
                  background: 'var(--pt-primary)', borderRadius: 2,
                }} />
                <code>{token.replace('--pt-space-', '')}</code>
              </div>
            ))}
          </div>
          <div className="nb-geom-row">
            {CONTROLS.map(([name, token]) => <ControlDemo key={token} token={token} name={name} />)}
          </div>
        </Section>

        <Section title="抬升" sub="静息/轻抬/浮层三档；内容卡片靠色调步进+发丝+静息阴影，不靠描边堆叠。">
          <div className="nb-geom-row">
            <GeomDemo token="--pt-shadow-rest" />
            <GeomDemo token="--pt-shadow-soft" />
            <GeomDemo token="--pt-shadow-float" />
          </div>
        </Section>

        <section className="nb-section" data-nb-section="组件实样">
          <header className="nb-section-head nb-samples-head">
            <div>
              <h2>组件实样</h2>
              <p>登记册里每一件可渲染组件都在此渲染真实原语（非仿画）；同一条件开关检验标准态、长文案与禁用态。已验收还需被原型消费，未消费的实样只证明「库里能跑」。</p>
            </div>
            <span className="nb-condition-switch" role="group" aria-label="实样条件">
              {SAMPLE_CONDITIONS.map(opt => (
                <Button key={opt.value} actionId={`elements.condition.${opt.value}`}
                  emphasis={condition === opt.value ? 'secondary' : 'quiet'}
                  aria-pressed={condition === opt.value} onActivate={() => setCondition(opt.value)}>{opt.label}</Button>
              ))}
            </span>
          </header>
          <ElementSamples condition={condition} />
        </section>

        <section className="nb-section">
          <header className="nb-section-head">
            <h2>能力登记册</h2>
            <p>已验收 = 有样本且被原型消费；缺口 = 原型仍在私写、等待先晋升进库（点击展开各组）。</p>
          </header>
          <div className="nb-registry" data-nb-registry>
            {CATEGORIES.map(cat => {
              const records = CAPABILITIES.filter(r => r.category === cat.id);
              if (!records.length) return null;
              return <CategoryGroup key={cat.id} category={cat.title} records={records} />;
            })}
          </div>
        </section>
        <Text tone="secondary" style={{ fontSize: 11.5 }}>
          共 {CAPABILITIES.length} 条登记。新原型功能需要元素时先查此册；没有就先补基础件与样本，再回原型消费——见「设计理念」自训练宪章。
        </Text>
      </div>
    </div>
  );
}
