import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Alert, Button, Input, message, notification, theme, Typography, Spin } from 'antd';
import { AlertTriangle, Github, Mail, Eye, EyeOff, ArrowRight, RefreshCw, Lock, LogIn, CheckCircle2, XCircle, X, ChevronRight, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useOAuth2Store } from '../store/oauth2';
import { useSessionStore } from '../store/session';
import { api, AuthCommandException } from '../services/desktop_api';
import type { AccountIdentity, OAuth2ProviderSummary } from '../services/desktop_api';
import {
  accessDecisionMessage,
  currentGate,
  isAccessBlocked,
  isAccessGranted,
  isInviteCodeGate,
  parseGateFields,
  type AccessDecision,
} from '../services/accessGate';
import { UserSquareAvatar } from '../components/common/UserSquareAvatar';
import { PlatformLogo } from '../components/common/PlatformLogo';
import { StationNetworkIntro } from '../components/common/StationNetworkIntro';
import { STATION_ACTIVE_CHANGED_EVENT, type StationActiveChangedDetail } from '../components/common/stationRegistryEvents';
import { BRANDING } from '../branding';
import type { SessionUser } from '../types/navigation';
import { log } from '../utils/logger';

const { Text } = Typography;

type LoginState = 'logged_out' | 'welcome_back' | 'account_picker' | 'pin_entry' | 'relink_pin' | 'set_pin';
type LoginTab = 'quick' | 'email';
type AuthState = 'idle' | 'waiting' | 'success' | 'error';

interface Props {
  onComplete: () => Promise<void>;
  onLoginWithOAuthBridge: () => Promise<void>;
  onSwitchAccount: (accountId: string) => Promise<void>;
  onUnlockWithPin: (accountId: string, pin: string) => Promise<void>;
  restoredUser?: SessionUser | null;
  knownAccounts?: SessionUser[];
  embedded?: boolean;
}

const CARD_WIDTH = 400;
const CARD_MIN_HEIGHT = 420;
const LOGIN_CARD_MIN_HEIGHT = 356;
const REAUTH_CARD_MIN_HEIGHT = 392;
const PANEL_WIDTH = 250;
const ARROW_SIZE = 8;
const PANEL_GAP = 8;
const PIN_LENGTH = 6;
const PIN_SUBMIT_DELAY_MS = 140;

const LOGIN_FORM_LAYOUT = {
  logoSize: 72,
  logoRadius: 18,
  logoBottom: 14,
  subtitleBottom: 16,
  reauthSubtitleBottom: 10,
  reauthAlertBottom: 14,
  tabBottom: 16,
};

function loginCardMinHeight(loginState: LoginState, hasExpiredAccount: boolean): number {
  if (loginState !== 'logged_out') return CARD_MIN_HEIGHT;
  return hasExpiredAccount ? REAUTH_CARD_MIN_HEIGHT : LOGIN_CARD_MIN_HEIGHT;
}

