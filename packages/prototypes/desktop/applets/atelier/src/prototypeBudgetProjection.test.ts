import { describe, expect, it } from 'vitest';
import {
  derivePrototypeBudgetProjectionView,
  prototypeBudgetToneColorKey,
} from './prototypeBudgetProjection';
import type { BudgetProjection } from './types';

describe('prototypeBudgetProjection', () => {
  it('builds a fallback read-only budget projection when Station budget is absent', () => {
    expect(derivePrototypeBudgetProjectionView({
      fallbackPercent: 76,
      fallbackLabel: '76%',
    })).toMatchObject({
      dimensions: [{
        id: 'money',
        label: 'Money',
        used: 76,
        cap: 100,
        unit: '%',
        percent: 76,
        status: 'warning',
      }],
      tone: 'warning',
      progressPercent: 76,
      summary: '76%',
      showDimensions: false,
    });
  });

  it('uses Station budget projection dimensions and clamps progress display percent', () => {
    const budget: BudgetProjection = {
      status: 'blocked',
      summary: 'Budget blocked',
      decisionHint: 'Station decision required.',
      dimensions: [{
        id: 'tokens',
        label: 'Tokens',
        used: 120,
        cap: 100,
        unit: '%',
        percent: 125,
        status: 'danger',
      }],
    };

    expect(derivePrototypeBudgetProjectionView({
      budget,
      fallbackPercent: 20,
      fallbackLabel: '20%',
    })).toMatchObject({
      dimensions: budget.dimensions,
      tone: 'blocked',
      progressPercent: 100,
      summary: 'Budget blocked',
      title: 'Station decision required. Tokens: 120/100% (125%)',
      showDimensions: true,
    });
  });

  it('keeps fallback title on Station-owned routing and clamps low progress display percent', () => {
    expect(derivePrototypeBudgetProjectionView({
      fallbackPercent: -12,
      fallbackLabel: 'fallback',
    })).toMatchObject({
      progressPercent: 0,
      title: 'Read-only Station budget projection; halt, cap increase, and resume stay in Station decision routing. Money: -12/100% (-12%)',
    });
  });

  it('maps budget tones to display color keys without creating budget actions', () => {
    expect(prototypeBudgetToneColorKey('blocked')).toBe('danger');
    expect(prototypeBudgetToneColorKey('danger')).toBe('danger');
    expect(prototypeBudgetToneColorKey('warning')).toBe('warning');
    expect(prototypeBudgetToneColorKey('ok')).toBe('primary');
  });
});
