package conversation

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strconv"
	"strings"

	actoridentity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
	groupadmission "github.com/peers-labs/peers-touch/station/app/subserver/conversation/groupadmission"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/infrastructure/persistence"
	federationruntime "github.com/peers-labs/peers-touch/station/frame/core/federation"
	federationdelivery "github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	actormodel "github.com/peers-labs/peers-touch/station/frame/touch/model"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

type productionGroupAdmissionGrantSigner struct {
	federation ProductionFederationResolver
}

func (s productionGroupAdmissionGrantSigner) SignGrant(
	ctx context.Context,
	grant *chatmodel.GroupAdmissionGrant,
) error {
	if grant == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.sign_grant",
			"grant",
			"is required",
		)
	}
	runtime, err := s.federation()
	if err != nil {
		return err
	}
	signer := runtime.Signer()
	if signer == nil || strings.TrimSpace(signer.KeyID()) == "" {
		return fmt.Errorf("group admission: Station signer is unavailable")
	}
	grant.HomeStationSigningKeyId = signer.KeyID()
	signingInput := &chatmodel.GroupAdmissionGrantSigningInput{
		Version:                  grant.GetVersion(),
		GrantId:                  grant.GetGrantId(),
		ConversationId:           grant.GetConversationId(),
		FederationId:             grant.GetFederationId(),
		AuthorityStationPeerId:   grant.GetAuthorityStationPeerId(),
		AuthorityEpoch:           grant.GetAuthorityEpoch(),
		InviterPtid:              grant.GetInviterPtid(),
		InviterDeviceId:          grant.GetInviterDeviceId(),
		InviteePtid:              grant.GetInviteePtid(),
		InviteeHomeStationPeerId: grant.GetInviteeHomeStationPeerId(),
		SourceRequestId:          grant.GetSourceRequestId(),
		InvitationId:             grant.GetInvitationId(),
		FriendshipProofId:        grant.GetFriendshipProofId(),
		AdmissionPolicyRevision:  grant.GetAdmissionPolicyRevision(),
		State:                    grant.GetState(),
		AuthoritySequence:        grant.GetAuthoritySequence(),
		AuthorityHash:            grant.GetAuthorityHash(),
		IssuedAt:                 grant.GetIssuedAt(),
		ExpiresAt:                grant.GetExpiresAt(),
		BoundAuthorityPlanId:     grant.GetBoundAuthorityPlanId(),
		HomeStationSigningKeyId:  grant.GetHomeStationSigningKeyId(),
		FulfillmentTransitionId:  grant.GetFulfillmentTransitionId(),
	}
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(signingInput)
	if err != nil {
		return fmt.Errorf("group admission: encode grant signing input: %w", err)
	}
	signature, err := signer.Sign(ctx, canonical)
	if err != nil {
		return fmt.Errorf("group admission: sign grant: %w", err)
	}
	grant.HomeStationSignature = signature
	return nil
}

type productionGroupAdmissionDecisionVerifier struct {
	database     *gorm.DB
	localStation valueobject.StationID
}

func (v productionGroupAdmissionDecisionVerifier) VerifyDecision(
	ctx context.Context,
	command *chatmodel.GroupInvitationDecisionCommand,
	signingBytes []byte,
) error {
	if command == nil || command.GetActor() == nil ||
		command.GetActor().GetActor() == nil {
		return fmt.Errorf("group admission: decision command is incomplete")
	}
	actorPTID := command.GetActor().GetActor().GetPtid()
	var device actoridentity.ActorDeviceModel
	err := v.database.WithContext(ctx).
		Where(
			"ptid = ? AND device_id = ? AND signing_key_id = ? "+
				"AND home_station_peer_id = ? AND revoked = ? "+
				"AND verification_source <> ?",
			actorPTID,
			command.GetActor().GetDeviceId(),
			command.GetActorSigningKeyId(),
			string(v.localStation),
			false,
			0,
		).
		First(&device).Error
	if err != nil {
		return fmt.Errorf("group admission: resolve decision signing key: %w", err)
	}
	if len(device.PublicKey) != ed25519.PublicKeySize ||
		len(command.GetActorSignature()) != ed25519.SignatureSize ||
		!ed25519.Verify(
			ed25519.PublicKey(device.PublicKey),
			signingBytes,
			command.GetActorSignature(),
		) {
		return fmt.Errorf("group admission: decision signature is invalid")
	}
	return nil
}

func newProductionGroupAdmissionService(
	composition *ProductionComposition,
	relationships *ConversationRelationshipAdapter,
) (*groupadmission.Service, error) {
	return groupadmission.NewService(
		persistence.NewGroupAdmissionStore(composition.database),
		relationships,
		productionGroupAdmissionGrantSigner{
			federation: composition.FederationRuntime,
		},
		productionGroupAdmissionDecisionVerifier{
			database:     composition.database,
			localStation: composition.localStation,
		},
		composition.clock,
		productionUUIDGenerator{},
		string(composition.localStation),
	)
}

