package groupadmission

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	chatmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	currentVersion       = uint32(1)
	defaultInvitationTTL = 7 * 24 * time.Hour
	maximumGrantTTL      = 10 * time.Minute
)

type Clock interface {
	Now() time.Time
}

type IDGenerator interface {
	NewID() string
}

type RelationshipReader interface {
	FriendshipProofID(
		ctx context.Context,
		actorPTID string,
		peerPTID string,
	) (string, bool, error)
}

type GrantSigner interface {
	SignGrant(context.Context, *chatmodel.GroupAdmissionGrant) error
}

type DecisionVerifier interface {
	VerifyDecision(
		context.Context,
		*chatmodel.GroupInvitationDecisionCommand,
		[]byte,
	) error
}

type NotificationWake struct {
	RecipientPTID  string
	NotificationID string
	Type           int32
	Category       int32
	GroupKey       string
	CreatedAt      time.Time
}

type EvaluationRecord struct {
	RequestSHA256 []byte
	Request       *chatmodel.GroupAdmissionEvaluationRequest
	Response      *chatmodel.GroupAdmissionEvaluationResponse
}

type DecisionRecord struct {
	CommandSHA256 []byte
	Invitation    *chatmodel.GroupInvitation
	Grant         *chatmodel.GroupAdmissionGrant
}

type Transaction interface {
	GetOrCreatePreference(
		context.Context,
		string,
		time.Time,
	) (*chatmodel.GroupAdmissionPreference, error)
	SavePreference(context.Context, *chatmodel.GroupAdmissionPreference) error
	ListRejectedGroups(context.Context, string) ([]*chatmodel.RejectedGroup, error)
	GetRejectedGroup(context.Context, string, string) (*chatmodel.RejectedGroup, error)
	SaveRejectedGroup(context.Context, string, *chatmodel.RejectedGroup) error
	UpdateRejectedGroupLeaveOperation(
		context.Context,
		string,
		string,
		string,
		chatmodel.GroupLeaveRejectState,
		string,
	) error
	DeleteRejectedGroup(context.Context, string, string) (bool, error)

	GetEvaluation(context.Context, string) (*EvaluationRecord, error)
	SaveEvaluation(
		context.Context,
		*chatmodel.GroupAdmissionEvaluationRequest,
		[]byte,
		*chatmodel.GroupAdmissionEvaluationResponse,
	) error
	ListDeferredInvitationEvaluations(
		context.Context,
		string,
		string,
	) ([]*EvaluationRecord, error)
	MarkInvitationEvaluationActivated(
		context.Context,
		string,
		string,
		time.Time,
	) error

	GetActiveInvitation(
		context.Context,
		string,
		string,
	) (*chatmodel.GroupInvitation, error)
	GetInvitation(context.Context, string) (*chatmodel.GroupInvitation, error)
	SaveInvitation(
		context.Context,
		*chatmodel.GroupInvitation,
		string,
		uint64,
	) error
	CompleteInvitation(
		context.Context,
		*chatmodel.GroupInvitation,
	) error
	RevokePendingInvitations(
		context.Context,
		string,
		string,
		time.Time,
	) error
	ListInvitations(
		context.Context,
		string,
		[]chatmodel.GroupInvitationState,
	) ([]*chatmodel.GroupInvitation, error)

	GetDecision(context.Context, string) (*DecisionRecord, error)
	SaveDecision(
		context.Context,
		*chatmodel.GroupInvitationDecisionCommand,
		[]byte,
		*chatmodel.GroupInvitation,
		*chatmodel.GroupAdmissionGrant,
	) error

	GetGrant(context.Context, string) (*chatmodel.GroupAdmissionGrant, error)
	GetGrantByInvitation(
		context.Context,
		string,
	) (*chatmodel.GroupAdmissionGrant, error)
	SaveGrant(context.Context, *chatmodel.GroupAdmissionGrant) error
	ProduceInvitationNotification(
		context.Context,
		*chatmodel.GroupInvitation,
	) (*NotificationWake, error)
	GetLeaveRejectOperation(
		context.Context,
		string,
	) (*chatmodel.GroupLeaveRejectOperation, error)
	GetLeaveRejectIntent(
		context.Context,
		string,
	) (*chatmodel.MlsLeaveIntent, error)
	GetLeaveRejectOperationByIntent(
		context.Context,
		string,
	) (*chatmodel.GroupLeaveRejectOperation, error)
	SaveLeaveRejectOperation(
		context.Context,
		*chatmodel.GroupLeaveRejectOperation,
		*chatmodel.MlsLeaveIntent,
	) error
}

type Store interface {
	Execute(context.Context, func(Transaction) error) error
	Read(context.Context, func(Transaction) error) error
}

type Service struct {
	store         Store
	relationships RelationshipReader
	signer        GrantSigner
	verifier      DecisionVerifier
	clock         Clock
	ids           IDGenerator
	localStation  string
}

func NewService(
	store Store,
	relationships RelationshipReader,
	signer GrantSigner,
	verifier DecisionVerifier,
	clock Clock,
	ids IDGenerator,
	localStation string,
) (*Service, error) {
	if store == nil || relationships == nil || signer == nil || verifier == nil ||
		clock == nil || ids == nil || strings.TrimSpace(localStation) == "" {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.new_service",
			"dependencies",
			"store, relationship reader, signer, verifier, clock, IDs, and local Station are required",
		)
	}
	return &Service{
		store:         store,
		relationships: relationships,
		signer:        signer,
		verifier:      verifier,
		clock:         clock,
		ids:           ids,
		localStation:  localStation,
	}, nil
}

func (s *Service) GetSettings(
	ctx context.Context,
	actorPTID string,
) (*chatmodel.GetGroupAdmissionSettingsResponse, error) {
	if err := requireCanonical("actor_ptid", actorPTID); err != nil {
		return nil, err
	}
	var response chatmodel.GetGroupAdmissionSettingsResponse
	err := s.store.Read(ctx, func(tx Transaction) error {
		preference, err := tx.GetOrCreatePreference(ctx, actorPTID, s.clock.Now())
		if err != nil {
			return err
		}
		rejected, err := tx.ListRejectedGroups(ctx, actorPTID)
		if err != nil {
			return err
		}
		response.Preference = preference
		response.RejectedGroups = rejected
		return nil
	})
	return &response, err
}

