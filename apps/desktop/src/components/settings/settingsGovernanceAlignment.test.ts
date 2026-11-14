import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../pages/SettingsPage.tsx', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../../modules/registry.ts', import.meta.url), 'utf8');

describe('ordinary Desktop settings governance', () => {
  it('keeps Federation management out of the consumer settings tree', () => {
    expect(source).not.toContain('FederationTab');
    expect(source).not.toMatch(/key:\s*['"]federation['"]/);
    expect(registry).not.toContain('federationModule');
    expect(existsSync(new URL('./FederationTab.tsx', import.meta.url))).toBe(false);
  });

  it('keeps model consumption without restoring provider administration', () => {
    expect(source).toContain("'models'");
    expect(source).not.toContain("'providers'");
    expect(registry).not.toContain('providersModule');
  });
});
