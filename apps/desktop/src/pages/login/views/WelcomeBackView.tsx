import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon } from '@peers-touch/ui';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import type { SessionUser } from '../types';

export interface WelcomeBackViewProps {
  user: SessionUser;
  onContinue: () => void;
  onSwitchAccount: () => void;
}

export const WelcomeBackView = memo(function WelcomeBackView({
  user,
  onContinue,
  onSwitchAccount,
}: WelcomeBackViewProps) {
  const { t } = useTranslation('auth');

  return (
    <div className="pt-auth-form">
      <div className="pt-auth-identity" style={{ marginBottom: 4 }}>
        <UserSquareAvatar
          remoteUrl={user.avatar}
          avatarLocalPath={user.avatarLocalPath}
          name={user.name}
          size={72}
          radius={14}
        />
      </div>
      <h2 className="pt-auth-title">{t('auth.welcomeBack.title')}</h2>
      <div className="pt-auth-identity">
        <span className="pt-auth-identity-name">{user.name}</span>
        {user.email && <span className="pt-auth-identity-handle">{user.email}</span>}
      </div>

      <div className="pt-auth-actions-row" style={{ marginTop: 6 }}>
        <Button
          actionId="auth.welcome.switch"
          emphasis="secondary"
          leading={<Icon iconId="refresh-cw" size={16} />}
          onActivate={onSwitchAccount}
        >
          {t('auth.welcomeBack.switchAccount')}
        </Button>
        <Button
          actionId="auth.welcome.continue"
          emphasis="primary"
          trailing={<Icon iconId="arrow-right" size={16} />}
          onActivate={onContinue}
        >
          {t('auth.welcomeBack.continue')}
        </Button>
      </div>
    </div>
  );
});
