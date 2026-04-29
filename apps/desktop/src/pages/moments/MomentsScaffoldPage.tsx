import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Center, Flexbox } from 'react-layout-kit';
import { Empty, Typography, theme } from 'antd';
import type { LucideIcon } from 'lucide-react';
import { PageHeader } from '../../components/PageHeader';

const { Text } = Typography;

interface MomentsScaffoldPageProps {
  /** Title i18n key, resolved against the `moments` namespace. */
  titleKey: string;
  /** Subtitle i18n key (optional). */
  subtitleKey?: string;
  /** Empty-state description i18n key (resolved with i18n). */
  descKey: string;
  Icon: LucideIcon;
  actions?: ReactNode;
}

/**
 * Shared placeholder shell used by every Moments page during P0.
 *
 * Renders only the chrome (page header + empty state). Real
 * timeline / composer / circle wiring is intentionally deferred
 * to P2 — this file exists so the module registry, sidebar entry,
 * router, i18n namespace, and visual rhythm are all exercised
 * end-to-end the moment proto types land.
 */
export function MomentsScaffoldPage({
  titleKey,
  subtitleKey,
  descKey,
  Icon,
  actions,
}: MomentsScaffoldPageProps) {
  const { t } = useTranslation('moments');
  const { token } = theme.useToken();

  return (
    <Flexbox
      flex={1}
      style={{ background: token.colorBgLayout, minHeight: 0 }}
    >
      <PageHeader
        title={t(titleKey)}
        subtitle={subtitleKey ? t(subtitleKey) : undefined}
        icon={<Icon size={20} color={token.colorPrimary} />}
        actions={actions}
      />
      <Center flex={1} padding={32}>
        <Flexbox align="center" gap={12} style={{ maxWidth: 480 }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Flexbox align="center" gap={6}>
                <Text>{t(descKey)}</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {t('moments.placeholder.scaffold')}
                </Text>
              </Flexbox>
            }
          />
        </Flexbox>
      </Center>
    </Flexbox>
  );
}

/** Helper used by the per-surface page modules below. */
export function makeMomentsPage(
  Icon: LucideIcon,
  titleKey: string,
  descKey: string,
  subtitleKey?: string,
): ComponentType {
  return function MomentsPage() {
    return (
      <MomentsScaffoldPage
        Icon={Icon}
        titleKey={titleKey}
        subtitleKey={subtitleKey}
        descKey={descKey}
      />
    );
  };
}
