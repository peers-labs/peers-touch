import type { AtelierBudgetStatus } from './projection.contract.generated';
import type { BudgetDimensionProjection, BudgetProjection } from './types';

export interface PrototypeBudgetProjectionView {
  dimensions: BudgetDimensionProjection[];
  tone: AtelierBudgetStatus;
  progressPercent: number;
  summary: string;
  title: string;
  showDimensions: boolean;
}

export function derivePrototypeBudgetProjectionView(input: {
  budget?: BudgetProjection;
  fallbackPercent: number;
  fallbackLabel: string;
}): PrototypeBudgetProjectionView {
  const fallbackDimension = buildPrototypeBudgetFallbackDimension(input.fallbackPercent);
  const dimensions = input.budget?.dimensions ?? [fallbackDimension];
  const tone = input.budget?.status ?? dimensions[0]?.status ?? 'ok';
  const summary = input.budget?.summary ?? input.fallbackLabel;
  const decisionHint = input.budget?.decisionHint ??
    'Read-only Station budget projection; halt, cap increase, and resume stay in Station decision routing.';

  return {
    dimensions,
    tone,
    progressPercent: clampBudgetPercent(dimensions[0]?.percent ?? input.fallbackPercent),
    summary,
    title: `${decisionHint} ${dimensions.map(formatBudgetDimensionTitle).join(' · ')}`,
    showDimensions: Boolean(input.budget),
  };
}

export function prototypeBudgetToneColorKey(tone: AtelierBudgetStatus): 'danger' | 'warning' | 'primary' {
  if (tone === 'blocked' || tone === 'danger') return 'danger';
  if (tone === 'warning') return 'warning';
  return 'primary';
}

function buildPrototypeBudgetFallbackDimension(fallbackPercent: number): BudgetDimensionProjection {
  return {
    id: 'money',
    label: 'Money',
    used: fallbackPercent,
    cap: 100,
    unit: '%',
    percent: fallbackPercent,
    status: fallbackPercent >= 90 ? 'danger' : fallbackPercent >= 75 ? 'warning' : 'ok',
  };
}

function clampBudgetPercent(percent: number): number {
  return Math.min(100, Math.max(0, percent));
}

function formatBudgetDimensionTitle(item: BudgetDimensionProjection): string {
  return `${item.label}: ${item.used}/${item.cap}${item.unit} (${item.percent}%)`;
}
