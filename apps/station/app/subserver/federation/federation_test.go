package federation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/subtle"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	federationpb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	modeldb "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(
		sqlite.Open("file:"+uuid.NewString()+"?mode=memory&cache=shared"),
		&gorm.Config{},
	)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}

	sqlDB, _ := db.DB()
	t.Cleanup(func() { sqlDB.Close() })

	if err := db.AutoMigrate(&modeldb.Actor{}); err != nil {
		t.Fatalf("migrate actor test database: %v", err)
	}
	if err := infrastructure.MigrateSchema(db); err != nil {
		t.Fatalf("migrate federation test database: %v", err)
	}

	return db
}

type staticStationSigningKeyProvider struct {
	key *domain.StationSigningKey
}

func (p *staticStationSigningKeyProvider) Current(
	context.Context,
) (*domain.StationSigningKey, error) {
	return &domain.StationSigningKey{
		PublicKey: append(
			ed25519.PublicKey(nil),
			p.key.PublicKey...,
		),
		PrivateKey: append(
			ed25519.PrivateKey(nil),
			p.key.PrivateKey...,
		),
	}, nil
}

func setupTestServices(t *testing.T) (*application.FederationService, *application.LedgerService, *infrastructure.Repos) {
	t.Helper()
	db := setupTestDB(t)
	repos := infrastructure.NewRepos(db)

	hashSvc := domain.NewHashService()
	sigSvc := domain.NewSignatureService()
	actorKeySvc := domain.NewActorKeyService(repos.ActorSigningKey)
	replaySvc := domain.NewReplayService(repos.LedgerEvent, hashSvc, sigSvc)

	policyRegistry := policy.NewRegistry()
	policyRegistry.Register(policy.SingleAdmin, policy.NewSingleAdminPolicy())
	stationPublicKey, stationPrivateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatalf("generate Station signing key: %v", err)
	}
	stationKeys := &staticStationSigningKeyProvider{
		key: &domain.StationSigningKey{
			PublicKey:  stationPublicKey,
			PrivateKey: stationPrivateKey,
		},
	}

	ledgerSvc := application.NewLedgerService(
		repos.Federation,
		repos.LedgerEvent,
		repos.LedgerCommitter,
		repos.Membership,
		stationKeys,
		hashSvc,
		sigSvc,
		policyRegistry,
	)

	fedSvc := application.NewFederationService(
		repos.Federation,
		repos.Membership,
		repos.ActorRole,
		ledgerSvc,
		actorKeySvc,
		stationKeys,
		replaySvc,
	)

	return fedSvc, ledgerSvc, repos
}

func TestResolveActiveStationURLUsesOneCanonicalOriginAcrossFederations(
	t *testing.T,
) {
	_, _, repos := setupTestServices(t)
	for _, federationID := range []string{"federation-a", "federation-b"} {
		if err := repos.Membership.Upsert(
			context.Background(),
			&domain.MembershipRecord{
				FederationID:  federationID,
				StationPeerID: "station-b",
				StationURL:    "http://station-b.example:18080/",
				Status:        "active",
			},
		); err != nil {
			t.Fatal(err)
		}
	}
	if err := repos.Membership.Upsert(
		context.Background(),
		&domain.MembershipRecord{
			FederationID:  "federation-stale",
			StationPeerID: "station-b",
			StationURL:    "",
			Status:        "active",
		},
	); err != nil {
		t.Fatal(err)
	}
	server := &subServer{membershipRepo: repos.Membership}

	origin, err := server.ResolveActiveStationURL(
		context.Background(),
		"station-b",
	)
	if err != nil {
		t.Fatal(err)
	}
	if origin != "http://station-b.example:18080" {
		t.Fatalf("origin = %q", origin)
	}
}

func TestResolveActiveStationURLRejectsConflictingActiveOrigins(t *testing.T) {
	_, _, repos := setupTestServices(t)
	for index, origin := range []string{
		"http://station-b.example:18080",
		"http://station-b-alt.example:18080",
	} {
		if err := repos.Membership.Upsert(
			context.Background(),
			&domain.MembershipRecord{
				FederationID:  fmt.Sprintf("federation-%d", index),
				StationPeerID: "station-b",
				StationURL:    origin,
				Status:        "active",
			},
		); err != nil {
			t.Fatal(err)
		}
	}
	server := &subServer{membershipRepo: repos.Membership}

	if _, err := server.ResolveActiveStationURL(
		context.Background(),
		"station-b",
	); err == nil {
		t.Fatal("conflicting active Station origins were accepted")
	}
}