func (s *subServer) handleGetGroupAdmissionSettings(
	ctx context.Context,
	_ *chatmodel.GetGroupAdmissionSettingsRequest,
) (*chatmodel.GetGroupAdmissionSettingsResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	response, err := s.groupAdmission.GetSettings(ctx, string(actor))
	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleUpdateGroupAdmissionPreference(
	ctx context.Context,
	request *chatmodel.UpdateGroupAdmissionPreferenceRequest,
) (*chatmodel.UpdateGroupAdmissionPreferenceResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("Group admission preference update is required")
	}
	preference, err := s.groupAdmission.UpdatePreference(
		ctx,
		string(actor),
		request.GetMode(),
		request.GetObservedRevision(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chatmodel.UpdateGroupAdmissionPreferenceResponse{
		Preference: preference,
	}, nil
}

func (s *subServer) handleRemoveRejectedGroup(
	ctx context.Context,
	request *chatmodel.RemoveRejectedGroupRequest,
) (*chatmodel.RemoveRejectedGroupResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest("Rejected group removal is required")
	}
	preference, err := s.groupAdmission.RemoveRejectedGroup(
		ctx,
		string(actor),
		request.GetConversationId(),
		request.GetObservedPolicyRevision(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chatmodel.RemoveRejectedGroupResponse{
		Preference: preference,
	}, nil
}

func (s *subServer) handleListGroupInvitations(
	ctx context.Context,
	request *chatmodel.ListGroupInvitationsRequest,
) (*chatmodel.ListGroupInvitationsResponse, error) {
	actor, err := authenticatedConversationPTID(ctx)
	if err != nil {
		return nil, err
	}
	var states []chatmodel.GroupInvitationState
	if request != nil {
		states = request.GetStates()
	}
	invitations, err := s.groupAdmission.ListInvitations(
		ctx,
		string(actor),
		states,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chatmodel.ListGroupInvitationsResponse{
		Invitations: invitations,
	}, nil
}

func (s *subServer) handleDecideGroupInvitation(
	ctx context.Context,
	request *chatmodel.DecideGroupInvitationRequest,
) (*chatmodel.DecideGroupInvitationResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetCommand() == nil ||
		request.GetCommand().GetActor() == nil ||
		request.GetCommand().GetActor().GetActor() == nil ||
		request.GetCommand().GetActor().GetActor().GetPtid() != authenticated.PTID ||
		request.GetCommand().GetActor().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Group invitation decision does not match the authenticated endpoint",
		)
	}
	response, err := s.groupAdmission.Decide(
		ctx,
		authenticated.PTID,
		request.GetCommand(),
	)
	return response, mapProductionConversationError(ctx, err)
}

func (s *subServer) handleStartGroupLeaveReject(
	ctx context.Context,
	request *chatmodel.StartGroupLeaveRejectRequest,
) (*chatmodel.StartGroupLeaveRejectResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetActor() == nil ||
		request.GetActor().GetActor() == nil ||
		request.GetActor().GetActor().GetPtid() != authenticated.PTID ||
		request.GetActor().GetDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Group leave-and-reject does not match the authenticated endpoint",
		)
	}
	operation, preference, err := s.groupAdmission.StartLeaveReject(
		ctx,
		authenticated.PTID,
		request,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chatmodel.StartGroupLeaveRejectResponse{
		Operation:  operation,
		Preference: preference,
	}, nil
}

func (s *subServer) handleSubmitGroupLeaveRejectIntent(
	ctx context.Context,
	request *chatmodel.SubmitGroupLeaveRejectIntentRequest,
) (*chatmodel.SubmitGroupLeaveRejectIntentResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil || request.GetLeaveIntent() == nil ||
		request.GetLeaveIntent().GetActorPtid() != authenticated.PTID ||
		request.GetLeaveIntent().GetActorDeviceId() != authenticated.DeviceID {
		return nil, server.Forbidden(
			"Group leave-and-reject intent does not match the authenticated endpoint",
		)
	}
	operation, err := s.groupAdmission.AttachLeaveRejectIntent(
		ctx,
		authenticated.PTID,
		request.GetOperationId(),
		request.GetLeaveIntent(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	_, leaveErr := s.handleSubmitLeaveIntent(
		ctx,
		&chatmodel.SubmitMlsLeaveIntentRequest{
			Intent: request.GetLeaveIntent(),
		},
	)
	if leaveErr != nil {
		operation, err = s.groupAdmission.UpdateLeaveReject(
			ctx,
			operation,
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED,
			"LEAVE_INTENT_SUBMIT_FAILED",
		)
		if err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}
	} else {
		operation, err = s.groupAdmission.UpdateLeaveReject(
			ctx,
			operation,
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_INTENT_SUBMITTED,
			"",
		)
		if err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}
	}
	return &chatmodel.SubmitGroupLeaveRejectIntentResponse{
		Operation: operation,
	}, nil
}

func (s *subServer) handleGetGroupLeaveRejectOperation(
	ctx context.Context,
	request *chatmodel.GetGroupLeaveRejectOperationRequest,
) (*chatmodel.GetGroupLeaveRejectOperationResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest(
			"Group leave-and-reject operation is required",
		)
	}
	operation, err := s.groupAdmission.GetLeaveReject(
		ctx,
		authenticated.PTID,
		request.GetOperationId(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chatmodel.GetGroupLeaveRejectOperationResponse{
		Operation: operation,
	}, nil
}

func (s *subServer) handleRetryGroupLeaveReject(
	ctx context.Context,
	request *chatmodel.RetryGroupLeaveRejectRequest,
) (*chatmodel.RetryGroupLeaveRejectResponse, error) {
	authenticated, _, err := authenticatedConversationActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, server.BadRequest(
			"Group leave-and-reject retry operation is required",
		)
	}
	operation, intent, err := s.groupAdmission.GetLeaveRejectWithIntent(
		ctx,
		authenticated.PTID,
		request.GetOperationId(),
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	if intent == nil {
		operation, err = s.groupAdmission.UpdateLeaveReject(
			ctx,
			operation,
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED,
			"LEAVE_INTENT_CREATE_REQUIRED",
		)
		if err != nil {
			return nil, mapProductionConversationError(ctx, err)
		}
		return &chatmodel.RetryGroupLeaveRejectResponse{
			Operation: operation,
		}, nil
	}
	_, leaveErr := s.handleSubmitLeaveIntent(
		ctx,
		&chatmodel.SubmitMlsLeaveIntentRequest{Intent: intent},
	)
	state := chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_INTENT_SUBMITTED
	failureCode := ""
	if leaveErr != nil {
		state = chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED
		failureCode = "LEAVE_INTENT_SUBMIT_FAILED"
	}
	operation, err = s.groupAdmission.UpdateLeaveReject(
		ctx,
		operation,
		state,
		failureCode,
	)
	if err != nil {
		return nil, mapProductionConversationError(ctx, err)
	}
	return &chatmodel.RetryGroupLeaveRejectResponse{
		Operation: operation,
	}, nil
}

type productionGroupGenesisAdmissions struct {
	DirectMembers   []valueobject.PTID
	Fulfillments    []*chatmodel.GroupAdmissionFulfillment
	FulfillmentHash valueobject.Hash
	GenesisHash     valueobject.Hash
	DeferredHomes   []valueobject.StationID
}

func (s *subServer) prepareGroupGenesisAdmissions(
	ctx context.Context,
	planID valueobject.PlanID,
	conversationID valueobject.ConversationID,
	federationID valueobject.FederationID,
	groupName string,
	owner valueobject.Endpoint,
	requestedMembers []valueobject.PTID,
) (productionGroupGenesisAdmissions, error) {
	result := productionGroupGenesisAdmissions{}
	evaluations := make(
		[]*chatmodel.GroupGenesisAdmissionEvaluation,
		0,
		len(requestedMembers),
	)
	deferredHomes := make(map[valueobject.StationID]struct{})
	now := s.composition.clock.Now()
	expiresAt := now.Add(defaultAuthorityPlanTTL)
	for _, member := range requestedMembers {
		if member == owner.Actor {
			continue
		}
		targetHome, err := s.composition.ActorCapabilities.
			ResolveActorHomeStationPeerID(ctx, string(member))
		if err != nil {
			return productionGroupGenesisAdmissions{}, err
		}
		evaluation := &chatmodel.GroupAdmissionEvaluationRequest{
			Version:                1,
			ConversationId:         string(conversationID),
			FederationId:           string(federationID),
			AuthorityStationPeerId: string(s.localStation),
			AuthorityEpoch:         int64(initialConversationAuthorityEpoch),
			Inviter: &actormodel.ActorDeviceRef{
				Actor: &actormodel.ActorRef{
					Ptid: string(owner.Actor),
					Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
				},
				DeviceId: string(owner.Device),
			},
			Invitee: &actormodel.ActorRef{
				Ptid: string(member),
				Kind: actormodel.ActorKind_ACTOR_KIND_PERSON,
			},
			InviteeHomeStationPeerId:        targetHome,
			GroupNameSnapshot:               groupName,
			ObservedMembershipEpoch:         0,
			ObservedMlsEpoch:                0,
			AuthoritySequence:               0,
			AuthorityHash:                   make([]byte, sha256.Size),
			ExpiresAt:                       timestamppb.New(expiresAt),
			AuthorityPlanId:                 string(planID),
			DeferInvitationUntilGroupCommit: true,
		}
		evaluation.RequestId = groupAdmissionRequestID(evaluation, owner)
		admission, wake, err := s.evaluateGroupAdmission(
			ctx,
			evaluation,
			targetHome,
		)
		if err != nil {
			return productionGroupGenesisAdmissions{}, err
		}
		if wake != nil {
			return productionGroupGenesisAdmissions{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.prepare_genesis",
				"notification",
				"deferred genesis evaluation produced an early notification",
			)
		}
		evaluations = append(evaluations, &chatmodel.GroupGenesisAdmissionEvaluation{
			InviteePtid: string(member),
			Response:    admission,
		})
		switch admission.GetOutcome() {
		case chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DIRECT_ADD:
			grant := admission.GetGrant()
			if err := s.validateAdmissionGrant(
				ctx,
				grant,
				evaluation,
				targetHome,
			); err != nil {
				return productionGroupGenesisAdmissions{}, err
			}
			digest, err := groupAdmissionGrantDigest(grant)
			if err != nil {
				return productionGroupGenesisAdmissions{}, err
			}
			result.DirectMembers = append(result.DirectMembers, member)
			result.Fulfillments = append(
				result.Fulfillments,
				&chatmodel.GroupAdmissionFulfillment{
					GrantId:                  grant.GetGrantId(),
					InvitationId:             grant.GetInvitationId(),
					InviteePtid:              grant.GetInviteePtid(),
					InviteeHomeStationPeerId: targetHome,
					GrantSha256:              digest,
				},
			)
		case chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_CONFIRMATION_REQUIRED:
			if admission.GetInvitation() == nil {
				return productionGroupGenesisAdmissions{}, conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"group_admission.prepare_genesis",
					"invitation",
					"confirmation outcome omitted its deferred invitation",
				)
			}
			deferredHomes[valueobject.StationID(targetHome)] = struct{}{}
		case chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DENIED:
			return productionGroupGenesisAdmissions{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"group_admission.prepare_genesis",
				"invitee",
				admission.GetDenialCode(),
			)
		default:
			return productionGroupGenesisAdmissions{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.prepare_genesis",
				"outcome",
				"Home Station returned an invalid admission outcome",
			)
		}
	}
	fulfillmentBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(
		&chatmodel.GroupAdmissionFulfillmentSet{
			Fulfillments: result.Fulfillments,
		},
	)
	if err != nil {
		return productionGroupGenesisAdmissions{}, err
	}
	genesisBytes, err := (proto.MarshalOptions{Deterministic: true}).Marshal(
		&chatmodel.GroupGenesisAdmissionSet{Evaluations: evaluations},
	)
	if err != nil {
		return productionGroupGenesisAdmissions{}, err
	}
	result.FulfillmentHash = valueobject.HashBytes(fulfillmentBytes)
	result.GenesisHash = valueobject.HashBytes(genesisBytes)
	for home := range deferredHomes {
		result.DeferredHomes = append(result.DeferredHomes, home)
	}
	sort.Slice(result.DeferredHomes, func(left int, right int) bool {
		return result.DeferredHomes[left] < result.DeferredHomes[right]
	})
	return result, nil
}

func (s *subServer) activateGroupGenesisInvitations(
	ctx context.Context,
	plan entity.AuthorityPlan,
) error {
	if len(plan.DeferredInvitationHomes) == 0 {
		return nil
	}
	activation := &chatmodel.ActivateGroupGenesisInvitationsRequest{
		AuthorityPlanId:        string(plan.ID),
		ConversationId:         string(plan.ConversationID),
		AuthorityStationPeerId: string(s.localStation),
	}
	for _, home := range plan.DeferredInvitationHomes {
		if home == s.localStation {
			wakes, _, err := s.groupAdmission.ActivateDeferredInvitations(
				ctx,
				string(plan.ID),
				string(plan.ConversationID),
			)
			if err != nil {
				return err
			}
			for _, wake := range wakes {
				s.publishGroupAdmissionWake(ctx, wake)
			}
			continue
		}
		runtime, err := s.composition.FederationRuntime()
		if err != nil {
			return err
		}
		response := &chatmodel.ActivateFederatedGroupGenesisInvitationsResponse{}
		if err := runtime.CallPeer(ctx, federationruntime.PeerCall{
			TargetStationPeerID: string(home),
			Route: federationruntime.
				PeerRouteConversationGroupInvitationActivate,
			Subject: string(plan.Requester.Actor),
			Claims: map[string]string{
				federationruntime.ClaimFederationID:        string(plan.FederationID),
				federationruntime.ClaimConversationID:      string(plan.ConversationID),
				federationruntime.ClaimActorPTID:           string(plan.Requester.Actor),
				federationruntime.ClaimDeviceID:            string(plan.Requester.Device),
				federationruntime.ClaimAuthorityPlanID:     string(plan.ID),
				federationruntime.ClaimSourceStationPeerID: string(s.localStation),
				federationruntime.ClaimTargetStationPeerID: string(home),
			},
			Request: &chatmodel.ActivateFederatedGroupGenesisInvitationsRequest{
				Request:                      activation,
				SourceAuthorityStationPeerId: string(s.localStation),
			},
			Response: response,
		}); err != nil {
			return err
		}
		if response.GetResult() == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.activate_genesis",
				"response",
				"invitee Home Station returned an incomplete activation response",
			)
		}
	}
	return nil
}

