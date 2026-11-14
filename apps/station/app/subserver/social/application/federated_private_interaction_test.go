package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"fmt"
	"testing"
	"time"

	securecontentkernel "github.com/peers-labs/peers-touch/station/app/internal/securecontent"
	"github.com/peers-labs/peers-touch/station/app/subserver/events"
	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	realtime "github.com/peers-labs/peers-touch/station/frame/touch/model/realtime"
	"google.golang.org/protobuf/encoding/protowire"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

func privatePollPrepareFixture(t *testing.T, maxChoices uint32) *privatecontentpb.PreparePrivateMomentRequest {
	t.Helper()
	request := privateMomentPrepareRequest("prepare-private-poll", "private-poll")
	request.Kind = privatecontentpb.PrivateMomentKind_PRIVATE_MOMENT_KIND_POLL
	options := [][]byte{bytes.Repeat([]byte{0x11}, 32), bytes.Repeat([]byte{0x22}, 32)}
	var wire []byte
	for _, option := range options {
		wire = protowire.AppendBytes(protowire.AppendTag(wire, 1, protowire.BytesType), option)
	}
	digest := sha256.Sum256(wire)
	request.PollAuthority = &privatecontentpb.PrivatePollAuthority{
		Resource: &securecontentpb.SecureResourceRef{
			OwnerDomain: securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL,
			ContentId:   request.GetContentId(), Generation: 1,
		},
		OpaqueOptionIds: options, OptionSetSha256: digest[:], MinChoices: 1, MaxChoices: maxChoices,
		ExpiresAt: timestamppb.New(time.Date(2026, 9, 14, 11, 0, 0, 0, time.UTC)),
	}
	return request
}

func (f *federatedPrivateCommentFixture) privateVoteRequest(
	t *testing.T, authority *privatecontentpb.PrivatePollAuthority, commandID string, indices ...int,
) *privatecontentpb.VotePrivatePollRequest {
	t.Helper()
	request := &privatecontentpb.VotePrivatePollRequest{
		PostId: f.postID, CommandId: commandID, ActorSigningKeyId: "author-key",
		OptionSetSha256: append([]byte(nil), authority.GetOptionSetSha256()...),
	}
	for _, index := range indices {
		request.OpaqueOptionIds = append(request.OpaqueOptionIds, authority.GetOpaqueOptionIds()[index])
	}
	f.signPrivateVote(t, request)
	return request
}

func (f *federatedPrivateCommentFixture) signPrivateVote(t *testing.T, request *privatecontentpb.VotePrivatePollRequest) {
	t.Helper()
	signing, err := canonicalFederatedPrivateInteractionRequestSigningBytes(
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_VOTE_POLL, request)
	if err != nil {
		t.Fatal(err)
	}
	request.ActorDeviceSignature = ed25519.Sign(f.source.authorPrivateKey, signing)
}

func (f *federatedPrivateCommentFixture) completePrivateVote(t *testing.T, request *privatecontentpb.VotePrivatePollRequest) *privatecontentpb.VotePrivatePollResponse {
	t.Helper()
	if _, err := f.receiver.service.VotePrivatePoll(f.ctx, f.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("first federated ballot must remain pending: %v", err)
	}
	f.deliverCommand(t, request.GetCommandId())
	f.deliverResult(t, request.GetCommandId())
	response, err := f.receiver.service.VotePrivatePoll(f.ctx, f.bobAuthor, request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func TestFederatedPrivatePollSignedReplaceReplayAndProjection(t *testing.T) {
	parent := privatePollPrepareFixture(t, 2)
	fixture := newFederatedPrivateReactionFixture(t, parent)
	authority := parent.GetPollAuthority()
	first := fixture.privateVoteRequest(t, authority, "private-ballot-first", 0)
	response := fixture.completePrivateVote(t, first)
	firstAdmittedAt := proto.Clone(response.GetAdmittedAt()).(*timestamppb.Timestamp)
	if response.GetVoterCount() != 1 || response.GetProjectionRevision() != 1 ||
		response.GetOptions()[0].GetVoteCount() != 1 || !response.GetOptions()[0].GetSelectedByViewer() ||
		response.GetOptions()[1].GetVoteCount() != 0 {
		t.Fatalf("first ballot has wrong counts or selection: %+v", response)
	}
	replacement := fixture.privateVoteRequest(t, authority, "private-ballot-replace", 1)
	fixture.source.clock.now = fixture.source.clock.now.Add(10 * time.Second)
	response = fixture.completePrivateVote(t, replacement)
	if response.GetVoterCount() != 1 || response.GetProjectionRevision() != 2 ||
		response.GetOptions()[0].GetVoteCount() != 0 || response.GetOptions()[1].GetVoteCount() != 1 {
		t.Fatalf("replacement incremented voter count or retained old choice: %+v", response)
	}
	multiple := fixture.privateVoteRequest(t, authority, "private-ballot-author", 0, 1)
	fixture.source.clock.now = fixture.source.clock.now.Add(10 * time.Second)
	authorResponse, err := fixture.source.service.VotePrivatePoll(fixture.ctx, fixture.source.author, multiple)
	if err != nil || authorResponse.GetVoterCount() != 2 || authorResponse.GetProjectionRevision() != 3 {
		t.Fatalf("same-source multi-choice ballot failed: %+v %v", authorResponse, err)
	}
	frame := federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetResourceKind() == privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POLL_PROJECTION &&
				message.GetPoll().GetCommandId() == multiple.GetCommandId() && message.GetTargetActor().GetPtid() == "ptid:bob"
		})
	if result, err := fixture.receiver.receiver.Receive(fixture.ctx, frame); err != nil || result.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("poll fanout failed: %+v %v", result, err)
	}
	for _, reader := range []struct {
		service *PrivateContentService
		viewer  *actormodel.ActorDeviceRef
	}{
		{fixture.source.service, fixture.source.author.Endpoint},
		{fixture.receiver.service, fixture.receiver.bob},
	} {
		read, err := reader.service.GetPrivateMoment(fixture.ctx, reader.viewer, fixture.postID)
		if err != nil {
			t.Fatal(err)
		}
		poll := read.GetResource().GetPrivateContent().GetPoll()
		if poll.GetVoterCount() != 2 || poll.GetProjectionRevision() != 3 ||
			poll.GetOptions()[0].GetVoteCount() != 1 || poll.GetOptions()[1].GetVoteCount() != 2 {
			t.Fatalf("original private read lost poll projection: %+v", poll)
		}
		if poll.GetOptions()[0].GetSelectedByViewer() != (reader.viewer.GetActor().GetPtid() == "ptid:alice") ||
			!poll.GetOptions()[1].GetSelectedByViewer() {
			t.Fatal("poll read leaked another viewer's selection")
		}
	}
	fixture.source.clock.now = authority.GetExpiresAt().AsTime().Add(time.Minute)
	replayed, err := fixture.receiver.service.VotePrivatePoll(fixture.ctx, fixture.bobAuthor, first)
	if err != nil || !replayed.GetExactReplay() || replayed.GetProjectionRevision() != 1 ||
		!proto.Equal(replayed.GetAdmittedAt(), firstAdmittedAt) {
		t.Fatalf("exact retry after cutoff changed original acceptance: %+v %v", replayed, err)
	}
	read, err := fixture.receiver.service.GetPrivateMoment(fixture.ctx, fixture.receiver.bob, fixture.postID)
	if err != nil || read.GetResource().GetPrivateContent().GetPoll().GetProjectionRevision() != 3 {
		t.Fatalf("old replay rolled back current results: %+v %v", read, err)
	}
}

