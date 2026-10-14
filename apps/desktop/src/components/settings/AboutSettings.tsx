import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { Tag } from 'antd';
import { AppWindow } from 'lucide-react';

import packageJson from '../../../package.json';
import { usePrefetch } from '../../kernel/usePrefetch';
import {
  SettingsRow,
  SettingsSection,
} from './SettingsLayout';

declare const __PT_SOURCE_COMMIT__: string;

interface DesktopAboutInfo {
  version: string;
  runtime: 'native' | 'browser';
  platform: string;
  buildMode: 'development' | 'production';
  sourceCommit: string;
}

function platformLabel(): string {
  const browserNavigator = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return browserNavigator.userAgentData?.platform?.trim()
    || browserNavigator.platform?.trim()
    || 'unknown';
}

async function loadDesktopAboutInfo(): Promise<DesktopAboutInfo> {
  const native = isTauri();
  const version = native
    ? await getVersion().catch(() => packageJson.version)
    : packageJson.version;
  return {
    version,
    runtime: native ? 'native' : 'browser',
    platform: platformLabel(),
    buildMode: import.meta.env.DEV ? 'development' : 'production',
    sourceCommit: __PT_SOURCE_COMMIT__ || 'unknown',
  };
}

export function AboutSettings() {
  const { t } = useTranslation('settings');
  const { value: info } = usePrefetch(
    'settings.about',
    loadDesktopAboutInfo,
  );

  return (
    <SettingsSection
      icon={<AppWindow size={18} />}
      title={t('settings.help.aboutTitle')}
      subtitle={t('settings.help.aboutDescription')}
      extra={info ? <Tag>{`v${info.version}`}</Tag> : undefined}
    >
      <SettingsRow label={t('settings.help.version')}>
        <span>{info?.version ?? t('settings.help.loading')}</span>
      </SettingsRow>
      <SettingsRow label={t('settings.help.runtime')}>
        <span>
          {info
            ? t(`settings.help.runtimeValue.${info.runtime}`)
            : t('settings.help.loading')}
        </span>
      </SettingsRow>
      <SettingsRow label={t('settings.help.platform')}>
        <span>{info?.platform ?? t('settings.help.loading')}</span>
      </SettingsRow>
      <SettingsRow label={t('settings.help.buildMode')}>
        <span>
          {info
            ? t(`settings.help.buildModeValue.${info.buildMode}`)
            : t('settings.help.loading')}
        </span>
      </SettingsRow>
      <SettingsRow label={t('settings.help.sourceCommit')}>
        <code>{info?.sourceCommit.slice(0, 12) ?? t('settings.help.loading')}</code>
      </SettingsRow>
    </SettingsSection>
  );
}
