package application

import (
	"bytes"
	"context"
	"errors"
	"math"
	"strconv"
	"strings"

	socialdomain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	securecontentpb "github.com/peers-labs/peers-touch/station/frame/core/types/securecontent"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func (s *PrivateContentService) VotePrivatePoll(
	ctx context.Context, author socialdomain.PrivateContentAuthor, request *privatecontentpb.VotePrivatePollRequest,
) (*privatecontentpb.VotePrivatePollResponse, error) {
	const operation = "social.private_content.vote_poll"
	if err := author.Validate(operation); err != nil {
		return nil, err
	}
	if err := socialdomain.ValidateVotePrivatePollRequest(request, operation); err != nil {
		return nil, err
	}
	result, replay, err := s.routePrivateInteraction(ctx, author, request.GetPostId(), request.GetCommandId(),
		privatecontentpb.FederatedPrivateInteractionOperation_FEDERATED_PRIVATE_INTERACTION_OPERATION_VOTE_POLL, request)
	if err != nil {
		return nil, err
	}
	response := &privatecontentpb.VotePrivatePollResponse{}
	if err := decodeFederatedPrivateInteractionResult(result, response); err != nil {
		return nil, err
	}
	source := s.localStationPeerID
	remote, err := s.interactionStore.FindRemotePrivatePostAuthority(ctx, request.GetPostId(), author.Endpoint.GetActor().GetPtid())
	if err == nil {
		source = remote.SourceStationPeerID
	} else if !errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
		return nil, mapPrivateStoreError(operation, err)
	}
	authority, err := s.interactionStore.LoadPrivatePollAuthority(ctx, nil, source, request.GetPostId(), author.Endpoint.GetActor().GetPtid())
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}
	if _, err := validatePrivatePollResult(request, response, authority, author.Endpoint.GetActor().GetPtid()); err != nil {
		return nil, err
	}
	response.ExactReplay = replay
	return response, nil
}

func validatePrivatePollResult(
	request *privatecontentpb.VotePrivatePollRequest, response *privatecontentpb.VotePrivatePollResponse,
	authority *privatecontentpb.PrivatePollAuthority, actorPTID string,
) (*privatecontentpb.PrivatePollProjection, error) {
	const operation = "social.private_content.poll_result"
	if response == nil || len(response.ProtoReflect().GetUnknown()) != 0 ||
		response.GetCommandId() != request.GetCommandId() || response.GetPostId() != request.GetPostId() ||
		!bytes.Equal(response.GetOptionSetSha256(), request.GetOptionSetSha256()) ||
		response.GetProjectionRevision() == 0 || response.GetExactReplay() ||
		response.GetAdmittedAt() == nil || response.GetAdmittedAt().CheckValid() != nil {
		return nil, socialdomain.NewPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, "result", "does not bind the ballot")
	}
	if err := socialdomain.ValidatePrivatePollVote(request, authority, response.GetAdmittedAt().AsTime(), operation); err != nil {
		return nil, err
	}
	projection := &privatecontentpb.PrivatePollProjection{
		PostId: response.GetPostId(), OptionSetSha256: response.GetOptionSetSha256(),
		Options: response.GetOptions(), VoterCount: response.GetVoterCount(), CommandId: response.GetCommandId(),
		ProjectionRevision: response.GetProjectionRevision(), VoteActorPtid: actorPTID,
	}
	if err := socialdomain.ValidatePrivatePollProjection(projection, authority, operation); err != nil {
		return nil, err
	}
	var selected [][]byte
	for _, option := range projection.GetOptions() {
		if option.GetSelectedByViewer() {
			selected = append(selected, option.GetOpaqueOptionId())
		}
	}
	if len(selected) != len(request.GetOpaqueOptionIds()) {
		return nil, socialdomain.NewPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, "result", "selection differs from the signed ballot")
	}
	for index, option := range selected {
		if !bytes.Equal(option, request.GetOpaqueOptionIds()[index]) {
			return nil, socialdomain.NewPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, "result", "selection differs from the signed ballot")
		}
	}
	return projection, nil
}

