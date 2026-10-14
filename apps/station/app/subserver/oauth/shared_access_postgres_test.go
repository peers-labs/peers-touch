package oauth

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/libp2p/go-libp2p/core/peer"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	touchcrypto "github.com/peers-labs/peers-touch/station/frame/touch/crypto"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	accessgatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

const (
	sharedAccessStationPeerID = "12D3KooWLpZy2EgZ6SC2pgJFHjM13j1ygz7DXCfm9HiPeNQZ1uaW"
	sharedAccessSecret        = "ncp-shared-station-access-secret-0123456789"
	sharedAccessAttemptSecret = "ncp-shared-oauth-attempt-secret"
	sharedAccessActorID       = uint64(41)
	sharedAccessActorPTID     = "ptid:v1:actor:peers:p:alice:fingerprint"
	sharedAccessDeviceID      = "desktop-installation"
	sharedAccessGeneration    = uint64(7)
	sharedOAuthAttemptID      = "oauth-attempt-ncp-shared"
	sharedOAuthCandidateID    = "oauth-candidate-ncp-shared"
	sharedOAuthSessionID      = "oauth-session-ncp-shared"
)

type sharedAccessProcessResult struct {
	Role             string `json:"role"`
	SessionID        string `json:"sessionId,omitempty"`
	KeyID            string `json:"keyId,omitempty"`
	Valid            bool   `json:"valid,omitempty"`
	Reason           string `json:"reason,omitempty"`
	Acknowledged     bool   `json:"acknowledged,omitempty"`
	MismatchRejected bool   `json:"mismatchRejected,omitempty"`
}

type sharedAccessProcessStore struct {
	database *gorm.DB
}

func (s *sharedAccessProcessStore) Init(
	context.Context,
	...option.Option,
) error {
	return nil
}

func (s *sharedAccessProcessStore) RDS(
	context.Context,
	...store.RDSDMLOption,
) (*gorm.DB, error) {
	return s.database, nil
}

func (s *sharedAccessProcessStore) Name() string {
	return "ncp-shared-access"
}

