import { Button, Icon, Spin } from '@peers-touch/ui';

import { useMobileI18n } from '../../app/mobileI18n';
import logo from '../../assets/logo.png';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

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
          {failed ? <Icon iconId="warning" size={24} /> : <Spin active />}
        </span>
        <h1 className="entry-progress-title">{t(titleKey)}</h1>
        <span className="entry-progress-subtitle">{t(subtitleKey)}</span>
        {stationLabel ? (
          <div className="entry-progress-station">
            <Icon iconId="server" size={17} aria-hidden="true" />
            <strong>{stationLabel}</strong>
          </div>
        ) : null}
        <div
          className="entry-progress-actions"
          data-action-count={(onBack ? 1 : 0) + (onRetry ? 1 : 0)}
        >
          {onBack ? (
            <Button
              actionId="entry.change-station"
              leading={<Icon iconId="arrow-left" size={16} />}
              onActivate={() => void onBack()}
            >
              {t('mobile.auth.changeStation')}
            </Button>
          ) : null}
          {onRetry ? (
            <Button
              actionId="entry.retry"
              emphasis={failed ? 'primary' : 'secondary'}
              leading={<Icon iconId="refresh-cw" size={16} />}
              onActivate={() => void onRetry()}
            >
              {t('common.action.retry')}
            </Button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
