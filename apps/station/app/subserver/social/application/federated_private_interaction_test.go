package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"fmt"
	"testing"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
)

func TestFederatedPrivateCommentPrepare(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	request := fixture.prepareRequest(t, "prepare-remote-comment", "remote-comment")

	if _, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial prepare error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, request.GetCommandId())
	fixture.deliverResult(t, request.GetCommandId())

	response, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetPlan().GetAuthor().GetActor().GetPtid() != "ptid:bob" ||
		response.GetPlan().GetResource().GetContentId() !=
			request.GetCommentContentId() {
		t.Fatalf("remote prepare response = %+v", response)
	}
	if response.GetStationSigningKeyAttestation().GetStationPeerId() !=
		"station-remote" ||
		response.GetStationSigningKeyAttestation().GetProofSigningKeyId() !=
			response.GetPlan().GetStationSigningKeyId() {
		t.Fatalf("localized source-plan attestation = %+v", response)
	}
}

func TestFederatedPrivateCommentPrepareRejectsInvalidActorSignature(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	request := fixture.prepareRequest(
		t,
		"prepare-remote-invalid-signature",
		"remote-invalid-signature",
	)
	request.ActorDeviceSignature[0] ^= 1
	if _, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial prepare error = %v, want pending dependency", err)
	}
	frame := federatedPrivateOutboxFrame(
		t,
		fixture.receiver.database,
		federationdelivery.PayloadKindSocialPrivateInteraction,
		func(frame *federationdelivery.Frame) bool {
			return frame.GetPayloadId() == request.GetCommandId()
		},
	)
	result, err := fixture.sourceReceiver.Receive(fixture.ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionTerminal {
		t.Fatalf("invalid actor signature disposition = %+v", result)
	}
	assertPrivateContentCount(
		t,
		fixture.source.database,
		&dbmodel.SocialPrivateContentComment{},
		0,
	)
}

func TestFederatedPrivateCommentPrepareRevalidatesRateLimit(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	seedPrivateCommentRateWindow(
		t,
		fixture.source,
		fixture.postID,
		int(privateCommentActorLimit),
		func(int) string { return "ptid:bob" },
	)
	request := fixture.prepareRequest(
		t,
		"prepare-remote-rate-limit",
		"remote-rate-limit",
	)
	beforeClaims := fixture.source.keyExchange.claimCalls
	if _, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial prepare error = %v, want pending dependency", err)
	}
	frame := federatedPrivateOutboxFrame(
		t,
		fixture.receiver.database,
		federationdelivery.PayloadKindSocialPrivateInteraction,
		func(frame *federationdelivery.Frame) bool {
			return frame.GetPayloadId() == request.GetCommandId()
		},
	)
	result, err := fixture.sourceReceiver.Receive(fixture.ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if result.Disposition != federationdelivery.DispositionRetryable {
		t.Fatalf("rate-limited prepare disposition = %+v", result)
	}
	if fixture.source.keyExchange.claimCalls != beforeClaims {
		t.Fatal("rate-limited prepare consumed one-time PreKeys")
	}
}