func TestFederatedPrivatePollRejectsInvalidCommandsWithoutChangingBallot(t *testing.T) {
	parent := privatePollPrepareFixture(t, 1)
	fixture := newFederatedPrivateReactionFixture(t, parent)
	authority := parent.GetPollAuthority()
	first := fixture.privateVoteRequest(t, authority, "private-poll-valid", 0)
	fixture.completePrivateVote(t, first)
	for _, test := range []struct {
		name string
		edit func(*privatecontentpb.VotePrivatePollRequest)
		code socialdomain.PrivateContentErrorCode
	}{
		{"duplicate", func(r *privatecontentpb.VotePrivatePollRequest) {
			r.OpaqueOptionIds = append(r.OpaqueOptionIds, r.OpaqueOptionIds[0])
		}, socialdomain.PrivateContentPollInvalidSelection},
		{"outside", func(r *privatecontentpb.VotePrivatePollRequest) {
			r.OpaqueOptionIds = [][]byte{bytes.Repeat([]byte{0x44}, 32)}
		}, socialdomain.PrivateContentPollInvalidSelection},
		{"too-many", func(r *privatecontentpb.VotePrivatePollRequest) { r.OpaqueOptionIds = authority.GetOpaqueOptionIds() }, socialdomain.PrivateContentPollInvalidSelection},
		{"definition", func(r *privatecontentpb.VotePrivatePollRequest) { r.OptionSetSha256 = bytes.Repeat([]byte{0x55}, 32) }, socialdomain.PrivateContentPollDefinitionChanged},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := fixture.privateVoteRequest(t, authority, "private-poll-invalid-"+test.name, 0)
			test.edit(request)
			fixture.signPrivateVote(t, request)
			if _, err := fixture.source.service.VotePrivatePoll(fixture.ctx, fixture.source.author, request); !socialdomain.IsPrivateContentCode(err, test.code) {
				t.Fatalf("invalid ballot error = %v; want %s", err, test.code)
			}
		})
	}
	badSignature := fixture.privateVoteRequest(t, authority, "private-poll-bad-signature", 1)
	badSignature.ActorDeviceSignature[0] ^= 1
	if _, err := fixture.source.service.VotePrivatePoll(fixture.ctx, fixture.source.author, badSignature); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentUnauthorized) {
		t.Fatalf("invalid device signature accepted: %v", err)
	}
	fixture.source.clock.now = authority.GetExpiresAt().AsTime()
	closed := fixture.privateVoteRequest(t, authority, "private-poll-closed", 1)
	if _, err := fixture.source.service.VotePrivatePoll(fixture.ctx, fixture.source.author, closed); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentPollClosed) {
		t.Fatalf("source cutoff accepted a new ballot: %v", err)
	}
	read, err := fixture.source.service.GetPrivateMoment(fixture.ctx, fixture.source.author.Endpoint, fixture.postID)
	if err != nil || read.GetResource().GetPrivateContent().GetPoll().GetVoterCount() != 1 ||
		read.GetResource().GetPrivateContent().GetPoll().GetProjectionRevision() != 1 {
		t.Fatalf("rejected ballot changed source projection: %+v %v", read, err)
	}
}

func TestFederatedPrivatePollRevocationAndResultBinding(t *testing.T) {
	parent := privatePollPrepareFixture(t, 1)
	fixture := newFederatedPrivateReactionFixture(t, parent)
	request := fixture.privateVoteRequest(t, parent.GetPollAuthority(), "private-poll-security", 0)
	if _, err := fixture.receiver.service.VotePrivatePoll(fixture.ctx, fixture.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatal(err)
	}
	fixture.deliverCommand(t, request.GetCommandId())
	resultFrame := federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateResult,
		func(frame *federationdelivery.Frame) bool { return frame.GetPayloadId() == request.GetCommandId() })
	result := &privatecontentpb.FederatedPrivateInteractionResult{}
	if err := proto.Unmarshal(resultFrame.GetOpaquePayload(), result); err != nil {
		t.Fatal(err)
	}
	validResponse := &privatecontentpb.VotePrivatePollResponse{}
	if err := proto.Unmarshal(result.GetCanonicalResult(), validResponse); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		edit func(*privatecontentpb.VotePrivatePollResponse)
	}{
		{"selection", func(r *privatecontentpb.VotePrivatePollResponse) { r.Options[0].SelectedByViewer = false }},
		{"counts", func(r *privatecontentpb.VotePrivatePollResponse) { r.Options[1].VoteCount = 2 }},
		{"definition", func(r *privatecontentpb.VotePrivatePollResponse) { r.OptionSetSha256 = bytes.Repeat([]byte{0x88}, 32) }},
		{"post", func(r *privatecontentpb.VotePrivatePollResponse) {
			r.PostId = privateTestContentID("wrong-private-poll")
		}},
		{"late-admission", func(r *privatecontentpb.VotePrivatePollResponse) {
			r.AdmittedAt = parent.GetPollAuthority().GetExpiresAt()
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			response := proto.Clone(validResponse).(*privatecontentpb.VotePrivatePollResponse)
			test.edit(response)
			tampered := proto.Clone(result).(*privatecontentpb.FederatedPrivateInteractionResult)
			wire, err := socialdomain.CanonicalProtoBytes(response)
			if err != nil {
				t.Fatal(err)
			}
			tampered.CanonicalResult, tampered.CanonicalResultSha256 = wire, privateSHA256(wire)
			wire, err = socialdomain.CanonicalProtoBytes(tampered)
			if err != nil {
				t.Fatal(err)
			}
			frame := proto.Clone(resultFrame).(*federationdelivery.Frame)
			frame.FrameId += "-" + test.name
			frame.IdempotencyKey += "-" + test.name
			frame.OpaquePayload, frame.PayloadSha256 = wire, federationdelivery.PayloadSHA256(wire)
			signing, err := federationdelivery.SigningBytes(frame)
			if err != nil {
				t.Fatal(err)
			}
			frame.StationSignature = ed25519.Sign(fixture.source.stationSigner.privateKey, signing)
			deliveryResult, err := fixture.receiver.receiver.Receive(fixture.ctx, frame)
			if err != nil || deliveryResult.Disposition != federationdelivery.DispositionTerminal {
				t.Fatalf("bound but altered poll result accepted: %+v %v", deliveryResult, err)
			}
		})
	}
	fixture.deliverResult(t, request.GetCommandId())
	deniedViewer := proto.Clone(fixture.receiver.bob).(*actormodel.ActorDeviceRef)
	deniedViewer.Actor.Ptid = "ptid:unrelated"
	if _, err := fixture.receiver.service.GetPrivateMoment(fixture.ctx, deniedViewer, fixture.postID); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentNotFound) {
		t.Fatalf("unrelated viewer received poll results: %v", err)
	}
	lateFrame := federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetResourceKind() == privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POLL_PROJECTION &&
				message.GetTargetActor().GetPtid() == "ptid:bob"
		})
	deleted, err := fixture.source.service.DeletePrivateMoment(fixture.ctx, fixture.postID, "ptid:alice")
	if err != nil || !deleted {
		t.Fatalf("delete private poll: %v %v", deleted, err)
	}
	for _, table := range []string{"social_private_poll_ballots", "social_private_poll_choices", "social_private_poll_states", "social_private_poll_projections"} {
		assertTableCount(t, fixture.source.database, table, 0)
	}
	invalidation := federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateInvalidation,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceInvalidation{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil && message.GetTargetActor().GetPtid() == "ptid:bob"
		})
	if deliveryResult, err := fixture.receiver.receiver.Receive(fixture.ctx, invalidation); err != nil ||
		deliveryResult.Disposition != federationdelivery.DispositionAccepted {
		t.Fatalf("poll revocation failed: %+v %v", deliveryResult, err)
	}
	assertTableCount(t, fixture.receiver.database, "social_private_poll_projections", 0)
	if deliveryResult, err := fixture.receiver.receiver.Receive(fixture.ctx, lateFrame); err != nil ||
		deliveryResult.Disposition != federationdelivery.DispositionTerminal {
		t.Fatalf("revoked poll accepted delayed projection: %+v %v", deliveryResult, err)
	}
	if _, err := fixture.receiver.service.VotePrivatePoll(fixture.ctx, fixture.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentNotFound) {
		t.Fatalf("revoked ballot replay exposed results: %v", err)
	}
}

func TestFederatedPrivatePollFanoutFailureRollsBackAndRetriesExactCommand(t *testing.T) {
	parent := privatePollPrepareFixture(t, 1)
	fixture := newFederatedPrivateReactionFixture(t, parent)
	request := fixture.privateVoteRequest(t, parent.GetPollAuthority(), "private-poll-fanout-failure", 0)
	if _, err := fixture.receiver.service.VotePrivatePoll(fixture.ctx, fixture.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatal(err)
	}
	frame := federatedPrivateOutboxFrame(t, fixture.receiver.database, federationdelivery.PayloadKindSocialPrivateInteraction,
		func(frame *federationdelivery.Frame) bool { return frame.GetPayloadId() == request.GetCommandId() })
	bus := fixture.source.service.events.bus
	fixture.source.service.events.bus = func() events.EventBus { return nil }
	result, err := fixture.sourceReceiver.Receive(fixture.ctx, frame)
	fixture.source.service.events.bus = bus
	if err != nil || result.Disposition != federationdelivery.DispositionRetryable {
		t.Fatalf("missing event bus must remain retryable: %+v %v", result, err)
	}
	for _, table := range []string{"social_private_poll_ballots", "social_private_poll_choices", "social_private_poll_states", "social_private_poll_projections"} {
		assertTableCount(t, fixture.source.database, table, 0)
	}
	fixture.deliverCommand(t, request.GetCommandId())
	fixture.deliverResult(t, request.GetCommandId())
	response, err := fixture.receiver.service.VotePrivatePoll(fixture.ctx, fixture.bobAuthor, request)
	if err != nil || response.GetVoterCount() != 1 || response.GetProjectionRevision() != 1 {
		t.Fatalf("exact retry after failure changed counts: %+v %v", response, err)
	}
}

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

