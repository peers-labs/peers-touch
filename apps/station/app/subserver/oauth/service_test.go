package oauth

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	accessgatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	oauthbridge "github.com/peers-labs/peers-touch/station/frame/touch/model/oauthbridge"
	"golang.org/x/crypto/hkdf"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

const (
	testStationPeerID = "station-test"
	testAccessAttempt = "access-attempt-test"
	testGateID        = "auth.login"
	testRedirectURI   = "peers-touch://oauth/callback"
	testOtherRedirect = "peers-touch://oauth/alternate"
	testPKCEVerifier  = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
	testNonce         = "nonce-for-oauth-contract-test"
	testDeviceID      = "mobile-device-test"
	testGeneration    = uint64(7)
)

var testAttemptSecret = []byte("test-attempt-secret-with-enough-entropy-0123456789")

type fakeProviderExchange struct {
	exchanges atomic.Int32
}

func (f *fakeProviderExchange) AuthorizeURL(
	_ providerRuntimeConfig,
	state, pkceChallenge string,
) (string, error) {
	return "https://provider.test/authorize?state=" + state + "&challenge=" + pkceChallenge, nil
}

func (f *fakeProviderExchange) Exchange(
	_ context.Context,
	config providerRuntimeConfig,
	_, _ string,
) (*coreauth.OAuth2Identity, error) {
	f.exchanges.Add(1)
	return &coreauth.OAuth2Identity{
		ProviderID:     coreauth.OAuth2ProviderID(config.ID),
		ProviderUserID: "provider-user",
		Username:       "oauth-user",
		DisplayName:    "OAuth User",
		Email:          "oauth-user@example.test",
	}, nil
}

type fakeAccessCoordinator struct {
	mu       sync.RWMutex
	database *gorm.DB
	decision accessgatepb.AccessDecisionState
}

func (f *fakeAccessCoordinator) ValidateStation(_ context.Context, stationPeerID string) error {
	if stationPeerID != testStationPeerID {
		return fmt.Errorf("station mismatch")
	}
	return nil
}

func (f *fakeAccessCoordinator) Validate(
	_ context.Context,
	accessAttemptID, stationPeerID, gateID, deviceID string,
	lifecycleGeneration uint64,
	actionType accessgatepb.AccessGateType,
) error {
	if accessAttemptID != testAccessAttempt ||
		stationPeerID != testStationPeerID ||
		gateID != testGateID ||
		deviceID != testDeviceID ||
		lifecycleGeneration != testGeneration ||
		actionType != accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH {
		return fmt.Errorf("access binding mismatch")
	}
	return nil
}

func (f *fakeAccessCoordinator) BindCandidate(
	ctx context.Context,
	_, _, _, _ string,
	_ uint64,
	actor *model.ActorRef,
	username, email string,
) (*accessgatepb.AccessDecision, error) {
	return f.persistDecision(ctx, actor, username, email)
}

func (f *fakeAccessCoordinator) Reevaluate(
	ctx context.Context,
	_, _ string,
) (*accessgatepb.AccessDecision, error) {
	return f.persistDecision(ctx, nil, "", "")
}

func (f *fakeAccessCoordinator) setDecision(state accessgatepb.AccessDecisionState) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.decision = state
}

func (f *fakeAccessCoordinator) currentDecision() accessgatepb.AccessDecisionState {
	f.mu.RLock()
	defer f.mu.RUnlock()
	return f.decision
}

func (f *fakeAccessCoordinator) persistDecision(
	ctx context.Context,
	actor *model.ActorRef,
	username, email string,
) (*accessgatepb.AccessDecision, error) {
	state := f.currentDecision()
	updates := map[string]any{
		"status":            accessStatus(state),
		"decision_revision": gorm.Expr("decision_revision + 1"),
	}
	if actor != nil {
		updates["actor_ptid"] = actor.GetPtid()
		updates["actor_kind"] = int32(actor.GetKind())
		updates["actor_username"] = username
		updates["actor_email"] = email
	}
	if err := f.database.WithContext(ctx).Model(&dbmodel.AccessAttempt{}).
		Where("id = ?", testAccessAttempt).
		Updates(updates).Error; err != nil {
		return nil, err
	}
	return &accessgatepb.AccessDecision{
		State:     state,
		AttemptId: testAccessAttempt,
	}, nil
}

func accessStatus(state accessgatepb.AccessDecisionState) string {
	switch state {
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED:
		return "granted"
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED:
		return "blocked"
	case accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_FAILED:
		return "failed"
	default:
		return "action_required"
	}
}

type fakeActorResolver struct{}

func (fakeActorResolver) Resolve(
	_ context.Context,
	_ *coreauth.OAuth2Identity,
) (*dbmodel.Actor, *model.ActorRef, error) {
	actor := &dbmodel.Actor{
		ID:                17,
		PTID:              "ptid:v1:actor:peers:p:alice:fingerprint",
		PreferredUsername: "oauth-user",
		FederatedHandle:   "@OAuth-User@Home.Example",
		Email:             "oauth-user@example.test",
		Kind:              "p",
	}
	return actor, &model.ActorRef{
		Ptid: actor.PTID,
		Acct: "oauth-user@home.example",
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}, nil
}

func (fakeActorResolver) ResolveReference(
	_ context.Context,
	ptid string,
) (*model.ActorRef, error) {
	return &model.ActorRef{
		Ptid: ptid,
		Acct: "oauth-user@home.example",
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}, nil
}

type fakeSessionCredentialIssuer struct {
	preparations atomic.Int32
	fail         atomic.Bool
}