func (s *subServer) prepareMembershipAdmission(
	ctx context.Context,
	request *chatmodel.PrepareConversationMembershipRequest,
	requester valueobject.Endpoint,
	conversation aggregate.Snapshot,
	authorityPlanID valueobject.PlanID,
) (
	*chatmodel.GroupAdmissionEvaluationResponse,
	*chatmodel.GroupAdmissionFulfillment,
	string,
	error,
) {
	if request.GetAction() !=
		chatmodel.ConversationMembershipAction_CONVERSATION_MEMBERSHIP_ACTION_ADD_ACTOR {
		if request.GetAdmissionFulfillment() != nil {
			return nil, nil, "", conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"group_admission.prepare_membership",
				"admission_fulfillment",
				"is only valid for ADD_ACTOR",
			)
		}
		return nil, nil, "", nil
	}
	if request.GetTargetActor() == nil {
		return nil, nil, "", conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.prepare_membership",
			"target_actor",
			"is required",
		)
	}
	targetHome, err := s.composition.ActorCapabilities.
		ResolveActorHomeStationPeerID(
			ctx,
			request.GetTargetActor().GetPtid(),
		)
	if err != nil {
		return nil, nil, "", err
	}
	if fulfillment := request.GetAdmissionFulfillment(); fulfillment != nil {
		if fulfillment.GetInviteeHomeStationPeerId() != targetHome {
			return nil, nil, "", conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.prepare_membership",
				"invitee_home_station_peer_id",
				"does not match the Actor directory",
			)
		}
		return nil, proto.Clone(fulfillment).(*chatmodel.GroupAdmissionFulfillment), targetHome, nil
	}

	now := s.composition.clock.Now()
	admission := &chatmodel.GroupAdmissionEvaluationRequest{
		Version:                  1,
		ConversationId:           string(conversation.ID),
		FederationId:             string(conversation.FederationID),
		AuthorityStationPeerId:   string(conversation.AuthorityStation),
		AuthorityEpoch:           int64(conversation.AuthorityEpoch),
		Inviter:                  request.GetSender(),
		Invitee:                  request.GetTargetActor(),
		InviteeHomeStationPeerId: targetHome,
		GroupNameSnapshot:        conversation.Settings.Name,
		ObservedMembershipEpoch:  int64(conversation.Head.MembershipEpoch),
		ObservedMlsEpoch:         int64(conversation.Head.MLSEpoch),
		AuthoritySequence:        int64(conversation.Head.Sequence),
		AuthorityHash:            conversation.Head.EventHash.Bytes(),
		ExpiresAt:                timestamppb.New(now.Add(defaultAuthorityPlanTTL)),
		AuthorityPlanId:          string(authorityPlanID),
	}
	admission.RequestId = groupAdmissionRequestID(admission, requester)
	result, wake, err := s.evaluateGroupAdmission(ctx, admission, targetHome)
	if err != nil {
		return nil, nil, "", err
	}
	if wake != nil {
		s.publishGroupAdmissionWake(ctx, *wake)
	}
	switch result.GetOutcome() {
	case chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DIRECT_ADD:
		grant := result.GetGrant()
		if err := s.validateAdmissionGrant(
			ctx,
			grant,
			admission,
			targetHome,
		); err != nil {
			return nil, nil, "", err
		}
		digest, err := groupAdmissionGrantDigest(grant)
		if err != nil {
			return nil, nil, "", err
		}
		return result, &chatmodel.GroupAdmissionFulfillment{
			GrantId:                  grant.GetGrantId(),
			InvitationId:             grant.GetInvitationId(),
			InviteePtid:              grant.GetInviteePtid(),
			InviteeHomeStationPeerId: targetHome,
			GrantSha256:              digest,
		}, targetHome, nil
	case chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DENIED,
		chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_CONFIRMATION_REQUIRED:
		return result, nil, targetHome, nil
	default:
		return nil, nil, "", conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.prepare_membership",
			"outcome",
			"Home Station returned an invalid admission outcome",
		)
	}
}