func (s *Service) UpdatePreference(
	ctx context.Context,
	actorPTID string,
	mode chatmodel.GroupAdmissionMode,
	observedRevision uint64,
) (*chatmodel.GroupAdmissionPreference, error) {
	if err := requireCanonical("actor_ptid", actorPTID); err != nil {
		return nil, err
	}
	if mode != chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_DIRECT_ADD &&
		mode != chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_REQUIRE_CONFIRMATION {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.update_preference",
			"mode",
			"is not supported",
		)
	}
	var updated *chatmodel.GroupAdmissionPreference
	err := s.store.Execute(ctx, func(tx Transaction) error {
		current, err := tx.GetOrCreatePreference(ctx, actorPTID, s.clock.Now())
		if err != nil {
			return err
		}
		if observedRevision != current.GetRevision() {
			return revisionConflict("group_admission.update_preference")
		}
		updated = proto.Clone(current).(*chatmodel.GroupAdmissionPreference)
		updated.Mode = mode
		updated.Revision++
		updated.UpdatedAt = timestamppb.New(s.clock.Now())
		return tx.SavePreference(ctx, updated)
	})
	return updated, err
}

func (s *Service) RemoveRejectedGroup(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	observedRevision uint64,
) (*chatmodel.GroupAdmissionPreference, error) {
	if err := requireCanonical("actor_ptid", actorPTID); err != nil {
		return nil, err
	}
	if err := requireCanonical("conversation_id", conversationID); err != nil {
		return nil, err
	}
	var updated *chatmodel.GroupAdmissionPreference
	err := s.store.Execute(ctx, func(tx Transaction) error {
		current, err := tx.GetOrCreatePreference(ctx, actorPTID, s.clock.Now())
		if err != nil {
			return err
		}
		if observedRevision != current.GetRevision() {
			return revisionConflict("group_admission.remove_rejected_group")
		}
		removed, err := tx.DeleteRejectedGroup(ctx, actorPTID, conversationID)
		if err != nil {
			return err
		}
		if !removed {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.remove_rejected_group",
				"conversation_id",
				"rejected group was not found",
			)
		}
		updated = proto.Clone(current).(*chatmodel.GroupAdmissionPreference)
		updated.Revision++
		updated.UpdatedAt = timestamppb.New(s.clock.Now())
		return tx.SavePreference(ctx, updated)
	})
	return updated, err
}

func (s *Service) Evaluate(
	ctx context.Context,
	request *chatmodel.GroupAdmissionEvaluationRequest,
) (*chatmodel.GroupAdmissionEvaluationResponse, *NotificationWake, error) {
	if err := s.validateEvaluation(request); err != nil {
		return nil, nil, err
	}
	requestBytes, requestHash, err := deterministicHash(request)
	if err != nil {
		return nil, nil, err
	}
	_ = requestBytes
	inviterPTID := request.GetInviter().GetActor().GetPtid()
	inviteePTID := request.GetInvitee().GetPtid()
	proofID, friends, err := s.relationships.FriendshipProofID(
		ctx,
		inviteePTID,
		inviterPTID,
	)
	if err != nil {
		return nil, nil, fmt.Errorf("group admission: resolve friendship proof: %w", err)
	}

	var result *chatmodel.GroupAdmissionEvaluationResponse
	var wake *NotificationWake
	err = s.store.Execute(ctx, func(tx Transaction) error {
		replay, err := tx.GetEvaluation(ctx, request.GetRequestId())
		if err != nil {
			return err
		}
		if replay != nil {
			if !bytes.Equal(replay.RequestSHA256, requestHash) {
				return commandConflict("group_admission.evaluate", "request_id")
			}
			result = replay.Response
			return nil
		}

		now := s.clock.Now()
		preference, err := tx.GetOrCreatePreference(ctx, inviteePTID, now)
		if err != nil {
			return err
		}
		response := &chatmodel.GroupAdmissionEvaluationResponse{
			PolicyRevision: preference.GetRevision(),
		}
		if !friends {
			response.Outcome = chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DENIED
			response.DenialCode = "FRIENDSHIP_REQUIRED"
		} else {
			rejected, rejectedErr := tx.GetRejectedGroup(
				ctx,
				inviteePTID,
				request.GetConversationId(),
			)
			if rejectedErr != nil {
				return rejectedErr
			}
			if rejected != nil {
				response.Outcome = chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DENIED
				response.DenialCode = "GROUP_REJECTED"
			} else if preference.GetMode() ==
				chatmodel.GroupAdmissionMode_GROUP_ADMISSION_MODE_FRIENDS_DIRECT_ADD {
				grant, grantErr := s.newGrant(
					ctx,
					request,
					"",
					proofID,
					preference.GetRevision(),
					now,
				)
				if grantErr != nil {
					return grantErr
				}
				if err := tx.SaveGrant(ctx, grant); err != nil {
					return err
				}
				response.Outcome = chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DIRECT_ADD
				response.Grant = grant
			} else {
				invitation, invitationErr := tx.GetActiveInvitation(
					ctx,
					request.GetConversationId(),
					inviteePTID,
				)
				if invitationErr != nil {
					return invitationErr
				}
				if invitation == nil {
					invitation = s.newInvitation(request, now)
					invitation.PolicyRevision = preference.GetRevision()
					if !request.GetDeferInvitationUntilGroupCommit() {
						if err := tx.SaveInvitation(
							ctx,
							invitation,
							request.GetRequestId(),
							preference.GetRevision(),
						); err != nil {
							return err
						}
						wake, err = tx.ProduceInvitationNotification(ctx, invitation)
						if err != nil {
							return err
						}
					}
				}
				if invitation.GetState() ==
					chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS {
					grant, grantErr := tx.GetGrantByInvitation(
						ctx,
						invitation.GetInvitationId(),
					)
					if grantErr != nil {
						return grantErr
					}
					if !reusableAcceptedInvitationGrant(
						grant,
						request,
						preference.GetRevision(),
						now,
					) {
						grant, grantErr = s.newGrant(
							ctx,
							request,
							invitation.GetInvitationId(),
							proofID,
							preference.GetRevision(),
							now,
						)
						if grantErr != nil {
							return grantErr
						}
						if err := tx.SaveGrant(ctx, grant); err != nil {
							return err
						}
					}
					response.Outcome =
						chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_DIRECT_ADD
					response.Grant = grant
				} else {
					response.Outcome =
						chatmodel.GroupAdmissionOutcome_GROUP_ADMISSION_OUTCOME_CONFIRMATION_REQUIRED
					response.Invitation = invitation
				}
			}
		}
		if err := tx.SaveEvaluation(ctx, request, requestHash, response); err != nil {
			return err
		}
		result = response
		return nil
	})
	return result, wake, err
}

func (s *Service) ListInvitations(
	ctx context.Context,
	actorPTID string,
	states []chatmodel.GroupInvitationState,
) ([]*chatmodel.GroupInvitation, error) {
	if err := requireCanonical("actor_ptid", actorPTID); err != nil {
		return nil, err
	}
	var invitations []*chatmodel.GroupInvitation
	err := s.store.Read(ctx, func(tx Transaction) error {
		var err error
		invitations, err = tx.ListInvitations(ctx, actorPTID, states)
		return err
	})
	return invitations, err
}