func TestFederatedPrivateCommentParentReadCountsRootAndReply(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	initial, err := fixture.receiver.service.GetPrivateMoment(
		fixture.ctx, fixture.receiver.bob, fixture.postID,
	)
	if err != nil {
		t.Fatal(err)
	}
	assertCount := func(want int64) {
		t.Helper()
		for _, reader := range []struct {
			service *PrivateContentService
			viewer  *actormodel.ActorDeviceRef
		}{
			{fixture.source.service, fixture.source.author.Endpoint},
			{fixture.receiver.service, fixture.receiver.bob},
		} {
			response, err := reader.service.GetPrivateMoment(fixture.ctx, reader.viewer, fixture.postID)
			if err != nil {
				t.Fatal(err)
			}
			metadata := response.GetResource().GetMetadata()
			if metadata.GetStats().GetCommentsCount() != want {
				t.Fatalf("%s parent comments = %d, want %d",
					reader.viewer.GetActor().GetPtid(), metadata.GetStats().GetCommentsCount(), want)
			}
			if response.GetPost() != nil && response.GetPost().GetStats().GetCommentsCount() != want {
				t.Fatalf("reaction parent projection comments = %d, want %d",
					response.GetPost().GetStats().GetCommentsCount(), want)
			}
			if !proto.Equal(metadata.GetAuthor(), initial.GetResource().GetMetadata().GetAuthor()) ||
				!proto.Equal(metadata.GetCreatedAt(), initial.GetResource().GetMetadata().GetCreatedAt()) {
				t.Fatal("comment count changed the parent's author or authored time")
			}
		}
	}
	assertCount(0)
	rootID := fixture.completeComment(t, "parent-count-root", "")
	assertCount(1)
	fixture.completeComment(t, "parent-count-reply", rootID)
	assertCount(2)
	page, err := fixture.receiver.service.ListPrivateComments(fixture.ctx, fixture.receiver.bob,
		&privatecontentpb.ListMomentCommentsRequest{PostId: fixture.postID, Limit: 1})
	if err != nil || len(page.GetComments()) != 1 || !page.GetHasMore() {
		t.Fatalf("single-row comment page = %+v, %v", page, err)
	}
	fixture.completeReact(t, fixture.reactRequest(t, "parent-count-like", actormodel.ReactionKind_REACTION_LIKE))
	assertCount(2)
}

func TestFederatedPrivateCommentReplacementReadsRootAndReply(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	rootID := fixture.completeComment(t, "replacement-root", "")
	replyID := fixture.completeComment(t, "replacement-reply", rootID)
	replacement := proto.Clone(fixture.receiver.bob).(*actormodel.ActorDeviceRef)
	replacement.DeviceId = "bob-replacement-device"
	before := make(map[string]*privatecontentpb.CommentResource)
	for _, commentID := range []string{rootID, replyID} {
		original, err := fixture.receiver.service.GetPrivateComment(
			fixture.ctx, fixture.receiver.bob, fixture.postID, commentID,
		)
		if err != nil {
			t.Fatal(err)
		}
		before[commentID] = original.GetComment()
		t.Run(commentID, func(t *testing.T) {
			read, err := fixture.receiver.service.GetPrivateComment(
				fixture.ctx, replacement, fixture.postID, commentID,
			)
			if err != nil {
				t.Fatal(err)
			}
			private := read.GetComment().GetPrivateContent()
			if private == nil || private.GetViewerEnvelope() != nil ||
				!proto.Equal(private.GetPayload(), original.GetComment().GetPrivateContent().GetPayload()) ||
				!proto.Equal(read.GetComment().GetMetadata(), original.GetComment().GetMetadata()) ||
				!proto.Equal(read.GetComment().GetMetadata().GetAuthor(),
					private.GetVerification().GetCommitProof().GetAuthor().GetActor()) ||
				private.GetVerification().GetReceiverVerifiedSenderSigningKey().GetActorPtid() != "ptid:bob" {
				t.Fatal("replacement read changed the committed Comment or proof author")
			}
		})
	}
	t.Run("page", func(t *testing.T) {
		page, err := fixture.receiver.service.ListPrivateComments(
			fixture.ctx, replacement,
			&privatecontentpb.ListMomentCommentsRequest{PostId: fixture.postID, Limit: 20},
		)
		if err != nil {
			t.Fatal(err)
		}
		if len(page.GetComments()) != 2 || page.GetHasMore() {
			t.Fatalf("replacement comment page = %+v", page)
		}
		for _, comment := range page.GetComments() {
			original := before[comment.GetMetadata().GetCommentId()]
			if original == nil || comment.GetPrivateContent().GetViewerEnvelope() != nil ||
				!proto.Equal(comment.GetMetadata(), original.GetMetadata()) ||
				!proto.Equal(comment.GetPrivateContent().GetPayload(), original.GetPrivateContent().GetPayload()) {
				t.Fatal("replacement page changed the committed root or reply")
			}
		}
	})
	t.Run("parent-count", func(t *testing.T) {
		parent, err := fixture.receiver.service.GetPrivateMoment(fixture.ctx, replacement, fixture.postID)
		if err != nil {
			t.Fatal(err)
		}
		if parent.GetResource().GetMetadata().GetStats().GetCommentsCount() != 2 {
			t.Fatalf("replacement parent comments = %d, want 2",
				parent.GetResource().GetMetadata().GetStats().GetCommentsCount())
		}
	})
	t.Run("policy", func(t *testing.T) {
		policy, err := fixture.receiver.service.CheckMomentReadPolicy(fixture.ctx, replacement,
			&privatecontentpb.CheckMomentReadPolicyRequest{Targets: []*privatecontentpb.MomentReadPolicyTarget{
				{ItemId: "root", PostId: fixture.postID, CommentId: rootID},
				{ItemId: "reply", PostId: fixture.postID, CommentId: replyID},
			}})
		if err != nil {
			t.Fatal(err)
		}
		for _, outcome := range policy.GetOutcomes() {
			if outcome.GetDecision() != privatecontentpb.MomentReadDecision_MOMENT_READ_DECISION_READABLE {
				t.Fatalf("replacement policy = %+v", policy)
			}
		}
	})
	t.Run("recoverable-history", func(t *testing.T) {
		history, err := fixture.receiver.service.ListRecoverablePrivateContent(fixture.ctx,
			replacement.GetActor().GetPtid(),
			&privatecontentpb.ListRecoverablePrivateContentRequest{Limit: 100})
		if err != nil {
			t.Fatal(err)
		}
		seen := make(map[string]bool)
		for _, resource := range history.GetResources() {
			seen[resource.GetResource().GetContentId()] = true
		}
		if !seen[rootID] || !seen[replyID] || !seen[fixture.postID] {
			t.Fatal("original recovery history lost the parent, root or reply")
		}
	})
	t.Run("replacement-reactions", func(t *testing.T) {
		author := fixture.bobAuthor
		author.Endpoint = replacement
		for _, commentID := range []string{rootID, replyID} {
			like := fixture.reactRequest(t, "replacement-like-"+commentID, actormodel.ReactionKind_REACTION_LIKE)
			like.CommentId = commentID
			fixture.signReaction(t, like)
			if _, err := fixture.receiver.service.ReactPrivateMoment(fixture.ctx, author, like); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
				t.Fatalf("readable recovered Comment rejected LIKE admission: %v", err)
			}
			unlike := fixture.unreactRequest(t, "replacement-unlike-"+commentID, actormodel.ReactionKind_REACTION_LIKE)
			unlike.CommentId = commentID
			fixture.signReaction(t, unlike)
			if _, err := fixture.receiver.service.UnreactPrivateMoment(fixture.ctx, author, unlike); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
				t.Fatalf("readable recovered Comment rejected UNLIKE admission: %v", err)
			}
			for _, commandID := range []string{like.GetCommandId(), unlike.GetCommandId()} {
				frame := federatedPrivateOutboxFrame(t, fixture.receiver.database,
					federationdelivery.PayloadKindSocialPrivateInteraction,
					func(frame *federationdelivery.Frame) bool { return frame.GetPayloadId() == commandID })
				command := &privatecontentpb.FederatedPrivateInteractionCommand{}
				if err := proto.Unmarshal(frame.GetOpaquePayload(), command); err != nil ||
					!proto.Equal(command.GetActor(), replacement) {
					t.Fatalf("replacement command lost its original device binding: %+v, %v", command, err)
				}
			}
		}
	})
}

