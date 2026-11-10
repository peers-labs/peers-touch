import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Icon } from '@peers-touch/ui';
import { feedbackChannel, notifyError } from '../../ui/feedback';
import { BRANDING } from '../../branding';
import { LanguageSwitcher } from '../../components/common/LanguageSwitcher';
import {
  isOAuthAuthorizationCancelled,
  useOAuth2Store,
} from '../../store/oauth2';
import { useSessionStore } from '../../store/session';
import { api, AuthCommandException } from '../../services/desktop_api';
import type { OAuth2ProviderSummary } from '../../services/desktop_api';
import {
  accessDecisionMessage,
  currentGate,
  isAccessBlocked,
  isAccessGranted,
  isInviteCodeGate,
  isLoginGate,
  type AccessDecision,
} from '../../services/accessGate';
import { UserSquareAvatar } from '../../components/common/UserSquareAvatar';

import { StationSwitcher } from './StationSwitcher';
import { AccountPickerView } from './views/AccountPickerView';
import { PinEntryView } from './views/PinEntryView';
import { SetPinView } from './views/SetPinView';
import { RelinkPinView } from './views/RelinkPinView';
import { WelcomeBackView } from './views/WelcomeBackView';
import { LoginFormView, type GateState } from './views/LoginFormView';
import { accountIdentityToSessionUser, type LoginState, type LoginTab, type AuthState, type SessionUser } from './types';

interface Props {
  onComplete: () => Promise<void>;
  onLoginWithOAuthBridge: () => Promise<void>;
  /**
   * Notify the identity runtime that the login card's gate chain landed a
   * fresh password session. The card drives the access-gate chain, but the
   * authenticated edge and pending completion close through the runtime
   * state machine instead of flipping the session directly (r3.1).
   */
  onFreshPasswordAuthenticated: () => Promise<void>;
  onSwitchAccount: (accountId: string) => Promise<void>;
  onUnlockWithPin: (accountId: string, pin: string) => Promise<void>;
  restoredUser?: SessionUser | null;
  knownAccounts?: SessionUser[];
  embedded?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

// Stable Touch ErrorResponse numeric code for "an actor already exists"
// (proto ErrorCode::ACTOR_EXISTS). Returned when a brand-new provider identity
// carries a verified email already owned by another actor.
const ACTOR_EXISTS_ERROR_CODE = 10006;

function isStationEmailConflict(error: unknown): boolean {
  if (!(error instanceof AuthCommandException)) return false;
  return error.details?.error_code === ACTOR_EXISTS_ERROR_CODE;
}

export function LoginPage({
  onComplete,
  onLoginWithOAuthBridge,
  onFreshPasswordAuthenticated,
  onSwitchAccount,
  onUnlockWithPin,
  restoredUser,
  knownAccounts = [],
  embedded,
}: Props) {
  const { t } = useTranslation('auth');
  const providers = useOAuth2Store(s => s.providers);
  const loadAll = useOAuth2Store(s => s.loadAll);
  const startAuth = useOAuth2Store(s => s.startAuth);
  const pendingOAuthSessionId = useOAuth2Store(s => s.pendingLoopbackSessionId);
  const completeOAuthAccountLogin = useOAuth2Store(s => s.completeAccountLogin);
  const cancelOAuthAccountLogin = useOAuth2Store(s => s.cancelAccountLogin);
  const accessStart = useSessionStore(s => s.accessStart);
  const accessSubmitInviteCode = useSessionStore(s => s.accessSubmitInviteCode);
  const accessSubmitLogin = useSessionStore(s => s.accessSubmitLogin);
  const accessCancel = useSessionStore(s => s.accessCancel);

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

  // ── PIN recovery state ──
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryNewPinLoading, setRecoveryNewPinLoading] = useState(false);
  const [recoveryNewPinError, setRecoveryNewPinError] = useState('');
  const recoveryIdRef = useRef<string | null>(null);

