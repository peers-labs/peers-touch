package relay

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"sort"
	"testing"
	"time"

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
