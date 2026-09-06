package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const friendRequestResultFrameLifetime = 24 * time.Hour

// FederatedFriendRequestService coordinates Social authority through shared Federation.
type FederatedFriendRequestService struct {
	store          infrastructure.FederatedFriendRequestUnitOfWork
	stationSigner  delivery.Signer
	localStationID string
	clock          delivery.Clock
}

// SubmitFriendRequestCommandResult reports local durable acceptance, not remote success.
type SubmitFriendRequestCommandResult struct {
	Projection domain.FriendRequestProjection
	Duplicate  bool
}

// NewFederatedFriendRequestService constructs the test-only CA-W4 Social service.
func NewFederatedFriendRequestService(
	store infrastructure.FederatedFriendRequestUnitOfWork,
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
	); err != nil {
		return deliveryResultForSocialError(err), nil
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
	event := result.GetEvent()
	if event == nil ||
		frame.GetPayloadId() != result.GetCommandId() ||
		frame.GetSourceStationPeerId() != event.GetAuthorityStationPeerId() ||
		frame.GetTargetStationPeerId() != s.localStationID ||
		frame.GetTargetStationPeerId() != event.GetSenderHomeStationPeerId() {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	resultBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(result)
	if err != nil {
		return delivery.Result{}, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.encode_received_friend_request_result",
			err,
		)
	}
	if !bytes.Equal(resultBytes, frame.GetOpaquePayload()) {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
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

	outgoing, err := transaction.LoadCommand(
		ctx,
		domain.FriendRequestCommandRoleOutgoing,
		event.GetAuthorityStationPeerId(),
		result.GetCommandId(),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	if outgoing != nil {
		if !bytes.Equal(
			outgoing.CommandPayloadSHA256,
			result.GetCommandPayloadSha256(),
		) {
			return delivery.PayloadHashConflictResult(), nil
		}
		if err := transaction.ResolveCommand(
			ctx,
			domain.FriendRequestCommandRoleOutgoing,
			event.GetAuthorityStationPeerId(),
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

func verifyCommandSignatureInTransaction(
	ctx context.Context,
	transaction infrastructure.FederatedFriendRequestTransaction,
	command *model.FriendRequestCommand,
) error {
	signingBytes, err := domain.FriendRequestCommandSigningBytes(command)
	if err != nil {
		return err
	}
	return transaction.VerifyFriendRequestCommandSignature(
		ctx,
		command.GetBody().GetAuthorizingDevice(),
		commandSourceStation(command.GetBody()),
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
	case domain.FederationErrorInvalidArgument,
		domain.FederationErrorUnauthorized,
		domain.FederationErrorInvalidSignature,
		domain.FederationErrorStateConflict,
		domain.FederationErrorNotFound:
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected)
	default:
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected)
	}
}

var _ infrastructure.FederatedFriendRequestReceiver = (*FederatedFriendRequestService)(nil)
