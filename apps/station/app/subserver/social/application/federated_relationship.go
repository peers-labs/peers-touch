package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	privatecontentpb "github.com/peers-labs/peers-touch/station/frame/touch/model/privatecontent"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const socialRelationshipEventFrameLifetime = 24 * time.Hour

type FederatedRelationshipService struct {
	store          infrastructure.FederatedRelationshipStore
	stationSigner  delivery.Signer
	localStationID string
	clock          delivery.Clock
	actorKeys      infrastructure.FriendRequestActorKeyResolver
	events         *SocialGraphEventPublisher
	privateRevoker PrivateRelationshipRevoker
}

func NewFederatedRelationshipService(
	store infrastructure.FederatedRelationshipStore,
	stationSigner delivery.Signer,
	localStationID string,
	clock delivery.Clock,
) (*FederatedRelationshipService, error) {
	if store == nil ||
		stationSigner == nil ||
		localStationID == "" ||
		clock == nil {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.new_federated_relationship_service",
			"dependencies",
			"store, Station signer, local Station, and clock are required",
		)
	}
	return &FederatedRelationshipService{
		store:          store,
		stationSigner:  stationSigner,
		localStationID: localStationID,
		clock:          clock,
		events:         NewSocialGraphEventPublisher(),
	}, nil
}

func (s *FederatedRelationshipService) WithActorDeviceKeyResolver(
	resolver infrastructure.FriendRequestActorKeyResolver,
) *FederatedRelationshipService {
	s.actorKeys = resolver
	return s
}

func (s *FederatedRelationshipService) WithPrivateContentRevoker(
	revoker PrivateRelationshipRevoker,
) *FederatedRelationshipService {
	s.privateRevoker = revoker
	return s
}

