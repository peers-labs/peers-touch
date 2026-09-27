import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccessGateHost, authStationLabel } from './AccessGateHost';
import type { AccessDecision, AccessGateAction } from './authSession';

const recoveryMock = vi.hoisted(() => ({
  states: [] as Array<Record<string, unknown>>,
}));

vi.mock('../../app/mobileI18n', () => ({
  useMobileI18n: () => ({ t: (key: string) => key }),
}));
vi.mock('../../components/LanguageSwitcher', () => ({
  LanguageSwitcher: () => null,
}));
vi.mock('../../runtimes/authRuntime', () => ({
  cancelOAuth: vi.fn(),
  oauthPhaseMessageKey: (phase: string) => phase,
  refreshOAuthStatus: vi.fn(),
  retryOAuthBrowser: vi.fn(),
  startOAuth: vi.fn(),
  useAuthRuntime: () => ({
    phase: 'idle',
    errorKey: null,
    provider: undefined,
    recovery: 'none',
  }),
}));
vi.mock('../../runtimes/recoveryProjection', () => ({
  getRecoveryProjection: () => ({
    getSnapshot: () => ({
      states: recoveryMock.states,
      hasActiveRecovery: recoveryMock.states.length > 0,
    }),
    subscribe: () => () => undefined,
  }),
}));

const source = readFileSync(
  new URL('./AccessGateHost.tsx', import.meta.url),
  'utf8',
);

afterEach(() => {
  recoveryMock.states = [];
});

describe('AccessGateHost schema gate surface', () => {
  it('renders Station-authored scalar fields and delegates one bound submission', () => {
    expect(source).toContain('isSchemaDrivenGate(currentGate)');
    expect(source).toContain('data-acceptance-id="schema-access-gate"');
    expect(source).toContain('onSchemaSubmit(schemaValues)');
    expect(source).toContain('<Checkbox');
    expect(source).toContain('<Select');
    expect(source).toContain('<InputNumber');
  });
});

describe('AccessGateHost advertised credential gating', () => {
  it('renders email-only and OAuth-only Station advertisements independently', () => {
    const emailMarkup = renderGate([
      action('auth.password', 'ACCESS_GATE_TYPE_AUTH_LOGIN', 'submit_login'),
    ]);
    expect(emailMarkup).toContain('mobile.auth.emailAddress');
    expect(emailMarkup).not.toContain('mobile.auth.oauthGithub');

    const oauthMarkup = renderGate([
      action('auth.oauth', 'ACCESS_GATE_TYPE_AUTH_OAUTH', 'start_oauth'),
    ]);
    expect(oauthMarkup).toContain('mobile.auth.oauthGithub');
    expect(oauthMarkup).toContain('mobile.auth.oauthGoogle');
    expect(oauthMarkup).not.toContain('mobile.auth.emailAddress');
  });

  it('renders no credential control when no supported action is advertised', () => {
    const markup = renderGate([
      action('future.credential', 'ACCESS_GATE_TYPE_CUSTOM', 'future_action'),
    ]);

    expect(markup).toContain('mobile.launch.unavailable');
    expect(markup).not.toContain('mobile.auth.emailAddress');
    expect(markup).not.toContain('mobile.auth.oauthGithub');
  });

  it('renders email and OAuth only when their Station actions are advertised', () => {
    expect(source).toContain('advertisedCredentialChoices(currentGate)');
    expect(source).toContain('currentAccessGate(decision)');
    expect(source).toContain(
      'const showEmailLogin = credentialGateActive && credentialChoices.emailPassword;',
    );
    expect(source).toContain(
      'const showOAuthLogin = credentialGateActive && credentialChoices.oauth;',
    );
    expect(source).toContain('{showEmailLogin && showOAuthLogin ? (');
    expect(source).toContain('{showOAuthLogin ? (');
    expect(source).toContain('{showEmailLogin ? (');
    expect(source).toContain("gateId: currentGate?.gateId || 'auth.login'");
    expect(source).not.toContain('auth-oauth-wechat');
    expect(source).not.toContain('isLoginGate(currentGate) || !currentGate');
  });

  it('fails closed to the unavailable gate surface without a supported action', () => {
    expect(source).toMatch(
      /const showLogin = showEmailLogin \|\| showOAuthLogin;[\s\S]*const showUnavailableGate = ready[\s\S]*&& !showLogin/,
    );
    expect(source).toContain('{showUnavailableGate ? (');
  });
});

