package conversation

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	conversationfederation "github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/federation"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	productionFollowerReplayFormatVersion = uint32(1)
	productionFollowerReplayLimit         = 128
	productionFollowerReplayTTL           = time.Minute
)

// FederationPeerHandler exposes resource-owner behavior to the Federation
// route registry without allowing Conversation to register peer routes.
func (s *subServer) FederationPeerHandler(
	route federationruntime.PeerRoute,
) (server.EndpointHandler, error) {
	switch route {
	case federationruntime.PeerRouteConversationCommandPrepare:
		return s.handleFederatedCommandPrepare, nil
	case federationruntime.PeerRouteConversationGroupAdmissionEvaluate:
		return s.handleFederatedGroupAdmissionEvaluate, nil
	case federationruntime.PeerRouteConversationGroupAdmissionBind:
		return s.handleFederatedGroupAdmissionBind, nil
	case federationruntime.PeerRouteConversationGroupAdmissionComplete:
		return s.handleFederatedGroupAdmissionComplete, nil
	case federationruntime.PeerRouteConversationGroupInvitationActivate:
		return s.handleFederatedGroupInvitationActivate, nil
	case federationruntime.PeerRouteConversationLeaveIntentSubmit:
		return s.handleFederatedLeaveIntentSubmit, nil
	case federationruntime.PeerRouteConversationLeaveIntentList:
		return s.handleFederatedLeaveIntentList, nil
	case federationruntime.PeerRouteConversationFollowerEvents:
		return s.handleFederatedFollowerEvents, nil
	case federationruntime.PeerRouteConversationEventSync:
		return s.handleFederatedEventSync, nil
	case federationruntime.PeerRouteConversationAttachmentObject:
		return s.handleFederatedAttachmentObject, nil
	case federationruntime.PeerRouteConversationAttachmentStatus:
		return s.handleFederatedAttachmentStatus, nil
	case federationruntime.PeerRouteConversationAttachmentBegin:
		return s.handleFederatedAttachmentBegin, nil
	case federationruntime.PeerRouteConversationAttachmentChunk:
		return s.handleFederatedAttachmentChunk, nil
	case federationruntime.PeerRouteConversationAttachmentComplete:
		return s.handleFederatedAttachmentComplete, nil
	case federationruntime.PeerRouteConversationAttachmentCancel:
		return s.handleFederatedAttachmentCancel, nil
	default:
		return nil, fmt.Errorf(
			"Conversation does not own Federation peer route %q",
			route,
		)
	}
}

func (s *subServer) handleFederatedGroupAdmissionEvaluate(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.EvaluateFederatedGroupAdmissionRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	evaluation := input.GetRequest()
	if claims == nil || evaluation == nil ||
		evaluation.GetInviter() == nil ||
		evaluation.GetInviter().GetActor() == nil ||
		input.GetSourceAuthorityStationPeerId() != claims.Issuer ||
		evaluation.GetAuthorityStationPeerId() != claims.Issuer ||
		evaluation.GetInviteeHomeStationPeerId() != string(s.localStation) ||
		claims.Custom[federationruntime.ClaimFederationID] != evaluation.GetFederationId() ||
		claims.Custom[federationruntime.ClaimConversationID] != evaluation.GetConversationId() ||
		claims.Custom[federationruntime.ClaimActorPTID] !=
			evaluation.GetInviter().GetActor().GetPtid() ||
		claims.Custom[federationruntime.ClaimDeviceID] !=
			evaluation.GetInviter().GetDeviceId() ||
		claims.Custom[federationruntime.ClaimRequestID] != evaluation.GetRequestId() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the group-admission evaluation",
		)
	}
	result, wake, err := s.groupAdmission.Evaluate(ctx, evaluation)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	if wake != nil {
		if err := s.composition.realtime.PublishServiceNotification(
			ctx,
			ports.ServiceNotificationWake{
				RecipientActor:   valueobject.PTID(wake.RecipientPTID),
				NotificationID:   wake.NotificationID,
				NotificationType: wake.Type,
				Category:         wake.Category,
				GroupKey:         wake.GroupKey,
				CreatedAtUnixMs:  wake.CreatedAt.UTC().UnixMilli(),
			},
		); err != nil {
			logger.Warn(
				ctx,
				"Conversation group-invitation wake failed",
				"invitation_id",
				result.GetInvitation().GetInvitationId(),
				"error",
				err,
			)
		}
	}
	return productionWritePeerResponse(
		response,
		&chatmodel.EvaluateFederatedGroupAdmissionResponse{
			Result: result,
		},
	)
}