func genesisStationPublicKey(
	t *testing.T,
	events []*federationpb.LedgerEvent,
) []byte {
	t.Helper()
	if len(events) == 0 || events[0] == nil {
		t.Fatal("genesis event is missing")
	}
	payload := &federationpb.FederationCreatedPayload{}
	if err := proto.Unmarshal(events[0].PayloadBytes, payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.CreatorStationPublicKey) != ed25519.PublicKeySize {
		t.Fatal("genesis Station signing key is invalid")
	}
	return append([]byte(nil), payload.CreatorStationPublicKey...)
}

func containsStation(stations []string, stationPeerID string) bool {
	for _, candidate := range stations {
		if candidate == stationPeerID {
			return true
		}
	}
	return false
}

func TestEnsureDefaultFederationIsIdempotent(t *testing.T) {
	ctx := context.Background()
	federationService, _, _ := setupTestServices(t)
	creator := defaultTestnetSeedConfig().Stations[0]

	input := func() *application.EnsureDefaultFederationInput {
		return &application.EnsureDefaultFederationInput{
			StationPeerID:    creator.PeerID,
			StationName:      creator.Name,
			StationURL:       creator.URL,
			FounderActorPTID: creator.ActorPTID,
		}
	}

	first, created, err := federationService.EnsureDefaultFederation(ctx, input())
	if err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	if !created {
		t.Fatal("first ensure must create the default federation")
	}
	if first == nil || first.Status != "active" {
		t.Fatalf("default federation must be active, got %+v", first)
	}
	if first.Name != application.DefaultFederationName {
		t.Fatalf("default federation name = %q, want %q", first.Name, application.DefaultFederationName)
	}
	if first.SequencerStationPeerID != creator.PeerID {
		t.Fatalf("sequencer = %q, want local station %q", first.SequencerStationPeerID, creator.PeerID)
	}
	if first.CreatedByActorPTID != creator.ActorPTID {
		t.Fatalf("founder = %q, want %q", first.CreatedByActorPTID, creator.ActorPTID)
	}

	second, createdAgain, err := federationService.EnsureDefaultFederation(ctx, input())
	if err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if createdAgain {
		t.Fatal("second ensure must not create another federation")
	}
	if second == nil || second.FederationID != first.FederationID {
		t.Fatalf("idempotent ensure must return the same federation: first=%v second=%v", first, second)
	}

	if _, _, err := federationService.EnsureDefaultFederation(ctx, &application.EnsureDefaultFederationInput{
		StationPeerID:    creator.PeerID,
		StationName:      creator.Name,
		StationURL:       creator.URL,
		FounderActorPTID: " ",
	}); err == nil {
		t.Fatal("empty founder must be rejected")
	}
}

