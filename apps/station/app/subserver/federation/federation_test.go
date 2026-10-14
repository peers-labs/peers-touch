package federation

import (
	"context"
	"crypto/subtle"
	"testing"

	"github.com/google/uuid"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/application"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/domain/policy"
	"github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	federationpb "github.com/peers-labs/peers-touch/station/app/subserver/federation/pb"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	coreclient "github.com/peers-labs/peers-touch/station/frame/core/client"
	"github.com/peers-labs/peers-touch/station/frame/core/node"
	coreoption "github.com/peers-labs/peers-touch/station/frame/core/option"
	nativefed "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation"
	locatorpb "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/federation/locator/pb"
	coreserver "github.com/peers-labs/peers-touch/station/frame/core/server"
	profilepb "github.com/peers-labs/peers-touch/station/frame/touch/federation/profile/pb"
	"github.com/peers-labs/peers-touch/station/frame/touch/federation/resolver"
	"google.golang.org/protobuf/proto"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type federationTestNode struct{}

func (federationTestNode) Name() string { return "federation-test-node" }

func (federationTestNode) Init(context.Context, ...coreoption.Option) error { return nil }

func (federationTestNode) Options() *node.Options { return &node.Options{} }

func (federationTestNode) Client() coreclient.Client { return nil }

func (federationTestNode) Server() coreserver.Server { return nil }

func (federationTestNode) Run() error { return nil }

type governanceClientFunc func(
	ctx context.Context,
	endpoint string,
	targetPeerID string,
	req *federationpb.SubmitProposalRequest,
) (*federationpb.SubmitProposalResponse, error)

func (f governanceClientFunc) SubmitProposal(
	ctx context.Context,
	endpoint string,
	targetPeerID string,
	req *federationpb.SubmitProposalRequest,
) (*federationpb.SubmitProposalResponse, error) {
	return f(ctx, endpoint, targetPeerID, req)
}

type repositoryLedgerFetcher struct {
	federationRepo domain.FederationRepository
	ledgerSvc      *application.LedgerService
}

func (f *repositoryLedgerFetcher) FetchHead(
	ctx context.Context,
	_ string,
	_ string,
	federationID string,
) ([]byte, uint64, error) {
	fed, err := f.federationRepo.GetByID(ctx, federationID)
	if err != nil || fed == nil {
		return nil, 0, err
	}
	return fed.HeadHash, fed.HeadSeq, nil
}

func (f *repositoryLedgerFetcher) FetchEvents(
	ctx context.Context,
	_ string,
	_ string,
	federationID string,
	fromSeq uint64,
	limit uint32,
) ([]*federationpb.LedgerEvent, error) {
	return f.ledgerSvc.FetchEvents(ctx, federationID, fromSeq, limit)
}

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

	if err := infrastructure.MigrateSchema(db); err != nil {
		t.Fatalf("migrate federation test database: %v", err)
	}

	return db
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

	ledgerSvc := application.NewLedgerService(
		repos.Federation,
		repos.LedgerEvent,
		repos.Membership,
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
		replaySvc,
	)

	return fedSvc, ledgerSvc, repos
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
	}, true)

	if len(contexts.Contexts) != 1 {
		t.Fatalf("contexts = %d, want 1", len(contexts.Contexts))
	}
	context := contexts.Contexts[0]
	if context.FederationId != "federation-1" ||
		context.Name != "Development" ||
		context.Status != "active" ||
		!context.LocalDirectoryEnabled {
		t.Fatalf("context = %+v", context)
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
			FederationID:       federationID,
			LocalActorPTID:     "ptid:v1:actor:peers:p:b",
			LocalStationPeerID: "node-b",
			Events:             events,
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
	forged[1].EventHash[0] ^= 0xff

	replica, _, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:       federations[0].FederationID,
			LocalActorPTID:     "ptid:v1:actor:peers:p:b",
			LocalStationPeerID: "node-b",
			Events:             forged,
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
			FederationID:       federationID,
			LocalActorPTID:     "ptid:v1:actor:peers:p:b",
			LocalStationPeerID: "node-b",
			Events:             events[:2],
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
		domain.NewHashService(),
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

func TestRemoteJoinPinsSequencerStationIdentity(t *testing.T) {
	abstractNode := &node.AbstractService{}
	abstractNode.Finish(federationTestNode{})
	ctx := coreauth.WithSubject(context.Background(), &coreauth.Subject{
		ID: "ptid:joining-actor",
	})
	federationSvc, _, repos := setupTestServices(t)

	previousIdentity := nativefed.LocalIdentitySnapshot()
	nativefed.SetLocalStationPeerID(peer.ID("joining-station"))
	nativefed.SetLocalStationDomain("joining.invalid")
	t.Cleanup(func() {
		nativefed.SetLocalStationPeerID(previousIdentity.StationPeerID)
		nativefed.SetLocalStationDomain(previousIdentity.StationDomain)
	})

	var submittedTarget string
	server := &subServer{
		federationSvc: federationSvc,
		actorKeySvc:   domain.NewActorKeyService(repos.ActorSigningKey),
		govClient: governanceClientFunc(func(
			_ context.Context,
			_ string,
			targetPeerID string,
			_ *federationpb.SubmitProposalRequest,
		) (*federationpb.SubmitProposalResponse, error) {
			submittedTarget = targetPeerID
			return &federationpb.SubmitProposalResponse{
				Decision: federationpb.ProposalDecision_DECISION_PENDING,
			}, nil
		}),
	}

	if _, err := server.handleJoinFederation(ctx, &federationpb.JoinFederationRequest{
		FederationEndpoint:     "https://sequencer.invalid",
		FederationId:           "federation-remote",
		SequencerStationPeerId: "sequencer-station",
	}); err != nil {
		t.Fatal(err)
	}
	if submittedTarget != "sequencer-station" {
		t.Fatalf("proposal target=%q want=%q", submittedTarget, "sequencer-station")
	}

	submittedTarget = ""
	if _, err := server.handleJoinFederation(ctx, &federationpb.JoinFederationRequest{
		FederationEndpoint: "https://sequencer.invalid",
		FederationId:       "federation-remote",
	}); err == nil {
		t.Fatal("remote join without sequencer Station identity was accepted")
	}
	if submittedTarget != "" {
		t.Fatalf("proposal submitted without pinned target: %q", submittedTarget)
	}
}

func TestMemberLeaveUsesSequencerProposalAndConvergesLocally(t *testing.T) {
	ctx := context.Background()
	cfg := defaultTestnetSeedConfig()
	testPeerIDs := []peer.ID{
		peer.ID("test-node-a"),
		peer.ID("test-node-b"),
		peer.ID("test-node-c"),
	}
	for index := range cfg.Stations {
		cfg.Stations[index].PeerID = testPeerIDs[index].String()
	}
	authority, authorityLedger, authorityRepos := setupTestServices(t)
	if err := seedTestnet(t, ctx, cfg, authority, authorityLedger); err != nil {
		t.Fatal(err)
	}
	federations, err := authorityRepos.Federation.ListByStation(ctx, "")
	if err != nil || len(federations) != 1 {
		t.Fatalf("authority federations=%d err=%v", len(federations), err)
	}
	federationID := federations[0].FederationID
	leavingStation := cfg.Stations[1]
	if err := authorityRepos.Membership.Upsert(ctx, &domain.MembershipRecord{
		FederationID:  federationID,
		StationPeerID: leavingStation.PeerID,
		StationName:   leavingStation.Name,
		StationURL:    leavingStation.URL,
		Role:          "member_station",
		Status:        "active",
	}); err != nil {
		t.Fatal(err)
	}

	bootstrapEvents, err := authorityLedger.FetchEvents(ctx, federationID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	replica, replicaLedger, replicaRepos := setupTestServices(t)
	if err := replica.BootstrapReplica(
		ctx,
		&application.BootstrapFederationReplicaInput{
			FederationID:       federationID,
			LocalActorPTID:     leavingStation.ActorPTID,
			LocalStationPeerID: leavingStation.PeerID,
			Events:             bootstrapEvents,
		},
	); err != nil {
		t.Fatal(err)
	}

	previousIdentity := nativefed.LocalIdentitySnapshot()
	nativefed.SetLocalStationPeerID(testPeerIDs[1])
	nativefed.SetLocalStationDomain("localhost:18081")
	t.Cleanup(func() {
		nativefed.SetLocalStationPeerID(previousIdentity.StationPeerID)
		nativefed.SetLocalStationDomain(previousIdentity.StationDomain)
	})

	authoritySubserver := &subServer{
		federationSvc:  authority,
		ledgerSvc:      authorityLedger,
		membershipRepo: authorityRepos.Membership,
		actorKeySvc:    domain.NewActorKeyService(authorityRepos.ActorSigningKey),
	}
	var submitted *federationpb.SubmitProposalRequest
	governanceClient := governanceClientFunc(func(
		callCtx context.Context,
		endpoint string,
		targetPeerID string,
		req *federationpb.SubmitProposalRequest,
	) (*federationpb.SubmitProposalResponse, error) {
		if endpoint != cfg.Stations[0].URL {
			t.Fatalf("proposal endpoint=%q want=%q", endpoint, cfg.Stations[0].URL)
		}
		if targetPeerID != cfg.Stations[0].PeerID {
			t.Fatalf("proposal target=%q want=%q", targetPeerID, cfg.Stations[0].PeerID)
		}
		submitted = proto.Clone(req).(*federationpb.SubmitProposalRequest)
		nativefed.SetLocalStationPeerID(testPeerIDs[0])
		defer nativefed.SetLocalStationPeerID(testPeerIDs[1])
		if _, unauthenticatedErr := authoritySubserver.handleSubmitProposal(
			callCtx,
			req,
		); unauthenticatedErr == nil {
			t.Fatal("unauthenticated leave proposal was accepted")
		}
		authorityFederation, err := authority.GetFederation(
			callCtx,
			req.FederationId,
		)
		if err != nil || authorityFederation == nil {
			t.Fatalf("load authority Federation: federation=%+v err=%v", authorityFederation, err)
		}
		_, sequencerPrivateKey, err := authoritySubserver.actorKeySvc.GenerateKeyPair(
			callCtx,
			authorityFederation.CreatedByActorPTID,
		)
		if err != nil {
			sequencerPrivateKey, err = authoritySubserver.actorKeySvc.GetPrivateKey(
				callCtx,
				authorityFederation.CreatedByActorPTID,
			)
		}
		if err != nil {
			t.Fatalf("load sequencer key: %v", err)
		}
		return authoritySubserver.handleAuthenticatedLeaveProposal(
			callCtx,
			req,
			req.StationPeerId,
			authorityFederation.CreatedByActorPTID,
			cfg.Stations[0].PeerID,
			sequencerPrivateKey,
		)
	})

	syncManager := NewLedgerSyncManager(
		replicaLedger,
		replicaRepos.Federation,
		replicaRepos.LedgerEvent,
		replicaRepos.SyncCursor,
		replicaRepos.Membership,
		NewLedgerEventPublisher(replicaRepos.ActorRole),
		domain.NewHashService(),
		&repositoryLedgerFetcher{
			federationRepo: authorityRepos.Federation,
			ledgerSvc:      authorityLedger,
		},
		leavingStation.PeerID,
	)
	memberSubserver := &subServer{
		federationSvc:  replica,
		ledgerSvc:      replicaLedger,
		membershipRepo: replicaRepos.Membership,
		actorRoleRepo:  replicaRepos.ActorRole,
		actorKeySvc:    domain.NewActorKeyService(replicaRepos.ActorSigningKey),
		syncManager:    syncManager,
		govClient:      governanceClient,
	}

	actorContext := coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: leavingStation.ActorPTID,
	})
	unauthorizedContext := coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: "ptid:ordinary-local-user",
	})
	if _, unauthorizedErr := memberSubserver.handleLeaveFederation(
		unauthorizedContext,
		&federationpb.LeaveFederationRequest{FederationId: federationID},
	); unauthorizedErr == nil {
		t.Fatal("ordinary local actor was allowed to remove the Station")
	}
	if roleErr := replicaRepos.ActorRole.Upsert(ctx, &domain.ActorRoleRecord{
		FederationID:  federationID,
		ActorPTID:     "ptid:unknown-role",
		StationPeerID: leavingStation.PeerID,
		Role:          "legacy_unknown",
	}); roleErr != nil {
		t.Fatal(roleErr)
	}
	unknownRoleContext := coreauth.WithSubject(ctx, &coreauth.Subject{
		ID: "ptid:unknown-role",
	})
	if _, unauthorizedErr := memberSubserver.handleLeaveFederation(
		unknownRoleContext,
		&federationpb.LeaveFederationRequest{FederationId: federationID},
	); unauthorizedErr == nil {
		t.Fatal("unknown Federation role was allowed to remove the Station")
	}
	response, err := memberSubserver.handleLeaveFederation(
		actorContext,
		&federationpb.LeaveFederationRequest{
			FederationId: federationID,
			Reason:       "operator requested",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if response == nil || !response.Success {
		t.Fatalf("leave response=%+v", response)
	}
	if submitted == nil ||
		submitted.ProposedEventType != federationpb.EventType_STATION_LEFT ||
		submitted.StationPeerId != leavingStation.PeerID {
		t.Fatalf("submitted proposal=%+v", submitted)
	}

	authorityMembership, err := authorityRepos.Membership.GetByStation(
		ctx,
		federationID,
		leavingStation.PeerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	replicaMembership, err := replicaRepos.Membership.GetByStation(
		ctx,
		federationID,
		leavingStation.PeerID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if authorityMembership == nil || authorityMembership.Status != "left" {
		t.Fatalf("authority membership=%+v", authorityMembership)
	}
	if replicaMembership == nil || replicaMembership.Status != "left" {
		t.Fatalf("replica membership=%+v", replicaMembership)
	}
	replayed, err := authority.Replay(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	for _, stationPeerID := range replayed.ActiveMemberStations {
		if stationPeerID == leavingStation.PeerID {
			t.Fatalf("replay retained departed Station: %+v", replayed.ActiveMemberStations)
		}
	}
	expectedActive := make(map[string]struct{}, len(cfg.Stations)-1)
	for _, station := range cfg.Stations {
		if station.PeerID != leavingStation.PeerID {
			expectedActive[station.PeerID] = struct{}{}
		}
	}
	if len(replayed.ActiveMemberStations) != len(expectedActive) {
		t.Fatalf("replayed active members=%+v", replayed.ActiveMemberStations)
	}
	for _, stationPeerID := range replayed.ActiveMemberStations {
		if _, ok := expectedActive[stationPeerID]; !ok {
			t.Fatalf("unexpected replayed active member=%q", stationPeerID)
		}
	}

	authorityEvents, err := authorityLedger.FetchEvents(ctx, federationID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	accepted := authorityEvents[len(authorityEvents)-1]
	if accepted.EventType != federationpb.EventType_STATION_LEFT ||
		accepted.StationPeerId != cfg.Stations[0].PeerID {
		t.Fatalf("accepted event=%+v", accepted)
	}
	leftPayload := &federationpb.StationLeftPayload{}
	if err := proto.Unmarshal(accepted.PayloadBytes, leftPayload); err != nil {
		t.Fatal(err)
	}
	if leftPayload.LeavingStationPeerId != leavingStation.PeerID {
		t.Fatalf("leaving station=%q want=%q", leftPayload.LeavingStationPeerId, leavingStation.PeerID)
	}

	replicaFederation, err := replicaRepos.Federation.GetByID(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	authorityFederation, err := authorityRepos.Federation.GetByID(ctx, federationID)
	if err != nil {
		t.Fatal(err)
	}
	if replicaFederation.HeadSeq != authorityFederation.HeadSeq ||
		subtle.ConstantTimeCompare(replicaFederation.HeadHash, authorityFederation.HeadHash) != 1 {
		t.Fatalf(
			"replica head=(%d,%x) authority=(%d,%x)",
			replicaFederation.HeadSeq,
			replicaFederation.HeadHash,
			authorityFederation.HeadSeq,
			authorityFederation.HeadHash,
		)
	}
}
