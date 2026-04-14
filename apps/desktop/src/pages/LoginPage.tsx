import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Input, message, theme, Typography, Spin } from 'antd';
import { Github, Mail, Eye, EyeOff, ArrowRight, RefreshCw, Lock, LogIn, CheckCircle2, XCircle, X, ChevronRight, ShieldCheck, ArrowLeft } from 'lucide-react';
import { useOAuth2Store } from '../store/oauth2';
import { useSessionStore } from '../store/session';
import { api, AuthCommandException } from '../services/desktop_api';
import type { OAuth2ProviderSummary } from '../services/desktop_api';
import { UserSquareAvatar } from '../components/common/UserSquareAvatar';
import { PlatformLogo } from '../components/common/PlatformLogo';
import { BRANDING } from '../branding';
import type { SessionUser } from '../types/navigation';

const { Text } = Typography;

type LoginState = 'logged_out' | 'welcome_back' | 'account_picker' | 'pin_entry' | 'set_pin';
type LoginTab = 'quick' | 'email';
type AuthState = 'idle' | 'waiting' | 'success' | 'error';

interface Props {
  onComplete: () => void;
  restoredUser?: SessionUser | null;
  knownAccounts?: SessionUser[];
  embedded?: boolean;
}

const CARD_WIDTH = 400;
const CARD_MIN_HEIGHT = 420;
const PANEL_WIDTH = 250;
const ARROW_SIZE = 8;
const PANEL_GAP = 8;
const PIN_LENGTH = 6;