func (s *PrivateContentService) executePrivatePoll(
	ctx context.Context, transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand, request *privatecontentpb.VotePrivatePollRequest,
) (*privatecontentpb.VotePrivatePollResponse, error) {
	const operation = "social.private_content.execute_poll"
	if s.interactionStore == nil || s.events == nil {
		return nil, socialdomain.NewPrivateContentError(socialdomain.PrivateContentIntegrationGap, operation, "dependencies", "poll owner is unavailable")
	}
	mutation, err := s.interactionStore.MutatePrivatePoll(ctx, transaction, command.GetParent(),
		command.GetActor().GetActor().GetPtid(), request, s.now)
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}
	projection, err := s.interactionStore.LocalPrivatePollProjection(ctx, transaction, mutation.Authority, command.GetActor().GetActor().GetPtid())
	if err != nil {
		return nil, mapPrivateStoreError(operation, err)
	}
	if err := s.stagePrivatePollProjections(ctx, transaction, command, mutation); err != nil {
		return nil, mapPrivateDependencyError(operation, err)
	}
	return &privatecontentpb.VotePrivatePollResponse{
		Options: projection.GetOptions(), VoterCount: projection.GetVoterCount(),
		CommandId: command.GetCommandId(), PostId: request.GetPostId(),
		OptionSetSha256: projection.GetOptionSetSha256(), ProjectionRevision: projection.GetProjectionRevision(),
		AdmittedAt: timestamppb.New(mutation.AdmittedAt),
	}, nil
}

func (s *PrivateContentService) stagePrivatePollProjections(
	ctx context.Context, transaction federationdelivery.Transaction,
	command *privatecontentpb.FederatedPrivateInteractionCommand, mutation infrastructure.PrivatePollMutation,
) error {
	recipients, err := s.interactionStore.ListPrivateReactionRecipients(ctx, transaction, command.GetParent(), "")
	if err != nil {
		return mapPrivateStoreError("social.private_content.poll_recipients", err)
	}
	repos := infrastructure.NewRepos(transaction.DB())
	ids := make([]string, 0, len(recipients))
	for _, target := range recipients {
		ids = append(ids, target.ActorPTID)
	}
	actors, err := repos.Identity.ActorsByPTIDs(ctx, ids)
	if err != nil {
		return err
	}
	for _, target := range recipients {
		projection, err := s.interactionStore.LocalPrivatePollProjection(ctx, transaction, mutation.Authority, target.ActorPTID)
		if err != nil {
			return mapPrivateStoreError("social.private_content.poll_projection", err)
		}
		if _, err := s.interactionStore.PutPrivatePollProjection(ctx, transaction, s.localStationPeerID,
			target.ActorPTID, mutation.Authority, projection); err != nil {
			return mapPrivateStoreError("social.private_content.poll_projection", err)
		}
		if target.HomeStationPeerID == s.localStationPeerID {
			if err := s.events.StagePrivateUpdated(ctx, transaction, projection.GetPostId(), projection.GetVoteActorPtid(), target.ActorPTID); err != nil {
				return err
			}
			continue
		}
		if target.FederationID == "" || target.HomeStationPeerID == "" || actors[target.ActorPTID] == nil || s.federationMembership == nil {
			return infrastructure.ErrPrivateContentConflict
		}
		if err := s.federationMembership.ValidateActiveStationPair(ctx, target.FederationID,
			s.localStationPeerID, target.HomeStationPeerID); err != nil {
			return mapPrivateDependencyError("social.private_content.poll_federation", err)
		}
		message := &privatecontentpb.FederatedPrivateResourceDelivery{
			FormatVersion: socialdomain.PrivateContentFormatVersion, FederationId: target.FederationID,
			DeliveryId:          privatePollDeliveryID(command.GetParent(), projection, target.ActorPTID),
			SourceStationPeerId: s.localStationPeerID, TargetStationPeerId: target.HomeStationPeerID,
			TargetActor:       touchactor.ProtoActorRef(actors[target.ActorPTID]),
			ResourceKind:      privatecontentpb.FederatedPrivateResourceKind_FEDERATED_PRIVATE_RESOURCE_KIND_POLL_PROJECTION,
			Resource:          proto.Clone(command.GetParent()).(*securecontentpb.SecureResourceRef),
			LifecycleRevision: command.GetParent().GetGeneration(),
			Metadata:          &privatecontentpb.FederatedPrivateResourceDelivery_Poll{Poll: projection},
			CommittedAt:       timestamppb.New(mutation.AdmittedAt),
		}
		wire, err := socialdomain.CanonicalProtoBytes(message)
		if err != nil {
			return err
		}
		frame, err := s.signFederatedPrivateResourceFrame(ctx, transaction, message, wire, mutation.AdmittedAt)
		if err != nil {
			return err
		}
		if transaction.Outbox() == nil {
			return infrastructure.ErrPrivateContentInvalid
		}
		if _, err := transaction.Outbox().Enqueue(ctx, frame, mutation.AdmittedAt); err != nil {
			return err
		}
	}
	return nil
}

