import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type {
  XConfigSuggestion,
  StationEntry,
} from '../../services/desktop_api';
import { visibleXConfigSuggestions } from './StationPicker';

const source = readFileSync(new URL('./StationPicker.tsx', import.meta.url), 'utf8');

describe('Desktop StationPicker X Config projection', () => {
  it('keeps verified Stations and non-authoritative suggestions as distinct rows', () => {
    expect(source).toContain('data-station-peer-id');
    expect(source).toContain('data-x-config-seed-id');
    expect(source).toContain('common.stationPicker.suggestions');
    expect(source).toContain('common.stationPicker.suggestionStale');
    expect(source).toContain('disabled={disabled}');
  });

  it('delegates suggestion selection to native discovery instead of Station activation', () => {
    const handler = source.slice(
      source.indexOf('const handleSuggestion'),
      source.indexOf('const refreshSuggestions'),
    );
    expect(handler).toContain('discoverXConfigSuggestion(suggestion.seed_id)');
    expect(handler).not.toContain('api.stationSetActive(suggestion');
    expect(handler).not.toContain('setEntries((currentEntries)');
  });

  it('suppresses a suggestion only after the same origin exists as a verified route', () => {
    const entries = [{
      station_peer_id: 'station-a',
      pinned_host_public_key: [],
      routes: [{
        route_id: 'direct-a',
        route_type: 'direct',
        transport: 'direct_https',
        endpoint_origin: 'https://station.example',
        route_generation: 1,
        last_verified_at: '2026-10-18T00:00:00Z',
        health: 'available',
      }],
      active_route_id: 'direct-a',
      route_revision: 1,
      lifecycle_generation: 1,
      created_at: '2026-10-18T00:00:00Z',
      updated_at: '2026-10-18T00:00:00Z',
    }] satisfies StationEntry[];
    const suggestions = [
      suggestion('station-public', 'https://station.example'),
      suggestion('relay-public', 'https://relay.example'),
    ];

    expect(visibleXConfigSuggestions(entries, suggestions).map((item) => item.seed_id))
      .toEqual(['relay-public']);
  });
});

function suggestion(seedId: string, origin: string): XConfigSuggestion {
  return {
    seed_id: seedId,
    kind: 'direct_station',
    display_name: seedId,
    canonical_origin: origin,
    regions: ['global'],
    freshness: 'current',
    actionable: true,
    source_sequence: 1,
  };
}
