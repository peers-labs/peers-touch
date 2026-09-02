import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Typography, theme } from 'antd';
import { ChevronRight, LogIn, ShieldCheck } from 'lucide-react';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import { BRANDING } from '../../../branding';
import { LOGIN_FORM_LAYOUT } from '../constants';
import type { SessionUser } from '../types';

const { Text } = Typography;

export interface AccountPickerViewProps {
  accounts: SessionUser[];
  embedded?: boolean;
  onSelectAccount: (account: SessionUser) => void;
  onAddAccount: () => void;
}

export const AccountPickerView = memo(function AccountPickerView({
  accounts,
  embedded,
  onSelectAccount,
  onAddAccount,
}: AccountPickerViewProps) {
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');

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
          {accounts.map(account => (
            <button
              key={account.accountId}
              onClick={() => onSelectAccount(account)}
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
        onClick={onAddAccount}
        data-login-add-account
      >
        {t('auth.accountPicker.addAccount')}
      </Button>
    </>
  );
});