func privatePollDeliveryID(parent *securecontentpb.SecureResourceRef, projection *privatecontentpb.PrivatePollProjection, viewerPTID string) string {
	return deterministicPrivateID("federated-poll", parent.GetContentId(), strconv.FormatUint(parent.GetGeneration(), 10),
		viewerPTID, projection.GetCommandId(), strconv.FormatUint(projection.GetProjectionRevision(), 10))
}

func privatePollOrderingKey(parent *securecontentpb.SecureResourceRef, viewerPTID string) string {
	return deterministicPrivateID("poll-order", parent.GetContentId(), strconv.FormatUint(parent.GetGeneration(), 10), viewerPTID)
}

func (s *PrivateContentService) validatePrivatePollDelivery(
	message *privatecontentpb.FederatedPrivateResourceDelivery, frame *federationdelivery.Frame,
) error {
	const operation = "social.private_content.poll_delivery"
	parent, projection, target := message.GetResource(), message.GetPoll(), message.GetTargetActor()
	if s.interactionStore == nil || parent == nil || parent.GetGeneration() == 0 || parent.GetGeneration() > math.MaxInt64 ||
		parent.GetOwnerDomain() != securecontentpb.SecureContentOwnerDomain_SECURE_CONTENT_OWNER_DOMAIN_SOCIAL ||
		projection == nil || projection.GetPostId() != parent.GetContentId() ||
		projection.GetProjectionRevision() == 0 || projection.GetProjectionRevision() > math.MaxInt64 ||
		projection.GetCommandId() == "" || projection.GetCommandId() != strings.TrimSpace(projection.GetCommandId()) ||
		projection.GetVoteActorPtid() == "" || projection.GetVoteActorPtid() != strings.TrimSpace(projection.GetVoteActorPtid()) ||
		target.GetPtid() == "" || target.GetPtid() != strings.TrimSpace(target.GetPtid()) ||
		target.GetKind() != actormodel.ActorKind_ACTOR_KIND_PERSON ||
		message.GetLifecycleRevision() != parent.GetGeneration() ||
		message.GetDeliveryId() != privatePollDeliveryID(parent, projection, target.GetPtid()) ||
		frame.GetOrderingKey() != privatePollOrderingKey(parent, target.GetPtid()) ||
		frame.GetOrderingSequence() != int64(projection.GetProjectionRevision()) ||
		message.GetCommittedAt() == nil || message.GetCommittedAt().CheckValid() != nil ||
		message.GetPayload() != nil || message.GetVerification() != nil || message.GetAudienceExplanation() != nil ||
		len(message.GetTargetActorEnvelopes()) != 0 || len(message.GetObjects()) != 0 {
		return socialdomain.NewPrivateContentError(socialdomain.PrivateContentInvalidArgument, operation, "projection", "is not a viewer-bound poll result")
	}
	return socialdomain.ValidatePrivateContentID(parent.GetContentId(), "parent", operation)
}

