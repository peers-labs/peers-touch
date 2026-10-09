package relayclient

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
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

func TestFederationHandleExposesConnectedRelayOrigin(t *testing.T) {
	sub := &SubServer{
		opts: &Options{RelayURL: "https://relay.example/"},
	}
	handle := federationHandle{sub: sub}
	if handle.Available() {
		t.Fatal("disconnected Relay handle reported available")
	}
	if handle.RelayOrigin() != "https://relay.example" {
		t.Fatalf("Relay origin = %q", handle.RelayOrigin())
	}

	sub.setCredential(&cachedMountCredential{
		Token:         "mount-token",
		RelayPeerID:   "relay-peer",
		StationPeerID: "station-peer",
		MountID:       1,
		Generation:    1,
	})
	sub.status = server.StatusRunning
	if !handle.Available() {
		t.Fatal("connected Relay handle reported unavailable")
	}
}

var _ federation.RelayClientHandle = federationHandle{}
