/**
 * BaseElementKit — foundational ELEMENTS (tokens & atoms), owner visual review.
 *
 * Hierarchy note: this sits BELOW the "基础组件" (real components) board. It is
 * a read-only TOKEN READER, not a second palette:
 *  - every chip/box is painted with `var(--pt-*)` and the displayed value is
 *    the live resolved computed value, so the board can never drift from the
 *    actual tokens the components consume;
 *  - geometry/radius/space/shadow show the ACTIVE token scale (the draft
 *    material expression only overrides a subset of colors, never geometry);
 *  - draft expression-only roles live under the `--as-*` group and are marked
 *    draft — they are not constitutional `--pt-*` tokens.
 *
 * No invented role names, no hard-coded hex, no hand-drawn product shell.
 */
import { useEffect, useRef, useState } from 'react';
import {
  UIProvider, Button, IconButton, Icon, Heading, Text, Paragraph,
  expressionCandidateVariables,
} from '@peers-touch/ui';
import './base-element-kit.css';

/* ---------- live token resolution ---------- */

function useResolvedVar(varName: string, pseudo?: 'color' | 'image' | 'radius' | 'shadow') {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState('');
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const v = pseudo === 'color' ? cs.backgroundColor
      : pseudo === 'image' ? cs.backgroundImage
      : pseudo === 'radius' ? cs.borderTopLeftRadius
      : pseudo === 'shadow' ? cs.boxShadow
      : cs.getPropertyValue(varName).trim();
    setValue(v);
  }, [varName, pseudo]);
  return { ref, value };
}

function Section({ id, title, sub, children }: {
  id: string; title: string; sub?: string; children: React.ReactNode;
}) {
  return (
    <section className="bk-section" data-section={id}>
      <header className="bk-section-head">
        <h2>{title}</h2>
        {sub && <p>{sub}</p>}
      </header>
      <div className="bk-section-body">{children}</div>
    </section>
  );
}

/* ---------- color ---------- */

function ColorRow({ name, token, onDark, gradient }: { name: string; token: string; onDark?: boolean; gradient?: boolean }) {
  const { ref, value } = useResolvedVar(token, gradient ? 'image' : 'color');
  return (
    <div className="bk-swatch-row" data-token-role={token} data-gradient={gradient ? '1' : undefined}>
      <span ref={ref} className="bk-swatch-chip" style={{ background: `var(${token})` }} data-on-dark={onDark ? '1' : undefined} />
      <span className="bk-swatch-name" data-dark={onDark ? '1' : undefined}>{name}</span>
      <code className="bk-token-name">{token}</code>
      <code className="bk-hex" data-resolved-value>{value}</code>
    </div>
  );
}

const SURFACE_COLORS: [string, string, boolean?][] = [
  ['画布 recessed floor', '--pt-canvas'],
  ['阅读卡片 surface', '--pt-surface'],
  ['次级面 subtle/well', '--pt-subtle'],
  ['浮层 raised', '--pt-raised'],
  ['主文字 text', '--pt-text', true],
  ['次级文字 secondary', '--pt-secondary', true],
  ['弱化文字 muted', '--pt-muted', true],
];
const ACTION_COLORS: [string, string, boolean?][] = [
  ['主操作 primary', '--pt-primary', true],
  ['主操作悬停 primaryHover', '--pt-primaryHover', true],
  ['主操作上文字 onPrimary', '--pt-onPrimary'],
  ['主操作弱面 primarySubtle', '--pt-primarySubtle'],
  ['焦点 focus', '--pt-focus', true],
];
const STATUS_COLORS: [string, string, boolean?][] = [
  ['成功 success', '--pt-success', true],
  ['成功弱面 successSubtle', '--pt-successSubtle'],
  ['警告 warning', '--pt-warning', true],
  ['警告弱面 warningSubtle', '--pt-warningSubtle'],
  ['危险 danger', '--pt-danger', true],
  ['危险弱面 dangerSubtle', '--pt-dangerSubtle'],
  ['信息 info', '--pt-info', true],
  ['信息弱面 infoSubtle', '--pt-infoSubtle'],
];
const LINE_COLORS: [string, string][] = [
  ['发丝线 border', '--pt-border'],
  ['强描边 borderStrong', '--pt-borderStrong'],
  ['遮罩 scrim', '--pt-scrim'],
];
const DRAFT_COLORS: [string, string, boolean?, boolean?][] = [
  ['强调琥珀（draft）', '--as-accent'],
  ['青墨（draft）', '--as-teal'],
  ['选中渐变（draft）', '--as-selection', false, true],
];

type ColorDef = [string, string, boolean?, boolean?];
function ColorGroup({ title, rows }: { title: string; rows: ColorDef[] }) {
  return (
    <div className="bk-color-group">
      <h3>{title}</h3>
      <div className="bk-grid bk-grid-colors">
        {rows.map(([name, token, onDark, gradient]) =>
          <ColorRow key={token} name={name} token={token} onDark={onDark} gradient={gradient} />)}
      </div>
    </div>
  );
}

