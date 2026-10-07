package relayclient

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestRelayTunnelURLRequiresProtectedOrLoopbackTransport(t *testing.T) {
	tests := []struct {
		name    string
		origin  string
		want    string
		wantErr bool
	}{
		{
			name:   "tls",
			origin: "https://relay.example/base",
			want:   "wss://relay.example/.well-known/peers-touch/tunnel",
		},
		{
			name:   "loopback development",
			origin: "http://127.0.0.1:8080",
			want:   "ws://127.0.0.1:8080/.well-known/peers-touch/tunnel",
		},
		{
			name:    "remote plaintext",
			origin:  "http://relay.example",
			wantErr: true,
		},
		{
			name:    "query",
			origin:  "https://relay.example?credential=secret",
			wantErr: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := relayTunnelURL(test.origin)
			if test.wantErr {
				if err == nil {
					t.Fatalf("relayTunnelURL(%q) unexpectedly succeeded", test.origin)
				}
				return
			}
			if err != nil {
				t.Fatalf("relayTunnelURL(%q): %v", test.origin, err)
			}
			if got != test.want {
				t.Fatalf("relayTunnelURL(%q) = %q, want %q", test.origin, got, test.want)
			}
		})
	}
}

func TestVerifyPinnedSPKIRequiresTLS13AndExactStationKey(t *testing.T) {
	ingress, err := newInnerTLSIngress(0, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	state := tls.ConnectionState{
		Version:          tls.VersionTLS13,
		PeerCertificates: []*x509.Certificate{ingress.certificate.Leaf},
	}
	if err := verifyPinnedSPKI(state, ingress.SPKISHA256()); err != nil {
		t.Fatalf("verify exact Station SPKI: %v", err)
	}
	if err := verifyPinnedSPKI(
		state,
		bytes.Repeat([]byte{0xff}, sha256.Size),
	); err == nil {
		t.Fatal("mismatched Station SPKI was accepted")
	}
	state.Version = tls.VersionTLS12
	if err := verifyPinnedSPKI(state, ingress.SPKISHA256()); err == nil {
		t.Fatal("TLS downgrade was accepted")
	}
}

func TestPeerTunnelRejectsRedirect(t *testing.T) {
	var destinationCalls atomic.Int32
	destination := httptest.NewServer(http.HandlerFunc(func(
		http.ResponseWriter,
		*http.Request,
	) {
		destinationCalls.Add(1)
	}))
	defer destination.Close()

	relay := httptest.NewServer(http.HandlerFunc(func(
		response http.ResponseWriter,
		request *http.Request,
	) {
		http.Redirect(response, request, destination.URL, http.StatusFound)
	}))
	defer relay.Close()

	subserver := &SubServer{
		opts: &Options{RelayURL: relay.URL},
	}
	subserver.setCredential(&cachedMountCredential{
		Token:         "mount-token",
		RelayPeerID:   "relay-peer",
		StationPeerID: "station-source",
		MountID:       1,
		Generation:    1,
	})
	request, err := http.NewRequest(
		http.MethodGet,
		"https://station.invalid/healthz",
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := subserver.roundTripPeer(
		context.Background(),
		"station-target",
		request,
	); err == nil {
		t.Fatal("Relay WebSocket redirect was accepted")
	}
	if destinationCalls.Load() != 0 {
		t.Fatal("Relay WebSocket client followed a redirect")
	}
}