func (s *subServer) handleFederatedGroupAdmissionBind(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.BindFederatedGroupAdmissionFulfillmentRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	binding := input.GetRequest()
	if claims == nil || binding == nil || binding.GetFulfillment() == nil ||
		input.GetSourceAuthorityStationPeerId() != claims.Issuer ||
		binding.GetFulfillment().GetInviteeHomeStationPeerId() !=
			string(s.localStation) ||
		claims.Custom[federationruntime.ClaimRequestID] != binding.GetRequestId() ||
		claims.Custom[federationruntime.ClaimAuthorityPlanID] !=
			binding.GetAuthorityPlanId() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the group-admission binding",
		)
	}
	grant, err := s.groupAdmission.BindFulfillment(ctx, binding)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	return productionWritePeerResponse(
		response,
		&chatmodel.BindFederatedGroupAdmissionFulfillmentResponse{
			Result: &chatmodel.GroupAdmissionFulfillmentResponse{
				Grant: grant,
			},
		},
	)
}

func (s *subServer) handleFederatedGroupAdmissionComplete(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.CompleteFederatedGroupAdmissionTransitionRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	completion := input.GetRequest()
	event := completion.GetCommittedEvent()
	fact := event.GetMembershipTransitionCommitted()
	if claims == nil || completion == nil || event == nil || fact == nil ||
		input.GetSourceAuthorityStationPeerId() != claims.Issuer ||
		completion.GetTargetHomeStationPeerId() != string(s.localStation) ||
		event.GetAuthorityStationPeerId() != claims.Issuer ||
		claims.Custom[federationruntime.ClaimFederationID] !=
			fact.GetPostState().GetFederationId() ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			event.GetConversationId() ||
		claims.Custom[federationruntime.ClaimActorPTID] !=
			completion.GetActorPtid() ||
		claims.Custom[federationruntime.ClaimAuthorityPlanID] !=
			completion.GetAuthorityPlanId() ||
		claims.Custom[federationruntime.ClaimTransitionID] !=
			fact.GetTransitionId() ||
		claims.Custom[federationruntime.ClaimAuthorityEpoch] !=
			strconv.FormatInt(fact.GetPostState().GetAuthorityEpoch(), 10) ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match group-admission completion",
		)
	}
	if err := s.composition.applyGroupAdmissionTransitionCompletion(
		ctx,
		completion,
	); err != nil {
		return mapProductionConversationError(ctx, err)
	}
	return productionWritePeerResponse(
		response,
		&chatmodel.CompleteFederatedGroupAdmissionTransitionResponse{
			Result: &chatmodel.CompleteGroupAdmissionTransitionResponse{
				Completed: true,
			},
		},
	)
}

func (s *subServer) handleFederatedGroupInvitationActivate(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.ActivateFederatedGroupGenesisInvitationsRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	activation := input.GetRequest()
	if claims == nil || activation == nil ||
		input.GetSourceAuthorityStationPeerId() != claims.Issuer ||
		activation.GetAuthorityStationPeerId() != claims.Issuer ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			activation.GetConversationId() ||
		claims.Custom[federationruntime.ClaimAuthorityPlanID] !=
			activation.GetAuthorityPlanId() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match deferred group-invitation activation",
		)
	}
	wakes, activated, err := s.groupAdmission.ActivateDeferredInvitations(
		ctx,
		activation.GetAuthorityPlanId(),
		activation.GetConversationId(),
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	for _, wake := range wakes {
		s.publishGroupAdmissionWake(ctx, wake)
	}
	return productionWritePeerResponse(
		response,
		&chatmodel.ActivateFederatedGroupGenesisInvitationsResponse{
			Result: &chatmodel.ActivateGroupGenesisInvitationsResponse{
				ActivatedCount: activated,
			},
		},
	)
}

