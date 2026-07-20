import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { message, notification, theme, Typography } from 'antd';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useOAuth2Store } from '../../store/oauth2';
import { useSessionStore } from '../../store/session';
import { api, AuthCommandException } from '../../services/desktop_api';
import type { OAuth2ProviderSummary } from '../../services/desktop_api';
import {
  accessDecisionMessage,
  currentGate,
  isAccessBlocked,
  isAccessGranted,
  isInviteCodeGate,
  type AccessDecision,
} from '../../services/accessGate';
import { UserSquareAvatar } from '../../components/common/UserSquareAvatar';
import { StationNetworkIntro } from '../../components/common/StationNetworkIntro';
import { AccountPickerView } from './views/AccountPickerView';
import { PinEntryView } from './views/PinEntryView';
import { SetPinView } from './views/SetPinView';
import { RelinkPinView } from './views/RelinkPinView';
import { WelcomeBackView } from './views/WelcomeBackView';
import { LoginFormView, type GateState } from './views/LoginFormView';
import { OAuthDrawerPanel } from './components/OAuthDrawerPanel';
import {
  CARD_WIDTH,
  CARD_MIN_HEIGHT,
  LOGIN_CARD_MIN_HEIGHT,
  REAUTH_CARD_MIN_HEIGHT,
  PANEL_WIDTH,
  ARROW_SIZE,
  PANEL_GAP,
} from './constants';
import { accountIdentityToSessionUser, type LoginState, type LoginTab, type AuthState, type SessionUser } from './types';

const { Text } = Typography;

interface Props {
  onComplete: () => Promise<void>;
  onLoginWithOAuthBridge: () => Promise<void>;
  onSwitchAccount: (accountId: string) => Promise<void>;
  onUnlockWithPin: (accountId: string, pin: string) => Promise<void>;
  restoredUser?: SessionUser | null;
  knownAccounts?: SessionUser[];
  embedded?: boolean;
}

