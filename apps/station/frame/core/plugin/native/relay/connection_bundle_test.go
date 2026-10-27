package relay

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p/core/peer"
)

func TestConnectionBundleIsolatesControlFailuresAndPreservesCancellation(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()
	ids := []peer.ID{testPeerID(t), testPeerID(t)}
	routes := make([]CircuitRoute, 0, len(ids))
	control := &StationControl{
		signer: credentialPersistenceSigner{},
		targets: make(map[peer.ID]Target),
		credentials: make(map[string]relayCredential),
		clients: make(map[string]*http.Client),
	}
	for _, id := range ids {
		routes = append(routes, CircuitRoute{RelayPeerID: id, ExpiresAt: time.Now().Add(time.Hour)})
		control.targets[id] = Target{RelayPeerID: id, ControlOrigin: server.URL}
		control.clients[id.String()] = server.Client()
		control.credentials[id.String()] = relayCredential{
			Token: "test-token", RelayPeerID: id.String(), StationPeerID: "station-test",
			Generation: 1, EnrollmentID: 1, ExpiresAt: time.Now().Add(time.Hour).Format(time.RFC3339),
		}
	}
	control.liveRoutes = func(time.Time) []CircuitRoute { return routes }
	request := ConnectionMaterialRequest{RouteLifetime: time.Minute, GrantLifetime: time.Minute}
	if material, err := control.IssueConnectionBundle(t.Context(), request, 4);
		!errors.Is(err, ErrConnectionMaterialUnavailable) || len(material) != 0 {
		t.Fatalf("optional failure should allow caller's Direct fallback: %v", err)
	}
	if calls.Load() != 2 {
		t.Fatalf("failed Relay must not prevent later target: calls=%d", calls.Load())
	}
	invalid := request
	invalid.GrantLifetime = 2 * time.Minute
	if _, err := control.IssueConnectionBundle(t.Context(), invalid, 4);
		!errors.Is(err, ErrInvalidConnectionMaterialRequest) {
		t.Fatalf("invalid caller input must not be hidden as availability: %v", err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := control.IssueConnectionBundle(ctx, request, 4); !errors.Is(err, context.Canceled) {
		t.Fatalf("overall cancellation must stop dispatch: %v", err)
	}
}