func (f *fakeSessionCredentialIssuer) Prepare(
	_ context.Context,
	candidate *dbmodel.OAuthSessionCandidate,
	platform string,
	decisionRevision uint64,
	now time.Time,
) (*session.SessionRecord, *model.LoginResponse, error) {
	f.preparations.Add(1)
	if f.fail.Load() {
		return nil, nil, fmt.Errorf("injected credential issue failure")
	}
	sessionID := "session-" + candidate.ID
	expiresAt := now.Add(time.Hour)
	deviceType, err := oauthSessionDeviceType(platform)
	if err != nil {
		return nil, nil, err
	}
	return &session.SessionRecord{
			SessionID:              sessionID,
			UserID:                 candidate.ActorID,
			Email:                  candidate.ActorEmail,
			DeviceType:             deviceType,
			OAuthCandidateID:       candidate.ID,
			AccessAttemptID:        candidate.AccessAttemptID,
			StationPeerID:          candidate.StationPeerID,
			AccessDecisionRevision: decisionRevision,
			DeviceID:               candidate.DeviceID,
			LifecycleGeneration:    candidate.LifecycleGeneration,
			AuthMethod:             "oauth",
			CreatedAt:              now,
			ExpiresAt:              expiresAt,
			LastActiveAt:           now,
			Revoked:                true,
			RevokedReason:          "credential_delivery_pending",
		}, &model.LoginResponse{
			Tokens: &model.AuthTokens{
				Token:       "bearer-secret",
				AccessToken: "bearer-secret",
				TokenType:   "Bearer",
				ExpiresAt:   expiresAt.Format(time.RFC3339),
			},
			SessionId: sessionID,
			ActorRef: &model.ActorRef{
				Ptid: candidate.ActorPTID,
				Acct: "oauth-user@home.example",
				Kind: model.ActorKind(candidate.ActorKind),
			},
		}, nil
}

type oauthFixture struct {
	service         *oauthService
	database        *gorm.DB
	provider        *fakeProviderExchange
	access          *fakeAccessCoordinator
	issuer          *fakeSessionCredentialIssuer
	deliveryPrivate *ecdh.PrivateKey
}