func TestFederatedPrivateCommentSubmit(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	prepared := fixture.completePrepare(
		t,
		fixture.prepareRequest(t, "prepare-remote-submit", "remote-submit"),
	)
	request := fixture.submitRequest(
		t,
		prepared.GetPlan(),
		"submit-remote-comment",
	)

	if _, err := fixture.receiver.service.SubmitPrivateCommentForAuthor(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial submit error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, request.GetCommandId())
	charlieFrame := federatedPrivateOutboxFrame(
		t,
		fixture.source.database,
		federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetResourceKind() ==
					privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_COMMENT &&
				message.GetTargetActor().GetPtid() == "ptid:charlie"
		},
	)
	if result, err := fixture.receiver.receiver.Receive(
		fixture.ctx,
		charlieFrame,
	); err != nil || result.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("deliver Comment projection to Charlie = %+v, %v", result, err)
	}
	fixture.deliverResult(t, request.GetCommandId())

	response, err := fixture.receiver.service.SubmitPrivateCommentForAuthor(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	commentID := response.GetComment().GetMetadata().GetCommentId()
	if commentID == "" ||
		response.GetComment().GetMetadata().GetAuthor().GetPtid() != "ptid:bob" {
		t.Fatalf("remote submit response = %+v", response)
	}
	assertPrivateContentCount(
		t,
		fixture.source.database,
		&dbmodel.SocialPrivateContentComment{},
		1,
	)
	read, err := fixture.receiver.service.GetPrivateComment(
		fixture.ctx,
		fixture.receiver.bob,
		fixture.postID,
		commentID,
	)
	if err != nil {
		t.Fatal(err)
	}
	if read.GetComment().GetMetadata().GetCommentId() != commentID {
		t.Fatalf("remote Comment readback = %+v", read)
	}
	charlieRead, err := fixture.receiver.service.GetPrivateComment(
		fixture.ctx,
		&actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: "ptid:charlie",
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: "bob-device",
		},
		fixture.postID,
		commentID,
	)
	if err != nil || charlieRead.GetComment().GetMetadata().GetCommentId() != commentID {
		t.Fatalf("remote audience Comment readback = %+v, %v", charlieRead, err)
	}
	page, err := fixture.receiver.service.ListPrivateComments(
		fixture.ctx,
		fixture.receiver.bob,
		&privatecontentpb.ListMomentCommentsRequest{
			PostId: fixture.postID,
			Limit:  20,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.GetComments()) != 1 ||
		page.GetComments()[0].GetMetadata().GetCommentId() != commentID {
		t.Fatalf("remote Comment page = %+v", page)
	}
	assertFederatedPrivateCommentEvent(
		t,
		fixture.sourceSubscription,
		fixture.postID,
		commentID,
		"ptid:alice",
	)
	assertFederatedPrivateCommentEvent(
		t,
		fixture.receiver.subscription,
		fixture.postID,
		commentID,
		"ptid:bob",
	)
}

func TestFederatedPrivateCommentReplay(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	request := fixture.prepareRequest(t, "prepare-remote-replay", "remote-replay")
	before := fixture.source.keyExchange.claimCalls
	first := fixture.completePrepare(t, request)
	after := fixture.source.keyExchange.claimCalls
	if after != before+1 {
		t.Fatalf("prepare claims = %d, want %d", after, before+1)
	}
	replayed, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(first, replayed) {
		t.Fatal("exact prepare replay changed the typed result")
	}
	if fixture.source.keyExchange.claimCalls != after {
		t.Fatal("exact prepare replay claimed another one-time PreKey")
	}
}

func TestFederatedPrivateCommentHashConflict(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	request := fixture.prepareRequest(t, "prepare-remote-conflict", "remote-conflict-a")
	if _, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial prepare error = %v, want pending dependency", err)
	}
	conflict := proto.Clone(request).(*privatecontentpb.PreparePrivateCommentRequest)
	conflict.CommentContentId = privateTestContentID("remote-conflict-b")
	if _, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		conflict,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentConflict) {
		t.Fatalf("changed-hash prepare error = %v, want conflict", err)
	}
	assertPrivateContentCount(
		t,
		fixture.source.database,
		&dbmodel.SocialPrivateContentComment{},
		0,
	)
}