func TestFederatedPrivateCommentResultAndResourceDeliveryOrder(t *testing.T) {
	for _, deliveryFirst := range []bool{false, true} {
		t.Run(fmt.Sprintf("delivery-first-%t", deliveryFirst), func(t *testing.T) {
			fixture := newFederatedPrivateReactionFixture(t)
			prepared := fixture.completePrepare(t, fixture.prepareRequest(t, "prepare-order", "order"))
			submit := fixture.submitRequest(t, prepared.GetPlan(), "submit-order")
			if _, err := fixture.receiver.service.SubmitPrivateCommentForAuthor(fixture.ctx,
				fixture.bobAuthor, submit); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
				t.Fatalf("initial submit = %v", err)
			}
			fixture.deliverCommand(t, submit.GetCommandId())
			resultFrame := federatedPrivateOutboxFrame(t, fixture.source.database,
				federationdelivery.PayloadKindSocialPrivateResult,
				func(frame *federationdelivery.Frame) bool { return frame.GetPayloadId() == submit.GetCommandId() })
			result := &privatecontentpb.FederatedPrivateInteractionResult{}
			response := &privatecontentpb.SubmitPrivateCommentResponse{}
			if err := proto.Unmarshal(resultFrame.GetOpaquePayload(), result); err != nil {
				t.Fatal(err)
			}
			if err := proto.Unmarshal(result.GetCanonicalResult(), response); err != nil {
				t.Fatal(err)
			}
			commentID := response.GetComment().GetMetadata().GetCommentId()
			receiveResult := func() {
				t.Helper()
				result, err := fixture.receiver.receiver.Receive(fixture.ctx, resultFrame)
				if err != nil || (result.Disposition != federationdelivery.DispositionAccepted &&
					result.Disposition != federationdelivery.DispositionDuplicate) {
					t.Fatalf("receive result = %+v, %v", result, err)
				}
			}
			if deliveryFirst {
				fixture.deliverAuthorComment(t, commentID)
			}
			receiveResult()
			if !deliveryFirst {
				if _, err := fixture.receiver.service.GetPrivateComment(fixture.ctx,
					fixture.receiver.bob, fixture.postID, commentID); err == nil {
					t.Fatal("result alone created a partial resource projection")
				}
				fixture.deliverAuthorComment(t, commentID)
			}
			receiveResult()
			fixture.deliverAuthorComment(t, commentID)
			replacement := proto.Clone(fixture.receiver.bob).(*actormodel.ActorDeviceRef)
			replacement.DeviceId = "bob-replacement-device"
			if _, err := fixture.receiver.service.GetPrivateComment(fixture.ctx,
				replacement, fixture.postID, commentID); err != nil {
				t.Fatal(err)
			}
			parent, err := fixture.receiver.service.GetPrivateMoment(fixture.ctx, replacement, fixture.postID)
			if err != nil || parent.GetResource().GetMetadata().GetStats().GetCommentsCount() != 1 {
				t.Fatalf("duplicate deliveries changed parent count: %+v, %v", parent, err)
			}
		})
	}
}