func TestGenesisSeparatesActorAndStationSigningKeys(t *testing.T) {
	ctx := context.Background()
	federationService, ledgerService, _ := setupTestServices(t)
	creator := defaultTestnetSeedConfig().Stations[0]
	federation, err := federationService.CreateFederation(
		ctx,
		&application.CreateFederationInput{
			Name:                 "Distinct signing owners",
			PolicyType:           "single_admin",
			ActorPTID:            creator.ActorPTID,
			ActorFederatedHandle: creator.FederatedHandle,
			StationPeerID:        creator.PeerID,
			StationName:          creator.Name,
			StationURL:           creator.URL,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	events, err := ledgerService.FetchEvents(
		ctx,
		federation.FederationID,
		0,
		1,
	)
	if err != nil || len(events) != 1 {
		t.Fatalf("genesis events=%d err=%v", len(events), err)
	}
	event := events[0]
	genesis := &federationpb.FederationCreatedPayload{}
	if err := proto.Unmarshal(event.PayloadBytes, genesis); err != nil {
		t.Fatal(err)
	}
	if bytes.Equal(
		genesis.CreatorActorSigningPublicKey,
		genesis.CreatorStationPublicKey,
	) {
		t.Fatal("Actor and Station signing keys share one authority")
	}

	signatures := domain.NewSignatureService()
	actorInput := &federationpb.ActorSignatureInput{
		FederationId:         event.FederationId,
		ActorPtid:            event.ActorPtid,
		ActorFederatedHandle: event.ActorFederatedHandle,
		EventTypeName:        event.EventType.String(),
		PayloadHash:          event.PayloadHash,
		TimestampUnixMs:      event.CreatedAtUnixMs,
	}
	stationInput := &federationpb.StationSignatureInput{
		FederationId:  event.FederationId,
		StationPeerId: event.StationPeerId,
		EventTypeName: event.EventType.String(),
		PayloadHash:   event.PayloadHash,
		Seq:           event.Seq,
		PrevHash:      event.PrevHash,
		EventHash:     event.EventHash,
	}
	sequencerInput := &federationpb.SequencerSignatureInput{
		FederationId: event.FederationId,
		Seq:          event.Seq,
		EventHash:    event.EventHash,
	}
	actorPublicKey := ed25519.PublicKey(
		genesis.CreatorActorSigningPublicKey,
	)
	stationPublicKey := ed25519.PublicKey(
		genesis.CreatorStationPublicKey,
	)
	if err := signatures.VerifyActor(
		actorPublicKey,
		actorInput,
		event.ActorSignature,
	); err != nil {
		t.Fatal(err)
	}
	if err := signatures.VerifyStation(
		stationPublicKey,
		stationInput,
		event.StationSignature,
	); err != nil {
		t.Fatal(err)
	}
	if err := signatures.VerifySequencer(
		stationPublicKey,
		sequencerInput,
		event.SequencerSignature,
	); err != nil {
		t.Fatal(err)
	}
	if err := signatures.VerifyStation(
		actorPublicKey,
		stationInput,
		event.StationSignature,
	); err == nil {
		t.Fatal("Station signature verified with the Actor key")
	}
	if err := signatures.VerifyActor(
		stationPublicKey,
		actorInput,
		event.ActorSignature,
	); err == nil {
		t.Fatal("Actor signature verified with the Station key")
	}
}

func TestActorSigningKeyRemainsStableAcrossFederationCreation(t *testing.T) {
	ctx := context.Background()
	federationService, ledgerService, _ := setupTestServices(t)
	creator := defaultTestnetSeedConfig().Stations[0]
	create := func(name string) *domain.FederationRecord {
		t.Helper()
		federation, err := federationService.CreateFederation(
			ctx,
			&application.CreateFederationInput{
				Name:                 name,
				PolicyType:           "single_admin",
				ActorPTID:            creator.ActorPTID,
				ActorFederatedHandle: creator.FederatedHandle,
				StationPeerID:        creator.PeerID,
				StationName:          creator.Name,
				StationURL:           creator.URL,
			},
		)
		if err != nil {
			t.Fatal(err)
		}
		return federation
	}
	first := create("First Federation")
	_ = create("Second Federation")
	if _, err := federationService.ApproveJoinAsSequencer(
		ctx,
		first.FederationID,
		"node-b",
		"Node B",
		"http://node-b.test",
	); err != nil {
		t.Fatal(err)
	}
	events, err := ledgerService.FetchAllEvents(ctx, first.FederationID)
	if err != nil {
		t.Fatal(err)
	}
	if err := ledgerService.ValidateBootstrapEvents(
		first.FederationID,
		events,
	); err != nil {
		t.Fatalf("first Federation chain became unverifiable: %v", err)
	}
}

func TestFederationContextsExposeOnlyClientScope(t *testing.T) {
	contexts := federationContexts(&federationpb.ListFederationsResponse{
		Federations: []*federationpb.FederationSummary{
			nil,
			{
				FederationId:           "federation-1",
				Name:                   "Development",
				Status:                 "active",
				PolicyType:             "single_admin",
				HeadSeq:                42,
				MemberStationCount:     3,
				SequencerStationPeerId: "station-admin",
				MyRole:                 "admin",
				Capability: &federationpb.ActorCapability{
					CanInvite: true,
				},
			},
			{
				FederationId: "federation-archived",
				Name:         "Archived",
				Status:       "archived",
			},
		},
	})

	if len(contexts.Contexts) != 1 {
		t.Fatalf("contexts = %d, want 1", len(contexts.Contexts))
	}
	context := contexts.Contexts[0]
	if context.FederationId != "federation-1" ||
		context.Name != "Development" ||
		context.Status != "active" {
		t.Fatalf("context = %+v", context)
	}
}

func TestMemberProposalRequiresAuthenticatedStationIdentity(t *testing.T) {
	_, err := (&subServer{}).handleSubmitProposal(
		context.Background(),
		&federationpb.SubmitProposalRequest{
			FederationId:      "federation-1",
			ProposedEventType: federationpb.EventType_STATION_LEFT,
			StationPeerId:     "station-five-arm",
		},
	)
	var handlerError *server.HandlerError
	if !errors.As(err, &handlerError) {
		t.Fatalf("member proposal error=%v, want HandlerError", err)
	}
	if handlerError.Code != http.StatusUnauthorized {
		t.Fatalf(
			"member proposal status=%d want=%d",
			handlerError.Code,
			http.StatusUnauthorized,
		)
	}
}

func TestStationGovernanceRequiresTheInitialOwnerRole(t *testing.T) {
	db := setupTestDB(t)
	for _, actor := range []modeldb.Actor{
		{
			PTID:              "ptid:test:owner",
			Namespace:         "peers",
			PreferredUsername: "owner",
			Email:             "owner@test.invalid",
			PasswordHash:      "hash",
			Origin:            "local",
			FederatedHandle:   "@owner@test.invalid",
		},
		{
			PTID:              "ptid:test:member",
			Namespace:         "peers",
			PreferredUsername: "member",
			Email:             "member@test.invalid",
			PasswordHash:      "hash",
			Origin:            "local",
			FederatedHandle:   "@member@test.invalid",
		},
	} {
		if err := db.Create(&actor).Error; err != nil {
			t.Fatal(err)
		}
	}
	repos := infrastructure.NewRepos(db)
	subserver := &subServer{stationRoleRepo: repos.StationRole}
	owner, err := subserver.requireStationGovernance(
		coreauth.WithSubject(
			context.Background(),
			&coreauth.Subject{ID: "ptid:test:owner"},
		),
	)
	if err != nil || owner.ID != "ptid:test:owner" {
		t.Fatalf("initial owner authorization subject=%+v err=%v", owner, err)
	}
	_, err = subserver.requireStationGovernance(
		coreauth.WithSubject(
			context.Background(),
			&coreauth.Subject{ID: "ptid:test:member"},
		),
	)
	var handlerError *server.HandlerError
	if !errors.As(err, &handlerError) {
		t.Fatalf("member authorization error=%v, want HandlerError", err)
	}
	if handlerError.Code != http.StatusForbidden {
		t.Fatalf(
			"member authorization status=%d want=%d",
			handlerError.Code,
			http.StatusForbidden,
		)
	}
}

func TestFederationResolveViewUsesCanonicalHandleAndContext(t *testing.T) {
	for _, handle := range []string{
		"alice@station.example",
		"@alice@station.example",
	} {
		view := federationResolveView(
			"federation-1",
			&resolver.Resolved{
				Envelope: &profilepb.ActorProfileEnvelope{
					FederatedHandle: handle,
				},
				Locator: &locatorpb.ActorLocatorRecord{Seq: 74},
			},
		)
		if got, want := view.GetFederatedHandle(), "@alice@station.example"; got != want {
			t.Fatalf("resolve handle = %q, want %q", got, want)
		}
		if got := view.GetFederationId(); got != "federation-1" {
			t.Fatalf("resolve Federation context = %q", got)
		}
	}
}

func TestSeedTestnet_CreatesAndReplaysConsistently(t *testing.T) {
	ctx := context.Background()
	fedSvc, ledgerSvc, repos := setupTestServices(t)

	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, fedSvc, ledgerSvc); err != nil {
		t.Fatalf("seedTestnet failed: %v", err)
	}

	feds, err := repos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatalf("ListByStation failed: %v", err)
	}
	if len(feds) != 1 {
		t.Fatalf("expected 1 federation, got %d", len(feds))
	}

	fed := feds[0]
	if fed.Name != "Peers Testnet" {
		t.Errorf("expected name 'Peers Testnet', got '%s'", fed.Name)
	}
	if fed.Status != "active" {
		t.Errorf("expected status 'active', got '%s'", fed.Status)
	}

	state, err := fedSvc.Replay(ctx, fed.FederationID)
	if err != nil {
		t.Fatalf("Replay failed: %v", err)
	}

	if state.HeadSeq != 2 {
		t.Errorf("expected head_seq=2 (3 events), got %d", state.HeadSeq)
	}

	if len(state.ActiveMemberStations) != 3 {
		t.Errorf("expected 3 active stations, got %d: %v", len(state.ActiveMemberStations), state.ActiveMemberStations)
	}

	if subtle.ConstantTimeCompare(state.HeadHash, fed.HeadHash) != 1 {
		t.Errorf("replay head_hash does not match federation record head_hash")
	}

	if state.SequencerStationPeerID != "node-a" {
		t.Errorf("expected sequencer 'node-a', got '%s'", state.SequencerStationPeerID)
	}

	t.Logf("federation_id=%s, head_seq=%d, members=%d, sequencer=%s",
		fed.FederationID, state.HeadSeq, len(state.ActiveMemberStations), state.SequencerStationPeerID)
}