func newOAuthFixture(t *testing.T, decision accessgatepb.AccessDecisionState) *oauthFixture {
	t.Helper()
	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared&_busy_timeout=10000", url.QueryEscape(t.Name()))
	database, err := gorm.Open(
		sqlite.Open(dsn),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := database.DB()
	if err != nil {
		t.Fatalf("get sqlite connection: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.AutoMigrate(
		&dbmodel.AccessAttempt{},
		&dbmodel.OAuthAttempt{},
		&dbmodel.OAuthSessionCandidate{},
		&dbmodel.OAuthCredentialEnvelope{},
		&session.SessionRecord{},
	); err != nil {
		t.Fatalf("migrate OAuth tables: %v", err)
	}
	if err := database.Create(&dbmodel.AccessAttempt{
		ID:               testAccessAttempt,
		Status:           "action_required",
		StationPeerID:    testStationPeerID,
		Platform:         "mobile",
		DeviceID:         testDeviceID,
		CurrentGateID:    testGateID,
		DecisionRevision: 1,
		ExpiresAt:        time.Now().UTC().Add(time.Hour),
	}).Error; err != nil {
		t.Fatalf("create access attempt: %v", err)
	}

	previousProviders := oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers
	oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers = []providerConfig{
		{
			ID:      "github",
			Enabled: true,
			Status:  "active",
			Environments: []providerEnvironmentConfig{{
				Default:      true,
				AuthorizeURL: "https://provider.test/authorize",
				TokenURL:     "https://provider.test/token",
				UserinfoURL:  "https://provider.test/user",
			}},
		},
		{
			ID:      "google",
			Enabled: true,
			Status:  "active",
			Environments: []providerEnvironmentConfig{{
				Default:      true,
				AuthorizeURL: "https://provider.test/authorize",
				TokenURL:     "https://provider.test/token",
				UserinfoURL:  "https://provider.test/user",
			}},
		},
	}
	t.Cleanup(func() {
		oauthOptions.Peers.Node.Server.Subserver.OAuth.Providers = previousProviders
	})
	t.Setenv("PEERS_OAUTH_GITHUB_CLIENT_ID", "test-client")
	t.Setenv("PEERS_OAUTH_GITHUB_CLIENT_SECRET", "test-secret")
	t.Setenv("PEERS_OAUTH_GITHUB_REDIRECT_URIS", testRedirectURI+","+testOtherRedirect)
	t.Setenv("PEERS_OAUTH_GOOGLE_CLIENT_ID", "test-client")
	t.Setenv("PEERS_OAUTH_GOOGLE_CLIENT_SECRET", "test-secret")
	t.Setenv("PEERS_OAUTH_GOOGLE_REDIRECT_URIS", testRedirectURI)

	deliveryPrivate, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate delivery key: %v", err)
	}
	provider := &fakeProviderExchange{}
	access := &fakeAccessCoordinator{database: database, decision: decision}
	issuer := &fakeSessionCredentialIssuer{}
	return &oauthFixture{
		service: newOAuthService(
			newGormOAuthRepository(func(context.Context) (*gorm.DB, error) {
				return database, nil
			}),
			provider,
			access,
			fakeActorResolver{},
			issuer,
		),
		database:        database,
		provider:        provider,
		access:          access,
		issuer:          issuer,
		deliveryPrivate: deliveryPrivate,
	}
}

func (f *oauthFixture) start(
	t *testing.T,
) (*oauthpb.StartOAuthAttemptResponse, *oauthpb.CompleteOAuthAttemptRequest) {
	t.Helper()
	start, err := f.service.Start(context.Background(), f.startRequest())
	if err != nil {
		t.Fatalf("start OAuth attempt: %v", err)
	}
	return start, &oauthpb.CompleteOAuthAttemptRequest{
		OauthAttemptId:      start.GetOauthAttemptId(),
		State:               start.GetState(),
		Code:                "provider-code",
		PkceVerifier:        testPKCEVerifier,
		Nonce:               testNonce,
		Provider:            "github",
		StationPeerId:       testStationPeerID,
		AccessAttemptId:     testAccessAttempt,
		GateId:              testGateID,
		RedirectUri:         testRedirectURI,
		AttemptSecret:       append([]byte(nil), testAttemptSecret...),
		DeviceId:            testDeviceID,
		LifecycleGeneration: testGeneration,
	}
}

func (f *oauthFixture) startRequest() *oauthpb.StartOAuthAttemptRequest {
	secretHash := sha256.Sum256(testAttemptSecret)
	return &oauthpb.StartOAuthAttemptRequest{
		Provider:                    "github",
		StationPeerId:               testStationPeerID,
		AccessAttemptId:             testAccessAttempt,
		GateId:                      testGateID,
		RedirectUri:                 testRedirectURI,
		PkceChallenge:               pkceChallenge(testPKCEVerifier),
		PkceMethod:                  "S256",
		NonceHash:                   hashBinding(testNonce),
		ActionType:                  accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH,
		DeviceId:                    testDeviceID,
		LifecycleGeneration:         testGeneration,
		AttemptSecretHash:           secretHash[:],
		CredentialDeliveryPublicKey: f.deliveryPrivate.PublicKey().Bytes(),
	}
}

func (f *oauthFixture) statusRequest(attemptID string) *oauthpb.GetOAuthAttemptRequest {
	return &oauthpb.GetOAuthAttemptRequest{
		OauthAttemptId:      attemptID,
		StationPeerId:       testStationPeerID,
		AccessAttemptId:     testAccessAttempt,
		AttemptSecret:       append([]byte(nil), testAttemptSecret...),
		DeviceId:            testDeviceID,
		LifecycleGeneration: testGeneration,
	}
}

func (f *oauthFixture) cancelRequest(attemptID string) *oauthpb.CancelOAuthAttemptRequest {
	return &oauthpb.CancelOAuthAttemptRequest{
		OauthAttemptId:      attemptID,
		StationPeerId:       testStationPeerID,
		AccessAttemptId:     testAccessAttempt,
		AttemptSecret:       append([]byte(nil), testAttemptSecret...),
		DeviceId:            testDeviceID,
		LifecycleGeneration: testGeneration,
	}
}

func (f *oauthFixture) acknowledgeRequest(attemptID string) *oauthpb.AcknowledgeOAuthCredentialRequest {
	return &oauthpb.AcknowledgeOAuthCredentialRequest{
		OauthAttemptId:      attemptID,
		StationPeerId:       testStationPeerID,
		AccessAttemptId:     testAccessAttempt,
		AttemptSecret:       append([]byte(nil), testAttemptSecret...),
		DeviceId:            testDeviceID,
		LifecycleGeneration: testGeneration,
	}
}

func (f *oauthFixture) brokerRequest() *oauthbridge.BrokerOAuthBridgeRequest {
	return &oauthbridge.BrokerOAuthBridgeRequest{
		Provider:                    "github",
		ProviderUserId:              "provider-user",
		Email:                       "oauth-user@example.test",
		Username:                    "oauth-user",
		DisplayName:                 "OAuth User",
		Ts:                          time.Now().UTC().Format(time.RFC3339),
		BridgeVersion:               "v1",
		SiteId:                      "default",
		EmailVerified:               true,
		Purpose:                     "account_login",
		AssertionId:                 fmt.Sprintf("%064x", 42),
		ReceiverId:                  "lp-test",
		ReceiverChallenge:           pkceChallenge(string(testAttemptSecret)),
		ReceiverVerifier:            string(testAttemptSecret),
		StationPeerId:               testStationPeerID,
		AccessAttemptId:             testAccessAttempt,
		GateId:                      testGateID,
		DeviceId:                    testDeviceID,
		LifecycleGeneration:         testGeneration,
		CredentialDeliveryPublicKey: f.deliveryPrivate.PublicKey().Bytes(),
	}
}

func TestBrokerBridgeUsesCandidateAndAcknowledgementLifecycle(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	if err := fixture.database.Model(&dbmodel.AccessAttempt{}).
		Where("id = ?", testAccessAttempt).
		Update("platform", "desktop").Error; err != nil {
		t.Fatal(err)
	}
	completed, err := fixture.service.CompleteBrokerBridge(
		context.Background(),
		fixture.brokerRequest(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED ||
		completed.GetSessionCandidate() == nil ||
		completed.GetCredentialEnvelope() == nil {
		t.Fatalf("broker bridge did not return an inactive credential candidate: %#v", completed)
	}
	if fixture.provider.exchanges.Load() != 0 {
		t.Fatal("broker identity path called the Station provider exchange")
	}
	credential := decryptEnvelope(
		t,
		fixture.deliveryPrivate,
		completed.GetCredentialEnvelope(),
		completed.GetSessionCandidate(),
	)
	if credential.GetTokens().GetAccessToken() != "bearer-secret" {
		t.Fatal("broker credential envelope did not contain the prepared session")
	}
	var pending session.SessionRecord
	if err := fixture.database.
		Where("session_id = ?", completed.GetCredentialEnvelope().GetSessionId()).
		First(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if !pending.Revoked || pending.RevokedReason != "credential_delivery_pending" {
		t.Fatalf("broker session became active before acknowledgement: %#v", pending)
	}
	if pending.DeviceType != session.DeviceTypeDesktop {
		t.Fatalf("broker session device type = %q", pending.DeviceType)
	}
	result, err := fixture.service.Acknowledge(
		context.Background(),
		fixture.acknowledgeRequest(completed.GetSessionCandidate().GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED {
		t.Fatalf("broker acknowledgement result = %s", result.GetResult())
	}
	if err := fixture.database.
		Where("session_id = ?", pending.SessionID).
		First(&pending).Error; err != nil {
		t.Fatal(err)
	}
	if pending.Revoked {
		t.Fatalf("broker session remained inactive after acknowledgement: %#v", pending)
	}
}

func TestBrokerBridgeResumesAfterLaterAccessGate(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	if err := fixture.database.Model(&dbmodel.AccessAttempt{}).
		Where("id = ?", testAccessAttempt).
		Update("platform", "desktop").Error; err != nil {
		t.Fatal(err)
	}
	completed, err := fixture.service.CompleteBrokerBridge(
		context.Background(),
		fixture.brokerRequest(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if completed.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED ||
		completed.GetSessionCandidate() == nil ||
		completed.GetCredentialEnvelope() != nil {
		t.Fatalf("later gate did not retain an inactive broker candidate: %#v", completed)
	}

	fixture.access.setDecision(accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	status, err := fixture.service.Status(
		context.Background(),
		fixture.statusRequest(completed.GetSessionCandidate().GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if status.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED ||
		status.GetCredentialEnvelope() == nil {
		t.Fatalf("granted later gate did not finalize broker candidate: %#v", status)
	}
}

func TestBrokerBridgeCancellationTerminalizesLaterGateCandidate(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	if err := fixture.database.Model(&dbmodel.AccessAttempt{}).
		Where("id = ?", testAccessAttempt).
		Update("platform", "desktop").Error; err != nil {
		t.Fatal(err)
	}
	completed, err := fixture.service.CompleteBrokerBridge(
		context.Background(),
		fixture.brokerRequest(),
	)
	if err != nil {
		t.Fatal(err)
	}
	candidate := completed.GetSessionCandidate()
	if candidate == nil {
		t.Fatal("later gate did not return a candidate")
	}

	cancelled, err := fixture.service.Cancel(
		context.Background(),
		fixture.cancelRequest(candidate.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_CANCELLED {
		t.Fatalf("cancel result = %s", cancelled.GetResult())
	}
	var stored dbmodel.OAuthSessionCandidate
	if err := fixture.database.Where("id = ?", candidate.GetCandidateId()).
		First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.State != candidateStateCancelled || stored.LiveBindingKey != nil {
		t.Fatalf("later-gate candidate remained live after cancellation: %#v", stored)
	}
}

func TestBrokerBridgeRejectsAccessClientBindingMismatch(t *testing.T) {
	tests := map[string]func(*oauthbridge.BrokerOAuthBridgeRequest){
		"device": func(req *oauthbridge.BrokerOAuthBridgeRequest) {
			req.DeviceId = "other-device"
		},
		"lifecycle generation": func(req *oauthbridge.BrokerOAuthBridgeRequest) {
			req.LifecycleGeneration++
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			fixture := newOAuthFixture(
				t,
				accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED,
			)
			request := fixture.brokerRequest()
			mutate(request)

			if _, err := fixture.service.CompleteBrokerBridge(
				context.Background(),
				request,
			); err == nil {
				t.Fatal("mismatched Access client binding was accepted")
			}
			var attempts int64
			if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).
				Count(&attempts).Error; err != nil {
				t.Fatal(err)
			}
			if attempts != 0 {
				t.Fatalf("mismatched binding persisted %d OAuth attempts", attempts)
			}
		})
	}
}

func TestOAuthStartRequiresExactAlternativeActionAndPersistsDeviceBindings(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	secretHash := sha256.Sum256(testAttemptSecret)
	request := &oauthpb.StartOAuthAttemptRequest{
		Provider:                    "github",
		StationPeerId:               testStationPeerID,
		AccessAttemptId:             testAccessAttempt,
		GateId:                      testGateID,
		RedirectUri:                 testRedirectURI,
		PkceChallenge:               pkceChallenge(testPKCEVerifier),
		PkceMethod:                  "S256",
		NonceHash:                   hashBinding(testNonce),
		ActionType:                  accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		DeviceId:                    testDeviceID,
		LifecycleGeneration:         testGeneration,
		AttemptSecretHash:           secretHash[:],
		CredentialDeliveryPublicKey: fixture.deliveryPrivate.PublicKey().Bytes(),
	}
	if _, err := fixture.service.Start(context.Background(), request); err == nil {
		t.Fatal("non-AUTH_OAUTH action was accepted")
	}

	request.ActionType = accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_OAUTH
	started, err := fixture.service.Start(context.Background(), request)
	if err != nil {
		t.Fatalf("start OAuth attempt: %v", err)
	}
	var persisted dbmodel.OAuthAttempt
	if err := fixture.database.Where("id = ?", started.GetOauthAttemptId()).First(&persisted).Error; err != nil {
		t.Fatalf("load persisted OAuth attempt: %v", err)
	}
	if persisted.DeviceID != testDeviceID ||
		persisted.LifecycleGeneration != testGeneration ||
		!bytes.Equal(persisted.AttemptSecretHash, secretHash[:]) ||
		!bytes.Equal(persisted.CredentialDeliveryPublicKey, fixture.deliveryPrivate.PublicKey().Bytes()) {
		t.Fatalf("persisted bindings do not match request: %#v", persisted)
	}
}

func TestOAuthStartExactRetryRecoversSameAttempt(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	first, _ := fixture.start(t)
	recovered, err := fixture.service.Start(context.Background(), fixture.startRequest())
	if err != nil {
		t.Fatalf("recover exact OAuth start retry: %v", err)
	}
	if !proto.Equal(first, recovered) {
		t.Fatalf("recovered response differs: first=%v recovered=%v", first, recovered)
	}

	var attempt dbmodel.OAuthAttempt
	if err := fixture.database.Where("id = ?", first.GetOauthAttemptId()).First(&attempt).Error; err != nil {
		t.Fatalf("load recovered OAuth attempt: %v", err)
	}
	if attempt.StateHash != hashBinding(first.GetState()) {
		t.Fatal("persisted state hash does not bind the reconstructed opaque state")
	}
	var count int64
	if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).Count(&count).Error; err != nil {
		t.Fatalf("count OAuth attempts: %v", err)
	}
	if count != 1 {
		t.Fatalf("OAuth attempts = %d, want 1", count)
	}
}

func TestOAuthStartRetryMismatchFailsClosed(t *testing.T) {
	tests := map[string]func(*testing.T, *oauthFixture, *oauthpb.StartOAuthAttemptRequest){
		"provider": func(_ *testing.T, _ *oauthFixture, req *oauthpb.StartOAuthAttemptRequest) {
			req.Provider = "google"
		},
		"redirect URI": func(_ *testing.T, _ *oauthFixture, req *oauthpb.StartOAuthAttemptRequest) {
			req.RedirectUri = testOtherRedirect
		},
		"PKCE challenge": func(_ *testing.T, _ *oauthFixture, req *oauthpb.StartOAuthAttemptRequest) {
			req.PkceChallenge = hashBinding("different-verifier")
		},
		"nonce hash": func(_ *testing.T, _ *oauthFixture, req *oauthpb.StartOAuthAttemptRequest) {
			req.NonceHash = hashBinding("different-nonce")
		},
		"attempt secret hash": func(_ *testing.T, _ *oauthFixture, req *oauthpb.StartOAuthAttemptRequest) {
			secretHash := sha256.Sum256([]byte("different-attempt-secret"))
			req.AttemptSecretHash = secretHash[:]
		},
		"delivery public key": func(t *testing.T, _ *oauthFixture, req *oauthpb.StartOAuthAttemptRequest) {
			privateKey, err := ecdh.X25519().GenerateKey(rand.Reader)
			if err != nil {
				t.Fatalf("generate mismatched delivery key: %v", err)
			}
			req.CredentialDeliveryPublicKey = privateKey.PublicKey().Bytes()
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
			fixture.start(t)
			retry := fixture.startRequest()
			mutate(t, fixture, retry)

			if _, err := fixture.service.Start(context.Background(), retry); !errors.Is(err, errOAuthBindingMismatch) {
				t.Fatalf("retry error = %v, want binding mismatch", err)
			}
			var count int64
			if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).Count(&count).Error; err != nil {
				t.Fatalf("count OAuth attempts: %v", err)
			}
			if count != 1 {
				t.Fatalf("OAuth attempts = %d, want 1", count)
			}
		})
	}
}

func TestOAuthConcurrentStartRetriesRecoverOneAttempt(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	request := fixture.startRequest()

	const callers = 16
	results := make(chan *oauthpb.StartOAuthAttemptResponse, callers)
	errs := make(chan error, callers)
	var wait sync.WaitGroup
	wait.Add(callers)
	for range callers {
		go func() {
			defer wait.Done()
			response, err := fixture.service.Start(context.Background(), request)
			if err != nil {
				errs <- err
				return
			}
			results <- response
		}()
	}
	wait.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Errorf("concurrent OAuth start: %v", err)
	}
	var first *oauthpb.StartOAuthAttemptResponse
	for result := range results {
		if first == nil {
			first = result
		} else if !proto.Equal(first, result) {
			t.Fatalf("concurrent start returned different attempt: first=%v result=%v", first, result)
		}
	}
	if first == nil {
		t.Fatal("concurrent start returned no successful response")
	}
	var count int64
	if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).Count(&count).Error; err != nil {
		t.Fatalf("count OAuth attempts: %v", err)
	}
	if count != 1 {
		t.Fatalf("OAuth attempts = %d, want 1", count)
	}
}

func TestOAuthFinalizerPersistsOneDecryptableEnvelopeAndStatusReusesIt(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)

	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}
	if completed.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED ||
		completed.GetCredentialEnvelope() == nil {
		t.Fatalf("expected credential envelope: %#v", completed)
	}
	firstEnvelope := completed.GetCredentialEnvelope()
	plaintext := decryptEnvelope(t, fixture.deliveryPrivate, firstEnvelope, completed.GetSessionCandidate())
	if plaintext.GetTokens().GetAccessToken() != "bearer-secret" {
		t.Fatal("decrypted credential does not contain expected access token")
	}
	if !proto.Equal(firstEnvelope.GetActorRef(), plaintext.GetActorRef()) {
		t.Fatalf(
			"envelope actor %v does not match credential actor %v",
			firstEnvelope.GetActorRef(),
			plaintext.GetActorRef(),
		)
	}
	if got, want := firstEnvelope.GetActorRef().GetAcct(), "oauth-user@home.example"; got != want {
		t.Fatalf("credential envelope acct = %q, want %q", got, want)
	}

	status, err := fixture.service.Status(context.Background(), fixture.statusRequest(start.GetOauthAttemptId()))
	if err != nil {
		t.Fatalf("status OAuth attempt: %v", err)
	}
	if !proto.Equal(firstEnvelope, status.GetCredentialEnvelope()) {
		t.Fatal("status returned a different credential envelope")
	}
	if fixture.issuer.preparations.Load() != 1 {
		t.Fatalf("credential was minted %d times", fixture.issuer.preparations.Load())
	}
	assertPersistenceCounts(t, fixture.database, 1, 1)
}

func TestOAuthAcknowledgeClearsEnvelopeAndActivatesPersistedSession(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}

	acknowledged, err := fixture.service.Acknowledge(
		context.Background(),
		fixture.acknowledgeRequest(start.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatalf("acknowledge credential: %v", err)
	}
	if acknowledged.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED {
		t.Fatalf("acknowledgement result = %s", acknowledged.GetResult())
	}
	replayed, err := fixture.service.Acknowledge(
		context.Background(),
		fixture.acknowledgeRequest(start.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatalf("replay acknowledgement after lost response: %v", err)
	}
	if replayed.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED {
		t.Fatalf("replayed acknowledgement result = %s", replayed.GetResult())
	}
	status, err := fixture.service.Status(context.Background(), fixture.statusRequest(start.GetOauthAttemptId()))
	if err != nil {
		t.Fatalf("status after acknowledgement: %v", err)
	}
	if status.GetCredentialEnvelope() != nil {
		t.Fatal("acknowledged envelope remains recoverable")
	}
	if status.GetState() != oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_ACTIVATED {
		t.Fatalf("state after acknowledgement = %s", status.GetState())
	}

	var record session.SessionRecord
	if err := fixture.database.Where("session_id = ?", completed.GetCredentialEnvelope().GetSessionId()).
		First(&record).Error; err != nil {
		t.Fatalf("load acknowledged session: %v", err)
	}
	if record.Revoked || record.OAuthCandidateID != completed.GetSessionCandidate().GetCandidateId() {
		t.Fatalf("acknowledged session is not active and candidate-bound: %#v", record)
	}
	assertPersistenceCounts(t, fixture.database, 1, 0)
}

func TestOAuthCancelAfterAcknowledgementPreservesActivatedSession(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatal(err)
	}
	acknowledged, err := fixture.service.Acknowledge(
		context.Background(),
		fixture.acknowledgeRequest(start.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if acknowledged.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED {
		t.Fatalf("acknowledgement result = %s", acknowledged.GetResult())
	}

	cancelled, err := fixture.service.Cancel(
		context.Background(),
		fixture.cancelRequest(start.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED {
		t.Fatalf("late cancellation result = %s", cancelled.GetResult())
	}
	var record session.SessionRecord
	if err := fixture.database.Where(
		"session_id = ?",
		completed.GetCredentialEnvelope().GetSessionId(),
	).First(&record).Error; err != nil {
		t.Fatal(err)
	}
	if record.Revoked {
		t.Fatalf("late cancellation revoked the activated session: %#v", record)
	}
}

func TestOAuthStatusExpiryRevokesCandidateAndDeletesEnvelope(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}
	if completed.GetCredentialEnvelope() == nil {
		t.Fatal("finalization did not persist an envelope")
	}
	if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).
		Where("id = ?", start.GetOauthAttemptId()).
		Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatalf("expire OAuth attempt: %v", err)
	}

	status, err := fixture.service.Status(
		context.Background(),
		fixture.statusRequest(start.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatalf("read expired OAuth attempt: %v", err)
	}
	if status.GetState() != oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED ||
		status.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED ||
		status.GetCredentialEnvelope() != nil {
		t.Fatalf("expired OAuth status retained credential delivery: %#v", status)
	}
	assertPersistenceCounts(t, fixture.database, 1, 0)

	var record session.SessionRecord
	if err := fixture.database.Where(
		"session_id = ?",
		completed.GetCredentialEnvelope().GetSessionId(),
	).First(&record).Error; err != nil {
		t.Fatalf("load expired candidate session: %v", err)
	}
	if !record.Revoked || record.RevokedReason != "oauth_expired" {
		t.Fatalf("expired candidate session was not revoked: %#v", record)
	}
	var candidate dbmodel.OAuthSessionCandidate
	if err := fixture.database.Where(
		"id = ?",
		completed.GetSessionCandidate().GetCandidateId(),
	).First(&candidate).Error; err != nil {
		t.Fatalf("load expired candidate: %v", err)
	}
	if candidate.State != candidateStateCancelled || candidate.LiveBindingKey != nil {
		t.Fatalf("expired candidate remained live: %#v", candidate)
	}
}

func TestOAuthExpirySweepRevokesAbandonedCandidateWithoutStatusRequest(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}
	expiredAt := time.Now().UTC().Add(-time.Second)
	if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).
		Where("id = ?", start.GetOauthAttemptId()).
		Update("expires_at", expiredAt).Error; err != nil {
		t.Fatalf("expire OAuth attempt: %v", err)
	}

	swept, err := fixture.service.SweepExpired(context.Background())
	if err != nil {
		t.Fatalf("sweep expired OAuth attempts: %v", err)
	}
	if swept != 1 {
		t.Fatalf("swept attempts = %d, want 1", swept)
	}

	var record session.SessionRecord
	if err := fixture.database.Where(
		"session_id = ?",
		completed.GetCredentialEnvelope().GetSessionId(),
	).First(&record).Error; err != nil {
		t.Fatalf("load swept candidate session: %v", err)
	}
	if !record.Revoked || record.RevokedReason != "oauth_expired" {
		t.Fatalf("swept candidate session was not revoked: %#v", record)
	}
	var candidate dbmodel.OAuthSessionCandidate
	if err := fixture.database.Where(
		"id = ?",
		completed.GetSessionCandidate().GetCandidateId(),
	).First(&candidate).Error; err != nil {
		t.Fatalf("load swept candidate: %v", err)
	}
	if candidate.State != candidateStateCancelled || candidate.LiveBindingKey != nil {
		t.Fatalf("swept candidate remained live: %#v", candidate)
	}
	assertPersistenceCounts(t, fixture.database, 1, 0)

	replayed, err := fixture.service.SweepExpired(context.Background())
	if err != nil {
		t.Fatalf("replay OAuth expiry sweep: %v", err)
	}
	if replayed != 0 {
		t.Fatalf("replayed sweep expired %d attempts, want 0", replayed)
	}
}

func TestOAuthAttemptSecretAndGenerationMismatchFailClosed(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)

	for name, mutate := range map[string]func(*oauthpb.CompleteOAuthAttemptRequest){
		"secret": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.AttemptSecret = []byte("wrong-secret")
		},
		"device": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.DeviceId = "wrong-device"
		},
		"generation": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.LifecycleGeneration++
		},
	} {
		t.Run(name, func(t *testing.T) {
			copyRequest := proto.Clone(completeRequest).(*oauthpb.CompleteOAuthAttemptRequest)
			mutate(copyRequest)
			response, err := fixture.service.Complete(context.Background(), copyRequest)
			if err != nil {
				t.Fatalf("complete mismatched OAuth attempt: %v", err)
			}
			if response.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH {
				t.Fatalf("result = %s, want binding mismatch", response.GetResult())
			}
		})
	}
	if fixture.provider.exchanges.Load() != 0 || fixture.issuer.preparations.Load() != 0 {
		t.Fatal("mismatched attempt reached provider exchange or credential issuance")
	}

	statusRequest := fixture.statusRequest(start.GetOauthAttemptId())
	statusRequest.AttemptSecret = []byte("wrong-secret")
	status, err := fixture.service.Status(context.Background(), statusRequest)
	if err != nil {
		t.Fatalf("status mismatched secret: %v", err)
	}
	if status.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH {
		t.Fatalf("status result = %s", status.GetResult())
	}
}

