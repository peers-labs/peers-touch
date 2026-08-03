package conversation

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/follower"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	httpadapter "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/scope"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"gorm.io/gorm"
)

const (
	proposalClaimFederation     = "federation_id"
	proposalClaimConversation   = "conversation_id"
	proposalClaimCommand        = "command_id"
	proposalClaimCommandKind    = "command_kind"
	proposalClaimDevice         = "actor_device_id"
	proposalClaimSigningKey     = "actor_signing_key_id"
	proposalClaimCommandHash    = "command_sha256"
	proposalClaimAuthorityEpoch = "authority_epoch"
	proposalClaimExpiresAt      = "expires_at_unix_ms"
)

var conversationCommandProposalScopeOnce sync.Once

func registerConversationCommandProposalScope() {
	conversationCommandProposalScopeOnce.Do(func() {
		scope.MustRegister(scope.Scope{
			Name:        conversationCommandProposalScope,
			Description: "inbound actor-device-signed conversation command proposal",
			Policy: scope.Policy{
				TTLMax:           60 * time.Second,
				AudienceRequired: true,
				AllowedClaimKeys: []string{
					proposalClaimFederation,
					proposalClaimConversation,
					proposalClaimCommand,
					proposalClaimCommandKind,
					proposalClaimDevice,
					proposalClaimSigningKey,
					proposalClaimCommandHash,
					proposalClaimAuthorityEpoch,
					proposalClaimExpiresAt,
				},
			},
		})
	})
}

func conversationCommandProposalAudience() httpadapter.AudienceResolver {
	return func(_ *http.Request) (string, error) {
		return conversationLocalAudience(), nil
	}
}

func (s *subServer) handleSubmitConversationCommandProposal(
	ctx context.Context,
	req *chat.SubmitConversationCommandProposalRequest,
) (*chat.SubmitConversationCommandProposalResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.Proposal == nil || req.Proposal.Command == nil {
		return nil, server.BadRequest("proposal is required")
	}
	return s.submitAuthenticatedConversationCommandProposal(
		ctx,
		subject.ID,
		serverwrapper.GetDeviceID(ctx),
		req.Proposal,
	)
}

func (s *subServer) submitAuthenticatedConversationCommandProposal(
	ctx context.Context,
	authenticatedPtid string,
	authenticatedDeviceID string,
	proposal *chat.ConversationCommandProposal,
) (*chat.SubmitConversationCommandProposalResponse, error) {
	if !validCommandProposalShape(proposal) {
		return nil, server.BadRequest("proposal is invalid")
	}
	if authenticatedPtid != proposal.ActorPtid ||
		authenticatedDeviceID == "" ||
		authenticatedDeviceID != proposal.ActorDeviceId ||
		proposal.Command.SenderPtid != proposal.ActorPtid ||
		proposal.Command.SenderDeviceId != proposal.ActorDeviceId {
		return nil, server.Forbidden("proposal actor device does not match authentication")
	}
	if proposal.HomeStationPeerId != s.localStationID {
		return nil, server.Forbidden("proposal Home Station does not match the authenticated Station")
	}
	if err := s.validateLocalProposalHead(ctx, proposal); err != nil {
		return nil, err
	}
	record, created, err := s.proposalStore.accept(ctx, proposal)
	if err != nil {
		var transitionErr *TransitionError
		if errors.As(err, &transitionErr) && transitionErr.Code == "COMMAND_CONFLICT" {
			return nil, server.Conflict(transitionErr.Message)
		}
		var admissionErr *commandProposalAdmissionError
		if errors.As(err, &admissionErr) {
			retryable := admissionErr.code ==
				chat.ConversationCommandRejectCode_CONVERSATION_COMMAND_REJECT_CODE_RATE_LIMITED
			state := chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_UNSPECIFIED
			if !retryable {
				state = chat.ConversationCommandSubmissionState_CONVERSATION_COMMAND_SUBMISSION_STATE_TERMINAL_REJECTED
			}
			return &chat.SubmitConversationCommandProposalResponse{
				ConversationId: proposal.Command.ConversationId,
				CommandId:      proposal.Command.CommandId,
				State:          state,
				Result: &chat.ConversationCommandProposalResult{
					CommandId:  proposal.Command.CommandId,
					RejectCode: admissionErr.code,
					Retryable:  retryable,
				},
			}, nil
		}
		return nil, server.InternalErrorWithCause("persist command proposal", err)
	}
	if !created {
		return commandProposalResponse(record)
	}
	if err := s.dispatchCommandProposal(ctx, proposal); err != nil {
		if markErr := s.proposalStore.markRetry(
			ctx,
			proposal.Command.ConversationId,
			proposal.Command.CommandId,
			time.Now().Add(commandProposalRetryDelay(record.RetryCount)),
			err.Error(),
		); markErr != nil {
			return nil, server.InternalErrorWithCause("schedule command proposal retry", markErr)
		}
		record, err = s.proposalStore.get(
			ctx,
			proposal.Command.ConversationId,
			proposal.Command.CommandId,
		)
		if err != nil {
			return nil, server.InternalErrorWithCause("load command proposal result", err)
		}
		return commandProposalResponse(record)
	}
	record, err = s.proposalStore.get(
		ctx,
		proposal.Command.ConversationId,
		proposal.Command.CommandId,
	)
	if err != nil {
		return nil, server.InternalErrorWithCause("load command proposal result", err)
	}
	return commandProposalResponse(record)
}

