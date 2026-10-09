package application

import (
	"context"
	"crypto/ed25519"
	"fmt"
	"testing"
	"time"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestFederatedPrivateInvalidationDeleteStagesMonotonicSourceFrame(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	source.audiences.snapshot.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_FRIENDS,
	}
	source.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: source.author.Endpoint},
		localities: []socialdomain.RecipientLocality{{
			ActorPTID:         "ptid:bob",
			HomeStationPeerID: "station-remote",
			FederationID:      "federation-one",
		}},
	}
	source.keyExchange.publicKeysByTarget = map[string][]byte{
		fmt.Sprintf(
			"%d:%s:%s",
			securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ENDPOINT,
			"ptid:bob",
			"bob-device",
		): federatedPrivateTestPreKeyPublic(t, 0x0b),
	}
	if err := source.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		allowFederatedPrivateMembership{},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	prepareRequest := privateMomentPrepareRequest(
		"prepare-federated-private-text",
		"content-federated-private-text",
	)
	prepareRequest.Audience = &actormodel.Audience{
		Kind: actormodel.Audience_FRIENDS,
	}
	prepared, err := source.service.PreparePrivateMoment(
		ctx,
		source.author,
		prepareRequest,
	)
	if err != nil {
		t.Fatal(err)
	}
	submitted, err := source.service.SubmitPrivateMoment(
		ctx,
		source.author.Endpoint,
		federatedPrivateTextSubmitRequest(
			t,
			prepared.GetPlan(),
			source.author.Endpoint,
			source.authorPrivateKey,
			"submit-federated-private-text",
		),
	)
	if err != nil {
		t.Fatal(err)
	}
	postID := submitted.GetPost().GetMetadata().GetPostId()
	if err := source.database.AutoMigrate(&dbmodel.SocialReaction{}); err != nil {
		t.Fatal(err)
	}
	deleted, err := source.service.DeletePrivateMoment(
		ctx,
		postID,
		source.author.Endpoint.GetActor().GetPtid(),
	)
	if err != nil || !deleted {
		t.Fatalf("delete private Moment = %t, %v", deleted, err)
	}

	var rows []delivery.OutboxRecord
	if err := source.database.Order("created_at ASC").Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("source outbox rows = %d, want 2", len(rows))
	}
	frame := &delivery.Frame{}
	if err := proto.Unmarshal(rows[1].FrameBytes, frame); err != nil {
		t.Fatal(err)
	}
	if frame.GetPayloadKind() != delivery.PayloadKindSocialPrivateInvalidation {
		t.Fatalf("source invalidation frame = %+v", frame)
	}
	message := &privatecontentpb.FederatedPrivateResourceInvalidation{}
	if err := proto.Unmarshal(frame.GetOpaquePayload(), message); err != nil {
		t.Fatal(err)
	}
	if message.GetResource().GetContentId() != prepared.GetPlan().GetResource().GetContentId() ||
		message.GetLifecycleRevision() != prepared.GetPlan().GetResource().GetGeneration()+1 ||
		message.GetTargetActor().GetPtid() != "ptid:bob" ||
		message.GetReason() != privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RESOURCE_DELETED {
		t.Fatalf("source invalidation = %+v", message)
	}
}

func TestFederatedPrivateInvalidationCommitsTombstoneAndTypedWake(
	t *testing.T,
) {
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	if err := source.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		allowFederatedPrivateMembership{},
		NewMomentEventPublisher(),
	); err != nil {
		t.Fatal(err)
	}
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	message := &privatecontentpb.FederatedPrivateResourceInvalidation{
		FormatVersion:       1,
		FederationId:        "federation-one",
		SourceStationPeerId: "station-local",
		TargetStationPeerId: "station-remote",
		TargetActor: &actormodel.ActorRef{
			Ptid: "ptid:bob",
			Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
		},
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.
				SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:  "post-revoked",
			Generation: 1,
		},
		LifecycleRevision: 2,
		Reason:            privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RESOURCE_DELETED,
		CommittedAt:       timestamppb.New(source.clock.now.UTC()),
	}
	frame, err := source.service.signFederatedPrivateInvalidationFrame(
		ctx,
		federatedPrivateTestTransaction{database: source.database},
		message,
		source.clock.now,
	)
	if err != nil {
		t.Fatal(err)
	}

	first, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if first.Disposition != delivery.DispositionAccepted {
		t.Fatalf("first invalidation disposition = %+v", first)
	}
	assertTableCount(
		t,
		receiver.database,
		"social_remote_private_tombstones",
		1,
	)
	select {
	case event := <-receiver.subscription.Events:
		moment := event.GetMoment()
		if moment == nil ||
			moment.GetKind() != realtime.MomentEvent_DELETED ||
			moment.GetPostId() != "post-revoked" ||
			moment.GetActorPtid() != "ptid:bob" ||
			moment.GetAudience() != message.GetReason().String() {
			t.Fatalf("receiver revocation event = %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("receiver emitted no revocation event")
	}

	replay, err := receiver.receiver.Receive(ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if replay.Disposition != delivery.DispositionDuplicate {
		t.Fatalf("invalidation replay disposition = %+v", replay)
	}
}
