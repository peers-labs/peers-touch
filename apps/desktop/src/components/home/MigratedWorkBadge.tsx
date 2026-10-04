import { Tag } from 'antd';
import { useTranslation } from 'react-i18next';

import { HomeTaskMigrationState } from '../../gen/proto/domain/agent/home_pb';

interface MigratedWorkBadgeProps {
  state: HomeTaskMigrationState;
  sourceId: string;
  blockReason: string;
}

export function migrationBadgeKind(
  state: HomeTaskMigrationState,
): 'migrated' | 'blocked' | null {
  if (state === HomeTaskMigrationState.MIGRATED) return 'migrated';
  if (state === HomeTaskMigrationState.BLOCKED) return 'blocked';
  return null;
}

export function MigratedWorkBadge({
  state,
  sourceId,
  blockReason,
}: MigratedWorkBadgeProps) {
  const { t } = useTranslation('agent');
  const kind = migrationBadgeKind(state);
  if (!kind) return null;

  return (
    <Tag
      color={kind === 'blocked' ? 'warning' : 'default'}
      data-pt-migrated-work={kind}
      data-pt-migration-block-reason={blockReason}
      data-pt-migration-source-id={sourceId}
    >
      {kind === 'blocked'
        ? t('agent.home.migrationBlocked')
        : t('agent.home.migratedWork')}
    </Tag>
  );
}