func TestOAuthEveryCallbackBindingFailsClosedBeforeProviderExchange(t *testing.T) {
	tests := map[string]func(*oauthpb.CompleteOAuthAttemptRequest){
		"provider": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.Provider = "google"
		},
		"station": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.StationPeerId = "station-other"
		},
		"access attempt": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.AccessAttemptId = "access-attempt-other"
		},
		"gate": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.GateId = "auth.other"
		},
		"redirect": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.RedirectUri = "peers-touch://oauth/other"
		},
		"state": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.State = "state-other"
		},
		"PKCE": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.PkceVerifier = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFG"
		},
		"nonce": func(req *oauthpb.CompleteOAuthAttemptRequest) {
			req.Nonce = "nonce-other"
		},
	}

	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
			_, completeRequest := fixture.start(t)
			mutate(completeRequest)

			response, err := fixture.service.Complete(context.Background(), completeRequest)
			if err != nil {
				t.Fatalf("complete mismatched callback: %v", err)
			}
			if response.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_BINDING_MISMATCH {
				t.Fatalf("result = %s, want binding mismatch", response.GetResult())
			}
			if fixture.provider.exchanges.Load() != 0 || fixture.issuer.preparations.Load() != 0 {
				t.Fatal("mismatched callback reached provider exchange or credential issuance")
			}
		})
	}
}