func (s *PrivateContentService) receivePrivatePollProjection(
	ctx context.Context, transaction federationdelivery.Transaction, message *privatecontentpb.FederatedPrivateResourceDelivery,
) (federationdelivery.Result, error) {
	if err := s.interactionStore.ValidateRemotePrivateReactionProjection(ctx, transaction, message); err != nil {
		if errors.Is(err, infrastructure.ErrPrivateContentNotFound) {
			return federationdelivery.RetryableResult(federationdelivery.FrameErrorOverloaded), nil
		}
		if errors.Is(err, infrastructure.ErrPrivateContentStaleRevision) {
			return federationdelivery.TerminalResult(federationdelivery.FrameErrorDomainRejected), nil
		}
		return federationdelivery.Result{}, err
	}
	authority, err := s.interactionStore.LoadPrivatePollAuthority(ctx, transaction, message.GetSourceStationPeerId(),
		message.GetResource().GetContentId(), message.GetTargetActor().GetPtid())
	if err != nil {
		return deliveryResultForPrivateContentError(mapPrivateStoreError("social.private_content.poll_import", err)), nil
	}
	if !proto.Equal(authority.GetResource(), message.GetResource()) {
		return federationdelivery.PayloadHashConflictResult(), nil
	}
	applied, err := s.interactionStore.PutPrivatePollProjection(ctx, transaction, message.GetSourceStationPeerId(),
		message.GetTargetActor().GetPtid(), authority, message.GetPoll())
	if err != nil {
		return deliveryResultForPrivateContentError(mapPrivateStoreError("social.private_content.poll_import", err)), nil
	}
	if !applied {
		return federationdelivery.DuplicateResult(), nil
	}
	if err := s.events.StagePrivateUpdated(ctx, transaction, message.GetPoll().GetPostId(),
		message.GetPoll().GetVoteActorPtid(), message.GetTargetActor().GetPtid()); err != nil {
		return federationdelivery.Result{}, err
	}
	return federationdelivery.AcceptedResult(), nil
}

func (s *PrivateContentService) importPrivatePollResult(
	ctx context.Context, transaction federationdelivery.Transaction, command *privatecontentpb.FederatedPrivateInteractionCommand,
	canonicalResult []byte, frame *federationdelivery.Frame,
) error {
	const operation = "social.private_content.poll_result_import"
	request, response := &privatecontentpb.VotePrivatePollRequest{}, &privatecontentpb.VotePrivatePollResponse{}
	if err := proto.Unmarshal(command.GetCanonicalOperation(), request); err != nil {
		return socialdomain.WrapPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, err)
	}
	if err := proto.Unmarshal(canonicalResult, response); err != nil {
		return socialdomain.WrapPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, err)
	}
	wire, err := socialdomain.CanonicalProtoBytes(response)
	if err != nil || !bytes.Equal(wire, canonicalResult) {
		return socialdomain.NewPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, "result", "is not canonical")
	}
	actorPTID := command.GetActor().GetActor().GetPtid()
	if err := s.interactionStore.ValidateRemotePrivateReactionParent(ctx, transaction, frame.GetSourceStationPeerId(),
		frame.GetTargetStationPeerId(), command.GetFederationId(), command.GetParent(), "", actorPTID,
		command.GetActor().GetDeviceId()); err != nil {
		return mapPrivateStoreError(operation, err)
	}
	authority, err := s.interactionStore.LoadPrivatePollAuthority(ctx, transaction, frame.GetSourceStationPeerId(), request.GetPostId(), actorPTID)
	if err != nil {
		return mapPrivateStoreError(operation, err)
	}
	if !proto.Equal(authority.GetResource(), command.GetParent()) {
		return socialdomain.NewPrivateContentError(socialdomain.PrivateContentIntegrityFailed, operation, "parent", "has changed")
	}
	projection, err := validatePrivatePollResult(request, response, authority, actorPTID)
	if err != nil {
		return err
	}
	applied, err := s.interactionStore.PutPrivatePollProjection(ctx, transaction, frame.GetSourceStationPeerId(), actorPTID, authority, projection)
	if err != nil {
		return mapPrivateStoreError(operation, err)
	}
	if !applied {
		return nil
	}
	return s.events.StagePrivateUpdated(ctx, transaction, request.GetPostId(), actorPTID, actorPTID)
}