  // ── OAuth action state ──
  const [connectProvider, setConnectProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [authError, setAuthError] = useState('');
  const oauthAttemptRef = useRef<{
    controller: AbortController;
    providerId: string;
  } | null>(null);

  // ── Gate state ──
  const [gateDecision, setGateDecision] = useState<AccessDecision | null>(null);
  const [gateError, setGateError] = useState('');
  const [gateLoading, setGateLoading] = useState(false);
  const [gateInviteCode, setGateInviteCode] = useState('');

  // ── Email login error (inline on the login card) ──
  const [emailError, setEmailError] = useState('');

  // ── Refs for email login (needed for gate chain) ──
  const emailRef = useRef('');
  const passwordRef = useRef('');

  useEffect(() => { loadAll(); }, [loadAll]);

  const resetOAuthAction = useCallback((preserveCompletedAttempt = false) => {
    const attempt = oauthAttemptRef.current;
    if (!preserveCompletedAttempt) oauthAttemptRef.current = null;
    attempt?.controller.abort();
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
  }, []);

  useEffect(() => () => {
    oauthAttemptRef.current?.controller.abort();
    oauthAttemptRef.current = null;
  }, []);

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
    if (recoveryIdRef.current) {
      try {
        await api.accountAuthorizePinRecovery(recoveryIdRef.current);
        setLoginState('pin_recovery_new_pin');
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        const isMismatch = msg.includes('mismatch');
        notifyError(isMismatch
          ? t('auth.pin.recovery.mismatch')
          : t('auth.pin.recovery.authFailed', { defaultValue: 'Recovery authorization failed. Please try again.' }),
        );
        setLoginState('pin_entry');
        recoveryIdRef.current = null;
        setRecoveryId(null);
      }
      return;
    }

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
  }, [clearAccountSessionless, t]);

  // ── Gate chain ──

  const finishLoginGate = useCallback(async (decision: AccessDecision) => {
    const gate = currentGate(decision);
    if (!gate || !isLoginGate(gate)) throw new Error('auth.gate.unsupported');
    await accessSubmitLogin(
      decision.attemptId,
      gate,
      emailRef.current,
      passwordRef.current,
    );
    // Close the landed password session through the identity runtime's fresh
    // edge (pending completion + epoch/avatar fencing) instead of letting the
    // session activation stand on its own.
    await onFreshPasswordAuthenticated();
    setGateDecision(null);
    setGateInviteCode('');
    await continueAfterFreshAuth();
  }, [accessSubmitLogin, continueAfterFreshAuth, onFreshPasswordAuthenticated]);

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
    resetOAuthAction();
    setExpiredAccount(null);
    if (hasMultipleAccounts) {
      setLoginState('account_picker');
    } else {
      setLoginState('logged_out');
      setTab('quick');
    }
  }, [hasMultipleAccounts, resetOAuthAction]);

  const handleBackToWelcome = useCallback(() => {
    resetOAuthAction();
    if (hasMultipleAccounts) {
      setLoginState('account_picker');
    } else if (hasValidRestoredUser) {
      setLoginState('welcome_back');
    }
  }, [hasMultipleAccounts, hasValidRestoredUser, resetOAuthAction]);

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
        feedbackChannel.notify({
          tone: 'warning',
          duration: 6000,
          message: (
            <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
              <strong>{t('auth.pin.sessionExpiredTitle', { defaultValue: 'Session expired' })}</strong>
              <span style={{ fontWeight: 400 }}>
                {t('auth.pin.sessionExpiredDesc', {
                  defaultValue: `Your saved session for ${selectedAccount.name || 'this account'} is no longer valid. Sign in again to continue.`,
                  name: selectedAccount.name || 'this account',
                })}
              </span>
            </span>
          ),
        });
        setTimeout(() => {
          setPinRevoked(false);
          routeToProviderLogin(selectedAccount, true);
        }, 1400);
        return;
      }

      if (details?.remaining_secs) {
        setPinError(t('auth.pin.lockedOut', {
          defaultValue: 'Account locked. Retry in {{remainingSecs}}s',
          remainingSecs: details.remaining_secs,
        }));
      } else if (details?.attempts_remaining !== undefined) {
        setPinError(t('auth.pin.wrongPin', {
          defaultValue: 'Wrong PIN. {{attemptsRemaining}} attempts left',
          attemptsRemaining: details.attempts_remaining,
        }));
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

  // ── PIN Recovery ──

  const handleForgotPin = useCallback(async () => {
    if (!selectedAccount?.accountId) return;
    try {
      const result = await api.accountBeginPinRecovery(selectedAccount.accountId);
      setRecoveryId(result.recovery_id);
      recoveryIdRef.current = result.recovery_id;

      const provider = (result.provider || '').toLowerCase();
      if (provider === 'password' || provider === '' || provider === 'email') {
        setTab('email');
        emailRef.current = selectedAccount.email || '';
      } else {
        setTab('quick');
      }
      setExpiredAccount(selectedAccount);
      setReauthReason('continue');
      setLoginState('pin_recovery_auth');
    } catch (err: unknown) {
      notifyError(errorMessage(err, t('auth.pin.recovery.error', { defaultValue: 'Could not start PIN recovery' })));
    }
  }, [selectedAccount, t]);

  const handleRecoveryNewPinSubmit = useCallback(async (pin: string) => {
    if (!recoveryId) return;
    setRecoveryNewPinLoading(true);
    setRecoveryNewPinError('');
    try {
      await api.accountResetPin(recoveryId, pin);
      recoveryIdRef.current = null;
      setRecoveryId(null);
      onComplete();
    } catch (err: unknown) {
      setRecoveryNewPinError(errorMessage(err, t('auth.pin.recovery.error', { defaultValue: 'Failed to reset PIN' })));
    } finally {
      setRecoveryNewPinLoading(false);
    }
  }, [recoveryId, onComplete, t]);

  const handleRecoveryCancel = useCallback(() => {
    resetOAuthAction();
    recoveryIdRef.current = null;
    setRecoveryId(null);
    setRecoveryNewPinError('');
    setLoginState('pin_entry');
  }, [resetOAuthAction]);

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

  const handleOAuthConnect = useCallback(async (provider: OAuth2ProviderSummary) => {
    if (oauthAttemptRef.current) return;

    const attempt = {
      controller: new AbortController(),
      providerId: provider.id,
    };
    oauthAttemptRef.current = attempt;
    setConnectProvider(provider);
    setAuthState('opening');
    setAuthError('');

    try {
      const decision = await startAuth(
        provider.id,
        undefined,
        'account_login',
        {
          signal: attempt.controller.signal,
          onBrowserOpened: () => {
            if (oauthAttemptRef.current === attempt) setAuthState('waiting');
          },
        },
      );
      if (oauthAttemptRef.current !== attempt) return;
      if (attempt.controller.signal.aborted) setConnectProvider(provider);
      if (decision) {
        oauthAttemptRef.current = null;
        setConnectProvider(null);
        setAuthState('idle');
        setGateDecision(decision);
        setGateInviteCode('');
        return;
      }

      setAuthState('initializing');
      await onLoginWithOAuthBridge();
      if (oauthAttemptRef.current !== attempt) return;

      setAuthState('success');
      // Deterministic readiness: the bridge closes through the identity
      // runtime's pending-completion closure; there is no fixed avatar wait.
      if (oauthAttemptRef.current !== attempt) return;

      await continueAfterFreshAuth();
      if (oauthAttemptRef.current === attempt) {
        oauthAttemptRef.current = null;
        setConnectProvider(null);
        setAuthState('idle');
      }
    } catch (err: unknown) {
      if (oauthAttemptRef.current !== attempt) return;
      oauthAttemptRef.current = null;
      if (isOAuthAuthorizationCancelled(err)) {
        setConnectProvider(null);
        setAuthState('idle');
        setAuthError('');
        return;
      }
      setAuthState('error');
      setAuthError(isStationEmailConflict(err)
        ? t('auth.oauth.emailConflict')
        : errorMessage(err, t('auth.login.failedRetry')));
    }
  }, [continueAfterFreshAuth, onLoginWithOAuthBridge, startAuth, t]);

  const handleOAuthCancel = useCallback(() => {
    resetOAuthAction(true);
  }, [resetOAuthAction]);

  // ── Email login handler ──

  const handleEmailLogin = useCallback(async (email: string, password: string) => {
    emailRef.current = email;
    passwordRef.current = password;
    setGateError('');
    setEmailError('');
    try {
      const decision = await accessStart();
      const gate = currentGate(decision);
      if (isAccessBlocked(decision)) {
        setEmailError(accessDecisionMessage(decision) || t('auth.gate.blocked.subtitle'));
        return;
      }
      if (isInviteCodeGate(gate)) {
        setGateDecision(decision);
        setGateInviteCode('');
        return;
      }
      await finishLoginGate(decision);
    } catch (err: unknown) {
      // Inline error on the login card is the durable surface: a transient
      // toast alone is easy to miss (and static message API may not render
      // outside App context).
      setEmailError(errorMessage(err, t('auth.login.failed')));
    }
  }, [accessStart, finishLoginGate, t]);

  // ── Gate handlers ──

  const handleSubmitInviteCode = useCallback(async (code: string) => {
    if (!gateDecision?.attemptId) return;
    setGateLoading(true);
    setGateError('');
    try {
      const gate = currentGate(gateDecision);
      if (!gate || !isInviteCodeGate(gate)) throw new Error('auth.gate.unsupported');
      const decision = await accessSubmitInviteCode(gateDecision.attemptId, gate, code);
      if (isAccessBlocked(decision)) {
        setGateError(accessDecisionMessage(decision) || t('auth.gate.blocked.subtitle'));
        setGateDecision(decision);
        return;
      }
      if (isAccessGranted(decision) && pendingOAuthSessionId) {
        const nextDecision = await completeOAuthAccountLogin();
        if (nextDecision) {
          setGateDecision(nextDecision);
          return;
        }
        setGateDecision(null);
        setGateInviteCode('');
        await onLoginWithOAuthBridge();
        await continueAfterFreshAuth();
        return;
      }
      if (isAccessGranted(decision) || !isInviteCodeGate(currentGate(decision))) {
        await finishLoginGate(decision);
        return;
      }
      setGateDecision(decision);
    } catch (err: unknown) {
      setGateError(errorMessage(err, t('auth.gate.inviteCode.rejected')));
    } finally {
      setGateLoading(false);
    }
  }, [
    gateDecision,
    accessSubmitInviteCode,
    completeOAuthAccountLogin,
    continueAfterFreshAuth,
    finishLoginGate,
    onLoginWithOAuthBridge,
    pendingOAuthSessionId,
    t,
  ]);

  const handleCancelGate = useCallback(async () => {
    setGateLoading(true);
    setGateError('');
    try {
      if (pendingOAuthSessionId) {
        const status = await cancelOAuthAccountLogin();
        if (status === 'completed') {
          setGateDecision(null);
          setGateInviteCode('');
          await onLoginWithOAuthBridge();
          await continueAfterFreshAuth();
          return;
        }
      } else if (gateDecision?.attemptId) {
        await accessCancel(gateDecision.attemptId);
      }
      setGateDecision(null);
      setGateInviteCode('');
    } catch (error) {
      setGateError(errorMessage(error, t('auth.login.failedRetry')));
    } finally {
      setGateLoading(false);
    }
  }, [
    accessCancel,
    cancelOAuthAccountLogin,
    continueAfterFreshAuth,
    gateDecision,
    onLoginWithOAuthBridge,
    pendingOAuthSessionId,
    t,
  ]);

  // ── Tab change ──

  const handleTabChange = useCallback((newTab: LoginTab) => {
    setTab(newTab);
    if (newTab === 'email') {
      resetOAuthAction();
    }
  }, [resetOAuthAction]);

  // ── Styles ──
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
      <Icon iconId="arrow-left" size={14} />
      <span style={{ fontSize: 12 }}>{t('auth.accountPicker.back')}</span>
    </>
  ) : (
    <>
      <UserSquareAvatar
        remoteUrl={welcomeUser.avatar}
        name={welcomeUser.name}
        size={24}
        radius={6}
      />
      <Icon iconId="chevron-right" size={12} />
    </>
  );

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
            onForgotPin={handleForgotPin}
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

      case 'pin_recovery_auth':
        return (
          <LoginFormView
            embedded={embedded}
            tab={tab}
            expiredAccount={expiredAccount}
            reauthReason={reauthReason}
            hasBackButton={true}
            oauth2Providers={providers}
            oauthActionProviderId={connectProvider?.id}
            oauthActionState={authState}
            oauthActionError={authError}
            emailError={emailError}
            onBack={handleRecoveryCancel}
            onEmailLogin={handleEmailLogin}
            onOAuthLogin={handleOAuthConnect}
            onOAuthCancel={handleOAuthCancel}
            onTabChange={handleTabChange}
            gateState={gateStateProp}
            backContent={
              <>
                <Icon iconId="arrow-left" size={14} />
                <span style={{ fontSize: 12 }}>{t('auth.pin.recovery.cancel')}</span>
              </>
            }
            title={t('auth.pin.recovery.authenticating')}
          />
        );

      case 'pin_recovery_new_pin':
        return (
          <SetPinView
            canSkip={false}
            loading={recoveryNewPinLoading}
            error={recoveryNewPinError}
            onComplete={handleRecoveryNewPinSubmit}
            onSkip={handleRecoveryCancel}
            title={t('auth.pin.recovery.newPin')}
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
            hasBackButton={(hasSignedInUser || hasMultipleAccounts) && !connectProvider}
            oauth2Providers={providers}
            oauthActionProviderId={connectProvider?.id}
            oauthActionState={authState}
            oauthActionError={authError}
            emailError={emailError}
            onBack={handleBackToWelcome}
            onEmailLogin={handleEmailLogin}
            onOAuthLogin={handleOAuthConnect}
            onOAuthCancel={handleOAuthCancel}
            onTabChange={handleTabChange}
            gateState={gateStateProp}
            backContent={backButtonContent}
          />
        );
    }
  };

  const cardHead = (
    <div className="pt-auth-head">
      <span className="pt-auth-brand">
        <img
          className="pt-auth-brand-wordmark"
          src={BRANDING.logos.wordmark}
          alt={BRANDING.appName}
        />
      </span>
      {!embedded && <LanguageSwitcher />}
    </div>
  );

  const card = (
    <Card
      className="pt-auth-card"
      data-pt-login-card
      footer={embedded ? undefined : (
        <div className="pt-auth-station">
          <StationSwitcher />
        </div>
      )}
    >
      {cardHead}
      {renderCardContent()}
    </Card>
  );

  if (embedded) return card;

  return (
    <div className="pt-auth-shell">
      <div className="pt-auth-region">{card}</div>
    </div>
  );
}
