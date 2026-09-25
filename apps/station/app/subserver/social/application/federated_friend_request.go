package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	friendRequestResultFrameLifetime = 24 * time.Hour
	defaultFriendRequestListLimit    = int32(50)
	maxFriendRequestListLimit        = int32(100)
)

// FederatedFriendRequestService coordinates Social authority through shared Federation.
type FederatedFriendRequestService struct {
	store          infrastructure.FederatedFriendRequestStore
	stationSigner  delivery.Signer
	localStationID string
	clock          delivery.Clock
	actorKeys      infrastructure.FriendRequestActorKeyResolver
}

// SubmitFriendRequestCommandResult reports local durable acceptance, not remote success.
type SubmitFriendRequestCommandResult struct {
	Projection domain.FriendRequestProjection
	Duplicate  bool
}

// NewFederatedFriendRequestService constructs the Social Federation authority service.
func NewFederatedFriendRequestService(
	store infrastructure.FederatedFriendRequestStore,
	stationSigner delivery.Signer,
	localStationID string,
	clock delivery.Clock,
) (*FederatedFriendRequestService, error) {
	if store == nil ||
		stationSigner == nil ||
		localStationID == "" ||
		clock == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.new_federated_friend_request_service",
			"dependencies",
			"store, identity, Station signer, local Station, and clock are required",
		)
	}
	return &FederatedFriendRequestService{
		store:          store,
		stationSigner:  stationSigner,
		localStationID: localStationID,
		clock:          clock,
	}, nil
}

// WithActorDeviceKeyResolver installs the Actor Identity-owned key capability.
func (s *FederatedFriendRequestService) WithActorDeviceKeyResolver(
	resolver infrastructure.FriendRequestActorKeyResolver,
) *FederatedFriendRequestService {
	s.actorKeys = resolver
	return s
}

// SubmitFriendRequestCommand atomically persists exact command, projection, and outbox.
func (s *FederatedFriendRequestService) SubmitFriendRequestCommand(
	ctx context.Context,
	command *model.FriendRequestCommand,
) (SubmitFriendRequestCommandResult, error) {
	now := s.clock.Now().UTC()
	if command == nil || command.GetBody() == nil {
		return SubmitFriendRequestCommandResult{}, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.submit_friend_request_command",
			"command.body",
			"is required",
		)
	}
	body := command.GetBody()
	sourceStationID := commandSourceStation(body)
	if sourceStationID != s.localStationID {
		return SubmitFriendRequestCommandResult{}, domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			"social.submit_friend_request_command",
			"source_station_peer_id",
			"must be the local Home Station of the authorizing actor",
		)
	}
	if err := domain.ValidateFriendRequestCommand(
		command,
		body.GetReceiverHomeStationPeerId(),
		sourceStationID,
		body.GetReceiverHomeStationPeerId(),
		now,
	); err != nil {
		return SubmitFriendRequestCommandResult{}, err
	}
	commandBytes, commandHash, err := canonicalCommand(command)
	if err != nil {
		return SubmitFriendRequestCommandResult{}, err
	}
	frame, err := s.newSignedFrame(
		ctx,
		delivery.PayloadKindSocialFriendRequestCommand,
		body.GetCommandId(),
		body.GetRequestId(),
		commandOrderingKey(body.GetRequestId()),
		commandOrderingSequence(body.GetAction()),
		body.GetReceiverHomeStationPeerId(),
		commandBytes,
		now,
		body.GetExpiresAt().AsTime().UTC(),
	)
	if err != nil {
		return SubmitFriendRequestCommandResult{}, err
	}

	candidate := domain.FriendRequestCommandRecord{
		Role:                   domain.FriendRequestCommandRoleOutgoing,
		AuthorityStationPeerID: body.GetReceiverHomeStationPeerId(),
		CommandID:              body.GetCommandId(),
		RequestID:              body.GetRequestId(),
		CommandBytes:           commandBytes,
		CommandPayloadSHA256:   commandHash,
		ResultBytes:            []byte{},
		CreatedAt:              now,
	}
	outcome := SubmitFriendRequestCommandResult{}
	err = s.store.Execute(ctx, func(transaction infrastructure.FederatedFriendRequestTransaction) error {
		existing, loadErr := transaction.LoadCommand(
			ctx,
			candidate.Role,
			candidate.AuthorityStationPeerID,
			candidate.CommandID,
		)
		if loadErr != nil {
			return loadErr
		}
		if existing != nil {
			if !sameCommandRecord(*existing, candidate) {
				return commandIdentityConflict(
					"social.submit_friend_request_command",
					candidate.AuthorityStationPeerID,
					candidate.CommandID,
				)
			}
			projection, loadErr := transaction.LoadProjection(ctx, body.GetRequestId())
			if loadErr != nil {
				return loadErr
			}
			if projection != nil {
				outcome.Projection = *projection
			}
			outcome.Duplicate = true
			return nil
		}
		if verifyErr := verifyCommandSignatureInTransaction(
			ctx,
			transaction,
			command,
			s.localStationID,
			s.actorKeys,
		); verifyErr != nil {
			return verifyErr
		}
		persisted, inserted, putErr := transaction.PutCommand(ctx, candidate)
		if putErr != nil {
			return putErr
		}
		if !inserted {
			if !sameCommandRecord(persisted, candidate) {
				return commandIdentityConflict(
					"social.submit_friend_request_command",
					candidate.AuthorityStationPeerID,
					candidate.CommandID,
				)
			}
			outcome.Duplicate = true
			return nil
		}

		if body.GetAction() ==
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
			projection, projectionErr := domain.NewOutgoingFriendRequestProjection(command)
			if projectionErr != nil {
				return projectionErr
			}
			if saveErr := transaction.SaveProjection(ctx, projection, nil); saveErr != nil {
				return saveErr
			}
			outcome.Projection = projection
		} else {
			projection, loadErr := transaction.LoadProjection(
				ctx,
				body.GetRequestId(),
			)
			if loadErr != nil {
				return loadErr
			}
			if projection != nil {
				outcome.Projection = *projection
			}
		}
		if transaction.Outbox() == nil {
			return domain.NewFederationError(
				domain.FederationErrorPersistence,
				"social.submit_friend_request_command",
				"outbox",
				"is not transaction-bound",
			)
		}
		if _, enqueueErr := transaction.Outbox().Enqueue(ctx, frame, now); enqueueErr != nil {
			return enqueueErr
		}
		return nil
	})
	if err != nil {
		return SubmitFriendRequestCommandResult{}, err
	}
	return outcome, nil
}