func (s *FederatedRelationshipService) SubmitRelationshipCommand(
	ctx context.Context,
	authenticatedActorPTID string,
	command *model.SocialRelationshipCommand,
) (*model.SocialRelationshipCommandResult, error) {
	now := s.clock.Now().UTC()
	if err := domain.ValidateSocialRelationshipCommand(
		command,
		s.localStationID,
		now,
	); err != nil {
		return nil, err
	}
	body := command.GetBody()
	if authenticatedActorPTID == "" ||
		authenticatedActorPTID != body.GetActor().GetPtid() {
		return nil, domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			"social.submit_relationship_command",
			"authenticated_actor_ptid",
			"does not match the signed command actor",
		)
	}
	commandBytes, commandHash, err :=
		infrastructureCanonicalSocialRelationshipCommand(command)
	if err != nil {
		return nil, err
	}

	var result *model.SocialRelationshipCommandResult
	publishChange := false
	err = s.store.ExecuteRelationship(
		ctx,
		func(transaction infrastructure.FederatedRelationshipTransaction) error {
			existing, loadErr := transaction.LoadSocialRelationshipCommand(
				ctx,
				body.GetActor().GetPtid(),
				body.GetCommandId(),
			)
			if loadErr != nil {
				return loadErr
			}
			if existing != nil {
				if !sameSocialRelationshipCommandRecord(
					*existing,
					body.GetActor().GetPtid(),
					body.GetCommandId(),
					commandBytes,
					commandHash,
				) {
					return domain.NewFederationError(
						domain.FederationErrorIdempotencyConflict,
						"social.submit_relationship_command",
						"command_id",
						"was reused with different canonical bytes",
					)
				}
				decoded := &model.SocialRelationshipCommandResult{}
				if proto.Unmarshal(existing.ResultBytes, decoded) != nil ||
					domain.ValidateSocialRelationshipCommandResult(decoded) != nil {
					return domain.NewFederationError(
						domain.FederationErrorPersistence,
						"social.submit_relationship_command",
						"result",
						"persisted result is invalid",
					)
				}
				result = decoded
				return nil
			}

			signingBytes, signingErr :=
				domain.CanonicalSocialRelationshipSigningBytes(command)
			if signingErr != nil {
				return signingErr
			}
			if verifyErr := transaction.VerifySocialRelationshipCommandSignature(
				ctx,
				body.GetAuthorizingDevice(),
				body.GetActorHomeStationPeerId(),
				s.localStationID,
				s.actorKeys,
				command.GetSigningKeyId(),
				signingBytes,
				command.GetActorDeviceSignature(),
			); verifyErr != nil {
				return verifyErr
			}
			if validateErr := transaction.ValidateRelationshipActorHome(
				ctx,
				body.GetTargetActor().GetPtid(),
				body.GetTargetHomeStationPeerId(),
				s.localStationID,
			); validateErr != nil {
				return validateErr
			}

			current, loadErr := transaction.LoadDirectionalRelationship(
				ctx,
				body.GetActor().GetPtid(),
				body.GetTargetActor().GetPtid(),
			)
			if loadErr != nil {
				return loadErr
			}
			event, duplicate, applyErr :=
				domain.NewSocialRelationshipEvent(current, command, now)
			if applyErr != nil {
				result = relationshipCommandFailure(
					body.GetCommandId(),
					commandHash,
					applyErr,
				)
			} else if duplicate {
				projection, projectionErr := transaction.RelationshipProjection(
					ctx,
					body.GetActor().GetPtid(),
					body.GetTargetActor().GetPtid(),
				)
				if projectionErr != nil {
					return projectionErr
				}
				if projection.GetTargetHomeStationPeerId() == "" {
					projection.TargetHomeStationPeerId =
						body.GetTargetHomeStationPeerId()
				}
				result = &model.SocialRelationshipCommandResult{
					CommandId:            body.GetCommandId(),
					CommandPayloadSha256: append([]byte(nil), commandHash...),
					Kind:                 model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_DUPLICATE,
					Projection:           projection,
				}
				publishChange = true
			} else {
				next, _, eventErr :=
					domain.ApplySocialRelationshipEvent(current, event)
				if eventErr != nil {
					return eventErr
				}
				var expectedRevision *int64
				if current != nil {
					revision := current.Revision
					expectedRevision = &revision
				}
				if saveErr := transaction.SaveDirectionalRelationship(
					ctx,
					next,
					expectedRevision,
				); saveErr != nil {
					return saveErr
				}
				if next.Blocked {
					if effectsErr := s.revokeBlockedPrivateContent(
						ctx,
						transaction,
						next.ActorPTID,
						next.ActorHomeStationPeerID,
						next.TargetActorPTID,
						next.TargetHomeStationPeerID,
					); effectsErr != nil {
						return effectsErr
					}
					if effectsErr := transaction.ApplyBlockedRelationshipEffects(
						ctx,
						next.ActorPTID,
						next.TargetActorPTID,
					); effectsErr != nil {
						return effectsErr
					}
				}
				projection, projectionErr := transaction.RelationshipProjection(
					ctx,
					body.GetActor().GetPtid(),
					body.GetTargetActor().GetPtid(),
				)
				if projectionErr != nil {
					return projectionErr
				}
				result = &model.SocialRelationshipCommandResult{
					CommandId:            body.GetCommandId(),
					CommandPayloadSha256: append([]byte(nil), commandHash...),
					Kind:                 model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_COMMITTED,
					Event:                event,
					Projection:           projection,
				}
				eventBytes, encodeErr := proto.MarshalOptions{
					Deterministic: true,
				}.Marshal(event)
				if encodeErr != nil {
					return domain.WrapFederationError(
						domain.FederationErrorInvalidArgument,
						"social.encode_relationship_event",
						encodeErr,
					)
				}
				frame, frameErr := s.newSignedRelationshipFrame(
					ctx,
					event,
					eventBytes,
					now,
				)
				if frameErr != nil {
					return frameErr
				}
				if transaction.Outbox() == nil {
					return domain.NewFederationError(
						domain.FederationErrorPersistence,
						"social.submit_relationship_command",
						"outbox",
						"is not transaction-bound",
					)
				}
				if _, enqueueErr := transaction.Outbox().Enqueue(
					ctx,
					frame,
					now,
				); enqueueErr != nil {
					return enqueueErr
				}
			}

			resultBytes, encodeErr := proto.MarshalOptions{
				Deterministic: true,
			}.Marshal(result)
			if encodeErr != nil {
				return domain.WrapFederationError(
					domain.FederationErrorInvalidArgument,
					"social.encode_relationship_result",
					encodeErr,
				)
			}
			resolvedAt := now
			record := domain.SocialRelationshipCommandRecord{
				ActorPTID:            body.GetActor().GetPtid(),
				CommandID:            body.GetCommandId(),
				CommandBytes:         commandBytes,
				CommandPayloadSHA256: commandHash,
				ResultBytes:          resultBytes,
				CreatedAt:            now,
				ResolvedAt:           &resolvedAt,
			}
			persisted, inserted, putErr :=
				transaction.PutSocialRelationshipCommand(ctx, record)
			if putErr != nil {
				return putErr
			}
			if !inserted && !sameSocialRelationshipCommandRecord(
				persisted,
				record.ActorPTID,
				record.CommandID,
				record.CommandBytes,
				record.CommandPayloadSHA256,
			) {
				return domain.NewFederationError(
					domain.FederationErrorIdempotencyConflict,
					"social.submit_relationship_command",
					"command_id",
					"was reused with different canonical bytes",
				)
			}
			if !inserted {
				persistedResult := &model.SocialRelationshipCommandResult{}
				if proto.Unmarshal(
					persisted.ResultBytes,
					persistedResult,
				) != nil ||
					domain.ValidateSocialRelationshipCommandResult(
						persistedResult,
					) != nil {
					return domain.NewFederationError(
						domain.FederationErrorPersistence,
						"social.submit_relationship_command",
						"result",
						"persisted result is invalid",
					)
				}
				result = persistedResult
			}
			return nil
		},
	)
	if err != nil {
		return nil, err
	}
	if publishChange && result.GetEvent() != nil {
		s.events.PublishRelationshipChanged(
			ctx,
			result.GetEvent().GetActor().GetPtid(),
			result.GetEvent().GetActor().GetPtid(),
			result.GetEvent().GetTargetActor().GetPtid(),
			result.GetEvent().GetBlocked(),
		)
	}
	return proto.Clone(result).(*model.SocialRelationshipCommandResult), nil
}