func TestOAuthConcurrentStatusFinalizesExactlyOnce(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	start, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}
	if completed.GetCredentialEnvelope() != nil {
		t.Fatal("credential was finalized before the later gate granted")
	}
	fixture.access.setDecision(accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)

	const callers = 16
	var wait sync.WaitGroup
	results := make(chan *oauthpb.GetOAuthAttemptResponse, callers)
	errs := make(chan error, callers)
	wait.Add(callers)
	for range callers {
		go func() {
			defer wait.Done()
			response, err := fixture.service.Status(
				context.Background(),
				fixture.statusRequest(start.GetOauthAttemptId()),
			)
			if err != nil {
				errs <- err
				return
			}
			results <- response
		}()
	}
	wait.Wait()
	close(results)
	close(errs)
	for err := range errs {
		t.Errorf("concurrent status: %v", err)
	}

	var first *oauthpb.OAuthCredentialEnvelope
	for result := range results {
		if result.GetCredentialEnvelope() == nil {
			t.Fatalf("concurrent status returned no envelope: %#v", result)
		}
		if first == nil {
			first = result.GetCredentialEnvelope()
		} else if !proto.Equal(first, result.GetCredentialEnvelope()) {
			t.Fatal("concurrent status returned different envelopes")
		}
	}
	if fixture.issuer.preparations.Load() != 1 {
		t.Fatalf("credential was prepared %d times", fixture.issuer.preparations.Load())
	}
	assertPersistenceCounts(t, fixture.database, 1, 1)
}

