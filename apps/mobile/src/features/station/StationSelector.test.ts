import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('./StationSelector.tsx', import.meta.url),
  'utf8',
);
const launchSource = readFileSync(
  new URL('./StationLaunchScreen.tsx', import.meta.url),
  'utf8',
);

describe('StationSelector removal contract', () => {
  it('requires an explicit destructive confirmation before removing a Station', () => {
    expect(source).toContain('setPendingRemoval(entry)');
    expect(source).toContain('open={pendingRemoval !== null}');
    expect(source).toContain('onOk={confirmStationRemoval}');
    expect(source).toContain('onCancel={() => setPendingRemoval(null)}');
    expect(source).toContain('okButtonProps={{ danger: true }}');
  });

  it('removes only the Station captured by the confirmation state', () => {
    expect(source).toContain('onRemove(pendingRemoval.stationPeerId)');
    expect(source).not.toContain('onRemove(entry.stationPeerId)');
  });
});

describe('StationSelector reachability states', () => {
  it('keeps an unchecked Station distinct from an active verification', () => {
    expect(source).toContain('if (verifying) {');
    expect(source).toContain("className: 'validating'");
    expect(source).toContain('if (entry.online === undefined) {');
    expect(source).toContain("className: 'unknown'");
    expect(source).toContain("t('mobile.launch.unknown')");
  });
});

describe('Station launch visual contract', () => {
  it('keeps the entry task compact and unframed', () => {
    expect(launchSource).toContain('className="launch-content"');
    expect(launchSource).toContain('className="launch-brand-logo"');
    expect(launchSource).toContain('className="launch-panel"');
    expect(launchSource).not.toContain('<Card');
    expect(launchSource).not.toContain('launch-hero');
  });

  it('uses one contextual primary action', () => {
    expect(launchSource).toContain("t('mobile.launch.enterStationWithName'");
    expect(launchSource).toContain('disabled={!activeStation}');
  });

  it('renders Station address as one parent field frame', () => {
    expect(source).toContain('className="station-url-divider"');
    expect(source).toContain('className="station-add-inline"');
    expect(source).toContain('className="station-protocol-select"');
    expect(source).toContain('<ChevronDown');
    expect(source).not.toContain('<Tag');
  });
});
