// Source-contract: storage and files data surfaces carry their type scale in
// classes (north-star grammar), not inline fontSize styles. The prototype
// .sk-stat-card strong is 20px and secondary list annotations are 12px.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const storageSource = readFileSync(
  new URL('./ChatStorageSettings.tsx', import.meta.url),
  'utf8',
);
const filesSource = readFileSync(
  new URL('./MyFilesSettings.tsx', import.meta.url),
  'utf8',
);
const css = readFileSync(new URL('../../ui/northstar.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
}

describe('storage data surface type scale', () => {
  it('renders the 20px category byte total through a class', () => {
    expect(storageSource).toContain('className="sc-storage-category__value"');
    expect(storageSource).not.toContain('fontSize: 20');
    expect(rule('.sc-storage-category__value')).toContain('font-size: 20px');
  });

  it('renders conversation annotations at 12px through a class', () => {
    expect(storageSource.match(/sc-storage-conversation__detail/g)?.length).toBeGreaterThanOrEqual(2);
    expect(storageSource).not.toContain('style={{ fontSize: 12 }}');
    expect(rule('.sc-storage-conversation__detail')).toContain('font-size: 12px');
  });
});

describe('files data surface type scale', () => {
  it('renders the mime annotation at 12px through a class', () => {
    expect(filesSource).toContain('className="sc-myfiles-name__detail"');
    expect(filesSource).not.toContain('style={{ fontSize: 12 }}');
    expect(rule('.sc-myfiles-name__detail')).toContain('font-size: 12px');
  });

  it('uses the prototype field hint for expiry annotations, not inline Text sizing', () => {
    expect(filesSource).toContain('<p className="sk-field-hint">');
    expect(rule('.sk-field-hint')).toContain('font-size: 12px');
  });
});
