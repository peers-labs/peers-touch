import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  type LocalStationCandidate,
  type StationEntry,
  type StationRouteCandidate,
  type XConfigSuggestion,
} from "./desktop_api";
import {
  buildStationCandidateCatalog,
  ensureDevStationActive,
  pickActivationRoute,
} from "./stationCandidates";

vi.mock("./desktop_api", () => ({
  api: {
    stationList: vi.fn(),
    stationLocalCandidates: vi.fn(),
    stationAdd: vi.fn(),
    stationSetActive: vi.fn(),
  },
}));

vi.mock("./xConfig", () => ({
  getXConfigProjection: () => ({ suggestions: [] }),
}));

const mockedApi = vi.mocked(api);

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

function makeRoute(overrides: Partial<StationRouteCandidate>): StationRouteCandidate {
  return {
    route_id: "route-1",
    route_type: "direct",
    transport: "direct",
    endpoint_origin: "https://station.example",
    relay_peer_id: null,
    route_generation: 1,
    inner_tls_spki_sha256: null,
    attestation_bytes: null,
    attestation_expires_at_unix_ms: null,
    last_verified_at: "",
    last_success_at: null,
    health: "available",
    ...overrides,
  };
}

function entryWithRoutes(
  peerId: string,
  routes: StationRouteCandidate[],
): StationEntry {
  return {
    ...verifiedEntry(peerId, routes[0]?.endpoint_origin ?? "https://station.example"),
    routes,
    active_route_id: routes[0]?.route_id ?? "",
  };
}

describe("pickActivationRoute", () => {
  it("prefers a healthy direct route over relay", () => {
    const relay = makeRoute({ route_id: "relay-1", route_type: "relay" });
    const direct = makeRoute({ route_id: "direct-1", route_type: "direct" });
    const route = pickActivationRoute(entryWithRoutes("peer-1", [relay, direct]));
    expect(route?.route_id).toBe("direct-1");
  });

  it("falls back to relay when no direct route exists", () => {
    const relay = makeRoute({ route_id: "relay-1", route_type: "relay" });
    const route = pickActivationRoute(entryWithRoutes("peer-1", [relay]));
    expect(route?.route_type).toBe("relay");
  });

  it("skips unhealthy routes when a healthy one exists", () => {
    const brokenDirect = makeRoute({
      route_id: "direct-bad",
      route_type: "direct",
      health: "unavailable",
    });
    const healthyRelay = makeRoute({ route_id: "relay-ok", route_type: "relay" });
    const route = pickActivationRoute(
      entryWithRoutes("peer-1", [brokenDirect, healthyRelay]),
    );
    expect(route?.route_id).toBe("relay-ok");
  });

  it("returns null for an entry without routes", () => {
    const route = pickActivationRoute(entryWithRoutes("peer-1", []));
    expect(route).toBeNull();
  });
});