func (s *Service) ActivateDeferredInvitations(
	ctx context.Context,
	authorityPlanID string,
	conversationID string,
) ([]NotificationWake, uint32, error) {
	if err := requireCanonical("authority_plan_id", authorityPlanID); err != nil {
		return nil, 0, err
	}
	if err := requireCanonical("conversation_id", conversationID); err != nil {
		return nil, 0, err
	}

	var candidates []*EvaluationRecord
	if err := s.store.Read(ctx, func(tx Transaction) error {
		var err error
		candidates, err = tx.ListDeferredInvitationEvaluations(
			ctx,
			authorityPlanID,
			conversationID,
		)
		return err
	}); err != nil {
		return nil, 0, err
	}
	friendship := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		invitation := candidate.Response.GetInvitation()
		if invitation == nil || candidate.Request == nil {
			continue
		}
		_, friends, err := s.relationships.FriendshipProofID(
			ctx,
			invitation.GetInviteePtid(),
			invitation.GetInviterPtid(),
		)
		if err != nil {
			return nil, 0, err
		}
		friendship[candidate.Request.GetRequestId()] = friends
	}

	var wakes []NotificationWake
	var activated uint32
	err := s.store.Execute(ctx, func(tx Transaction) error {
		pending, err := tx.ListDeferredInvitationEvaluations(
			ctx,
			authorityPlanID,
			conversationID,
		)
		if err != nil {
			return err
		}
		now := s.clock.Now()
		for _, record := range pending {
			if record.Request == nil {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"group_admission.activate_deferred",
					"evaluation",
					"deferred evaluation omitted its request",
				)
			}
			requestID := record.Request.GetRequestId()
			invitation := record.Response.GetInvitation()
			if invitation == nil {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"group_admission.activate_deferred",
					"invitation",
					"deferred evaluation omitted its invitation",
				)
			}
			activationState := "suppressed"
			rejected, err := tx.GetRejectedGroup(
				ctx,
				invitation.GetInviteePtid(),
				conversationID,
			)
			if err != nil {
				return err
			}
			if friendship[requestID] && rejected == nil {
				existing, err := tx.GetInvitation(
					ctx,
					invitation.GetInvitationId(),
				)
				if err != nil {
					return err
				}
				if existing == nil {
					if err := tx.SaveInvitation(
						ctx,
						invitation,
						requestID,
						invitation.GetPolicyRevision(),
					); err != nil {
						return err
					}
					wake, err := tx.ProduceInvitationNotification(ctx, invitation)
					if err != nil {
						return err
					}
					if wake != nil {
						wakes = append(wakes, *wake)
					}
				} else if !proto.Equal(existing, invitation) {
					return commandConflict(
						"group_admission.activate_deferred",
						"invitation_id",
					)
				}
				activationState = "activated"
				activated++
			}
			if err := tx.MarkInvitationEvaluationActivated(
				ctx,
				requestID,
				activationState,
				now,
			); err != nil {
				return err
			}
		}
		return nil
	})
	return wakes, activated, err
}

func (s *Service) Decide(
	ctx context.Context,
	actorPTID string,
	command *chatmodel.GroupInvitationDecisionCommand,
) (*chatmodel.DecideGroupInvitationResponse, error) {
	if err := s.validateDecision(actorPTID, command); err != nil {
		return nil, err
	}
	signingInput := decisionSigningInput(command)
	signingBytes, err := deterministicBytes(signingInput)
	if err != nil {
		return nil, err
	}
	if err := s.verifier.VerifyDecision(ctx, command, signingBytes); err != nil {
		return nil, conversationdomain.WrapError(
			conversationdomain.ErrorCodeProposalSignature,
			"group_admission.decide",
			err,
		)
	}
	commandBytes, commandHash, err := deterministicHash(command)
	if err != nil {
		return nil, err
	}
	_ = commandBytes

	var response *chatmodel.DecideGroupInvitationResponse
	err = s.store.Execute(ctx, func(tx Transaction) error {
		replay, err := tx.GetDecision(ctx, command.GetCommandId())
		if err != nil {
			return err
		}
		if replay != nil {
			if !bytes.Equal(replay.CommandSHA256, commandHash) {
				return commandConflict("group_admission.decide", "command_id")
			}
			response = &chatmodel.DecideGroupInvitationResponse{
				Invitation: replay.Invitation,
				Grant:      replay.Grant,
			}
			return nil
		}

		invitation, err := tx.GetInvitation(ctx, command.GetInvitationId())
		if err != nil {
			return err
		}
		if invitation == nil || invitation.GetInviteePtid() != actorPTID {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.decide",
				"invitation_id",
				"invitation was not found",
			)
		}
		now := s.clock.Now()
		if invitation.GetState() != chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_PENDING ||
			command.GetObservedState() != invitation.GetState() {
			return commandConflict("group_admission.decide", "observed_state")
		}
		if !now.Before(invitation.GetExpiresAt().AsTime()) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandExpired,
				"group_admission.decide",
				"invitation_id",
				"invitation has expired",
			)
		}
		preference, err := tx.GetOrCreatePreference(ctx, actorPTID, now)
		if err != nil {
			return err
		}
		if command.GetObservedPolicyRevision() != preference.GetRevision() {
			return revisionConflict("group_admission.decide")
		}

		updated := proto.Clone(invitation).(*chatmodel.GroupInvitation)
		updated.DecidedAt = timestamppb.New(now)
		updated.DecisionCommandId = command.GetCommandId()
		var grant *chatmodel.GroupAdmissionGrant
		switch command.GetAction() {
		case chatmodel.GroupInvitationDecisionAction_GROUP_INVITATION_DECISION_ACTION_ACCEPT:
			updated.State = chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS
			proofID, friends, proofErr := s.relationships.FriendshipProofID(
				ctx,
				actorPTID,
				invitation.GetInviterPtid(),
			)
			if proofErr != nil {
				return proofErr
			}
			if !friends {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeUnauthorized,
					"group_admission.decide",
					"friendship",
					"inviter is no longer an accepted friend",
				)
			}
			grant, err = s.newGrantFromInvitation(
				ctx,
				invitation,
				proofID,
				preference.GetRevision(),
				now,
			)
			if err != nil {
				return err
			}
			if err := tx.SaveGrant(ctx, grant); err != nil {
				return err
			}
		case chatmodel.GroupInvitationDecisionAction_GROUP_INVITATION_DECISION_ACTION_DECLINE:
			updated.State = chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_DECLINED
		default:
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeInvalidArgument,
				"group_admission.decide",
				"action",
				"is not supported",
			)
		}
		if err := tx.SaveDecision(ctx, command, commandHash, updated, grant); err != nil {
			return err
		}
		response = &chatmodel.DecideGroupInvitationResponse{
			Invitation: updated,
			Grant:      grant,
		}
		return nil
	})
	return response, err
}