func TestOAuthFinalizerFaultRollsBackAndRetryCreatesOneCredential(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	if err := fixture.database.Exec(`
		CREATE TRIGGER fail_oauth_envelope_insert
		BEFORE INSERT ON oauth_credential_envelopes
		BEGIN
			SELECT RAISE(FAIL, 'injected envelope persistence failure');
		END
	`).Error; err != nil {
		t.Fatalf("install envelope fault trigger: %v", err)
	}
	start, completeRequest := fixture.start(t)
	if _, err := fixture.service.Complete(context.Background(), completeRequest); err == nil {
		t.Fatal("injected finalizer fault was not returned")
	}
	assertPersistenceCounts(t, fixture.database, 0, 0)

	if err := fixture.database.Exec("DROP TRIGGER fail_oauth_envelope_insert").Error; err != nil {
		t.Fatalf("remove envelope fault trigger: %v", err)
	}
	status, err := fixture.service.Status(context.Background(), fixture.statusRequest(start.GetOauthAttemptId()))
	if err != nil {
		t.Fatalf("retry finalization through status: %v", err)
	}
	if status.GetCredentialEnvelope() == nil {
		t.Fatal("retry did not produce credential envelope")
	}
	assertPersistenceCounts(t, fixture.database, 1, 1)
}