func (s *FederatedRelationshipService) LookupRelationshipCommandResult(
	ctx context.Context,
	authenticatedActorPTID string,
	request *model.LookupSocialRelationshipCommandResultRequest,
) (*model.LookupSocialRelationshipCommandResultResponse, error) {
	const operation = "social.lookup_relationship_command_result"
	if authenticatedActorPTID == "" ||
		request == nil ||
		request.GetCommandId() == "" ||
		request.GetCommandId() != strings.TrimSpace(request.GetCommandId()) ||
		len(request.GetCommandPayloadSha256()) != sha256.Size ||
		hasProtoUnknownFields(request) {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			operation,
			"request",
			"is invalid",
		)
	}
	response := &model.LookupSocialRelationshipCommandResultResponse{
		State:     model.SocialRelationshipCommandLookupState_SOCIAL_RELATIONSHIP_COMMAND_LOOKUP_STATE_NOT_FOUND,
		CommandId: request.GetCommandId(),
		CommandPayloadSha256: append(
			[]byte(nil),
			request.GetCommandPayloadSha256()...,
		),
	}
	record, err := s.store.LoadSocialRelationshipCommand(
		ctx,
		authenticatedActorPTID,
		request.GetCommandId(),
	)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return response, nil
	}
	if !bytes.Equal(
		record.CommandPayloadSHA256,
		request.GetCommandPayloadSha256(),
	) {
		response.State =
			model.SocialRelationshipCommandLookupState_SOCIAL_RELATIONSHIP_COMMAND_LOOKUP_STATE_UNRESOLVED
		return response, nil
	}
	result := &model.SocialRelationshipCommandResult{}
	if len(record.ResultBytes) == 0 ||
		record.ResolvedAt == nil ||
		proto.Unmarshal(record.ResultBytes, result) != nil ||
		domain.ValidateSocialRelationshipCommandResult(result) != nil ||
		!bytes.Equal(
			result.GetCommandPayloadSha256(),
			request.GetCommandPayloadSha256(),
		) {
		response.State =
			model.SocialRelationshipCommandLookupState_SOCIAL_RELATIONSHIP_COMMAND_LOOKUP_STATE_UNRESOLVED
		return response, nil
	}
	response.State =
		model.SocialRelationshipCommandLookupState_SOCIAL_RELATIONSHIP_COMMAND_LOOKUP_STATE_TERMINAL_RESULT
	response.TerminalResult = result
	return response, nil
}

