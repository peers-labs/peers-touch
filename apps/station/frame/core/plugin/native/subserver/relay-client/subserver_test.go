package relayclient

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/protocol"
)

func TestStartDoesNotRequireConnectionMaterialSigner(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	sub := &SubServer{
		opts: &Options{
			Enabled:                      true,
			RelayURL:                     "https://relay.example",
			RelayStreamAddr:              "127.0.0.1:4501",
			BootstrapInfoURL:             "http://127.0.0.1:1/sub-bootstrap/info",
			BootstrapIdentityURL:         "http://127.0.0.1:1/sub-bootstrap/station-identity",
			TokenStorePath:               filepath.Join(t.TempDir(), "credential.json"),
			UseTLS:                       true,
			TLSInsecureSkipVerify:        true,
			HeartbeatIntervalSec:         1,
			CredentialRefreshIntervalSec: 300,
		},
	}
	if err := sub.Start(ctx); err != nil {
		t.Fatalf("start enrollment-only Relay client: %v", err)
	}
	cancel()
	if err := sub.Stop(context.Background()); err != nil {
		t.Fatalf("stop Relay client: %v", err)
	}
}

func TestStopClearsMountCredential(t *testing.T) {
	sub := &SubServer{}
	sub.setCredential(&cachedMountCredential{
		Token:         "mount-token",
		RelayPeerID:   "relay-peer",
		StationPeerID: "station-peer",
		MountID:       1,
		Generation:    1,
	})
	if sub.getToken() == "" {
		t.Fatal("test mount credential was not installed")
	}
	if err := sub.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if sub.getToken() != "" {
		t.Fatal("Relay mount credential remained in memory after Stop")
	}
}

func TestMakeDispatcherMapsForwardAuthorizationToLocalAuthorization(t *testing.T) {
	var sawAuthorization string
	var sawForwardAuthorization string
	local := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sawAuthorization = r.Header.Get("Authorization")
		sawForwardAuthorization = r.Header.Get(federation.ForwardAuthorizationHeader)
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer local.Close()

	_, portValue, err := net.SplitHostPort(local.Listener.Addr().String())
	if err != nil {
		t.Fatalf("split local server addr: %v", err)
	}
	port, err := strconv.Atoi(portValue)
	if err != nil {
		t.Fatalf("parse local server port: %v", err)
	}
	sub := &SubServer{
		opts: &Options{
			LocalHTTPPort:       port,
			LocalHTTPTimeoutSec: 5,
		},
	}
	status, _, body, err := sub.makeDispatcher()(context.Background(), &protocol.RequestFrame{
		Method: http.MethodPost,
		Path:   "/group-chat/proposal/accept",
		Headers: map[string]string{
			"Authorization":                       "Bearer relay-token",
			federation.ForwardAuthorizationHeader: "Bearer peer-jwt",
		},
		Body: []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("dispatch request: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("unexpected status=%d body=%s", status, string(body))
	}
	if sawAuthorization != "Bearer peer-jwt" {
		t.Fatalf("expected local Authorization to be peer jwt, got %q", sawAuthorization)
	}
	if sawForwardAuthorization != "" {
		t.Fatalf("expected forward auth header to be stripped before local dispatch, got %q", sawForwardAuthorization)
	}
}