func TestOAuthCancelAfterFinalizationRevokesSessionAndDeletesEnvelope(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	start, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}
	if completed.GetCredentialEnvelope() == nil {
		t.Fatal("finalization did not persist an envelope")
	}

	cancelled, err := fixture.service.Cancel(
		context.Background(),
		fixture.cancelRequest(start.GetOauthAttemptId()),
	)
	if err != nil {
		t.Fatalf("cancel finalized OAuth attempt: %v", err)
	}
	if cancelled.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_CANCELLED {
		t.Fatalf("cancel result = %s", cancelled.GetResult())
	}
	assertPersistenceCounts(t, fixture.database, 1, 0)

	var record session.SessionRecord
	if err := fixture.database.Where(
		"session_id = ?",
		completed.GetCredentialEnvelope().GetSessionId(),
	).First(&record).Error; err != nil {
		t.Fatalf("load cancelled candidate session: %v", err)
	}
	if !record.Revoked || record.RevokedReason != "oauth_cancelled" {
		t.Fatalf("cancelled candidate session was not revoked: %#v", record)
	}
}

func TestOAuthExpiryIsTerminalAndReleasesLiveBinding(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	startedAt := fixture.service.now()
	_, completeRequest := fixture.start(t)
	fixture.service.now = func() time.Time {
		return startedAt.Add(oauthAttemptLifetime + time.Second)
	}

	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete expired OAuth attempt: %v", err)
	}
	if completed.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_EXPIRED {
		t.Fatalf("result = %s, want expired", completed.GetResult())
	}
	var attempt dbmodel.OAuthAttempt
	if err := fixture.database.Where("id = ?", completeRequest.GetOauthAttemptId()).
		First(&attempt).Error; err != nil {
		t.Fatalf("load expired OAuth attempt: %v", err)
	}
	if attempt.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED) ||
		attempt.LiveBindingKey != nil {
		t.Fatalf("expired attempt remained live: %#v", attempt)
	}
}

func TestOAuthStartAfterExpiryCreatesNewAttempt(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED)
	first, _ := fixture.start(t)
	if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).
		Where("id = ?", first.GetOauthAttemptId()).
		Update("expires_at", time.Now().UTC().Add(-time.Second)).Error; err != nil {
		t.Fatalf("expire first OAuth attempt: %v", err)
	}

	second, err := fixture.service.Start(context.Background(), fixture.startRequest())
	if err != nil {
		t.Fatalf("start after OAuth attempt expiry: %v", err)
	}
	if second.GetOauthAttemptId() == first.GetOauthAttemptId() || second.GetState() == first.GetState() {
		t.Fatal("expired OAuth attempt was recovered instead of replaced")
	}

	var expired dbmodel.OAuthAttempt
	if err := fixture.database.Where("id = ?", first.GetOauthAttemptId()).First(&expired).Error; err != nil {
		t.Fatalf("load expired OAuth attempt: %v", err)
	}
	if expired.State != int32(oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_EXPIRED) ||
		expired.LiveBindingKey != nil {
		t.Fatalf("replaced OAuth attempt was not terminalized: %#v", expired)
	}
	var count int64
	if err := fixture.database.Model(&dbmodel.OAuthAttempt{}).Count(&count).Error; err != nil {
		t.Fatalf("count OAuth attempts: %v", err)
	}
	if count != 2 {
		t.Fatalf("OAuth attempts = %d, want 2", count)
	}
}