func (s *Service) BindFulfillment(
	ctx context.Context,
	request *chatmodel.GroupAdmissionFulfillmentRequest,
) (*chatmodel.GroupAdmissionGrant, error) {
	if request == nil || request.GetFulfillment() == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.bind_fulfillment",
			"request",
			"fulfillment is required",
		)
	}
	if err := requireCanonical("request_id", request.GetRequestId()); err != nil {
		return nil, err
	}
	if err := requireCanonical("authority_plan_id", request.GetAuthorityPlanId()); err != nil {
		return nil, err
	}
	var bound *chatmodel.GroupAdmissionGrant
	err := s.store.Execute(ctx, func(tx Transaction) error {
		grant, err := tx.GetGrant(ctx, request.GetFulfillment().GetGrantId())
		if err != nil {
			return err
		}
		if grant == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.bind_fulfillment",
				"grant_id",
				"grant was not found",
			)
		}
		digest, err := grantFulfillmentDigest(grant)
		if err != nil {
			return err
		}
		fulfillment := request.GetFulfillment()
		if fulfillment.GetInvitationId() != grant.GetInvitationId() ||
			fulfillment.GetInviteePtid() != grant.GetInviteePtid() ||
			fulfillment.GetInviteeHomeStationPeerId() != grant.GetInviteeHomeStationPeerId() ||
			!bytes.Equal(fulfillment.GetGrantSha256(), digest) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.bind_fulfillment",
				"fulfillment",
				"does not match the canonical grant",
			)
		}
		now := s.clock.Now()
		if !now.Before(grant.GetExpiresAt().AsTime()) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandExpired,
				"group_admission.bind_fulfillment",
				"grant_id",
				"grant has expired",
			)
		}
		if grant.GetState() == chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_BOUND_TO_PLAN {
			if grant.GetBoundAuthorityPlanId() != request.GetAuthorityPlanId() {
				return commandConflict("group_admission.bind_fulfillment", "authority_plan_id")
			}
			bound = grant
			return nil
		}
		if grant.GetState() != chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED {
			return commandConflict("group_admission.bind_fulfillment", "grant_state")
		}
		preference, err := tx.GetOrCreatePreference(
			ctx,
			grant.GetInviteePtid(),
			now,
		)
		if err != nil {
			return err
		}
		rejected, err := tx.GetRejectedGroup(
			ctx,
			grant.GetInviteePtid(),
			grant.GetConversationId(),
		)
		if err != nil {
			return err
		}
		if preference.GetRevision() != grant.GetAdmissionPolicyRevision() ||
			rejected != nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeUnauthorized,
				"group_admission.bind_fulfillment",
				"admission_policy",
				"changed after grant issuance",
			)
		}
		updated := proto.Clone(grant).(*chatmodel.GroupAdmissionGrant)
		updated.State = chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_BOUND_TO_PLAN
		updated.BoundAuthorityPlanId = request.GetAuthorityPlanId()
		if err := s.signer.SignGrant(ctx, updated); err != nil {
			return err
		}
		if err := tx.SaveGrant(ctx, updated); err != nil {
			return err
		}
		bound = updated
		return nil
	})
	return bound, err
}

func (s *Service) CompleteFulfillment(
	ctx context.Context,
	fulfillment *chatmodel.GroupAdmissionFulfillment,
	actorPTID string,
	conversationID string,
	federationID string,
	authorityStationID string,
	authorityEpoch int64,
	authorityPlanID string,
	transitionID string,
) (
	*chatmodel.GroupAdmissionGrant,
	*chatmodel.GroupInvitation,
	error,
) {
	if fulfillment == nil {
		return nil, nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.complete_fulfillment",
			"fulfillment",
			"is required",
		)
	}
	for field, value := range map[string]string{
		"grant_id":          fulfillment.GetGrantId(),
		"actor_ptid":        actorPTID,
		"conversation_id":   conversationID,
		"federation_id":     federationID,
		"authority_station": authorityStationID,
		"authority_plan_id": authorityPlanID,
		"transition_id":     transitionID,
	} {
		if err := requireCanonical(field, value); err != nil {
			return nil, nil, err
		}
	}

	var completedGrant *chatmodel.GroupAdmissionGrant
	var completedInvitation *chatmodel.GroupInvitation
	err := s.store.Execute(ctx, func(tx Transaction) error {
		grant, err := tx.GetGrant(ctx, fulfillment.GetGrantId())
		if err != nil {
			return err
		}
		if grant == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.complete_fulfillment",
				"grant_id",
				"grant was not found",
			)
		}
		digest, err := grantFulfillmentDigest(grant)
		if err != nil {
			return err
		}
		if grant.GetInviteePtid() != actorPTID ||
			grant.GetConversationId() != conversationID ||
			grant.GetFederationId() != federationID ||
			grant.GetAuthorityStationPeerId() != authorityStationID ||
			grant.GetAuthorityEpoch() != authorityEpoch ||
			grant.GetInviteePtid() != fulfillment.GetInviteePtid() ||
			grant.GetInviteeHomeStationPeerId() !=
				fulfillment.GetInviteeHomeStationPeerId() ||
			grant.GetInvitationId() != fulfillment.GetInvitationId() ||
			!bytes.Equal(fulfillment.GetGrantSha256(), digest) {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.complete_fulfillment",
				"fulfillment",
				"does not match the committed member",
			)
		}

		var invitation *chatmodel.GroupInvitation
		if grant.GetInvitationId() != "" {
			invitation, err = tx.GetInvitation(ctx, grant.GetInvitationId())
			if err != nil {
				return err
			}
			if invitation == nil ||
				invitation.GetInviteePtid() != actorPTID ||
				invitation.GetConversationId() != conversationID {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeProposalBinding,
					"group_admission.complete_fulfillment",
					"invitation",
					"does not match the committed member",
				)
			}
		}

		if grant.GetState() ==
			chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_JOINED {
			if grant.GetFulfillmentTransitionId() != transitionID ||
				(invitation != nil &&
					(invitation.GetState() !=
						chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_JOINED ||
						invitation.GetFulfillmentTransitionId() != transitionID)) {
				return commandConflict(
					"group_admission.complete_fulfillment",
					"transition_id",
				)
			}
			completedGrant = grant
			completedInvitation = invitation
			return nil
		}
		if grant.GetState() !=
			chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_BOUND_TO_PLAN ||
			grant.GetBoundAuthorityPlanId() != authorityPlanID {
			return commandConflict(
				"group_admission.complete_fulfillment",
				"authority_plan_id",
			)
		}
		if invitation != nil &&
			invitation.GetState() !=
				chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_ACCEPTED_WAITING_FOR_MLS {
			return commandConflict(
				"group_admission.complete_fulfillment",
				"invitation_state",
			)
		}

		updatedGrant := proto.Clone(grant).(*chatmodel.GroupAdmissionGrant)
		updatedGrant.State =
			chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_JOINED
		updatedGrant.FulfillmentTransitionId = transitionID
		if err := s.signer.SignGrant(ctx, updatedGrant); err != nil {
			return err
		}
		if err := tx.SaveGrant(ctx, updatedGrant); err != nil {
			return err
		}
		if invitation != nil {
			updatedInvitation :=
				proto.Clone(invitation).(*chatmodel.GroupInvitation)
			updatedInvitation.State =
				chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_JOINED
			updatedInvitation.FulfillmentTransitionId = transitionID
			if err := tx.CompleteInvitation(ctx, updatedInvitation); err != nil {
				return err
			}
			completedInvitation = updatedInvitation
		}
		completedGrant = updatedGrant
		return nil
	})
	return completedGrant, completedInvitation, err
}