// ListFriendRequestProjections reads the canonical actor-local Social projection.
func (s *FederatedFriendRequestService) ListFriendRequestProjections(
	ctx context.Context,
	actorPTID string,
	state model.FriendRequestState,
	limit int32,
	offset int32,
) ([]domain.FriendRequestProjection, int64, error) {
	const operation = "social.list_friend_request_projections"
	if actorPTID == "" || actorPTID != strings.TrimSpace(actorPTID) {
		return nil, 0, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"actor_ptid",
			"is required and must be canonical",
		)
	}
	switch state {
	case model.FriendRequestState_FRIEND_REQUEST_STATE_UNSPECIFIED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING,
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_REJECTED,
		model.FriendRequestState_FRIEND_REQUEST_STATE_EXPIRED:
	default:
		return nil, 0, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"state",
			"is unsupported",
		)
	}
	if offset < 0 {
		return nil, 0, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"offset",
			"must not be negative",
		)
	}
	if limit <= 0 {
		limit = defaultFriendRequestListLimit
	}
	if limit > maxFriendRequestListLimit {
		limit = maxFriendRequestListLimit
	}

	return s.store.ListFriendRequestProjections(
		ctx,
		actorPTID,
		state,
		int(limit),
		int(offset),
	)
}

// LookupFriendRequestCommandResult returns the authoritative sender-side outcome.
func (s *FederatedFriendRequestService) LookupFriendRequestCommandResult(
	ctx context.Context,
	actorPTID string,
	request *model.LookupFriendRequestCommandResultRequest,
) (*model.LookupFriendRequestCommandResultResponse, error) {
	const operation = "social.lookup_friend_request_command_result"
	if actorPTID == "" || actorPTID != strings.TrimSpace(actorPTID) {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"actor_ptid",
			"is required and must be canonical",
		)
	}
	if request == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"request",
			"is required",
		)
	}
	commandID := request.GetCommandId()
	if commandID == "" || commandID != strings.TrimSpace(commandID) {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"command_id",
			"is required and must be canonical",
		)
	}
	if len(request.GetCommandPayloadSha256()) != sha256.Size {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"command_payload_sha256",
			"must contain exactly 32 bytes",
		)
	}

	record, err := s.store.LoadOutgoingFriendRequestCommand(ctx, commandID)
	if err != nil {
		if domain.FederationErrorCodeOf(err) ==
			domain.FederationErrorIdempotencyConflict {
			return &model.LookupFriendRequestCommandResultResponse{
				State:     model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_UNRESOLVED,
				CommandId: commandID,
				CommandPayloadSha256: append(
					[]byte(nil),
					request.GetCommandPayloadSha256()...,
				),
			}, nil
		}
		return nil, err
	}
	if record == nil {
		return &model.LookupFriendRequestCommandResultResponse{
			State:     model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_NOT_FOUND,
			CommandId: commandID,
			CommandPayloadSha256: append(
				[]byte(nil),
				request.GetCommandPayloadSha256()...,
			),
		}, nil
	}

	command := &model.FriendRequestCommand{}
	if err := proto.Unmarshal(record.CommandBytes, command); err != nil {
		return nil, domain.WrapFederationError(
			domain.FederationErrorPersistence,
			operation,
			err,
		)
	}
	authorizingActor := command.GetBody().GetAuthorizingDevice().GetActor().GetPtid()
	if authorizingActor != actorPTID {
		return nil, domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			operation,
			"actor_ptid",
			"does not own the requested command",
		)
	}

	response := &model.LookupFriendRequestCommandResultResponse{
		CommandId:            record.CommandID,
		CommandPayloadSha256: append([]byte(nil), record.CommandPayloadSHA256...),
	}
	persistedHash := sha256.Sum256(record.CommandBytes)
	if record.CommandID != command.GetBody().GetCommandId() ||
		record.RequestID != command.GetBody().GetRequestId() ||
		len(record.CommandPayloadSHA256) != sha256.Size ||
		!bytes.Equal(persistedHash[:], record.CommandPayloadSHA256) ||
		!bytes.Equal(record.CommandPayloadSHA256, request.GetCommandPayloadSha256()) {
		response.State =
			model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_UNRESOLVED
		return response, nil
	}

	if len(record.ResultBytes) == 0 && record.ResolvedAt == nil {
		response.State =
			model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_ACCEPTED_PENDING
		return response, nil
	}
	if len(record.ResultBytes) == 0 || record.ResolvedAt == nil {
		response.State =
			model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_UNRESOLVED
		return response, nil
	}

	result := &model.FriendRequestCommandResult{}
	if err := proto.Unmarshal(record.ResultBytes, result); err != nil ||
		domain.ValidateOutgoingFriendRequestCommandResult(*record, result) != nil {
		response.State =
			model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_UNRESOLVED
		return response, nil
	}
	response.State =
		model.FriendRequestCommandLookupState_FRIEND_REQUEST_COMMAND_LOOKUP_STATE_TERMINAL_RESULT
	response.TerminalResult = result
	return response, nil
}