/* ---------- geometry ---------- */

function RadiusRow({ name, token, usage }: { name: string; token: string; usage: string }) {
  const { ref, value } = useResolvedVar(token, 'radius');
  return (
    <div className="bk-geom-row" data-token-role={token}>
      <span ref={ref} className="bk-radius-demo" style={{ borderRadius: `var(${token})` }} />
      <div className="bk-geom-meta">
        <span className="bk-geom-name">{name}</span>
        <code className="bk-token-name">{token}</code>
        <code className="bk-hex" data-resolved-value>{value}</code>
        <span className="bk-geom-usage">{usage}</span>
      </div>
    </div>
  );
}

function ShadowRow({ name, token, usage }: { name: string; token: string; usage: string }) {
  const { ref, value } = useResolvedVar(token, 'shadow');
  return (
    <div className="bk-geom-row" data-token-role={token}>
      <span ref={ref} className="bk-shadow-demo" style={{ boxShadow: `var(${token})` }} />
      <div className="bk-geom-meta">
        <span className="bk-geom-name">{name}</span>
        <code className="bk-token-name">{token}</code>
        <code className="bk-hex bk-shadow-value" data-resolved-value>{value}</code>
        <span className="bk-geom-usage">{usage}</span>
      </div>
    </div>
  );
}

const RADII: [string, string, string][] = [
  ['xs', '--pt-radius-xs', 'chip / 指示'],
  ['sm', '--pt-radius-sm', '紧凑控件'],
  ['md', '--pt-radius-md', '按钮 / 输入 / 列表项'],
  ['lg', '--pt-radius-lg', '卡片 / 气泡'],
  ['xl', '--pt-radius-xl', '窗口 / dialog'],
  ['full', '--pt-radius-full', '仅 marker / 点，不用于头像与交互容器'],
];
const SPACE: [string, string][] = [
  ['xxs 4', '--pt-space-xxs'], ['xs 8', '--pt-space-xs'], ['sm 12', '--pt-space-sm'],
  ['md 16', '--pt-space-md'], ['lg 20', '--pt-space-lg'], ['xl 24', '--pt-space-xl'], ['xxl 32', '--pt-space-xxl'],
];
const CONTROLS: [string, string, string][] = [
  ['compact', '--pt-control-compact', '紧凑命令 28'],
  ['normal', '--pt-control-normal', '标准命令 36'],
  ['comfortable', '--pt-control-comfortable', '触摸命中目标 44（提案，非视觉档）'],
];

/* ---------- type ---------- */

function TypeRow({ role, sample, value, children }: {
  role: string; sample: string; value: string; children: React.ReactNode;
}) {
  return (
    <div className="bk-type-row" data-token-role={role}>
      <div className="bk-type-sample">{children}</div>
      <div className="bk-type-meta">
        <span className="bk-type-label">{sample}</span>
        <code className="bk-token-name">{role}</code>
        <code className="bk-hex">{value}</code>
      </div>
    </div>
  );
}

/* ---------- buttons (real primitives, full state matrix) ---------- */

const disabledSample = { kind: 'disabled' as const, reason: '当前为禁用样本' };