func (s *Service) CompleteLeaveReject(
	ctx context.Context,
	actorPTID string,
	conversationID string,
	federationID string,
	authorityStationID string,
	leaveIntentID string,
	transitionID string,
) (*chatmodel.GroupLeaveRejectOperation, error) {
	for field, value := range map[string]string{
		"actor_ptid":        actorPTID,
		"conversation_id":   conversationID,
		"federation_id":     federationID,
		"authority_station": authorityStationID,
		"leave_intent_id":   leaveIntentID,
		"transition_id":     transitionID,
	} {
		if err := requireCanonical(field, value); err != nil {
			return nil, err
		}
	}

	var completed *chatmodel.GroupLeaveRejectOperation
	err := s.store.Execute(ctx, func(tx Transaction) error {
		operation, err := tx.GetLeaveRejectOperationByIntent(
			ctx,
			leaveIntentID,
		)
		if err != nil {
			return err
		}
		if operation == nil {
			return nil
		}
		if operation.GetActorPtid() != actorPTID ||
			operation.GetConversationId() != conversationID ||
			operation.GetFederationId() != federationID ||
			operation.GetAuthorityStationPeerId() != authorityStationID {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.complete_leave_reject",
				"leave_intent_id",
				"does not match the committed leave",
			)
		}
		if operation.GetState() ==
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_COMPLETED {
			if operation.GetFulfillmentTransitionId() != transitionID {
				return commandConflict(
					"group_admission.complete_leave_reject",
					"transition_id",
				)
			}
			completed = operation
			return nil
		}
		if operation.GetState() !=
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_INTENT_SUBMITTED &&
			operation.GetState() !=
				chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED {
			return commandConflict(
				"group_admission.complete_leave_reject",
				"operation_state",
			)
		}
		updated :=
			proto.Clone(operation).(*chatmodel.GroupLeaveRejectOperation)
		updated.State =
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_COMPLETED
		updated.FulfillmentTransitionId = transitionID
		updated.FailureCode = ""
		updated.UpdatedAt = timestamppb.New(s.clock.Now())
		if err := tx.SaveLeaveRejectOperation(ctx, updated, nil); err != nil {
			return err
		}
		if err := tx.UpdateRejectedGroupLeaveOperation(
			ctx,
			updated.GetActorPtid(),
			updated.GetConversationId(),
			updated.GetOperationId(),
			updated.GetState(),
			"",
		); err != nil {
			return err
		}
		completed = updated
		return nil
	})
	return completed, err
}

func (s *Service) RejectGroup(
	ctx context.Context,
	actorPTID string,
	group *chatmodel.RejectedGroup,
	observedRevision uint64,
) (*chatmodel.GroupAdmissionPreference, error) {
	if group == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.reject_group",
			"group",
			"is required",
		)
	}
	if err := requireCanonical("actor_ptid", actorPTID); err != nil {
		return nil, err
	}
	if err := requireCanonical("conversation_id", group.GetConversationId()); err != nil {
		return nil, err
	}
	var updated *chatmodel.GroupAdmissionPreference
	err := s.store.Execute(ctx, func(tx Transaction) error {
		current, err := tx.GetOrCreatePreference(ctx, actorPTID, s.clock.Now())
		if err != nil {
			return err
		}
		if observedRevision != current.GetRevision() {
			return revisionConflict("group_admission.reject_group")
		}
		updated = proto.Clone(current).(*chatmodel.GroupAdmissionPreference)
		updated.Revision++
		updated.UpdatedAt = timestamppb.New(s.clock.Now())
		rejected := proto.Clone(group).(*chatmodel.RejectedGroup)
		rejected.PolicyRevision = updated.Revision
		rejected.RejectedAt = timestamppb.New(s.clock.Now())
		if err := tx.SaveRejectedGroup(ctx, actorPTID, rejected); err != nil {
			return err
		}
		if err := tx.RevokePendingInvitations(
			ctx,
			actorPTID,
			group.GetConversationId(),
			s.clock.Now(),
		); err != nil {
			return err
		}
		return tx.SavePreference(ctx, updated)
	})
	return updated, err
}