func (s *subServer) evaluateGroupAdmission(
	ctx context.Context,
	request *chatmodel.GroupAdmissionEvaluationRequest,
	targetHome string,
) (
	*chatmodel.GroupAdmissionEvaluationResponse,
	*groupadmission.NotificationWake,
	error,
) {
	if targetHome == string(s.localStation) {
		return s.groupAdmission.Evaluate(ctx, request)
	}
	runtime, err := s.composition.FederationRuntime()
	if err != nil {
		return nil, nil, err
	}
	response := &chatmodel.EvaluateFederatedGroupAdmissionResponse{}
	err = runtime.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: targetHome,
		Route: federationruntime.
			PeerRouteConversationGroupAdmissionEvaluate,
		Subject: request.GetInviter().GetActor().GetPtid(),
		Claims: map[string]string{
			federationruntime.ClaimFederationID:   request.GetFederationId(),
			federationruntime.ClaimConversationID: request.GetConversationId(),
			federationruntime.ClaimActorPTID: request.GetInviter().
				GetActor().
				GetPtid(),
			federationruntime.ClaimDeviceID:  request.GetInviter().GetDeviceId(),
			federationruntime.ClaimRequestID: request.GetRequestId(),
			federationruntime.ClaimAuthorityEpoch: strconv.FormatInt(
				request.GetAuthorityEpoch(),
				10,
			),
			federationruntime.ClaimSourceStationPeerID: string(s.localStation),
			federationruntime.ClaimTargetStationPeerID: targetHome,
		},
		Request: &chatmodel.EvaluateFederatedGroupAdmissionRequest{
			Request:                      request,
			SourceAuthorityStationPeerId: string(s.localStation),
		},
		Response: response,
	})
	if err != nil {
		return nil, nil, err
	}
	if response.GetResult() == nil {
		return nil, nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.evaluate_remote",
			"response",
			"is incomplete",
		)
	}
	return response.GetResult(), nil, nil
}