func TestNonSequencerAppendRejected(t *testing.T) {
	ctx := context.Background()
	fedSvc, ledgerSvc, repos := setupTestServices(t)

	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, fedSvc, ledgerSvc); err != nil {
		t.Fatalf("seedTestnet failed: %v", err)
	}

	feds, err := repos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatalf("ListByStation failed: %v", err)
	}
	fed := feds[0]

	_, err = ledgerSvc.AppendEvent(ctx, &application.AppendEventInput{
		FederationID:         fed.FederationID,
		EventType:            4,
		PayloadBytes:         []byte("test"),
		ActorPTID:            "ptid:v1:actor:peers:p:b",
		ActorFederatedHandle: "@b@two.peers.touch",
		StationPeerID:        "node-b",
	})

	if err == nil {
		t.Fatal("expected error for non-sequencer append, got nil")
	}

	t.Logf("correctly rejected non-sequencer append: %v", err)
}

func TestSequencerCannotLeaveWithoutHandover(t *testing.T) {
	ctx := context.Background()
	fedSvc, ledgerSvc, repos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, fedSvc, ledgerSvc); err != nil {
		t.Fatal(err)
	}
	federations, err := repos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("federations=%d err=%v", len(federations), err)
	}
	_, actorPrivateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	err = fedSvc.LeaveFederation(
		ctx,
		&application.LeaveFederationInput{
			FederationID:         federations[0].FederationID,
			ActorPTID:            cfg.Stations[0].ActorPTID,
			ActorFederatedHandle: cfg.Stations[0].FederatedHandle,
			StationPeerID:        cfg.Stations[0].PeerID,
			Reason:               "must hand over",
			ActorPrivateKey:      actorPrivateKey,
		},
	)
	if err == nil {
		t.Fatal("sequencer leave without handover was accepted")
	}
}

