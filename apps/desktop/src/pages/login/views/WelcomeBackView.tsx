import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Flexbox } from 'react-layout-kit';
import { Button, Typography, theme } from 'antd';
import { ArrowRight, RefreshCw } from 'lucide-react';
import { UserSquareAvatar } from '../../../components/common/UserSquareAvatar';
import { BRANDING } from '../../../branding';
import type { SessionUser } from '../types';

const { Text } = Typography;

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
  const { token } = theme.useToken();
  const { t } = useTranslation('auth');

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
          remoteUrl={user.avatar}
          name={user.name}
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
        {user.name}
      </h3>
      {user.email && (
        <Text type="secondary" style={{ fontSize: 13, marginBottom: 28 }}>
          {user.email}
        </Text>
      )}
      {!user.email && <div style={{ marginBottom: 28 }} />}

      <Flexbox horizontal gap={12} style={{ width: '100%' }}>
        <Button
          size="large"
          style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 500 }}
          icon={<RefreshCw size={16} />}
          onClick={onSwitchAccount}
        >
          {t('auth.welcomeBack.switchAccount')}
        </Button>
        <Button
          type="primary"
          size="large"
          style={{ flex: 1, height: 44, borderRadius: 12, fontWeight: 500 }}
          icon={<ArrowRight size={16} />}
          iconPosition="end"
          onClick={onContinue}
        >
          {t('auth.welcomeBack.continue')}
        </Button>
      </Flexbox>
    </>
  );
});
