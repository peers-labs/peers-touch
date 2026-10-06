package conversation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	actoridentitydomain "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/command"
	deliveryapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/delivery"
	interactionapp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/interaction"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/query"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationhttp "github.com/peers-labs/peers-touch/station/app/subserver/conversation/interface/http"
	keyexchangemodel "github.com/peers-labs/peers-touch/station/app/subserver/key_exchange/model"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	sharedfederation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	"github.com/peers-labs/peers-touch/station/frame/core/social_gate"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	initialConversationAuthorityEpoch = valueobject.AuthorityEpoch(1)
	defaultAuthorityPlanTTL           = 5 * time.Minute
	defaultConversationQueryLimit     = 50
	maximumConversationQueryLimit     = 500
	productionInternalErrorCode       = "CONVERSATION_INTERNAL_ERROR"
)

type productionStageError struct {
	operation string
	stage     string
	cause     error
}

func (e *productionStageError) Error() string {
	return fmt.Sprintf("%s: %s: %v", e.operation, e.stage, e.cause)
}

func (e *productionStageError) Unwrap() error {
	return e.cause
}

func productionStage(operation string, stage string, err error) error {
	if err == nil {
		return nil
	}
	return &productionStageError{
		operation: operation,
		stage:     stage,
		cause:     err,
	}
}

func validateProductionCommandKind(kind chatmodel.ConversationCommandKind) error {
	switch kind {
	case chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UNSPECIFIED,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_SEND_MESSAGE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_EDIT_MESSAGE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_RETRACT_MESSAGE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_DISSOLVE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_UPDATE_SETTINGS,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_REACT,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_PIN_MESSAGE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBERSHIP_TRANSITION,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MEMBER_AUTHORITY,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_MODERATE_MESSAGE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_FORWARD_MESSAGE,
		chatmodel.ConversationCommandKind_CONVERSATION_COMMAND_KIND_HIDE_MESSAGE_FOR_ACTOR:
		return nil
	default:
		return server.BadRequest(
			"Conversation command preparation kind is unsupported",
		)
	}
}

func productionPrepareCommandRequest(
	conversationID valueobject.ConversationID,
	sender valueobject.Endpoint,
	senderHomeStation valueobject.StationID,
	verifiedRoutes []ports.EndpointRoute,
	kind chatmodel.ConversationCommandKind,
) (command.PrepareCommandRequest, error) {
	if err := validateProductionCommandKind(kind); err != nil {
		return command.PrepareCommandRequest{}, err
	}
	return command.PrepareCommandRequest{
		ConversationID:    conversationID,
		Sender:            sender,
		SenderHomeStation: senderHomeStation,
		VerifiedRoutes:    verifiedRoutes,
	}, nil
}

