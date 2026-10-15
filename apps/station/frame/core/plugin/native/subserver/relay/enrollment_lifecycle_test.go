package relay

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/libp2p/go-libp2p"
	libp2pcrypto "github.com/libp2p/go-libp2p/core/crypto"
	"github.com/libp2p/go-libp2p/core/host"
	"github.com/libp2p/go-libp2p/core/peer"
	standardrelay "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/relay"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/application"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/plugin/native/subserver/relay/infrastructure"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type enrollmentLifecycleFixture struct {
	db         *gorm.DB
	repo       *infrastructure.GormRepo
	service    *application.Service
	admission  *standardrelay.Admission
	authority  *application.CredentialAuthority
	relayKey   ed25519.PrivateKey
	node       host.Host
	signer     recoveryTestSigner
	credential *domain.NodeCredential
}

func newEnrollmentLifecycleFixture(t *testing.T) enrollmentLifecycleFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "relay.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	repo := infrastructure.NewGormRepo(db)
	if err := repo.AutoMigrate(); err != nil {
		t.Fatal(err)
	}
	_, relayKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	authority, err := application.NewCredentialAuthority(relayKey)
	if err != nil {
		t.Fatal(err)
	}
	root, _, err := libp2pcrypto.GenerateEd25519Key(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	node, err := libp2p.New(libp2p.NoListenAddrs)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = node.Close() })
	admission := standardrelay.NewAdmission()
	service := application.NewService(repo, authority, admission)
	signer := recoveryTestSigner{root: root, node: node.Peerstore().PrivKey(node.ID()), epoch: 2}
	_, secret, err := service.CreateInvite(t.Context(), "", "lifecycle", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := service.BeginEnrollmentChallenge(t.Context(), secret, "lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	registered, err := service.Register(t.Context(), secret, signer.proof(t, challenge), 10)
	if err != nil {
		t.Fatal(err)
	}

	return enrollmentLifecycleFixture{
		db:         db,
		repo:       repo,
		service:    service,
		admission:  admission,
		authority:  authority,
		relayKey:   relayKey,
		node:       node,
		signer:     signer,
		credential: registered.Credential,
	}
}

func (f enrollmentLifecycleFixture) expiredToken(t *testing.T) string {
	t.Helper()
	claims := jwt.MapClaims{}
	if _, _, err := jwt.NewParser(jwt.WithJSONNumber()).ParseUnverified(f.credential.Token, claims); err != nil {
		t.Fatal(err)
	}

	now := time.Now().UTC()
	claims["iat"] = now.Add(-time.Hour).Unix()
	claims["nbf"] = now.Add(-time.Hour).Unix()
	claims["exp"] = now.Add(-45 * time.Minute).Unix()

	token, err := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims).SignedString(f.relayKey)
	if err != nil {
		t.Fatal(err)
	}

	return token
}

