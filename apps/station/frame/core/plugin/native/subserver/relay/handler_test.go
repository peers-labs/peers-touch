package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/libp2p/go-libp2p"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestRelayHealthBindsRuntimePeerIdentity(t *testing.T) {
	node, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatalf("create Relay host: %v", err)
	}
	defer func() {
		if err := node.Close(); err != nil {
			t.Errorf("close Relay host: %v", err)
		}
	}()

	handler := newRelayHandler(&SubServer{
		opts:   &Options{Host: node},
		status: server.StatusRunning,
	})
	recorder := httptest.NewRecorder()
	handler.handleHealthz(
		recorder,
		httptest.NewRequest(http.MethodGet, "/healthz", nil),
	)

	if recorder.Code != http.StatusOK {
		t.Fatalf("health status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var payload map[string]string
	if err := json.NewDecoder(recorder.Body).Decode(&payload); err != nil {
		t.Fatalf("decode Relay health: %v", err)
	}
	if payload["role"] != "relay" ||
		payload["status"] != "ready" ||
		payload["peer_id"] != node.ID().String() {
		t.Fatalf("unexpected Relay health identity: %+v", payload)
	}
}

func TestRelayHealthRejectsMissingRuntimeIdentity(t *testing.T) {
	handler := newRelayHandler(&SubServer{
		opts:   &Options{},
		status: server.StatusRunning,
	})
	recorder := httptest.NewRecorder()
	handler.handleHealthz(
		recorder,
		httptest.NewRequest(http.MethodGet, "/healthz", nil),
	)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf(
			"health status = %d, want %d",
			recorder.Code,
			http.StatusServiceUnavailable,
		)
	}
}
