package relay

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/libp2p/go-libp2p"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func TestEnsureCredentialDoesNotMutateMemoryBeforePersistence(t *testing.T) {
	relayPeerID := testPeerID(t)
	credential := relayCredential{
		Token:         "relay-token",
		RelayPeerID:   relayPeerID.String(),
		StationPeerID: "station-a",
		EnrollmentID:  1,
		Generation:    1,
		ExpiresAt:     time.Now().UTC().Add(time.Hour).Format(time.RFC3339),
	}
	server := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			switch request.URL.Path {
			case "/api/v1/relay/enrollment/challenge":
				_ = json.NewEncoder(response).Encode(enrollmentChallenge{
					ChallengeID: "challenge",
					RelayPeerID: relayPeerID.String(),
					Challenge:   make([]byte, 32),
				})
			case "/api/v1/relay/register":
				_ = json.NewEncoder(response).Encode(credential)
			default:
				http.NotFound(response, request)
			}
		},
	))
	defer server.Close()

	target := Target{
		RelayPeerID:    relayPeerID,
		ControlOrigin:  server.URL,
		InviteToken:    "single-use-invite",
		CredentialFile: filepath.Join(t.TempDir(), "relay.json"),
	}
	persistenceError := errors.New("credential persistence failed")
	control := &StationControl{
		signer:      credentialPersistenceSigner{},
		credentials: make(map[string]relayCredential),
		clients: map[string]*http.Client{
			relayPeerID.String(): server.Client(),
		},
		persist: func(string, relayCredential) error {
			return persistenceError
		},
	}

	if _, err := control.ensureCredentialLocked(
		t.Context(),
		target,
	); !errors.Is(err, persistenceError) {
		t.Fatalf("credential persistence error = %v", err)
	}
	if _, ok := control.credentials[relayPeerID.String()]; ok {
		t.Fatal("failed persistence installed enrollment credential in memory")
	}
}

func TestEnsureCredentialKeepsPreviousCredentialWhenRotationCannotPersist(
	t *testing.T,
) {
	relayPeerID := testPeerID(t)
	current := relayCredential{
		Token:         "current-token",
		RelayPeerID:   relayPeerID.String(),
		StationPeerID: "station-a",
		EnrollmentID:  1,
		Generation:    1,
		ExpiresAt:     time.Now().UTC().Add(time.Minute).Format(time.RFC3339),
	}
	rotated := current
	rotated.Token = "rotated-token"
	rotated.ExpiresAt = time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	server := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			switch request.URL.Path {
			case "/api/v1/relay/rotation/challenge":
				_ = json.NewEncoder(response).Encode(enrollmentChallenge{
					ChallengeID: "rotation-challenge",
					RelayPeerID: relayPeerID.String(),
					Challenge:   make([]byte, 32),
				})
			case "/api/v1/relay/token/refresh":
				_ = json.NewEncoder(response).Encode(rotated)
			default:
				http.NotFound(response, request)
			}
		},
	))
	defer server.Close()

	target := Target{
		RelayPeerID:    relayPeerID,
		ControlOrigin:  server.URL,
		CredentialFile: filepath.Join(t.TempDir(), "relay.json"),
	}
	persistenceError := errors.New("rotated credential persistence failed")
	control := &StationControl{
		signer: credentialPersistenceSigner{},
		credentials: map[string]relayCredential{
			relayPeerID.String(): current,
		},
		clients: map[string]*http.Client{
			relayPeerID.String(): server.Client(),
		},
		persist: func(string, relayCredential) error {
			return persistenceError
		},
	}

	if _, err := control.ensureCredentialLocked(
		t.Context(),
		target,
	); !errors.Is(err, persistenceError) {
		t.Fatalf("rotated credential persistence error = %v", err)
	}
	retained := control.credentials[relayPeerID.String()]
	if retained.Token != current.Token {
		t.Fatalf(
			"failed rotation replaced in-memory credential with %q",
			retained.Token,
		)
	}
}