describe("ensureDevStationActive", () => {
  beforeEach(() => {
    // resetAllMocks also drains leftover mockResolvedValueOnce queues.
    vi.resetAllMocks();
  });

  it("short-circuits when a station is already active", async () => {
    mockedApi.stationList.mockResolvedValue({
      entries: [],
      active_station_peer_id: "peer-active",
      binding: { phase: "bound" } as never,
    });

    const outcome = await ensureDevStationActive();

    expect(outcome).toBe("already-active");
    expect(mockedApi.stationAdd).not.toHaveBeenCalled();
    expect(mockedApi.stationSetActive).not.toHaveBeenCalled();
  });

  it("skips when no environment-tier candidate exists", async () => {
    mockedApi.stationList.mockResolvedValue({
      entries: [],
      active_station_peer_id: null,
      binding: { phase: "unbound" } as never,
    });
    mockedApi.stationLocalCandidates.mockResolvedValue({ candidates: [] });

    const outcome = await ensureDevStationActive();

    expect(outcome).toBe("skipped");
    expect(mockedApi.stationSetActive).not.toHaveBeenCalled();
  });

  it("re-discovers to refresh attestation even when a verified entry already exists", async () => {
    const staleEntry = entryWithRoutes("peer-1", [
      makeRoute({
        route_id: "direct-1",
        endpoint_origin: "http://10.0.0.1:18080",
        attestation_expires_at_unix_ms: 1,
      }),
    ]);
    const freshEntry = entryWithRoutes("peer-1", [
      makeRoute({ route_id: "direct-1", endpoint_origin: "http://10.0.0.1:18080" }),
    ]);
    mockedApi.stationList.mockResolvedValue({
      entries: [staleEntry],
      active_station_peer_id: null,
      binding: { phase: "unbound" } as never,
    });
    mockedApi.stationLocalCandidates.mockResolvedValue({
      candidates: [
        { source: "environment", canonical_origin: "http://10.0.0.1:18080/" },
      ],
    });
    mockedApi.stationAdd.mockResolvedValue({
      role: "direct_station",
      endpoint_peer_id: "peer-1",
      canonical_origin: "http://10.0.0.1:18080",
      entries: [freshEntry],
    });
    mockedApi.stationSetActive.mockResolvedValue({
      active_station_peer_id: "peer-1",
      active_route_id: "direct-1",
      binding: { phase: "access_gate" } as never,
    });

    const outcome = await ensureDevStationActive();

    expect(outcome).toBe("activated");
    expect(mockedApi.stationAdd).toHaveBeenCalledWith("http://10.0.0.1:18080");
    expect(mockedApi.stationSetActive).toHaveBeenCalledWith("peer-1", "direct-1");
  });

  it("runs signed discovery then activates when the station is not in the registry", async () => {
    const entry = entryWithRoutes("peer-new", [
      makeRoute({ route_id: "direct-9", endpoint_origin: "http://10.0.0.1:18080" }),
    ]);
    mockedApi.stationList
      .mockResolvedValueOnce({
        entries: [],
        active_station_peer_id: null,
        binding: { phase: "unbound" } as never,
      })
      .mockResolvedValueOnce({
        entries: [entry],
        active_station_peer_id: "peer-new",
        binding: { phase: "access_gate" } as never,
      });
    mockedApi.stationLocalCandidates.mockResolvedValue({
      candidates: [
        { source: "environment", canonical_origin: "http://10.0.0.1:18080" },
      ],
    });
    mockedApi.stationAdd.mockResolvedValue({
      role: "direct_station",
      endpoint_peer_id: "peer-new",
      canonical_origin: "http://10.0.0.1:18080",
      entries: [entry],
    });
    mockedApi.stationSetActive.mockResolvedValue({
      active_station_peer_id: "peer-new",
      active_route_id: "direct-9",
      binding: { phase: "access_gate" } as never,
    });

    const outcome = await ensureDevStationActive();

    expect(outcome).toBe("activated");
    expect(mockedApi.stationAdd).toHaveBeenCalledWith("http://10.0.0.1:18080");
    expect(mockedApi.stationSetActive).toHaveBeenCalledWith("peer-new", "direct-9");
  });

  it("never auto-selects an injected-tier candidate", async () => {
    mockedApi.stationList.mockResolvedValue({
      entries: [],
      active_station_peer_id: null,
      binding: { phase: "unbound" } as never,
    });
    mockedApi.stationLocalCandidates.mockResolvedValue({
      candidates: [
        { source: "injected", canonical_origin: "http://injected.example" },
      ],
    });

    const outcome = await ensureDevStationActive();

    expect(outcome).toBe("skipped");
    expect(mockedApi.stationAdd).not.toHaveBeenCalled();
  });

  it("reports failed instead of throwing when discovery errors", async () => {
    mockedApi.stationList.mockRejectedValue(new Error("boom"));

    const outcome = await ensureDevStationActive();

    expect(outcome).toBe("failed");
  });
});