func TestLedgerProjectionCommitRollsBackEventAndHeadTogether(t *testing.T) {
	ctx := context.Background()
	fedSvc, ledgerSvc, repos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	creator := cfg.Stations[0]
	federation, err := fedSvc.CreateFederation(
		ctx,
		&application.CreateFederationInput{
			Name:                 cfg.FederationName,
			Description:          "transaction proof",
			PolicyType:           "single_admin",
			ActorPTID:            creator.ActorPTID,
			ActorFederatedHandle: creator.FederatedHandle,
			StationPeerID:        creator.PeerID,
			StationName:          creator.Name,
			StationURL:           creator.URL,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, actorPrivateKey, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(
		&federationpb.StationLeftPayload{
			LeavingStationPeerId: "missing-station",
			LeavingActorPtid:     creator.ActorPTID,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ledgerSvc.AppendEventWithProjection(
		ctx,
		&application.AppendEventInput{
			FederationID:         federation.FederationID,
			EventType:            federationpb.EventType_STATION_LEFT,
			PayloadBytes:         payload,
			ActorPTID:            creator.ActorPTID,
			ActorFederatedHandle: creator.FederatedHandle,
			StationPeerID:        creator.PeerID,
			ActorPrivateKey:      actorPrivateKey,
		},
		domain.LedgerProjectionMutation{
			MembershipStationPeerID: "missing-station",
			MembershipStatus:        "left",
		},
	)
	if err == nil {
		t.Fatal("missing membership projection unexpectedly committed")
	}
	events, err := ledgerSvc.FetchAllEvents(ctx, federation.FederationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 {
		t.Fatalf("rolled-back ledger has %d events, want 1", len(events))
	}
	stored, err := repos.Federation.GetByID(ctx, federation.FederationID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.HeadSeq != 0 {
		t.Fatalf("rolled-back head=%d want=0", stored.HeadSeq)
	}
}

func TestBootstrapReplicaMaterializesCanonicalLedgerAndStationURLs(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	federationID := federations[0].FederationID
	events, err := authorityLedger.FetchEvents(ctx, federationID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}

	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:                   federationID,
			LocalActorPTID:                 "ptid:v1:actor:peers:p:b",
			LocalStationPeerID:             "node-b",
			ExpectedSequencerStationPeerID: "node-a",
			ExpectedSequencerStationPublicKey: genesisStationPublicKey(
				t,
				events,
			),
			Events: events,
		},
	); err != nil {
		t.Fatal(err)
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "node-b")
	if err != nil || len(replicaFederations) != 1 {
		t.Fatalf("replica federations=%d err=%v", len(replicaFederations), err)
	}
	if replicaFederations[0].HeadSeq != 2 {
		t.Fatalf("replica head=%d want=2", replicaFederations[0].HeadSeq)
	}
	members, err := replicaRepos.Membership.ListByFederation(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 3 {
		t.Fatalf("replica member count=%d want=3", len(members))
	}
	for _, member := range members {
		if member.StationURL == "" {
			t.Fatalf("member %s lost Station URL", member.StationPeerID)
		}
	}
}

func TestBootstrapReplicaExtendsCanonicalLedgerAfterLeaveAndRejoin(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	federationID := federations[0].FederationID
	nodeB := cfg.Stations[1]
	initialEvents, err := authorityLedger.FetchEvents(
		ctx,
		federationID,
		0,
		100,
	)
	if err != nil {
		t.Fatal(err)
	}
	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:                   federationID,
			LocalActorPTID:                 nodeB.ActorPTID,
			LocalStationPeerID:             nodeB.PeerID,
			ExpectedSequencerStationPeerID: cfg.Stations[0].PeerID,
			ExpectedSequencerStationPublicKey: genesisStationPublicKey(
				t,
				initialEvents,
			),
			Events: initialEvents,
		},
	); err != nil {
		t.Fatal(err)
	}

	if _, err := authority.ApproveLeaveAsSequencer(
		ctx,
		federationID,
		nodeB.ActorPTID,
		nodeB.FederatedHandle,
		nodeB.PeerID,
		"test leave",
	); err != nil {
		t.Fatal(err)
	}
	leftState, err := authority.Replay(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if containsStation(leftState.ActiveMemberStations, nodeB.PeerID) ||
		!containsStation(
			leftState.ActiveMemberStations,
			cfg.Stations[0].PeerID,
		) {
		t.Fatalf(
			"leave replay projected active members %v",
			leftState.ActiveMemberStations,
		)
	}
	if _, err := authority.ApproveJoinAsSequencer(
		ctx,
		federationID,
		nodeB.PeerID,
		nodeB.Name,
		nodeB.URL,
	); err != nil {
		t.Fatal(err)
	}
	rejoinedState, err := authority.Replay(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if !containsStation(rejoinedState.ActiveMemberStations, nodeB.PeerID) {
		t.Fatalf(
			"rejoin replay projected active members %v",
			rejoinedState.ActiveMemberStations,
		)
	}
	rejoinedEvents, err := authorityLedger.FetchEvents(
		ctx,
		federationID,
		0,
		100,
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:                   federationID,
			LocalActorPTID:                 nodeB.ActorPTID,
			LocalStationPeerID:             nodeB.PeerID,
			ExpectedSequencerStationPeerID: cfg.Stations[0].PeerID,
			ExpectedSequencerStationPublicKey: genesisStationPublicKey(
				t,
				rejoinedEvents,
			),
			Events: rejoinedEvents,
		},
	); err != nil {
		t.Fatal(err)
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(
		ctx,
		nodeB.PeerID,
	)
	if err != nil || len(replicaFederations) != 1 {
		t.Fatalf("replica federations=%d err=%v", len(replicaFederations), err)
	}
	if got, want := replicaFederations[0].HeadSeq, uint64(len(rejoinedEvents)-1); got != want {
		t.Fatalf("replica head=%d want=%d", got, want)
	}
	membership, err := replicaRepos.Membership.GetByStation(
		ctx,
		federationID,
		nodeB.PeerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if membership == nil || membership.Status != "active" {
		t.Fatalf("rejoined membership=%+v", membership)
	}
}

func TestBootstrapReplicaRejectsForgedLedgerBeforeMembershipWrites(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	events, err := authorityLedger.FetchEvents(
		ctx,
		federations[0].FederationID,
		0,
		100,
	)
	if err != nil {
		t.Fatal(err)
	}
	forged := make([]*federationpb.LedgerEvent, len(events))
	for index, event := range events {
		forged[index] = proto.Clone(event).(*federationpb.LedgerEvent)
	}
	forged[1].PayloadBytes[0] ^= 0xff

	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:                   federations[0].FederationID,
			LocalActorPTID:                 "ptid:v1:actor:peers:p:b",
			LocalStationPeerID:             "node-b",
			ExpectedSequencerStationPeerID: "node-a",
			ExpectedSequencerStationPublicKey: genesisStationPublicKey(
				t,
				events,
			),
			Events: forged,
		},
	); err == nil {
		t.Fatal("forged bootstrap ledger was accepted")
	}
	members, err := replicaRepos.Membership.ListByFederation(
		ctx,
		federations[0].FederationID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 0 {
		t.Fatalf("forged bootstrap wrote %d memberships", len(members))
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(replicaFederations) != 0 {
		t.Fatalf("forged bootstrap wrote %d Federation records", len(replicaFederations))
	}
}

func TestBootstrapReplicaRejectsGenesisKeyOutsideSignedStationIdentity(
	t *testing.T,
) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(
		t,
		ctx,
		cfg,
		authority,
		authorityLedger,
	); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	events, err := authorityLedger.FetchEvents(
		ctx,
		federations[0].FederationID,
		0,
		100,
	)
	if err != nil {
		t.Fatal(err)
	}
	untrustedPublicKey, _, err := ed25519.GenerateKey(nil)
	if err != nil {
		t.Fatal(err)
	}
	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:                      federations[0].FederationID,
			LocalActorPTID:                    cfg.Stations[1].ActorPTID,
			LocalStationPeerID:                cfg.Stations[1].PeerID,
			ExpectedSequencerStationPeerID:    cfg.Stations[0].PeerID,
			ExpectedSequencerStationPublicKey: untrustedPublicKey,
			Events:                            events,
		},
	); err == nil {
		t.Fatal("self-declared genesis Station key was accepted")
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(replicaFederations) != 0 {
		t.Fatalf(
			"untrusted genesis wrote %d Federation records",
			len(replicaFederations),
		)
	}
}

func TestRemoteEventAdvancesHeadAndMembershipProjectionTogether(t *testing.T) {
	ctx := context.Background()
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	cfg := defaultTestnetSeedConfig()
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	federationID := federations[0].FederationID
	events, err := authorityLedger.FetchEvents(ctx, federationID, 0, 100)
	if err != nil || len(events) != 3 {
		t.Fatalf("authority events=%d err=%v", len(events), err)
	}

	replica, replicaLedger, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:                   federationID,
			LocalActorPTID:                 "ptid:v1:actor:peers:p:b",
			LocalStationPeerID:             "node-b",
			ExpectedSequencerStationPeerID: "node-a",
			ExpectedSequencerStationPublicKey: genesisStationPublicKey(
				t,
				events,
			),
			Events: events[:2],
		},
	); err != nil {
		t.Fatal(err)
	}
	manager := NewLedgerSyncManager(
		replicaLedger,
		replicaRepos.Federation,
		replicaRepos.LedgerEvent,
		replicaRepos.SyncCursor,
		replicaRepos.Membership,
		NewLedgerEventPublisher(replicaRepos.ActorRole),
		nil,
		"node-b",
	)
	if err := manager.ApplyRemoteEvent(ctx, events[2]); err != nil {
		t.Fatal(err)
	}
	members, err := replicaRepos.Membership.ListByFederation(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if len(members) != 3 {
		t.Fatalf("membership projection count=%d want=3", len(members))
	}
	replicaFederations, err := replicaRepos.Federation.ListByStation(ctx, "node-b")
	if err != nil || len(replicaFederations) != 1 {
		t.Fatalf("replica federations=%d err=%v", len(replicaFederations), err)
	}
	if replicaFederations[0].HeadSeq != 2 {
		t.Fatalf("replica head=%d want=2", replicaFederations[0].HeadSeq)
	}
}