func (s *Service) StartLeaveReject(
	ctx context.Context,
	actorPTID string,
	request *chatmodel.StartGroupLeaveRejectRequest,
) (*chatmodel.GroupLeaveRejectOperation, *chatmodel.GroupAdmissionPreference, error) {
	if request == nil || request.GetActor() == nil ||
		request.GetActor().GetActor() == nil {
		return nil, nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.start_leave_reject",
			"request",
			"operation and actor endpoint are required",
		)
	}
	for field, value := range map[string]string{
		"actor_ptid":                actorPTID,
		"operation_id":              request.GetOperationId(),
		"conversation_id":           request.GetConversationId(),
		"federation_id":             request.GetFederationId(),
		"authority_station_peer_id": request.GetAuthorityStationPeerId(),
	} {
		if err := requireCanonical(field, value); err != nil {
			return nil, nil, err
		}
	}
	if request.GetActor().GetActor().GetPtid() != actorPTID {
		return nil, nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"group_admission.start_leave_reject",
			"actor",
			"does not match the authenticated actor",
		)
	}

	var operation *chatmodel.GroupLeaveRejectOperation
	var updatedPreference *chatmodel.GroupAdmissionPreference
	err := s.store.Execute(ctx, func(tx Transaction) error {
		existing, err := tx.GetLeaveRejectOperation(ctx, request.GetOperationId())
		if err != nil {
			return err
		}
		if existing != nil {
			if existing.GetActorPtid() != actorPTID ||
				existing.GetConversationId() != request.GetConversationId() ||
				existing.GetFederationId() != request.GetFederationId() ||
				existing.GetAuthorityStationPeerId() !=
					request.GetAuthorityStationPeerId() {
				return commandConflict(
					"group_admission.start_leave_reject",
					"operation_id",
				)
			}
			operation = existing
			updatedPreference, err = tx.GetOrCreatePreference(
				ctx,
				actorPTID,
				s.clock.Now(),
			)
			return nil
		}
		now := s.clock.Now()
		preference, err := tx.GetOrCreatePreference(ctx, actorPTID, now)
		if err != nil {
			return err
		}
		if request.GetObservedPolicyRevision() != preference.GetRevision() {
			return revisionConflict("group_admission.start_leave_reject")
		}
		updatedPreference = proto.Clone(preference).(*chatmodel.GroupAdmissionPreference)
		updatedPreference.Revision++
		updatedPreference.UpdatedAt = timestamppb.New(now)
		rejected := &chatmodel.RejectedGroup{
			ConversationId:         request.GetConversationId(),
			FederationId:           request.GetFederationId(),
			AuthorityStationPeerId: request.GetAuthorityStationPeerId(),
			GroupNameSnapshot:      request.GetGroupNameSnapshot(),
			PolicyRevision:         updatedPreference.GetRevision(),
			RejectedAt:             timestamppb.New(now),
			LeaveRejectOperationId: request.GetOperationId(),
			LeaveRejectState:       chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_REJECTION_COMMITTED,
		}
		if err := tx.SaveRejectedGroup(ctx, actorPTID, rejected); err != nil {
			return err
		}
		if err := tx.RevokePendingInvitations(
			ctx,
			actorPTID,
			request.GetConversationId(),
			now,
		); err != nil {
			return err
		}
		if err := tx.SavePreference(ctx, updatedPreference); err != nil {
			return err
		}
		operation = &chatmodel.GroupLeaveRejectOperation{
			Version:                 currentVersion,
			OperationId:             request.GetOperationId(),
			ActorPtid:               actorPTID,
			ConversationId:          request.GetConversationId(),
			FederationId:            request.GetFederationId(),
			AuthorityStationPeerId:  request.GetAuthorityStationPeerId(),
			GroupNameSnapshot:       request.GetGroupNameSnapshot(),
			State:                   chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_REJECTION_COMMITTED,
			RejectionPolicyRevision: updatedPreference.GetRevision(),
			CreatedAt:               timestamppb.New(now),
			UpdatedAt:               timestamppb.New(now),
		}
		return tx.SaveLeaveRejectOperation(ctx, operation, nil)
	})
	return operation, updatedPreference, err
}

func (s *Service) AttachLeaveRejectIntent(
	ctx context.Context,
	actorPTID string,
	operationID string,
	intent *chatmodel.MlsLeaveIntent,
) (*chatmodel.GroupLeaveRejectOperation, error) {
	if intent == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.attach_leave_reject_intent",
			"leave_intent",
			"is required",
		)
	}
	for field, value := range map[string]string{
		"actor_ptid":           actorPTID,
		"operation_id":         operationID,
		"leave_intent_id":      intent.GetIntentId(),
		"actor_device_id":      intent.GetActorDeviceId(),
		"conversation_id":      intent.GetConversationId(),
		"federation_id":        intent.GetFederationId(),
		"authority_station_id": intent.GetAuthorityStationPeerId(),
		"home_station_id":      intent.GetHomeStationPeerId(),
	} {
		if err := requireCanonical(field, value); err != nil {
			return nil, err
		}
	}
	var operation *chatmodel.GroupLeaveRejectOperation
	err := s.store.Execute(ctx, func(tx Transaction) error {
		current, err := tx.GetLeaveRejectOperation(ctx, operationID)
		if err != nil {
			return err
		}
		if current == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.attach_leave_reject_intent",
				"operation_id",
				"was not found",
			)
		}
		if current.GetActorPtid() != actorPTID ||
			intent.GetActorPtid() != actorPTID ||
			intent.GetConversationId() != current.GetConversationId() ||
			intent.GetFederationId() != current.GetFederationId() ||
			intent.GetAuthorityStationPeerId() != current.GetAuthorityStationPeerId() ||
			intent.GetHomeStationPeerId() != s.localStation {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeProposalBinding,
				"group_admission.attach_leave_reject_intent",
				"leave_intent",
				"does not match the committed rejection",
			)
		}
		if current.GetLeaveIntentId() != "" {
			if current.GetLeaveIntentId() != intent.GetIntentId() {
				return commandConflict(
					"group_admission.attach_leave_reject_intent",
					"leave_intent_id",
				)
			}
			persisted, err := tx.GetLeaveRejectIntent(ctx, operationID)
			if err != nil {
				return err
			}
			if persisted == nil || !proto.Equal(persisted, intent) {
				return commandConflict(
					"group_admission.attach_leave_reject_intent",
					"leave_intent",
				)
			}
			operation = current
			return nil
		}
		updated := proto.Clone(current).(*chatmodel.GroupLeaveRejectOperation)
		updated.LeaveIntentId = intent.GetIntentId()
		updated.UpdatedAt = timestamppb.New(s.clock.Now())
		if err := tx.SaveLeaveRejectOperation(ctx, updated, intent); err != nil {
			return err
		}
		operation = updated
		return nil
	})
	return operation, err
}

func (s *Service) UpdateLeaveReject(
	ctx context.Context,
	operation *chatmodel.GroupLeaveRejectOperation,
	state chatmodel.GroupLeaveRejectState,
	failureCode string,
) (*chatmodel.GroupLeaveRejectOperation, error) {
	if operation == nil {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.update_leave_reject",
			"operation",
			"is required",
		)
	}
	if state !=
		chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_INTENT_SUBMITTED &&
		state !=
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED {
		return nil, conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.update_leave_reject",
			"state",
			"is not a submit/retry state",
		)
	}
	var persisted *chatmodel.GroupLeaveRejectOperation
	err := s.store.Execute(ctx, func(tx Transaction) error {
		current, err := tx.GetLeaveRejectOperation(ctx, operation.GetOperationId())
		if err != nil {
			return err
		}
		if current == nil {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.update_leave_reject",
				"operation_id",
				"was not found",
			)
		}
		if current.GetActorPtid() != operation.GetActorPtid() ||
			current.GetConversationId() != operation.GetConversationId() {
			return commandConflict(
				"group_admission.update_leave_reject",
				"operation_id",
			)
		}
		if current.GetState() ==
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_COMPLETED {
			persisted = current
			return nil
		}
		if current.GetState() !=
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_REJECTION_COMMITTED &&
			current.GetState() !=
				chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_INTENT_SUBMITTED &&
			current.GetState() !=
				chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_RETRY_REQUIRED {
			return commandConflict(
				"group_admission.update_leave_reject",
				"operation_state",
			)
		}
		if state ==
			chatmodel.GroupLeaveRejectState_GROUP_LEAVE_REJECT_STATE_LEAVE_INTENT_SUBMITTED &&
			current.GetLeaveIntentId() == "" {
			return commandConflict(
				"group_admission.update_leave_reject",
				"leave_intent_id",
			)
		}
		updated := proto.Clone(current).(*chatmodel.GroupLeaveRejectOperation)
		updated.State = state
		updated.FailureCode = failureCode
		updated.UpdatedAt = timestamppb.New(s.clock.Now())
		if err := tx.SaveLeaveRejectOperation(ctx, updated, nil); err != nil {
			return err
		}
		if err := tx.UpdateRejectedGroupLeaveOperation(
			ctx,
			updated.GetActorPtid(),
			updated.GetConversationId(),
			updated.GetOperationId(),
			state,
			failureCode,
		); err != nil {
			return err
		}
		persisted = updated
		return nil
	})
	return persisted, err
}

