import { IconButton, ListRow, ListSection, Text } from '@peers-touch/ui';
import { useMobileI18n } from '../../app/mobileI18n';

interface AccountCredentialsSectionProps {
  readonly username: string;
  readonly actorPtid: string;
  readonly stationName: string;
  readonly copyingField: 'username' | 'ptid' | null;
  readonly onCopy: (field: 'username' | 'ptid', value: string) => void;
}

/** Public session identity facts; never key material. */
export function AccountCredentialsSection({ username, actorPtid, stationName, copyingField, onCopy }: AccountCredentialsSectionProps) {
  const { t } = useMobileI18n();
  return <div data-credentials-page>
    <ListSection inset title={t('mobile.settings.credentials.identity')} description={t('mobile.settings.credentials.description')}>
      {([['username', username], ['ptid', actorPtid]] as const).map(([field, value]) => (
        <ListRow key={field} data-credential={field}
          label={<span className="mobile-credential-value"><Text tone="secondary">{t(`mobile.settings.credentials.${field}`)}</Text>
            <code title={value}>{value || t('mobile.launch.unavailable')}</code></span>}
          control={<IconButton actionId={`settings.credentials.copy-${field}`} iconId="copy" density="comfortable"
            emphasis="quiet" label={t('mobile.settings.credentials.copy', { field: t(`mobile.settings.credentials.${field}`) })}
            execution={copyingField === field ? 'pending' : 'idle'}
            availability={!value ? { kind: 'disabled', reason: t('mobile.launch.unavailable') } : undefined}
            onActivate={() => onCopy(field, value)} />} />
      ))}
      <ListRow data-credential="station" label={t('mobile.settings.credentials.station')} control={<Text>{stationName}</Text>} />
    </ListSection>
  </div>;
}