func (s *subServer) bindMembershipAdmission(
	ctx context.Context,
	conversation aggregate.Snapshot,
	requester valueobject.Endpoint,
	targetHome string,
	fulfillment *chatmodel.GroupAdmissionFulfillment,
	plan entity.AuthorityPlan,
) (*chatmodel.GroupAdmissionGrant, error) {
	if fulfillment == nil {
		return nil, nil
	}
	binding := &chatmodel.GroupAdmissionFulfillmentRequest{
		Version:         1,
		RequestId:       "bind:" + string(plan.ID),
		Fulfillment:     fulfillment,
		AuthorityPlanId: string(plan.ID),
		PlanExpiresAt:   timestamppb.New(plan.ExpiresAt.UTC()),
	}
	var grant *chatmodel.GroupAdmissionGrant
	if targetHome == string(s.localStation) {
		var err error
		grant, err = s.groupAdmission.BindFulfillment(ctx, binding)
		if err != nil {
			return nil, err
		}
	} else {
		runtime, err := s.composition.FederationRuntime()
		if err != nil {
			return nil, err
		}
		response := &chatmodel.BindFederatedGroupAdmissionFulfillmentResponse{}
		err = runtime.CallPeer(ctx, federationruntime.PeerCall{
			TargetStationPeerID: targetHome,
			Route: federationruntime.
				PeerRouteConversationGroupAdmissionBind,
			Subject: string(requester.Actor),
			Claims: map[string]string{
				federationruntime.ClaimFederationID:    string(conversation.FederationID),
				federationruntime.ClaimConversationID:  string(conversation.ID),
				federationruntime.ClaimActorPTID:       string(requester.Actor),
				federationruntime.ClaimDeviceID:        string(requester.Device),
				federationruntime.ClaimRequestID:       binding.GetRequestId(),
				federationruntime.ClaimAuthorityPlanID: string(plan.ID),
				federationruntime.ClaimAuthorityEpoch: strconv.FormatInt(
					int64(conversation.AuthorityEpoch),
					10,
				),
				federationruntime.ClaimSourceStationPeerID: string(s.localStation),
				federationruntime.ClaimTargetStationPeerID: targetHome,
			},
			Request: &chatmodel.BindFederatedGroupAdmissionFulfillmentRequest{
				Request:                      binding,
				SourceAuthorityStationPeerId: string(s.localStation),
			},
			Response: response,
		})
		if err != nil {
			return nil, err
		}
		if response.GetResult() != nil {
			grant = response.GetResult().GetGrant()
		}
	}
	if targetHome != string(s.localStation) {
		runtime, err := s.composition.FederationRuntime()
		if err != nil {
			return nil, err
		}
		if err := verifyFederatedGroupAdmissionGrant(ctx, runtime, grant); err != nil {
			return nil, err
		}
	}
	if err := validateBoundMembershipAdmission(
		conversation,
		requester,
		targetHome,
		fulfillment,
		grant,
		plan,
	); err != nil {
		return nil, err
	}
	return grant, nil
}

func validateBoundMembershipAdmission(
	conversation aggregate.Snapshot,
	requester valueobject.Endpoint,
	targetHome string,
	fulfillment *chatmodel.GroupAdmissionFulfillment,
	grant *chatmodel.GroupAdmissionGrant,
	plan entity.AuthorityPlan,
) error {
	if fulfillment == nil || grant == nil ||
		grant.GetState() !=
			chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_BOUND_TO_PLAN ||
		grant.GetGrantId() != fulfillment.GetGrantId() ||
		grant.GetInvitationId() != fulfillment.GetInvitationId() ||
		grant.GetInviteePtid() != fulfillment.GetInviteePtid() ||
		grant.GetInviteeHomeStationPeerId() !=
			fulfillment.GetInviteeHomeStationPeerId() ||
		grant.GetConversationId() != string(conversation.ID) ||
		grant.GetFederationId() != string(conversation.FederationID) ||
		grant.GetAuthorityStationPeerId() !=
			string(conversation.AuthorityStation) ||
		grant.GetAuthorityEpoch() != int64(conversation.AuthorityEpoch) ||
		grant.GetInviterPtid() != string(requester.Actor) ||
		grant.GetInviterDeviceId() != string(requester.Device) ||
		grant.GetInviteeHomeStationPeerId() != targetHome ||
		grant.GetBoundAuthorityPlanId() != string(plan.ID) ||
		grant.GetAuthoritySequence() !=
			int64(plan.AuthorityHead.Sequence) ||
		!bytes.Equal(
			grant.GetAuthorityHash(),
			plan.AuthorityHead.EventHash.Bytes(),
		) ||
		plan.ConversationID != conversation.ID ||
		plan.FederationID != conversation.FederationID ||
		plan.AuthorityEpoch != conversation.AuthorityEpoch {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.bind_membership",
			"grant",
			"does not match the authority plan",
		)
	}

	var matchingAdds int
	for _, change := range plan.Changes {
		if change.Action == entity.MembershipActionAddActor &&
			string(change.Actor) == grant.GetInviteePtid() &&
			string(change.HomeStation) == targetHome {
			matchingAdds++
		}
	}
	if matchingAdds != 1 {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.bind_membership",
			"invitee",
			"does not match exactly one ADD_ACTOR change in the authority plan",
		)
	}
	return nil
}

