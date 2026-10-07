package relayclient

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
)

func TestCachedMountCredentialRejectsLegacyAndExpiredValues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "relay-credential")
	if err := os.WriteFile(path, []byte("legacy-raw-token"), 0o600); err != nil {
		t.Fatalf("write legacy token: %v", err)
	}
	if _, err := loadCachedMountCredential(path, "station-a"); err == nil {
		t.Fatal("legacy raw token was accepted")
	}

	expired := cachedMountCredential{
		Token:         "token",
		RelayPeerID:   "relay",
		StationPeerID: "station-a",
		MountID:       1,
		Generation:    1,
		ExpiresAt:     time.Now().Add(-time.Minute).UTC().Format(time.RFC3339),
	}
	payload, err := json.Marshal(expired)
	if err != nil {
		t.Fatalf("marshal cache: %v", err)
	}
	if err := os.WriteFile(path, payload, 0o600); err != nil {
		t.Fatalf("write expired cache: %v", err)
	}
	if _, err := loadCachedMountCredential(path, "station-a"); err == nil {
		t.Fatal("expired Relay credential was accepted")
	}

	subserver := &SubServer{
		opts: &Options{
			TokenStorePath: path,
		},
	}
	if _, err := subserver.acquireRelayCredential(
		context.Background(),
		"station-a",
	); !errors.Is(err, ErrEnrollmentRequired) {
		t.Fatalf("expired cache error = %v, want enrollment required", err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("expired cache was not removed: %v", err)
	}
}

func TestSignRelayChallengeUsesStationHostKey(t *testing.T) {
	privateKey, publicKey, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatalf("generate Station key: %v", err)
	}
	stationPeerID, err := peer.IDFromPublicKey(publicKey)
	if err != nil {
		t.Fatalf("derive Station peer ID: %v", err)
	}
	server := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			rawRequest := &peerpb.StationIdentityRequest{}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Errorf("read identity request: %v", err)
				response.WriteHeader(http.StatusBadRequest)
				return
			}
			if err := proto.Unmarshal(body, rawRequest); err != nil {
				t.Errorf("decode identity request: %v", err)
				response.WriteHeader(http.StatusBadRequest)
				return
			}
			now := time.Now().UTC()
			statement := &peerpb.StationIdentityStatement{
				Challenge:       rawRequest.GetChallenge(),
				StationPeerId:   stationPeerID.String(),
				CanonicalOrigin: "https://station.example:443",
				Capabilities:    []string{"station-identity"},
				IssuedAtUnixMs:  now.UnixMilli(),
				ExpiresAtUnixMs: now.Add(time.Minute).UnixMilli(),
			}
			statementBytes, _ := proto.MarshalOptions{Deterministic: true}.
				Marshal(statement)
			signature, _ := privateKey.Sign(
				append([]byte(domain.StationIdentityDomain), statementBytes...),
			)
			hostPublicKey, _ := libp2pcrypto.MarshalPublicKey(publicKey)
			output, _ := proto.Marshal(&peerpb.StationIdentityResponse{
				StatementBytes: statementBytes,
				HostPublicKey:  hostPublicKey,
				Signature:      signature,
			})
			response.Header().Set("Content-Type", "application/x-protobuf")
			_, _ = response.Write(output)
		},
	))
	defer server.Close()

	subserver := &SubServer{opts: &Options{BootstrapIdentityURL: server.URL}}
	challenge := &enrollmentChallengeResponse{
		ChallengeID: "challenge",
		RelayPeerID: "relay",
		Challenge:   make([]byte, domain.EnrollmentChallengeByteSize),
	}
	proof, err := subserver.signRelayChallenge(
		context.Background(),
		challenge,
	)
	if err != nil {
		t.Fatalf("sign Relay challenge: %v", err)
	}
	verifiedPeerID, _, err := application.VerifyStationIdentityProof(
		proof,
		challenge.Challenge,
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatalf("verify Station proof: %v", err)
	}
	if verifiedPeerID != stationPeerID.String() {
		t.Fatalf("verified peer ID = %q, want %q", verifiedPeerID, stationPeerID)
	}
}

func TestRelayClientReadinessTracksVerifiedMount(t *testing.T) {
	subserver := &SubServer{
		opts:   &Options{},
		status: server.StatusStarting,
	}
	if subserver.Status() == server.StatusRunning {
		t.Fatal("relay-client was ready before a verified mount")
	}
	subserver.setMountReady(true)
	if subserver.Status() != server.StatusRunning {
		t.Fatalf("status = %s, want running", subserver.Status())
	}
	subserver.setMountReady(false)
	if subserver.Status() != server.StatusStarting {
		t.Fatalf("status = %s, want starting", subserver.Status())
	}
	subserver.status = server.StatusError
	subserver.setEnrollmentRequired()
	if subserver.Status() != server.StatusStarting {
		t.Fatalf(
			"re-enrollment status = %s, want starting",
			subserver.Status(),
		)
	}
	if subserver.enrollmentState != "enrollment_required" {
		t.Fatalf(
			"enrollment state = %q, want enrollment_required",
			subserver.enrollmentState,
		)
	}
}

func TestRelayClientRequiresProtectedTransport(t *testing.T) {
	valid := &Options{
		RelayURL:             "https://relay.example",
		UseTLS:               true,
		BootstrapIdentityURL: "http://127.0.0.1:18080/sub-bootstrap/station-identity",
	}
	if err := validateRelayClientOptions(valid); err != nil {
		t.Fatalf("validate protected Relay client: %v", err)
	}

	plaintextRemote := *valid
	plaintextRemote.RelayURL = "http://10.36.3.187:18081"
	if err := validateRelayClientOptions(&plaintextRemote); err == nil {
		t.Fatal("remote plaintext Relay control URL was accepted")
	}

	plaintextLoopback := *valid
	plaintextLoopback.RelayURL = "http://127.0.0.1:18081"
	if err := validateRelayClientOptions(&plaintextLoopback); err != nil {
		t.Fatalf("loopback Relay control URL was rejected: %v", err)
	}

	noStreamTLS := *valid
	noStreamTLS.UseTLS = false
	if err := validateRelayClientOptions(&noStreamTLS); err == nil {
		t.Fatal("Relay client started without stream TLS")
	}

	remoteIdentitySigner := *valid
	remoteIdentitySigner.BootstrapIdentityURL =
		"http://station.example/sub-bootstrap/station-identity"
	if err := validateRelayClientOptions(&remoteIdentitySigner); err == nil {
		t.Fatal("remote Station identity signer was accepted")
	}
}