export function BaseElementKit() {
  return (
    <UIProvider theme="light" className="pt-expression-candidate" style={expressionCandidateVariables('light')}>
      <div className="bk-canvas">
        <div className="bk-window bk-app">
          <div className="bk-app-main">
            <header className="bk-window-bar">
              <span className="bk-window-title">Peers Base Elements · 基础元素</span>
              <span className="bk-window-tag">tokens · 颜色为 draft 表达，几何为 active</span>
            </header>

            <div className="bk-window-body">
              <Section id="color" title="颜色与表面" sub="直接渲染 var(--pt-*) 并读取实时计算值；颜色随 draft 表达，几何不随。">
                <ColorGroup title="表面 / 文字" rows={SURFACE_COLORS} />
                <ColorGroup title="动作" rows={ACTION_COLORS} />
                <ColorGroup title="状态" rows={STATUS_COLORS} />
                <ColorGroup title="线 / 遮罩" rows={LINE_COLORS} />
                <ColorGroup title="Draft 表达（--as-*，未提升 token）" rows={DRAFT_COLORS} />
              </Section>

              <Section id="type" title="文字层级" sub="由真实 Heading/Paragraph/Text 组件承载；数值来自 active 字阶，未发明额外 type token。">
                <div className="bk-type-list">
                  <TypeRow role="Heading level=2 · 30/600" sample="页面主标题" value="-- heading2 30 · strong 600">
                    <Heading level={2}>页面主标题</Heading>
                  </TypeRow>
                  <TypeRow role="Heading level=3 · 20/600" sample="区块标题" value="-- heading4 20 · strong 600">
                    <Heading level={3}>区块标题</Heading>
                  </TypeRow>
                  <TypeRow role="Paragraph · body 14" sample="正文内容，需要清晰可读，强于辅助信息。" value="-- body 14 / line-height 1.5">
                    <Paragraph>正文内容，需要清晰可读，强于辅助信息。</Paragraph>
                  </TypeRow>
                  <TypeRow role="Text · small 12" sample="时间 · 站点 · 标识" value="-- small 12">
                    <Text tone="secondary">时间 · 站点 · 标识</Text>
                  </TypeRow>
                  <TypeRow role="Text as=code · mono" sample="group.design-review" value="-- --pt-mono">
                    <Text as="code">group.design-review</Text>
                  </TypeRow>
                </div>
              </Section>

              <Section id="geometry" title="几何：圆角 / 间距 / 控件 / 阴影" sub="全部读取 active token 计算值；全圆仅 marker，不用于头像与交互容器。">
                <h3 className="bk-geom-group-title">圆角</h3>
                <div className="bk-grid bk-grid-geom">
                  {RADII.map(([name, token, usage]) => <RadiusRow key={token} name={name} token={token} usage={usage} />)}
                </div>
                <h3 className="bk-geom-group-title">间距（px）</h3>
                <div className="bk-space-row">
                  {SPACE.map(([name, token]) => (
                    <span key={token} className="bk-space-chip" data-token-role={token}>
                      <span className="bk-space-bar" style={{ width: `var(${token})` }} />
                      <code className="bk-token-name">{token}</code>
                      <code className="bk-hex">{name}</code>
                    </span>
                  ))}
                </div>
                <h3 className="bk-geom-group-title">控件高度 / 触摸目标</h3>
                <div className="bk-control-row">
                  {CONTROLS.map(([name, token, usage]) => (
                    <span key={token} className="bk-control-chip" data-token-role={token}>
                      <span className="bk-control-bar" style={{ height: `var(${token})` }} />
                      <code className="bk-token-name">{token}</code>
                      <span className="bk-geom-usage">{usage}</span>
                    </span>
                  ))}
                </div>
                <h3 className="bk-geom-group-title">阴影（静息抬升）</h3>
                <div className="bk-grid bk-grid-geom">
                  <ShadowRow name="rest" token="--pt-shadow-rest" usage="阅读卡片在 recessed 画布上" />
                  <ShadowRow name="soft" token="--pt-shadow-soft" usage="toast / hover 轻抬升" />
                  <ShadowRow name="float" token="--pt-shadow-float" usage="menu / popover / dialog" />
                </div>
              </Section>

              <Section id="buttons" title="按钮（由基础组件承载）" sub="action.* 语义全部来自公共 Button/IconButton；完整合同场景见「基础组件 20 · 按钮」。">
                <div className="bk-btn-matrix">
                  <div className="bk-btn-row">
                    <span className="bk-btn-row-label">层级<code>emphasis</code></span>
                    <Button actionId="bk.primary" emphasis="primary" leading={<Icon iconId="plus" size={16} />}>主操作</Button>
                    <Button actionId="bk.secondary">次操作</Button>
                    <Button actionId="bk.quiet" emphasis="quiet">安静操作</Button>
                    <Button actionId="bk.inline" emphasis="inline">链接式操作</Button>
                  </div>
                  <div className="bk-btn-row">
                    <span className="bk-btn-row-label">图标 / 选中<code>IconButton · pressed</code></span>
                    <IconButton actionId="bk.icon.search" iconId="search" label="搜索" emphasis="secondary" />
                    <IconButton actionId="bk.icon.plus" iconId="plus" label="新建" emphasis="quiet" />
                    <IconToggleSpec />
                  </div>
                  <div className="bk-btn-row">
                    <span className="bk-btn-row-label">状态<code>availability · execution</code></span>
                    <Button actionId="bk.disabled.primary" emphasis="primary" availability={disabledSample}>禁用主操作</Button>
                    <Button actionId="bk.pending" emphasis="primary" execution="pending" executionLabel="处理中">处理中</Button>
                    <Button actionId="bk.recovering" execution="recovering" executionLabel="恢复中">恢复中</Button>
                  </div>
                  <div className="bk-btn-row">
                    <span className="bk-btn-row-label">危险<code>tone.danger</code></span>
                    <Button actionId="bk.danger.quiet" tone="danger" emphasis="quiet" leading={<Icon iconId="delete" size={15} />}>删除</Button>
                    <Button actionId="bk.danger.primary" tone="danger" emphasis="primary">永久删除</Button>
                  </div>
                </div>
              </Section>
            </div>
          </div>
        </div>
      </div>
    </UIProvider>
  );
}

/** Pressed/selected icon action — demonstrates the aria-pressed state for real. */
function IconToggleSpec() {
  const [pinned, setPinned] = useState(false);
  return (
    <IconButton actionId="bk.icon.star" iconId={pinned ? 'check' : 'star'}
      label={pinned ? '取消收藏' : '收藏'} emphasis="quiet"
      aria-pressed={pinned} onActivate={() => setPinned(value => !value)} />
  );
}