func TestFederatedPrivateCommentRecoveryRejectsMissingAmbiguousAndTamperedEnvelopes(t *testing.T) {
	for _, name := range []string{"missing", "ambiguous", "actor", "resource", "payload", "sender", "signature"} {
		t.Run(name, func(t *testing.T) {
			fixture := newFederatedPrivateReactionFixture(t)
			commentID := fixture.completeComment(t, "invalid-recovery-"+name, "")
			replacement := proto.Clone(fixture.receiver.bob).(*actormodel.ActorDeviceRef)
			replacement.DeviceId = "bob-replacement-device"
			rows := func() *gorm.DB {
				return fixture.receiver.database.Table("social_remote_private_envelopes").
					Where("content_id = ? AND target_actor_ptid = ? AND recipient_key_kind = ?",
						commentID, "ptid:bob", int32(securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY))
			}
			var row struct{ EnvelopeBytes []byte }
			if err := rows().Take(&row).Error; err != nil {
				t.Fatal(err)
			}
			envelope := &securecontentpb.ViewerContentKeyEnvelope{}
			if err := proto.Unmarshal(row.EnvelopeBytes, envelope); err != nil {
				t.Fatal(err)
			}
			switch name {
			case "missing":
				if err := fixture.receiver.database.Exec(`DELETE FROM social_remote_private_envelopes
					WHERE content_id = ? AND target_actor_ptid = ? AND recipient_key_kind = ?`,
					commentID, "ptid:bob",
					int32(securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY)).Error; err != nil {
					t.Fatal(err)
				}
			case "ambiguous":
				if err := fixture.receiver.database.Exec(`INSERT INTO social_remote_private_envelopes
					(source_station_peer_id, content_id, generation, target_actor_ptid, recipient_key_kind,
					 recipient_device_id, one_time_key_id, envelope_bytes, principal_epoch)
					SELECT source_station_peer_id, content_id, generation, target_actor_ptid, recipient_key_kind,
					 recipient_device_id, 'ambiguous-key', envelope_bytes, principal_epoch
					FROM social_remote_private_envelopes WHERE content_id = ? AND target_actor_ptid = ?
					 AND recipient_key_kind = ?`, commentID, "ptid:bob",
					int32(securecontentpb.ContentPreKeyKind_CONTENT_PREKEY_KIND_ACTOR_RECOVERY)).Error; err != nil {
					t.Fatal(err)
				}
			default:
				switch name {
				case "actor":
					envelope.GetRecoveryActor().Ptid = "ptid:eve"
				case "resource":
					envelope.Binding.Resource.ContentId = "wrong-resource"
				case "payload":
					envelope.Binding.PayloadCiphertextSha256[0] ^= 1
				case "sender":
					envelope.Binding.Sender.Actor.Ptid = "ptid:eve"
				case "signature":
					envelope.SenderSignature[0] ^= 1
				}
				canonical, err := securecontentkernel.CanonicalEnvelopeBindingBytes(envelope.Binding)
				if err != nil {
					t.Fatal(err)
				}
				envelope.BindingSha256 = privateSHA256(canonical)
				encoded, err := proto.Marshal(envelope)
				if err != nil {
					t.Fatal(err)
				}
				if err := rows().Update("envelope_bytes", encoded).Error; err != nil {
					t.Fatal(err)
				}
			}
			if _, err := fixture.receiver.service.GetPrivateComment(fixture.ctx, replacement,
				fixture.postID, commentID); err == nil {
				t.Fatal("invalid recovery envelope was admitted by point read")
			}
			if _, err := fixture.receiver.service.ListPrivateComments(fixture.ctx, replacement,
				&privatecontentpb.ListMomentCommentsRequest{PostId: fixture.postID, Limit: 20}); err == nil {
				t.Fatal("invalid recovery envelope was admitted by page read")
			}
		})
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
	responseVerification := response.GetComment().
		GetPrivateContent().
		GetVerification()
	if responseVerification.GetStationSigningKeyAttestation().
		GetStationPeerId() != "station-remote" ||
		responseVerification.GetStationSigningKeyAttestation().
			GetProofSigningKeyId() !=
			responseVerification.GetCommitProof().GetStationSigningKeyId() {
		t.Fatalf("localized Comment proof attestation = %+v", response)
	}
	assertPrivateContentCount(
		t,
		fixture.source.database,
		&dbmodel.SocialPrivateContentComment{},
		1,
	)
	sourcePage, err := fixture.source.service.ListPrivateComments(
		fixture.ctx,
		fixture.source.author.Endpoint,
		&privatecontentpb.ListMomentCommentsRequest{
			PostId: fixture.postID,
			Limit:  20,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(sourcePage.GetComments()) != 1 {
		t.Fatalf("source Comment page = %+v", sourcePage)
	}
	sourceVerification := sourcePage.GetComments()[0].
		GetPrivateContent().
		GetVerification()
	if sourcePage.GetComments()[0].GetMetadata().GetCommentId() != commentID ||
		sourceVerification.GetReceiverVerifiedSenderSigningKey().
			GetActorPtid() != "ptid:bob" ||
		sourceVerification.GetReceiverVerifiedSenderSigningKey().
			GetHomeStationPeerId() != "station-remote" {
		t.Fatalf("source Comment page = %+v", sourcePage)
	}
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

func TestFederatedPrivateReactionReactUnreact(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	react := fixture.reactRequest(t, "react-remote", actormodel.ReactionKind_REACTION_LIKE)

	if _, err := fixture.receiver.service.ReactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		react,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial react error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, react.GetCommandId())
	fixture.deliverResult(t, react.GetCommandId())

	response, err := fixture.receiver.service.ReactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		react,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !response.GetSuccess() ||
		response.GetCommandId() != react.GetCommandId() ||
		!response.GetExactReplay() ||
		response.GetProjectionRevision() != 1 {
		t.Fatalf("remote react response = %+v", response)
	}
	assertFederatedPrivateReactionSummary(
		t,
		response.GetReactions(),
		actormodel.ReactionKind_REACTION_LIKE,
		1,
		true,
	)
	assertTableCount(t, fixture.source.database, "social_reactions", 1)
	assertTableCount(t, fixture.receiver.database, "social_reactions", 0)
	assertTableCount(
		t,
		fixture.source.database,
		"social_private_reaction_projections",
		2,
	)
	assertTableCount(
		t,
		fixture.receiver.database,
		"social_private_reaction_projections",
		1,
	)
	assertFederatedPrivateReactionEvent(
		t,
		fixture.sourceSubscription,
		fixture.postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
		false,
	)
	assertFederatedPrivateReactionEvent(
		t,
		fixture.receiver.subscription,
		fixture.postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
		false,
	)
	fixture.assertReactionReadback(
		t,
		fixture.source.service,
		fixture.source.author.Endpoint,
		1,
		1,
		false,
	)
	fixture.assertReactionReadback(
		t,
		fixture.receiver.service,
		fixture.receiver.bob,
		1,
		1,
		true,
	)

	unreact := fixture.unreactRequest(
		t,
		"unreact-remote",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	if _, err := fixture.receiver.service.UnreactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		unreact,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial unreact error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, unreact.GetCommandId())
	fixture.deliverResult(t, unreact.GetCommandId())

	unreacted, err := fixture.receiver.service.UnreactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		unreact,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !unreacted.GetSuccess() ||
		unreacted.GetCommandId() != unreact.GetCommandId() ||
		!unreacted.GetExactReplay() ||
		unreacted.GetProjectionRevision() != 2 ||
		len(unreacted.GetReactions()) != 0 {
		t.Fatalf("remote unreact response = %+v", unreacted)
	}
	assertTableCount(t, fixture.source.database, "social_reactions", 0)
	assertTableCount(t, fixture.receiver.database, "social_reactions", 0)
	assertFederatedPrivateReactionEvent(
		t,
		fixture.sourceSubscription,
		fixture.postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
		true,
	)
	assertFederatedPrivateReactionEvent(
		t,
		fixture.receiver.subscription,
		fixture.postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
		true,
	)
	fixture.assertReactionReadback(
		t,
		fixture.source.service,
		fixture.source.author.Endpoint,
		2,
		0,
		false,
	)
	fixture.assertReactionReadback(
		t,
		fixture.receiver.service,
		fixture.receiver.bob,
		2,
		0,
		false,
	)
}

func TestFederatedPrivateCommentReactionsKeepTypedTargetsAndReadback(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	root := fixture.completeComment(t, "reaction-root", "")
	reply := fixture.completeComment(t, "reaction-reply", root)
	for index, commentID := range []string{root, reply} {
		request := fixture.reactRequest(t, fmt.Sprintf("comment-like-%d", index), actormodel.ReactionKind_REACTION_LIKE)
		request.CommentId = commentID
		fixture.signReaction(t, request)
		response := fixture.completeReact(t, request)
		if response.GetCommentId() != commentID || response.GetProjectionRevision() != 1 {
			t.Fatalf("comment result identity = %+v", response)
		}
		fixture.assertCommentReactionReadback(t, commentID, 1, 1, true)
		post, err := fixture.source.service.GetPrivateMoment(fixture.ctx, fixture.source.author.Endpoint, fixture.postID)
		if err != nil || post.GetReactionProjectionRevision() != 0 ||
			post.GetResource().GetMetadata().GetStats().GetLikesCount() != 0 {
			t.Fatalf("comment reaction changed parent stats: %+v, %v", post, err)
		}
		replayed, err := fixture.receiver.service.ReactPrivateMoment(fixture.ctx, fixture.bobAuthor, request)
		if err != nil || !replayed.GetExactReplay() || replayed.GetProjectionRevision() != 1 {
			t.Fatalf("typed exact replay = %+v, %v", replayed, err)
		}
		changedTarget := proto.Clone(request).(*actormodel.ReactToPostRequest)
		changedTarget.CommentId = fixture.postID
		fixture.signReaction(t, changedTarget)
		if _, err := fixture.receiver.service.ReactPrivateMoment(fixture.ctx, fixture.bobAuthor, changedTarget); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentConflict) {
			t.Fatalf("same command with changed target = %v", err)
		}
	}
	unreact := fixture.unreactRequest(t, "comment-unlike", actormodel.ReactionKind_REACTION_LIKE)
	unreact.CommentId = root
	fixture.signReaction(t, unreact)
	if _, err := fixture.receiver.service.UnreactPrivateMoment(fixture.ctx, fixture.bobAuthor, unreact); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("unlike pending = %v", err)
	}
	fixture.deliverCommand(t, unreact.GetCommandId())
	fixture.deliverResult(t, unreact.GetCommandId())
	fixture.assertCommentReactionReadback(t, root, 2, 0, false)
	fixture.assertCommentReactionReadback(t, reply, 1, 1, true)
}

func TestPrivateCommentReactionRejectsWrongParentDeletedAndTargetTampering(t *testing.T) {
	t.Run("wrong parent", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		commentID := fixture.completeComment(t, "wrong-parent-comment", "")
		fixture.source.audiences.snapshot = fixture.source.originalSnapshot
		fixture.source.audiences.snapshot.RecipientLocalities = []socialdomain.RecipientLocality{
			{ActorPTID: "ptid:bob", HomeStationPeerID: "station-remote", FederationID: "federation-one"},
		}
		fixture.source.service.recipients = &privateContentRemoteRecipientDirectory{
			delegate:   privateContentTestRecipients{author: fixture.source.author.Endpoint},
			localities: fixture.source.audiences.snapshot.RecipientLocalities,
		}
		secondPostID := publishPrivateCommentParent(t, fixture.source, "reaction-second-parent")
		request := fixture.reactRequest(t, "wrong-parent-reaction", actormodel.ReactionKind_REACTION_LIKE)
		request.PostId = secondPostID
		request.CommentId = commentID
		fixture.signReaction(t, request)
		if _, err := fixture.source.service.ReactPrivateMoment(fixture.ctx, fixture.source.author, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentNotFound) {
			t.Fatalf("valid comment under wrong readable parent = %v", err)
		}
		assertTableCount(t, fixture.source.database, "social_reactions", 0)
	})
	t.Run("deleted comment", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		commentID := fixture.completeComment(t, "deleted-reaction-comment", "")
		request := fixture.reactRequest(t, "deleted-comment-reaction", actormodel.ReactionKind_REACTION_LIKE)
		request.CommentId = commentID
		fixture.signReaction(t, request)
		if _, err := fixture.receiver.service.ReactPrivateMoment(fixture.ctx, fixture.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
			t.Fatalf("initial reaction = %v", err)
		}
		if err := fixture.source.database.Model(&dbmodel.SocialPrivateContentComment{}).
			Where("comment_id = ?", commentID).
			Updates(map[string]any{"lifecycle_state": "DELETED", "deleted_at": fixture.source.clock.now}).Error; err != nil {
			t.Fatal(err)
		}
		fixture.deliverCommand(t, request.GetCommandId())
		fixture.deliverResult(t, request.GetCommandId())
		if _, err := fixture.receiver.service.ReactPrivateMoment(fixture.ctx, fixture.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentNotFound) {
			t.Fatalf("deleted comment reaction = %v", err)
		}
		assertTableCount(t, fixture.source.database, "social_reactions", 0)
	})
	t.Run("unsigned target substitution", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		commentID := fixture.completeComment(t, "signed-target-comment", "")
		request := fixture.reactRequest(t, "signature-target-substitution", actormodel.ReactionKind_REACTION_LIKE)
		request.CommentId = commentID
		if _, err := fixture.source.service.ReactPrivateMoment(fixture.ctx, fixture.source.author, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentUnauthorized) {
			t.Fatalf("substituted target retained a valid signature: %v", err)
		}
		assertTableCount(t, fixture.source.database, "social_reactions", 0)
	})
	t.Run("source replay after grant loss", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		commentID := fixture.completeComment(t, "replay-grant-comment", "")
		request := fixture.reactRequest(t, "replay-grant-reaction", actormodel.ReactionKind_REACTION_LIKE)
		request.CommentId = commentID
		fixture.signReaction(t, request)
		fixture.completeReact(t, request)
		frame := federatedPrivateOutboxFrame(t, fixture.receiver.database,
			federationdelivery.PayloadKindSocialPrivateInteraction,
			func(frame *federationdelivery.Frame) bool { return frame.GetPayloadId() == request.GetCommandId() })
		command := &privatecontentpb.FederatedPrivateInteractionCommand{}
		if err := proto.Unmarshal(frame.GetOpaquePayload(), command); err != nil {
			t.Fatal(err)
		}
		if err := fixture.source.database.Exec(
			"DELETE FROM social_relationship_projections WHERE owner_ptid = ? AND peer_ptid = ?",
			"ptid:alice", "ptid:bob").Error; err != nil {
			t.Fatal(err)
		}
		var result federationdelivery.Result
		if err := fixture.source.store.Execute(fixture.ctx, func(tx infrastructure.PrivateContentTransaction) error {
			var err error
			result, err = fixture.source.service.ReceiveFederatedPrivateInteractionCommand(
				fixture.ctx, tx.ContentPreKeyValidationTransaction(), command, frame)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if result.Disposition != federationdelivery.DispositionTerminal {
			t.Fatalf("source replay reopened a revoked grant: %+v", result)
		}
	})
	t.Run("result target substitution", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		commentID := fixture.completeComment(t, "result-target-comment", "")
		request := fixture.reactRequest(t, "result-target-reaction", actormodel.ReactionKind_REACTION_LIKE)
		request.CommentId = commentID
		fixture.signReaction(t, request)
		if _, err := fixture.receiver.service.ReactPrivateMoment(fixture.ctx, fixture.bobAuthor, request); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
			t.Fatalf("initial reaction = %v", err)
		}
		frame := federatedPrivateOutboxFrame(t, fixture.receiver.database,
			federationdelivery.PayloadKindSocialPrivateInteraction,
			func(frame *federationdelivery.Frame) bool { return frame.GetPayloadId() == request.GetCommandId() })
		command := &privatecontentpb.FederatedPrivateInteractionCommand{}
		if err := proto.Unmarshal(frame.GetOpaquePayload(), command); err != nil {
			t.Fatal(err)
		}
		forged, err := socialdomain.CanonicalProtoBytes(&actormodel.ReactToPostResponse{
			Success: true, CommandId: request.GetCommandId(), CommentId: fixture.postID,
			ProjectionRevision: 1, Reactions: []*actormodel.ReactionSummary{
				{Kind: actormodel.ReactionKind_REACTION_LIKE, Count: 1, ReactedByViewer: true},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		if err := fixture.receiver.service.store.Execute(fixture.ctx, func(tx infrastructure.PrivateContentTransaction) error {
			return fixture.receiver.service.importFederatedPrivateReactionResult(
				fixture.ctx, tx.ContentPreKeyValidationTransaction(), command, forged, frame)
		}); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentIntegrityFailed) {
			t.Fatalf("result target substitution = %v", err)
		}
		assertTableCount(t, fixture.receiver.database, "social_private_reaction_projections", 0)
	})
}