func TestStationControlDoesNotSerializeIndependentRelayRequests(t *testing.T) {
	relayA := testPeerID(t)
	relayB := testPeerID(t)
	started := make(chan struct{})
	release := make(chan struct{})
	serverA := httptest.NewServer(http.HandlerFunc(
		func(response http.ResponseWriter, request *http.Request) {
			response.Header().Set("Content-Type", "application/json")
			switch request.URL.Path {
			case "/api/v1/relay/enrollment/challenge":
				close(started)
				select {
				case <-release:
				case <-request.Context().Done():
					return
				}
				_ = json.NewEncoder(response).Encode(enrollmentChallenge{
					ChallengeID: "challenge-a",
					RelayPeerID: relayA.String(),
					Challenge:   make([]byte, 32),
				})
			case "/api/v1/relay/register":
				_ = json.NewEncoder(response).Encode(relayCredential{
					Token:         "token-a",
					RelayPeerID:   relayA.String(),
					StationPeerID: "station-a",
					EnrollmentID:  1,
					Generation:    1,
					ExpiresAt: time.Now().UTC().
						Add(time.Hour).
						Format(time.RFC3339),
				})
			default:
				http.NotFound(response, request)
			}
		},
	))
	defer serverA.Close()

	node, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatalf("create Station Host: %v", err)
	}
	defer node.Close()
	control, err := NewStationControl(
		Pool{Mode: PoolModeOff},
		node,
		credentialPersistenceSigner{},
		[32]byte{1},
		func(time.Time) []CircuitRoute { return nil },
	)
	if err != nil {
		t.Fatalf("create Station control: %v", err)
	}
	targetA := Target{
		RelayPeerID:    relayA,
		Addresses:      []string{"/ip4/127.0.0.1/tcp/1"},
		ControlOrigin:  serverA.URL,
		InviteToken:    "invite-a",
		CredentialFile: filepath.Join(t.TempDir(), "relay-a.json"),
	}
	targetB := Target{
		RelayPeerID:    relayB,
		Addresses:      []string{"/ip4/127.0.0.1/tcp/2"},
		ControlOrigin:  "http://127.0.0.1:2",
		CredentialFile: filepath.Join(t.TempDir(), "relay-b.json"),
	}
	if err := control.AddTarget(targetA); err != nil {
		t.Fatalf("add Relay A: %v", err)
	}
	if err := control.AddTarget(targetB); err != nil {
		t.Fatalf("add Relay B: %v", err)
	}
	control.credentialMu.Lock()
	control.credentials[relayB.String()] = relayCredential{
		Token:         "token-b",
		RelayPeerID:   relayB.String(),
		StationPeerID: "station-b",
		EnrollmentID:  2,
		Generation:    7,
		ExpiresAt: time.Now().UTC().
			Add(time.Hour).
			Format(time.RFC3339),
	}
	control.credentialMu.Unlock()

	relayAResult := make(chan error, 1)
	go func() {
		_, err := control.Authorize(t.Context(), targetA)
		relayAResult <- err
	}()
	<-started

	relayBResult := make(chan error, 1)
	go func() {
		generation, err := control.Authorize(t.Context(), targetB)
		if err == nil && generation != 7 {
			err = errors.New("Relay B returned the wrong generation")
		}
		relayBResult <- err
	}()
	select {
	case err := <-relayBResult:
		if err != nil {
			t.Fatalf("authorize Relay B: %v", err)
		}
	case <-time.After(500 * time.Millisecond):
		t.Fatal("Relay A control request blocked independent Relay B")
	}
	close(release)
	if err := <-relayAResult; err != nil {
		t.Fatalf("authorize Relay A: %v", err)
	}
}

type credentialPersistenceSigner struct{}

func (credentialPersistenceSigner) SignStationIdentityResponse(
	[]byte,
) (*peerpb.StationIdentityResponse, error) {
	return &peerpb.StationIdentityResponse{}, nil
}

func (credentialPersistenceSigner) SignStationRouteAttestation(
	*peerpb.StationRouteStatement,
) (*peerpb.StationRouteAttestation, error) {
	return &peerpb.StationRouteAttestation{}, nil
}

func (credentialPersistenceSigner) SignStationConnectionGrant(
	*peerpb.StationConnectionGrantStatement,
) (*peerpb.StationConnectionGrant, error) {
	return &peerpb.StationConnectionGrant{}, nil
}