func TestRecoveryRejectsAuthorizationEpochRegression(t *testing.T) {
	f := newEnrollmentLifecycleFixture(t)
	expired := f.expiredToken(t)
	if err := f.db.Table("relay_enrollment").Where("id = ?", f.credential.EnrollmentID).
		Update("node_authorization_until", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	challenge, err := f.service.BeginRotationChallenge(t.Context(), expired)
	if err != nil {
		t.Fatal(err)
	}
	older := f.signer
	older.epoch = 1
	if _, err := f.service.RotateCredential(t.Context(), expired, older.proof(t, challenge)); !errors.Is(err, application.ErrStationMismatch) {
		t.Fatalf("superseded root delegation accepted: %v", err)
	}
	persisted, err := f.service.GetEnrollment(t.Context(), f.credential.StationPeerID, f.credential.NodePeerID)
	if err != nil || persisted.NodeAuthorizationEpoch != 2 || persisted.CredentialJTI != f.credential.JTI {
		t.Fatalf("rejected proof changed durable authority: %+v err=%v", persisted, err)
	}
}

func TestParallelRecoveriesCommitOnlyWinningAuthority(t *testing.T) {
	f := newEnrollmentLifecycleFixture(t)
	token := f.expiredToken(t)
	signers := []recoveryTestSigner{f.signer, f.signer}
	signers[0].until = time.Now().UTC().Add(time.Hour).Truncate(time.Millisecond)
	signers[1].until = time.Now().UTC().Add(time.Minute).Truncate(time.Millisecond)
	proofs := make([]domain.StationIdentityProof, 2)
	for index := range proofs {
		challenge, err := f.service.BeginRotationChallenge(t.Context(), token)
		if err != nil {
			t.Fatal(err)
		}
		proofs[index] = signers[index].proof(t, challenge)
	}
	type outcome struct {
		index      int
		credential *domain.NodeCredential
		err        error
	}
	start := make(chan struct{})
	results := make(chan outcome, 2)
	for index := range proofs {
		go func(index int) {
			<-start
			credential, err := f.service.RotateCredential(t.Context(), token, proofs[index])
			results <- outcome{index, credential, err}
		}(index)
	}
	close(start)
	var winner outcome
	wins := 0
	for range proofs {
		result := <-results
		if result.err == nil {
			winner = result
			wins++
		}
	}
	if wins != 1 {
		t.Fatalf("parallel recovery winners=%d, want 1", wins)
	}
	persisted, err := f.repo.GetEnrollment(t.Context(), f.credential.StationPeerID, f.credential.NodePeerID)
	if err != nil || persisted.CredentialJTI != winner.credential.JTI ||
		!persisted.NodeAuthorizationUntil.Equal(signers[winner.index].until) {
		t.Fatalf("losing proof changed winning authority: %+v err=%v", persisted, err)
	}
}

type pausedRotationRepository struct {
	domain.Repository
	committed chan struct{}
	release   chan struct{}
	revoking  chan struct{}
}

func (r *pausedRotationRepository) RotateNodeCredential(ctx context.Context, current domain.NodeIdentity, jti string, epoch uint64, until time.Time) (*domain.Enrollment, error) {
	result, err := r.Repository.RotateNodeCredential(ctx, current, jti, epoch, until)
	close(r.committed)
	<-r.release
	return result, err
}
func (r *pausedRotationRepository) RevokeEnrollment(ctx context.Context, station, node string) (*domain.Enrollment, error) {
	close(r.revoking)
	return r.Repository.RevokeEnrollment(ctx, station, node)
}

func TestRevocationOrdersAfterRecoveryAdmissionPublication(t *testing.T) {
	f := newEnrollmentLifecycleFixture(t)
	repo := &pausedRotationRepository{f.repo, make(chan struct{}), make(chan struct{}), make(chan struct{})}
	service := application.NewService(repo, f.authority, f.admission)
	challenge, err := service.BeginRotationChallenge(t.Context(), f.credential.Token)
	if err != nil {
		t.Fatal(err)
	}
	proof := f.signer.proof(t, challenge)
	rotated, revoked := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := service.RotateCredential(t.Context(), f.credential.Token, proof)
		rotated <- err
	}()
	<-repo.committed
	var release sync.Once
	defer release.Do(func() { close(repo.release) })
	started := make(chan struct{})
	go func() {
		close(started)
		_, err := service.RevokeEnrollment(t.Context(), f.credential.StationPeerID, f.credential.NodePeerID)
		revoked <- err
	}()
	<-started
	select {
	case <-repo.revoking:
		t.Error("revocation crossed an unpublished durable recovery")
	case <-time.After(100 * time.Millisecond):
	}
	release.Do(func() { close(repo.release) })
	if err := <-rotated; err != nil {
		t.Fatal(err)
	}
	if err := <-revoked; err != nil {
		t.Fatal(err)
	}
	if f.admission.AllowReserve(f.node.ID(), nil) {
		t.Fatal("recovery re-admitted a revoked Node")
	}
}

func TestStaleRetirementCannotRevokeFreshRegistration(t *testing.T) {
	f := newEnrollmentLifecycleFixture(t)
	identity, err := f.service.AuthenticateRetireCredential(t.Context(), f.credential.Token)
	if err != nil {
		t.Fatal(err)
	}
	_, secret, err := f.service.CreateInvite(t.Context(), "", "replacement", 1, 0)
	if err != nil {
		t.Fatal(err)
	}
	challenge, err := f.service.BeginEnrollmentChallenge(t.Context(), secret, "replacement")
	if err != nil {
		t.Fatal(err)
	}
	fresh, err := f.service.Register(t.Context(), secret, f.signer.proof(t, challenge), 10)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.service.RetireEnrollment(t.Context(), identity); !errors.Is(err, application.ErrCredentialInvalid) {
		t.Fatalf("stale retirement accepted: %v", err)
	}
	if _, err := f.service.AuthenticateNodeCredential(t.Context(), fresh.Credential.Token, domain.ScopeRoutePublish); err != nil {
		t.Fatal("stale retirement revoked replacement:", err)
	}
	if !f.admission.AllowReserve(f.node.ID(), nil) {
		t.Fatal("stale retirement removed replacement admission")
	}
}