func groupAdmissionTransitionCompletions(
	transition *chatmodel.MembershipTransitionIntent,
	event *chatmodel.ConversationEvent,
) ([]*chatmodel.CompleteGroupAdmissionTransitionRequest, error) {
	if transition == nil || event == nil {
		return nil, nil
	}
	fact := event.GetMembershipTransitionCommitted()
	if fact == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.transition_completion",
			"committed_event",
			"is not a membership transition",
		)
	}
	fulfillments := make([]*chatmodel.GroupAdmissionFulfillment, 0, 1+
		len(transition.GetGenesisAdmissionFulfillments()))
	if transition.GetAdmissionFulfillment() != nil {
		fulfillments = append(fulfillments, transition.GetAdmissionFulfillment())
	}
	fulfillments = append(
		fulfillments,
		transition.GetGenesisAdmissionFulfillments()...,
	)
	if len(fulfillments) > 0 && transition.GetLeaveIntentId() != "" {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.transition_completion",
			"membership_transition",
			"cannot combine admission fulfillment with a leave intent",
		)
	}
	if len(fulfillments) > 0 {
		completions := make(
			[]*chatmodel.CompleteGroupAdmissionTransitionRequest,
			0,
			len(fulfillments),
		)
		seenGrants := make(map[string]struct{}, len(fulfillments))
		for _, fulfillment := range fulfillments {
			if fulfillment == nil ||
				fulfillment.GetGrantId() == "" ||
				fulfillment.GetInviteePtid() == "" ||
				fulfillment.GetInviteeHomeStationPeerId() == "" {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"group_admission.transition_completion",
					"admission_fulfillment",
					"is incomplete",
				)
			}
			if _, duplicate := seenGrants[fulfillment.GetGrantId()]; duplicate {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeMembershipConflict,
					"group_admission.transition_completion",
					"grant_id",
					"appears more than once",
				)
			}
			seenGrants[fulfillment.GetGrantId()] = struct{}{}
			var matches int
			for _, change := range fact.GetChanges() {
				if change.GetAction() ==
					chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR &&
					change.GetPtid() == fulfillment.GetInviteePtid() &&
					change.GetHomeStationPeerId() ==
						fulfillment.GetInviteeHomeStationPeerId() {
					matches++
				}
			}
			if matches != 1 {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"group_admission.transition_completion",
					"changes",
					"do not contain exactly one affected admission actor",
				)
			}
			completions = append(
				completions,
				&chatmodel.CompleteGroupAdmissionTransitionRequest{
					TargetHomeStationPeerId: fulfillment.
						GetInviteeHomeStationPeerId(),
					ActorPtid:            fulfillment.GetInviteePtid(),
					AuthorityPlanId:      transition.GetAuthorityPlanId(),
					AdmissionFulfillment: fulfillment,
					CommittedEvent:       event,
				},
			)
		}
		return completions, nil
	}
	if transition.GetLeaveIntentId() != "" {
		var actor valueobject.PTID
		var targetHome valueobject.StationID
		for _, change := range fact.GetChanges() {
			if change.GetAction() !=
				chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_LEAVE {
				continue
			}
			if actor != "" {
				return nil, conversationdomain.NewError(
					conversationdomain.ErrorCodeMembershipConflict,
					"group_admission.transition_completion",
					"changes",
					"one leave intent may remove only one actor",
				)
			}
			actor = valueobject.PTID(change.GetPtid())
			targetHome = valueobject.StationID(
				change.GetHomeStationPeerId(),
			)
		}
		if actor == "" || targetHome == "" {
			return nil, conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.transition_completion",
				"changes",
				"do not identify the affected actor Home Station",
			)
		}
		return []*chatmodel.CompleteGroupAdmissionTransitionRequest{{
			TargetHomeStationPeerId: string(targetHome),
			ActorPtid:               string(actor),
			AuthorityPlanId:         transition.GetAuthorityPlanId(),
			CommittedEvent:          event,
		}}, nil
	}
	return nil, nil
}

func validateGroupAdmissionTransitionCompletion(
	request *chatmodel.CompleteGroupAdmissionTransitionRequest,
) (*chatmodel.MembershipTransitionCommittedFact, error) {
	if request == nil || request.GetCommittedEvent() == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.validate_completion",
			"request",
			"committed event is required",
		)
	}
	event := request.GetCommittedEvent()
	fact := event.GetMembershipTransitionCommitted()
	if fact == nil || fact.GetPostState() == nil ||
		request.GetTargetHomeStationPeerId() == "" ||
		request.GetActorPtid() == "" ||
		request.GetAuthorityPlanId() == "" ||
		event.GetConversationId() == "" ||
		event.GetAuthorityStationPeerId() == "" ||
		fact.GetTransitionId() == "" ||
		event.GetMembershipEpoch() != fact.GetToMembershipEpoch() ||
		event.GetMlsEpoch() != fact.GetToMlsEpoch() ||
		fact.GetPostState().GetMembershipEpoch() != event.GetMembershipEpoch() ||
		fact.GetPostState().GetMlsEpoch() != event.GetMlsEpoch() {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.validate_completion",
			"committed_event",
			"is incomplete or internally inconsistent",
		)
	}
	hashInput := proto.Clone(event).(*chatmodel.ConversationEvent)
	hashInput.EventHash = nil
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(
		hashInput,
	)
	if err != nil {
		return nil, err
	}
	expectedHash := sha256.Sum256(canonical)
	if !bytes.Equal(event.GetEventHash(), expectedHash[:]) {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"group_admission.validate_completion",
			"event_hash",
			"does not match the committed event",
		)
	}

	var matched bool
	for _, change := range fact.GetChanges() {
		if change.GetPtid() != request.GetActorPtid() ||
			change.GetHomeStationPeerId() !=
				request.GetTargetHomeStationPeerId() {
			continue
		}
		if request.GetAdmissionFulfillment() != nil &&
			request.GetAdmissionFulfillment().GetInviteePtid() ==
				request.GetActorPtid() &&
			change.GetAction() ==
				chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR {
			matched = true
		}
		if request.GetAdmissionFulfillment() == nil &&
			fact.GetLeaveIntentId() != "" &&
			change.GetAction() ==
				chatmodel.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_LEAVE {
			matched = true
		}
	}
	if !matched {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.validate_completion",
			"membership_transition",
			"does not commit the affected actor",
		)
	}
	return fact, nil
}

