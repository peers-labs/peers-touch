import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const networkSource = readFileSync(
  new URL('./FederationTab.tsx', import.meta.url),
  'utf8',
);
const settingsPageSource = readFileSync(
  new URL('../../pages/SettingsPage.tsx', import.meta.url),
  'utf8',
);

describe('Desktop Network settings production replica', () => {
  it('lands the three-section Network information architecture', () => {
    for (const section of [
      "key: 'network-station'",
      "key: 'network-discovery'",
      "key: 'federation'",
      "sectionKeys: ['network-station', 'network-discovery', 'federation']",
    ]) {
      expect(settingsPageSource).toContain(section);
    }
  });

  it('uses runtime-owned projections and the identity lifecycle', () => {
    expect(networkSource).toContain('useActiveFederationSlice');
    expect(networkSource).toContain('useActiveSettingsSlice');
    expect(networkSource).toContain('await identityRuntime.switchStation()');
    expect(networkSource).toContain('data-device-revoke={deviceId}');
    expect(networkSource).toMatch(
      /await revokeDevice\(deviceId, observedProfileVersion\)/,
    );
    expect(networkSource).toContain('device.profileVersion');
    expect(networkSource).toContain('loading={deviceRevokingId === deviceId}');
    expect(networkSource).not.toContain('settings.network.devices.remoteRevokePending');
    expect(networkSource).not.toContain('MOCK_FEDERATIONS');
    expect(networkSource).not.toContain('localStorage');
  });

  it('wires profile-owned discovery and contact policy controls', () => {
    expect(networkSource).toMatch(
      /const handleContactPolicyChange = async \(next: ReachPolicy\)[\s\S]*await setContactPolicy\(next\)/,
    );
    expect(networkSource).toMatch(
      /const handleFederationVisibilityChange = async \([\s\S]*await setFederationVisibility\(\s*federationId,\s*checked \? 'indexed' : 'by_handle',/,
    );
    expect(networkSource).toMatch(
      /value=\{reachValue\}[\s\S]*onChange=\{\(next\) => \{\s*void handleContactPolicyChange\(next\)/,
    );
    expect(networkSource).toMatch(
      /checked=\{[\s\S]*self\?\.federation_visibility\[federation\.federationId\][\s\S]*handleFederationVisibilityChange\(\s*federation\.federationId,\s*checked,/,
    );
    expect(networkSource).not.toContain('perFederationPending');
    expect(networkSource).not.toContain('settings.network.contact.pending');
  });

  it('keeps remaining membership command gaps visible and non-interactive', () => {
    expect(networkSource).toContain('data-pending-backend');
    expect(networkSource).toContain('data-join-federation');
    expect(networkSource).toContain('data-leave-federation');
    expect(networkSource).toContain('<Button danger disabled data-leave-federation>');
  });
});