func (s *subServer) handleFederatedCommandPrepare(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.PrepareFederatedConversationCommandRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if membership := input.GetMembershipRequest(); membership != nil {
		if claims == nil ||
			membership.GetSender() == nil ||
			membership.GetSender().GetActor() == nil ||
			input.GetSourceHomeStationPeerId() != claims.Issuer ||
			claims.Custom[federationruntime.ClaimConversationID] !=
				membership.GetConversationId() ||
			claims.Custom[federationruntime.ClaimActorPTID] !=
				membership.GetSender().GetActor().GetPtid() ||
			claims.Custom[federationruntime.ClaimDeviceID] !=
				membership.GetSender().GetDeviceId() ||
			claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
				claims.Issuer ||
			claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
				claims.Audience {
			return server.Forbidden(
				"Federation claims do not match the Conversation membership preparation",
			)
		}
		requester, err := valueobject.NewEndpoint(
			membership.GetSender().GetActor().GetPtid(),
			membership.GetSender().GetDeviceId(),
		)
		if err != nil {
			return mapProductionConversationError(ctx, err)
		}
		plan, err := s.prepareMembershipPlan(ctx, membership, requester)
		if err != nil {
			return mapProductionConversationError(ctx, err)
		}
		return productionWritePeerResponse(
			response,
			&chatmodel.PrepareFederatedConversationCommandResponse{
				Preparation: &chatmodel.PrepareFederatedConversationCommandResponse_MembershipPlan{
					MembershipPlan: plan,
				},
			},
		)
	}
	nested := input.GetRequest()
	if claims == nil ||
		nested == nil ||
		nested.GetSender() == nil ||
		nested.GetSender().GetActor() == nil ||
		input.GetSourceHomeStationPeerId() != claims.Issuer ||
		nested.GetAuthorityStationPeerId() != string(s.localStation) ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			nested.GetConversationId() ||
		claims.Custom[federationruntime.ClaimActorPTID] !=
			nested.GetSender().GetActor().GetPtid() ||
		claims.Custom[federationruntime.ClaimDeviceID] !=
			nested.GetSender().GetDeviceId() ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the Conversation preparation request",
		)
	}
	conversationID, err := valueobject.NewConversationID(
		nested.GetConversationId(),
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	sender, err := valueobject.NewEndpoint(
		nested.GetSender().GetActor().GetPtid(),
		nested.GetSender().GetDeviceId(),
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	sourceHomeStation, err := valueobject.NewStationID(claims.Issuer)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	verifiedRoutes, err := s.composition.productionCommandRoutes(
		ctx,
		s.composition.CommandService,
		conversationID,
		sender.Actor,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	prepareRequest, err := productionPrepareCommandRequest(
		conversationID,
		sender,
		sourceHomeStation,
		verifiedRoutes,
		nested.GetCommandKind(),
	)
	if err != nil {
		return err
	}
	preparation, err := s.composition.CommandService.PrepareCommand(
		ctx,
		prepareRequest,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(
		response,
		&chatmodel.PrepareFederatedConversationCommandResponse{
			Preparation: &chatmodel.PrepareFederatedConversationCommandResponse_Plan{
				Plan: productionCommandPreparation(conversationID, preparation),
			},
		},
	)
}

func (s *subServer) handleFederatedLeaveIntentSubmit(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.SubmitFederatedMlsLeaveIntentRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if err := productionValidateLeaveClaims(claims, input.GetIntent(), true); err != nil {
		return err
	}
	adapter, err := s.composition.federationCapabilityAdapter()
	if err != nil {
		return server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			"Conversation Federation capability is unavailable",
			err,
		)
	}
	result, err := adapter.SubmitLeaveIntent(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedLeaveIntentList(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.ListFederatedMlsLeaveIntentsRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		input.GetSourceHomeStationPeerId() != claims.Issuer ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			input.GetConversationId() {
		return server.Forbidden(
			"Federation claims do not match the leave-intent query",
		)
	}
	adapter, err := s.composition.federationCapabilityAdapter()
	if err != nil {
		return server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			"Conversation Federation capability is unavailable",
			err,
		)
	}
	result, err := adapter.ListLeaveIntents(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedEventSync(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.SyncAuthorityConversationEventsRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil ||
		claims.Custom[federationruntime.ClaimFederationID] !=
			input.GetFederationId() ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			input.GetConversationId() ||
		claims.Custom[federationruntime.ClaimAuthorityEpoch] !=
			strconv.FormatInt(input.GetAuthorityEpoch(), 10) {
		return server.Forbidden(
			"Federation claims do not match the Conversation event sync request",
		)
	}
	adapter, err := s.composition.federationCapabilityAdapter()
	if err != nil {
		return server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			"Conversation Federation capability is unavailable",
			err,
		)
	}
	result, err := adapter.SyncAuthorityEvents(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedFollowerEvents(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.GetConversationFollowerEventsRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	claims := httpadapter.GetVerifiedClaims(ctx)
	requestBytes, err := deterministicProductionProto(input)
	if err != nil {
		return err
	}
	requestHash := sha256.Sum256(requestBytes)
	if claims == nil ||
		claims.Subject != claims.Issuer ||
		input.GetFormatVersion() != productionFollowerReplayFormatVersion ||
		input.GetAuthorityStationPeerId() != string(s.localStation) ||
		input.GetTargetHomeStationPeerId() != claims.Issuer ||
		input.GetConversationId() == "" ||
		input.GetAfterSequence() < 0 ||
		len(input.GetRequestNonce()) != sha256.Size ||
		input.GetPageLimit() == 0 ||
		input.GetPageLimit() > productionFollowerReplayLimit ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			input.GetConversationId() ||
		claims.Custom[federationruntime.ClaimFollowerRequestSHA256] !=
			hex.EncodeToString(requestHash[:]) ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] !=
			claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] !=
			claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the follower event request",
		)
	}
	page, err := s.productionFollowerEventsPage(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, page)
}

func (s *subServer) productionFollowerEventsPage(
	ctx context.Context,
	targetHomeStationPeerID string,
	request *chatmodel.GetConversationFollowerEventsRequest,
) (*chatmodel.ConversationFollowerEventsPage, error) {
	var records []domainevent.Record
	var hasMore bool
	err := s.composition.UnitOfWork.Execute(
		ctx,
		func(transaction ports.Transaction) error {
			snapshot, err := transaction.Repositories.Authority.Get(
				ctx,
				valueobject.ConversationID(request.GetConversationId()),
			)
			if err != nil {
				return err
			}
			active, err := transaction.Federation.IsActiveStation(
				ctx,
				snapshot.FederationID,
				valueobject.StationID(targetHomeStationPeerID),
			)
			if err != nil {
				return err
			}
			if !active {
				return fmt.Errorf(
					"target Home Station is not active in the Conversation Federation",
				)
			}
			if snapshot.AuthorityStation != s.localStation ||
				!productionSnapshotHasHomeStation(
					snapshot,
					targetHomeStationPeerID,
				) {
				return fmt.Errorf(
					"target Home Station has no active Conversation entitlement",
				)
			}
			if request.GetAfterSequence() == 0 {
				if len(request.GetAfterEventHash()) != 0 {
					return fmt.Errorf(
						"follower genesis request cannot carry an event hash",
					)
				}
			} else {
				previous, err := transaction.Repositories.Events.GetBySequence(
					ctx,
					snapshot.ID,
					valueobject.Sequence(request.GetAfterSequence()),
				)
				if err != nil {
					return err
				}
				if !bytes.Equal(
					previous.Hash.Bytes(),
					request.GetAfterEventHash(),
				) {
					return fmt.Errorf(
						"follower event cursor hash does not match authority history",
					)
				}
			}
			records, err = transaction.Repositories.Events.List(
				ctx,
				snapshot.ID,
				valueobject.Sequence(request.GetAfterSequence()),
				int(request.GetPageLimit())+1,
			)
			if err != nil {
				return err
			}
			if len(records) > int(request.GetPageLimit()) {
				hasMore = true
				records = records[:int(request.GetPageLimit())]
			}

			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	events, err := productionEvents(records)
	if err != nil {
		return nil, err
	}
	grants := make(
		[]*chatmodel.ConversationEventProjectionGrant,
		0,
		len(events),
	)
	for _, event := range events {
		grants = append(grants, &chatmodel.ConversationEventProjectionGrant{
			EventId:                 event.GetEventId(),
			TargetHomeStationPeerId: targetHomeStationPeerID,
			EntitlementReason:       "active_member",
		})
	}
	now := s.composition.clock.Now().UTC()
	nextSequence := request.GetAfterSequence()
	if len(events) > 0 {
		nextSequence = events[len(events)-1].GetSequence()
	}
	page := &chatmodel.ConversationFollowerEventsPage{
		FormatVersion:           productionFollowerReplayFormatVersion,
		AuthorityStationPeerId:  string(s.localStation),
		TargetHomeStationPeerId: targetHomeStationPeerID,
		ConversationId:          request.GetConversationId(),
		RequestNonce:            append([]byte(nil), request.GetRequestNonce()...),
		ConversationEvents:      events,
		EventProjectionGrants:   grants,
		NextSequence:            nextSequence,
		HasMore:                 hasMore,
		GeneratedAt:             timestamppb.New(now),
		ExpiresAt:               timestamppb.New(now.Add(productionFollowerReplayTTL)),
		SigningKeyId:            s.composition.federationSenderSignerKeyID(),
	}
	signingInput, err := productionFollowerPageSigningInput(request, page)
	if err != nil {
		return nil, err
	}
	signingBytes, err := deterministicProductionProto(signingInput)
	if err != nil {
		return nil, err
	}
	signature, err := s.composition.federationSign(ctx, signingBytes)
	if err != nil {
		return nil, err
	}
	page.AuthoritySignature = signature

	return page, nil
}

func productionSnapshotHasHomeStation(
	snapshot aggregate.Snapshot,
	homeStationPeerID string,
) bool {
	for _, member := range snapshot.Members {
		if member.Active() &&
			member.HomeStation == valueobject.StationID(homeStationPeerID) {
			return true
		}
	}

	return false
}

func productionFollowerPageSigningInput(
	request *chatmodel.GetConversationFollowerEventsRequest,
	page *chatmodel.ConversationFollowerEventsPage,
) (*chatmodel.ConversationFollowerEventsPageSigningInput, error) {
	eventsHash, err := productionOrderedProtoDigest(page.GetConversationEvents())
	if err != nil {
		return nil, err
	}
	grantsHash, err := productionOrderedProtoDigest(page.GetEventProjectionGrants())
	if err != nil {
		return nil, err
	}

	return &chatmodel.ConversationFollowerEventsPageSigningInput{
		FormatVersion:               page.GetFormatVersion(),
		AuthorityStationPeerId:      page.GetAuthorityStationPeerId(),
		TargetHomeStationPeerId:     page.GetTargetHomeStationPeerId(),
		ConversationId:              page.GetConversationId(),
		RequestNonce:                append([]byte(nil), page.GetRequestNonce()...),
		AfterSequence:               request.GetAfterSequence(),
		AfterEventHash:              append([]byte(nil), request.GetAfterEventHash()...),
		EventsSha256:                eventsHash,
		EventProjectionGrantsSha256: grantsHash,
		NextSequence:                page.GetNextSequence(),
		HasMore:                     page.GetHasMore(),
		GeneratedAt:                 page.GetGeneratedAt(),
		ExpiresAt:                   page.GetExpiresAt(),
		SigningKeyId:                page.GetSigningKeyId(),
	}, nil
}

func productionOrderedProtoDigest[T proto.Message](messages []T) ([]byte, error) {
	var input bytes.Buffer
	for _, message := range messages {
		encoded, err := deterministicProductionProto(message)
		if err != nil {
			return nil, err
		}
		var length [4]byte
		binary.BigEndian.PutUint32(length[:], uint32(len(encoded)))
		input.Write(length[:])
		input.Write(encoded)
	}
	digest := sha256.Sum256(input.Bytes())

	return digest[:], nil
}

func (c *ProductionComposition) federationSenderSignerKeyID() string {
	if c == nil || c.federationSender == nil {
		return ""
	}

	return c.federationSenderSigner().KeyID()
}

func (c *ProductionComposition) federationSign(
	ctx context.Context,
	value []byte,
) ([]byte, error) {
	return c.federationSenderSigner().Sign(ctx, value)
}

func (c *ProductionComposition) federationSenderSigner() federationSigner {
	return &productionLazyFederationSigner{shared: c.shared}
}

type federationSigner interface {
	KeyID() string
	Sign(context.Context, []byte) ([]byte, error)
}

func (s *subServer) handleFederatedAttachmentBegin(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.BeginFederatedConversationAttachmentUploadRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	if err := s.validateFederatedAttachmentClaims(
		ctx,
		input.GetSourceHomeStationPeerId(),
		input.GetRequest().GetAuthorityStationId(),
		input.GetRequest().GetConversationId(),
		productionAttachmentActionBegin,
		input.GetRequest().GetAttachmentId(),
	); err != nil {
		return err
	}
	adapter, claims, err := s.federatedAttachmentAdapter(ctx)
	if err != nil {
		return err
	}
	result, err := adapter.BeginUpload(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentStatus(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.GetFederatedConversationAttachmentUploadRequest{}
	if err := productionDecodeMetadataHeader(request, input); err != nil {
		return err
	}
	uploadID, err := productionPathValue(
		request.Path(),
		"/federation/conversation/attachments/uploads/",
		"",
	)
	if err != nil || input.GetRequest().GetUploadId() != uploadID {
		return server.BadRequest(
			"federated attachment status path does not match metadata",
		)
	}
	if err := s.validateFederatedAttachmentClaims(
		ctx,
		input.GetSourceHomeStationPeerId(),
		input.GetRequest().GetAuthorityStationId(),
		input.GetRequest().GetConversationId(),
		productionAttachmentActionStatus,
		uploadID,
	); err != nil {
		return err
	}
	adapter, claims, err := s.federatedAttachmentAdapter(ctx)
	if err != nil {
		return err
	}
	result, err := adapter.GetUpload(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentChunk(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.PutFederatedConversationAttachmentChunkRequest{}
	if err := productionDecodeMetadataHeader(request, input); err != nil {
		return err
	}
	uploadID, chunkIndex, err := productionFederatedAttachmentChunkPath(
		request.Path(),
	)
	if err != nil ||
		input.GetRequest().GetUploadId() != uploadID ||
		input.GetRequest().GetChunkIndex() != chunkIndex {
		return server.BadRequest(
			"federated attachment chunk path does not match metadata",
		)
	}
	if err := s.validateFederatedAttachmentClaims(
		ctx,
		input.GetSourceHomeStationPeerId(),
		input.GetRequest().GetAuthorityStationId(),
		input.GetRequest().GetConversationId(),
		productionAttachmentActionChunk,
		productionAttachmentChunkResourceID(uploadID, chunkIndex),
	); err != nil {
		return err
	}
	adapter, claims, err := s.federatedAttachmentAdapter(ctx)
	if err != nil {
		return err
	}
	result, err := adapter.PutChunk(
		ctx,
		claims.Issuer,
		input,
		bytes.NewReader(request.Body()),
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentComplete(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.CompleteFederatedConversationAttachmentUploadRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	uploadID, err := productionPathValue(
		request.Path(),
		"/federation/conversation/attachments/uploads/",
		"/complete",
	)
	if err != nil || input.GetRequest().GetUploadId() != uploadID {
		return server.BadRequest(
			"federated attachment completion path does not match metadata",
		)
	}
	if err := s.validateFederatedAttachmentClaims(
		ctx,
		input.GetSourceHomeStationPeerId(),
		input.GetRequest().GetAuthorityStationId(),
		input.GetRequest().GetConversationId(),
		productionAttachmentActionComplete,
		uploadID,
	); err != nil {
		return err
	}
	adapter, claims, err := s.federatedAttachmentAdapter(ctx)
	if err != nil {
		return err
	}
	result, err := adapter.CompleteUpload(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentCancel(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.CancelFederatedConversationAttachmentUploadRequest{}
	if err := productionDecodePeerRequest(request, input); err != nil {
		return err
	}
	uploadID, err := productionPathValue(
		request.Path(),
		"/federation/conversation/attachments/uploads/",
		"/cancel",
	)
	if err != nil || input.GetRequest().GetUploadId() != uploadID {
		return server.BadRequest(
			"federated attachment cancellation path does not match metadata",
		)
	}
	if err := s.validateFederatedAttachmentClaims(
		ctx,
		input.GetSourceHomeStationPeerId(),
		input.GetRequest().GetAuthorityStationId(),
		input.GetRequest().GetConversationId(),
		productionAttachmentActionCancel,
		uploadID,
	); err != nil {
		return err
	}
	adapter, claims, err := s.federatedAttachmentAdapter(ctx)
	if err != nil {
		return err
	}
	result, err := adapter.CancelUpload(ctx, claims.Issuer, input)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}

	return productionWritePeerResponse(response, result)
}

func (s *subServer) handleFederatedAttachmentObject(
	ctx context.Context,
	request server.Request,
	response server.Response,
) error {
	input := &chatmodel.GetFederatedConversationAttachmentObjectRequest{}
	decodeErr := productionDecodeMetadataHeader(request, input)
	if decodeErr != nil {
		return decodeErr
	}
	objectID, err := productionPathValue(
		request.Path(),
		"/federation/conversation/attachments/objects/",
		"",
	)
	if err != nil || input.GetRequest().GetObjectId() != objectID {
		return server.BadRequest(
			"federated attachment object path does not match metadata",
		)
	}
	if err := s.validateFederatedAttachmentClaims(
		ctx,
		input.GetSourceHomeStationPeerId(),
		input.GetRequest().GetAuthorityStationId(),
		input.GetRequest().GetConversationId(),
		productionAttachmentActionObject,
		objectID,
	); err != nil {
		return err
	}
	start, end, _, err := productionAttachmentRange(
		productionRequestHeader(request, "Range"),
	)
	if err != nil {
		return err
	}
	adapter, claims, err := s.federatedAttachmentAdapter(ctx)
	if err != nil {
		return err
	}
	metadata, body, err := adapter.GetObject(
		ctx,
		claims.Issuer,
		input,
		start,
		end,
	)
	if err != nil {
		return mapProductionConversationError(ctx, err)
	}
	bodyTransferred := false
	defer func() {
		if !bodyTransferred {
			_ = body.Close()
		}
	}()
	encodedMetadata, err := deterministicProductionProto(metadata)
	if err != nil {
		return err
	}
	response.SetHeader(
		productionAttachmentMetadataHeader,
		base64.StdEncoding.EncodeToString(encodedMetadata),
	)
	response.SetHeader("Accept-Ranges", "bytes")
	response.SetHeader("Content-Type", "application/octet-stream")
	response.SetHeader(
		"ETag",
		`"`+hex.EncodeToString(metadata.GetResponse().GetEtagSha256())+`"`,
	)
	_, _, responseLength, responseStatus, contentRange, err :=
		productionAttachmentResponseBounds(
			productionRequestHeader(request, "Range"),
			metadata.GetResponse().GetTotalCiphertextSize(),
		)
	if err != nil {
		return err
	}
	response.SetHeader(
		"Content-Length",
		strconv.FormatInt(responseLength, 10),
	)
	if responseStatus == http.StatusPartialContent {
		response.SetHeader("Content-Range", contentRange)
	}
	response.WriteHeader(responseStatus)
	bodyTransferred = true
	return productionWriteAttachmentBody(response, body, responseLength)
}

func (s *subServer) validateFederatedAttachmentClaims(
	ctx context.Context,
	sourceHomeStationPeerID string,
	authorityStationPeerID string,
	conversationID string,
	action string,
	resourceID string,
) error {
	return validateFederatedAttachmentClaimValues(
		httpadapter.GetVerifiedClaims(ctx),
		string(s.localStation),
		sourceHomeStationPeerID,
		authorityStationPeerID,
		conversationID,
		action,
		resourceID,
	)
}

func validateFederatedAttachmentClaimValues(
	claims *authfed.VerifiedClaims,
	localStationPeerID string,
	sourceHomeStationPeerID string,
	authorityStationPeerID string,
	conversationID string,
	action string,
	resourceID string,
) error {
	if claims == nil ||
		claims.Scope != federationruntime.ConversationAttachmentScope ||
		claims.Issuer == "" ||
		claims.Audience != localStationPeerID ||
		claims.Subject == "" ||
		sourceHomeStationPeerID != claims.Issuer ||
		authorityStationPeerID != localStationPeerID ||
		claims.Custom[federationruntime.ClaimConversationID] != conversationID ||
		claims.Custom[federationruntime.ClaimActorPTID] != claims.Subject ||
		strings.TrimSpace(claims.Custom[federationruntime.ClaimDeviceID]) == "" ||
		claims.Custom[federationruntime.ClaimAttachmentAction] != action ||
		claims.Custom[federationruntime.ClaimAttachmentResourceID] != resourceID ||
		claims.Custom[federationruntime.ClaimSourceStationPeerID] != claims.Issuer ||
		claims.Custom[federationruntime.ClaimTargetStationPeerID] != claims.Audience {
		return server.Forbidden(
			"Federation claims do not match the attachment request",
		)
	}

	return nil
}

func (s *subServer) federatedAttachmentAdapter(
	ctx context.Context,
) (
	*conversationfederation.CapabilityAdapter,
	*authfed.VerifiedClaims,
	error,
) {
	claims := httpadapter.GetVerifiedClaims(ctx)
	if claims == nil {
		return nil, nil, server.Unauthorized(
			"authenticated Federation peer is required",
		)
	}
	adapter, err := s.composition.federationCapabilityAdapter()
	if err != nil {
		return nil, nil, server.NewHandlerErrorWithCause(
			http.StatusServiceUnavailable,
			"Conversation Federation capability is unavailable",
			err,
		)
	}

	return adapter, claims, nil
}

func productionValidateLeaveClaims(
	claims *authfed.VerifiedClaims,
	intent *chatmodel.MlsLeaveIntent,
	requireIntent bool,
) error {
	if claims == nil || intent == nil ||
		claims.Issuer == "" ||
		claims.Custom[federationruntime.ClaimFederationID] !=
			intent.GetFederationId() ||
		claims.Custom[federationruntime.ClaimConversationID] !=
			intent.GetConversationId() ||
		claims.Custom[federationruntime.ClaimDeviceID] !=
			intent.GetActorDeviceId() ||
		claims.Custom[federationruntime.ClaimAuthorityEpoch] !=
			strconv.FormatInt(intent.GetAuthorityEpoch(), 10) ||
		(requireIntent &&
			claims.Custom[federationruntime.ClaimIntentID] !=
				intent.GetIntentId()) {
		return server.Forbidden(
			"Federation claims do not match the MLS leave intent",
		)
	}

	return nil
}

func productionDecodePeerRequest(
	request server.Request,
	message proto.Message,
) error {
	if request == nil || message == nil || len(request.Body()) == 0 {
		return server.BadRequest("Federation protobuf request body is required")
	}
	if err := proto.Unmarshal(request.Body(), message); err != nil {
		return server.BadRequestWithCause(
			"Federation protobuf request body is invalid",
			err,
		)
	}
	if len(message.ProtoReflect().GetUnknown()) != 0 {
		return server.BadRequest(
			"Federation protobuf request contains unknown fields",
		)
	}

	return nil
}

func productionWritePeerResponse(
	response server.Response,
	message proto.Message,
) error {
	return productionWriteProto(response, http.StatusOK, message)
}

func productionFederatedAttachmentChunkPath(
	path string,
) (string, uint32, error) {
	const prefix = "/federation/conversation/attachments/uploads/"
	const separator = "/chunks/"
	clean := path
	if index := strings.IndexByte(clean, '?'); index >= 0 {
		clean = clean[:index]
	}
	if !strings.HasPrefix(clean, prefix) {
		return "", 0, server.BadRequest(
			"federated attachment chunk route is invalid",
		)
	}
	uploadID, rawIndex, found := strings.Cut(
		strings.TrimPrefix(clean, prefix),
		separator,
	)
	if !found || uploadID == "" || rawIndex == "" ||
		strings.Contains(uploadID, "/") ||
		strings.Contains(rawIndex, "/") {
		return "", 0, server.BadRequest(
			"federated attachment chunk route is invalid",
		)
	}
	index, err := strconv.ParseUint(rawIndex, 10, 32)
	if err != nil {
		return "", 0, server.BadRequest(
			"federated attachment chunk index is invalid",
		)
	}

	return uploadID, uint32(index), nil
}