func (c *ProductionComposition) applyGroupAdmissionTransitionCompletion(
	ctx context.Context,
	request *chatmodel.CompleteGroupAdmissionTransitionRequest,
) error {
	if c == nil || c.groupAdmission == nil {
		return fmt.Errorf("group admission completion service is unavailable")
	}
	fact, err := validateGroupAdmissionTransitionCompletion(request)
	if err != nil {
		return err
	}
	event := request.GetCommittedEvent()
	if fulfillment := request.GetAdmissionFulfillment(); fulfillment != nil {
		_, _, err = c.groupAdmission.CompleteFulfillment(
			ctx,
			fulfillment,
			request.GetActorPtid(),
			event.GetConversationId(),
			fact.GetPostState().GetFederationId(),
			event.GetAuthorityStationPeerId(),
			fact.GetPostState().GetAuthorityEpoch(),
			request.GetAuthorityPlanId(),
			fact.GetTransitionId(),
		)
		return err
	}
	_, err = c.groupAdmission.CompleteLeaveReject(
		ctx,
		request.GetActorPtid(),
		event.GetConversationId(),
		fact.GetPostState().GetFederationId(),
		event.GetAuthorityStationPeerId(),
		fact.GetLeaveIntentId(),
		fact.GetTransitionId(),
	)
	return err
}

func (c *ProductionComposition) completeGroupAdmissionTransitions(
	ctx context.Context,
	requests []*chatmodel.CompleteGroupAdmissionTransitionRequest,
) error {
	for _, request := range requests {
		if err := c.completeGroupAdmissionTransition(ctx, request); err != nil {
			return err
		}
	}
	return nil
}

func (c *ProductionComposition) completeGroupAdmissionTransition(
	ctx context.Context,
	request *chatmodel.CompleteGroupAdmissionTransitionRequest,
) error {
	if request == nil {
		return nil
	}
	if request.GetTargetHomeStationPeerId() == string(c.localStation) {
		return c.applyGroupAdmissionTransitionCompletion(ctx, request)
	}
	fact, err := validateGroupAdmissionTransitionCompletion(request)
	if err != nil {
		return err
	}
	runtime, err := c.FederationRuntime()
	if err != nil {
		return err
	}
	response := &chatmodel.CompleteFederatedGroupAdmissionTransitionResponse{}
	event := request.GetCommittedEvent()
	err = runtime.CallPeer(ctx, federationruntime.PeerCall{
		TargetStationPeerID: request.GetTargetHomeStationPeerId(),
		Route: federationruntime.
			PeerRouteConversationGroupAdmissionComplete,
		Subject: request.GetActorPtid(),
		Claims: map[string]string{
			federationruntime.ClaimFederationID: fact.GetPostState().
				GetFederationId(),
			federationruntime.ClaimConversationID: event.GetConversationId(),
			federationruntime.ClaimActorPTID:      request.GetActorPtid(),
			federationruntime.ClaimAuthorityPlanID: request.
				GetAuthorityPlanId(),
			federationruntime.ClaimTransitionID: fact.GetTransitionId(),
			federationruntime.ClaimAuthorityEpoch: strconv.FormatInt(
				fact.GetPostState().GetAuthorityEpoch(),
				10,
			),
			federationruntime.ClaimSourceStationPeerID: string(c.localStation),
			federationruntime.ClaimTargetStationPeerID: request.
				GetTargetHomeStationPeerId(),
		},
		Request: &chatmodel.CompleteFederatedGroupAdmissionTransitionRequest{
			Request:                      request,
			SourceAuthorityStationPeerId: string(c.localStation),
		},
		Response: response,
	})
	if err != nil {
		return err
	}
	if response.GetResult() == nil || !response.GetResult().GetCompleted() {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.complete_remote",
			"response",
			"is incomplete",
		)
	}
	return nil
}

func (s *subServer) validateAdmissionGrant(
	ctx context.Context,
	grant *chatmodel.GroupAdmissionGrant,
	request *chatmodel.GroupAdmissionEvaluationRequest,
	targetHome string,
) error {
	if grant == nil ||
		grant.GetState() !=
			chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED ||
		grant.GetConversationId() != request.GetConversationId() ||
		grant.GetFederationId() != request.GetFederationId() ||
		grant.GetAuthorityStationPeerId() != request.GetAuthorityStationPeerId() ||
		grant.GetAuthorityEpoch() != request.GetAuthorityEpoch() ||
		grant.GetInviterPtid() != request.GetInviter().GetActor().GetPtid() ||
		grant.GetInviterDeviceId() != request.GetInviter().GetDeviceId() ||
		grant.GetInviteePtid() != request.GetInvitee().GetPtid() ||
		grant.GetInviteeHomeStationPeerId() != targetHome ||
		(grant.GetSourceRequestId() != request.GetRequestId() &&
			(grant.GetInvitationId() == "" ||
				grant.GetSourceRequestId() !=
					"invitation:"+grant.GetInvitationId())) ||
		grant.GetAuthoritySequence() != request.GetAuthoritySequence() ||
		!strings.EqualFold(
			hex.EncodeToString(grant.GetAuthorityHash()),
			hex.EncodeToString(request.GetAuthorityHash()),
		) ||
		grant.GetExpiresAt() == nil ||
		!s.composition.clock.Now().Before(grant.GetExpiresAt().AsTime()) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.validate_grant",
			"grant",
			"does not match the membership request",
		)
	}
	if targetHome != string(s.localStation) {
		runtime, err := s.composition.FederationRuntime()
		if err != nil {
			return err
		}
		return verifyFederatedGroupAdmissionGrant(ctx, runtime, grant)
	}
	return nil
}