function loginCardMinHeight(loginState: LoginState, hasExpiredAccount: boolean): number {
  if (loginState !== 'logged_out') return CARD_MIN_HEIGHT;
  return hasExpiredAccount ? REAUTH_CARD_MIN_HEIGHT : LOGIN_CARD_MIN_HEIGHT;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function LoginPage({
  onComplete,
  onLoginWithOAuthBridge,
  onSwitchAccount,
  onUnlockWithPin,
  restoredUser,
  knownAccounts = [],
  embedded,
}: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');
  const { providers, connections, loadAll, startAuth } = useOAuth2Store();
  const { accessStart, accessSubmitInviteCode, accessSubmitLogin } = useSessionStore();

  // ── Determine initial state ──
  const hasValidRestoredUser = !!(restoredUser && restoredUser.name && restoredUser.name !== 'User');
  const hasMultipleAccounts = knownAccounts.length > 0;
  const initialState: LoginState = hasMultipleAccounts
    ? 'account_picker'
    : hasValidRestoredUser
      ? 'welcome_back'
      : 'logged_out';

  // ── Core state machine ──
  const [loginState, setLoginState] = useState<LoginState>(initialState);
  const [tab, setTab] = useState<LoginTab>('quick');
  const [selectedAccount, setSelectedAccount] = useState<SessionUser | null>(null);
  const [expiredAccount, setExpiredAccount] = useState<SessionUser | null>(null);
  const [reauthReason, setReauthReason] = useState<'revoked' | 'continue'>('continue');
  const [sessionlessAccountIds, setSessionlessAccountIds] = useState<Set<string>>(() => new Set());

  // ── PIN states ──
  const [pinLoading, setPinLoading] = useState(false);
  const [pinError, setPinError] = useState('');
  const [pinRevoked, setPinRevoked] = useState(false);
  const [relinkPinLoading, setRelinkPinLoading] = useState(false);
  const [relinkPinError, setRelinkPinError] = useState('');
  const [pinSetLoading, setPinSetLoading] = useState(false);
  const [pinSetError, setPinSetError] = useState('');

  // ── OAuth drawer state ──
  const [connectProvider, setConnectProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [authError, setAuthError] = useState('');
  const [arrowTop, setArrowTop] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelTop, setPanelTop] = useState(0);

  // ── Gate state ──
  const [gateDecision, setGateDecision] = useState<AccessDecision | null>(null);
  const [gateError, setGateError] = useState('');
  const [gateLoading, setGateLoading] = useState(false);
  const [gateInviteCode, setGateInviteCode] = useState('');

  // ── Refs for email login (needed for gate chain) ──
  const emailRef = useRef('');
  const passwordRef = useRef('');

  useEffect(() => { loadAll(); }, [loadAll]);

  // Guard: if welcome_back without authentication, redirect
  useEffect(() => {
    if (loginState === 'welcome_back') {
      const { authenticated } = useSessionStore.getState();
      if (!authenticated) setLoginState('logged_out');
    }
  }, [loginState]);

  // ── Helpers ──

  const markAccountSessionless = useCallback((accountId?: string) => {
    if (!accountId) return;
    setSessionlessAccountIds(prev => {
      if (prev.has(accountId)) return prev;
      const next = new Set(prev);
      next.add(accountId);
      return next;
    });
  }, []);

  const clearAccountSessionless = useCallback((accountId?: string) => {
    if (!accountId) return;
    setSessionlessAccountIds(prev => {
      if (!prev.has(accountId)) return prev;
      const next = new Set(prev);
      next.delete(accountId);
      return next;
    });
  }, []);

  const visibleAccounts = useMemo(
    () => knownAccounts.map(account => (
      account.accountId && sessionlessAccountIds.has(account.accountId)
        ? { ...account, hasSession: false }
        : account
    )),
    [knownAccounts, sessionlessAccountIds],
  );

  const welcomeUser: SessionUser = useMemo(() => {
    if (selectedAccount && selectedAccount.name) return selectedAccount;
    if (restoredUser && restoredUser.name) return restoredUser;
    return { name: '', email: '' };
  }, [selectedAccount, restoredUser]);

  // ── Post-auth flow ──

  const continueAfterFreshAuth = useCallback(async () => {
    try {
      const active = await api.accountGetActive();
      if (active?.id) {
        clearAccountSessionless(active.id);
        const user = accountIdentityToSessionUser(active);
        setSelectedAccount(user);

        if (active.has_pin) {
          setRelinkPinError('');
          setRelinkPinLoading(false);
          setLoginState('relink_pin');
          return;
        }
      }
    } catch {
      // Fall through to first-time PIN prompt
    }
    setLoginState('set_pin');
  }, [clearAccountSessionless]);

  // ── Gate chain ──

  const finishLoginGate = useCallback(async (attemptId: string) => {
    await accessSubmitLogin(attemptId, emailRef.current, passwordRef.current);
    setGateDecision(null);
    setGateInviteCode('');
    await continueAfterFreshAuth();
  }, [accessSubmitLogin, continueAfterFreshAuth]);

  // ── Route to provider login ──

  const routeToProviderLogin = useCallback((account: SessionUser, expired: boolean) => {
    setSelectedAccount(account);
    if (expired) markAccountSessionless(account.accountId);
    setExpiredAccount(account);
    setReauthReason(expired ? 'revoked' : 'continue');
    setPinError('');
    setPinRevoked(false);

    const provider = (account.provider || '').toLowerCase();
    if (provider === 'password' || provider === '' || provider === 'email') {
      setTab('email');
      emailRef.current = account.email || '';
    } else {
      setTab('quick');
    }
    setLoginState('logged_out');
  }, [markAccountSessionless]);

  // ── Event handlers ──

  const handleSwitchAccount = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
    setExpiredAccount(null);
    if (hasMultipleAccounts) {
      setLoginState('account_picker');
    } else {
      setLoginState('logged_out');
      setTab('quick');
    }
  }, [hasMultipleAccounts]);

  const handleBackToWelcome = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
    if (hasMultipleAccounts) {
      setLoginState('account_picker');
    } else if (hasValidRestoredUser) {
      setLoginState('welcome_back');
    }
  }, [hasMultipleAccounts, hasValidRestoredUser]);

  const handleNewAccountLogin = useCallback(() => {
    setExpiredAccount(null);
    setSelectedAccount(null);
    emailRef.current = '';
    passwordRef.current = '';
    setLoginState('logged_out');
    setTab('quick');
  }, []);

  const handleSelectAccount = useCallback(async (account: SessionUser) => {
    setSelectedAccount(account);
    setPinError('');
    setExpiredAccount(null);

    if (account.hasPin && account.hasSession) {
      setLoginState('pin_entry');
      return;
    }

    if (account.hasSession && account.accountId) {
      try {
        await onSwitchAccount(account.accountId);
        const { currentUser } = useSessionStore.getState();
        if (currentUser?.email && account.email && currentUser.email !== account.email) {
          routeToProviderLogin(account, true);
          return;
        }
        setLoginState('welcome_back');
      } catch {
        if (account.accountId) {
          try { await api.accountClearSession(account.accountId); } catch { /* noop */ }
          markAccountSessionless(account.accountId);
        }
        routeToProviderLogin(account, true);
      }
      return;
    }

    routeToProviderLogin(account, false);
  }, [onSwitchAccount, routeToProviderLogin, markAccountSessionless]);

  // ── PIN entry ──

  const handlePinSubmit = useCallback(async (pin: string) => {
    if (!selectedAccount?.accountId) return;
    setPinLoading(true);
    setPinError('');
    try {
      await onUnlockWithPin(selectedAccount.accountId, pin);
    } catch (err: any) {
      const details = err instanceof AuthCommandException ? err.details : undefined;
      const isRevoked = details?.code === 'session_revoked'
        || (err instanceof AuthCommandException && err.code === 'UNAUTHORIZED'
            && typeof err.message === 'string'
            && err.message.toLowerCase().includes('session revoked'));

      if (isRevoked) {
        if (selectedAccount?.accountId) {
          try { await api.accountClearSession(selectedAccount.accountId); } catch { /* noop */ }
          markAccountSessionless(selectedAccount.accountId);
        }
        setPinRevoked(true);
        notification.warning({
          message: t('auth.pin.sessionExpiredTitle', { defaultValue: 'Session expired' }),
          description: t('auth.pin.sessionExpiredDesc', {
            defaultValue: `Your saved session for ${selectedAccount.name || 'this account'} is no longer valid. Sign in again to continue.`,
            name: selectedAccount.name || 'this account',
          }),
          placement: 'topRight',
          duration: 6,
        });
        setTimeout(() => {
          setPinRevoked(false);
          routeToProviderLogin(selectedAccount, true);
        }, 1400);
        return;
      }

      if (details?.remaining_secs) {
        setPinError(t('auth.pin.lockedOut', { defaultValue: `Account locked. Retry in ${details.remaining_secs}s` }));
      } else if (details?.attempts_remaining !== undefined) {
        setPinError(t('auth.pin.wrongPin', { defaultValue: `Wrong PIN. ${details.attempts_remaining} attempts left` }));
      } else {
        setPinError(err.message || t('auth.pin.error', { defaultValue: 'PIN verification failed' }));
      }
    } finally {
      setPinLoading(false);
    }
  }, [selectedAccount, t, onUnlockWithPin, routeToProviderLogin, markAccountSessionless]);

  const handlePinBack = useCallback(() => {
    setSelectedAccount(null);
    setExpiredAccount(null);
    setLoginState(hasMultipleAccounts ? 'account_picker' : 'logged_out');
  }, [hasMultipleAccounts]);

  // ── Re-link PIN ──

  const handleRelinkPinSubmit = useCallback(async (pin: string) => {
    if (!selectedAccount?.accountId) return;
    setRelinkPinLoading(true);
    setRelinkPinError('');
    try {
      await api.accountRelinkPin(selectedAccount.accountId, pin);
      clearAccountSessionless(selectedAccount.accountId);
      onComplete();
    } catch (err: unknown) {
      setRelinkPinError(errorMessage(err, t('auth.pin.error', { defaultValue: 'PIN verification failed' })));
    } finally {
      setRelinkPinLoading(false);
    }
  }, [selectedAccount, clearAccountSessionless, onComplete, t]);

  // ── Set PIN ──

  const handleSetPinComplete = useCallback(async (pin: string) => {
    setPinSetLoading(true);
    setPinSetError('');
    try {
      const activeAccount = await api.accountGetActive();
      const accountId = activeAccount?.id;
      if (accountId) {
        await api.accountSetPin(accountId, pin);
        clearAccountSessionless(accountId);
      }
      onComplete();
    } catch (err: unknown) {
      setPinSetError(errorMessage(err, 'Failed to set PIN'));
    } finally {
      setPinSetLoading(false);
    }
  }, [clearAccountSessionless, onComplete]);

  const handleSkipPin = useCallback(() => {
    if (selectedAccount?.hasPin) {
      setRelinkPinError(t('auth.pin.required', { defaultValue: 'PIN is required for this account.' }));
      setLoginState('relink_pin');
      return;
    }
    onComplete();
  }, [onComplete, selectedAccount, t]);

  // ── Welcome back continue ──

  const handleWelcomeContinue = useCallback(async () => {
    try {
      const active = await api.accountGetActive();
      if (active?.has_pin) {
        const user = accountIdentityToSessionUser(active);
        setSelectedAccount(user);
        setPinError('');
        setLoginState('pin_entry');
        return;
      }
    } catch {
      // Fall through to set_pin
    }
    setLoginState('set_pin');
  }, []);

  // ── OAuth handlers ──

  const handleOAuthConnect = useCallback((provider: OAuth2ProviderSummary, buttonEl: HTMLElement | null) => {
    const card = cardRef.current;
    if (buttonEl && card) {
      const btnRect = buttonEl.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      setArrowTop(btnRect.top - cardRect.top + btnRect.height / 2);
    }
    setConnectProvider(provider);
    setAuthState('idle');
    setAuthError('');
  }, []);

  const handleDrawerClose = useCallback(() => {
    if (authState === 'waiting') return;
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
  }, [authState]);

  const handleSignIn = useCallback(async () => {
    if (!connectProvider) return;
    setAuthState('waiting');
    setAuthError('');
    try {
      await startAuth(connectProvider.id);
      const updatedConn = useOAuth2Store.getState().connections.find(
        c => c.provider_id === connectProvider.id,
      );
      if (updatedConn) {
        setAuthState('success');
      } else {
        setAuthState('error');
        setAuthError(t('auth.login.incomplete'));
      }
    } catch (err: any) {
      setAuthState('error');
      setAuthError(err?.message || t('auth.login.failedRetry'));
    }
  }, [connectProvider, startAuth, t]);

  const handleAuthDone = useCallback(async () => {
    setConnectProvider(null);
    setAuthState('idle');
    await onLoginWithOAuthBridge();
    await continueAfterFreshAuth();
  }, [onLoginWithOAuthBridge, continueAfterFreshAuth]);

  // ── Email login handler ──

  const handleEmailLogin = useCallback(async (email: string, password: string) => {
    emailRef.current = email;
    passwordRef.current = password;
    setGateError('');
    try {
      const decision = await accessStart();
      const gate = currentGate(decision);
      if (isAccessBlocked(decision)) {
        message.error(accessDecisionMessage(decision) || t('auth.gate.blocked.subtitle'));
        return;
      }
      if (isInviteCodeGate(gate)) {
        setGateDecision(decision);
        setGateInviteCode('');
        return;
      }
      await finishLoginGate(decision.attemptId);
    } catch (err: unknown) {
      message.error(errorMessage(err, t('auth.login.failed')));
    }
  }, [accessStart, finishLoginGate, t]);

  // ── Gate handlers ──

  const handleSubmitInviteCode = useCallback(async (code: string) => {
    if (!gateDecision?.attemptId) return;
    setGateLoading(true);
    setGateError('');
    try {
      const decision = await accessSubmitInviteCode(gateDecision.attemptId, code);
      if (isAccessBlocked(decision)) {
        setGateError(accessDecisionMessage(decision) || t('auth.gate.blocked.subtitle'));
        setGateDecision(decision);
        return;
      }
      if (isAccessGranted(decision) || !isInviteCodeGate(currentGate(decision))) {
        await finishLoginGate(gateDecision.attemptId);
        return;
      }
      setGateDecision(decision);
    } catch (err: unknown) {
      setGateError(errorMessage(err, t('auth.gate.inviteCode.rejected')));
    } finally {
      setGateLoading(false);
    }
  }, [gateDecision, accessSubmitInviteCode, finishLoginGate, t]);

  const handleCancelGate = useCallback(() => {
    setGateDecision(null);
    setGateInviteCode('');
    setGateError('');
    setGateLoading(false);
  }, []);

  // ── Tab change ──

  const handleTabChange = useCallback((newTab: LoginTab) => {
    setTab(newTab);
    if (newTab === 'email') {
      setConnectProvider(null);
      setAuthState('idle');
      setAuthError('');
    }
  }, []);

  // ── Panel positioning ──
  const panelOpen = !!connectProvider && loginState === 'logged_out';

  useEffect(() => {
    if (!panelOpen) return;
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      const card = cardRef.current;
      if (!panel || !card) return;
      const panelH = panel.offsetHeight;
      const cardH = card.offsetHeight;
      const idealTop = arrowTop - panelH / 2;
      const clamped = Math.max(0, Math.min(idealTop, cardH - panelH));
      setPanelTop(clamped);
    });
  }, [panelOpen, arrowTop]);

  // ── Network intro labels (memoized) ──
  const networkIntroLabels = useMemo(() => ({
    title: t('auth.network.title'),
    people: {
      alice: { name: t('auth.network.alice'), handle: t('auth.network.alice.handle'), station: t('auth.network.alice.station') },
      bob: { name: t('auth.network.bob'), handle: t('auth.network.bob.handle'), station: t('auth.network.bob.station') },
      carol: { name: t('auth.network.carol'), handle: t('auth.network.carol.handle'), station: t('auth.network.carol.station') },
      dana: { name: t('auth.network.dana'), handle: t('auth.network.dana.handle'), station: t('auth.network.dana.station') },
      evan: { name: t('auth.network.evan'), handle: t('auth.network.evan.handle'), station: t('auth.network.evan.station') },
    },
    relays: {
      fern: t('auth.network.relay.fern'),
      tide: t('auth.network.relay.tide'),
      ridge: t('auth.network.relay.ridge'),
      loom: t('auth.network.relay.loom'),
    },
    kinds: {
      msg: t('auth.network.kind.msg'),
      img: t('auth.network.kind.img'),
      video: t('auth.network.kind.video'),
      file: t('auth.network.kind.file'),
    },
    card: {
      station: t('auth.network.card.station'),
      via: t('auth.network.card.via'),
      relay: t('auth.network.card.relay'),
      peer: t('auth.network.card.peer'),
    },
  }), [t]);

  // ── Styles ──
  const cardMinHeight = loginCardMinHeight(loginState, !!expiredAccount);
  const cardStyle: React.CSSProperties = {
    width: CARD_WIDTH,
    minHeight: cardMinHeight,
    background: token.colorBgContainer,
    borderRadius: 24,
    boxShadow: token.boxShadow,
    border: `1px solid ${token.colorBorderSecondary}`,
    padding: '36px 32px',
    position: 'relative',
  };

  const shiftX = panelOpen ? -(PANEL_WIDTH + PANEL_GAP + ARROW_SIZE) / 2 : 0;
  const hasSignedInUser = hasValidRestoredUser;

  // ── Gate state prop for LoginFormView ──
  const gateStateProp: GateState | null = gateDecision ? {
    decision: gateDecision,
    inviteCode: gateInviteCode,
    error: gateError,
    loading: gateLoading,
    onSubmitCode: handleSubmitInviteCode,
    onCancel: handleCancelGate,
  } : null;

  // ── Back button content for LoginFormView ──
  const backButtonContent = hasMultipleAccounts ? (
    <>
      <ArrowLeft size={14} style={{ color: token.colorTextTertiary }} />
      <Text style={{ fontSize: 11, color: token.colorTextSecondary }}>
        {t('auth.accountPicker.back')}
      </Text>
    </>
  ) : (
    <>
      <UserSquareAvatar
        remoteUrl={welcomeUser.avatar}
        name={welcomeUser.name}
        size={24}
        radius={6}
      />
      <ChevronRight size={12} style={{ color: token.colorTextTertiary }} />
    </>
  );

  // ── Drawer connection for current provider ──
  const drawerConnection = connectProvider
    ? connections.find(c => c.provider_id === connectProvider.id)
    : null;

  // ── Render card content based on state ──
  const renderCardContent = () => {
    switch (loginState) {
      case 'account_picker':
        return (
          <AccountPickerView
            accounts={visibleAccounts}
            embedded={embedded}
            onSelectAccount={handleSelectAccount}
            onAddAccount={handleNewAccountLogin}
          />
        );

      case 'pin_entry':
        if (!selectedAccount) return null;
        return (
          <PinEntryView
            account={selectedAccount}
            revoked={pinRevoked}
            loading={pinLoading}
            error={pinError}
            onBack={handlePinBack}
            onSubmit={handlePinSubmit}
          />
        );

      case 'relink_pin':
        return (
          <RelinkPinView
            loading={relinkPinLoading}
            error={relinkPinError}
            onSubmit={handleRelinkPinSubmit}
          />
        );

      case 'set_pin':
        return (
          <SetPinView
            canSkip={!selectedAccount?.hasPin}
            loading={pinSetLoading}
            error={pinSetError}
            onComplete={handleSetPinComplete}
            onSkip={handleSkipPin}
          />
        );

      case 'welcome_back':
        return (
          <WelcomeBackView
            user={welcomeUser}
            onContinue={handleWelcomeContinue}
            onSwitchAccount={handleSwitchAccount}
          />
        );

      case 'logged_out':
      default:
        return (
          <LoginFormView
            embedded={embedded}
            tab={tab}
            expiredAccount={expiredAccount}
            reauthReason={reauthReason}
            hasBackButton={hasSignedInUser || hasMultipleAccounts}
            oauth2Providers={providers}
            connections={connections}
            highlightProviderId={connectProvider?.id}
            onBack={handleBackToWelcome}
            onEmailLogin={handleEmailLogin}
            onOAuthLogin={handleOAuthConnect}
            onTabChange={handleTabChange}
            gateState={gateStateProp}
            backContent={backButtonContent}
          />
        );
    }
  };

  const cardContent = (
    <div style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      transform: `translateX(${shiftX}px)`,
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    }}>
      <Flexbox
        ref={cardRef}
        style={cardStyle}
        align="center"
        justify="center"
        gap={0}
      >
        {renderCardContent()}
      </Flexbox>

      {panelOpen && (
        <div
          style={{
            position: 'absolute',
            left: `calc(100% + ${PANEL_GAP}px)`,
            top: 0,
            height: '100%',
            pointerEvents: 'none',
          }}
        >
          <svg
            width={ARROW_SIZE}
            height={ARROW_SIZE * 2}
            style={{
              position: 'absolute',
              top: arrowTop,
              left: 0,
              transform: 'translateY(-50%)',
              filter: 'drop-shadow(-1px 0 1px rgba(0,0,0,0.05))',
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            <polygon
              points={`${ARROW_SIZE},0 0,${ARROW_SIZE} ${ARROW_SIZE},${ARROW_SIZE * 2}`}
              fill={token.colorBgContainer}
            />
          </svg>

          <div
            ref={panelRef}
            style={{
              position: 'absolute',
              top: panelTop,
              left: ARROW_SIZE,
              pointerEvents: 'auto',
            }}
          >
            <Flexbox
              style={{
                width: PANEL_WIDTH,
                background: token.colorBgContainer,
                borderRadius: 14,
                boxShadow: `0 4px 20px rgba(0,0,0,0.08), 0 0 0 1px ${token.colorBorderSecondary}`,
              }}
              gap={0}
            >
              <OAuthDrawerPanel
                provider={connectProvider}
                authState={authState}
                authError={authError}
                connection={drawerConnection}
                onSignIn={handleSignIn}
                onDone={handleAuthDone}
                onClose={handleDrawerClose}
              />
            </Flexbox>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return cardContent;

  return (
    <div className="login-network-shell">
      <div
        className="login-network-backdrop"
        aria-hidden="true"
      >
        <StationNetworkIntro labels={networkIntroLabels} />
      </div>
      <div className="login-card-region">
        {cardContent}
      </div>
    </div>
  );
}