// ReceiveFriendRequestCommand applies one receiver-authority command transaction.
func (s *FederatedFriendRequestService) ReceiveFriendRequestCommand(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	command *model.FriendRequestCommand,
	frame *delivery.Frame,
) (delivery.Result, error) {
	now := s.clock.Now().UTC()
	if transaction == nil || frame == nil {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	if err := domain.ValidateFriendRequestCommand(
		command,
		s.localStationID,
		frame.GetSourceStationPeerId(),
		frame.GetTargetStationPeerId(),
		now,
	); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	body := command.GetBody()
	commandBytes, commandHash, err := canonicalCommand(command)
	if err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if frame.GetPayloadId() != body.GetCommandId() ||
		!bytes.Equal(frame.GetOpaquePayload(), commandBytes) ||
		!bytes.Equal(frame.GetPayloadSha256(), delivery.PayloadSHA256(commandBytes)) {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}

	existing, err := transaction.LoadCommand(
		ctx,
		domain.FriendRequestCommandRoleAuthority,
		body.GetReceiverHomeStationPeerId(),
		body.GetCommandId(),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	candidate := domain.FriendRequestCommandRecord{
		Role:                   domain.FriendRequestCommandRoleAuthority,
		AuthorityStationPeerID: body.GetReceiverHomeStationPeerId(),
		CommandID:              body.GetCommandId(),
		RequestID:              body.GetRequestId(),
		CommandBytes:           commandBytes,
		CommandPayloadSHA256:   commandHash,
		ResultBytes:            []byte{},
		CreatedAt:              now,
	}
	if existing != nil {
		if sameCommandRecord(*existing, candidate) {
			return delivery.DuplicateResult(), nil
		}
		return delivery.PayloadHashConflictResult(), nil
	}
	if err := verifyCommandSignatureInTransaction(
		ctx,
		transaction,
		command,
		s.localStationID,
		s.actorKeys,
	); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if body.GetAction() ==
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND ||
		body.GetAction() ==
			model.FriendRequestAction_FRIEND_REQUEST_ACTION_ACCEPT {
		policy, policyErr := transaction.LoadReceiverFriendRequestPolicy(
			ctx,
			body.GetReceiver().GetPtid(),
			body.GetSender().GetPtid(),
		)
		if policyErr != nil {
			return delivery.Result{}, policyErr
		}
		if policyErr := domain.ValidateReceiverFriendRequestPolicy(
			body.GetAction(),
			policy,
		); policyErr != nil {
			return s.persistRejectedCommand(
				ctx,
				transaction,
				candidate,
				body,
				commandHash,
				policyErr,
				now,
			)
		}
	}

	current, err := transaction.LoadProjection(ctx, body.GetRequestId())
	if err != nil {
		return delivery.Result{}, err
	}
	next, event, err := domain.ApplyFriendRequestCommand(
		current,
		command,
		s.localStationID,
		now,
	)
	if err != nil {
		if _, _, durable := friendRequestCommandResultForError(err); durable {
			return s.persistRejectedCommand(
				ctx,
				transaction,
				candidate,
				body,
				commandHash,
				err,
				now,
			)
		}
		return deliveryResultForSocialError(err), nil
	}
	resultPayload := &model.FriendRequestCommandResult{
		CommandId:            body.GetCommandId(),
		RequestId:            body.GetRequestId(),
		CommandPayloadSha256: commandHash,
		Kind:                 model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_COMMITTED,
		Event:                event,
	}
	resultBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(resultPayload)
	if err != nil {
		return delivery.Result{}, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.encode_friend_request_result",
			err,
		)
	}
	candidate.ResultBytes = resultBytes
	persisted, inserted, err := transaction.PutCommand(ctx, candidate)
	if err != nil {
		return delivery.Result{}, err
	}
	if !inserted {
		if sameCommandRecord(persisted, candidate) {
			return delivery.DuplicateResult(), nil
		}
		return delivery.PayloadHashConflictResult(), nil
	}

	var expectedSequence *int64
	if current != nil {
		sequence := current.Sequence
		expectedSequence = &sequence
	}
	if err := transaction.SaveProjection(ctx, next, expectedSequence); err != nil {
		return delivery.Result{}, err
	}
	if event.GetState() ==
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED {
		if err := s.persistAcceptedRelationship(
			ctx,
			transaction,
			event.GetReceiver().GetPtid(),
			event.GetSender().GetPtid(),
			event,
		); err != nil {
			return delivery.Result{}, err
		}
		if event.GetSenderHomeStationPeerId() == s.localStationID {
			if err := s.persistAcceptedRelationship(
				ctx,
				transaction,
				event.GetSender().GetPtid(),
				event.GetReceiver().GetPtid(),
				event,
			); err != nil {
				return delivery.Result{}, err
			}
			if err := s.persistDirectConversationEffect(ctx, transaction, event); err != nil {
				return delivery.Result{}, err
			}
		}
	}
	if err := s.resolveAuthorizingOutgoingCommand(
		ctx,
		transaction,
		body,
		resultPayload,
		resultBytes,
		now,
	); err != nil {
		return delivery.Result{}, err
	}

	resultFrame, err := s.newSignedFrame(
		ctx,
		delivery.PayloadKindSocialFriendRequestResult,
		body.GetCommandId(),
		body.GetRequestId(),
		resultOrderingKey(body.GetRequestId()),
		event.GetSequence(),
		body.GetSenderHomeStationPeerId(),
		resultBytes,
		now,
		now.Add(friendRequestResultFrameLifetime),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	if transaction.Outbox() == nil {
		return delivery.Result{}, domain.NewFederationError(
			domain.FederationErrorPersistence,
			"social.receive_friend_request_command",
			"outbox",
			"is not transaction-bound",
		)
	}
	if _, err := transaction.Outbox().Enqueue(ctx, resultFrame, now); err != nil {
		return delivery.Result{}, err
	}
	return delivery.AcceptedResult(), nil
}

// ReceiveFriendRequestEvent applies a canonical event only to an existing local projection.
func (s *FederatedFriendRequestService) ReceiveFriendRequestEvent(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	event *model.FriendRequestEvent,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if transaction == nil || frame == nil {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	if err := validateEventFrame(event, frame, s.localStationID); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	current, err := transaction.LoadProjection(ctx, event.GetRequestId())
	if err != nil {
		return delivery.Result{}, err
	}
	if current == nil {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	next, duplicate, err := domain.ApplyFriendRequestEvent(current, event)
	if err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if duplicate {
		return delivery.DuplicateResult(), nil
	}
	expectedSequence := current.Sequence
	if err := transaction.SaveProjection(ctx, next, &expectedSequence); err != nil {
		return delivery.Result{}, err
	}
	if event.GetState() ==
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED {
		if err := s.persistAcceptedRelationship(
			ctx,
			transaction,
			event.GetSender().GetPtid(),
			event.GetReceiver().GetPtid(),
			event,
		); err != nil {
			return delivery.Result{}, err
		}
		if err := s.persistDirectConversationEffect(ctx, transaction, event); err != nil {
			return delivery.Result{}, err
		}
	}
	return delivery.AcceptedResult(), nil
}

// ReceiveFriendRequestResult converges sender projection and schedules the Direct effect.
func (s *FederatedFriendRequestService) ReceiveFriendRequestResult(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	result *model.FriendRequestCommandResult,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if transaction == nil || frame == nil {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	if err := domain.ValidateFriendRequestCommandResult(result); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	resultBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		return delivery.Result{}, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.encode_received_friend_request_result",
			err,
		)
	}
	if frame.GetPayloadId() != result.GetCommandId() ||
		frame.GetTargetStationPeerId() != s.localStationID ||
		!bytes.Equal(resultBytes, frame.GetOpaquePayload()) ||
		!bytes.Equal(frame.GetPayloadSha256(), delivery.PayloadSHA256(resultBytes)) {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}

	event := result.GetEvent()
	if event != nil &&
		(frame.GetSourceStationPeerId() != event.GetAuthorityStationPeerId() ||
			frame.GetTargetStationPeerId() != event.GetSenderHomeStationPeerId()) {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}

	outgoing, err := transaction.LoadCommand(
		ctx,
		domain.FriendRequestCommandRoleOutgoing,
		frame.GetSourceStationPeerId(),
		result.GetCommandId(),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	if outgoing != nil {
		if err := domain.ValidateOutgoingFriendRequestCommandResult(
			*outgoing,
			result,
		); err != nil {
			return deliveryResultForSocialError(err), nil
		}
	} else if event == nil ||
		event.GetState() == model.FriendRequestState_FRIEND_REQUEST_STATE_PENDING {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}

	if event == nil {
		if err := transaction.ResolveCommand(
			ctx,
			domain.FriendRequestCommandRoleOutgoing,
			frame.GetSourceStationPeerId(),
			result.GetCommandId(),
			resultBytes,
			s.clock.Now().UTC(),
		); err != nil {
			return delivery.Result{}, err
		}
		return delivery.AcceptedResult(), nil
	}

	current, err := transaction.LoadProjection(ctx, result.GetRequestId())
	if err != nil {
		return delivery.Result{}, err
	}
	if current == nil {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	next, duplicate, err := domain.ApplyFriendRequestEvent(current, event)
	if err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if !duplicate {
		expectedSequence := current.Sequence
		if err := transaction.SaveProjection(ctx, next, &expectedSequence); err != nil {
			return delivery.Result{}, err
		}
	}

	if outgoing != nil {
		if err := transaction.ResolveCommand(
			ctx,
			domain.FriendRequestCommandRoleOutgoing,
			frame.GetSourceStationPeerId(),
			result.GetCommandId(),
			resultBytes,
			s.clock.Now().UTC(),
		); err != nil {
			return delivery.Result{}, err
		}
	}
	if event.GetState() ==
		model.FriendRequestState_FRIEND_REQUEST_STATE_ACCEPTED {
		if err := s.persistAcceptedRelationship(
			ctx,
			transaction,
			event.GetSender().GetPtid(),
			event.GetReceiver().GetPtid(),
			event,
		); err != nil {
			return delivery.Result{}, err
		}
		if err := s.persistDirectConversationEffect(ctx, transaction, event); err != nil {
			return delivery.Result{}, err
		}
	}
	if duplicate {
		return delivery.DuplicateResult(), nil
	}
	return delivery.AcceptedResult(), nil
}

func (s *FederatedFriendRequestService) persistRejectedCommand(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	candidate domain.FriendRequestCommandRecord,
	body *model.FriendRequestCommandBody,
	commandHash []byte,
	policyErr error,
	now time.Time,
) (delivery.Result, error) {
	resultKind, errorCode, ok := friendRequestCommandResultForError(policyErr)
	if !ok {
		return deliveryResultForSocialError(policyErr), nil
	}
	resultPayload := &model.FriendRequestCommandResult{
		CommandId:            body.GetCommandId(),
		RequestId:            body.GetRequestId(),
		CommandPayloadSha256: append([]byte(nil), commandHash...),
		Kind:                 resultKind,
		ErrorCode:            errorCode,
		Retryable:            false,
	}
	resultBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(resultPayload)
	if err != nil {
		return delivery.Result{}, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.encode_rejected_friend_request_result",
			err,
		)
	}
	candidate.ResultBytes = resultBytes
	persisted, inserted, err := transaction.PutCommand(ctx, candidate)
	if err != nil {
		return delivery.Result{}, err
	}
	if !inserted {
		if sameCommandRecord(persisted, candidate) &&
			bytes.Equal(persisted.ResultBytes, candidate.ResultBytes) {
			return delivery.DuplicateResult(), nil
		}
		return delivery.PayloadHashConflictResult(), nil
	}
	if err := s.resolveAuthorizingOutgoingCommand(
		ctx,
		transaction,
		body,
		resultPayload,
		resultBytes,
		now,
	); err != nil {
		return delivery.Result{}, err
	}
	if body.GetAction() !=
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		return delivery.AcceptedResult(), nil
	}

	resultFrame, err := s.newSignedFrame(
		ctx,
		delivery.PayloadKindSocialFriendRequestResult,
		body.GetCommandId(),
		body.GetRequestId(),
		resultOrderingKey(body.GetRequestId()),
		commandOrderingSequence(body.GetAction()),
		body.GetSenderHomeStationPeerId(),
		resultBytes,
		now,
		now.Add(friendRequestResultFrameLifetime),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	if transaction.Outbox() == nil {
		return delivery.Result{}, domain.NewFederationError(
			domain.FederationErrorPersistence,
			"social.reject_friend_request_send",
			"outbox",
			"is not transaction-bound",
		)
	}
	if _, err := transaction.Outbox().Enqueue(ctx, resultFrame, now); err != nil {
		return delivery.Result{}, err
	}
	return delivery.AcceptedResult(), nil
}

func (s *FederatedFriendRequestService) resolveAuthorizingOutgoingCommand(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	body *model.FriendRequestCommandBody,
	result *model.FriendRequestCommandResult,
	resultBytes []byte,
	resolvedAt time.Time,
) error {
	if commandSourceStation(body) != s.localStationID {
		return nil
	}
	outgoing, err := transaction.LoadCommand(
		ctx,
		domain.FriendRequestCommandRoleOutgoing,
		body.GetReceiverHomeStationPeerId(),
		body.GetCommandId(),
	)
	if err != nil {
		return err
	}
	if outgoing == nil {
		return domain.NewFederationError(
			domain.FederationErrorStateConflict,
			"social.resolve_authorizing_friend_request_command",
			"outgoing_command",
			"was not durably accepted by the authorizing Home Station",
		)
	}
	if err := domain.ValidateOutgoingFriendRequestCommandResult(
		*outgoing,
		result,
	); err != nil {
		return err
	}
	return transaction.ResolveCommand(
		ctx,
		domain.FriendRequestCommandRoleOutgoing,
		body.GetReceiverHomeStationPeerId(),
		body.GetCommandId(),
		resultBytes,
		resolvedAt,
	)
}

func verifyCommandSignatureInTransaction(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	command *model.FriendRequestCommand,
	localStationID string,
	actorKeys infrastructure.FriendRequestActorKeyResolver,
) error {
	signingBytes, err := domain.FriendRequestCommandSigningBytes(command)
	if err != nil {
		return err
	}
	return transaction.VerifyFriendRequestCommandSignature(
		ctx,
		command.GetBody().GetAuthorizingDevice(),
		commandSourceStation(command.GetBody()),
		localStationID,
		actorKeys,
		command.GetSigningKeyId(),
		signingBytes,
		command.GetActorDeviceSignature(),
	)
}

func (s *FederatedFriendRequestService) newSignedFrame(
	ctx context.Context,
	kind delivery.PayloadKind,
	payloadID string,
	requestID string,
	orderingKey string,
	orderingSequence int64,
	targetStationID string,
	payload []byte,
	issuedAt time.Time,
	expiresAt time.Time,
) (*delivery.Frame, error) {
	identity := stableFrameIdentity(
		kind.String(),
		s.localStationID,
		targetStationID,
		payloadID,
	)
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "social-frame:" + identity,
		SourceStationPeerId: s.localStationID,
		TargetStationPeerId: targetStationID,
		IdempotencyKey:      "social-idempotency:" + identity,
		PayloadKind:         kind,
		PayloadId:           payloadID,
		OrderingKey:         orderingKey,
		OrderingSequence:    orderingSequence,
		OpaquePayload:       append([]byte(nil), payload...),
		IssuedAt:            timestamppb.New(issuedAt.UTC()),
		ExpiresAt:           timestamppb.New(expiresAt.UTC()),
	}
	if err := delivery.SignFrame(
		ctx,
		frame,
		delivery.DefaultFramePolicy(targetStationID),
		s.stationSigner,
	); err != nil {
		return nil, err
	}
	return frame, nil
}

func (s *FederatedFriendRequestService) persistAcceptedRelationship(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	ownerPTID string,
	peerPTID string,
	event *model.FriendRequestEvent,
) error {
	return transaction.PutRelationship(
		ctx,
		domain.FriendRequestRelationshipProjection{
			OwnerPTID:         ownerPTID,
			PeerPTID:          peerPTID,
			RequestID:         event.GetRequestId(),
			AcceptedEventID:   event.GetEventId(),
			AcceptedEventHash: append([]byte(nil), event.GetEventHash()...),
			AcceptedAt:        event.GetCommittedAt().AsTime().UTC(),
		},
	)
}

func (s *FederatedFriendRequestService) persistDirectConversationEffect(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	event *model.FriendRequestEvent,
) error {
	return transaction.PutDirectConversationEffect(
		ctx,
		domain.DirectConversationEffect{
			EffectID:        domain.DirectConversationEffectID(event.GetRequestId()),
			RequestID:       event.GetRequestId(),
			FederationID:    event.GetFederationId(),
			ActorAPTID:      event.GetSender().GetPtid(),
			ActorBPTID:      event.GetReceiver().GetPtid(),
			AcceptedEventID: event.GetEventId(),
			CreatedAt:       event.GetCommittedAt().AsTime().UTC(),
		},
	)
}

func validateEventFrame(
	event *model.FriendRequestEvent,
	frame *delivery.Frame,
	localStationID string,
) error {
	if err := domain.ValidateFriendRequestEvent(event); err != nil {
		return err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.validate_friend_request_event_frame",
			err,
		)
	}
	if frame.GetPayloadId() != event.GetEventId() ||
		frame.GetSourceStationPeerId() != event.GetAuthorityStationPeerId() ||
		frame.GetTargetStationPeerId() != localStationID ||
		(localStationID != event.GetSenderHomeStationPeerId() &&
			localStationID != event.GetReceiverHomeStationPeerId()) ||
		!bytes.Equal(frame.GetOpaquePayload(), eventBytes) {
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			"social.validate_friend_request_event_frame",
			"frame",
			"does not bind the canonical Social event",
		)
	}
	return nil
}

func canonicalCommand(
	command *model.FriendRequestCommand,
) ([]byte, []byte, error) {
	commandBytes, err := domain.CanonicalFriendRequestCommandBytes(command)
	if err != nil {
		return nil, nil, err
	}
	sum := sha256.Sum256(commandBytes)
	return commandBytes, append([]byte(nil), sum[:]...), nil
}

func commandSourceStation(body *model.FriendRequestCommandBody) string {
	if body == nil {
		return ""
	}
	if body.GetAction() ==
		model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		return body.GetSenderHomeStationPeerId()
	}
	return body.GetReceiverHomeStationPeerId()
}