describe('AccessGateHost attempt recovery', () => {
  it.each([
    'ACCESS_DECISION_STATE_PENDING',
    'ACCESS_DECISION_STATE_BLOCKED',
    'ACCESS_DECISION_STATE_FAILED',
  ])('keeps refresh and cancellation visible for %s', (state) => {
    const markup = renderGate([], {
      decision: {
        state,
        attemptId: 'attempt-1',
        gates: [],
      },
    });

    expect(markup).toContain('mobile.auth.retryDecision');
    expect(markup).toContain('mobile.auth.changeStation');
    expect(markup).not.toContain('mobile.auth.emailAddress');
  });

  it('delegates retry and Station change to async recovery owners', () => {
    expect(source).toContain('onRefresh: () => Promise<void>');
    expect(source).toContain('onBack: () => Promise<void>');
    expect(source).toContain('onClick={() => void onRefresh()}');
    expect(source).toContain('onClick={() => void onBack()}');
  });
});

describe('AccessGateHost shared Auth identity', () => {
  it('uses the canonical Desktop logo asset in Mobile and its prototype', () => {
    const hash = (path: string) => createHash('sha256')
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest('hex');

    const desktop = hash('../../../../desktop/src-tauri/icons/icon.png');
    expect(hash('../../assets/logo.png')).toBe(desktop);
    expect(
      hash('../../../../../packages/prototypes/mobile/chat/src/assets/logo.png'),
    ).toBe(desktop);
  });

  it('keeps the brand and expired-session context inside the auth card', () => {
    recoveryMock.states = [{
      kind: 'device-local-flag',
      reason: 'session-expired',
      since: 1,
    }];

    const markup = renderGate([
      action('auth.oauth', 'ACCESS_GATE_TYPE_AUTH_OAUTH', 'start_oauth'),
    ], {
      rememberedAccounts: [{
        email: 'alice@peers.social',
        displayName: 'Alice',
        lastUsedAt: 1,
        ptid: 'alice',
        stationPeerId: 'station-peer',
        stationUrl: 'http://10.37.94.156:18132',
      }],
      stationLabel: '10.37.94.156:18132',
      stationUrl: 'http://10.37.94.156:18132',
    });

    expect(markup).toContain('auth-gate-logo');
    expect(markup).toContain('data-acceptance-id="auth-session-expired"');
    expect(markup).toContain('mobile.auth.welcomeBackTitle');
    expect(markup).toContain('common.stationPicker.fallbackLabel');
    expect(markup).not.toContain('PEERS TOUCH MOBILE');
    expect(markup).not.toContain('10.37.94.156');
    expect(source.indexOf('<Card className="auth-gate-card"')).toBeLessThan(
      source.indexOf('<section className="auth-gate-brand">'),
    );
  });

  it('preserves a friendly Station label and hides address-shaped labels', () => {
    expect(authStationLabel(
      'Mobile Development',
      'http://10.37.94.156:18132',
      'Station',
    )).toBe('Mobile Development');
    expect(authStationLabel(
      '10.37.94.156:18132',
      'http://10.37.94.156:18132',
      'Station',
    )).toBe('Station');
  });
});

function renderGate(
  alternativeActions: AccessGateAction[],
  overrides: Partial<Parameters<typeof AccessGateHost>[0]> = {},
): string {
  return renderToStaticMarkup(createElement(AccessGateHost, {
    decision: loginDecision(alternativeActions),
    stationLabel: 'Station',
    stationUrl: 'https://station.example',
    error: null,
    loading: false,
    rememberedAccounts: [],
    onBack: vi.fn(),
    onRefresh: vi.fn(),
    onLogin: vi.fn().mockResolvedValue(undefined),
    onInviteCode: vi.fn().mockResolvedValue(undefined),
    onSchemaSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }));
}

function loginDecision(alternativeActions: AccessGateAction[]): AccessDecision {
  return {
    state: 'ACCESS_DECISION_STATE_ACTION_REQUIRED',
    attemptId: 'attempt-1',
    currentGateId: 'auth.login',
    gates: [{
      gateId: 'auth.login',
      type: 'ACCESS_GATE_TYPE_AUTH_LOGIN',
      state: 'ACCESS_GATE_STATE_ACTION_REQUIRED',
      alternativeActions,
      actionId: 'auth.password',
      schemaRevision: 1,
      schemaDigest: 'a'.repeat(64),
    }],
  };
}

function action(
  actionId: string,
  type: AccessGateAction['type'],
  submitAction: string,
): AccessGateAction {
  return {
    actionId,
    type,
    submitAction,
    schemaRevision: 1,
    schemaDigest: 'a'.repeat(64),
  };
}