func (s *FederatedRelationshipService) ListBlockedActors(
	ctx context.Context,
	authenticatedActorPTID string,
	request *model.ListBlockedActorsRequest,
) (*model.ListBlockedActorsResponse, error) {
	if request == nil || hasProtoUnknownFields(request) {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.list_blocked_actors",
			"request",
			"is required and must not contain unknown fields",
		)
	}
	states, nextCursor, revision, err :=
		s.store.ListOutgoingBlockedRelationships(
			ctx,
			authenticatedActorPTID,
			request.GetCursor(),
			request.GetLimit(),
		)
	if err != nil {
		return nil, err
	}
	items := make([]*model.BlockedActorProjection, 0, len(states))
	for _, state := range states {
		item := &model.BlockedActorProjection{
			Actor:             relationshipActorRef(state.TargetActorPTID),
			Revision:          state.Revision,
			HomeStationPeerId: state.TargetHomeStationPeerID,
		}
		if state.BlockedAt != nil {
			item.BlockedAt = timestamppb.New(state.BlockedAt.UTC())
		}
		items = append(items, item)
	}
	return &model.ListBlockedActorsResponse{
		Items:      items,
		NextCursor: nextCursor,
		Revision:   revision,
	}, nil
}

func (s *FederatedRelationshipService) RelationshipStatus(
	ctx context.Context,
	authenticatedActorPTID string,
	request *model.GetSocialRelationshipStatusRequest,
) (*model.GetSocialRelationshipStatusResponse, error) {
	if request == nil ||
		request.GetTargetActorPtid() == "" ||
		hasProtoUnknownFields(request) {
		return nil, domain.NewFederationError(
			domain.FederationErrorInvalidArgument,
			"social.get_relationship_status",
			"request",
			"is invalid",
		)
	}
	projection, err := s.store.RelationshipProjection(
		ctx,
		authenticatedActorPTID,
		request.GetTargetActorPtid(),
	)
	if err != nil {
		return nil, err
	}
	return &model.GetSocialRelationshipStatusResponse{
		Relationship: projection,
	}, nil
}

func (s *FederatedRelationshipService) ReceiveRelationshipEvent(
	ctx context.Context,
	transaction infrastructure.FederatedRelationshipTransaction,
	event *model.SocialRelationshipEvent,
	frame *delivery.Frame,
) (delivery.Result, error) {
	if transaction == nil || frame == nil {
		return delivery.TerminalResult(delivery.FrameErrorDomainRejected), nil
	}
	if err := validateRelationshipEventFrame(
		event,
		frame,
		s.localStationID,
	); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if err := transaction.ValidateRelationshipActorHome(
		ctx,
		event.GetActor().GetPtid(),
		event.GetActorHomeStationPeerId(),
		s.localStationID,
	); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if err := transaction.ValidateRelationshipActorHome(
		ctx,
		event.GetTargetActor().GetPtid(),
		s.localStationID,
		s.localStationID,
	); err != nil {
		return deliveryResultForSocialError(err), nil
	}
	current, err := transaction.LoadDirectionalRelationship(
		ctx,
		event.GetActor().GetPtid(),
		event.GetTargetActor().GetPtid(),
	)
	if err != nil {
		return delivery.Result{}, err
	}
	next, duplicate, err := domain.ApplySocialRelationshipEvent(current, event)
	if err != nil {
		return deliveryResultForSocialError(err), nil
	}
	if duplicate {
		return delivery.DuplicateResult(), nil
	}
	var expectedRevision *int64
	if current != nil {
		revision := current.Revision
		expectedRevision = &revision
	}
	if err := transaction.SaveDirectionalRelationship(
		ctx,
		next,
		expectedRevision,
	); err != nil {
		return delivery.Result{}, err
	}
	if next.Blocked {
		if err := s.revokeBlockedPrivateContent(
			ctx,
			transaction,
			next.ActorPTID,
			next.ActorHomeStationPeerID,
			next.TargetActorPTID,
			next.TargetHomeStationPeerID,
		); err != nil {
			return delivery.Result{}, err
		}
		if err := transaction.ApplyBlockedRelationshipEffects(
			ctx,
			next.ActorPTID,
			next.TargetActorPTID,
		); err != nil {
			return delivery.Result{}, err
		}
	}
	actorPTID := event.GetActor().GetPtid()
	targetPTID := event.GetTargetActor().GetPtid()
	blocked := event.GetBlocked()
	if err := transaction.AfterCommit(func(callbackContext context.Context) error {
		s.events.PublishRelationshipChanged(
			callbackContext,
			targetPTID,
			actorPTID,
			targetPTID,
			blocked,
		)
		return nil
	}); err != nil {
		return delivery.Result{}, err
	}
	return delivery.AcceptedResult(), nil
}

