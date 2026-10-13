package relay

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

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