func TestOAuthCancelFinalizerRaceAlwaysLeavesSessionRevoked(t *testing.T) {
	for iteration := 0; iteration < 20; iteration++ {
		t.Run(fmt.Sprintf("iteration-%02d", iteration), func(t *testing.T) {
			fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
			start, completeRequest := fixture.start(t)
			fixture.issuer.fail.Store(true)
			if _, err := fixture.service.Complete(context.Background(), completeRequest); err == nil {
				t.Fatal("expected setup finalization fault")
			}
			fixture.issuer.fail.Store(false)

			var wait sync.WaitGroup
			errs := make(chan error, 2)
			outcomes := make(chan oauthpb.OAuthAttemptResult, 2)
			wait.Add(2)
			go func() {
				defer wait.Done()
				response, err := fixture.service.Status(
					context.Background(),
					fixture.statusRequest(start.GetOauthAttemptId()),
				)
				if response != nil {
					outcomes <- response.GetResult()
				}
				errs <- err
			}()
			go func() {
				defer wait.Done()
				response, err := fixture.service.Cancel(
					context.Background(),
					fixture.cancelRequest(start.GetOauthAttemptId()),
				)
				if response != nil {
					outcomes <- response.GetResult()
				}
				errs <- err
			}()
			wait.Wait()
			close(errs)
			close(outcomes)
			var observedOutcomes []oauthpb.OAuthAttemptResult
			for outcome := range outcomes {
				observedOutcomes = append(observedOutcomes, outcome)
			}
			for err := range errs {
				if err != nil {
					t.Fatalf("cancel/finalize race returned error: %v", err)
				}
			}

			var active int64
			if err := fixture.database.Model(&session.SessionRecord{}).
				Where("revoked = ?", false).
				Count(&active).Error; err != nil {
				t.Fatalf("count active sessions: %v", err)
			}
			if active != 0 {
				t.Fatalf("cancel/finalize race left %d active sessions", active)
			}
			var envelopes int64
			if err := fixture.database.Model(&dbmodel.OAuthCredentialEnvelope{}).
				Count(&envelopes).Error; err != nil {
				t.Fatalf("count envelopes: %v", err)
			}
			if envelopes != 0 {
				var attempt dbmodel.OAuthAttempt
				var candidate dbmodel.OAuthSessionCandidate
				var records []session.SessionRecord
				attemptErr := fixture.database.Where("id = ?", start.GetOauthAttemptId()).First(&attempt).Error
				candidateErr := fixture.database.Where("oauth_attempt_id = ?", start.GetOauthAttemptId()).First(&candidate).Error
				_ = fixture.database.Find(&records).Error
				t.Fatalf(
					"cancel/finalize race left %d envelopes: outcomes=%v attempt_err=%v attempt_state=%s result=%s candidate_err=%v candidate_state=%s sessions=%#v",
					envelopes,
					observedOutcomes,
					attemptErr,
					oauthpb.OAuthAttemptState(attempt.State),
					oauthpb.OAuthAttemptResult(attempt.Result),
					candidateErr,
					candidate.State,
					records,
				)
			}
		})
	}
}

func TestOAuthCallbackClaimIsAtomicAndReplaySafe(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED)
	_, completeRequest := fixture.start(t)

	const callers = 12
	results := make(chan oauthpb.OAuthAttemptResult, callers)
	var wait sync.WaitGroup
	wait.Add(callers)
	for range callers {
		go func() {
			defer wait.Done()
			response, err := fixture.service.Complete(context.Background(), completeRequest)
			if err == nil {
				results <- response.GetResult()
			}
		}()
	}
	wait.Wait()
	close(results)

	granted := 0
	replayed := 0
	for result := range results {
		switch result {
		case oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED:
			granted++
		case oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_REPLAYED:
			replayed++
		}
	}
	if granted != 1 || replayed != callers-1 {
		t.Fatalf("grant=%d replay=%d, want 1/%d", granted, replayed, callers-1)
	}
	if fixture.provider.exchanges.Load() != 1 || fixture.issuer.preparations.Load() != 1 {
		t.Fatalf(
			"provider exchanges=%d credential preparations=%d",
			fixture.provider.exchanges.Load(),
			fixture.issuer.preparations.Load(),
		)
	}
}

func TestOAuthLaterGateDenialNeverCreatesSession(t *testing.T) {
	fixture := newOAuthFixture(t, accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_BLOCKED)
	_, completeRequest := fixture.start(t)
	completed, err := fixture.service.Complete(context.Background(), completeRequest)
	if err != nil {
		t.Fatalf("complete OAuth attempt: %v", err)
	}
	if completed.GetResult() != oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_DENIED {
		t.Fatalf("result = %s", completed.GetResult())
	}
	assertPersistenceCounts(t, fixture.database, 0, 0)
}

func decryptEnvelope(
	t *testing.T,
	privateKey *ecdh.PrivateKey,
	envelope *oauthpb.OAuthCredentialEnvelope,
	candidate *model.AuthSessionCandidate,
) *model.LoginResponse {
	t.Helper()
	serverPublicKey, err := ecdh.X25519().NewPublicKey(envelope.GetServerEphemeralPublicKey())
	if err != nil {
		t.Fatalf("parse server public key: %v", err)
	}
	sharedSecret, err := privateKey.ECDH(serverPublicKey)
	if err != nil {
		t.Fatalf("derive shared secret: %v", err)
	}
	associatedData := credentialEnvelopeAssociatedData(
		envelope.GetCandidateId(),
		envelope.GetSessionId(),
		envelope.GetStationPeerId(),
		envelope.GetDeviceId(),
		envelope.GetLifecycleGeneration(),
		candidate.GetAccessAttemptId(),
		candidate.GetDecisionRevision(),
	)
	key := make([]byte, 32)
	if _, err := io.ReadFull(hkdf.New(sha256.New, sharedSecret, nil, associatedData), key); err != nil {
		t.Fatalf("derive envelope key: %v", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		t.Fatalf("create AES cipher: %v", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("create GCM: %v", err)
	}
	plaintext, err := aead.Open(nil, envelope.GetNonce(), envelope.GetCiphertext(), associatedData)
	if err != nil {
		t.Fatalf("decrypt credential envelope: %v", err)
	}
	var credential model.LoginResponse
	if err := proto.Unmarshal(plaintext, &credential); err != nil {
		t.Fatalf("decode credential envelope: %v", err)
	}
	return &credential
}

func assertPersistenceCounts(t *testing.T, database *gorm.DB, sessions, envelopes int64) {
	t.Helper()
	var sessionCount int64
	if err := database.Model(&session.SessionRecord{}).Count(&sessionCount).Error; err != nil {
		t.Fatalf("count sessions: %v", err)
	}
	if sessionCount != sessions {
		t.Fatalf("sessions = %d, want %d", sessionCount, sessions)
	}
	var envelopeCount int64
	if err := database.Model(&dbmodel.OAuthCredentialEnvelope{}).Count(&envelopeCount).Error; err != nil {
		t.Fatalf("count envelopes: %v", err)
	}
	if envelopeCount != envelopes {
		t.Fatalf("envelopes = %d, want %d", envelopeCount, envelopes)
	}
}
