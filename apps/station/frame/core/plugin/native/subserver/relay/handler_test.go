package relay

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/libp2p/go-libp2p"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func TestNodeIdentitySubjectRoundTripPreservesNodePeerID(t *testing.T) {
	expected := domain.NodeIdentity{
		RelayPeerID:   "relay-peer",
		StationPeerID: "station-peer",
		NodePeerID:    "node-peer",
		EnrollmentID:  7,
		Generation:    3,
		JTI:           "credential-jti",
	}
	subject := nodeIdentitySubject(expected, domain.ScopeRoutePublish)

	actual, ok := nodeIdentityFromSubject(subject.ID, subject.Attributes)
	if !ok {
		t.Fatal("Relay node identity subject did not decode")
	}
	if !reflect.DeepEqual(actual, expected) {
		t.Fatalf("Relay node identity = %+v, want %+v", actual, expected)
	}
}

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

func TestRelayConsoleIsEmbeddedWithoutStationApplicationAuth(t *testing.T) {
	handler := newRelayHandler(&SubServer{opts: &Options{}})
	recorder := httptest.NewRecorder()
	handler.handleConsoleIndex(
		recorder,
		httptest.NewRequest(http.MethodGet, "/relay-console", nil),
	)
	if recorder.Code != http.StatusOK ||
		!strings.Contains(recorder.Body.String(), "Relay Console") {
		t.Fatalf(
			"Relay Console status=%d body=%s",
			recorder.Code,
			recorder.Body.String(),
		)
	}
	if !strings.Contains(
		recorder.Header().Get("Content-Security-Policy"),
		"default-src 'self'",
	) ||
		recorder.Header().Get("Referrer-Policy") != "no-referrer" {
		t.Fatalf("Relay Console security headers = %#v", recorder.Header())
	}
	for _, name := range []string{
		"relay-console",
		"relay-console-index",
		"relay-console-script",
		"relay-console-style",
	} {
		found := false
		for _, registered := range handler.handlers() {
			if registered.Name() == name {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("Relay Console handler %q is not registered", name)
		}
	}
}