function accountIdentityToSessionUser(account: AccountIdentity): SessionUser {
  return {
    name: account.name || account.provider_user_id || 'User',
    email: account.email || '',
    avatar: account.avatar_url || undefined,
    accountId: account.id,
    hasPin: account.has_pin,
    hasSession: account.has_session,
    provider: account.provider,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function stationDisplayName(entryLabel?: string, stationUrl?: string): string {
  if (entryLabel) return entryLabel;
  if (!stationUrl) return '';

  try {
    return new URL(stationUrl).hostname;
  } catch {
    return stationUrl;
  }
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

  // restoredUser is only set when the session has real identity data (actorId + name).
  // If null, the user has no valid session — go directly to login form.
  const hasValidRestoredUser = !!(restoredUser && restoredUser.name && restoredUser.name !== 'User');
  const hasMultipleAccounts = knownAccounts.length > 0;
  const initialState: LoginState = hasMultipleAccounts
    ? 'account_picker'
    : hasValidRestoredUser
      ? 'welcome_back'
      : 'logged_out';

  const [loginState, setLoginState] = useState<LoginState>(initialState);
  const [tab, setTab] = useState<LoginTab>('quick');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  // Interactive access-gate chain. When the Station's policy inserts an
  // invite-code gate before login, `handleEmailLogin` pauses here: it holds
  // the live attempt and renders the invite-code form until the code passes,
  // then resumes into the login gate. `gateDecision` null means no chain is in
  // flight (the legacy one-shot login path is unaffected).
  const [gateDecision, setGateDecision] = useState<AccessDecision | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [gateError, setGateError] = useState('');
  const [gateLoading, setGateLoading] = useState(false);

  const [connectProvider, setConnectProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [authError, setAuthError] = useState('');
  const [activeStationName, setActiveStationName] = useState('');
  const [arrowTop, setArrowTop] = useState(0);
  const buttonRefs = useRef<Record<string, HTMLElement | null>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelTop, setPanelTop] = useState(0);

  // PIN entry state
  const [selectedAccount, setSelectedAccount] = useState<SessionUser | null>(null);
  const [pinDigits, setPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [pinError, setPinError] = useState('');
  const [pinLoading, setPinLoading] = useState(false);
  const pinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [sessionlessAccountIds, setSessionlessAccountIds] = useState<Set<string>>(() => new Set());

  // Expired-session re-auth state. Set when an account's stored session can
  // no longer be revived (server-side revoke, expired, kicked, or simply not
  // present). The login form uses this to (1) pre-fill email + tab to the
  // account's original provider so the user doesn't pick the wrong path, and
  // (2) show a "welcome back, please re-auth" banner instead of a generic
  // login screen. We never funnel the user through PIN when this is set —
  // the encrypted_session blob has already been cleared on the backend.
  const [expiredAccount, setExpiredAccount] = useState<SessionUser | null>(null);
  // 'revoked'  → server-side revoke/expire confirmed; show warning Alert.
  // 'continue' → cold-boot or no saved session; show neutral "continue as X".
  const [reauthReason, setReauthReason] = useState<'revoked' | 'continue'>('continue');

  // PIN-screen revoke overlay: when the unlock probe comes back as "session
  // expired", we don't silently jump screens — we replace the PIN inputs
  // with an explicit "session expired" panel for ~1.2s so the user clearly
  // sees what happened, then route them to the right login form.
  const [pinRevoked, setPinRevoked] = useState(false);

  // Set PIN state (after first login)
  const [newPinDigits, setNewPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [confirmPinDigits, setConfirmPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [pinSetStep, setPinSetStep] = useState<'create' | 'confirm'>('create');
  const [pinSetError, setPinSetError] = useState('');
  const [pinSetLoading, setPinSetLoading] = useState(false);
  const newPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Re-link an existing PIN after a fresh password/OAuth login.
  const [relinkPinDigits, setRelinkPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [relinkPinError, setRelinkPinError] = useState('');
  const [relinkPinLoading, setRelinkPinLoading] = useState(false);
  const relinkPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (embedded) return;

    let cancelled = false;

    async function loadActiveStationName() {
      try {
        const result = await api.stationList();
        if (cancelled) return;

        const activeUrl = result.active_url ?? '';
        const activeEntry = result.entries?.find(entry => entry.url === activeUrl);
        setActiveStationName(stationDisplayName(activeEntry?.label, activeUrl));
      } catch (err) {
        log.warn('LoginPage', 'Failed to load active station for network intro', { error: err });
      }
    }

    void loadActiveStationName();

    function handleActiveStationChanged(event: Event) {
      const detail = (event as CustomEvent<StationActiveChangedDetail>).detail;
      setActiveStationName(stationDisplayName(detail?.label, detail?.url));
    }

    window.addEventListener(STATION_ACTIVE_CHANGED_EVENT, handleActiveStationChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(STATION_ACTIVE_CHANGED_EVENT, handleActiveStationChanged);
    };
  }, [embedded]);

  // Guard: if welcome_back is reached without a valid session, redirect to login form
  useEffect(() => {
    if (loginState === 'welcome_back') {
      const { authenticated } = useSessionStore.getState();
      if (!authenticated) {
        setLoginState('logged_out');
      }
    }
  }, [loginState]);

  const oauth2AccountProviders = useMemo(
    () => providers.filter(p => p.id === 'github' || p.id === 'google'),
    [providers],
  );

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

  // When the user picks an account from the picker, show that account's info
  // instead of the auto-restored session user (which may be a different account).
  const welcomeUser: SessionUser = useMemo(() => {
    if (selectedAccount && selectedAccount.name) return selectedAccount;
    if (restoredUser && restoredUser.name) return restoredUser;
    return { name: '', email: '' };
  }, [selectedAccount, restoredUser]);

  const continueAfterFreshAuth = useCallback(async () => {
    try {
      const active = await api.accountGetActive();
      if (active?.id) {
        clearAccountSessionless(active.id);
        const user = accountIdentityToSessionUser(active);
        setSelectedAccount(user);

        if (active.has_pin) {
          setRelinkPinDigits(Array(PIN_LENGTH).fill(''));
          setRelinkPinError('');
          setRelinkPinLoading(false);
          setLoginState('relink_pin');
          setTimeout(() => relinkPinInputRefs.current[0]?.focus(), 50);
          return;
        }
      }
    } catch {
      // Fall through to the first-time PIN prompt when the active identity is unavailable.
    }

    setLoginState('set_pin');
  }, [clearAccountSessionless]);

  // Resume the chain once an attempt has cleared every pre-login gate: submit
  // the held credentials against the login gate and land the session.
  const finishLoginGate = useCallback(async (attemptId: string) => {
    await accessSubmitLogin(attemptId, email.trim(), password);
    setGateDecision(null);
    setInviteCode('');
    await continueAfterFreshAuth();
  }, [accessSubmitLogin, email, password, continueAfterFreshAuth]);

  const handleEmailLogin = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    setGateError('');
    try {
      const decision = await accessStart();
      const gate = currentGate(decision);
      // The Station drives the chain. An invite-code gate pauses for input;
      // anything else (login gate or open policy) proceeds straight to login.
      if (isAccessBlocked(decision)) {
        message.error(accessDecisionMessage(decision) || t('auth.gate.blocked.subtitle'));
        return;
      }
      if (isInviteCodeGate(gate)) {
        setGateDecision(decision);
        setInviteCode('');
        return;
      }
      await finishLoginGate(decision.attemptId);
    } catch (err: unknown) {
      message.error(errorMessage(err, t('auth.login.failed')));
    } finally {
      setLoading(false);
    }
  }, [email, password, accessStart, finishLoginGate, t]);

  const handleSubmitInviteCode = useCallback(async () => {
    if (!gateDecision?.attemptId || !inviteCode.trim()) return;
    setGateLoading(true);
    setGateError('');
    try {
      const decision = await accessSubmitInviteCode(gateDecision.attemptId, inviteCode.trim());
      if (isAccessBlocked(decision)) {
        setGateError(accessDecisionMessage(decision) || t('auth.gate.blocked.subtitle'));
        setGateDecision(decision);
        return;
      }
      if (isAccessGranted(decision) || !isInviteCodeGate(currentGate(decision))) {
        // Invite passed: the chain has advanced to the login gate. Reuse the
        // credentials already entered to land the session in one motion.
        await finishLoginGate(gateDecision.attemptId);
        return;
      }
      // Still on the invite gate (e.g. a multi-step schema) — keep the form up.
      setGateDecision(decision);
    } catch (err: unknown) {
      setGateError(errorMessage(err, t('auth.gate.inviteCode.rejected')));
    } finally {
      setGateLoading(false);
    }
  }, [gateDecision, inviteCode, accessSubmitInviteCode, finishLoginGate, t]);

  const handleCancelGate = useCallback(() => {
    setGateDecision(null);
    setInviteCode('');
    setGateError('');
    setGateLoading(false);
  }, []);

  const handleOAuthConnect = useCallback((provider: OAuth2ProviderSummary) => {
    const btn = buttonRefs.current[provider.id];
    const card = cardRef.current;
    if (btn && card) {
      const btnRect = btn.getBoundingClientRect();
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
  }, [connectProvider, startAuth]);

  const handleAuthDone = useCallback(async () => {
    setConnectProvider(null);
    setAuthState('idle');
    await onLoginWithOAuthBridge();
    await continueAfterFreshAuth();
  }, [onLoginWithOAuthBridge, continueAfterFreshAuth]);

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
    // If neither — stay on logged_out, this button shouldn't be visible anyway
  }, [hasMultipleAccounts, hasValidRestoredUser]);

  const handleNewAccountLogin = useCallback(() => {
    // "Add another account" is a fresh start — wipe the expired-session
    // context so we don't show "Welcome back, Alice" while Bob is signing
    // in for the first time.
    setExpiredAccount(null);
    setSelectedAccount(null);
    setEmail('');
    setPassword('');
    setLoginState('logged_out');
    setTab('quick');
  }, []);

  // ── Account Picker ──

  /**
   * Route a user-selected account to the login form pre-configured for the
   * provider they originally signed in with. We never want a github user to
   * land on the email/password tab (they have no password), and an
   * email-password user shouldn't be staring at a github button.
   *
   * `expired` toggles the "session expired" banner so we can also reuse this
   * helper from the PIN-unlock recovery path.
   */
  const routeToProviderLogin = useCallback((account: SessionUser, expired: boolean) => {
    setSelectedAccount(account);
    if (expired) {
      markAccountSessionless(account.accountId);
    }
    // Always surface account context (avatar/name/email) on the login form
    // when re-auth is needed — that's what makes this feel like "welcome
    // back" instead of a cold-blank login screen. Only the wording changes:
    // "revoked" tone for confirmed expirations, "continue" tone otherwise.
    setExpiredAccount(account);
    setReauthReason(expired ? 'revoked' : 'continue');
    setPinError('');
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setPinRevoked(false);

    const provider = (account.provider || '').toLowerCase();
    if (provider === 'password' || provider === '' || provider === 'email') {
      setTab('email');
      setEmail(account.email || '');
      setPassword('');
    } else {
      // OAuth provider (github, google, …) — quick tab. The matching button
      // is highlighted automatically because `connectProvider` gets set in
      // the next effect once the provider list is hydrated.
      setTab('quick');
    }
    setLoginState('logged_out');
  }, [markAccountSessionless]);

  const handleSelectAccount = useCallback(async (account: SessionUser) => {
    setSelectedAccount(account);
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setPinError('');
    setExpiredAccount(null);

    if (account.hasPin && account.hasSession) {
      // PIN set + encrypted session available — unlock via PIN. The PIN
      // submit handler validates the decrypted token against Station and
      // will fall back to the provider login form on revoke (see
      // `handlePinSubmit`).
      setLoginState('pin_entry');
      setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
      return;
    }

    if (account.hasSession && account.accountId) {
      // Has a valid session but no PIN — switch backend identity marker
      // and verify the restored session actually belongs to this account.
      // Non-PIN accounts share a single session.json, so the active token
      // might belong to a different account.
      try {
        await onSwitchAccount(account.accountId);
        const { currentUser } = useSessionStore.getState();
        if (currentUser?.email && account.email && currentUser.email !== account.email) {
          // Restored session belongs to a different user — require fresh login
          routeToProviderLogin(account, true);
          return;
        }
        setLoginState('welcome_back');
      } catch {
        // If switch/restore fails, the in-memory token is dead. Drop the
        // local encrypted session for this account so we don't loop the user
        // through PIN next time, and route to the matching login form.
        if (account.accountId) {
          try { await api.accountClearSession(account.accountId); } catch { /* noop */ }
          markAccountSessionless(account.accountId);
        }
        routeToProviderLogin(account, true);
      }
      return;
    }

    // No saved session — go straight to the right login form for this
    // account's provider. This is the normal "stale picker entry" path.
    routeToProviderLogin(account, false);
  }, [onSwitchAccount, routeToProviderLogin, markAccountSessionless]);

  // ── PIN Entry ──

  const handlePinChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    setPinDigits(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < PIN_LENGTH - 1) {
      pinInputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handlePinKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pinDigits[index] && index > 0) {
      pinInputRefs.current[index - 1]?.focus();
      setPinDigits(prev => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
    }
  }, [pinDigits]);

  const handlePinSubmit = useCallback(async () => {
    if (!selectedAccount?.accountId) return;
    const pin = pinDigits.join('');
    if (pin.length !== PIN_LENGTH) return;

    setPinLoading(true);
    setPinError('');
    try {
      await onUnlockWithPin(selectedAccount.accountId, pin);
    } catch (err: any) {
      const details = err instanceof AuthCommandException ? err.details : undefined;

      // Server-side revoke / expiration: the PIN was correct but the token
      // it unlocks is no longer accepted by Station. Pestering the user to
      // retype the PIN is pointless — the encrypted blob is permanently
      // dead. Clear it locally, briefly show an explicit "session expired"
      // panel on the PIN screen so the user sees the cause, then redirect
      // to the provider's login form for fresh credentials/OAuth.
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
        // Persistent corner notification — ~6s, dismissible. Used in
        // addition to the inline overlay because users coming back from
        // another window/tab may otherwise miss the screen change entirely.
        notification.warning({
          message: t('auth.pin.sessionExpiredTitle', { defaultValue: 'Session expired' }),
          description: t('auth.pin.sessionExpiredDesc', {
            defaultValue: `Your saved session for ${selectedAccount.name || 'this account'} is no longer valid. Sign in again to continue.`,
            name: selectedAccount.name || 'this account',
          }),
          placement: 'topRight',
          duration: 6,
        });
        // Give the inline overlay a beat so the user actually reads it
        // before we yank them to the login form.
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
      setPinDigits(Array(PIN_LENGTH).fill(''));
      setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
    } finally {
      setPinLoading(false);
    }
  }, [selectedAccount, pinDigits, t, onUnlockWithPin, routeToProviderLogin, markAccountSessionless]);

  // Auto-submit PIN when all digits are entered
  useEffect(() => {
    if (loginState === 'pin_entry' && pinDigits.every(d => d !== '') && !pinLoading) {
      const timer = window.setTimeout(() => {
        handlePinSubmit();
      }, PIN_SUBMIT_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [pinDigits, loginState, pinLoading, handlePinSubmit]);

  // ── Re-link existing PIN after fresh login ──

  const handleRelinkPinChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    setRelinkPinDigits(prev => {
      const next = [...prev];
      next[index] = digit;
      return next;
    });
    if (digit && index < PIN_LENGTH - 1) {
      relinkPinInputRefs.current[index + 1]?.focus();
    }
  }, []);

  const handleRelinkPinKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !relinkPinDigits[index] && index > 0) {
      relinkPinInputRefs.current[index - 1]?.focus();
      setRelinkPinDigits(prev => {
        const next = [...prev];
        next[index - 1] = '';
        return next;
      });
    }
  }, [relinkPinDigits]);

  const handleRelinkPinSubmit = useCallback(async () => {
    if (!selectedAccount?.accountId) return;
    const pin = relinkPinDigits.join('');
    if (pin.length !== PIN_LENGTH) return;

    setRelinkPinLoading(true);
    setRelinkPinError('');
    try {
      await api.accountRelinkPin(selectedAccount.accountId, pin);
      clearAccountSessionless(selectedAccount.accountId);
      onComplete();
    } catch (err: unknown) {
      setRelinkPinError(errorMessage(err, t('auth.pin.error', { defaultValue: 'PIN verification failed' })));
      setRelinkPinDigits(Array(PIN_LENGTH).fill(''));
      setTimeout(() => relinkPinInputRefs.current[0]?.focus(), 50);
    } finally {
      setRelinkPinLoading(false);
    }
  }, [selectedAccount, relinkPinDigits, clearAccountSessionless, onComplete, t]);

  useEffect(() => {
    if (loginState === 'relink_pin' && relinkPinDigits.every(d => d !== '') && !relinkPinLoading) {
      const timer = window.setTimeout(() => {
        handleRelinkPinSubmit();
      }, PIN_SUBMIT_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [relinkPinDigits, loginState, relinkPinLoading, handleRelinkPinSubmit]);

  // ── Set PIN (after first login) ──

  const handleNewPinChange = useCallback((index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const digit = value.slice(-1);
    if (pinSetStep === 'create') {
      setNewPinDigits(prev => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });
      if (digit && index < PIN_LENGTH - 1) {
        newPinInputRefs.current[index + 1]?.focus();
      }
    } else {
      setConfirmPinDigits(prev => {
        const next = [...prev];
        next[index] = digit;
        return next;
      });
      if (digit && index < PIN_LENGTH - 1) {
        confirmPinInputRefs.current[index + 1]?.focus();
      }
    }
  }, [pinSetStep]);

  const handleNewPinKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      if (pinSetStep === 'create' && !newPinDigits[index] && index > 0) {
        newPinInputRefs.current[index - 1]?.focus();
        setNewPinDigits(prev => { const n = [...prev]; n[index - 1] = ''; return n; });
      } else if (pinSetStep === 'confirm' && !confirmPinDigits[index] && index > 0) {
        confirmPinInputRefs.current[index - 1]?.focus();
        setConfirmPinDigits(prev => { const n = [...prev]; n[index - 1] = ''; return n; });
      }
    }
  }, [pinSetStep, newPinDigits, confirmPinDigits]);

  // Auto-advance from create to confirm
  useEffect(() => {
    if (pinSetStep === 'create' && newPinDigits.every(d => d !== '') && !pinSetLoading) {
      const timer = window.setTimeout(() => {
        setPinSetStep('confirm');
        setConfirmPinDigits(Array(PIN_LENGTH).fill(''));
        setPinSetError('');
        setTimeout(() => confirmPinInputRefs.current[0]?.focus(), 50);
      }, PIN_SUBMIT_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [newPinDigits, pinSetStep, pinSetLoading]);

  // Auto-submit confirm
  useEffect(() => {
    if (pinSetStep === 'confirm' && confirmPinDigits.every(d => d !== '') && !pinSetLoading) {
      const pin = newPinDigits.join('');
      const confirm = confirmPinDigits.join('');
      const timer = window.setTimeout(() => {
        if (pin !== confirm) {
          setPinSetError(t('auth.pin.mismatch', { defaultValue: 'PINs do not match. Try again.' }));
          setPinSetStep('create');
          setNewPinDigits(Array(PIN_LENGTH).fill(''));
          setConfirmPinDigits(Array(PIN_LENGTH).fill(''));
          setTimeout(() => newPinInputRefs.current[0]?.focus(), 50);
          return;
        }

        setPinSetLoading(true);
        void (async () => {
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
            setPinSetStep('create');
            setNewPinDigits(Array(PIN_LENGTH).fill(''));
            setConfirmPinDigits(Array(PIN_LENGTH).fill(''));
            setTimeout(() => newPinInputRefs.current[0]?.focus(), 50);
          } finally {
            setPinSetLoading(false);
          }
        })();
      }, PIN_SUBMIT_DELAY_MS);
      return () => window.clearTimeout(timer);
    }
  }, [confirmPinDigits, pinSetStep, newPinDigits, pinSetLoading, clearAccountSessionless, onComplete, t]);

  const handleSkipPin = useCallback(() => {
    if (selectedAccount?.hasPin) {
      setRelinkPinError(t('auth.pin.required', { defaultValue: 'PIN is required for this account.' }));
      setLoginState('relink_pin');
      setTimeout(() => relinkPinInputRefs.current[0]?.focus(), 50);
      return;
    }
    onComplete();
  }, [onComplete, selectedAccount, t]);

  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '8px 0',
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    background: active ? token.colorBgContainer : 'transparent',
    color: active ? token.colorText : token.colorTextSecondary,
    boxShadow: active ? token.boxShadowTertiary : 'none',
  });

  const GoogleIcon = () => (
    <svg width="18" height="18" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );

  const oauthButtonStyle: React.CSSProperties = {
    width: '100%',
    height: 44,
    borderRadius: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    fontSize: 14,
    fontWeight: 500,
  };

  const panelOpen = !!connectProvider && loginState === 'logged_out';
  const hasSignedInUser = hasValidRestoredUser;
  const cardMinHeight = loginCardMinHeight(loginState, !!expiredAccount);
  const networkIntroLabels = useMemo(() => ({
    title: t('auth.network.title'),
    personal: t('auth.network.personal'),
    actor: t('auth.network.actor'),
    relay: t('auth.network.relay'),
    relayLink: t('auth.network.relayLink'),
    alice: t('auth.network.alice'),
    service: t('auth.network.service'),
    station: t('auth.network.station'),
    bob: t('auth.network.bob'),
    carol: t('auth.network.carol'),
    agent: t('auth.network.agent'),
    storage: t('auth.network.storage'),
    mobile: t('auth.network.mobile'),
    client: t('auth.network.client'),
    joining: t('auth.network.joining'),
    yourStation: t('auth.network.yourStation'),
    messageFlow: t('auth.network.messageFlow'),
    imageFlow: t('auth.network.imageFlow'),
    fileFlow: t('auth.network.fileFlow'),
    taskFlow: t('auth.network.taskFlow'),
  }), [t]);
  const selectedStationName = activeStationName || t('auth.network.defaultStationName');

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

  // ── PIN input row renderer ──
  const renderPinInputRow = (
    digits: string[],
    refs: React.MutableRefObject<(HTMLInputElement | null)[]>,
    onChange: (i: number, v: string) => void,
    onKeyDown: (i: number, e: React.KeyboardEvent) => void,
    disabled?: boolean,
  ) => (
    <Flexbox horizontal gap={8} justify="center">
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={el => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={e => onChange(i, e.target.value)}
          onKeyDown={e => onKeyDown(i, e)}
          disabled={disabled}
          autoComplete="off"
          style={{
            width: 44,
            height: 52,
            textAlign: 'center',
            fontSize: 22,
            fontWeight: 700,
            borderRadius: 12,
            border: `2px solid ${digit ? token.colorPrimary : token.colorBorderSecondary}`,
            background: token.colorBgLayout,
            color: token.colorText,
            outline: 'none',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
            caretColor: token.colorPrimary,
          }}
          onFocus={e => {
            e.currentTarget.style.borderColor = token.colorPrimary;
            e.currentTarget.style.boxShadow = `0 0 0 2px ${token.colorPrimary}20`;
          }}
          onBlur={e => {
            e.currentTarget.style.borderColor = digit ? token.colorPrimary : token.colorBorderSecondary;
            e.currentTarget.style.boxShadow = 'none';
          }}
        />
      ))}
    </Flexbox>
  );

  const renderDrawerContent = () => {
    if (!connectProvider) return null;

    const hasRemoteOAuth = ['github', 'google'].includes(connectProvider.id);
    const canSignIn = hasRemoteOAuth || (connectProvider.has_credentials ?? false);

    switch (authState) {
      case 'idle':
        return (
          <Flexbox gap={12} align="center">
            <Flexbox
              align="center" justify="center"
              style={{
                width: 40, height: 40, borderRadius: 10,
                background: connectProvider.color + '12',
              }}
            >
              <PlatformLogo providerId={connectProvider.id} size={20} color={connectProvider.color} />
            </Flexbox>
            <Flexbox gap={2} align="center">
              <Text strong style={{ fontSize: 13 }}>
                {t('auth.login.loginWith', { provider: connectProvider.name })}
              </Text>
              <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
                {t('auth.login.redirectHint', { provider: connectProvider.name })}
              </Text>
            </Flexbox>
            <Button
              type="primary"
              size="small"
              icon={<LogIn size={13} />}
              onClick={handleSignIn}
              disabled={!canSignIn}
              style={{
                background: canSignIn ? connectProvider.color : undefined,
                width: '100%', borderRadius: 8, height: 32, fontSize: 12,
              }}
            >
              {t('auth.login.startAuth')}
            </Button>
          </Flexbox>
        );

      case 'waiting':
        return (
          <Flexbox gap={12} align="center" style={{ padding: '6px 0' }}>
            <Spin size="small" />
            <Text strong style={{ fontSize: 12 }}>{t('auth.login.waiting')}</Text>
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>
              {t('auth.login.waitingHint')}
            </Text>
          </Flexbox>
        );

      case 'success': {
        const conn = connections.find(c => c.provider_id === connectProvider.id);
        return (
          <Flexbox gap={12} align="center">
            <CheckCircle2 size={28} color={token.colorSuccess} />
            <Text strong style={{ fontSize: 13 }}>{t('auth.login.success')}</Text>
            <Text type="secondary" style={{ fontSize: 11 }}>
              {conn ? t('auth.login.successWelcome', { name: conn.user_name || conn.user_id }) : t('auth.login.accountAuthorized')}
            </Text>
            <Button type="primary" size="small" onClick={handleAuthDone} style={{ width: '100%', borderRadius: 8, height: 32, fontSize: 12 }}>
              {t('auth.welcomeBack.continue')}
            </Button>
          </Flexbox>
        );
      }

      case 'error':
        return (
          <Flexbox gap={12} align="center">
            <XCircle size={28} color={token.colorError} />
            <Text strong style={{ fontSize: 13 }}>{t('auth.login.failed')}</Text>
            <Text type="secondary" style={{ fontSize: 11, textAlign: 'center' }}>{authError}</Text>
            <Flexbox horizontal gap={6} style={{ width: '100%' }}>
              <Button size="small" onClick={handleDrawerClose} style={{ flex: 1, borderRadius: 8, height: 32, fontSize: 12 }}>{t('auth.login.cancelAction')}</Button>
              <Button type="primary" size="small" onClick={handleSignIn} style={{ flex: 1, borderRadius: 8, height: 32, fontSize: 12 }}>{t('auth.login.retryAction')}</Button>
            </Flexbox>
          </Flexbox>
        );
    }
  };

  const shiftX = panelOpen ? -(PANEL_WIDTH + PANEL_GAP + ARROW_SIZE) / 2 : 0;

  // ── Card content based on loginState ──

  const renderCardContent = () => {
    // Account Picker: show all restorable accounts
    if (loginState === 'account_picker') {
      return (
        <>
          {!embedded && (
            <img
              src={BRANDING.logos.desktop}
              alt={BRANDING.appName}
              style={{
                width: LOGIN_FORM_LAYOUT.logoSize,
                height: LOGIN_FORM_LAYOUT.logoSize,
                borderRadius: LOGIN_FORM_LAYOUT.logoRadius,
                marginBottom: LOGIN_FORM_LAYOUT.logoBottom,
              }}
            />
          )}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
            {t('auth.accountPicker.title')}
          </h2>
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 20 }}>
            {t('auth.accountPicker.subtitle')}
          </Text>

          <div style={{
            width: '100%',
            maxHeight: 136,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}>
            <Flexbox gap={6}>
              {visibleAccounts.map(account => (
                <button
                  key={account.accountId}
                  onClick={() => handleSelectAccount(account)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    width: '100%',
                    padding: '10px 14px',
                    background: 'none',
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 14,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                    textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = token.colorFillQuaternary;
                    e.currentTarget.style.borderColor = token.colorPrimary;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'none';
                    e.currentTarget.style.borderColor = token.colorBorderSecondary;
                  }}
                >
                  <UserSquareAvatar
                    remoteUrl={account.avatar}
                    name={account.name}
                    size={40}
                    radius={8}
                  />
                  <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {account.name}
                    </Text>
                    {account.email && (
                      <Text type="secondary" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {account.email}
                      </Text>
                    )}
                  </Flexbox>
                  <Flexbox horizontal gap={6} align="center">
                    {!account.hasSession && (
                      // No restorable session locally — clicking will route
                      // straight to the provider's login form rather than
                      // attempting to resume. Surface that up-front so the
                      // user isn't surprised.
                      <span
                        title={t('auth.accountPicker.signInRequired')}
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 6,
                          color: token.colorWarningText,
                          background: token.colorWarningBg,
                          border: `1px solid ${token.colorWarningBorder}`,
                          flexShrink: 0,
                        }}
                      >
                        {t('auth.accountPicker.signInBadge')}
                      </span>
                    )}
                    {account.hasPin && (
                      <ShieldCheck
                        size={14}
                        style={{
                          color: account.hasSession ? token.colorSuccess : token.colorTextTertiary,
                          flexShrink: 0,
                        }}
                      />
                    )}
                    <ChevronRight size={14} style={{ color: token.colorTextTertiary, flexShrink: 0 }} />
                  </Flexbox>
                </button>
              ))}
            </Flexbox>
          </div>

          <Button
            type="dashed"
            style={{ width: '100%', marginTop: 16, height: 40, borderRadius: 12, fontSize: 13 }}
            icon={<LogIn size={14} />}
            onClick={handleNewAccountLogin}
          >
            {t('auth.accountPicker.addAccount')}
          </Button>
        </>
      );
    }

    // PIN Entry
    if (loginState === 'pin_entry' && selectedAccount) {
      return (
        <>
          <button
            onClick={() => {
              setSelectedAccount(null);
              setExpiredAccount(null);
              setLoginState(hasMultipleAccounts ? 'account_picker' : 'logged_out');
            }}
            style={{
              position: 'absolute', top: 16, left: 16,
              display: 'flex', alignItems: 'center', gap: 4,
              background: 'none', border: 'none', cursor: 'pointer',
              color: token.colorTextSecondary, fontSize: 12,
              padding: '4px 8px', borderRadius: 8,
            }}
          >
            <ArrowLeft size={14} />
            {t('auth.pin.back', { defaultValue: 'Back' })}
          </button>

          <div style={{ position: 'relative', marginBottom: 16, marginTop: 8 }}>
            <UserSquareAvatar
              remoteUrl={selectedAccount.avatar}
              name={selectedAccount.name}
              size={72}
              radius={12}
              border={`3px solid ${token.colorBgContainer}`}
            />
          </div>

          <h3 style={{ fontSize: 16, fontWeight: 600, color: token.colorText, margin: '0 0 4px' }}>
            {selectedAccount.name}
          </h3>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 24 }}>
            {pinRevoked
              ? t('auth.pin.sessionExpiredHint', { defaultValue: 'Saved session is no longer valid' })
              : t('auth.pin.enterPin', { defaultValue: 'Enter your PIN to unlock' })}
          </Text>

          {pinRevoked ? (
            // Explicit revoke panel — replaces the PIN inputs so the user
            // unmistakably sees that the saved session is dead and we're
            // about to send them to fresh re-auth. Stays visible for ~1.4s
            // before `handlePinSubmit` triggers `routeToProviderLogin`.
            <Flexbox
              gap={10}
              align="center"
              style={{
                width: '100%',
                padding: '14px 16px',
                borderRadius: 12,
                background: token.colorWarningBg,
                border: `1px solid ${token.colorWarningBorder}`,
              }}
            >
              <AlertTriangle size={28} color={token.colorWarningText} />
              <Text strong style={{ fontSize: 14, color: token.colorWarningText, textAlign: 'center' }}>
                {t('auth.pin.sessionExpiredTitle', { defaultValue: 'Session expired' })}
              </Text>
              <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
                {t('auth.pin.sessionExpiredRedirect', {
                  defaultValue: 'Redirecting you to sign in again…',
                })}
              </Text>
              <Spin size="small" />
            </Flexbox>
          ) : (
            <>
              {renderPinInputRow(pinDigits, pinInputRefs, handlePinChange, handlePinKeyDown, pinLoading)}

              {pinError && (
                <Text type="danger" style={{ fontSize: 12, marginTop: 10, textAlign: 'center' }}>
                  {pinError}
                </Text>
              )}

              {pinLoading && (
                <Spin size="small" style={{ marginTop: 12 }} />
              )}
            </>
          )}
        </>
      );
    }

    // Re-link existing PIN after fresh login. This keeps the already-created
    // PIN without asking the user to create and confirm a brand-new one.
    if (loginState === 'relink_pin' && selectedAccount) {
      return (
        <>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: `${token.colorPrimary}12`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <ShieldCheck size={26} color={token.colorPrimary} />
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
            {t('auth.pin.relinkTitle', { defaultValue: 'Enter PIN' })}
          </h2>
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 24, textAlign: 'center' }}>
            {t('auth.pin.relinkSubtitle', {
              defaultValue: 'Use your existing PIN to keep quick login enabled.',
            })}
          </Text>

          {renderPinInputRow(
            relinkPinDigits,
            relinkPinInputRefs,
            handleRelinkPinChange,
            handleRelinkPinKeyDown,
            relinkPinLoading,
          )}

          {relinkPinError && (
            <Text type="danger" style={{ fontSize: 12, marginTop: 10, textAlign: 'center' }}>
              {relinkPinError}
            </Text>
          )}

          {relinkPinLoading && (
            <Spin size="small" style={{ marginTop: 12 }} />
          )}

        </>
      );
    }

    // Set PIN (after first login)
    if (loginState === 'set_pin') {
      return (
        <>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: `${token.colorPrimary}12`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <ShieldCheck size={26} color={token.colorPrimary} />
          </div>

          <h2 style={{ fontSize: 20, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
            {pinSetStep === 'create'
              ? t('auth.pin.setTitle', { defaultValue: 'Set a PIN' })
              : t('auth.pin.confirmTitle', { defaultValue: 'Confirm PIN' })
            }
          </h2>
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 24, textAlign: 'center' }}>
            {pinSetStep === 'create'
              ? t('auth.pin.setSubtitle', { defaultValue: 'Create a 6-digit PIN to protect your account' })
              : t('auth.pin.confirmSubtitle', { defaultValue: 'Enter the same PIN again to confirm' })
            }
          </Text>

          {pinSetStep === 'create'
            ? renderPinInputRow(newPinDigits, newPinInputRefs, handleNewPinChange, handleNewPinKeyDown, pinSetLoading)
            : renderPinInputRow(confirmPinDigits, confirmPinInputRefs, handleNewPinChange, handleNewPinKeyDown, pinSetLoading)
          }

          {pinSetError && (
            <Text type="danger" style={{ fontSize: 12, marginTop: 10, textAlign: 'center' }}>
              {pinSetError}
            </Text>
          )}

          {pinSetLoading && (
            <Spin size="small" style={{ marginTop: 12 }} />
          )}

          {!selectedAccount?.hasPin && (
            <Button
              type="link"
              size="small"
              onClick={handleSkipPin}
              disabled={pinSetLoading}
              style={{ marginTop: 20, fontSize: 12, color: token.colorTextTertiary }}
            >
              {t('auth.pin.skipForNow', { defaultValue: 'Skip for now' })}
            </Button>
          )}
        </>
      );
    }

    // Welcome back (single user)
    if (loginState === 'welcome_back') {
      return (
        <>
          <div style={{ position: 'relative', marginBottom: 20 }}>
            <div
              style={{
                position: 'absolute',
                inset: -4,
                background: BRANDING.colors.gradient,
                borderRadius: 14,
                filter: 'blur(20px)',
                opacity: 0.2,
              }}
            />
            <UserSquareAvatar
              remoteUrl={welcomeUser.avatar}
              name={welcomeUser.name}
              size={88}
              radius={14}
              border={`3px solid ${token.colorBgContainer}`}
            />
            <div
              style={{
                position: 'absolute',
                bottom: 2,
                right: 2,
                width: 18,
                height: 18,
                background: '#52c41a',
                border: `2px solid ${token.colorBgContainer}`,
                borderRadius: 6,
              }}
            />
          </div>

          <h2 style={{ fontSize: 22, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
            {t('auth.welcomeBack.title')}
          </h2>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: token.colorText, margin: '0 0 6px' }}>
            {welcomeUser.name}
          </h3>
          {welcomeUser.email && (
            <Text type="secondary" style={{ fontSize: 13, marginBottom: 28 }}>
              {welcomeUser.email}
            </Text>
          )}
          {!welcomeUser.email && <div style={{ marginBottom: 28 }} />}

          <Flexbox horizontal gap={12} style={{ width: '100%' }}>
            <Button
              size="large"
              style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 500 }}
              icon={<RefreshCw size={16} />}
              onClick={handleSwitchAccount}
            >
              {t('auth.welcomeBack.switchAccount')}
            </Button>
            <Button
              type="primary"
              size="large"
              style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 500 }}
              icon={<ArrowRight size={16} />}
              iconPosition="end"
              onClick={async () => {
                try {
                  const active = await api.accountGetActive();
                  if (active?.has_pin) {
                    const user = accountIdentityToSessionUser(active);
                    setSelectedAccount(user);
                    setPinDigits(Array(PIN_LENGTH).fill(''));
                    setPinError('');
                    setLoginState('pin_entry');
                    setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
                    return;
                  }
                } catch {
                  // Fall through to set_pin
                }
                setLoginState('set_pin');
              }}
            >
              {t('auth.welcomeBack.continue')}
            </Button>
          </Flexbox>
        </>
      );
    }

    // Logged out: login form
    return (
      <>
        {(hasSignedInUser || hasMultipleAccounts) && (
          <button
            onClick={handleBackToWelcome}
            style={{
              position: 'absolute',
              top: 16,
              left: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'none',
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 20,
              padding: '4px 10px 4px 4px',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = token.colorFillQuaternary;
              e.currentTarget.style.borderColor = token.colorBorder;
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'none';
              e.currentTarget.style.borderColor = token.colorBorderSecondary;
            }}
          >
            {hasMultipleAccounts ? (
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
            )}
          </button>
        )}

        {!embedded && (
          <img
            src={BRANDING.logos.desktop}
            alt={BRANDING.appName}
            style={{
              width: LOGIN_FORM_LAYOUT.logoSize,
              height: LOGIN_FORM_LAYOUT.logoSize,
              borderRadius: LOGIN_FORM_LAYOUT.logoRadius,
              marginBottom: LOGIN_FORM_LAYOUT.logoBottom,
            }}
          />
        )}

        <h2 style={{ fontSize: 22, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
          {expiredAccount
            ? t('auth.login.welcomeBackTitle', { defaultValue: 'Welcome back' })
            : t('auth.login.title')}
        </h2>
        <Text
          type="secondary"
          style={{
            fontSize: 13,
            marginBottom: expiredAccount
              ? LOGIN_FORM_LAYOUT.reauthSubtitleBottom
              : LOGIN_FORM_LAYOUT.subtitleBottom,
            textAlign: 'center',
          }}
        >
          {expiredAccount
            ? reauthReason === 'revoked'
              ? t('auth.login.expiredSubtitle', {
                  defaultValue: 'Sign in again to continue where you left off.',
                })
              : t('auth.login.continueSubtitle', {
                  defaultValue: 'Sign in to continue.',
                })
            : t('auth.login.subtitle')}
        </Text>

        {expiredAccount && (
          <Alert
            type={reauthReason === 'revoked' ? 'warning' : 'info'}
            showIcon
            icon={
              reauthReason === 'revoked'
                ? <AlertTriangle size={18} style={{ color: token.colorWarningText }} />
                : <Lock size={18} style={{ color: token.colorInfoText }} />
            }
            style={{
              width: '100%',
              marginBottom: LOGIN_FORM_LAYOUT.reauthAlertBottom,
              borderRadius: 12,
              padding: '10px 12px',
            }}
            message={
              <Text
                strong
                style={{
                  fontSize: 13,
                  color: reauthReason === 'revoked' ? token.colorWarningText : token.colorInfoText,
                }}
              >
                {reauthReason === 'revoked'
                  ? t('auth.login.expiredAlertTitle', { defaultValue: 'Session expired' })
                  : t('auth.login.continueAlertTitle', { defaultValue: 'Sign in required' })}
              </Text>
            }
            description={
              <Flexbox horizontal gap={10} align="center" style={{ marginTop: 6 }}>
                <UserSquareAvatar
                  remoteUrl={expiredAccount.avatar}
                  name={expiredAccount.name}
                  size={32}
                  radius={6}
                />
                <Flexbox gap={2} style={{ flex: 1, minWidth: 0 }}>
                  <Text strong style={{ fontSize: 13 }}>{expiredAccount.name}</Text>
                  {expiredAccount.email && (
                    <Text type="secondary" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {expiredAccount.email}
                    </Text>
                  )}
                </Flexbox>
              </Flexbox>
            }
          />
        )}

        <div
          style={{
            width: '100%',
            background: token.colorFillQuaternary,
            padding: 4,
            borderRadius: 10,
            display: 'flex',
            marginBottom: LOGIN_FORM_LAYOUT.tabBottom,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <button style={tabStyle(tab === 'quick')} onClick={() => { setTab('quick'); }}>
            {t('auth.login.tab.quick')}
          </button>
          <button style={tabStyle(tab === 'email')} onClick={() => { setTab('email'); setConnectProvider(null); setAuthState('idle'); setAuthError(''); }}>
            {t('auth.login.tab.email')}
          </button>
        </div>

        <div style={{ width: '100%' }}>
          {tab === 'quick' ? (
            <Flexbox gap={10}>
              {oauth2AccountProviders.map(provider => {
                const isExpiredProvider =
                  expiredAccount?.provider?.toLowerCase() === provider.id.toLowerCase();
                const highlight = connectProvider?.id === provider.id || isExpiredProvider;
                return (
                <Button
                  key={provider.id}
                  ref={(el) => { buttonRefs.current[provider.id] = el; }}
                  style={{
                    ...oauthButtonStyle,
                    ...(highlight
                      ? { borderColor: provider.color || token.colorPrimary, color: provider.color || token.colorPrimary }
                      : {}),
                  }}
                  icon={
                    provider.id === 'github'
                      ? <Github size={18} />
                      : <GoogleIcon />
                  }
                  onClick={() => handleOAuthConnect(provider)}
                >
                  {t('auth.login.continueWith', { provider: provider.name })}
                </Button>
                );
              })}
              {oauth2AccountProviders.length === 0 && (
                <>
                  <Button style={oauthButtonStyle} icon={<Github size={18} />} disabled>
                    {t('auth.login.continueWith', { provider: 'GitHub' })}
                  </Button>
                  <Button style={oauthButtonStyle} icon={<GoogleIcon />} disabled>
                    {t('auth.login.continueWith', { provider: 'Google' })}
                  </Button>
                </>
              )}
            </Flexbox>
          ) : gateDecision ? (
            <Flexbox gap={10}>
              <Alert
                type="info"
                showIcon
                icon={<ShieldCheck size={18} style={{ color: token.colorInfoText }} />}
                style={{ width: '100%', borderRadius: 12, padding: '10px 12px' }}
                message={
                  <Text strong style={{ fontSize: 13, color: token.colorInfoText }}>
                    {currentGate(gateDecision)?.title || t('auth.gate.inviteCode.title')}
                  </Text>
                }
                description={
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {currentGate(gateDecision)?.description || t('auth.gate.inviteCode.subtitle')}
                  </Text>
                }
              />
              <Flexbox horizontal gap={8} align="center">
                <Input
                  size="large"
                  autoFocus
                  prefix={<Lock size={16} style={{ color: token.colorTextQuaternary }} />}
                  placeholder={
                    parseGateFields(currentGate(gateDecision))[0]?.placeholder
                      || parseGateFields(currentGate(gateDecision))[0]?.label
                      || t('auth.gate.inviteCode.placeholder')
                  }
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value)}
                  onPressEnter={handleSubmitInviteCode}
                  style={{ borderRadius: 12, height: 44, flex: 1 }}
                />
                <Button
                  type="primary"
                  loading={gateLoading}
                  disabled={!inviteCode.trim() || gateLoading}
                  onClick={handleSubmitInviteCode}
                  style={{
                    height: 44,
                    borderRadius: 12,
                    fontWeight: 500,
                    padding: '0 16px',
                    flexShrink: 0,
                  }}
                  icon={!gateLoading ? <ArrowRight size={16} /> : undefined}
                  iconPosition="end"
                >
                  {t('auth.gate.inviteCode.submit')}
                </Button>
              </Flexbox>
              {gateError && (
                <Text type="danger" style={{ fontSize: 12 }}>{gateError}</Text>
              )}
              <Button
                type="text"
                size="small"
                icon={<ArrowLeft size={14} />}
                onClick={handleCancelGate}
                style={{ alignSelf: 'flex-start' }}
              >
                {t('auth.gate.inviteCode.back')}
              </Button>
            </Flexbox>
          ) : (
            <form onSubmit={handleEmailLogin}>
              <Flexbox gap={10}>
                <Input
                  size="large"
                  prefix={<Mail size={16} style={{ color: token.colorTextQuaternary }} />}
                  placeholder={t('auth.login.email.placeholder')}
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{ borderRadius: 12, height: 44 }}
                  required
                />
                <Flexbox horizontal gap={8} align="center">
                  <Input
                    size="large"
                    prefix={<Lock size={16} style={{ color: token.colorTextQuaternary }} />}
                    suffix={
                      <span
                        onClick={() => setShowPassword(!showPassword)}
                        style={{ cursor: 'pointer', color: token.colorTextQuaternary, display: 'flex' }}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </span>
                    }
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('auth.login.password.placeholder')}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    style={{ borderRadius: 12, height: 44, flex: 1 }}
                    required
                  />
                  <Button
                    type="primary"
                    htmlType="submit"
                    loading={loading}
                    style={{
                      height: 44,
                      borderRadius: 12,
                      fontWeight: 500,
                      padding: '0 16px',
                      flexShrink: 0,
                    }}
                    icon={!loading ? <ArrowRight size={16} /> : undefined}
                    iconPosition="end"
                  >
                    {t('auth.login.submit')}
                  </Button>
                </Flexbox>
              </Flexbox>
            </form>
          )}
        </div>
      </>
    );
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
                padding: '14px 14px',
                position: 'relative',
              }}
              gap={0}
            >
              {authState !== 'waiting' && (
                <button
                  onClick={handleDrawerClose}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 3,
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: token.colorTextQuaternary,
                    transition: 'color 0.15s, background 0.15s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = token.colorFillSecondary;
                    e.currentTarget.style.color = token.colorText;
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'none';
                    e.currentTarget.style.color = token.colorTextQuaternary;
                  }}
                >
                  <X size={14} />
                </button>
              )}
              {renderDrawerContent()}
            </Flexbox>
          </div>
        </div>
      )}
    </div>
  );

  if (embedded) return cardContent;

  return (
    <div className="login-network-shell">
      <div className="login-network-backdrop" aria-hidden="true">
        <StationNetworkIntro
          selectedStationName={selectedStationName}
          labels={networkIntroLabels}
        />
      </div>
      <div className="login-card-region">
        {cardContent}
      </div>
    </div>
  );
}