func (s *subServer) dispatchCommandProposal(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) error {
	if err := s.proposalStore.markSubmitted(
		ctx,
		proposal.Command.ConversationId,
		proposal.Command.CommandId,
	); err != nil {
		return err
	}
	var (
		result *chat.ConversationCommandProposalResult
		err    error
	)
	if proposal.AuthorityStationPeerId == s.localStationID {
		result, err = s.proposalService.VerifyAndSubmit(
			ctx,
			proposal,
			localProposalClaims(proposal),
		)
	} else {
		if s.proposalForwarder == nil {
			return fmt.Errorf("conversation command proposal forwarder unavailable")
		}
		result, err = s.proposalForwarder.Forward(ctx, proposal)
	}
	if err != nil {
		return err
	}
	if result == nil {
		return fmt.Errorf("conversation command authority returned no result")
	}
	if result.Retryable {
		retryAt := time.Now().Add(commandProposalRetryDelay(0))
		if result.RetryAfterUnixMs > time.Now().UnixMilli() {
			retryAt = time.UnixMilli(result.RetryAfterUnixMs)
		}
		return s.proposalStore.markRetry(
			ctx,
			proposal.Command.ConversationId,
			proposal.Command.CommandId,
			retryAt,
			result.RejectCode.String(),
		)
	}
	item, err := s.proposalStore.complete(ctx, proposal, result)
	if err != nil {
		return err
	}
	if s.envelopeService != nil && item != nil {
		s.envelopeService.NotifyPersisted(ctx, item)
	}
	return nil
}

func (s *subServer) handleGetConversationCommandProposalResult(
	ctx context.Context,
	req *chat.GetConversationCommandProposalResultRequest,
) (*chat.GetConversationCommandProposalResultResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil {
		return nil, server.Unauthorized("authentication required")
	}
	if req.ConversationId == "" || req.CommandId == "" {
		return nil, server.BadRequest("conversation_id and command_id are required")
	}
	record, err := s.proposalStore.get(ctx, req.ConversationId, req.CommandId)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, server.BadRequest("command proposal result is unavailable")
		}
		return nil, server.InternalErrorWithCause("load command proposal result", err)
	}
	if record.ActorPtid != subject.ID ||
		record.ActorDeviceID != serverwrapper.GetDeviceID(ctx) {
		return nil, server.Forbidden("command proposal result belongs to another actor device")
	}
	response, err := commandProposalResponse(record)
	if err != nil {
		return nil, server.InternalErrorWithCause("decode command proposal result", err)
	}
	return &chat.GetConversationCommandProposalResultResponse{
		ConversationId:    response.ConversationId,
		CommandId:         response.CommandId,
		State:             response.State,
		Result:            response.Result,
		NextRetryAtUnixMs: record.NextRetryAt.UnixMilli(),
	}, nil
}

func (s *subServer) validateLocalProposalHead(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) error {
	conversationID := proposal.Command.ConversationId
	if proposal.AuthorityStationPeerId == s.localStationID {
		conversation, err := s.repo.GetConversation(ctx, conversationID)
		if err != nil {
			return server.BadRequest("proposal conversation is unavailable")
		}
		if conversation.Status != chat.ConversationStatus_CONVERSATION_STATUS_ACTIVE ||
			conversation.FederationId != proposal.FederationId ||
			conversation.AuthorityStationPeerId != proposal.AuthorityStationPeerId ||
			conversation.AuthorityEpoch != proposal.AuthorityEpoch {
			return server.Conflict("proposal does not match the local authority head")
		}
		member, err := s.repo.GetMember(ctx, conversationID, proposal.ActorPtid)
		if err != nil || member.MemberStatus != chat.MemberStatus_MEMBER_STATUS_ACTIVE {
			return server.Forbidden("proposal actor is not an active member")
		}
		return s.validateMembershipProposalDevice(ctx, proposal)
	}
	if s.db == nil {
		return server.InternalError("follower projection store unavailable")
	}
	var head follower.Head
	if err := s.db.WithContext(ctx).First(
		&head,
		"conversation_id = ?",
		conversationID,
	).Error; err != nil {
		return server.BadRequest("follower proposal head is unavailable")
	}
	if head.Status != "active" ||
		head.FederationID != proposal.FederationId ||
		head.AuthorityStationPeerID != proposal.AuthorityStationPeerId ||
		head.AuthorityEpoch != proposal.AuthorityEpoch {
		return server.Conflict("proposal does not match the durable follower head")
	}
	var member follower.Member
	if err := s.db.WithContext(ctx).First(
		&member,
		"conversation_id = ? AND ptid = ?",
		conversationID,
		proposal.ActorPtid,
	).Error; err != nil ||
		member.Status != int32(chat.MemberStatus_MEMBER_STATUS_ACTIVE) {
		return server.Forbidden("proposal actor is not an active follower member")
	}
	return s.validateFollowerMembershipProposalDevice(ctx, proposal)
}

