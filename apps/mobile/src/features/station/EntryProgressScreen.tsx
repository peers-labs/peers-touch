import { Button, Spin, Typography } from 'antd';
import { AlertTriangle, ArrowLeft, RefreshCw, Server } from 'lucide-react';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

const { Text, Title } = Typography;

export type EntryProgressKind = 'boot' | 'station-handshake' | 'runtime';

export function EntryProgressScreen({
  kind,
  stationLabel,
  failed = false,
  onBack,
  onRetry,
}: {
  kind: EntryProgressKind;
  stationLabel?: string;
  failed?: boolean;
  onBack?: () => void | Promise<void>;
  onRetry?: () => void | Promise<void>;
}) {
  const { t } = useMobileI18n();
  const surfaceId = kind === 'boot'
    ? 'entry.app-boot'
    : kind === 'station-handshake'
      ? 'entry.station-handshake'
      : failed
        ? 'entry.runtime-critical'
        : 'entry.runtime-preparing';
  const titleKey = kind === 'boot'
    ? 'mobile.entry.bootTitle'
    : kind === 'station-handshake'
      ? 'mobile.entry.handshakeTitle'
      : failed
        ? 'mobile.entry.runtimeFailedTitle'
        : 'mobile.entry.runtimePreparingTitle';
  const subtitleKey = kind === 'boot'
    ? 'mobile.entry.bootSubtitle'
    : kind === 'station-handshake'
      ? 'mobile.entry.handshakeSubtitle'
      : failed
        ? 'mobile.entry.runtimeFailedSubtitle'
        : 'mobile.entry.runtimePreparingSubtitle';

  return (
    <main className="entry-progress-screen" data-product-surface={surfaceId}>
      <div className="entry-progress-toolbar">
        <LanguageSwitcher />
      </div>
      <section className={`entry-progress-panel ${failed ? 'failed' : ''}`} aria-live="polite">
        <img src={logo} alt="Peers" className="entry-progress-logo" />
        <span className="entry-progress-state-icon" aria-hidden="true">
          {failed ? <AlertTriangle size={24} /> : <Spin size="default" />}
        </span>
        <Title level={1}>{t(titleKey)}</Title>
        <Text type="secondary">{t(subtitleKey)}</Text>
        {stationLabel ? (
          <div className="entry-progress-station">
            <Server size={17} aria-hidden="true" />
            <Text strong>{stationLabel}</Text>
          </div>
        ) : null}
        <div className="entry-progress-actions">
          {onBack ? (
            <Button
              icon={<ArrowLeft size={16} />}
              onClick={() => void onBack()}
            >
              {t('mobile.auth.changeStation')}
            </Button>
          ) : null}
          {onRetry ? (
            <Button
              type={failed ? 'primary' : 'default'}
              icon={<RefreshCw size={16} />}
              onClick={() => void onRetry()}
            >
              {t('common.action.retry')}
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