func (s *FederatedRelationshipService) revokeBlockedPrivateContent(
	ctx context.Context,
	transaction infrastructure.FederatedRelationshipTransaction,
	actorPTID string,
	actorHomeStationPeerID string,
	targetActorPTID string,
	targetHomeStationPeerID string,
) error {
	if s.privateRevoker == nil {
		return nil
	}
	deliveryTransaction, ok := transaction.(delivery.Transaction)
	if !ok {
		return domain.NewFederationError(
			domain.FederationErrorPersistence,
			"social.revoke_blocked_private_content",
			"transaction",
			"does not expose the Federation delivery transaction",
		)
	}
	localActorPTID := actorPTID
	peerActorPTID := targetActorPTID
	switch {
	case actorHomeStationPeerID == s.localStationID:
	case targetHomeStationPeerID == s.localStationID:
		localActorPTID = targetActorPTID
		peerActorPTID = actorPTID
	default:
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			"social.revoke_blocked_private_content",
			"home_station_peer_id",
			"does not include the local Station",
		)
	}
	return s.privateRevoker.RevokePrivateRelationship(
		ctx,
		deliveryTransaction,
		localActorPTID,
		peerActorPTID,
		nil,
		nil,
		privatecontentpb.PrivateResourceInvalidationReason_PRIVATE_RESOURCE_INVALIDATION_REASON_RECIPIENT_BLOCKED,
	)
}

func (s *FederatedRelationshipService) newSignedRelationshipFrame(
	ctx context.Context,
	event *model.SocialRelationshipEvent,
	eventBytes []byte,
	now time.Time,
) (*delivery.Frame, error) {
	identity := stableFrameIdentity(
		delivery.PayloadKindSocialRelationshipEvent.String(),
		s.localStationID,
		event.GetTargetHomeStationPeerId(),
		event.GetEventId(),
	)
	frame := &delivery.Frame{
		FormatVersion:       delivery.CurrentFormatVersion,
		FrameId:             "social-frame:" + identity,
		SourceStationPeerId: s.localStationID,
		TargetStationPeerId: event.GetTargetHomeStationPeerId(),
		IdempotencyKey:      "social-idempotency:" + identity,
		PayloadKind:         delivery.PayloadKindSocialRelationshipEvent,
		PayloadId:           event.GetEventId(),
		OrderingKey: fmt.Sprintf(
			"social-relationship:%s:%s",
			event.GetActor().GetPtid(),
			event.GetTargetActor().GetPtid(),
		),
		OrderingSequence: event.GetRevision(),
		OpaquePayload:    append([]byte(nil), eventBytes...),
		IssuedAt:         timestamppb.New(now.UTC()),
		ExpiresAt: timestamppb.New(
			now.Add(socialRelationshipEventFrameLifetime).UTC(),
		),
	}
	if err := delivery.SignFrame(
		ctx,
		frame,
		delivery.DefaultFramePolicy(event.GetTargetHomeStationPeerId()),
		s.stationSigner,
	); err != nil {
		return nil, err
	}
	return frame, nil
}