func (s *subServer) publishGroupAdmissionWake(
	ctx context.Context,
	wake groupadmission.NotificationWake,
) {
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
			"notification_id",
			wake.NotificationID,
			"error",
			err,
		)
	}
}

func groupAdmissionRequestID(
	request *chatmodel.GroupAdmissionEvaluationRequest,
	requester valueobject.Endpoint,
) string {
	seed := strings.Join([]string{
		request.GetConversationId(),
		request.GetFederationId(),
		request.GetAuthorityStationPeerId(),
		request.GetAuthorityPlanId(),
		strconv.FormatBool(request.GetDeferInvitationUntilGroupCommit()),
		strconv.FormatInt(request.GetAuthorityEpoch(), 10),
		string(requester.Actor),
		string(requester.Device),
		request.GetInvitee().GetPtid(),
		request.GetInviteeHomeStationPeerId(),
		strconv.FormatInt(request.GetObservedMembershipEpoch(), 10),
		strconv.FormatInt(request.GetObservedMlsEpoch(), 10),
		strconv.FormatInt(request.GetAuthoritySequence(), 10),
		hex.EncodeToString(request.GetAuthorityHash()),
	}, "\x00")
	sum := sha256.Sum256([]byte(seed))
	return "group-admission-" + hex.EncodeToString(sum[:])
}

func groupAdmissionGrantDigest(
	grant *chatmodel.GroupAdmissionGrant,
) ([]byte, error) {
	issued := &chatmodel.GroupAdmissionGrantSigningInput{
		Version:                  grant.GetVersion(),
		GrantId:                  grant.GetGrantId(),
		ConversationId:           grant.GetConversationId(),
		FederationId:             grant.GetFederationId(),
		AuthorityStationPeerId:   grant.GetAuthorityStationPeerId(),
		AuthorityEpoch:           grant.GetAuthorityEpoch(),
		InviterPtid:              grant.GetInviterPtid(),
		InviterDeviceId:          grant.GetInviterDeviceId(),
		InviteePtid:              grant.GetInviteePtid(),
		InviteeHomeStationPeerId: grant.GetInviteeHomeStationPeerId(),
		SourceRequestId:          grant.GetSourceRequestId(),
		InvitationId:             grant.GetInvitationId(),
		FriendshipProofId:        grant.GetFriendshipProofId(),
		AdmissionPolicyRevision:  grant.GetAdmissionPolicyRevision(),
		State:                    chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED,
		AuthoritySequence:        grant.GetAuthoritySequence(),
		AuthorityHash:            grant.GetAuthorityHash(),
		IssuedAt:                 grant.GetIssuedAt(),
		ExpiresAt:                grant.GetExpiresAt(),
		HomeStationSigningKeyId:  grant.GetHomeStationSigningKeyId(),
	}
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(issued)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(canonical)
	return append([]byte(nil), sum[:]...), nil
}

func verifyFederatedGroupAdmissionGrant(
	ctx context.Context,
	runtime ProductionFederationRuntime,
	grant *chatmodel.GroupAdmissionGrant,
) error {
	if runtime == nil || grant == nil ||
		grant.GetHomeStationSigningKeyId() == "" ||
		len(grant.GetHomeStationSignature()) != ed25519.SignatureSize {
		return fmt.Errorf("group admission: signed grant is incomplete")
	}
	signingInput := &chatmodel.GroupAdmissionGrantSigningInput{
		Version:                  grant.GetVersion(),
		GrantId:                  grant.GetGrantId(),
		ConversationId:           grant.GetConversationId(),
		FederationId:             grant.GetFederationId(),
		AuthorityStationPeerId:   grant.GetAuthorityStationPeerId(),
		AuthorityEpoch:           grant.GetAuthorityEpoch(),
		InviterPtid:              grant.GetInviterPtid(),
		InviterDeviceId:          grant.GetInviterDeviceId(),
		InviteePtid:              grant.GetInviteePtid(),
		InviteeHomeStationPeerId: grant.GetInviteeHomeStationPeerId(),
		SourceRequestId:          grant.GetSourceRequestId(),
		InvitationId:             grant.GetInvitationId(),
		FriendshipProofId:        grant.GetFriendshipProofId(),
		AdmissionPolicyRevision:  grant.GetAdmissionPolicyRevision(),
		State:                    grant.GetState(),
		AuthoritySequence:        grant.GetAuthoritySequence(),
		AuthorityHash:            grant.GetAuthorityHash(),
		IssuedAt:                 grant.GetIssuedAt(),
		ExpiresAt:                grant.GetExpiresAt(),
		BoundAuthorityPlanId:     grant.GetBoundAuthorityPlanId(),
		HomeStationSigningKeyId:  grant.GetHomeStationSigningKeyId(),
		FulfillmentTransitionId:  grant.GetFulfillmentTransitionId(),
	}
	canonical, err := (proto.MarshalOptions{Deterministic: true}).Marshal(signingInput)
	if err != nil {
		return err
	}
	return runtime.VerifyPeerSignature(
		ctx,
		grant.GetInviteeHomeStationPeerId(),
		grant.GetHomeStationSigningKeyId(),
		canonical,
		grant.GetHomeStationSignature(),
	)
}

var _ groupadmission.GrantSigner = productionGroupAdmissionGrantSigner{}
var _ groupadmission.DecisionVerifier = productionGroupAdmissionDecisionVerifier{}
var _ federationdelivery.Clock = productionSystemClock{}