func TestExpiredRetirementConfirmsOnlyRevokedPredecessorOverHTTP(t *testing.T) {
	for _, revoked := range []bool{false, true} {
		t.Run(map[bool]string{false: "active", true: "revoked"}[revoked], func(t *testing.T) {
			f := newEnrollmentLifecycleFixture(t)
			expired := f.expiredToken(t)
			if _, err := f.service.AuthenticateRetireCredential(t.Context(), expired); err == nil {
				t.Fatal("expired token could retire an active enrollment")
			}
			if revoked {
				identity, err := f.service.AuthenticateRetireCredential(t.Context(), f.credential.Token)
				if err != nil {
					t.Fatal(err)
				}
				// Model a completed DELETE whose response the Station did not receive.
				if _, err := f.service.RetireEnrollment(t.Context(), identity); err != nil {
					t.Fatal(err)
				}
			}
			sub := &SubServer{svc: f.service, opts: &Options{Admission: f.admission}}
			handler := newRelayHandler(sub)
			var deletes, rotations atomic.Int32
			controlServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				response := &recoveryHTTPResponse{writer: w}
				request := &recoveryHTTPRequest{request: r}
				switch r.URL.Path {
				case "/api/v1/relay/enrollment/self":
					deletes.Add(1)
					route := handler.requireStation(handler.handleRetireEnrollment)
					if err := retireAuthenticationWrapper(f.service)(route)(r.Context(), request, response); err != nil {
						t.Error(err)
					}
				case "/api/v1/relay/rotation/challenge":
					rotations.Add(1)
					http.Error(w, "unexpected recovery", http.StatusUnauthorized)
				default:
					http.NotFound(w, r)
				}
			}))
			defer controlServer.Close()
			path := filepath.Join(t.TempDir(), "credential.json")
			raw, err := json.Marshal(map[string]interface{}{
				"relay_token": expired, "relay_peer_id": f.credential.RelayPeerID,
				"station_peer_id": f.credential.StationPeerID, "enrollment_id": f.credential.EnrollmentID,
				"generation": f.credential.Generation, "expires_at": time.Now().Add(-45 * time.Minute).Format(time.RFC3339),
			})
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			relayID, err := peer.Decode(f.authority.RelayPeerID())
			if err != nil {
				t.Fatal(err)
			}
			target := standardrelay.Target{RelayPeerID: relayID, ControlOrigin: controlServer.URL,
				CredentialFile: path, Addresses: []string{"/ip4/127.0.0.1/tcp/1/p2p/" + relayID.String()}}
			control, err := standardrelay.NewStationControl(standardrelay.Pool{}, f.node, f.signer,
				[32]byte{1}, func(time.Time) []standardrelay.CircuitRoute { return nil })
			if err != nil {
				t.Fatal(err)
			}
			err = control.RetireTarget(t.Context(), target)
			if revoked {
				if err != nil || deletes.Load() != 1 || rotations.Load() != 0 {
					t.Fatalf("expired retirement acknowledgement failed: deletes=%d rotations=%d err=%v", deletes.Load(), rotations.Load(), err)
				}
				if _, err := f.service.BeginRotationChallenge(t.Context(), expired); err == nil {
					t.Fatal("retirement acknowledgement enabled recovery")
				}
				if f.admission.AllowReserve(f.node.ID(), nil) {
					t.Fatal("retirement acknowledgement enabled reservations")
				}
			} else if err == nil || deletes.Load() != 1 || rotations.Load() != 1 {
				t.Fatalf("expired active enrollment bypassed proof recovery: deletes=%d rotations=%d err=%v", deletes.Load(), rotations.Load(), err)
			}
		})
	}
}