func commandOrderingSequence(action model.FriendRequestAction) int64 {
	if action == model.FriendRequestAction_FRIEND_REQUEST_ACTION_SEND {
		return 1
	}
	return 2
}

func commandOrderingKey(requestID string) string {
	return "social-friend-request-command:" + requestID
}

func resultOrderingKey(requestID string) string {
	return "social-friend-request-result:" + requestID
}

func stableFrameIdentity(parts ...string) string {
	hasher := sha256.New()
	for _, part := range parts {
		_, _ = hasher.Write([]byte{0})
		_, _ = hasher.Write([]byte(part))
	}
	return hex.EncodeToString(hasher.Sum(nil))
}

func sameCommandRecord(
	existing domain.FriendRequestCommandRecord,
	candidate domain.FriendRequestCommandRecord,
) bool {
	return existing.Role == candidate.Role &&
		existing.AuthorityStationPeerID == candidate.AuthorityStationPeerID &&
		existing.CommandID == candidate.CommandID &&
		existing.RequestID == candidate.RequestID &&
		bytes.Equal(existing.CommandBytes, candidate.CommandBytes) &&
		bytes.Equal(existing.CommandPayloadSHA256, candidate.CommandPayloadSHA256)
}

func friendRequestCommandResultForError(
	err error,
) (
	model.FriendRequestCommandResultKind,
	model.FriendRequestCommandErrorCode,
	bool,
) {
	switch domain.FederationErrorCodeOf(err) {
	case domain.FederationErrorBlocked:
		return model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_BLOCKED,
			true
	case domain.FederationErrorAlreadyFriends:
		return model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_ALREADY_FRIENDS,
			true
	case domain.FederationErrorNotFound:
		return model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_REJECTED,
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_NOT_FOUND,
			true
	case domain.FederationErrorStateConflict:
		return model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_CONFLICT,
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_STATE_CONFLICT,
			true
	case domain.FederationErrorIdempotencyConflict:
		return model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_CONFLICT,
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_IDEMPOTENCY_CONFLICT,
			true
	default:
		return model.FriendRequestCommandResultKind_FRIEND_REQUEST_COMMAND_RESULT_KIND_UNSPECIFIED,
			model.FriendRequestCommandErrorCode_FRIEND_REQUEST_COMMAND_ERROR_CODE_UNSPECIFIED,
			false
	}
}

