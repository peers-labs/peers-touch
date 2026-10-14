package relay

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"net/http"
	"sort"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
)

func TestRelayRequestAttemptReplaysSafeRequestBody(t *testing.T) {
	request, err := http.NewRequest(
		http.MethodGet,
		"https://station.example/api",
		bytes.NewBufferString("payload"),
	)
	if err != nil {
		t.Fatal(err)
	}
	bodySent := false
	first, err := relayRequestAttempt(t.Context(), request, &bodySent)
	if err != nil {
		t.Fatal(err)
	}
	if body, err := io.ReadAll(first.Body); err != nil ||
		string(body) != "payload" {
		t.Fatalf("first body = %q, err=%v", body, err)
	}
	second, err := relayRequestAttempt(t.Context(), request, &bodySent)
	if err != nil {
		t.Fatal(err)
	}
	if body, err := io.ReadAll(second.Body); err != nil ||
		string(body) != "payload" {
		t.Fatalf("replayed body = %q, err=%v", body, err)
	}
}

func TestRelayRequestAutomaticRetryRejectsMutations(t *testing.T) {
	if !relayRequestAllowsAutomaticRetry(http.MethodGet) {
		t.Fatal("GET was not eligible for automatic route failover")
	}
	for _, method := range []string{
		http.MethodPost,
		http.MethodPut,
		http.MethodPatch,
		http.MethodDelete,
	} {
		if relayRequestAllowsAutomaticRetry(method) {
			t.Fatalf("%s was eligible for automatic route failover", method)
		}
	}
}

func TestRelayRequestAttemptRejectsConsumedNonReplayableBody(t *testing.T) {
	request, err := http.NewRequestWithContext(
		context.Background(),
		http.MethodPost,
		"https://station.example/api",
		io.NopCloser(bytes.NewBufferString("payload")),
	)
	if err != nil {
		t.Fatal(err)
	}
	bodySent := false
	if _, err := relayRequestAttempt(t.Context(), request, &bodySent); err != nil {
		t.Fatal(err)
	}
	if _, err := relayRequestAttempt(
		t.Context(),
		request,
		&bodySent,
	); err == nil {
		t.Fatal("consumed non-replayable body was retried")
	}
}

func TestStationRouteClientsAreReusedBoundedAndClosed(t *testing.T) {
	valueHost, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatalf("create Station route client Host: %v", err)
	}
	defer valueHost.Close()
	relayPeerID := dialTestPeerID(t)
	control := &StationControl{
		host:         valueHost,
		routeClients: make(map[stationRouteClientKey]*stationRouteClient),
	}
	firstRoute := verifiedCircuitRoute{
		relayPeerID: relayPeerID,
		nodePeerID:  dialTestPeerID(t),
		routeID:     "route-0",
		generation:  1,
		innerSPKI:   [sha256.Size]byte{1},
		address:     "/ip4/127.0.0.1/tcp/4001",
	}
	_, first, err := control.routeClientLocked(firstRoute)
	if err != nil {
		t.Fatalf("create Station route client: %v", err)
	}
	_, reused, err := control.routeClientLocked(firstRoute)
	if err != nil {
		t.Fatalf("reuse Station route client: %v", err)
	}
	if reused != first || len(control.routeClients) != 1 {
		t.Fatal("identical verified route did not reuse its HTTP/2 client")
	}

	for index := 1; index <= maxStationRouteClients; index++ {
		route := verifiedCircuitRoute{
			relayPeerID: relayPeerID,
			nodePeerID:  dialTestPeerID(t),
			routeID:     fmt.Sprintf("route-%d", index),
			generation:  1,
			innerSPKI:   [sha256.Size]byte{byte(index + 1)},
			address:     fmt.Sprintf("/ip4/127.0.0.1/tcp/%d", 4001+index),
		}
		if _, _, err := control.routeClientLocked(route); err != nil {
			t.Fatalf("create bounded Station route client %d: %v", index, err)
		}
	}
	if len(control.routeClients) != maxStationRouteClients {
		t.Fatalf(
			"Station route client count = %d, want %d",
			len(control.routeClients),
			maxStationRouteClients,
		)
	}
	if !first.retired {
		t.Fatal("least-recently-used Station route client was not retired")
	}
	control.close()
	if len(control.routeClients) != 0 {
		t.Fatal("Station route clients survived control shutdown")
	}
}

func TestStationRouteResponseBodyReleasesSessionOnce(t *testing.T) {
	releases := 0
	body := &stationRouteResponseBody{
		inner: io.NopCloser(bytes.NewReader(nil)),
		release: func() {
			releases++
		},
	}
	buffer := make([]byte, 1)
	if _, err := body.Read(buffer); err != io.EOF {
		t.Fatalf("empty response read error = %v, want EOF", err)
	}
	if err := body.Close(); err != nil {
		t.Fatalf("close response body: %v", err)
	}
	if releases != 1 {
		t.Fatalf("response session releases = %d, want 1", releases)
	}
}

func TestSelectLiveRouteSupportsMultipleRelayTargets(t *testing.T) {
	first := dialTestPeerID(t)
	second := dialTestPeerID(t)
	ids := []peer.ID{first, second}
	sort.Slice(ids, func(left, right int) bool {
		return ids[left].String() < ids[right].String()
	})
	now := time.Now().UTC()
	control := &StationControl{
		pool: Pool{Targets: []Target{
			{RelayPeerID: second},
			{RelayPeerID: first},
		}},
		liveRoutes: func(time.Time) []CircuitRoute {
			return []CircuitRoute{
				{RelayPeerID: second, ExpiresAt: now.Add(time.Hour)},
				{RelayPeerID: first, ExpiresAt: now.Add(time.Hour)},
			}
		},
	}

	target, route, err := control.selectLiveRouteLocked(now)
	if err != nil {
		t.Fatal(err)
	}
	if target.RelayPeerID != ids[0] || route.RelayPeerID != ids[0] {
		t.Fatalf(
			"selected target=%s route=%s, want %s",
			target.RelayPeerID,
			route.RelayPeerID,
			ids[0],
		)
	}
}

func dialTestPeerID(t *testing.T) peer.ID {
	t.Helper()
	publicKey, _, err := libp2pcrypto.GenerateEd25519Key(nil)
	if err != nil {
		t.Fatal(err)
	}
	peerID, err := peer.IDFromPrivateKey(publicKey)
	if err != nil {
		t.Fatal(err)
	}
	return peerID
}