func TestPostgresCrossProcessSharedAccess(t *testing.T) {
	database, dsn := openSharedAccessPostgres(t)
	prepareSharedAccessSchema(t, database)

	credentialPath := t.TempDir() + "/credential"
	prepared := runSharedAccessProcess(
		t,
		dsn,
		"prepare-oauth",
		map[string]string{
			"NCP_ACCESS_CREDENTIAL_PATH": credentialPath,
		},
	)
	if prepared.SessionID != sharedOAuthSessionID ||
		prepared.KeyID == "" {
		t.Fatalf("node A preparation is incomplete: %+v", prepared)
	}
	tokenBytes, err := os.ReadFile(credentialPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(tokenBytes) == 0 {
		t.Fatal("node A credential file is empty")
	}

	acknowledged := runSharedAccessProcess(
		t,
		dsn,
		"acknowledge",
		map[string]string{
			"NCP_ACCESS_CREDENTIAL_PATH": credentialPath,
			"NCP_ACCESS_SESSION_ID":      prepared.SessionID,
		},
	)
	if !acknowledged.Acknowledged ||
		!acknowledged.Valid ||
		acknowledged.SessionID != prepared.SessionID ||
		acknowledged.KeyID != prepared.KeyID {
		t.Fatalf("node B acknowledgement failed: %+v", acknowledged)
	}
	replayed := runSharedAccessProcess(
		t,
		dsn,
		"acknowledge",
		map[string]string{
			"NCP_ACCESS_CREDENTIAL_PATH": credentialPath,
			"NCP_ACCESS_SESSION_ID":      prepared.SessionID,
		},
	)
	if !replayed.Acknowledged ||
		replayed.SessionID != prepared.SessionID {
		t.Fatalf("idempotent acknowledgement changed session: %+v", replayed)
	}
	validatedOnA := runSharedAccessProcess(
		t,
		dsn,
		"validate",
		map[string]string{
			"NCP_ACCESS_CREDENTIAL_PATH": credentialPath,
			"NCP_ACCESS_SESSION_ID":      prepared.SessionID,
		},
	)
	if !validatedOnA.Valid || validatedOnA.SessionID != prepared.SessionID {
		t.Fatalf("node A could not use node B session: %+v", validatedOnA)
	}

	mismatch := runSharedAccessProcess(t, dsn, "key-mismatch", nil)
	if !mismatch.MismatchRejected {
		t.Fatalf("keyring mismatch did not fail readiness: %+v", mismatch)
	}

	web := session.SessionRecord{
		SessionID:    "web-preserved",
		UserID:       sharedAccessActorID,
		Email:        "alice@example.test",
		DeviceType:   session.DeviceTypeWeb,
		CreatedAt:    time.Now().UTC(),
		ExpiresAt:    time.Now().UTC().Add(time.Hour),
		LastActiveAt: time.Now().UTC(),
	}
	if err := database.Create(&web).Error; err != nil {
		t.Fatal(err)
	}

	barrier := t.TempDir() + "/activate"
	first := startSharedAccessProcess(
		t,
		dsn,
		"activate-class",
		map[string]string{
			"NCP_ACCESS_SESSION_ID": "desktop-concurrent-a",
			"NCP_ACCESS_BARRIER":    barrier,
		},
	)
	second := startSharedAccessProcess(
		t,
		dsn,
		"activate-class",
		map[string]string{
			"NCP_ACCESS_SESSION_ID": "desktop-concurrent-b",
			"NCP_ACCESS_BARRIER":    barrier,
		},
	)
	if err := os.WriteFile(barrier, []byte("go"), 0o600); err != nil {
		t.Fatal(err)
	}
	firstResult := first.wait(t)
	secondResult := second.wait(t)
	if firstResult.SessionID == "" || secondResult.SessionID == "" {
		t.Fatalf(
			"concurrent activations failed: A=%+v B=%+v",
			firstResult,
			secondResult,
		)
	}

	var activeDesktop []session.SessionRecord
	if err := database.Where(
		"user_id = ? AND device_type = ? AND revoked = ?",
		sharedAccessActorID,
		session.DeviceTypeDesktop,
		false,
	).Find(&activeDesktop).Error; err != nil {
		t.Fatal(err)
	}
	if len(activeDesktop) != 1 {
		t.Fatalf("active desktop sessions = %d, want one", len(activeDesktop))
	}
	var preservedWeb session.SessionRecord
	if err := database.Where("session_id = ?", web.SessionID).
		First(&preservedWeb).Error; err != nil {
		t.Fatal(err)
	}
	if preservedWeb.Revoked {
		t.Fatal("cross-class web session was revoked")
	}

	runSharedAccessProcess(
		t,
		dsn,
		"revoke-class",
		nil,
	)
	revoked := runSharedAccessProcess(
		t,
		dsn,
		"validate",
		map[string]string{
			"NCP_ACCESS_SESSION_ID": activeDesktop[0].SessionID,
		},
	)
	if revoked.Valid || revoked.Reason != "remote_logout" {
		t.Fatalf("remote revocation was not enforced: %+v", revoked)
	}

	if path := os.Getenv("NCP_ACCESS_RESULT_PATH"); path != "" {
		report := map[string]any{
			"artifactKind": "ncp-shared-access-process-result",
			"status":       "passed",
			"scenarios": map[string]any{
				"NCP-G05-ACK": map[string]any{
					"startedOn":           "access-node-a",
					"acknowledgedOn":      "access-node-b",
					"sessionIdStable":     true,
					"keyId":               prepared.KeyID,
					"idempotentReplay":    true,
					"keyMismatchRejected": true,
				},
				"NCP-G05-CLASS": map[string]any{
					"activeDesktopSessions": len(activeDesktop),
					"otherClassPreserved":   !preservedWeb.Revoked,
				},
				"NCP-G05-REVOKE": map[string]any{
					"revokedOn":  "access-node-b",
					"rejectedOn": "access-node-a",
					"reason":     revoked.Reason,
				},
			},
		}
		encoded, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, append(encoded, '\n'), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSharedAccessProcessHelper(t *testing.T) {
	role := os.Getenv("NCP_ACCESS_HELPER_ROLE")
	if role == "" {
		t.Skip("not a shared Access helper process")
	}
	dsn := os.Getenv("NCP_ACCESS_POSTGRES_DSN")
	if dsn == "" {
		t.Fatal("shared Access helper PostgreSQL DSN is missing")
	}
	database, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDatabase.Close()

	if role == "key-mismatch" {
		_, err := coreauth.OpenStationAccessKeyring(
			context.Background(),
			database,
			"different-station-access-secret-0123456789",
			"",
		)
		printSharedAccessResult(sharedAccessProcessResult{
			Role: role,
			MismatchRejected: errors.Is(
				err,
				coreauth.ErrStationAccessKeyringMismatch,
			),
		})
		return
	}

	initializeSharedAccessProcess(t, database)
	switch role {
	case "prepare-oauth":
		runSharedAccessPrepareHelper(t, database)
	case "acknowledge":
		runSharedAccessAcknowledgeHelper(t, database)
	case "activate-class":
		runSharedAccessActivationHelper(t, database)
	case "revoke-class":
		sessionStore := session.NewDBStore(
			func(context.Context) (*gorm.DB, error) {
				return database, nil
			},
			time.Hour,
		)
		if _, err := sessionStore.RevokeByUserAndDevice(
			context.Background(),
			sharedAccessActorID,
			session.DeviceTypeDesktop,
			"remote_logout",
		); err != nil {
			t.Fatal(err)
		}
		printSharedAccessResult(sharedAccessProcessResult{Role: role})
	case "validate":
		runSharedAccessValidationHelper(t)
	default:
		t.Fatalf("unknown shared Access helper role %q", role)
	}
}

func initializeSharedAccessProcess(t *testing.T, database *gorm.DB) {
	t.Helper()
	coreauth.Init(coreauth.Config{
		Secret:    sharedAccessSecret,
		AccessTTL: time.Hour,
	})
	if err := store.InjectStore(
		context.Background(),
		&sharedAccessProcessStore{database: database},
	); err != nil {
		t.Fatal(err)
	}
	stationPeerID, err := peer.Decode(sharedAccessStationPeerID)
	if err != nil {
		t.Fatal(err)
	}
	nativefed.SetLocalStationPeerID(stationPeerID)
	touchauth.InitSessionManager(context.Background())
}

func runSharedAccessPrepareHelper(t *testing.T, database *gorm.DB) {
	t.Helper()
	ctx := context.Background()
	decision, err := accessgate.StartAttempt(
		ctx,
		&accessgatepb.StartAccessAttemptRequest{
			StationUrl:    "https://station.test",
			StationPeerId: sharedAccessStationPeerID,
			Client: &accessgatepb.AccessGateClientInfo{
				Platform:            string(session.DeviceTypeDesktop),
				AppVersion:          "ncp-g05",
				DeviceId:            sharedAccessDeviceID,
				LifecycleGeneration: sharedAccessGeneration,
			},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if decision.GetState() !=
		accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_ACTION_REQUIRED {
		t.Fatalf("initial Access decision = %s", decision.GetState())
	}
	decision, err = accessgate.BindOAuthCandidate(
		ctx,
		decision.GetAttemptId(),
		sharedAccessStationPeerID,
		decision.GetCurrentGateId(),
		sharedAccessDeviceID,
		sharedAccessGeneration,
		&model.ActorRef{
			Ptid: sharedAccessActorPTID,
			Kind: model.ActorKind_ACTOR_KIND_PERSON,
		},
		"alice",
		"alice@example.test",
	)
	if err != nil {
		t.Fatal(err)
	}
	if decision.GetState() !=
		accessgatepb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED {
		t.Fatalf("OAuth-bound Access decision = %s", decision.GetState())
	}

	var accessAttempt dbmodel.AccessAttempt
	if err := database.Where("id = ?", decision.GetAttemptId()).
		First(&accessAttempt).Error; err != nil {
		t.Fatal(err)
	}
	liveBindingKey := oauthLiveBindingKey(
		accessAttempt.ID,
		sharedAccessDeviceID,
		sharedAccessGeneration,
	)
	secretHash := sha256.Sum256([]byte(sharedAccessAttemptSecret))
	oauthAttempt := dbmodel.OAuthAttempt{
		ID:                          sharedOAuthAttemptID,
		Provider:                    "github",
		StationPeerID:               sharedAccessStationPeerID,
		AccessAttemptID:             accessAttempt.ID,
		GateID:                      "auth.login",
		RedirectURI:                 "peers-touch://oauth/callback",
		PKCEChallenge:               "ncp-pkce",
		NonceHash:                   "ncp-nonce",
		StateHash:                   "ncp-state",
		DeviceID:                    sharedAccessDeviceID,
		LifecycleGeneration:         sharedAccessGeneration,
		AttemptSecretHash:           secretHash[:],
		CredentialDeliveryPublicKey: []byte("not-used-by-test-factory"),
		LiveBindingKey:              &liveBindingKey,
		State: int32(
			oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_SESSION_CANDIDATE_ISSUED,
		),
		Result: int32(
			oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_SESSION_CANDIDATE_ISSUED,
		),
		CandidateID: sharedOAuthCandidateID,
		ExpiresAt:   time.Now().UTC().Add(time.Hour),
	}
	candidate := dbmodel.OAuthSessionCandidate{
		ID:                  sharedOAuthCandidateID,
		OAuthAttemptID:      sharedOAuthAttemptID,
		AccessAttemptID:     accessAttempt.ID,
		StationPeerID:       sharedAccessStationPeerID,
		DeviceID:            sharedAccessDeviceID,
		LifecycleGeneration: sharedAccessGeneration,
		LiveBindingKey:      &liveBindingKey,
		ActorID:             sharedAccessActorID,
		ActorPTID:           sharedAccessActorPTID,
		ActorKind:           int32(model.ActorKind_ACTOR_KIND_PERSON),
		ActorUsername:       "alice",
		ActorEmail:          "alice@example.test",
		State:               candidateStateInactive,
		ExpiresAt:           time.Now().UTC().Add(time.Hour),
	}
	if err := database.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&oauthAttempt).Error; err != nil {
			return err
		}
		return tx.Create(&candidate).Error
	}); err != nil {
		t.Fatal(err)
	}

	keyring, err := coreauth.OpenStationAccessKeyring(
		ctx,
		database,
		sharedAccessSecret,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	provider := coreauth.NewJWTProvider(
		"unused-node-local-secret",
		time.Hour,
		coreauth.WithStationAccessKeyring(keyring),
	)
	var tokenValue string
	repository := newGormOAuthRepository(
		func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
	)
	snapshot, err := repository.FinalizeGranted(
		ctx,
		attemptBinding{
			AttemptID:           sharedOAuthAttemptID,
			StationPeerID:       sharedAccessStationPeerID,
			AccessAttemptID:     accessAttempt.ID,
			DeviceID:            sharedAccessDeviceID,
			LifecycleGeneration: sharedAccessGeneration,
			AttemptSecret:       []byte(sharedAccessAttemptSecret),
		},
		func(
			ctx context.Context,
			access *dbmodel.AccessAttempt,
			_ *dbmodel.OAuthAttempt,
			candidate *dbmodel.OAuthSessionCandidate,
		) (*finalizedCredential, error) {
			_, token, err := provider.Authenticate(
				ctx,
				coreauth.Credentials{
					SubjectID: sharedAccessActorPTID,
					SessionID: sharedOAuthSessionID,
				},
			)
			if err != nil {
				return nil, err
			}
			tokenValue = token.Value
			now := time.Now().UTC()
			return &finalizedCredential{
				Session: &session.SessionRecord{
					SessionID:              sharedOAuthSessionID,
					UserID:                 sharedAccessActorID,
					Email:                  candidate.ActorEmail,
					DeviceType:             session.DeviceTypeDesktop,
					OAuthCandidateID:       candidate.ID,
					AccessAttemptID:        access.ID,
					StationPeerID:          access.StationPeerID,
					AccessDecisionRevision: access.DecisionRevision,
					DeviceID:               sharedAccessDeviceID,
					LifecycleGeneration:    sharedAccessGeneration,
					AuthMethod:             "oauth",
					CreatedAt:              now,
					ExpiresAt:              now.Add(time.Hour),
					LastActiveAt:           now,
					Revoked:                true,
					RevokedReason:          "credential_delivery_pending",
				},
				Envelope: &dbmodel.OAuthCredentialEnvelope{
					CandidateID:              candidate.ID,
					SessionID:                sharedOAuthSessionID,
					StationPeerID:            sharedAccessStationPeerID,
					DeviceID:                 sharedAccessDeviceID,
					LifecycleGeneration:      sharedAccessGeneration,
					ServerEphemeralPublicKey: []byte("server-public"),
					Nonce:                    []byte("nonce"),
					Ciphertext:               []byte("ciphertext"),
					ExpiresAt:                now.Add(time.Hour),
				},
			}, nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Candidate.SessionID != sharedOAuthSessionID {
		t.Fatalf("finalized session = %q", snapshot.Candidate.SessionID)
	}
	currentKey, err := keyring.Current(ctx)
	if err != nil {
		t.Fatal(err)
	}
	credentialPath := os.Getenv("NCP_ACCESS_CREDENTIAL_PATH")
	if credentialPath == "" {
		t.Fatal("credential output path is required")
	}
	if err := os.WriteFile(
		credentialPath,
		[]byte(tokenValue),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	printSharedAccessResult(sharedAccessProcessResult{
		Role:      "prepare-oauth",
		SessionID: sharedOAuthSessionID,
		KeyID:     currentKey.ID,
	})
}

func runSharedAccessAcknowledgeHelper(t *testing.T, database *gorm.DB) {
	t.Helper()
	ctx := context.Background()
	var accessAttempt dbmodel.AccessAttempt
	if err := database.Order("created_at ASC").
		First(&accessAttempt).Error; err != nil {
		t.Fatal(err)
	}
	service := newStationOAuthService(
		func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
	)
	response, err := service.Acknowledge(
		ctx,
		&oauthpb.AcknowledgeOAuthCredentialRequest{
			OauthAttemptId:      sharedOAuthAttemptID,
			StationPeerId:       sharedAccessStationPeerID,
			AccessAttemptId:     accessAttempt.ID,
			AttemptSecret:       []byte(sharedAccessAttemptSecret),
			DeviceId:            sharedAccessDeviceID,
			LifecycleGeneration: sharedAccessGeneration,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	valid, reason := touchauth.ValidateSession(
		ctx,
		os.Getenv("NCP_ACCESS_SESSION_ID"),
	)
	provider := coreauth.NewJWTProvider(
		coreauth.Get().Secret,
		coreauth.Get().AccessTTL,
	)
	subject, tokenErr := provider.Validate(
		ctx,
		readSharedAccessCredential(t),
	)
	if tokenErr != nil {
		t.Fatal(tokenErr)
	}
	keyring, err := coreauth.OpenStationAccessKeyring(
		ctx,
		database,
		sharedAccessSecret,
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	currentKey, err := keyring.Current(ctx)
	if err != nil {
		t.Fatal(err)
	}
	printSharedAccessResult(sharedAccessProcessResult{
		Role:      "acknowledge",
		SessionID: subject.SessionID,
		KeyID:     currentKey.ID,
		Valid:     valid,
		Reason:    reason,
		Acknowledged: response.GetResult() ==
			oauthpb.OAuthAttemptResult_OAUTH_ATTEMPT_RESULT_ACCESS_GRANTED,
	})
}

func runSharedAccessActivationHelper(t *testing.T, database *gorm.DB) {
	t.Helper()
	barrier := os.Getenv("NCP_ACCESS_BARRIER")
	deadline := time.Now().Add(5 * time.Second)
	for {
		if _, err := os.Stat(barrier); err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("activation barrier timed out")
		}
		time.Sleep(5 * time.Millisecond)
	}
	sessionID := os.Getenv("NCP_ACCESS_SESSION_ID")
	now := time.Now().UTC()
	sessionStore := session.NewDBStore(
		func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
		time.Hour,
	)
	_, _, err := sessionStore.CreateWithKick(
		context.Background(),
		&session.Session{
			ID:        sessionID,
			UserID:    sharedAccessActorID,
			Email:     "alice@example.test",
			CreatedAt: now,
			ExpiresAt: now.Add(time.Hour),
			LastSeen:  now,
			Data: map[string]any{
				"station_peer_id":      sharedAccessStationPeerID,
				"device_id":            sessionID,
				"lifecycle_generation": sharedAccessGeneration,
				"auth_method":          "ncp-concurrent",
			},
		},
		session.DeviceTypeDesktop,
	)
	if err != nil {
		t.Fatal(err)
	}
	printSharedAccessResult(sharedAccessProcessResult{
		Role:      "activate-class",
		SessionID: sessionID,
	})
}

func runSharedAccessValidationHelper(t *testing.T) {
	t.Helper()
	ctx := context.Background()
	sessionID := os.Getenv("NCP_ACCESS_SESSION_ID")
	valid, reason := touchauth.ValidateSession(ctx, sessionID)
	token := readSharedAccessCredential(t)
	if token != "" {
		provider := coreauth.NewJWTProvider(
			coreauth.Get().Secret,
			coreauth.Get().AccessTTL,
		)
		subject, err := provider.Validate(ctx, token)
		if err != nil {
			t.Fatal(err)
		}
		if subject.SessionID != sessionID {
			t.Fatalf(
				"token session = %q, want %q",
				subject.SessionID,
				sessionID,
			)
		}
	}
	printSharedAccessResult(sharedAccessProcessResult{
		Role:      "validate",
		SessionID: sessionID,
		Valid:     valid,
		Reason:    reason,
	})
}

func readSharedAccessCredential(t *testing.T) string {
	t.Helper()
	path := os.Getenv("NCP_ACCESS_CREDENTIAL_PATH")
	if path == "" {
		return ""
	}
	encoded, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(encoded)
}

func prepareSharedAccessSchema(t *testing.T, database *gorm.DB) {
	t.Helper()
	ctx := context.Background()
	if err := database.AutoMigrate(
		&dbmodel.Actor{},
		&dbmodel.AccessPolicy{},
		&dbmodel.AccessAttempt{},
		&dbmodel.AccessGateSubmission{},
		&dbmodel.OAuthAttempt{},
		&dbmodel.OAuthSessionCandidate{},
		&dbmodel.OAuthCredentialEnvelope{},
	); err != nil {
		t.Fatal(err)
	}
	if err := coreauth.MigrateStationAccessKeyringSchema(
		ctx,
		database,
	); err != nil {
		t.Fatal(err)
	}
	sessionStore := session.NewDBStore(
		func(context.Context) (*gorm.DB, error) {
			return database, nil
		},
		time.Hour,
	)
	if err := sessionStore.AutoMigrate(ctx); err != nil {
		t.Fatal(err)
	}
	passwordHash, err := touchcrypto.HashPassword("1")
	if err != nil {
		t.Fatal(err)
	}
	if err := database.Create(&dbmodel.Actor{
		ID:                sharedAccessActorID,
		PTID:              sharedAccessActorPTID,
		Namespace:         "peers",
		PreferredUsername: "alice",
		Email:             "alice@example.test",
		PasswordHash:      passwordHash,
		Kind:              "p",
		Origin:            "local",
	}).Error; err != nil {
		t.Fatal(err)
	}
}

func openSharedAccessPostgres(
	t *testing.T,
) (*gorm.DB, string) {
	t.Helper()
	dsn := os.Getenv("NCP_ACCESS_POSTGRES_DSN")
	if dsn == "" {
		dsn = os.Getenv("MESSAGING_TEST_POSTGRES_DSN")
	}
	if dsn == "" {
		t.Skip("NCP_ACCESS_POSTGRES_DSN is not configured")
	}
	admin, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = adminSQL.Close()
	})

	schema := "shared_access_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec(
			`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`,
		).Error; err != nil {
			t.Errorf("drop shared Access schema: %v", err)
		}
	})
	isolatedDSN := sharedAccessDSNWithSearchPath(t, dsn, schema)
	database, err := gorm.Open(postgres.Open(isolatedDSN), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDatabase, err := database.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = sqlDatabase.Close()
	})
	return database, isolatedDSN
}

func sharedAccessDSNWithSearchPath(
	t *testing.T,
	dsn string,
	schema string,
) string {
	t.Helper()
	if strings.Contains(dsn, "://") {
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		return parsed.String()
	}
	return strings.TrimSpace(dsn) + " search_path=" + schema
}

type sharedAccessRunningProcess struct {
	command *exec.Cmd
	output  *strings.Builder
}

func startSharedAccessProcess(
	t *testing.T,
	dsn string,
	role string,
	extra map[string]string,
) *sharedAccessRunningProcess {
	t.Helper()
	command := exec.Command(
		os.Args[0],
		"-test.run=^TestSharedAccessProcessHelper$",
		"-test.count=1",
	)
	command.Env = sharedAccessProcessEnvironment(dsn, role, extra)
	var output strings.Builder
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	return &sharedAccessRunningProcess{
		command: command,
		output:  &output,
	}
}

func (p *sharedAccessRunningProcess) wait(
	t *testing.T,
) sharedAccessProcessResult {
	t.Helper()
	if err := p.command.Wait(); err != nil {
		t.Fatalf("shared Access helper failed: %v\n%s", err, p.output.String())
	}
	return parseSharedAccessResult(t, p.output.String())
}

func runSharedAccessProcess(
	t *testing.T,
	dsn string,
	role string,
	extra map[string]string,
) sharedAccessProcessResult {
	t.Helper()
	command := exec.Command(
		os.Args[0],
		"-test.run=^TestSharedAccessProcessHelper$",
		"-test.count=1",
	)
	command.Env = sharedAccessProcessEnvironment(dsn, role, extra)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("shared Access helper failed: %v\n%s", err, output)
	}
	return parseSharedAccessResult(t, string(output))
}

func sharedAccessProcessEnvironment(
	dsn string,
	role string,
	extra map[string]string,
) []string {
	environment := append(
		os.Environ(),
		"NCP_ACCESS_HELPER_ROLE="+role,
		"NCP_ACCESS_POSTGRES_DSN="+dsn,
	)
	for key, value := range extra {
		environment = append(environment, key+"="+value)
	}
	return environment
}

func printSharedAccessResult(result sharedAccessProcessResult) {
	encoded, err := json.Marshal(result)
	if err != nil {
		panic(err)
	}
	if _, err := fmt.Fprintf(os.Stdout, "NCP_ACCESS_RESULT %s\n", encoded); err != nil {
		panic(err)
	}
}

func parseSharedAccessResult(
	t *testing.T,
	output string,
) sharedAccessProcessResult {
	t.Helper()
	for _, line := range strings.Split(output, "\n") {
		if !strings.HasPrefix(line, "NCP_ACCESS_RESULT ") {
			continue
		}
		var result sharedAccessProcessResult
		if err := json.Unmarshal(
			[]byte(strings.TrimPrefix(line, "NCP_ACCESS_RESULT ")),
			&result,
		); err != nil {
			t.Fatal(err)
		}
		return result
	}
	t.Fatalf("shared Access helper emitted no result:\n%s", output)
	return sharedAccessProcessResult{}
}
