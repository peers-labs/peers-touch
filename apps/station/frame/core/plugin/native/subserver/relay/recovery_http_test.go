package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/libp2p/go-libp2p"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/peer"
	standardrelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestExpiredEnrollmentRecoversThroughRegisteredHTTPAndPersistedClient(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "relay.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	repo := infrastructure.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	relayKey, _, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signingBytes, err := relayKey.Raw()
	if err != nil {
		t.Fatal(err)
	}
	authority, err := application.NewCredentialAuthority(signingBytes)
	if err != nil {
		t.Fatal(err)
	}
	admission := standardrelay.NewAdmission()
	service := application.NewService(repo, authority, admission)
	sub := &SubServer{svc: service, opts: &Options{Admission: admission, MaxStations: 10}}
	sub.nodeRotateJWTWrapper = nodeAuthenticationWrapper(service, domain.ScopeNodeRotate)
	handler := newRelayHandler(sub)
	routes := handler.handlers()
	controlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		for _, route := range routes {
			if route.Path() != r.URL.Path || string(route.Method()) != r.Method {
				continue
			}
			endpoint := route.Handler()
			wrappers := route.Wrappers()
			for index := len(wrappers) - 1; index >= 0; index-- {
				endpoint = wrappers[index](endpoint)
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read request", 400)
				return
			}
			response := &recoveryHTTPResponse{writer: w}
			if err := endpoint(r.Context(), &recoveryHTTPRequest{request: r, body: body}, response); err != nil {
				http.Error(w, "handler failed", 500)
			}
			return
		}
		http.NotFound(w, r)
	}))
	defer controlServer.Close()

	root, _, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	node, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	signer := recoveryTestSigner{root: root, node: node.Peerstore().PrivKey(node.ID())}
	_, secret, err := service.CreateInvite(t.Context(), "", "recovery", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := service.BeginEnrollmentChallenge(t.Context(), secret, "recovery")
	if err != nil {
		t.Fatal(err)
	}
	registered, err := service.Register(t.Context(), secret, signer.proof(t, challenge), 10)
	if err != nil {
		t.Fatal(err)
	}
	credential := registered.Credential
	claims := jwt.MapClaims{}
	if _, _, err := jwt.NewParser(jwt.WithJSONNumber()).ParseUnverified(credential.Token, claims); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	claims["iat"], claims["nbf"], claims["exp"] = now.Add(-time.Hour).Unix(), now.Add(-time.Hour).Unix(), now.Add(-45*time.Minute).Unix()
	expired, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(ed25519.PrivateKey(signingBytes))
	if err != nil {
		t.Fatal(err)
	}
	// Simulate downtime after the previously persisted delegation expired.
	if err := db.Table("relay_enrollment").Where("id = ?", credential.EnrollmentID).
		Update("node_authorization_until", now.Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.AuthenticateNodeCredential(t.Context(), expired, domain.ScopeRoutePublish); err == nil {
		t.Fatal("expired credential authorized ordinary transport")
	}
	if _, err := authority.ValidateRotationLocator(expired); err != nil {
		t.Fatalf("expired locator signature/claims rejected: %v", err)
	}
	if _, err := service.AuthenticateRotationLocator(t.Context(), expired); err != nil {
		t.Fatalf("current expired enrollment locator rejected: %v", err)
	}
	if _, err := service.BeginEnrollmentChallenge(t.Context(), secret, "recovery"); err == nil {
		t.Fatal("recovery reopened the consumed invitation")
	}
	relayID, err := peer.Decode(authority.RelayPeerID())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "credential.json")
	raw, err := json.Marshal(map[string]interface{}{
		"relay_token": expired, "relay_peer_id": credential.RelayPeerID,
		"station_peer_id": credential.StationPeerID, "enrollment_id": credential.EnrollmentID,
		"generation": credential.Generation, "expires_at": now.Add(-45 * time.Minute).Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	target := standardrelay.Target{
		RelayPeerID: relayID, ControlOrigin: controlServer.URL, CredentialFile: path,
		Addresses: []string{"/ip4/127.0.0.1/tcp/1/p2p/" + relayID.String()},
	}
	control, err := standardrelay.NewStationControl(standardrelay.Pool{Targets: []standardrelay.Target{target}},
		node, signer, [32]byte{1}, func(time.Time) []standardrelay.CircuitRoute { return nil })
	if err != nil {
		t.Fatal(err)
	}
	generation, err := control.Authorize(t.Context(), target)
	if err != nil || generation != credential.Generation {
		t.Fatalf("persisted expired credential recovery: generation=%d err=%v", generation, err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var renewed struct {
		Token string `json:"relay_token"`
	}
	if err := json.Unmarshal(saved, &renewed); err != nil {
		t.Fatal(err)
	}
	if renewed.Token == expired {
		t.Fatal("replacement credential was not persisted")
	}
	if _, err := service.AuthenticateNodeCredential(t.Context(), renewed.Token, domain.ScopeRoutePublish); err != nil {
		t.Fatal(err)
	}
	if _, err := service.BeginRotationChallenge(t.Context(), expired); err == nil {
		t.Fatal("stale JTI recovered again")
	}

	for _, denial := range []string{"wrong-node", "revoked"} {
		challenge, err := service.BeginRotationChallenge(t.Context(), renewed.Token)
		if err != nil {
			t.Fatal(err)
		}
		proofSigner := signer
		if denial == "wrong-node" {
			other, _, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			proofSigner.node = other
		} else {
			if _, err := service.RevokeEnrollment(t.Context(), credential.StationPeerID, credential.NodePeerID); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := service.RotateCredential(t.Context(), renewed.Token, proofSigner.proof(t, challenge)); err == nil {
			t.Fatalf("%s recovery accepted", denial)
		}
	}
}

type recoveryTestSigner struct {
	root, node libp2pcrypto.PrivKey
	epoch      uint64
	until      time.Time
}

func (s recoveryTestSigner) SignStationIdentityResponse(challenge []byte) (*peerpb.StationIdentityResponse, error) {
	now := time.Now().UTC()
	capabilities := []string{"station-identity", "station-route"}
	epoch, until := s.epoch, s.until
	if epoch == 0 {
		epoch = 1
	}
	if until.IsZero() {
		until = now.Add(time.Hour)
	}
	auth, err := peerpb.SignStationNodeAuthorization(s.root, s.node.GetPublic(), epoch, capabilities, now, until)
	if err != nil {
		return nil, err
	}
	return peerpb.SignStationIdentityResponse(s.node, auth, "https://station.example", challenge, capabilities, now)
}
func (s recoveryTestSigner) SignStationRouteAttestation(*peerpb.StationRouteStatement) (*peerpb.StationRouteAttestation, error) {
	return nil, fmt.Errorf("route signing not used in credential recovery")
}
func (s recoveryTestSigner) SignStationConnectionGrant(*peerpb.StationConnectionGrantStatement) (*peerpb.StationConnectionGrant, error) {
	return nil, fmt.Errorf("grant signing not used in credential recovery")
}
func (s recoveryTestSigner) proof(t *testing.T, challenge *domain.EnrollmentChallenge) domain.StationIdentityProof {
	t.Helper()
	response, err := s.SignStationIdentityResponse(challenge.Challenge)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	return domain.StationIdentityProof{ChallengeID: challenge.ID, Response: raw}
}

type recoveryHTTPRequest struct {
	request *http.Request
	body    []byte
}

func (r *recoveryHTTPRequest) Context() context.Context { return r.request.Context() }
func (r *recoveryHTTPRequest) Header() map[string]string {
	headers := make(map[string]string)
	for key := range r.request.Header {
		headers[key] = r.request.Header.Get(key)
	}
	return headers
}
func (r *recoveryHTTPRequest) Method() server.Method { return server.Method(r.request.Method) }
func (r *recoveryHTTPRequest) Path() string          { return r.request.URL.RequestURI() }
func (r *recoveryHTTPRequest) Body() []byte          { return r.body }

type recoveryHTTPResponse struct {
	writer http.ResponseWriter
	status int
}

func (r *recoveryHTTPResponse) Header() map[string]string {
	headers := make(map[string]string)
	for key := range r.writer.Header() {
		headers[key] = r.writer.Header().Get(key)
	}
	return headers
}
func (r *recoveryHTTPResponse) SetHeader(key, value string)    { r.writer.Header().Set(key, value) }
func (r *recoveryHTTPResponse) Write(body []byte) (int, error) { return r.writer.Write(body) }
func (r *recoveryHTTPResponse) WriteHeader(status int) {
	r.status = status
	r.writer.WriteHeader(status)
}
func (r *recoveryHTTPResponse) Status() int  { return r.status }
func (r *recoveryHTTPResponse) Flush() error { return nil }