func TestFederatedPrivateReactionReplayAndHashConflict(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	request := fixture.reactRequest(
		t,
		"react-replay",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	response := fixture.completeReact(t, request)
	commandFrame := federatedPrivateOutboxFrame(
		t,
		fixture.receiver.database,
		federationdelivery.PayloadKindSocialPrivateInteraction,
		func(frame *federationdelivery.Frame) bool {
			return frame.GetPayloadId() == request.GetCommandId()
		},
	)
	duplicate, err := fixture.sourceReceiver.Receive(fixture.ctx, commandFrame)
	if err != nil ||
		duplicate.Disposition != federationdelivery.DispositionDuplicate {
		t.Fatalf("duplicate reaction command = %+v, %v", duplicate, err)
	}
	replayed, err := fixture.receiver.service.ReactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !replayed.GetExactReplay() ||
		replayed.GetProjectionRevision() != response.GetProjectionRevision() ||
		!proto.Equal(
			&actormodel.Post{Reactions: response.GetReactions()},
			&actormodel.Post{Reactions: replayed.GetReactions()},
		) {
		t.Fatalf("exact reaction replay = %+v, first = %+v", replayed, response)
	}
	assertTableCount(t, fixture.source.database, "social_reactions", 1)

	conflict := fixture.reactRequest(
		t,
		request.GetCommandId(),
		actormodel.ReactionKind_REACTION_LOVE,
	)
	if _, err := fixture.receiver.service.ReactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		conflict,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentConflict) {
		t.Fatalf("changed-hash reaction error = %v, want conflict", err)
	}
	assertTableCount(t, fixture.source.database, "social_reactions", 1)
}

func TestFederatedPrivateReactionRejectsInvalidSignatureAndRevokedParent(
	t *testing.T,
) {
	t.Run("invalid signature", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		request := fixture.reactRequest(
			t,
			"react-invalid-signature",
			actormodel.ReactionKind_REACTION_LIKE,
		)
		request.ActorDeviceSignature[0] ^= 1
		if _, err := fixture.receiver.service.ReactPrivateMoment(
			fixture.ctx,
			fixture.bobAuthor,
			request,
		); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
			t.Fatalf("initial react error = %v, want pending dependency", err)
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
			t.Fatalf("invalid reaction signature disposition = %+v", result)
		}
		assertTableCount(t, fixture.source.database, "social_reactions", 0)
	})

	t.Run("revoked parent", func(t *testing.T) {
		fixture := newFederatedPrivateReactionFixture(t)
		request := fixture.reactRequest(
			t,
			"react-revoked-parent",
			actormodel.ReactionKind_REACTION_LIKE,
		)
		if _, err := fixture.receiver.service.ReactPrivateMoment(
			fixture.ctx,
			fixture.bobAuthor,
			request,
		); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
			t.Fatalf("initial react error = %v, want pending dependency", err)
		}
		deletedAt := fixture.source.clock.now.Add(time.Second)
		update := fixture.source.database.Model(&dbmodel.SocialPrivateContentPost{}).
			Where("post_id = ?", fixture.postID).
			Updates(map[string]any{
				"lifecycle_state": "DELETED",
				"deleted_at":      deletedAt,
				"updated_at":      deletedAt,
			})
		if update.Error != nil || update.RowsAffected != 1 {
			t.Fatalf(
				"delete parent rows = %d, error = %v",
				update.RowsAffected,
				update.Error,
			)
		}
		fixture.deliverCommand(t, request.GetCommandId())
		fixture.deliverResult(t, request.GetCommandId())
		if _, err := fixture.receiver.service.ReactPrivateMoment(
			fixture.ctx,
			fixture.bobAuthor,
			request,
		); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentNotFound) {
			t.Fatalf("revoked parent reaction error = %v, want not found", err)
		}
		assertTableCount(t, fixture.source.database, "social_reactions", 0)
	})
}

