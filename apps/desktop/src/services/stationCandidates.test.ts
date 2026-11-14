import { describe, expect, it } from "vitest";
import type {
  LocalStationCandidate,
  StationEntry,
  XConfigSuggestion,
} from "./desktop_api";
import { buildStationCandidateCatalog } from "./stationCandidates";

function verifiedEntry(peerId: string, origin: string): StationEntry {
  return {
    station_peer_id: peerId,
    display_name: peerId,
    pinned_host_public_key: [],
    routes: [
      {
        route_id: "route-1",
        route_type: "direct",
        transport: "direct",
        endpoint_origin: origin,
        relay_peer_id: null,
        route_generation: 1,
        inner_tls_spki_sha256: null,
        attestation_bytes: null,
        attestation_expires_at_unix_ms: null,
        last_verified_at: "",
        last_success_at: null,
        health: "available",
      },
    ],
    active_route_id: "route-1",
    route_revision: 1,
    lifecycle_generation: 1,
    created_at: "",
    updated_at: "",
  };
}

function localCandidate(
  source: LocalStationCandidate["source"],
  canonical_origin: string,
): LocalStationCandidate {
  return { source, canonical_origin };
}

function xconfigSuggestion(
  seedId: string,
  origin: string,
  kind: XConfigSuggestion["kind"] = "direct_station",
  actionable = true,
): XConfigSuggestion {
  return {
    seed_id: seedId,
    kind,
    display_name: seedId,
    canonical_origin: origin,
    regions: [],
    freshness: "current",
    actionable,
    source_sequence: 1,
  };
}

describe("buildStationCandidateCatalog", () => {
  it("orders suggestions environment > injected > xconfig", () => {
    const catalog = buildStationCandidateCatalog({
      verifiedEntries: [],
      activeStationPeerId: null,
      localCandidates: [
        localCandidate("injected", "https://injected.example"),
        localCandidate("environment", "https://profile.example"),
      ],
      xconfigSuggestions: [xconfigSuggestion("cloud-1", "https://cloud.example")],
    });

    expect(catalog.suggestions.map((candidate) => candidate.source)).toEqual([
      "environment",
      "injected",
      "xconfig",
    ]);
  });

  it("dedups colliding origins and keeps the highest-priority source label", () => {
    const catalog = buildStationCandidateCatalog({
      verifiedEntries: [],
      activeStationPeerId: null,
      localCandidates: [
        localCandidate("environment", "https://same.example/"),
        localCandidate("injected", "https://same.example"),
      ],
      xconfigSuggestions: [xconfigSuggestion("cloud-1", "https://same.example/")],
    });

    expect(catalog.suggestions).toHaveLength(1);
    expect(catalog.suggestions[0]?.source).toBe("environment");
  });

  it("suppresses suggestions whose origin is already verified", () => {
    const catalog = buildStationCandidateCatalog({
      verifiedEntries: [verifiedEntry("peer-1", "https://profile.example")],
      activeStationPeerId: "peer-1",
      localCandidates: [localCandidate("environment", "https://profile.example")],
      xconfigSuggestions: [],
    });

    expect(catalog.verified).toHaveLength(1);
    expect(catalog.suggestions).toHaveLength(0);
    expect(catalog.activeStationPeerId).toBe("peer-1");
  });

  it("ignores relay suggestions and preserves cloud actionable flag", () => {
    const catalog = buildStationCandidateCatalog({
      verifiedEntries: [],
      activeStationPeerId: null,
      localCandidates: [],
      xconfigSuggestions: [
        xconfigSuggestion("relay-1", "https://relay.example", "relay"),
        xconfigSuggestion("station-stale", "https://stale.example", "direct_station", false),
      ],
    });

    expect(catalog.suggestions.map((candidate) => candidate.id)).toEqual([
      "station-stale",
    ]);
    expect(catalog.suggestions[0]?.actionable).toBe(false);
    expect(catalog.suggestions[0]?.seedId).toBe("station-stale");
  });
});