func TestFederatedPrivateCommentParentRevalidation(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	prepared := fixture.completePrepare(
		t,
		fixture.prepareRequest(t, "prepare-remote-revoke", "remote-revoke"),
	)
	deletedAt := fixture.source.clock.now.Add(time.Second)
	update := fixture.source.database.Model(&dbmodel.SocialPrivateContentPost{}).
		Where("post_id = ?", fixture.postID).
		Updates(map[string]any{
			"lifecycle_state": "DELETED",
			"deleted_at":      deletedAt,
			"updated_at":      deletedAt,
		})
	if update.Error != nil || update.RowsAffected != 1 {
		t.Fatalf("delete parent rows = %d, error = %v", update.RowsAffected, update.Error)
	}
	request := fixture.submitRequest(
		t,
		prepared.GetPlan(),
		"submit-remote-revoke",
	)
	if _, err := fixture.receiver.service.SubmitPrivateCommentForAuthor(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial submit error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, request.GetCommandId())
	fixture.deliverResult(t, request.GetCommandId())
	if _, err := fixture.receiver.service.SubmitPrivateCommentForAuthor(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); err == nil ||
		(!socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentStalePlan) &&
			!socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentNotFound)) {
		t.Fatalf("revoked parent submit error = %v", err)
	}
	assertPrivateContentCount(
		t,
		fixture.source.database,
		&dbmodel.SocialPrivateContentComment{},
		0,
	)
}

func TestFederatedPrivateCommentPreKeyNonReuse(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	first := fixture.completePrepare(
		t,
		fixture.prepareRequest(t, "prepare-remote-key-a", "remote-key-a"),
	)
	second := fixture.completePrepare(
		t,
		fixture.prepareRequest(t, "prepare-remote-key-b", "remote-key-b"),
	)
	firstKeys := make(map[string]struct{})
	for _, slot := range first.GetPlan().GetRequiredSlots() {
		firstKeys[slot.GetOneTimeKeyId()] = struct{}{}
	}
	for _, slot := range second.GetPlan().GetRequiredSlots() {
		if _, reused := firstKeys[slot.GetOneTimeKeyId()]; reused {
			t.Fatalf("one-time PreKey %q was reused", slot.GetOneTimeKeyId())
		}
	}
}

type federatedPrivateCommentFixture struct {
	ctx                context.Context
	source             *privateContentServiceFixture
	receiver           *federatedPrivateReceiverFixture
	sourceReceiver     *federationdelivery.DeliveryReceiver
	sourceSubscription *events.Subscription
	bobAuthor          socialdomain.PrivateContentAuthor
	postID             string
}

