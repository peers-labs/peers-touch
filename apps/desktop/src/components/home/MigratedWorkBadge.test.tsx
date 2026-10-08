import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { HomeTaskMigrationState } from '../../gen/proto/domain/agent/home_pb';
import { migrationBadgeKind } from './MigratedWorkBadge';

const source = readFileSync(
  fileURLToPath(new URL('./MigratedWorkBadge.tsx', import.meta.url)),
  'utf8',
);

describe('MigratedWorkBadge', () => {
  it('distinguishes migrated, blocked, and ordinary work', () => {
    expect(
      migrationBadgeKind(HomeTaskMigrationState.MIGRATED),
    ).toBe('migrated');
    expect(
      migrationBadgeKind(HomeTaskMigrationState.BLOCKED),
    ).toBe('blocked');
    expect(
      migrationBadgeKind(HomeTaskMigrationState.UNSPECIFIED),
    ).toBeNull();
  });

  it('exposes source and blocking state for native acceptance', () => {
    expect(source).toContain('data-pt-migrated-work');
    expect(source).toContain('data-pt-migration-source-id');
    expect(source).toContain('data-pt-migration-block-reason');
    expect(source).toContain("t('agent.home.migrationBlocked')");
    expect(source).toContain("t('agent.home.migratedWork')");
  });
});