func (s *subServer) validateMembershipProposalDevice(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) error {
	if proposal.Command.GetMembershipTransition() == nil {
		return nil
	}
	devices, err := s.repo.ListMemberDevices(ctx, proposal.Command.ConversationId, true)
	if err != nil ||
		!hasActiveMemberDevice(devices, proposal.ActorPtid, proposal.ActorDeviceId) {
		return server.Forbidden("proposal device is not an active MLS leaf")
	}
	return nil
}

func (s *subServer) validateFollowerMembershipProposalDevice(
	ctx context.Context,
	proposal *chat.ConversationCommandProposal,
) error {
	if proposal.Command.GetMembershipTransition() == nil {
		return nil
	}
	var device follower.MemberDevice
	if err := s.db.WithContext(ctx).First(
		&device,
		"conversation_id = ? AND ptid = ? AND device_id = ?",
		proposal.Command.ConversationId,
		proposal.ActorPtid,
		proposal.ActorDeviceId,
	).Error; err != nil || !device.Active {
		return server.Forbidden("proposal device is not an active follower MLS leaf")
	}
	return nil
}

func localProposalClaims(
	proposal *chat.ConversationCommandProposal,
) ConversationCommandStationClaims {
	kind := conversationCommandKind(proposal.Command)
	return ConversationCommandStationClaims{
		Scope:          conversationCommandProposalScope,
		Issuer:         proposal.HomeStationPeerId,
		Audience:       proposal.AuthorityStationPeerId,
		Subject:        proposal.ActorPtid,
		Federation:     proposal.FederationId,
		Conversation:   proposal.Command.ConversationId,
		Command:        proposal.Command.CommandId,
		CommandKind:    strconv.Itoa(int(kind)),
		Device:         proposal.ActorDeviceId,
		SigningKey:     proposal.ActorSigningKeyId,
		CommandHash:    fmt.Sprintf("%x", proposal.CommandSha256),
		AuthorityEpoch: strconv.FormatInt(proposal.AuthorityEpoch, 10),
		ExpiresAt:      strconv.FormatInt(proposal.ExpiresAtUnixMs, 10),
	}
}

func (s *subServer) handleFederatedConversationCommandProposal(
	ctx context.Context,
	req *chat.ForwardConversationCommandProposalRequest,
) (*chat.ForwardConversationCommandProposalResponse, error) {
	if req.Proposal == nil {
		return nil, server.BadRequest("proposal is required")
	}
	verified := httpadapter.GetVerifiedClaims(ctx)
	if verified == nil {
		return nil, server.Unauthorized("federation token required")
	}
	result, err := s.proposalService.VerifyAndSubmit(
		ctx,
		req.Proposal,
		ConversationCommandStationClaims{
			Scope:          verified.Scope,
			Issuer:         verified.Issuer,
			Audience:       verified.Audience,
			Subject:        verified.Subject,
			Federation:     verified.Custom[proposalClaimFederation],
			Conversation:   verified.Custom[proposalClaimConversation],
			Command:        verified.Custom[proposalClaimCommand],
			CommandKind:    verified.Custom[proposalClaimCommandKind],
			Device:         verified.Custom[proposalClaimDevice],
			SigningKey:     verified.Custom[proposalClaimSigningKey],
			CommandHash:    verified.Custom[proposalClaimCommandHash],
			AuthorityEpoch: verified.Custom[proposalClaimAuthorityEpoch],
			ExpiresAt:      verified.Custom[proposalClaimExpiresAt],
		},
	)
	if err != nil {
		return nil, server.InternalErrorWithCause("conversation command proposal failed", err)
	}
	return &chat.ForwardConversationCommandProposalResponse{Result: result}, nil
}

func commandProposalRetryDelay(retryCount int32) time.Duration {
	delay := time.Second << min(retryCount, 6)
	if delay > time.Minute {
		return time.Minute
	}
	return delay
}