func (s *Service) GetLeaveReject(
	ctx context.Context,
	actorPTID string,
	operationID string,
) (*chatmodel.GroupLeaveRejectOperation, error) {
	if err := requireCanonical("actor_ptid", actorPTID); err != nil {
		return nil, err
	}
	if err := requireCanonical("operation_id", operationID); err != nil {
		return nil, err
	}
	var operation *chatmodel.GroupLeaveRejectOperation
	err := s.store.Read(ctx, func(tx Transaction) error {
		current, err := tx.GetLeaveRejectOperation(ctx, operationID)
		if err != nil {
			return err
		}
		if current == nil || current.GetActorPtid() != actorPTID {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.get_leave_reject",
				"operation_id",
				"was not found",
			)
		}
		operation = current
		return nil
	})
	return operation, err
}

func (s *Service) GetLeaveRejectWithIntent(
	ctx context.Context,
	actorPTID string,
	operationID string,
) (*chatmodel.GroupLeaveRejectOperation, *chatmodel.MlsLeaveIntent, error) {
	var operation *chatmodel.GroupLeaveRejectOperation
	var intent *chatmodel.MlsLeaveIntent
	err := s.store.Read(ctx, func(tx Transaction) error {
		var err error
		operation, err = tx.GetLeaveRejectOperation(ctx, operationID)
		if err != nil {
			return err
		}
		if operation == nil || operation.GetActorPtid() != actorPTID {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeNotFound,
				"group_admission.get_leave_reject_intent",
				"operation_id",
				"was not found",
			)
		}
		intent, err = tx.GetLeaveRejectIntent(ctx, operationID)
		return err
	})
	return operation, intent, err
}

func (s *Service) validateEvaluation(
	request *chatmodel.GroupAdmissionEvaluationRequest,
) error {
	if request == nil || request.GetVersion() != currentVersion ||
		request.GetInviter() == nil || request.GetInviter().GetActor() == nil ||
		request.GetInvitee() == nil || request.GetExpiresAt() == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.evaluate",
			"request",
			"is incomplete",
		)
	}
	values := map[string]string{
		"request_id":                   request.GetRequestId(),
		"conversation_id":              request.GetConversationId(),
		"federation_id":                request.GetFederationId(),
		"authority_station_peer_id":    request.GetAuthorityStationPeerId(),
		"inviter_ptid":                 request.GetInviter().GetActor().GetPtid(),
		"inviter_device_id":            request.GetInviter().GetDeviceId(),
		"invitee_ptid":                 request.GetInvitee().GetPtid(),
		"invitee_home_station_peer_id": request.GetInviteeHomeStationPeerId(),
	}
	for field, value := range values {
		if err := requireCanonical(field, value); err != nil {
			return err
		}
	}
	if request.GetInviteeHomeStationPeerId() != s.localStation {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeProposalBinding,
			"group_admission.evaluate",
			"invitee_home_station_peer_id",
			"does not match this Home Station",
		)
	}
	if request.GetDeferInvitationUntilGroupCommit() {
		if err := requireCanonical(
			"authority_plan_id",
			request.GetAuthorityPlanId(),
		); err != nil {
			return err
		}
	}
	if len(request.GetAuthorityHash()) != sha256.Size {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.evaluate",
			"authority_hash",
			"must be 32 bytes",
		)
	}
	now := s.clock.Now()
	if !now.Before(request.GetExpiresAt().AsTime()) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandExpired,
			"group_admission.evaluate",
			"expires_at",
			"request has expired",
		)
	}
	return nil
}

func (s *Service) validateDecision(
	actorPTID string,
	command *chatmodel.GroupInvitationDecisionCommand,
) error {
	if command == nil || command.GetVersion() != currentVersion ||
		command.GetActor() == nil || command.GetActor().GetActor() == nil ||
		command.GetCreatedAt() == nil || command.GetExpiresAt() == nil {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.decide",
			"command",
			"is incomplete",
		)
	}
	if command.GetActor().GetActor().GetPtid() != actorPTID {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeUnauthorized,
			"group_admission.decide",
			"actor_ptid",
			"does not match the authenticated actor",
		)
	}
	for field, value := range map[string]string{
		"actor_ptid":           actorPTID,
		"command_id":           command.GetCommandId(),
		"invitation_id":        command.GetInvitationId(),
		"device_id":            command.GetActor().GetDeviceId(),
		"actor_signing_key_id": command.GetActorSigningKeyId(),
	} {
		if err := requireCanonical(field, value); err != nil {
			return err
		}
	}
	if !s.clock.Now().Before(command.GetExpiresAt().AsTime()) {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeCommandExpired,
			"group_admission.decide",
			"expires_at",
			"command has expired",
		)
	}
	return nil
}

func (s *Service) newInvitation(
	request *chatmodel.GroupAdmissionEvaluationRequest,
	now time.Time,
) *chatmodel.GroupInvitation {
	expiresAt := now.Add(defaultInvitationTTL)
	return &chatmodel.GroupInvitation{
		Version:                  currentVersion,
		InvitationId:             s.ids.NewID(),
		ConversationId:           request.GetConversationId(),
		FederationId:             request.GetFederationId(),
		AuthorityStationPeerId:   request.GetAuthorityStationPeerId(),
		AuthorityEpoch:           request.GetAuthorityEpoch(),
		InviterPtid:              request.GetInviter().GetActor().GetPtid(),
		InviterDeviceId:          request.GetInviter().GetDeviceId(),
		InviteePtid:              request.GetInvitee().GetPtid(),
		InviteeHomeStationPeerId: request.GetInviteeHomeStationPeerId(),
		State:                    chatmodel.GroupInvitationState_GROUP_INVITATION_STATE_PENDING,
		GroupNameSnapshot:        request.GetGroupNameSnapshot(),
		ObservedMembershipEpoch:  request.GetObservedMembershipEpoch(),
		ObservedMlsEpoch:         request.GetObservedMlsEpoch(),
		AuthoritySequence:        request.GetAuthoritySequence(),
		AuthorityHash:            append([]byte(nil), request.GetAuthorityHash()...),
		CreatedAt:                timestamppb.New(now),
		ExpiresAt:                timestamppb.New(expiresAt),
		SourceRequestId:          request.GetRequestId(),
	}
}