export function LoginPage({ onComplete, restoredUser, knownAccounts = [], embedded }: Props) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');
  const { providers, connections, loadAll, startAuth } = useOAuth2Store();
  const { loginWithPassword } = useSessionStore();

  const hasMultipleAccounts = knownAccounts.length > 0;
  const initialState: LoginState = hasMultipleAccounts
    ? 'account_picker'
    : restoredUser
      ? 'welcome_back'
      : 'logged_out';

  const [loginState, setLoginState] = useState<LoginState>(initialState);
  const [tab, setTab] = useState<LoginTab>('quick');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [connectProvider, setConnectProvider] = useState<OAuth2ProviderSummary | null>(null);
  const [authState, setAuthState] = useState<AuthState>('idle');
  const [authError, setAuthError] = useState('');
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

  // Set PIN state (after first login)
  const [newPinDigits, setNewPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [confirmPinDigits, setConfirmPinDigits] = useState<string[]>(Array(PIN_LENGTH).fill(''));
  const [pinSetStep, setPinSetStep] = useState<'create' | 'confirm'>('create');
  const [pinSetError, setPinSetError] = useState('');
  const newPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const confirmPinInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const oauth2AccountProviders = useMemo(
    () => providers.filter(p => p.id === 'github' || p.id === 'google'),
    [providers],
  );

  const welcomeUser: SessionUser = useMemo(() => {
    if (restoredUser) return restoredUser;
    return { name: 'User', email: '' };
  }, [restoredUser]);

  const handleEmailLogin = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true);
    try {
      await loginWithPassword(email.trim(), password);
      setLoginState('set_pin');
    } catch (err: any) {
      message.error(err.message || t('auth.login.failed'));
    } finally {
      setLoading(false);
    }
  }, [email, password, loginWithPassword]);

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

  const handleAuthDone = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    setLoginState('set_pin');
  }, []);

  const handleSwitchAccount = useCallback(() => {
    setConnectProvider(null);
    setAuthState('idle');
    setAuthError('');
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
    } else {
      setLoginState('welcome_back');
    }
  }, [hasMultipleAccounts]);

  const handleNewAccountLogin = useCallback(() => {
    setLoginState('logged_out');
    setTab('quick');
  }, []);

  // ── Account Picker ──

  const handleSelectAccount = useCallback((account: SessionUser) => {
    setSelectedAccount(account);
    setPinDigits(Array(PIN_LENGTH).fill(''));
    setPinError('');
    if (account.hasPin) {
      setLoginState('pin_entry');
      setTimeout(() => pinInputRefs.current[0]?.focus(), 50);
    } else {
      // No PIN set — for accounts without PIN, try direct restore
      setLoginState('welcome_back');
    }
  }, []);

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
      const resp = await api.accountUnlock(selectedAccount.accountId, pin);
      const user = resp.actor_id ? {
        actorId: resp.actor_id,
        name: resp.name || '',
        email: resp.email || '',
        avatarUrl: resp.avatar_url || undefined,
        loginMethod: (resp.login_method as 'password' | 'oauth') || 'password',
      } : null;
      if (user) {
        useSessionStore.setState({ currentUser: user, authenticated: true });
      }
      onComplete();
    } catch (err: any) {
      const details = err instanceof AuthCommandException ? err.details : undefined;
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
  }, [selectedAccount, pinDigits, onComplete]);

  // Auto-submit PIN when all digits are entered
  useEffect(() => {
    if (loginState === 'pin_entry' && pinDigits.every(d => d !== '') && !pinLoading) {
      handlePinSubmit();
    }
  }, [pinDigits, loginState, pinLoading, handlePinSubmit]);

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
    if (pinSetStep === 'create' && newPinDigits.every(d => d !== '')) {
      setPinSetStep('confirm');
      setConfirmPinDigits(Array(PIN_LENGTH).fill(''));
      setPinSetError('');
      setTimeout(() => confirmPinInputRefs.current[0]?.focus(), 50);
    }
  }, [newPinDigits, pinSetStep]);

  // Auto-submit confirm
  useEffect(() => {
    if (pinSetStep === 'confirm' && confirmPinDigits.every(d => d !== '')) {
      const pin = newPinDigits.join('');
      const confirm = confirmPinDigits.join('');
      if (pin !== confirm) {
        setPinSetError(t('auth.pin.mismatch', { defaultValue: 'PINs do not match. Try again.' }));
        setPinSetStep('create');
        setNewPinDigits(Array(PIN_LENGTH).fill(''));
        setConfirmPinDigits(Array(PIN_LENGTH).fill(''));
        setTimeout(() => newPinInputRefs.current[0]?.focus(), 50);
        return;
      }

      (async () => {
        try {
          const activeAccount = await api.accountGetActive();
          const accountId = activeAccount?.id;
          if (accountId) {
            await api.accountSetPin(accountId, pin);
          }
          onComplete();
        } catch (err: any) {
          setPinSetError(err.message || 'Failed to set PIN');
          setPinSetStep('create');
          setNewPinDigits(Array(PIN_LENGTH).fill(''));
          setTimeout(() => newPinInputRefs.current[0]?.focus(), 50);
        }
      })();
    }
  }, [confirmPinDigits, pinSetStep, newPinDigits, onComplete]);

  const handleSkipPin = useCallback(() => {
    onComplete();
  }, [onComplete]);

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
  const hasSignedInUser = !!restoredUser;

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
    minHeight: CARD_MIN_HEIGHT,
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
                width: 48,
                height: 48,
                borderRadius: 12,
                marginBottom: 12,
                boxShadow: `0 2px 12px rgba(0,0,0,0.08), 0 0 0 1px ${token.colorBorderSecondary}`,
              }}
            />
          )}
          <h2 style={{ fontSize: 20, fontWeight: 700, color: token.colorText, margin: '0 0 4px' }}>
            {t('auth.accountPicker.title', { defaultValue: 'Choose Account' })}
          </h2>
          <Text type="secondary" style={{ fontSize: 13, marginBottom: 20 }}>
            {t('auth.accountPicker.subtitle', { defaultValue: 'Select an account to continue' })}
          </Text>

          <div style={{ width: '100%', maxHeight: 260, overflowY: 'auto' }}>
            <Flexbox gap={6}>
              {knownAccounts.map(account => (
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
                    url={account.avatar}
                    name={account.name}
                    size={40}
                    radius={20}
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
                  <Flexbox horizontal gap={4} align="center">
                    {account.hasPin && (
                      <ShieldCheck size={14} style={{ color: token.colorSuccess, flexShrink: 0 }} />
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
            {t('auth.accountPicker.addAccount', { defaultValue: 'Sign in with another account' })}
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
              url={selectedAccount.avatar}
              name={selectedAccount.name}
              size={72}
              radius={36}
              border={`3px solid ${token.colorBgContainer}`}
            />
          </div>

          <h3 style={{ fontSize: 16, fontWeight: 600, color: token.colorText, margin: '0 0 4px' }}>
            {selectedAccount.name}
          </h3>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 24 }}>
            {t('auth.pin.enterPin', { defaultValue: 'Enter your PIN to unlock' })}
          </Text>

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
            ? renderPinInputRow(newPinDigits, newPinInputRefs, handleNewPinChange, handleNewPinKeyDown)
            : renderPinInputRow(confirmPinDigits, confirmPinInputRefs, handleNewPinChange, handleNewPinKeyDown)
          }

          {pinSetError && (
            <Text type="danger" style={{ fontSize: 12, marginTop: 10, textAlign: 'center' }}>
              {pinSetError}
            </Text>
          )}

          <Button
            type="link"
            size="small"
            onClick={handleSkipPin}
            style={{ marginTop: 20, fontSize: 12, color: token.colorTextTertiary }}
          >
            {t('auth.pin.skipForNow', { defaultValue: 'Skip for now' })}
          </Button>
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
                borderRadius: '50%',
                filter: 'blur(20px)',
                opacity: 0.2,
              }}
            />
            <UserSquareAvatar
              url={welcomeUser.avatar}
              name={welcomeUser.name}
              size={88}
              radius={44}
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
                borderRadius: '50%',
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
              onClick={() => {
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
                  {t('auth.accountPicker.back', { defaultValue: 'Accounts' })}
                </Text>
              </>
            ) : (
              <>
                <UserSquareAvatar
                  url={welcomeUser.avatar}
                  name={welcomeUser.name}
                  size={24}
                  radius={12}
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
              width: 64,
              height: 64,
              borderRadius: 16,
              marginBottom: 16,
              boxShadow: `0 2px 12px rgba(0,0,0,0.08), 0 0 0 1px ${token.colorBorderSecondary}`,
            }}
          />
        )}

        <h2 style={{ fontSize: 22, fontWeight: 700, color: token.colorText, margin: '0 0 6px' }}>
          {t('auth.login.title')}
        </h2>
        <Text type="secondary" style={{ fontSize: 13, marginBottom: 24 }}>
          {t('auth.login.subtitle')}
        </Text>

        <div
          style={{
            width: '100%',
            background: token.colorFillQuaternary,
            padding: 4,
            borderRadius: 10,
            display: 'flex',
            marginBottom: 24,
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
              {oauth2AccountProviders.map(provider => (
                <Button
                  key={provider.id}
                  ref={(el) => { buttonRefs.current[provider.id] = el; }}
                  style={{
                    ...oauthButtonStyle,
                    ...(connectProvider?.id === provider.id
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
              ))}
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
    <Flexbox
      align="center"
      justify="center"
      style={{ width: '100%', height: '100%', background: token.colorBgLayout }}
    >
      {cardContent}
    </Flexbox>
  );
}