func TestFederatedPrivateReactionReceiverProjectionIsMonotonic(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	first := fixture.reactRequest(
		t,
		"react-monotonic-1",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	fixture.completeReact(t, first)
	assertFederatedPrivateReactionEvent(
		t,
		fixture.receiver.subscription,
		fixture.postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
		false,
	)

	second := fixture.unreactRequest(
		t,
		"react-monotonic-2",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	if _, err := fixture.receiver.service.UnreactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		second,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial unreact error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, second.GetCommandId())

	third := fixture.reactRequest(
		t,
		"react-monotonic-3",
		actormodel.ReactionKind_REACTION_LIKE,
	)
	if _, err := fixture.receiver.service.ReactPrivateMoment(
		fixture.ctx,
		fixture.bobAuthor,
		third,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("second react error = %v, want pending dependency", err)
	}
	fixture.deliverCommand(t, third.GetCommandId())
	fixture.deliverResult(t, third.GetCommandId())
	fixture.deliverResult(t, second.GetCommandId())

	var projection struct {
		ProjectionRevision uint64 `gorm:"column:projection_revision"`
	}
	if err := fixture.receiver.database.
		Table("social_private_reaction_projections").
		Where(
			"source_station_peer_id = ? AND post_id = ? AND viewer_ptid = ?",
			"station-local",
			fixture.postID,
			"ptid:bob",
		).
		Take(&projection).Error; err != nil {
		t.Fatal(err)
	}
	if projection.ProjectionRevision != 3 {
		t.Fatalf(
			"receiver reaction projection revision = %d, want 3",
			projection.ProjectionRevision,
		)
	}
	fixture.assertReactionReadback(
		t,
		fixture.receiver.service,
		fixture.receiver.bob,
		3,
		1,
		true,
	)
	assertTableCount(t, fixture.receiver.database, "social_reactions", 0)
	assertFederatedPrivateReactionEvent(
		t,
		fixture.receiver.subscription,
		fixture.postID,
		"ptid:bob",
		actormodel.ReactionKind_REACTION_LIKE,
		false,
	)
	select {
	case event := <-fixture.receiver.subscription.Events:
		t.Fatalf("stale reaction projection emitted an event: %+v", event)
	case <-time.After(100 * time.Millisecond):
	}
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

func newFederatedPrivateReactionFixture(
	t *testing.T,
	parentRequests ...*privatecontentpb.PreparePrivateMomentRequest,
) *federatedPrivateCommentFixture {
	t.Helper()
	fixture := newFederatedPrivateCommentFixture(t, parentRequests...)
	for name, database := range map[string]*gorm.DB{
		"source":   fixture.source.database,
		"receiver": fixture.receiver.database,
	} {
		if err := database.AutoMigrate(
			&dbmodel.Actor{},
			&dbmodel.Follow{},
			&dbmodel.SocialReaction{},
			&dbmodel.SocialStationModerationPolicy{},
		); err != nil {
			t.Fatalf("migrate %s reaction table: %v", name, err)
		}
		relationships, err := infrastructure.NewGORMFederatedFriendRequestStore(database, fixture.source.clock)
		if err != nil {
			t.Fatal(err)
		}
		if err := relationships.Migrate(fixture.ctx); err != nil {
			t.Fatal(err)
		}
		if err := relationships.MigrateRelationshipAuthority(fixture.ctx); err != nil {
			t.Fatal(err)
		}
	}
	for _, actor := range []dbmodel.Actor{
		{
			PTID:              "ptid:alice",
			Namespace:         "peers",
			PreferredUsername: "alice",
			Email:             "alice@station.test",
			PasswordHash:      "test",
		},
		{
			PTID:              "ptid:bob",
			Namespace:         "peers",
			PreferredUsername: "bob",
			Email:             "bob@station.remote",
			PasswordHash:      "test",
			FederatedHandle:   "bob@station.remote",
			HomeStationPeerID: "station-remote",
			Origin:            "remote_cached",
		},
	} {
		if err := fixture.source.database.
			Where("ptid = ?", actor.PTID).
			FirstOrCreate(&actor).Error; err != nil {
			t.Fatalf("seed reaction actor %s: %v", actor.PTID, err)
		}
	}
	return fixture
}

func TestFederatedPrivateReactionDeliveryConvergesOtherReadersAndRejectsStaleTargets(t *testing.T) {
	fixture := newFederatedPrivateReactionFixture(t)
	charlie := &actormodel.ActorDeviceRef{Actor: &actormodel.ActorRef{
		Ptid: "ptid:charlie", Acct: "charlie@station.remote", Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
	}, DeviceId: "bob-device"}
	row := dbmodel.Actor{PTID: "ptid:charlie", Namespace: "peers", PreferredUsername: "charlie",
		Email: "charlie@station.remote", PasswordHash: "test", FederatedHandle: "charlie@station.remote", HomeStationPeerID: "station-remote"}
	if err := fixture.source.database.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	for _, database := range []*gorm.DB{fixture.source.database, fixture.receiver.database} {
		for _, owner := range []string{"ptid:alice", "ptid:bob"} {
			if err := database.Exec(`INSERT INTO social_relationship_projections
				(owner_ptid, peer_ptid, request_id, accepted_event_id, accepted_event_hash, accepted_at)
				VALUES (?, ?, ?, ?, ?, ?)`, owner, "ptid:charlie", "charlie-"+owner, "charlie-"+owner,
				privateDigest("charlie-"+owner), fixture.source.clock.now).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	sourceRepos := infrastructure.NewRepos(fixture.source.database)
	for _, edge := range [][2]string{{"ptid:bob", "ptid:charlie"}, {"ptid:charlie", "ptid:bob"}} {
		if err := sourceRepos.Follows.Follow(fixture.ctx, edge[0], edge[1]); err != nil {
			t.Fatal(err)
		}
	}
	reactionFrame := func(commandID, targetPTID string) *federationdelivery.Frame {
		return federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateResource,
			func(frame *federationdelivery.Frame) bool {
				message := &privatecontentpb.FederatedPrivateResourceDelivery{}
				return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
					message.GetReaction().GetCommandId() == commandID && message.GetTargetActor().GetPtid() == targetPTID
			})
	}
	receive := func(frame *federationdelivery.Frame, want federationdelivery.Disposition) {
		t.Helper()
		result, err := fixture.receiver.receiver.Receive(fixture.ctx, frame)
		if err != nil || result.Disposition != want {
			t.Fatalf("reaction delivery = %+v, %v; want %v", result, err, want)
		}
	}
	first := fixture.reactRequest(t, "other-reader-like", actormodel.ReactionKind_REACTION_LIKE)
	fixture.completeReact(t, first)
	frame := reactionFrame(first.GetCommandId(), charlie.GetActor().GetPtid())
	receive(frame, federationdelivery.DispositionAccepted)
	fixture.assertReactionReadback(t, fixture.receiver.service, charlie, 1, 1, false)
	// The independent result path and resource path converge at the same
	// target/revision without manufacturing a second projection or event.
	receive(reactionFrame(first.GetCommandId(), "ptid:bob"), federationdelivery.DispositionDuplicate)
	fixture.assertReactionReadback(t, fixture.receiver.service, fixture.receiver.bob, 1, 1, true)

	unlike := fixture.unreactRequest(t, "other-reader-unlike", actormodel.ReactionKind_REACTION_LIKE)
	if _, err := fixture.receiver.service.UnreactPrivateMoment(fixture.ctx, fixture.bobAuthor, unlike); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatal(err)
	}
	fixture.deliverCommand(t, unlike.GetCommandId())
	fixture.deliverResult(t, unlike.GetCommandId())
	receive(reactionFrame(unlike.GetCommandId(), "ptid:charlie"), federationdelivery.DispositionAccepted)
	fixture.assertReactionReadback(t, fixture.receiver.service, charlie, 2, 0, false)
	receive(frame, federationdelivery.DispositionDuplicate)
	fixture.assertReactionReadback(t, fixture.receiver.service, charlie, 2, 0, false)

	commentID := fixture.completeComment(t, "other-reader-comment", "")
	commentLike := fixture.reactRequest(t, "other-reader-comment-like", actormodel.ReactionKind_REACTION_LIKE)
	commentLike.CommentId = commentID
	fixture.signReaction(t, commentLike)
	fixture.completeReact(t, commentLike)
	commentReaction := reactionFrame(commentLike.GetCommandId(), "ptid:charlie")
	receive(commentReaction, federationdelivery.DispositionRetryable)
	commentFrame := federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetComment().GetCommentId() == commentID && message.GetTargetActor().GetPtid() == "ptid:charlie"
		})
	receive(commentFrame, federationdelivery.DispositionAccepted)
	receive(commentReaction, federationdelivery.DispositionAccepted)
	read, err := fixture.receiver.service.GetPrivateComment(fixture.ctx, charlie, fixture.postID, commentID)
	if err != nil || read.GetComment().GetMetadata().GetReactionRevision() != 1 ||
		read.GetComment().GetMetadata().GetReactionsCount() != 1 || read.GetComment().GetMetadata().GetIsLiked() {
		t.Fatalf("other-reader comment readback = %+v, %v", read, err)
	}

	replyID := fixture.completeComment(t, "other-reader-reply", commentID)
	replyLike := fixture.reactRequest(t, "other-reader-reply-like", actormodel.ReactionKind_REACTION_LIKE)
	replyLike.CommentId = replyID
	fixture.signReaction(t, replyLike)
	fixture.completeReact(t, replyLike)
	replyFrame := federatedPrivateOutboxFrame(t, fixture.source.database, federationdelivery.PayloadKindSocialPrivateResource,
		func(frame *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(frame.GetOpaquePayload(), message) == nil &&
				message.GetComment().GetCommentId() == replyID && message.GetTargetActor().GetPtid() == "ptid:charlie"
		})
	receive(replyFrame, federationdelivery.DispositionAccepted)
	// Receiver-local block must fence a delayed summary before its projection.
	if err := fixture.receiver.database.Exec(`INSERT INTO social_directional_relationships
		(actor_ptid, target_actor_ptid, actor_home_station_peer_id, target_home_station_peer_id, blocked, revision, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, "ptid:charlie", "ptid:bob", "station-remote", "station-remote", true, 1, fixture.source.clock.now).Error; err != nil {
		t.Fatal(err)
	}
	receive(reactionFrame(replyLike.GetCommandId(), "ptid:charlie"), federationdelivery.DispositionTerminal)
	var count int64
	if err := fixture.receiver.database.Table("social_private_reaction_projections").
		Where("viewer_ptid = ? AND comment_id = ?", "ptid:charlie", replyID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("blocked summary was imported: count=%d, %v", count, err)
	}
}

func newFederatedPrivateCommentFixture(
	t *testing.T,
	parentRequests ...*privatecontentpb.PreparePrivateMomentRequest,
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
	postID := publishPrivateCommentParent(t, source, "federated-comment-parent", parentRequests...)
	receiverAudienceFixture := receiver.service.audiences.(*privateContentTestAudience)
	receiverAudienceFixture.snapshot.RecipientPTIDs = []string{
		"ptid:alice",
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
		delegate: privateContentTestRecipients{
			author: bobAuthor.Endpoint,
			devices: map[string]string{
				"ptid:alice": "alice-device",
			},
		},
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

func (f *federatedPrivateCommentFixture) completeComment(t *testing.T, label, replyTo string) string {
	t.Helper()
	prepare := f.prepareRequest(t, "prepare-"+label, label)
	prepare.ReplyToCommentId = replyTo
	f.signReaction(t, prepare)
	prepared := f.completePrepare(t, prepare)
	submit := f.submitRequest(t, prepared.GetPlan(), "submit-"+label)
	f.signReaction(t, submit)
	if _, err := f.receiver.service.SubmitPrivateCommentForAuthor(f.ctx, f.bobAuthor, submit); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial comment submit = %v", err)
	}
	f.deliverCommand(t, submit.GetCommandId())
	f.deliverResult(t, submit.GetCommandId())
	response, err := f.receiver.service.SubmitPrivateCommentForAuthor(f.ctx, f.bobAuthor, submit)
	if err != nil {
		t.Fatal(err)
	}
	return response.GetComment().GetMetadata().GetCommentId()
}

func (f *federatedPrivateCommentFixture) signReaction(t *testing.T, request proto.Message) {
	t.Helper()
	var operation privatecontentpb.FederatedPrivateInteractionOperation
	switch request.(type) {
	case *actormodel.ReactToPostRequest:
		operation = privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT
	case *actormodel.UnreactToPostRequest:
		operation = privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT
	case *privatecontentpb.PreparePrivateCommentRequest:
		operation = privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_PREPARE_COMMENT
	case *privatecontentpb.SubmitPrivateCommentRequest:
		operation = privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT
	default:
		t.Fatal("unsupported signing fixture")
	}
	signing, err := canonicalFederatedPrivateInteractionRequestSigningBytes(operation, request)
	if err != nil {
		t.Fatal(err)
	}
	signature := ed25519.Sign(f.source.authorPrivateKey, signing)
	switch request := request.(type) {
	case *actormodel.ReactToPostRequest:
		request.ActorDeviceSignature = signature
	case *actormodel.UnreactToPostRequest:
		request.ActorDeviceSignature = signature
	case *privatecontentpb.PreparePrivateCommentRequest:
		request.ActorDeviceSignature = signature
	case *privatecontentpb.SubmitPrivateCommentRequest:
		request.ActorDeviceSignature = signature
	}
}

func (f *federatedPrivateCommentFixture) assertCommentReactionReadback(
	t *testing.T, commentID string, revision uint64, count int64, liked bool,
) {
	t.Helper()
	for _, reader := range []struct {
		service *PrivateContentService
		viewer  *actormodel.ActorDeviceRef
		isLiked bool
	}{
		{f.source.service, f.source.author.Endpoint, false},
		{f.receiver.service, f.receiver.bob, liked},
	} {
		read, err := reader.service.GetPrivateComment(f.ctx, reader.viewer, f.postID, commentID)
		if err != nil {
			t.Fatal(err)
		}
		metadata := read.GetComment().GetMetadata()
		if metadata.GetReactionRevision() != revision || metadata.GetReactionsCount() != count ||
			metadata.GetIsLiked() != reader.isLiked {
			t.Fatalf("comment reaction readback = %+v", metadata)
		}
	}
}

func (f *federatedPrivateCommentFixture) reactRequest(
	t *testing.T,
	commandID string,
	kind actormodel.ReactionKind,
) *actormodel.ReactToPostRequest {
	t.Helper()
	request := &actormodel.ReactToPostRequest{
		PostId:            f.postID,
		Kind:              kind,
		CommandId:         commandID,
		ActorSigningKeyId: "author-key",
	}
	signingBytes, err := canonicalFederatedPrivateInteractionRequestSigningBytes(
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_REACT,
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

func (f *federatedPrivateCommentFixture) unreactRequest(
	t *testing.T,
	commandID string,
	kind actormodel.ReactionKind,
) *actormodel.UnreactToPostRequest {
	t.Helper()
	request := &actormodel.UnreactToPostRequest{
		PostId:            f.postID,
		Kind:              kind,
		CommandId:         commandID,
		ActorSigningKeyId: "author-key",
	}
	signingBytes, err := canonicalFederatedPrivateInteractionRequestSigningBytes(
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_UNREACT,
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

func (f *federatedPrivateCommentFixture) completeReact(
	t *testing.T,
	request *actormodel.ReactToPostRequest,
) *actormodel.ReactToPostResponse {
	t.Helper()
	if _, err := f.receiver.service.ReactPrivateMoment(
		f.ctx,
		f.bobAuthor,
		request,
	); !socialdomain.IsPrivateContentCode(err, socialdomain.PrivateContentDependency) {
		t.Fatalf("initial react error = %v, want pending dependency", err)
	}
	f.deliverCommand(t, request.GetCommandId())
	f.deliverResult(t, request.GetCommandId())
	response, err := f.receiver.service.ReactPrivateMoment(
		f.ctx,
		f.bobAuthor,
		request,
	)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func (f *federatedPrivateCommentFixture) assertReactionReadback(
	t *testing.T,
	service *PrivateContentService,
	viewer *actormodel.ActorDeviceRef,
	wantRevision uint64,
	wantCount int64,
	wantReacted bool,
) {
	t.Helper()
	response, err := service.GetPrivateMoment(f.ctx, viewer, f.postID)
	if err != nil {
		t.Fatal(err)
	}
	if response.GetPost().GetId() != f.postID {
		t.Fatalf("private reaction readback post = %+v", response.GetPost())
	}
	if response.GetReactionProjectionRevision() != wantRevision {
		t.Fatalf(
			"private reaction readback revision = %d, want %d",
			response.GetReactionProjectionRevision(),
			wantRevision,
		)
	}
	if response.GetPost().GetStats().GetLikesCount() != wantCount {
		t.Fatalf(
			"private reaction readback likes = %d, want %d",
			response.GetPost().GetStats().GetLikesCount(),
			wantCount,
		)
	}
	if wantCount == 0 {
		if len(response.GetPost().GetReactions()) != 0 {
			t.Fatalf(
				"private reaction readback = %+v, want empty",
				response.GetPost().GetReactions(),
			)
		}
		return
	}
	assertFederatedPrivateReactionSummary(
		t,
		response.GetPost().GetReactions(),
		actormodel.ReactionKind_REACTION_LIKE,
		wantCount,
		wantReacted,
	)
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
	interaction := &privatecontentpb.FederatedPrivateInteractionResult{}
	if err := proto.Unmarshal(frame.GetOpaquePayload(), interaction); err != nil {
		t.Fatal(err)
	}
	if interaction.GetKind() != privatecontentpb.FederatedPrivateInteractionResultKind_FEDERATED_PRIVATE_INTERACTION_RESULT_KIND_COMMITTED {
		return
	}
	commandFrame := federatedPrivateOutboxFrame(t, f.receiver.database,
		federationdelivery.PayloadKindSocialPrivateInteraction,
		func(candidate *federationdelivery.Frame) bool { return candidate.GetPayloadId() == commandID })
	command := &privatecontentpb.FederatedPrivateInteractionCommand{}
	if err := proto.Unmarshal(commandFrame.GetOpaquePayload(), command); err != nil {
		t.Fatal(err)
	}
	if command.GetOperation() == privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_SUBMIT_COMMENT {
		response := &privatecontentpb.SubmitPrivateCommentResponse{}
		if err := proto.Unmarshal(interaction.GetCanonicalResult(), response); err != nil {
			t.Fatal(err)
		}
		f.deliverAuthorComment(t, response.GetComment().GetMetadata().GetCommentId())
	}
}

func (f *federatedPrivateCommentFixture) deliverAuthorComment(t *testing.T, commentID string) {
	t.Helper()
	frame := federatedPrivateOutboxFrame(t, f.source.database,
		federationdelivery.PayloadKindSocialPrivateResource,
		func(candidate *federationdelivery.Frame) bool {
			message := &privatecontentpb.FederatedPrivateResourceDelivery{}
			return proto.Unmarshal(candidate.GetOpaquePayload(), message) == nil &&
				message.GetResource().GetContentId() == commentID &&
				message.GetTargetActor().GetPtid() == f.bobAuthor.Endpoint.GetActor().GetPtid()
		})
	result, err := f.receiver.receiver.Receive(f.ctx, frame)
	if err != nil || (result.Disposition != federationdelivery.DispositionAccepted &&
		result.Disposition != federationdelivery.DispositionDuplicate) {
		t.Fatalf("deliver full author Comment = %+v, %v", result, err)
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
			moment.GetTargetActorPtid() != targetActorPTID ||
			moment.GetActorPtid() != moment.GetAuthorActorPtid() {
			t.Fatalf("private Comment event = %+v", event)
		}
	case <-time.After(time.Second):
		t.Fatal("private Comment emitted no committed Moment event")
	}
}

func assertFederatedPrivateReactionSummary(
	t *testing.T,
	summaries []*actormodel.ReactionSummary,
	kind actormodel.ReactionKind,
	wantCount int64,
	wantReacted bool,
) {
	t.Helper()
	for _, summary := range summaries {
		if summary.GetKind() == kind {
			if summary.GetCount() != wantCount ||
				summary.GetReactedByViewer() != wantReacted {
				t.Fatalf(
					"reaction summary = %+v, want count=%d reacted=%t",
					summary,
					wantCount,
					wantReacted,
				)
			}
			return
		}
	}
	t.Fatalf("reaction summary kind %s is missing: %+v", kind, summaries)
}

func assertFederatedPrivateReactionEvent(
	t *testing.T,
	subscription *events.Subscription,
	postID string,
	reactionActorPTID string,
	kind actormodel.ReactionKind,
	removed bool,
) {
	t.Helper()
	timeout := time.NewTimer(time.Second)
	defer timeout.Stop()
	for {
		select {
		case event := <-subscription.Events:
			moment := event.GetMoment()
			if moment == nil || moment.GetKind() != realtime.MomentEvent_REACTED {
				continue
			}
			if moment.GetPostId() != postID ||
				moment.GetActorPtid() != reactionActorPTID ||
				moment.GetReactionKind() != kind.String() ||
				moment.GetRemoved() != removed {
				t.Fatalf("private Reaction event = %+v", event)
			}
			return
		case <-timeout.C:
			t.Fatal("private Reaction emitted no committed Moment event")
		}
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
