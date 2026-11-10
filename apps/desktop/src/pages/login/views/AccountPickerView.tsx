import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, Tag } from '@peers-touch/ui';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import type { SessionUser } from '../types';

export interface AccountPickerViewProps {
  accounts: SessionUser[];
  embedded?: boolean;
  onSelectAccount: (account: SessionUser) => void;
  onAddAccount: () => void;
}

export const AccountPickerView = memo(function AccountPickerView({
  accounts,
  onSelectAccount,
  onAddAccount,
}: AccountPickerViewProps) {
  const { t } = useTranslation('auth');

  return (
    <div className="pt-auth-form">
      <h2 className="pt-auth-title">{t('auth.accountPicker.title')}</h2>

      <div className="pt-auth-account-list">
        {accounts.map((account) => (
          <Button
            key={account.accountId}
            actionId={`auth.account.select.${account.accountId ?? 'unknown'}`}
            fullWidth
            emphasis="secondary"
            className="pt-auth-account-row"
            data-login-account={account.accountId}
            leading={
              <UserSquareAvatar
                remoteUrl={account.avatar}
                avatarLocalPath={account.avatarLocalPath}
                name={account.name}
                size={38}
                radius={8}
              />
            }
            trailing={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {!account.hasSession && (
                  <Tag tone="warning">{t('auth.accountPicker.signInBadge')}</Tag>
                )}
                {account.hasPin && (
                  <Icon
                    iconId="shield-check"
                    size={15}
                    label={t('auth.accountPicker.signInRequired')}
                    style={{ color: account.hasSession ? 'var(--pt-success)' : 'var(--pt-muted)' }}
                  />
                )}
                <Icon iconId="chevron-right" size={15} />
              </span>
            }
            onActivate={() => onSelectAccount(account)}
          >
            <span className="pt-auth-account-meta">
              <span className="pt-auth-account-name">{account.name}</span>
              {account.email && (
                <span className="pt-auth-account-handle">{account.email}</span>
              )}
            </span>
          </Button>
        ))}
      </div>

      <Button
        actionId="auth.account.add"
        fullWidth
        emphasis="quiet"
        data-login-add-account
        leading={<Icon iconId="user-plus" size={16} />}
        onActivate={onAddAccount}
      >
        {t('auth.accountPicker.addAccount')}
      </Button>
    </div>
  );
});