func (s *Service) newGrant(
	ctx context.Context,
	request *chatmodel.GroupAdmissionEvaluationRequest,
	invitationID string,
	proofID string,
	policyRevision uint64,
	now time.Time,
) (*chatmodel.GroupAdmissionGrant, error) {
	expiresAt := request.GetExpiresAt().AsTime()
	if maximum := now.Add(maximumGrantTTL); expiresAt.After(maximum) {
		expiresAt = maximum
	}
	grant := &chatmodel.GroupAdmissionGrant{
		Version:                  currentVersion,
		GrantId:                  s.ids.NewID(),
		ConversationId:           request.GetConversationId(),
		FederationId:             request.GetFederationId(),
		AuthorityStationPeerId:   request.GetAuthorityStationPeerId(),
		AuthorityEpoch:           request.GetAuthorityEpoch(),
		InviterPtid:              request.GetInviter().GetActor().GetPtid(),
		InviterDeviceId:          request.GetInviter().GetDeviceId(),
		InviteePtid:              request.GetInvitee().GetPtid(),
		InviteeHomeStationPeerId: request.GetInviteeHomeStationPeerId(),
		SourceRequestId:          request.GetRequestId(),
		InvitationId:             invitationID,
		FriendshipProofId:        proofID,
		AdmissionPolicyRevision:  policyRevision,
		State:                    chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED,
		AuthoritySequence:        request.GetAuthoritySequence(),
		AuthorityHash:            append([]byte(nil), request.GetAuthorityHash()...),
		IssuedAt:                 timestamppb.New(now),
		ExpiresAt:                timestamppb.New(expiresAt),
	}
	if err := s.signer.SignGrant(ctx, grant); err != nil {
		return nil, err
	}
	return grant, nil
}

func (s *Service) newGrantFromInvitation(
	ctx context.Context,
	invitation *chatmodel.GroupInvitation,
	proofID string,
	policyRevision uint64,
	now time.Time,
) (*chatmodel.GroupAdmissionGrant, error) {
	expiresAt := invitation.GetExpiresAt().AsTime()
	if maximum := now.Add(maximumGrantTTL); expiresAt.After(maximum) {
		expiresAt = maximum
	}
	grant := &chatmodel.GroupAdmissionGrant{
		Version:                  currentVersion,
		GrantId:                  s.ids.NewID(),
		ConversationId:           invitation.GetConversationId(),
		FederationId:             invitation.GetFederationId(),
		AuthorityStationPeerId:   invitation.GetAuthorityStationPeerId(),
		AuthorityEpoch:           invitation.GetAuthorityEpoch(),
		InviterPtid:              invitation.GetInviterPtid(),
		InviterDeviceId:          invitation.GetInviterDeviceId(),
		InviteePtid:              invitation.GetInviteePtid(),
		InviteeHomeStationPeerId: invitation.GetInviteeHomeStationPeerId(),
		SourceRequestId:          "invitation:" + invitation.GetInvitationId(),
		InvitationId:             invitation.GetInvitationId(),
		FriendshipProofId:        proofID,
		AdmissionPolicyRevision:  policyRevision,
		State:                    chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED,
		AuthoritySequence:        invitation.GetAuthoritySequence(),
		AuthorityHash:            append([]byte(nil), invitation.GetAuthorityHash()...),
		IssuedAt:                 timestamppb.New(now),
		ExpiresAt:                timestamppb.New(expiresAt),
	}
	if err := s.signer.SignGrant(ctx, grant); err != nil {
		return nil, err
	}
	return grant, nil
}

func decisionSigningInput(
	command *chatmodel.GroupInvitationDecisionCommand,
) *chatmodel.GroupInvitationDecisionSigningInput {
	return &chatmodel.GroupInvitationDecisionSigningInput{
		Version:                command.GetVersion(),
		CommandId:              command.GetCommandId(),
		InvitationId:           command.GetInvitationId(),
		Actor:                  command.GetActor(),
		ActorSigningKeyId:      command.GetActorSigningKeyId(),
		Action:                 command.GetAction(),
		ObservedState:          command.GetObservedState(),
		ObservedPolicyRevision: command.GetObservedPolicyRevision(),
		CreatedAt:              command.GetCreatedAt(),
		ExpiresAt:              command.GetExpiresAt(),
	}
}

func grantFulfillmentDigest(
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
	encoded, err := deterministicBytes(issued)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(encoded)
	return append([]byte(nil), digest[:]...), nil
}

func reusableAcceptedInvitationGrant(
	grant *chatmodel.GroupAdmissionGrant,
	request *chatmodel.GroupAdmissionEvaluationRequest,
	policyRevision uint64,
	now time.Time,
) bool {
	return grant != nil &&
		grant.GetState() ==
			chatmodel.GroupAdmissionGrantState_GROUP_ADMISSION_GRANT_STATE_ISSUED &&
		grant.GetConversationId() == request.GetConversationId() &&
		grant.GetFederationId() == request.GetFederationId() &&
		grant.GetAuthorityStationPeerId() ==
			request.GetAuthorityStationPeerId() &&
		grant.GetAuthorityEpoch() == request.GetAuthorityEpoch() &&
		grant.GetInviterPtid() == request.GetInviter().GetActor().GetPtid() &&
		grant.GetInviterDeviceId() == request.GetInviter().GetDeviceId() &&
		grant.GetInviteePtid() == request.GetInvitee().GetPtid() &&
		grant.GetInviteeHomeStationPeerId() ==
			request.GetInviteeHomeStationPeerId() &&
		grant.GetAdmissionPolicyRevision() == policyRevision &&
		grant.GetAuthoritySequence() == request.GetAuthoritySequence() &&
		bytes.Equal(grant.GetAuthorityHash(), request.GetAuthorityHash()) &&
		grant.GetExpiresAt() != nil &&
		now.Before(grant.GetExpiresAt().AsTime())
}

func deterministicBytes(message proto.Message) ([]byte, error) {
	encoded, err := (proto.MarshalOptions{Deterministic: true}).Marshal(message)
	if err != nil {
		return nil, fmt.Errorf("group admission: encode canonical protobuf: %w", err)
	}
	return encoded, nil
}

func deterministicHash(message proto.Message) ([]byte, []byte, error) {
	encoded, err := deterministicBytes(message)
	if err != nil {
		return nil, nil, err
	}
	sum := sha256.Sum256(encoded)
	return encoded, append([]byte(nil), sum[:]...), nil
}

func requireCanonical(field string, value string) error {
	if strings.TrimSpace(value) == "" || strings.TrimSpace(value) != value {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeInvalidArgument,
			"group_admission.validate",
			field,
			"is required and must be canonical",
		)
	}
	return nil
}

func revisionConflict(operation string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeCommandConflict,
		operation,
		"observed_revision",
		"does not match the current policy revision",
	)
}

func commandConflict(operation string, field string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeCommandConflict,
		operation,
		field,
		"conflicts with the persisted command",
	)
}