func newFederatedPrivateCommentFixture(
	t *testing.T,
) *federatedPrivateCommentFixture {
	t.Helper()
	ctx := context.Background()
	source := newPrivateContentServiceFixture(t)
	receiver := newFederatedPrivateReceiver(
		t,
		source.clock.now,
		source.authorPrivateKey.Public().(ed25519.PublicKey),
		source.stationSigner.privateKey.Public().(ed25519.PublicKey),
		source.stationSigner.keyID,
	)
	source.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience:         &actormodel.Audience{Kind: actormodel.Audience_FRIENDS},
		SourceRevision:   1,
		SourceHeadSHA256: privateDigest("federated-comment-parent"),
		RecipientPTIDs:   []string{"ptid:bob", "ptid:charlie"},
		RecipientLocalities: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:bob",
				HomeStationPeerID: "station-remote",
				FederationID:      "federation-one",
			},
			{
				ActorPTID:         "ptid:charlie",
				HomeStationPeerID: "station-remote",
				FederationID:      "federation-one",
			},
		},
	}
	source.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: source.author.Endpoint},
		localities: append(
			[]socialdomain.RecipientLocality(nil),
			source.audiences.snapshot.RecipientLocalities...,
		),
	}
	sourceBus, err := events.NewDurableEventBus(
		source.database,
		events.WithIDGenerator(func() string {
			return fmt.Sprintf("source-comment-event-%d", time.Now().UnixNano())
		}),
		events.WithClock(func() time.Time { return source.clock.now }),
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(sourceBus.Close)
	sourceSubscription, cancel, err := sourceBus.Subscribe(
		ctx,
		"ptid:alice",
		"alice-device",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(cancel)
	sourcePublisher := NewMomentEventPublisher()
	sourcePublisher.bus = func() events.EventBus { return sourceBus }
	sourcePublisher.now = func() time.Time { return source.clock.now }
	if err := source.service.ConfigureFederatedPrivateDelivery(
		"station-local",
		allowFederatedPrivateMembership{},
		sourcePublisher,
	); err != nil {
		t.Fatal(err)
	}
	postID := publishPrivateCommentParent(t, source, "federated-comment-parent")
	receiverAudienceFixture := receiver.service.audiences.(*privateContentTestAudience)
	receiverAudienceFixture.snapshot.RecipientPTIDs = []string{
		"ptid:bob",
		"ptid:charlie",
	}
	parentFrame := federatedPrivateOutboxFrame(
		t,
		source.database,
		federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetResource().GetContentId() == postID &&
				message.GetTargetActor().GetPtid() == "ptid:bob"
		},
	)
	if result, err := receiver.receiver.Receive(ctx, parentFrame); err != nil ||
		result.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("import parent = %+v, %v", result, err)
	}
	charlieParentFrame := federatedPrivateOutboxFrame(
		t,
		source.database,
		federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetResource().GetContentId() == postID &&
				message.GetTargetActor().GetPtid() == "ptid:charlie"
		},
	)
	if result, err := receiver.receiver.Receive(ctx, charlieParentFrame); err != nil ||
		result.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("import Charlie parent = %+v, %v", result, err)
	}
	select {
	case <-receiver.subscription.Events:
	case <-time.After(time.Second):
		t.Fatal("imported parent emitted no Moment event")
	}
	membership := allowFederatedPrivateInteractionMembership{}
	source.service.federationMembership = membership
	receiver.service.federationMembership = membership
	receiverAudience, err :=
		infrastructure.NewGORMPrivateAudienceAuthority(receiver.database)
	if err != nil {
		t.Fatal(err)
	}
	receiver.service.audiences = receiverAudience

	bobAuthor := socialdomain.PrivateContentAuthor{
		Endpoint: proto.Clone(
			receiver.bob,
		).(*actormodel.ActorDeviceRef),
		HomeStationPeerID: "station-remote",
	}
	bobAuthor.Endpoint.Actor.Acct = "bob@station.remote"
	source.audiences.snapshot = socialdomain.FriendsSnapshot{
		Audience: &actormodel.Audience{
			Kind:       actormodel.Audience_CUSTOM_ALLOW,
			ActorPtids: []string{"ptid:alice"},
		},
		SourceRevision:   2,
		SourceHeadSHA256: privateDigest("federated-comment-audience"),
		RecipientPTIDs:   []string{"ptid:alice", "ptid:charlie"},
		RecipientLocalities: []socialdomain.RecipientLocality{
			{
				ActorPTID:         "ptid:alice",
				HomeStationPeerID: "station-local",
			},
			{
				ActorPTID:         "ptid:charlie",
				HomeStationPeerID: "station-remote",
				FederationID:      "federation-one",
			},
		},
	}
	source.service.recipients = &privateContentRemoteRecipientDirectory{
		delegate: privateContentTestRecipients{author: bobAuthor.Endpoint},
		localities: append(
			[]socialdomain.RecipientLocality(nil),
			source.audiences.snapshot.RecipientLocalities...,
		),
	}

	remoteSigner, ok := receiver.service.stationSigner.(privateContentTestSigner)
	if !ok {
		t.Fatal("receiver signer fixture is unavailable")
	}
	sourceRegistry := federationdelivery.NewRegistry()
	if err := infrastructure.RegisterFederatedPrivateInteractionReceivers(
		sourceRegistry,
		source.service,
	); err != nil {
		t.Fatal(err)
	}
	sourceDeliveryStore, err := federationdelivery.NewGORMRepository(
		source.database,
		source.clock,
	)
	if err != nil {
		t.Fatal(err)
	}
	sourceReceiver, err := federationdelivery.NewReceiver(
		federationdelivery.ReceiverConfig{
			Policy: federationdelivery.DefaultFramePolicy("station-local"),
			Verifier: federatedPrivateFrameVerifier{
				sourceStationPeerID: "station-remote",
				keyID:               remoteSigner.keyID,
				publicKey:           remoteSigner.privateKey.Public().(ed25519.PublicKey),
			},
			Registry:   sourceRegistry,
			UnitOfWork: sourceDeliveryStore,
			Clock:      source.clock,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return &federatedPrivateCommentFixture{
		ctx:                ctx,
		source:             source,
		receiver:           receiver,
		sourceReceiver:     sourceReceiver,
		sourceSubscription: sourceSubscription,
		bobAuthor:          bobAuthor,
		postID:             postID,
	}
}

type allowFederatedPrivateInteractionMembership struct{}

func (allowFederatedPrivateInteractionMembership) ValidateActiveStationPair(
	_ context.Context,
	federationID string,
	sourceStationPeerID string,
	targetStationPeerID string,
) error {
	if federationID != "federation-one" {
		return fmt.Errorf("unexpected Federation")
	}
	validPair := (sourceStationPeerID == "station-local" &&
		targetStationPeerID == "station-remote") ||
		(sourceStationPeerID == "station-remote" &&
			targetStationPeerID == "station-local")
	if !validPair {
		return fmt.Errorf("unexpected Federation Station pair")
	}
	return nil
}

func (f *federatedPrivateCommentFixture) prepareRequest(
	t *testing.T,
	commandID string,
	contentLabel string,
) *privatecontentpb.PreparePrivateCommentRequest {
	t.Helper()
	request := &privatecontentpb.PreparePrivateCommentRequest{
		PostId:            f.postID,
		CommentContentId:  privateTestContentID(contentLabel),
		CommandId:         commandID,
		ActorSigningKeyId: "author-key",
	}
	signingBytes, err := canonicalFederatedPrivateInteractionRequestSigningBytes(
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	request.ActorDeviceSignature = ed25519.Sign(
		f.source.authorPrivateKey,
		signingBytes,
	)
	return request
}

func (f *federatedPrivateCommentFixture) completePrepare(
	t *testing.T,
	request *privatecontentpb.PreparePrivateCommentRequest,
) *privatecontentpb.PreparePrivateCommentResponse {
	t.Helper()
	if _, err := f.receiver.service.PreparePrivateComment(
		f.ctx,
		f.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial prepare error = %v, want pending dependency", err)
	}
	f.deliverCommand(t, request.GetCommandId())
	f.deliverResult(t, request.GetCommandId())
	response, err := f.receiver.service.PreparePrivateComment(
		f.ctx,
		f.bobAuthor,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func (f *federatedPrivateCommentFixture) submitRequest(
	t *testing.T,
	plan *securecontentpb.ContentEncryptionPlan,
	commandID string,
) *privatecontentpb.SubmitPrivateCommentRequest {
	t.Helper()
	submit := privateTextSubmitRequest(
		t,
		plan,
		f.bobAuthor.Endpoint,
		f.source.authorPrivateKey,
		commandID,
		"remote private Comment",
	)
	request := &privatecontentpb.SubmitPrivateCommentRequest{
		Plan:              submit.GetPlan(),
		Payload:           submit.GetPayload(),
		Envelopes:         submit.GetEnvelopes(),
		Objects:           submit.GetObjects(),
		CommandId:         submit.GetCommandId(),
		PostId:            f.postID,
		ActorSigningKeyId: "author-key",
	}
	signingBytes, err := canonicalFederatedPrivateInteractionRequestSigningBytes(
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	request.ActorDeviceSignature = ed25519.Sign(
		f.source.authorPrivateKey,
		signingBytes,
	)
	return request
}

func (f *federatedPrivateCommentFixture) deliverCommand(
	t *testing.T,
	commandID string,
) {
	t.Helper()
	frame := federatedPrivateOutboxFrame(
		t,
		f.receiver.database,
		federationdelivery.PayloadKindSocialPrivateInteraction,
		func(frame *federationdelivery.Frame) bool {
			return frame.GetPayloadId() == commandID
		},
	)
	result, err := f.sourceReceiver.Receive(f.ctx, frame)
	if err != nil || (result.Disposition != federationdelivery.DispositionAccepted &&
		result.Disposition != federationdelivery.DispositionDuplicate) {
		t.Fatalf("deliver interaction command = %+v, %v", result, err)
	}
}

func (f *federatedPrivateCommentFixture) deliverResult(
	t *testing.T,
	commandID string,
) {
	t.Helper()
	frame := federatedPrivateOutboxFrame(
		t,
		f.source.database,
		federationdelivery.PayloadKindSocialPrivateResult,
		func(frame *federationdelivery.Frame) bool {
			return frame.GetPayloadId() == commandID
		},
	)
	result, err := f.receiver.receiver.Receive(f.ctx, frame)
	if err != nil || (result.Disposition != federationdelivery.DispositionAccepted &&
		result.Disposition != federationdelivery.DispositionDuplicate) {
		t.Fatalf("deliver interaction result = %+v, %v", result, err)
	}
}

func federatedPrivateOutboxFrame(
	t *testing.T,
	database *gorm.DB,
	kind federationdelivery.PayloadKind,
	matches func(*federationdelivery.Frame) bool,
) *federationdelivery.Frame {
	t.Helper()
	var rows []federationdelivery.OutboxRecord
	if err := database.Where("payload_kind = ?", int32(kind)).
		Order("created_at ASC").
		Find(&rows).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		frame := &federationdelivery.Frame{}
		if err := proto.Unmarshal(row.FrameBytes, frame); err != nil {
			t.Fatal(err)
		}
		if matches(frame) {
			return frame
		}
	}
	t.Fatalf("outbox frame kind=%s was not found", kind)
	return nil
}

func assertFederatedPrivateCommentEvent(
	t *testing.T,
	subscription *events.Subscription,
	postID string,
	commentID string,
	targetActorPTID string,
) {
	t.Helper()
	select {
	case event := <-subscription.Events:
		moment := event.GetMoment()
		if moment == nil ||
			moment.GetKind() != realtime.MomentEvent_COMMENTED ||
			moment.GetPostId() != postID ||
			moment.GetCommentId() != commentID ||
			moment.GetActorPtid() != targetActorPTID {
			t.Fatalf("private Comment event = %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("private Comment emitted no committed Moment event")
	}
}

func TestFederatedPrivateCommentResultRejectsChangedHash(t *testing.T) {
	fixture := newFederatedPrivateCommentFixture(t)
	request := fixture.prepareRequest(t, "prepare-result-conflict", "result-conflict")
	if _, err := fixture.receiver.service.PreparePrivateComment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial prepare error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, request.GetCommandId())
	frame := federatedPrivateOutboxFrame(
		t,
		fixture.source.database,
		federationdelivery.PayloadKindSocialPrivateResult,
		func(frame *federationdelivery.Frame) bool {
			return frame.GetPayloadId() == request.GetCommandId()
		},
	)
	result := &privatecontentpb.FederatedPrivateInteractionResult{}
	if err := proto.Unmarshal(frame.GetOpaquePayload(), result); err != nil {
		t.Fatal(err)
	}
	result.CanonicalCommandSha256 = bytes.Repeat([]byte{0x99}, 32)
	tamperedBytes, err := socialdomain.CanonicalProtoBytes(result)
	if err != nil {
		t.Fatal(err)
	}
	frame.OpaquePayload = tamperedBytes
	frame.PayloadSha256 = federationdelivery.PayloadSHA256(tamperedBytes)
	signingBytes, err := federationdelivery.SigningBytes(frame)
	if err != nil {
		t.Fatal(err)
	}
	frame.StationSignature = ed25519.Sign(
		fixture.source.stationSigner.privateKey,
		signingBytes,
	)
	outcome, err := fixture.receiver.receiver.Receive(fixture.ctx, frame)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Disposition != federationdelivery.DispositionTerminal {
		t.Fatalf("changed-hash result disposition = %+v", outcome)
	}
}