func commandIdentityConflict(
	operation string,
	authorityStationPeerID string,
	commandID string,
) error {
	return domain.NewFederationError(
		domain.FederationErrorIdempotencyConflict,
		operation,
		"command_id",
		fmt.Sprintf(
			"authority %q reused command %q with different exact bytes",
			authorityStationPeerID,
			commandID,
		),
	)
}

func deliveryResultForSocialError(err error) delivery.Result {
	switch domain.FederationErrorCodeOf(err) {
	case domain.FederationErrorIdempotencyConflict:
		return delivery.PayloadHashConflictResult()
	case domain.FederationErrorPersistence:
		return delivery.RetryableResult(delivery.FrameErrorOverloaded)
	case domain.FederationErrorIdentityUnavailable:
		return delivery.RetryableResult(delivery.FrameErrorOverloaded)
	case domain.FederationErrorInvalidArgument,
		domain.FederationErrorUnauthorized,
		domain.FederationErrorInvalidSignature,
		domain.FederationErrorStateConflict,
		domain.FederationErrorNotFound,
		domain.FederationErrorBlocked,
		domain.FederationErrorAlreadyFriends:
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected)
	default:
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected)
	}
}

var _ infrastructure.FederatedFriendRequestReceiver = (*FederatedFriendRequestService)(nil)
