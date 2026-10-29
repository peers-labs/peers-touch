package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"errors"
	"strconv"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	federationdomain "github.com/peers-labs/peers-touch/station/app/subserver/federation/domain"
	federationinfra "github.com/peers-labs/peers-touch/station/app/subserver/federation/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type membershipPrepareTestPublisher struct{}

func (membershipPrepareTestPublisher) NotifyCommitted(
	context.Context, []ports.CommittedDelivery,
) error {
	return errors.New("membership preparation must not publish committed delivery")
}

func TestFederatedMembershipPrepareDispatchesRemoteOwnerAndFencesClaims(t *testing.T) {
	fixture := newProductionAdapterFixture(t)
	ctx := context.Background()
	if err := persistence.MigrateCanonicalSchema(ctx, fixture.db); err != nil {
		t.Fatal(err)
	}
	if err := federationinfra.NewRepos(fixture.db).Membership.Upsert(
		ctx, &federationdomain.MembershipRecord{
			FederationID: "federation-1", StationPeerID: productionManifestTestRemoteStation,
			Status: "active",
		},
	); err != nil {
		t.Fatal(err)
	}
	sealer := conversationhttp.ProtobufEventSealer{}
	uow, err := persistence.NewUnitOfWork(fixture.db, fixture.factory, sealer)
	if err != nil {
		t.Fatal(err)
	}
	now := productionManifestTestTime
	snapshot := aggregate.Snapshot{
		ID:               "remote-owner-leave-group",
		Kind:             valueobject.ConversationKindGroup,
		Status:           valueobject.ConversationStatusActive,
		Scope:            valueobject.MustFederationScope("federation-1"),
		AuthorityStation: productionManifestTestLocalStation,
		AuthorityEpoch:   7,
		Owner:            fixture.bob.Actor,
		Head: valueobject.AuthorityHead{
			Sequence:        1,
			EventHash:       valueobject.HashBytes([]byte("committed-group")),
			MembershipEpoch: 1,
			MLSEpoch:        1,
		},
		Settings: valueobject.ConversationSettings{Name: "Remote owner"},
		Members: []entity.Member{
			{Actor: fixture.alice.Actor, Role: valueobject.MemberRoleMember,
				Status: valueobject.MemberStatusActive, HomeStation: productionManifestTestLocalStation,
				JoinedAt: 1, Muted: true},
			{Actor: fixture.bob.Actor, Role: valueobject.MemberRoleOwner,
				Status: valueobject.MemberStatusActive, HomeStation: productionManifestTestRemoteStation,
				JoinedAt: 1},
		},
		Devices: []entity.MemberDevice{
			{Endpoint: fixture.alice, HomeStation: productionManifestTestLocalStation, Active: true, JoinedAt: 1},
			{Endpoint: fixture.bob, HomeStation: productionManifestTestRemoteStation, Active: true, JoinedAt: 1},
		},
		CreatedAt: now.Add(-time.Minute),
		UpdatedAt: now.Add(-time.Minute),
	}
	if _, err := aggregate.Rehydrate(snapshot); err != nil {
		t.Fatal(err)
	}
	if err := uow.Execute(ctx, func(tx ports.Transaction) error {
		return tx.Repositories.Authority.Create(ctx, snapshot)
	}); err != nil {
		t.Fatal(err)
	}
	clock := productionManifestTestClock{now: now}
	commands, err := command.NewService(
		uow, snapshot.AuthorityStation, clock, productionUUIDGenerator{},
		conversationhttp.ProtobufConversationStateEncoder{},
		conversationhttp.ProtobufDeviceEventEncoder{},
		conversationhttp.ProtobufReadCursorEncoder{},
		conversationhttp.ProtobufLeaveIntentSigningEncoder{},
		conversationhttp.ProtobufCommandProposalSigningEncoder{},
		membershipPrepareTestPublisher{}, sealer,
	)
	if err != nil {
		t.Fatal(err)
	}
	queries, err := query.NewService(uow)
	if err != nil {
		t.Fatal(err)
	}
	localKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x51}, ed25519.SeedSize))
	remoteKey := ed25519.NewKeyFromSeed(bytes.Repeat([]byte{0x61}, ed25519.SeedSize))
	localManifest := signedProductionManifest(
		t, fixture.alice.Actor, string(fixture.alice.Device),
		productionManifestTestLocalStation, "station-four-key", localKey,
	)
	remoteManifest := signedProductionManifest(
		t, fixture.bob.Actor, string(fixture.bob.Device),
		productionManifestTestRemoteStation, "station-five-key", remoteKey,
	)
	authority := newProductionManifestTestServer(
		fixture.alice.Actor, fixture.bob.Actor, localManifest, remoteManifest,
		remoteKey.Public().(ed25519.PublicKey),
	)
	authority.composition.CommandService = commands
	authority.composition.QueryService = queries
	input := &chatmodel.PrepareFederatedConversationCommandRequest{
		SourceHomeStationPeerId: productionManifestTestRemoteStation,
		Preparation: &chatmodel.PrepareFederatedConversationCommandRequest_MembershipRequest{
			MembershipRequest: &chatmodel.PrepareConversationMembershipRequest{
				ConversationId: string(snapshot.ID),
				Sender: &actormodel.ActorDeviceRef{
					Actor: &actormodel.ActorRef{
						Ptid: string(fixture.bob.Actor), Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
					},
					DeviceId: string(fixture.bob.Device),
				},
				Action: chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_LEAVE,
				TargetActor: &actormodel.ActorRef{
					Ptid: string(fixture.alice.Actor), Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
			},
		},
	}
	claims := &authfed.VerifiedClaims{
		Issuer: productionManifestTestRemoteStation, Audience: productionManifestTestLocalStation,
		Subject: string(fixture.bob.Actor),
		Custom: map[string]string{
			federationruntime.ClaimFederationID:        string(snapshot.Scope.FederationIDOrEmpty()),
			federationruntime.ClaimConversationID:      string(snapshot.ID),
			federationruntime.ClaimActorPTID:           string(fixture.bob.Actor),
			federationruntime.ClaimDeviceID:            string(fixture.bob.Device),
			federationruntime.ClaimAuthorityEpoch:      strconv.FormatInt(int64(snapshot.AuthorityEpoch), 10),
			federationruntime.ClaimSourceStationPeerID: productionManifestTestRemoteStation,
			federationruntime.ClaimTargetStationPeerID: productionManifestTestLocalStation,
		},
	}
	response, err := authority.prepareFederatedCommand(ctx, claims, input)
	if err != nil {
		t.Fatalf("remote-owner membership preparation: %v", err)
	}
	plan := response.GetMembershipPlan()
	if response.GetPlan() != nil || plan.GetAuthorityPlanId() == "" ||
		plan.GetAuthorityStationPeerId() != string(snapshot.AuthorityStation) ||
		plan.GetAuthoritySequence() != int64(snapshot.Head.Sequence) ||
		len(plan.GetPreEndpoints()) != 2 || len(plan.GetPostEndpoints()) != 1 ||
		plan.GetPostEndpoints()[0].GetActor().GetPtid() != string(fixture.bob.Actor) ||
		len(plan.GetRemovedEndpoints()) != 1 ||
		plan.GetRemovedEndpoints()[0].GetActor().GetPtid() != string(fixture.alice.Actor) {
		t.Fatalf("wrong membership preparation response: %+v", response)
	}
	current, err := queries.Get(ctx, snapshot.ID, fixture.bob.Actor)
	if err != nil || current.Conversation.Head != snapshot.Head ||
		current.Conversation.Owner != snapshot.Owner || len(current.Conversation.Members) != 2 {
		t.Fatalf("preparation changed committed authority: %+v, %v", current, err)
	}
	t.Run("ordinary preparation retains its response variant", func(t *testing.T) {
		ordinary := &chatmodel.PrepareFederatedConversationCommandRequest{
			SourceHomeStationPeerId: claims.Issuer,
			Preparation: &chatmodel.PrepareFederatedConversationCommandRequest_Request{
				Request: &chatmodel.PrepareConversationCommandRequest{
					ConversationId:         string(snapshot.ID),
					Sender:                 input.GetMembershipRequest().GetSender(),
					AuthorityStationPeerId: claims.Audience,
					CommandKind:            chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBER_AUTHORITY,
				},
			},
		}
		response, err := authority.prepareFederatedCommand(ctx, claims, ordinary)
		if err != nil || response.GetPlan() == nil || response.GetMembershipPlan() != nil {
			t.Fatalf("ordinary preparation response: %+v, %v", response, err)
		}
	})
	var preparedCount int64
	if err := fixture.db.Model(&persistence.ConversationAuthorityPlanModel{}).Count(&preparedCount).Error; err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{
		federationruntime.ClaimFederationID, federationruntime.ClaimConversationID,
		federationruntime.ClaimActorPTID, federationruntime.ClaimDeviceID,
		federationruntime.ClaimAuthorityEpoch, federationruntime.ClaimSourceStationPeerID,
		federationruntime.ClaimTargetStationPeerID,
	} {
		t.Run(key, func(t *testing.T) {
			mismatched := *claims
			mismatched.Custom = make(map[string]string, len(claims.Custom))
			for name, value := range claims.Custom {
				mismatched.Custom[name] = value
			}
			mismatched.Custom[key] = "different"
			if _, err := authority.prepareFederatedCommand(ctx, &mismatched, input); err == nil {
				t.Fatal("mismatched signed claim was accepted")
			}
		})
	}
	for _, field := range []string{"subject", "audience"} {
		t.Run(field, func(t *testing.T) {
			mismatched := *claims
			if field == "subject" {
				mismatched.Subject = string(fixture.alice.Actor)
			} else {
				mismatched.Audience = "different-station"
			}
			if _, err := authority.prepareFederatedCommand(ctx, &mismatched, input); err == nil {
				t.Fatal("mismatched peer identity was accepted")
			}
		})
	}
	t.Run("missing preparation", func(t *testing.T) {
		if _, err := authority.prepareFederatedCommand(
			ctx, claims, &chatmodel.PrepareFederatedConversationCommandRequest{},
		); err == nil {
			t.Fatal("missing preparation was accepted")
		}
	})
	t.Run("unauthenticated preparation", func(t *testing.T) {
		if _, err := authority.prepareFederatedCommand(ctx, nil, input); err == nil {
			t.Fatal("unauthenticated preparation was accepted")
		}
	})
	t.Run("signed Home Station disagrees with endpoint manifest", func(t *testing.T) {
		mismatched := *claims
		mismatched.Issuer = productionManifestTestLocalStation
		mismatched.Custom = make(map[string]string, len(claims.Custom))
		for name, value := range claims.Custom {
			mismatched.Custom[name] = value
		}
		mismatched.Custom[federationruntime.ClaimSourceStationPeerID] = mismatched.Issuer
		other := proto.Clone(input).(*chatmodel.PrepareFederatedConversationCommandRequest)
		other.SourceHomeStationPeerId = mismatched.Issuer
		_, err := authority.prepareFederatedCommand(ctx, &mismatched, other)
		var denied *server.HandlerError
		if !errors.As(err, &denied) || denied.Code != 403 {
			t.Fatalf("wrong Home Station was not denied: %v", err)
		}
	})
	var afterCount int64
	if err := fixture.db.Model(&persistence.ConversationAuthorityPlanModel{}).Count(&afterCount).Error; err != nil {
		t.Fatal(err)
	}
	if afterCount != preparedCount {
		t.Fatal("rejected preparation persisted an authority plan")
	}
}