func (s *subServer) handleCreateDirectConversation(
	ctx context.Context,
	request *chatmodel.CreateDirectConversationRequest,
) (*chatmodel.CreateDirectConversationResponse, error) {
	const operation = "production_http.create_direct"

	authenticated, endpoint, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetCreator() == nil ||
		request.GetCreator().GetActor() == nil ||
		request.GetCreator().GetActor().GetPtid() != authenticated.PTID ||
		request.GetCreator().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Conversation creator does not match the authenticated endpoint",
		)
	}
	peer, err := valueobject.NewPTID(request.GetPeerPtid())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	federationID, err := valueobject.NewFederationID(request.GetFederationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	commandID, err := valueobject.NewCommandID(request.GetCommandId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	conversationID, err := valueobject.DirectConversationID(endpoint.Actor, peer)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	requiresVerifiedRoutes := false
	existing, getErr := s.composition.QueryService.Get(
		ctx,
		conversationID,
		endpoint.Actor,
	)
	switch {
	case getErr == nil:
		if !existingDirectCanReopen(
			existing,
			federationID,
			endpoint.Actor,
			peer,
			s.localStation,
		) {
			return nil, mapProductionConversationError(
				ctx,
				conversationdomain.NewError(
					conversationdomain.ErrorCodeCommandConflict,
					"production_http.create_direct",
					"conversation",
					"does not match the requested Direct Conversation",
				),
			)
		}
		if existing.Source == query.SourceFollower {
			return &chatmodel.CreateDirectConversationResponse{
				Conversation: productionConversation(existing.Conversation),
			}, nil
		}
	case conversationdomain.IsCode(getErr, conversationdomain.ErrorCodeNotFound):
		requiresVerifiedRoutes = true
		if gateErr := s.evaluateCreateDirect(ctx, request.GetPeerPtid()); gateErr != nil {
			return nil, mapProductionConversationError(
				ctx,
				productionStage(operation, "social_gate", gateErr),
			)
		}
	default:
		return nil, mapProductionConversationError(
			ctx,
			productionStage(operation, "query_existing", getErr),
		)
	}

	exactBytes, err := deterministicProductionProto(request)
	if err != nil {
		return nil, mapProductionConversationError(
			ctx,
			productionStage(operation, "encode_command", err),
		)
	}
	var verifiedRoutes []ports.EndpointRoute
	if requiresVerifiedRoutes {
		verifiedRoutes, err = s.composition.productionEndpointRoutes(
			ctx,
			[]valueobject.PTID{endpoint.Actor, peer},
		)
		if err != nil {
			return nil, mapProductionConversationError(
				ctx,
				productionStage(operation, "resolve_endpoint_routes", err),
			)
		}
	}
	result, err := s.composition.CommandService.CreateDirect(
		ctx,
		command.CreateDirectRequest{
			Creator:           endpoint,
			Peer:              peer,
			FederationID:      federationID,
			AuthorityEpoch:    initialConversationAuthorityEpoch,
			CommandID:         commandID,
			VerifiedRoutes:    verifiedRoutes,
			ExactCommandBytes: exactBytes,
		},
	)
	if err != nil {
		stage := "commit_direct"
		if commandStage, ok := command.DirectCreationFailureStage(err); ok {
			stage = "commit_" + commandStage
		}
		return nil, mapProductionConversationError(
			ctx,
			productionStage(operation, stage, err),
		)
	}
	if result.PostCommitError != nil {
		return nil, mapProductionConversationError(
			ctx,
			productionStage(operation, "publish_direct", fmt.Errorf(
				"publish committed Direct Conversation %s: %w",
				result.Conversation.ID,
				result.PostCommitError,
			)),
		)
	}
	var event *chatmodel.ConversationEvent
	if result.Event.ID != "" {
		event, err = conversationhttp.MapEvent(result.Event)
		if err != nil {
			return nil, mapProductionConversationError(
				ctx,
				productionStage(operation, "map_event", err),
			)
		}
	}

	return &chatmodel.CreateDirectConversationResponse{
		Conversation: productionConversation(result.Conversation),
		Event:        event,
	}, nil
}

func (s *subServer) handlePrepareGroup(
	ctx context.Context,
	request *chatmodel.PrepareConversationGroupRequest,
) (*chatmodel.PrepareConversationGroupResponse, error) {
	authenticated, owner, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetCreator() == nil ||
		request.GetCreator().GetActor() == nil ||
		request.GetCreator().GetActor().GetPtid() != authenticated.PTID ||
		request.GetCreator().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Conversation group creator does not match the authenticated endpoint",
		)
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	federationID, err := valueobject.NewFederationID(request.GetFederationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	members, err := productionActorPTIDs(request.GetMembers())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	actors := uniqueProductionActors(
		append(append([]valueobject.PTID(nil), members...), owner.Actor),
	)
	manifests, err := s.composition.productionEndpointManifests(ctx, actors)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	verifiedRoutes, err := productionEndpointRoutesFromManifests(
		manifests,
		actors,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	manifestSetHash, manifestStateHash, err := productionEndpointManifestSetHashes(
		manifests,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	plan, err := s.composition.CommandService.PrepareGroup(
		ctx,
		command.PrepareGroupRequest{
			ConversationID:    conversationID,
			FederationID:      federationID,
			AuthorityEpoch:    initialConversationAuthorityEpoch,
			Name:              request.GetName(),
			Owner:             owner,
			Members:           members,
			VerifiedRoutes:    verifiedRoutes,
			ManifestSetHash:   manifestSetHash,
			ManifestStateHash: manifestStateHash,
			TTL:               defaultAuthorityPlanTTL,
		},
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return s.productionGroupPlanResponse(plan, manifests), nil
}

func (s *subServer) handleCreateGroupConversation(
	ctx context.Context,
	request *chatmodel.CreateGroupConversationRequest,
) (*chatmodel.CreateGroupConversationResponse, error) {
	authenticated, owner, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetCommand() == nil {
		return nil, server.BadRequest("Conversation group command is required")
	}
	wireCommand := request.GetCommand()
	if wireCommand.GetSender() == nil ||
		wireCommand.GetSender().GetPtid() != authenticated.PTID ||
		wireCommand.GetSender().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Conversation group command sender does not match the authenticated endpoint",
		)
	}
	transition := wireCommand.GetMembershipTransition()
	if transition == nil {
		return nil, server.BadRequest(
			"Conversation group creation requires a membership transition",
		)
	}
	exactBytes, err := deterministicProductionProto(wireCommand)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(
		wireCommand.GetConversationId(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	commandID, err := valueobject.NewCommandID(wireCommand.GetCommandId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	replayedResult, replayed, err := s.composition.CommandService.ReplayGroupCreation(
		ctx,
		conversationID,
		commandID,
		exactBytes,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if replayed {
		response, replayErr := productionGroupCreationResponse(replayedResult)
		return response, mapProductionConversationError(ctx, replayErr)
	}
	plan, err := s.loadAuthorityPlan(
		ctx,
		valueobject.PlanID(transition.GetAuthorityPlanId()),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	mapped, err := conversationhttp.MapSubmitCommand(
		authenticated,
		&chatmodel.SubmitConversationAuthorityCommandRequest{
			Submission: &chatmodel.SubmitConversationAuthorityCommandRequest_Command{
				Command: wireCommand,
			},
		},
		aggregate.CommandPreparation{
			Kind:              valueobject.ConversationKindGroup,
			AuthorityStation:  s.localStation,
			Head:              plan.AuthorityHead,
			RequiredEndpoints: productionEndpointUnion(plan.PreEndpoints, plan.PostEndpoints),
			DeliveryPlanHash:  plan.Hash,
		},
		&plan,
		s.composition.clock.Now(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	actors := productionPlanActors(plan)
	manifests, err := s.composition.productionEndpointManifests(
		ctx,
		actors,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	verifiedRoutes, err := productionEndpointRoutesFromManifests(manifests, actors)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	_, manifestStateHash, err := productionEndpointManifestSetHashes(manifests)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	result, err := s.composition.CommandService.CreateGroup(
		ctx,
		command.CreateGroupRequest{
			ConversationID:    mapped.Command.ConversationID,
			Owner:             owner,
			VerifiedRoutes:    verifiedRoutes,
			ManifestStateHash: manifestStateHash,
			CommandID:         mapped.Command.ID,
			AuthorityPlanID:   plan.ID,
			AuthorityPlanHash: plan.Hash,
			Deliveries:        mapped.Command.Deliveries,
			ExactCommandBytes: exactBytes,
		},
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if result.PostCommitError != nil {
		return nil, mapProductionConversationError(
			ctx,
			fmt.Errorf(
				"publish committed Group Conversation %s: %w",
				result.Conversation.ID,
				result.PostCommitError,
			),
		)
	}
	response, err := productionGroupCreationResponse(result)
	return response, mapProductionConversationError(ctx, err)
}

func productionGroupCreationResponse(
	result command.Result,
) (*chatmodel.CreateGroupConversationResponse, error) {
	event, err := conversationhttp.MapEvent(result.Event)
	if err != nil {
		return nil, err
	}
	return &chatmodel.CreateGroupConversationResponse{
		Conversation: productionConversation(result.Conversation),
		Event:        event,
	}, nil
}

func (s *subServer) handlePrepareCommand(
	ctx context.Context,
	request *chatmodel.PrepareConversationCommandRequest,
) (*chatmodel.PrepareConversationCommandResponse, error) {
	authenticated, sender, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetSender() == nil ||
		request.GetSender().GetActor() == nil ||
		request.GetSender().GetActor().GetPtid() != authenticated.PTID ||
		request.GetSender().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Conversation command preparation sender does not match the authenticated endpoint",
		)
	}
	if request.GetAuthorityStationPeerId() != "" &&
		request.GetAuthorityStationPeerId() != string(s.localStation) {
		response, err := s.forwardPrepareCommand(ctx, request)

		return response, mapProductionConversationError(ctx, err)
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	verifiedRoutes, err := s.composition.productionCommandRoutes(
		ctx,
		s.composition.CommandService,
		conversationID,
		sender.Actor,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	prepareRequest, err := productionPrepareCommandRequest(
		conversationID,
		sender,
		s.localStation,
		verifiedRoutes,
		request.GetCommandKind(),
	)
	if err != nil {
		return nil, err
	}
	preparation, err := s.composition.CommandService.PrepareCommand(
		ctx,
		prepareRequest,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return productionCommandPreparation(conversationID, preparation), nil
}

func (s *subServer) handlePrepareMembership(
	ctx context.Context,
	request *chatmodel.PrepareConversationMembershipRequest,
) (*chatmodel.PrepareConversationMembershipResponse, error) {
	authenticated, requester, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil ||
		request.GetSender() == nil ||
		request.GetSender().GetActor() == nil ||
		request.GetSender().GetActor().GetPtid() != authenticated.PTID ||
		request.GetSender().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Conversation membership requester does not match the authenticated endpoint",
		)
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	view, err := s.composition.QueryService.Get(
		ctx,
		conversationID,
		requester.Actor,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if view.Source == query.SourceFollower {
		response, forwardErr := s.forwardPrepareMembership(
			ctx,
			request,
			view.Conversation,
		)

		return response, mapProductionConversationError(ctx, forwardErr)
	}
	if view.Source != query.SourceAuthority ||
		view.Conversation.AuthorityStation != s.localStation {
		return nil, mapProductionConversationError(
			ctx,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"production_http.prepare_membership",
				"authority_station_peer_id",
				"does not match the local authority projection",
			),
		)
	}
	response, err := s.prepareMembershipPlan(ctx, request, requester)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) prepareMembershipPlan(
	ctx context.Context,
	request *chatmodel.PrepareConversationMembershipRequest,
	requester valueobject.Endpoint,
) (*chatmodel.PrepareConversationMembershipResponse, error) {
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, err
	}
	change, err := productionMembershipChange(request)
	if err != nil {
		return nil, err
	}
	actors, err := s.composition.CommandService.CommandRouteActors(
		ctx,
		conversationID,
		requester.Actor,
	)
	if err != nil {
		return nil, err
	}
	actors = uniqueProductionActors(append(actors, change.Actor))
	manifests, err := s.composition.productionEndpointManifests(ctx, actors)
	if err != nil {
		return nil, err
	}
	verifiedRoutes, err := productionEndpointRoutesFromManifests(
		manifests,
		actors,
	)
	if err != nil {
		return nil, err
	}
	manifestSetHash, manifestStateHash, err := productionEndpointManifestSetHashes(
		manifests,
	)
	if err != nil {
		return nil, err
	}
	plan, err := s.composition.CommandService.PrepareMembership(
		ctx,
		command.PrepareMembershipRequest{
			ConversationID:    conversationID,
			Requester:         requester,
			Changes:           []entity.MembershipChange{change},
			VerifiedRoutes:    verifiedRoutes,
			ManifestSetHash:   manifestSetHash,
			ManifestStateHash: manifestStateHash,
			TTL:               defaultAuthorityPlanTTL,
		},
	)
	if err != nil {
		return nil, err
	}

	return s.productionMembershipPlanResponse(plan, manifests), nil
}

func (s *subServer) handleSubmitAuthorityCommand(
	ctx context.Context,
	request *chatmodel.SubmitConversationAuthorityCommandRequest,
) (*chatmodel.SubmitConversationAuthorityCommandResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("Conversation command submission is required")
	}
	if proposal := request.GetProposal(); proposal != nil {
		if err := s.forwardConversationProposal(ctx, authenticated, proposal); err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}

		return &chatmodel.SubmitConversationAuthorityCommandResponse{
			AcceptedForForwarding: true,
		}, nil
	}
	wireCommand := request.GetCommand()
	if wireCommand == nil {
		return nil, server.BadRequest(
			"Conversation command or signed proposal is required",
		)
	}
	preparation, verifiedRoutes, err := s.localCommandPreparation(
		ctx,
		authenticated,
		wireCommand,
	)
	if err != nil {
		return productionCommandRejection(
			ctx,
			s,
			wireCommand,
			verifiedRoutes,
			err,
		), nil
	}
	plan, err := s.commandAuthorityPlan(ctx, wireCommand)
	if err != nil {
		return productionCommandRejection(
			ctx,
			s,
			wireCommand,
			verifiedRoutes,
			err,
		), nil
	}
	mapped, err := conversationhttp.MapSubmitCommand(
		authenticated,
		request,
		preparation,
		plan,
		s.composition.clock.Now(),
	)
	if err != nil {
		return productionCommandRejection(
			ctx,
			s,
			wireCommand,
			verifiedRoutes,
			err,
		), nil
	}
	mapped.VerifiedRoutes, mapped.ManifestStateHash, err =
		s.composition.productionSubmitCommandRoutes(
			ctx,
			plan,
			mapped.Membership != nil,
			verifiedRoutes,
		)
	if err != nil {
		return productionCommandRejection(
			ctx,
			s,
			wireCommand,
			verifiedRoutes,
			err,
		), nil
	}
	result, err := s.composition.CommandService.Submit(ctx, mapped)
	if err != nil {
		return productionCommandRejection(
			ctx,
			s,
			wireCommand,
			verifiedRoutes,
			err,
		), nil
	}
	if result.PostCommitError != nil {
		return nil, mapProductionConversationError(
			ctx,
			fmt.Errorf(
				"publish committed Conversation event %s: %w",
				result.Event.ID,
				result.PostCommitError,
			),
		)
	}
	event, err := conversationhttp.MapEvent(result.Event)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.SubmitConversationAuthorityCommandResponse{Event: event}, nil
}

func (s *subServer) handleListConversations(
	ctx context.Context,
	_ *chatmodel.ListConversationsRequest,
) (*chatmodel.ListConversationsResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	views, err := s.composition.QueryService.List(ctx, actor)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	conversations := make([]*chatmodel.Conversation, 0, len(views))
	for _, view := range views {
		conversations = append(
			conversations,
			productionConversation(view.Conversation),
		)
	}

	return &chatmodel.ListConversationsResponse{
		Conversations: conversations,
	}, nil
}

func (s *subServer) handleGetConversation(
	ctx context.Context,
	request *chatmodel.GetConversationRequest,
) (*chatmodel.GetConversationResponse, error) {
	view, err := s.authenticatedConversationView(ctx, request.GetConversationId())
	if err != nil {
		return nil, err
	}

	return &chatmodel.GetConversationResponse{
		Conversation: productionConversation(view.Conversation),
	}, nil
}

func (s *subServer) handleGetConversationPublicHead(
	ctx context.Context,
	request *chatmodel.GetConversationPublicHeadRequest,
) (*chatmodel.GetConversationPublicHeadResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	head, err := s.composition.QueryService.PublicHead(ctx, conversationID, actor)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.GetConversationPublicHeadResponse{
		Head: productionPublicHead(head),
	}, nil
}

func (s *subServer) handleGetConversationMembers(
	ctx context.Context,
	request *chatmodel.GetConversationMembersRequest,
) (*chatmodel.GetConversationMembersResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	members, err := s.composition.QueryService.Members(ctx, conversationID, actor)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	wireMembers := make([]*chatmodel.ConversationMember, 0, len(members))
	for _, member := range members {
		wireMembers = append(
			wireMembers,
			productionConversationMember(conversationID, member),
		)
	}

	return &chatmodel.GetConversationMembersResponse{Members: wireMembers}, nil
}

func (s *subServer) handleUpdateConversationMember(
	ctx context.Context,
	request *chatmodel.UpdateConversationMemberRequest,
) (*chatmodel.UpdateConversationMemberResponse, error) {
	if proposal := request.GetProposal(); proposal != nil {
		authenticated, _, err := authenticatedConversationActor(ctx)
		if err != nil {
			return nil, err
		}
		if proposal.GetMemberAuthorityCommand().GetAction() !=
			chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER {
			return nil, server.BadRequest(
				"Conversation member authority proposal has the wrong action",
			)
		}
		if err := s.forwardConversationProposal(ctx, authenticated, proposal); err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}
		return &chatmodel.UpdateConversationMemberResponse{
			AcceptedForForwarding: true,
		}, nil
	}
	result, err := s.submitMemberAuthorityCommand(
		ctx,
		request.GetCommand(),
		chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_UPDATE_MEMBER,
	)
	if err != nil {
		return nil, err
	}
	member, ok := productionSnapshotMember(result.Conversation, result.Event.Fact.MemberAuthority.Target)
	if !ok {
		return nil, mapProductionConversationError(
			ctx,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"production_http.update_member",
				"post_state",
				"committed target member is missing",
			),
		)
	}
	event, err := conversationhttp.MapEvent(result.Event)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.UpdateConversationMemberResponse{
		Member: productionConversationMember(result.Conversation.ID, member),
		Event:  event,
	}, nil
}

func (s *subServer) handleTransferConversationOwnership(
	ctx context.Context,
	request *chatmodel.TransferConversationOwnershipRequest,
) (*chatmodel.TransferConversationOwnershipResponse, error) {
	if proposal := request.GetProposal(); proposal != nil {
		authenticated, _, err := authenticatedConversationActor(ctx)
		if err != nil {
			return nil, err
		}
		if proposal.GetMemberAuthorityCommand().GetAction() !=
			chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_TRANSFER_OWNERSHIP {
			return nil, server.BadRequest(
				"Conversation ownership-transfer proposal has the wrong action",
			)
		}
		if err := s.forwardConversationProposal(ctx, authenticated, proposal); err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}
		return &chatmodel.TransferConversationOwnershipResponse{
			AcceptedForForwarding: true,
		}, nil
	}
	result, err := s.submitMemberAuthorityCommand(
		ctx,
		request.GetCommand(),
		chatmodel.ConversationMemberAuthorityAction_CONVERSATION_MEMBER_AUTHORITY_ACTION_TRANSFER_OWNERSHIP,
	)
	if err != nil {
		return nil, err
	}
	mutation := result.Event.Fact.MemberAuthority
	if mutation == nil {
		return nil, mapProductionConversationError(
			ctx,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"production_http.transfer_ownership",
				"event",
				"committed owner transfer fact is missing",
			),
		)
	}
	previousOwner, previousOK := productionSnapshotMember(
		result.Conversation,
		mutation.PreviousOwner,
	)
	newOwner, newOK := productionSnapshotMember(result.Conversation, mutation.Owner)
	if !previousOK || !newOK {
		return nil, mapProductionConversationError(
			ctx,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"production_http.transfer_ownership",
				"post_state",
				"committed owner members are missing",
			),
		)
	}
	event, err := conversationhttp.MapEvent(result.Event)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.TransferConversationOwnershipResponse{
		Conversation:  productionConversation(result.Conversation),
		PreviousOwner: productionConversationMember(result.Conversation.ID, previousOwner),
		NewOwner:      productionConversationMember(result.Conversation.ID, newOwner),
		Event:         event,
	}, nil
}

func (s *subServer) submitMemberAuthorityCommand(
	ctx context.Context,
	wire *chatmodel.ConversationMemberAuthorityCommand,
	expected chatmodel.ConversationMemberAuthorityAction,
) (command.Result, error) {
	authenticated, operator, err := authenticatedConversationActor(ctx)
	if err != nil {
		return command.Result{}, err
	}
	if wire == nil || wire.GetAction() != expected {
		return command.Result{}, server.BadRequest(
			"Conversation member authority command has the wrong action",
		)
	}
	if wire.GetOperator() == nil ||
		wire.GetOperator().GetPtid() != authenticated.PTID ||
		wire.GetOperator().GetDeviceId() != authenticated.DeviceID {
		return command.Result{}, server.Forbidden(
			"Conversation member authority operator does not match the authenticated endpoint",
		)
	}
	if wire.GetAuthorityStationPeerId() != string(s.localStation) {
		return command.Result{}, mapProductionConversationError(
			ctx,
			conversationdomain.NewError(
				conversationdomain.ErrorCodeStaleAuthorityHead,
				"production_http.member_authority",
				"authority_station_peer_id",
				"does not identify the local Conversation authority",
			),
		)
	}
	conversationID, err := valueobject.NewConversationID(wire.GetConversationId())
	if err != nil {
		return command.Result{}, mapProductionConversationError(ctx, err)
	}
	verifiedRoutes, err := s.composition.productionCommandRoutes(
		ctx,
		s.composition.CommandService,
		conversationID,
		operator.Actor,
	)
	if err != nil {
		return command.Result{}, mapProductionConversationError(ctx, err)
	}
	preparation, err := s.composition.CommandService.PrepareCommand(
		ctx,
		command.PrepareCommandRequest{
			ConversationID:    conversationID,
			Sender:            operator,
			SenderHomeStation: s.localStation,
			VerifiedRoutes:    verifiedRoutes,
		},
	)
	if err != nil {
		return command.Result{}, mapProductionConversationError(ctx, err)
	}
	mapped, err := conversationhttp.MapMemberAuthorityCommand(
		authenticated,
		wire,
		preparation,
		s.composition.clock.Now(),
	)
	if err != nil {
		return command.Result{}, mapProductionConversationError(ctx, err)
	}
	mapped.VerifiedRoutes = verifiedRoutes
	result, err := s.composition.CommandService.Submit(ctx, mapped)
	if err != nil {
		return command.Result{}, mapProductionConversationError(ctx, err)
	}
	if result.PostCommitError != nil {
		return command.Result{}, mapProductionConversationError(
			ctx,
			fmt.Errorf(
				"publish committed member authority event %s: %w",
				result.Event.ID,
				result.PostCommitError,
			),
		)
	}
	return result, nil
}

func (s *subServer) handleListConversationEvents(
	ctx context.Context,
	request *chatmodel.ListConversationEventsRequest,
) (*chatmodel.ListConversationEventsResponse, error) {
	events, err := s.authenticatedEvents(
		ctx,
		request.GetConversationId(),
		request.GetAfterSeq(),
		int(request.GetLimit()),
	)
	if err != nil {
		return nil, err
	}

	return &chatmodel.ListConversationEventsResponse{Events: events}, nil
}

func (s *subServer) handleListConversationMessages(
	ctx context.Context,
	request *chatmodel.ListConversationMessagesRequest,
) (*chatmodel.ListConversationMessagesResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if request.GetAfterSeq() < 0 {
		return nil, server.BadRequest("after sequence cannot be negative")
	}
	limit := normalizedConversationLimit(int(request.GetLimit()))
	page, err := s.composition.QueryService.ListMessages(
		ctx,
		conversationID,
		actor,
		valueobject.Sequence(request.GetAfterSeq()),
		limit,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	events, err := productionEvents(page.Events)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.ListConversationMessagesResponse{
		Events:  events,
		HasMore: page.HasMore,
	}, nil
}

func (s *subServer) handleListThreadMessages(
	ctx context.Context,
	request *chatmodel.ListThreadMessagesRequest,
) (*chatmodel.ListThreadMessagesResponse, error) {
	if request.GetRootId() == "" {
		return nil, server.BadRequest("thread root message ID is required")
	}
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	threadRootID, err := valueobject.NewMessageID(request.GetRootId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if request.GetAfterSeq() < 0 {
		return nil, server.BadRequest("after sequence cannot be negative")
	}
	limit := normalizedConversationLimit(int(request.GetLimit()))
	page, err := s.composition.QueryService.ListThreadMessages(
		ctx,
		conversationID,
		actor,
		threadRootID,
		valueobject.Sequence(request.GetAfterSeq()),
		limit,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	events, err := productionEvents(page.Events)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.ListThreadMessagesResponse{
		Events:  events,
		HasMore: page.HasMore,
	}, nil
}

func (s *subServer) handleGetThreadCounts(
	ctx context.Context,
	request *chatmodel.GetThreadCountsRequest,
) (*chatmodel.GetThreadCountsResponse, error) {
	if len(request.GetRootIds()) == 0 {
		return &chatmodel.GetThreadCountsResponse{}, nil
	}
	rootIDs := make(map[string]struct{}, len(request.GetRootIds()))
	for _, rootID := range request.GetRootIds() {
		if strings.TrimSpace(rootID) == "" {
			return nil, server.BadRequest("thread root message IDs must be non-empty")
		}
		rootIDs[rootID] = struct{}{}
	}
	records, err := s.authenticatedEventRecords(
		ctx,
		request.GetConversationId(),
		0,
		maximumConversationQueryLimit,
	)
	if err != nil {
		return nil, err
	}
	counts := make(map[string]*chatmodel.ThreadCountEntry, len(rootIDs))
	for rootID := range rootIDs {
		counts[rootID] = &chatmodel.ThreadCountEntry{RootMessageId: rootID}
	}
	for _, record := range records {
		rootID, replyID, matched := productionThreadReply(record)
		if !matched {
			continue
		}
		entry := counts[rootID]
		if entry == nil {
			continue
		}
		entry.ReplyCount++
		if record.CommittedAt.UnixMilli() >= entry.LatestReplyAtMs {
			entry.LatestReplyId = replyID
			entry.LatestReplyAtMs = record.CommittedAt.UnixMilli()
		}
	}
	result := make([]*chatmodel.ThreadCountEntry, 0, len(request.GetRootIds()))
	for _, rootID := range request.GetRootIds() {
		result = append(result, counts[rootID])
	}

	return &chatmodel.GetThreadCountsResponse{Counts: result}, nil
}

func (s *subServer) handleGetMemberSettings(
	ctx context.Context,
	request *chatmodel.GetMemberSettingsRequest,
) (*chatmodel.GetMemberSettingsResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	settings, err := s.composition.QueryService.MemberSettings(
		ctx,
		conversationID,
		actor,
	)
	if err != nil {
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			return &chatmodel.GetMemberSettingsResponse{
				Settings: productionMemberSettings(repository.MemberSettings{
					ConversationID: conversationID,
					Actor:          actor,
					AlertEnabled:   true,
					Background:     "default",
				}),
			}, nil
		}

		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.GetMemberSettingsResponse{
		Settings: productionMemberSettings(settings),
	}, nil
}

func (s *subServer) handleUpdateMemberSettings(
	ctx context.Context,
	request *chatmodel.UpdateMemberSettingsRequest,
) (*chatmodel.UpdateMemberSettingsResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetSettings() == nil {
		return nil, server.BadRequest("Conversation member settings are required")
	}
	conversationID, err := valueobject.NewConversationID(request.GetConversationId())
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	settings := request.GetSettings()
	_, err = s.composition.CommandService.UpdateMemberSettings(
		ctx,
		conversationID,
		actor,
		command.MemberSettingsPatch{
			Nickname:        productionStringPointer(settings.GetNickname()),
			Muted:           productionBoolPointer(settings.GetMuted()),
			Pinned:          productionBoolPointer(settings.GetPinned()),
			AlertEnabled:    productionBoolPointer(settings.GetAlertEnabled()),
			Background:      productionStringPointer(settings.GetBackground()),
			BackgroundImage: productionStringPointer(settings.GetBackgroundImage()),
		},
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return &chatmodel.UpdateMemberSettingsResponse{Success: true}, nil
}

func (s *subServer) handleSubmitTyping(
	ctx context.Context,
	request *chatmodel.SubmitConversationTypingRequest,
) (*chatmodel.SubmitConversationTypingResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.InteractionHandler.SubmitTyping(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleResolveCommandResults(
	ctx context.Context,
	request *chatmodel.ResolveConversationCommandResultsRequest,
) (*chatmodel.ResolveConversationCommandResultsResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.CommandResultHandler.Resolve(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleSubmitReadCursor(
	ctx context.Context,
	request *chatmodel.SubmitConversationReadCursorRequest,
) (*chatmodel.SubmitConversationReadCursorResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.InteractionHandler.SubmitReadCursor(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleSubmitDeliveryReceipt(
	ctx context.Context,
	request *chatmodel.SubmitConversationDeliveryReceiptRequest,
) (*chatmodel.SubmitConversationDeliveryReceiptResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.InteractionHandler.SubmitDeliveryReceipt(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleClaimDeviceInbox(
	ctx context.Context,
	request *chatmodel.ClaimDeviceInboxRequest,
) (*chatmodel.ClaimDeviceInboxResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.DeviceInboxHandler.Claim(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleAcknowledgeDeviceInbox(
	ctx context.Context,
	request *chatmodel.AcknowledgeDeviceInboxItemRequest,
) (*chatmodel.AcknowledgeDeviceInboxItemResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.DeviceInboxHandler.Acknowledge(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleRejectDeviceInbox(
	ctx context.Context,
	request *chatmodel.RejectDeviceInboxItemRequest,
) (*chatmodel.RejectDeviceInboxItemResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.composition.DeviceInboxHandler.Reject(
		ctx,
		authenticated,
		request,
	)

	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) authenticatedConversationView(
	ctx context.Context,
	rawConversationID string,
) (query.ConversationView, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return query.ConversationView{}, err
	}
	conversationID, err := valueobject.NewConversationID(rawConversationID)
	if err != nil {
		return query.ConversationView{}, mapProductionConversationError(ctx, err)
	}
	view, err := s.composition.QueryService.Get(ctx, conversationID, actor)
	if err != nil {
		return query.ConversationView{}, mapProductionConversationError(ctx, err)
	}

	return view, nil
}

func (s *subServer) authenticatedEvents(
	ctx context.Context,
	rawConversationID string,
	afterSequence int64,
	requestedLimit int,
) ([]*chatmodel.ConversationEvent, error) {
	records, err := s.authenticatedEventRecords(
		ctx,
		rawConversationID,
		afterSequence,
		normalizedConversationLimit(requestedLimit),
	)
	if err != nil {
		return nil, err
	}

	return productionEvents(records)
}

func (s *subServer) authenticatedEventRecords(
	ctx context.Context,
	rawConversationID string,
	afterSequence int64,
	limit int,
) ([]domainevent.Record, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	conversationID, err := valueobject.NewConversationID(rawConversationID)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if afterSequence < 0 {
		return nil, server.BadRequest("after sequence cannot be negative")
	}
	records, err := s.composition.QueryService.Events(
		ctx,
		conversationID,
		actor,
		valueobject.Sequence(afterSequence),
		limit,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}

	return records, nil
}

func (s *subServer) localCommandPreparation(
	ctx context.Context,
	authenticated conversationhttp.AuthenticatedActor,
	wireCommand *chatmodel.ChatCommand,
) (aggregate.CommandPreparation, []ports.EndpointRoute, error) {
	if wireCommand.GetSender() == nil ||
		wireCommand.GetSender().GetPtid() != authenticated.PTID ||
		wireCommand.GetSender().GetDeviceId() != authenticated.DeviceID {
		return aggregate.CommandPreparation{}, nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"production_http.prepare_local_command",
			"sender",
			"does not match the authenticated endpoint",
		)
	}
	if wireCommand.GetAuthorityStationPeerId() != string(s.localStation) {
		return aggregate.CommandPreparation{}, nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"production_http.prepare_local_command",
			"authority_station_peer_id",
			"does not identify the local Station",
		)
	}
	conversationID, err := valueobject.NewConversationID(
		wireCommand.GetConversationId(),
	)
	if err != nil {
		return aggregate.CommandPreparation{}, nil, err
	}
	sender, err := valueobject.NewEndpoint(
		authenticated.PTID,
		authenticated.DeviceID,
	)
	if err != nil {
		return aggregate.CommandPreparation{}, nil, err
	}
	verifiedRoutes, err := s.composition.productionCommandRoutes(
		ctx,
		s.composition.CommandService,
		conversationID,
		sender.Actor,
	)
	if err != nil {
		return aggregate.CommandPreparation{}, nil, err
	}
	prepareRequest, err := productionPrepareCommandRequest(
		conversationID,
		sender,
		s.localStation,
		verifiedRoutes,
		productionWireCommandKind(wireCommand),
	)
	if err != nil {
		return aggregate.CommandPreparation{}, nil, err
	}
	preparation, err := s.composition.CommandService.PrepareCommand(
		ctx,
		prepareRequest,
	)
	return preparation, verifiedRoutes, err
}

func (s *subServer) commandAuthorityPlan(
	ctx context.Context,
	wireCommand *chatmodel.ChatCommand,
) (*entity.AuthorityPlan, error) {
	transition := wireCommand.GetMembershipTransition()
	if transition == nil {
		return nil, nil
	}
	plan, err := s.loadAuthorityPlan(
		ctx,
		valueobject.PlanID(transition.GetAuthorityPlanId()),
	)
	if err != nil {
		return nil, err
	}

	return &plan, nil
}

func (s *subServer) loadAuthorityPlan(
	ctx context.Context,
	planID valueobject.PlanID,
) (entity.AuthorityPlan, error) {
	var plan entity.AuthorityPlan
	err := s.composition.UnitOfWork.Execute(
		ctx,
		func(transaction ports.Transaction) error {
			var loadErr error
			plan, loadErr = transaction.Repositories.AuthorityPlans.LoadForUpdate(
				ctx,
				planID,
			)

			return loadErr
		},
	)
	return plan, err
}

func productionCommandRejection(
	ctx context.Context,
	s *subServer,
	wireCommand *chatmodel.ChatCommand,
	verifiedRoutes []ports.EndpointRoute,
	err error,
) *chatmodel.SubmitConversationAuthorityCommandResponse {
	response := &chatmodel.SubmitConversationAuthorityCommandResponse{
		RejectCode: conversationhttp.MapRejectCode(err),
	}
	if response.GetRejectCode() ==
		chatmodel.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_UNSPECIFIED {
		logger.Errorf(ctx, "Conversation command failed: %v", err)
	}
	if wireCommand != nil && wireCommand.GetConversationId() != "" &&
		wireCommand.GetSender() != nil {
		conversationID, idErr := valueobject.NewConversationID(
			wireCommand.GetConversationId(),
		)
		sender, senderErr := valueobject.NewEndpoint(
			wireCommand.GetSender().GetPtid(),
			wireCommand.GetSender().GetDeviceId(),
		)
		if idErr == nil && senderErr == nil {
			if current, prepareErr := s.composition.CommandService.PrepareCommand(
				ctx,
				command.PrepareCommandRequest{
					ConversationID:    conversationID,
					Sender:            sender,
					SenderHomeStation: s.localStation,
					VerifiedRoutes:    verifiedRoutes,
				},
			); prepareErr == nil {
				response.CurrentPlan = productionCommandPreparation(
					conversationID,
					current,
				)
			}
		}
	}

	return response
}

func productionCommandPreparation(
	conversationID valueobject.ConversationID,
	preparation aggregate.CommandPreparation,
) *chatmodel.PrepareConversationCommandResponse {
	return &chatmodel.PrepareConversationCommandResponse{
		ConversationId:         string(conversationID),
		ConversationKind:       productionConversationKind(preparation.Kind),
		AuthoritySequence:      int64(preparation.Head.Sequence),
		AuthorityHash:          productionOptionalHash(preparation.Head.EventHash),
		MembershipEpoch:        int64(preparation.Head.MembershipEpoch),
		MlsEpoch:               int64(preparation.Head.MLSEpoch),
		RequiredEndpoints:      productionActorDeviceRefs(preparation.RequiredEndpoints),
		DeliveryPlanSha256:     preparation.DeliveryPlanHash.Bytes(),
		AuthorityStationPeerId: string(preparation.AuthorityStation),
	}
}

func (s *subServer) productionGroupPlanResponse(
	plan entity.AuthorityPlan,
	manifests []*actormodel.ActorEndpointManifest,
) *chatmodel.PrepareConversationGroupResponse {
	return &chatmodel.PrepareConversationGroupResponse{
		AuthorityPlanId:        string(plan.ID),
		ExpiresAt:              timestamppb.New(plan.ExpiresAt.UTC()),
		AuthorityStationPeerId: string(s.localStation),
		ProspectiveEndpoints:   productionActorDeviceRefs(plan.PostEndpoints),
		ReservedKeyPackages:    productionPlanKeyPackageReservations(plan),
		EndpointManifests:      manifests,
		AuthorityPlanSha256:    plan.Hash.Bytes(),
	}
}

func (s *subServer) productionMembershipPlanResponse(
	plan entity.AuthorityPlan,
	manifests []*actormodel.ActorEndpointManifest,
) *chatmodel.PrepareConversationMembershipResponse {
	return &chatmodel.PrepareConversationMembershipResponse{
		AuthorityPlanId:        string(plan.ID),
		ExpiresAt:              timestamppb.New(plan.ExpiresAt.UTC()),
		AuthorityStationPeerId: string(s.localStation),
		AuthoritySequence:      int64(plan.AuthorityHead.Sequence),
		AuthorityHash:          productionOptionalHash(plan.AuthorityHead.EventHash),
		FromMembershipEpoch:    int64(plan.AuthorityHead.MembershipEpoch),
		FromMlsEpoch:           int64(plan.AuthorityHead.MLSEpoch),
		PreEndpoints:           productionActorDeviceRefs(plan.PreEndpoints),
		PostEndpoints:          productionActorDeviceRefs(plan.PostEndpoints),
		AddedEndpoints:         productionActorDeviceRefs(plan.AddedEndpoints),
		RemovedEndpoints:       productionActorDeviceRefs(plan.RemovedEndpoints),
		ReservedKeyPackages:    productionPlanKeyPackageReservations(plan),
		EndpointManifests:      manifests,
		AuthorityPlanSha256:    plan.Hash.Bytes(),
	}
}

func (c *ProductionComposition) productionEndpointManifests(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]*actormodel.ActorEndpointManifest, error) {
	canonicalActors := uniqueProductionActors(actors)
	manifests := make([]*actormodel.ActorEndpointManifest, 0, len(canonicalActors))
	for _, actor := range canonicalActors {
		homeStationValue, err := c.ActorCapabilities.
			ResolveActorHomeStationPeerID(ctx, string(actor))
		if err != nil {
			return nil, err
		}
		homeStation, err := valueobject.NewStationID(homeStationValue)
		if err != nil || string(homeStation) != homeStationValue {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"production_http.endpoint_manifests",
				"home_station_peer_id",
				"is not a canonical Actor Identity route",
			)
		}
		request := &actormodel.GetActorEndpointManifestRequest{
			Actor: &actormodel.ActorRef{
				Ptid: string(actor),
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
		}
		response := &actormodel.GetActorEndpointManifestResponse{}
		if homeStation == c.localStation {
			response, err = c.ActorCapabilities.GetEndpointManifest(
				ctx,
				string(c.localStation),
				request,
			)
		} else {
			runtime, resolveErr := c.FederationRuntime()
			if resolveErr != nil {
				return nil, resolveErr
			}
			err = runtime.CallPeer(ctx, sharedfederation.PeerCall{
				TargetStationPeerID: string(homeStation),
				Route: sharedfederation.
					PeerRouteActorEndpointManifest,
				Subject: string(c.localStation),
				Claims: map[string]string{
					sharedfederation.ClaimActorPTID: string(actor),
					sharedfederation.ClaimSourceStationPeerID: string(
						c.localStation,
					),
					sharedfederation.ClaimTargetStationPeerID: string(
						homeStation,
					),
				},
				Request:  request,
				Response: response,
			})
		}
		if err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}
		manifest := response.GetManifest()
		if validateErr := c.ActorCapabilities.ValidateEndpointManifest(
			manifest,
			string(actor),
			string(homeStation),
			c.clock.Now(),
		); validateErr != nil {
			return nil, validateErr
		}
		if homeStation != c.localStation {
			runtime, resolveErr := c.FederationRuntime()
			if resolveErr != nil {
				return nil, resolveErr
			}
			signingInput := productionEndpointManifestSigningInput(
				response.GetManifest(),
			)
			signingBytes, encodeErr := deterministicProductionProto(signingInput)
			if encodeErr != nil {
				return nil, encodeErr
			}
			if verifyErr := runtime.VerifyPeerSignature(
				ctx,
				string(homeStation),
				response.GetManifest().GetSigningKeyId(),
				signingBytes,
				response.GetManifest().GetStationSignature(),
			); verifyErr != nil {
				return nil, verifyErr
			}
		}
		if acceptErr := c.ActorCapabilities.
			AcceptVerifiedEndpointManifest(ctx, manifest); acceptErr != nil {
			return nil, acceptErr
		}
		manifests = append(
			manifests,
			proto.Clone(manifest).(*actormodel.ActorEndpointManifest),
		)
	}

	return manifests, nil
}

func (c *ProductionComposition) productionEndpointRoutes(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	manifests, err := c.productionEndpointManifests(ctx, actors)
	if err != nil {
		return nil, err
	}
	return productionEndpointRoutesFromManifests(manifests, actors)
}

func (c *ProductionComposition) productionAuthorityPlanRoutes(
	ctx context.Context,
	plan entity.AuthorityPlan,
) ([]ports.EndpointRoute, valueobject.Hash, error) {
	actors := productionPlanActors(plan)
	manifests, err := c.productionEndpointManifests(ctx, actors)
	if err != nil {
		return nil, valueobject.Hash{}, err
	}
	routes, err := productionEndpointRoutesFromManifests(manifests, actors)
	if err != nil {
		return nil, valueobject.Hash{}, err
	}
	_, stateHash, err := productionEndpointManifestSetHashes(manifests)
	if err != nil {
		return nil, valueobject.Hash{}, err
	}
	return routes, stateHash, nil
}

func (c *ProductionComposition) productionSubmitCommandRoutes(
	ctx context.Context,
	plan *entity.AuthorityPlan,
	membership bool,
	commandRoutes []ports.EndpointRoute,
) ([]ports.EndpointRoute, valueobject.Hash, error) {
	if !membership {
		return commandRoutes, valueobject.Hash{}, nil
	}
	if plan == nil {
		return nil, valueobject.Hash{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_http.submit_command_routes",
			"authority_plan",
			"is required for a membership transition",
		)
	}
	return c.productionAuthorityPlanRoutes(ctx, *plan)
}

func (c *ProductionComposition) productionCommandRoutes(
	ctx context.Context,
	service *command.Service,
	conversationID valueobject.ConversationID,
	sender valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	if service == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_http.command_routes",
			"command_service",
			"is required",
		)
	}
	actors, err := service.CommandRouteActors(ctx, conversationID, sender)
	if err != nil {
		return nil, err
	}
	return c.productionEndpointRoutes(ctx, actors)
}

func (s *subServer) productionEndpointRoutes(
	ctx context.Context,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	return s.composition.productionEndpointRoutes(ctx, actors)
}

func productionEndpointManifestSetHashes(
	manifests []*actormodel.ActorEndpointManifest,
) (valueobject.Hash, valueobject.Hash, error) {
	if len(manifests) == 0 {
		return valueobject.Hash{}, valueobject.Hash{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeActorKeyUnavailable,
			"production_http.endpoint_manifest_set_hash",
			"manifests",
			"is empty",
		)
	}
	canonical := append([]*actormodel.ActorEndpointManifest(nil), manifests...)
	sort.Slice(canonical, func(left int, right int) bool {
		return canonical[left].GetActor().GetPtid() <
			canonical[right].GetActor().GetPtid()
	})
	bindingFields := [][]byte{
		[]byte("peers-touch/conversation-endpoint-manifest-set"),
	}
	stateFields := [][]byte{
		[]byte("peers-touch/conversation-endpoint-manifest-state"),
	}
	for _, manifest := range canonical {
		signingInput := productionEndpointManifestSigningInput(manifest)
		signingBytes, err := deterministicProductionProto(signingInput)
		if err != nil {
			return valueobject.Hash{}, valueobject.Hash{}, err
		}
		bindingFields = append(bindingFields, signingBytes)
		stateInput := proto.Clone(signingInput).(*actormodel.ActorEndpointManifestSigningInput)
		stateInput.IssuedAt = nil
		stateInput.ExpiresAt = nil
		stateBytes, err := deterministicProductionProto(stateInput)
		if err != nil {
			return valueobject.Hash{}, valueobject.Hash{}, err
		}
		stateFields = append(stateFields, stateBytes)
	}
	return valueobject.HashBytes(valueobject.CanonicalTuple(bindingFields...)),
		valueobject.HashBytes(valueobject.CanonicalTuple(stateFields...)),
		nil
}

func productionEndpointRoutesFromManifests(
	manifests []*actormodel.ActorEndpointManifest,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	routes := make([]ports.EndpointRoute, 0)
	for _, manifest := range manifests {
		homeStation := valueobject.StationID(manifest.GetHomeStationPeerId())
		for _, entry := range manifest.GetActiveEndpoints() {
			endpoint, endpointErr := valueobject.NewEndpoint(
				entry.GetEndpoint().GetActor().GetPtid(),
				entry.GetEndpoint().GetDeviceId(),
			)
			if endpointErr != nil {
				return nil, endpointErr
			}
			routes = append(routes, ports.EndpointRoute{
				Endpoint:    endpoint,
				HomeStation: homeStation,
			})
		}
	}

	return canonicalProductionEndpointRoutes(routes, actors)
}

func canonicalProductionEndpointRoutes(
	routes []ports.EndpointRoute,
	actors []valueobject.PTID,
) ([]ports.EndpointRoute, error) {
	expectedActors := uniqueProductionActors(actors)
	expected := make(map[valueobject.PTID]struct{}, len(expectedActors))
	for _, actor := range expectedActors {
		expected[actor] = struct{}{}
	}
	seen := make(map[string]struct{}, len(routes))
	homes := make(map[valueobject.PTID]valueobject.StationID, len(expectedActors))
	canonical := append([]ports.EndpointRoute(nil), routes...)
	for _, route := range canonical {
		if route.Endpoint.Validate() != nil || route.HomeStation == "" {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"production_http.endpoint_routes",
				"route",
				"is invalid",
			)
		}
		if _, ok := expected[route.Endpoint.Actor]; !ok {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"production_http.endpoint_routes",
				"actor",
				"is outside the requested manifest set",
			)
		}
		if _, duplicate := seen[route.Endpoint.Key()]; duplicate {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"production_http.endpoint_routes",
				"route",
				"is duplicated",
			)
		}
		seen[route.Endpoint.Key()] = struct{}{}
		if home, ok := homes[route.Endpoint.Actor]; ok && home != route.HomeStation {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"production_http.endpoint_routes",
				"home_station_peer_id",
				"conflicts within one Actor manifest",
			)
		}
		homes[route.Endpoint.Actor] = route.HomeStation
	}
	for _, actor := range expectedActors {
		if homes[actor] == "" {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyUnavailable,
				"production_http.endpoint_routes",
				"actor",
				"has no verified active endpoint",
			)
		}
	}
	sort.Slice(canonical, func(left int, right int) bool {
		return canonical[left].Endpoint.Key() < canonical[right].Endpoint.Key()
	})

	return canonical, nil
}

func uniqueProductionActors(actors []valueobject.PTID) []valueobject.PTID {
	seen := make(map[valueobject.PTID]struct{}, len(actors))
	canonical := make([]valueobject.PTID, 0, len(actors))
	for _, actor := range actors {
		if _, exists := seen[actor]; exists {
			continue
		}
		seen[actor] = struct{}{}
		canonical = append(canonical, actor)
	}
	sort.Slice(canonical, func(left int, right int) bool {
		return canonical[left] < canonical[right]
	})

	return canonical
}

func productionEndpointManifestSigningInput(
	manifest *actormodel.ActorEndpointManifest,
) *actormodel.ActorEndpointManifestSigningInput {
	entries := make(
		[]*actormodel.ActorEndpointManifestEntry,
		0,
		len(manifest.GetActiveEndpoints()),
	)
	for _, entry := range manifest.GetActiveEndpoints() {
		entries = append(
			entries,
			proto.Clone(entry).(*actormodel.ActorEndpointManifestEntry),
		)
	}

	return &actormodel.ActorEndpointManifestSigningInput{
		FormatVersion:          manifest.GetFormatVersion(),
		ManifestId:             manifest.GetManifestId(),
		Actor:                  proto.Clone(manifest.GetActor()).(*actormodel.ActorRef),
		HomeStationPeerId:      manifest.GetHomeStationPeerId(),
		DirectoryVersion:       manifest.GetDirectoryVersion(),
		ActiveEndpoints:        entries,
		IssuedAt:               manifest.GetIssuedAt(),
		ExpiresAt:              manifest.GetExpiresAt(),
		SigningKeyId:           manifest.GetSigningKeyId(),
		ActorIdentityPublicKey: append([]byte(nil), manifest.GetActorIdentityPublicKey()...),
		ActorProfileVersion:    manifest.GetActorProfileVersion(),
	}
}

func productionPlanKeyPackageReservations(
	plan entity.AuthorityPlan,
) []*keyexchangemodel.MlsKeyPackageReservation {
	reservations := make(
		[]*keyexchangemodel.MlsKeyPackageReservation,
		0,
		len(plan.KeyPackageReservations),
	)
	for _, reservation := range valueobject.SortKeyPackageReservations(
		plan.KeyPackageReservations,
	) {
		reservations = append(
			reservations,
			&keyexchangemodel.MlsKeyPackageReservation{
				Target: &actormodel.ActorDeviceRef{
					Actor: &actormodel.ActorRef{
						Ptid: string(reservation.Endpoint.Actor),
						Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
					},
					DeviceId: string(reservation.Endpoint.Device),
				},
				PackageId:        reservation.PackageID,
				KeyPackage:       append([]byte(nil), reservation.KeyPackage...),
				KeyPackageSha256: reservation.PackageHash.Bytes(),
			},
		)
	}

	return reservations
}

func productionActorPTIDs(
	actors []*actormodel.ActorRef,
) ([]valueobject.PTID, error) {
	result := make([]valueobject.PTID, 0, len(actors))
	seen := make(map[valueobject.PTID]struct{}, len(actors))
	for _, actor := range actors {
		if actor == nil {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"production_http.actor_ptids",
				"members",
				"contains a nil ActorRef",
			)
		}
		ptid, err := valueobject.NewPTID(actor.GetPtid())
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[ptid]; duplicate {
			continue
		}
		seen[ptid] = struct{}{}
		result = append(result, ptid)
	}
	sort.Slice(result, func(left int, right int) bool {
		return result[left] < result[right]
	})

	return result, nil
}

func productionMembershipChange(
	request *chatmodel.PrepareConversationMembershipRequest,
) (entity.MembershipChange, error) {
	if request.GetTargetActor() == nil {
		return entity.MembershipChange{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"production_http.membership_change",
			"target_actor",
			"is required",
		)
	}
	actor, err := valueobject.NewPTID(request.GetTargetActor().GetPtid())
	if err != nil {
		return entity.MembershipChange{}, err
	}
	change := entity.MembershipChange{
		Actor:  actor,
		Device: valueobject.DeviceID(request.GetTargetDeviceId()),
		Role:   productionMemberRole(request.GetRole()),
	}
	switch request.GetAction() {
	case chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_ADD_ACTOR:
		change.Action = entity.MembershipActionAddActor
	case chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_REMOVE_ACTOR:
		change.Action = entity.MembershipActionRemoveActor
	case chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_LEAVE:
		change.Action = entity.MembershipActionLeave
	case chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_CHANGE_ROLE:
		change.Action = entity.MembershipActionChangeRole
	case chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_ADD_DEVICE:
		change.Action = entity.MembershipActionAddDevice
	case chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_REMOVE_DEVICE:
		change.Action = entity.MembershipActionRemoveDevice
	default:
		return entity.MembershipChange{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnsupportedTransition,
			"production_http.membership_change",
			"action",
			"is not supported",
		)
	}

	return change, nil
}

func productionConversation(snapshot aggregate.Snapshot) *chatmodel.Conversation {
	return &chatmodel.Conversation{
		ConversationId:         string(snapshot.ID),
		Kind:                   productionConversationKind(snapshot.Kind),
		AuthorityStationPeerId: string(snapshot.AuthorityStation),
		MembershipEpoch:        int64(snapshot.Head.MembershipEpoch),
		Status:                 productionConversationStatus(snapshot.Status),
		CreatedAt:              timestamppb.New(snapshot.CreatedAt.UTC()),
		UpdatedAt:              timestamppb.New(snapshot.UpdatedAt.UTC()),
		Name:                   snapshot.Settings.Name,
		Description:            snapshot.Settings.Description,
		AvatarCid:              snapshot.Settings.AvatarObjectID,
		OwnerPtid:              string(snapshot.Owner),
		Visibility:             productionConversationVisibility(snapshot.Settings.Visibility),
		MlsEpoch:               int64(snapshot.Head.MLSEpoch),
		FederationId:           string(snapshot.FederationID),
		AuthorityEpoch:         int64(snapshot.AuthorityEpoch),
	}
}

func productionConversationMember(
	conversationID valueobject.ConversationID,
	member entity.Member,
) *chatmodel.ConversationMember {
	var mutedUntil *timestamppb.Timestamp
	if member.MutedUntil != nil {
		mutedUntil = timestamppb.New(member.MutedUntil.UTC())
	}
	return &chatmodel.ConversationMember{
		ConversationId:         string(conversationID),
		Ptid:                   string(member.Actor),
		Role:                   productionMemberRoleProto(member.Role),
		MemberStatus:           productionMemberStatus(member.Status),
		ActorHomeStationPeerId: string(member.HomeStation),
		Muted:                  member.Muted,
		MutedUntil:             mutedUntil,
	}
}

func productionSnapshotMember(
	snapshot aggregate.Snapshot,
	actor valueobject.PTID,
) (entity.Member, bool) {
	for _, member := range snapshot.Members {
		if member.Actor == actor {
			return member, true
		}
	}
	return entity.Member{}, false
}

func productionPublicHead(head query.PublicHead) *chatmodel.ConversationPublicHead {
	source := chatmodel.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_AUTHORITY
	if head.Source == query.SourceFollower {
		source = chatmodel.ConversationPublicHeadSource_CONVERSATION_PUBLIC_HEAD_SOURCE_FOLLOWER
	}

	return &chatmodel.ConversationPublicHead{
		ConversationId:         string(head.ConversationID),
		Source:                 source,
		FederationId:           string(head.FederationID),
		AuthorityStationPeerId: string(head.AuthorityStation),
		AuthorityEpoch:         int64(head.AuthorityEpoch),
		GroupSeq:               int64(head.Head.Sequence),
		EventHash:              productionOptionalHash(head.Head.EventHash),
		MembershipEpoch:        int64(head.Head.MembershipEpoch),
		MlsEpoch:               int64(head.Head.MLSEpoch),
		Status:                 string(head.Status),
	}
}

func productionEvents(
	records []domainevent.Record,
) ([]*chatmodel.ConversationEvent, error) {
	events := make([]*chatmodel.ConversationEvent, 0, len(records))
	for _, record := range records {
		event, err := conversationhttp.MapEvent(record)
		if err != nil {
			return nil, err
		}
		events = append(events, event)
	}

	return events, nil
}

func productionConversationKind(
	kind valueobject.ConversationKind,
) chatmodel.ConversationKind {
	switch kind {
	case valueobject.ConversationKindDirect:
		return chatmodel.ConversationKind_CONVERSATION_KIND_DIRECT
	case valueobject.ConversationKindGroup:
		return chatmodel.ConversationKind_CONVERSATION_KIND_GROUP
	default:
		return chatmodel.ConversationKind_CONVERSATION_KIND_UNSPECIFIED
	}
}

func productionConversationStatus(
	status valueobject.ConversationStatus,
) chatmodel.ConversationStatus {
	switch status {
	case valueobject.ConversationStatusActive:
		return chatmodel.ConversationStatus_CONVERSATION_STATUS_ACTIVE
	case valueobject.ConversationStatusDissolved:
		return chatmodel.ConversationStatus_CONVERSATION_STATUS_DISSOLVED
	case valueobject.ConversationStatusDegradedReadOnly:
		return chatmodel.ConversationStatus_CONVERSATION_STATUS_DEGRADED_READ_ONLY
	case valueobject.ConversationStatusOrphanedReadOnly:
		return chatmodel.ConversationStatus_CONVERSATION_STATUS_ORPHANED_READ_ONLY
	default:
		return chatmodel.ConversationStatus_CONVERSATION_STATUS_UNSPECIFIED
	}
}

func productionMemberRole(role chatmodel.MemberRole) valueobject.MemberRole {
	switch role {
	case chatmodel.MemberRole_MEMBER_ROLE_OWNER:
		return valueobject.MemberRoleOwner
	case chatmodel.MemberRole_MEMBER_ROLE_ADMIN:
		return valueobject.MemberRoleAdmin
	default:
		return valueobject.MemberRoleMember
	}
}

func productionMemberRoleProto(role valueobject.MemberRole) chatmodel.MemberRole {
	switch role {
	case valueobject.MemberRoleOwner:
		return chatmodel.MemberRole_MEMBER_ROLE_OWNER
	case valueobject.MemberRoleAdmin:
		return chatmodel.MemberRole_MEMBER_ROLE_ADMIN
	case valueobject.MemberRoleMember:
		return chatmodel.MemberRole_MEMBER_ROLE_MEMBER
	default:
		return chatmodel.MemberRole_MEMBER_ROLE_UNSPECIFIED
	}
}

func productionMemberStatus(
	status valueobject.MemberStatus,
) chatmodel.MemberStatus {
	switch status {
	case valueobject.MemberStatusActive:
		return chatmodel.MemberStatus_MEMBER_STATUS_ACTIVE
	case valueobject.MemberStatusLeft:
		return chatmodel.MemberStatus_MEMBER_STATUS_LEFT
	case valueobject.MemberStatusRemoved:
		return chatmodel.MemberStatus_MEMBER_STATUS_REMOVED
	default:
		return chatmodel.MemberStatus_MEMBER_STATUS_UNSPECIFIED
	}
}

func productionConversationVisibility(
	visibility valueobject.ConversationVisibility,
) chatmodel.GroupVisibilityV1 {
	switch visibility {
	case valueobject.ConversationVisibilityPublic:
		return chatmodel.GroupVisibilityV1_GROUP_VISIBILITY_V1_PUBLIC
	case valueobject.ConversationVisibilityPrivate:
		return chatmodel.GroupVisibilityV1_GROUP_VISIBILITY_V1_PRIVATE
	default:
		return chatmodel.GroupVisibilityV1_GROUP_VISIBILITY_V1_UNSPECIFIED
	}
}

func productionActorDeviceRefs(
	endpoints []valueobject.Endpoint,
) []*actormodel.ActorDeviceRef {
	result := make([]*actormodel.ActorDeviceRef, 0, len(endpoints))
	for _, endpoint := range valueobject.SortEndpoints(endpoints) {
		result = append(result, &actormodel.ActorDeviceRef{
			Actor: &actormodel.ActorRef{
				Ptid: string(endpoint.Actor),
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			DeviceId: string(endpoint.Device),
		})
	}

	return result
}

func productionEndpointUnion(
	left []valueobject.Endpoint,
	right []valueobject.Endpoint,
) []valueobject.Endpoint {
	byKey := make(map[string]valueobject.Endpoint, len(left)+len(right))
	for _, endpoint := range append(
		append([]valueobject.Endpoint(nil), left...),
		right...,
	) {
		byKey[endpoint.Key()] = endpoint
	}
	result := make([]valueobject.Endpoint, 0, len(byKey))
	for _, endpoint := range byKey {
		result = append(result, endpoint)
	}

	return valueobject.SortEndpoints(result)
}

func productionPlanActors(plan entity.AuthorityPlan) []valueobject.PTID {
	actors := make(map[valueobject.PTID]struct{})
	if plan.Requester.Actor != "" {
		actors[plan.Requester.Actor] = struct{}{}
	}
	for _, change := range plan.Changes {
		actors[change.Actor] = struct{}{}
	}
	for _, endpoint := range append(
		append(
			[]valueobject.Endpoint(nil),
			plan.PreEndpoints...,
		),
		plan.PostEndpoints...,
	) {
		actors[endpoint.Actor] = struct{}{}
	}
	result := make([]valueobject.PTID, 0, len(actors))
	for actor := range actors {
		result = append(result, actor)
	}
	sort.Slice(result, func(left int, right int) bool {
		return result[left] < result[right]
	})

	return result
}

func productionGenesisMembers(plan entity.AuthorityPlan) []valueobject.PTID {
	actors := make(map[valueobject.PTID]struct{})
	for _, change := range plan.Changes {
		if change.Action == entity.MembershipActionAddActor {
			actors[change.Actor] = struct{}{}
		}
	}
	result := make([]valueobject.PTID, 0, len(actors))
	for actor := range actors {
		result = append(result, actor)
	}
	sort.Slice(result, func(left int, right int) bool {
		return result[left] < result[right]
	})

	return result
}

func productionThreadReply(
	record domainevent.Record,
) (rootID string, replyID string, matched bool) {
	if record.Fact.Kind != domainevent.KindMessageCommitted {
		return "", "", false
	}
	var source chatmodel.ChatCommand
	if err := proto.Unmarshal(record.Fact.Payload, &source); err != nil {
		return "", "", false
	}
	message := source.GetSendMessage()
	if message == nil || message.GetThreadRootMessageId() == "" {
		return "", "", false
	}

	return message.GetThreadRootMessageId(), message.GetMessageId(), true
}

func productionMemberSettings(
	settings repository.MemberSettings,
) *chatmodel.MemberSettings {
	return &chatmodel.MemberSettings{
		Nickname:        settings.Nickname,
		Muted:           settings.Muted,
		AlertEnabled:    settings.AlertEnabled,
		Pinned:          settings.Pinned,
		Background:      settings.Background,
		BackgroundImage: settings.BackgroundImage,
	}
}

func authenticatedConversationActor(
	ctx context.Context,
) (conversationhttp.AuthenticatedActor, valueobject.Endpoint, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return conversationhttp.AuthenticatedActor{}, valueobject.Endpoint{}, err
	}
	deviceID := strings.TrimSpace(serverwrapper.GetDeviceID(ctx))
	if deviceID == "" {
		return conversationhttp.AuthenticatedActor{}, valueobject.Endpoint{},
			server.Unauthorized("authenticated Conversation device is required")
	}
	endpoint, err := valueobject.NewEndpoint(string(actor), deviceID)
	if err != nil {
		return conversationhttp.AuthenticatedActor{}, valueobject.Endpoint{},
			mapProductionConversationError(ctx, err)
	}
	authenticated := conversationhttp.AuthenticatedActor{
		PTID:     string(actor),
		DeviceID: deviceID,
	}

	return authenticated, endpoint, nil
}

func authenticatedConversationPTID(
	ctx context.Context,
) (valueobject.PTID, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return "", server.Unauthorized("authenticated Conversation actor is required")
	}
	actor, err := valueobject.NewPTID(subject.ID)
	if err != nil {
		return "", server.Unauthorized("authenticated Conversation PTID is invalid")
	}

	return actor, nil
}

func normalizedConversationLimit(limit int) int {
	if limit <= 0 {
		return defaultConversationQueryLimit
	}
	if limit > maximumConversationQueryLimit {
		return maximumConversationQueryLimit
	}

	return limit
}

func deterministicProductionProto(message proto.Message) ([]byte, error) {
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return nil, server.InternalErrorWithCause(
			"encode canonical Conversation request",
			err,
		)
	}

	return encoded, nil
}

func productionOptionalHash(hash valueobject.Hash) []byte {
	if hash.IsZero() {
		return nil
	}

	return hash.Bytes()
}

func productionStringPointer(value string) *string {
	return &value
}

func productionBoolPointer(value bool) *bool {
	return &value
}

func productionInt64Pointer(value int64) *int64 {
	return &value
}

func mapProductionConversationError(ctx context.Context, err error) error {
	if err == nil {
		return nil
	}
	var handlerError *server.HandlerError
	if errors.As(err, &handlerError) {
		return handlerError
	}
	if denied := new(social_gate.PolicyDeniedError); errors.As(err, &denied) {
		logger.Warnf(ctx, "Conversation policy rejected request: %v", err)

		return server.Forbidden("Conversation policy rejected the request")
	}
	actorIdentityCode := actoridentitydomain.CodeOf(err)
	switch actorIdentityCode {
	case actoridentitydomain.ErrorCodeInvalidArgument:
		return productionActorIdentityHandlerError(
			http.StatusBadRequest,
			"invalid Actor Identity request",
			actorIdentityCode,
			err,
		)
	case actoridentitydomain.ErrorCodeUnauthorized,
		actoridentitydomain.ErrorCodeInvalidProof:
		return productionActorIdentityHandlerError(
			http.StatusForbidden,
			"Actor Identity operation is not authorized",
			actorIdentityCode,
			err,
		)
	case actoridentitydomain.ErrorCodeDeviceNotFound:
		return productionActorIdentityHandlerError(
			http.StatusNotFound,
			"Actor Identity device was not found",
			actorIdentityCode,
			err,
		)
	case actoridentitydomain.ErrorCodeIdentityConflict,
		actoridentitydomain.ErrorCodeDeviceConflict,
		actoridentitydomain.ErrorCodeStaleProfileVersion,
		actoridentitydomain.ErrorCodeFutureProfileVersion,
		actoridentitydomain.ErrorCodeDeviceRevoked:
		return productionActorIdentityHandlerError(
			http.StatusConflict,
			"Actor Identity state conflicts with the request",
			actorIdentityCode,
			err,
		)
	case actoridentitydomain.ErrorCodeIdentityUnavailable,
		actoridentitydomain.ErrorCodePersistence:
		return productionActorIdentityHandlerError(
			http.StatusServiceUnavailable,
			"Actor Identity dependency is unavailable",
			actorIdentityCode,
			err,
		)
	}
	deliveryCode := deliveryapp.CodeOf(err)
	switch deliveryCode {
	case deliveryapp.ErrorCodeInvalidArgument:
		return productionDeviceInboxHandlerError(
			http.StatusBadRequest,
			"invalid Device Inbox request",
			deliveryCode,
			err,
		)
	case deliveryapp.ErrorCodeUnauthorized:
		return productionDeviceInboxHandlerError(
			http.StatusForbidden,
			"Device Inbox operation is not authorized",
			deliveryCode,
			err,
		)
	case deliveryapp.ErrorCodeItemNotFound:
		return productionDeviceInboxHandlerError(
			http.StatusNotFound,
			"Device Inbox item was not found",
			deliveryCode,
			err,
		)
	case deliveryapp.ErrorCodeConsumerFenced,
		deliveryapp.ErrorCodeItemOwnerMismatch,
		deliveryapp.ErrorCodeItemNotHead,
		deliveryapp.ErrorCodeItemNotClaimed,
		deliveryapp.ErrorCodePayloadHashMismatch,
		deliveryapp.ErrorCodeIdempotencyConflict,
		deliveryapp.ErrorCodeLeaseExpired:
		return productionDeviceInboxHandlerError(
			http.StatusConflict,
			"Device Inbox state conflicts with the request",
			deliveryCode,
			err,
		)
	case deliveryapp.ErrorCodeQuotaExceeded:
		return productionDeviceInboxHandlerError(
			http.StatusTooManyRequests,
			"Device Inbox quota exceeded",
			deliveryCode,
			err,
		)
	case deliveryapp.ErrorCodePersistence:
		return productionDeviceInboxHandlerError(
			http.StatusServiceUnavailable,
			"Device Inbox persistence is unavailable",
			deliveryCode,
			err,
		)
	}
	interactionCode := interactionapp.CodeOf(err)
	switch interactionCode {
	case interactionapp.ErrorCodeInvalidArgument:
		return productionInteractionHandlerError(
			http.StatusBadRequest,
			"invalid Conversation interaction request",
			interactionCode,
			err,
		)
	case interactionapp.ErrorCodeUnauthorized:
		return productionInteractionHandlerError(
			http.StatusForbidden,
			"Conversation interaction is not authorized",
			interactionCode,
			err,
		)
	case interactionapp.ErrorCodeStalePulse,
		interactionapp.ErrorCodeIdempotencyConflict,
		interactionapp.ErrorCodeIntegrityFailed:
		return productionInteractionHandlerError(
			http.StatusConflict,
			"Conversation interaction conflicts with committed state",
			interactionCode,
			err,
		)
	case interactionapp.ErrorCodeQuotaExceeded:
		return productionInteractionHandlerError(
			http.StatusTooManyRequests,
			"Conversation interaction quota exceeded",
			interactionCode,
			err,
		)
	case interactionapp.ErrorCodePersistence:
		return productionInteractionHandlerError(
			http.StatusServiceUnavailable,
			"Conversation interaction persistence is unavailable",
			interactionCode,
			err,
		)
	}
	code := conversationdomain.CodeOf(err)
	switch code {
	case conversationdomain.ErrorCodeInvalidArgument,
		conversationdomain.ErrorCodeDeliverySetMismatch,
		conversationdomain.ErrorCodeUnsupportedTransition:
		return productionConversationHandlerError(
			http.StatusBadRequest,
			"invalid Conversation request",
			code,
			err,
		)
	case conversationdomain.ErrorCodeUnauthorized,
		conversationdomain.ErrorCodeMemberMuted:
		return productionConversationHandlerError(
			http.StatusForbidden,
			"Conversation operation is not authorized",
			code,
			err,
		)
	case conversationdomain.ErrorCodeNotFound:
		return productionConversationHandlerError(
			http.StatusNotFound,
			"Conversation was not found",
			code,
			err,
		)
	case conversationdomain.ErrorCodeTargetNotMember:
		return productionConversationHandlerError(
			http.StatusNotFound,
			"Conversation target member was not found",
			code,
			err,
		)
	case conversationdomain.ErrorCodeCommandConflict,
		conversationdomain.ErrorCodeStaleAuthorityHead,
		conversationdomain.ErrorCodeStaleMembershipEpoch,
		conversationdomain.ErrorCodeStaleMLSEpoch,
		conversationdomain.ErrorCodeOwnerProtected,
		conversationdomain.ErrorCodeMembershipConflict,
		conversationdomain.ErrorCodeDeviceConflict,
		conversationdomain.ErrorCodeHashChainInvalid,
		conversationdomain.ErrorCodeAuthorityPlanStale,
		conversationdomain.ErrorCodeAuthorityPlanExpired,
		conversationdomain.ErrorCodeAuthorityPlanState,
		conversationdomain.ErrorCodeProposalExpired,
		conversationdomain.ErrorCodeCommandExpired,
		conversationdomain.ErrorCodeProposalBinding,
		conversationdomain.ErrorCodeProposalSignature,
		conversationdomain.ErrorCodeActorKeyRevoked,
		conversationdomain.ErrorCodeFederationInactive,
		conversationdomain.ErrorCodeInactive,
		conversationdomain.ErrorCodeReadOnly:
		return productionConversationHandlerError(
			http.StatusConflict,
			"Conversation state conflicts with the request",
			code,
			err,
		)
	case conversationdomain.ErrorCodeActorKeyUnavailable:
		return productionConversationHandlerError(
			http.StatusServiceUnavailable,
			"Conversation identity dependency is unavailable",
			code,
			err,
		)
	default:
		var stageError *productionStageError
		if errors.As(err, &stageError) {
			return productionStageHandlerError(ctx, stageError)
		}
		logger.Errorf(ctx, "Conversation operation failed: %v", err)

		return server.InternalErrorWithCause("Conversation operation failed", err)
	}
}

func productionStageHandlerError(
	ctx context.Context,
	stageError *productionStageError,
) *server.HandlerError {
	logger.Errorf(
		ctx,
		"Conversation operation failed at %s/%s: %v",
		stageError.operation,
		stageError.stage,
		stageError.cause,
	)
	handlerError := server.NewHandlerErrorWithCause(
		http.StatusInternalServerError,
		"Conversation operation failed",
		stageError,
	)
	handlerError.Headers = map[string]string{
		"X-Peers-Error-Code": productionInternalErrorCode,
	}
	details, err := json.Marshal(map[string]string{
		"operation": stageError.operation,
		"field":     "stage",
		"reason":    stageError.stage,
	})
	if err == nil && len(details) <= 4096 {
		handlerError.Headers["X-Peers-Error-Details"] = string(details)
	}
	return handlerError
}

func productionActorIdentityHandlerError(
	status int,
	message string,
	code actoridentitydomain.ErrorCode,
	err error,
) *server.HandlerError {
	handlerError := server.NewHandlerErrorWithCause(status, message, err)
	handlerError.Headers = map[string]string{
		"X-Peers-Error-Code": string(code),
	}
	var typed *actoridentitydomain.Error
	if errors.As(err, &typed) {
		details, encodeErr := json.Marshal(map[string]string{
			"operation": typed.Operation,
			"field":     typed.Field,
			"reason":    typed.Message,
		})
		if encodeErr == nil && len(details) <= 4096 {
			handlerError.Headers["X-Peers-Error-Details"] = string(details)
		}
	}
	return handlerError
}

func productionDeviceInboxHandlerError(
	status int,
	message string,
	code deliveryapp.ErrorCode,
	err error,
) *server.HandlerError {
	handlerError := server.NewHandlerErrorWithCause(status, message, err)
	handlerError.Headers = map[string]string{
		"X-Peers-Error-Code": string(code),
	}
	var typed *deliveryapp.Error
	if errors.As(err, &typed) {
		details, encodeErr := json.Marshal(map[string]string{
			"operation": typed.Operation,
			"field":     typed.Field,
			"reason":    typed.Message,
		})
		if encodeErr == nil && len(details) <= 4096 {
			handlerError.Headers["X-Peers-Error-Details"] = string(details)
		}
	}
	return handlerError
}

func productionInteractionHandlerError(
	status int,
	message string,
	code interactionapp.ErrorCode,
	err error,
) *server.HandlerError {
	handlerError := server.NewHandlerErrorWithCause(status, message, err)
	handlerError.Headers = map[string]string{
		"X-Peers-Error-Code": string(code),
	}
	var typed *interactionapp.Error
	if errors.As(err, &typed) {
		details, encodeErr := json.Marshal(map[string]string{
			"operation": typed.Operation,
			"field":     typed.Field,
			"reason":    typed.Message,
		})
		if encodeErr == nil && len(details) <= 4096 {
			handlerError.Headers["X-Peers-Error-Details"] = string(details)
		}
	}
	return handlerError
}

func productionConversationHandlerError(
	status int,
	message string,
	code conversationdomain.ErrorCode,
	err error,
) *server.HandlerError {
	handlerError := server.NewHandlerErrorWithCause(status, message, err)
	handlerError.Headers = map[string]string{
		"X-Peers-Error-Code": string(code),
	}
	var typed *conversationdomain.Error
	if errors.As(err, &typed) {
		details, encodeErr := json.Marshal(map[string]string{
			"operation": typed.Operation,
			"field":     typed.Field,
			"reason":    typed.Message,
		})
		if encodeErr == nil && len(details) <= 4096 {
			handlerError.Headers["X-Peers-Error-Details"] = string(details)
		}
	}
	return handlerError
}