func validateRelationshipEventFrame(
	event *model.SocialRelationshipEvent,
	frame *delivery.Frame,
	localStationID string,
) error {
	if err := domain.ValidateSocialRelationshipEvent(event); err != nil {
		return err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.validate_relationship_event_frame",
			err,
		)
	}
	if frame.GetPayloadId() != event.GetEventId() ||
		frame.GetSourceStationPeerId() != event.GetActorHomeStationPeerId() ||
		frame.GetTargetStationPeerId() != localStationID ||
		event.GetTargetHomeStationPeerId() != localStationID ||
		frame.GetOrderingSequence() != event.GetRevision() ||
		!bytes.Equal(frame.GetOpaquePayload(), eventBytes) ||
		!bytes.Equal(frame.GetPayloadSha256(), delivery.PayloadSHA256(eventBytes)) {
		return domain.NewFederationError(
			domain.FederationErrorUnauthorized,
			"social.validate_relationship_event_frame",
			"frame",
			"does not bind the canonical Social relationship event",
		)
	}
	return nil
}

func relationshipCommandFailure(
	commandID string,
	commandHash []byte,
	err error,
) *model.SocialRelationshipCommandResult {
	result := &model.SocialRelationshipCommandResult{
		CommandId:            commandID,
		CommandPayloadSha256: append([]byte(nil), commandHash...),
		Kind:                 model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_REJECTED,
		ErrorCode:            model.SocialRelationshipCommandErrorCode_SOCIAL_RELATIONSHIP_COMMAND_ERROR_CODE_INVALID,
	}
	switch domain.FederationErrorCodeOf(err) {
	case domain.FederationErrorStateConflict:
		result.Kind =
			model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_CONFLICT
		result.ErrorCode =
			model.SocialRelationshipCommandErrorCode_SOCIAL_RELATIONSHIP_COMMAND_ERROR_CODE_STALE_REVISION
	case domain.FederationErrorIdempotencyConflict:
		result.Kind =
			model.SocialRelationshipCommandResultKind_SOCIAL_RELATIONSHIP_COMMAND_RESULT_KIND_CONFLICT
		result.ErrorCode =
			model.SocialRelationshipCommandErrorCode_SOCIAL_RELATIONSHIP_COMMAND_ERROR_CODE_IDEMPOTENCY_CONFLICT
	case domain.FederationErrorUnauthorized,
		domain.FederationErrorInvalidSignature:
		result.ErrorCode =
			model.SocialRelationshipCommandErrorCode_SOCIAL_RELATIONSHIP_COMMAND_ERROR_CODE_UNAUTHORIZED
	case domain.FederationErrorPersistence,
		domain.FederationErrorIdentityUnavailable:
		result.ErrorCode =
			model.SocialRelationshipCommandErrorCode_SOCIAL_RELATIONSHIP_COMMAND_ERROR_CODE_RETRY_LATER
		result.Retryable = true
	}
	return result
}

func sameSocialRelationshipCommandRecord(
	record domain.SocialRelationshipCommandRecord,
	actorPTID string,
	commandID string,
	commandBytes []byte,
	commandHash []byte,
) bool {
	return record.ActorPTID == actorPTID &&
		record.CommandID == commandID &&
		bytes.Equal(record.CommandBytes, commandBytes) &&
		bytes.Equal(record.CommandPayloadSHA256, commandHash)
}

func infrastructureCanonicalSocialRelationshipCommand(
	command *model.SocialRelationshipCommand,
) ([]byte, []byte, error) {
	commandBytes, err := proto.MarshalOptions{
		Deterministic: true,
	}.Marshal(command)
	if err != nil {
		return nil, nil, domain.WrapFederationError(
			domain.FederationErrorInvalidArgument,
			"social.encode_relationship_command",
			err,
		)
	}
	hash := sha256.Sum256(commandBytes)
	return commandBytes, append([]byte(nil), hash[:]...), nil
}

func hasProtoUnknownFields(message proto.Message) bool {
	return message != nil && len(message.ProtoReflect().GetUnknown()) != 0
}

func relationshipActorRef(ptid string) *model.ActorRef {
	return &model.ActorRef{
		Ptid: ptid,
		Kind: model.ActorKind_ACTOR_KIND_PERSON,
	}
}

var _ infrastructure.FederatedRelationshipReceiver = (*FederatedRelationshipService)(nil)
