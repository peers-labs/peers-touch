package command

import (
	"bytes"
	"context"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/application/ports"
	conversationdomain "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/aggregate"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/entity"
	domainevent "github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/event"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/repository"
	"github.com/peers-labs/peers-touch/station/app/subserver/conversation/domain/valueobject"
)

const historyRestoreWindow = 24 * time.Hour

type MemberSettingsPatch struct {
	Nickname            *string
	Muted               *bool
	Pinned              *bool
	AlertEnabled        *bool
	Background          *string
	BackgroundImage     *string
	ClearedAtUnixMillis *int64
}

type ReadCursorResult struct {
	Cursor          repository.ReadCursor
	PostCommitError error
}

func (s *Service) UpdateMemberSettings(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	actor valueobject.PTID,
	patch MemberSettingsPatch,
) (repository.MemberSettings, error) {
	var updated repository.MemberSettings
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		snapshot, err := transaction.Repositories.Authority.LoadForUpdate(ctx, conversationID)
		if err != nil {
			return err
		}
		if !activeMember(snapshot, actor) {
			return unauthorized("application.update_member_settings", "actor is not an active member")
		}
		current, err := transaction.Repositories.MemberSettings.Get(ctx, conversationID, actor)
		if err != nil && !conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			return err
		}
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			current = repository.MemberSettings{
				ConversationID: conversationID,
				Actor:          actor,
				AlertEnabled:   true,
				Background:     "default",
			}
		}
		if patch.Nickname != nil {
			current.Nickname = *patch.Nickname
		}
		if patch.Muted != nil {
			current.Muted = *patch.Muted
		}
		if patch.Pinned != nil {
			current.Pinned = *patch.Pinned
		}
		if patch.AlertEnabled != nil {
			current.AlertEnabled = *patch.AlertEnabled
		}
		if patch.Background != nil {
			current.Background = *patch.Background
		}
		if patch.BackgroundImage != nil {
			current.BackgroundImage = *patch.BackgroundImage
		}
		if patch.ClearedAtUnixMillis != nil {
			requested := *patch.ClearedAtUnixMillis
			restoreRequested := requested == 0 && current.ClearedAtUnixMillis > 0
			restoreExpired := restoreRequested && !s.clock.Now().Before(
				time.UnixMilli(current.ClearedAtUnixMillis).Add(historyRestoreWindow),
			)
			if requested < 0 || restoreExpired ||
				(requested > 0 && requested < current.ClearedAtUnixMillis) {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeStaleAuthorityHead,
					"application.update_member_settings",
					"cleared_at_unix_ms",
					"cannot move backwards outside the restore window",
				)
			}
			current.ClearedAtUnixMillis = requested
		}
		current.UpdatedAt = s.clock.Now()
		if err := transaction.Repositories.MemberSettings.Save(ctx, current); err != nil {
			return err
		}
		updated = current
		return nil
	})
	return updated, err
}

func (s *Service) AdvanceReadCursor(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	reader valueobject.Endpoint,
	sequence valueobject.Sequence,
) (ReadCursorResult, error) {
	return s.advanceReadCursor(ctx, conversationID, reader, sequence, nil)
}

// AdvanceReadCursorFromVerifiedHome applies an authenticated remote reader
// using the current signed endpoint-manifest route snapshot.
func (s *Service) AdvanceReadCursorFromVerifiedHome(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	reader valueobject.Endpoint,
	readerHome valueobject.StationID,
	sequence valueobject.Sequence,
	verifiedRoutes []ports.EndpointRoute,
) (ReadCursorResult, error) {
	if readerHome == "" {
		return ReadCursorResult{}, invalid(
			"application.advance_read_cursor_from_verified_home",
			"reader_home",
			"is required",
		)
	}
	return s.advanceReadCursor(
		ctx,
		conversationID,
		reader,
		sequence,
		&readCursorRouteAuthorization{
			readerHome:     readerHome,
			verifiedRoutes: append([]ports.EndpointRoute(nil), verifiedRoutes...),
		},
	)
}

type readCursorRouteAuthorization struct {
	readerHome     valueobject.StationID
	verifiedRoutes []ports.EndpointRoute
}

func (s *Service) advanceReadCursor(
	ctx context.Context,
	conversationID valueobject.ConversationID,
	reader valueobject.Endpoint,
	sequence valueobject.Sequence,
	routeAuthorization *readCursorRouteAuthorization,
) (ReadCursorResult, error) {
	if sequence == 0 {
		return ReadCursorResult{}, invalid(
			"application.advance_read_cursor",
			"sequence",
			"must be positive",
		)
	}
	var updated repository.ReadCursor
	var notifications []ports.CommittedDelivery
	err := s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		snapshot, err := transaction.Repositories.Authority.LoadForUpdate(ctx, conversationID)
		if err != nil {
			return err
		}
		conversation, err := aggregate.Rehydrate(snapshot)
		if err != nil {
			return err
		}
		var routes []ports.EndpointRoute
		if routeAuthorization == nil {
			active, err := transaction.Identity.IsActive(ctx, reader)
			if err != nil {
				return err
			}
			routes, err = resolveActorRoutes(
				ctx,
				transaction.Identity,
				conversation.ActiveMemberActors(),
			)
			if err != nil {
				return err
			}
			if !active {
				return unauthorized(
					"application.advance_read_cursor",
					"reader is not an active member device",
				)
			}
		} else {
			routes, err = commandRouteSnapshot(
				conversation,
				routeAuthorization.verifiedRoutes,
			)
			if err != nil {
				return err
			}
			if !routeSetContainsAtStation(
				routes,
				reader,
				routeAuthorization.readerHome,
			) {
				return unauthorized(
					"application.advance_read_cursor",
					"reader endpoint does not belong to the authenticated Home Station",
				)
			}
		}
		routes = eligibleConversationRoutes(conversation, routes)
		if !routeSetContains(routes, reader) {
			return unauthorized(
				"application.advance_read_cursor",
				"reader is not an active member device",
			)
		}
		if sequence > conversation.AuthorityHead().Sequence {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeStaleAuthorityHead,
				"application.advance_read_cursor",
				"sequence",
				"cannot exceed the authority head",
			)
		}
		var advanced bool
		updated, advanced, err = transaction.Repositories.ReadCursors.Advance(ctx, repository.ReadCursor{
			ConversationID: conversationID,
			Actor:          reader.Actor,
			Sequence:       sequence,
			UpdatedAt:      s.clock.Now(),
		})
		if err != nil {
			return err
		}
		if !advanced {
			return nil
		}
		payload, err := s.cursorEncoder.EncodeReadCursor(updated)
		if err != nil {
			return err
		}
		eventID := valueobject.EventID(
			valueobject.HashBytes(payload).String(),
		)
		for _, route := range routes {
			if route.Endpoint.Actor == reader.Actor && route.Endpoint.Device == reader.Device {
				continue
			}
			idempotency := valueobject.HashBytes(valueobject.CanonicalTuple(
				[]byte(eventID),
				[]byte(route.Endpoint.Actor),
				[]byte(route.Endpoint.Device),
			)).String()
			if route.HomeStation == s.localStation {
				if err := transaction.DeviceInbox.Enqueue(ctx, ports.DeviceInboxIntent{
					IntentID:       idempotency,
					ConversationID: conversationID,
					EventID:        eventID,
					EventSequence:  updated.Sequence,
					Recipient:      route.Endpoint,
					IdempotencyKey: idempotency,
					PayloadKind:    ports.DeviceInboxPayloadDeviceReceipt,
					OpaquePayload:  payload,
					PayloadHash:    valueobject.HashBytes(payload),
					CreatedAt:      s.clock.Now(),
				}); err != nil {
					return err
				}
			} else if err := transaction.FederationOutbox.Enqueue(ctx, ports.FederationOutboxIntent{
				IntentID:       idempotency,
				ConversationID: conversationID,
				EventID:        eventID,
				EventSequence:  updated.Sequence,
				Recipient:      route.Endpoint,
				TargetStation:  route.HomeStation,
				IdempotencyKey: idempotency,
				PayloadKind:    ports.DeviceInboxPayloadDeviceReceipt,
				OpaquePayload:  payload,
				PayloadHash:    valueobject.HashBytes(payload),
				CreatedAt:      s.clock.Now(),
			}); err != nil {
				return err
			}
			if route.HomeStation == s.localStation {
				notifications = append(notifications, ports.CommittedDelivery{
					Recipient: route.Endpoint,
					EventID:   eventID,
				})
			}
		}
		return nil
	})
	if err != nil {
		return ReadCursorResult{}, err
	}
	result := ReadCursorResult{Cursor: updated}
	if err := s.notify(ctx, notifications); err != nil {
		result.PostCommitError = err
	}
	return result, nil
}

type LeaveIntentRequest struct {
	Version          uint32
	ID               string
	FederationID     valueobject.FederationID
	ConversationID   valueobject.ConversationID
	Actor            valueobject.Endpoint
	SigningKeyID     string
	HomeStation      valueobject.StationID
	AuthorityStation valueobject.StationID
	AuthorityEpoch   valueobject.AuthorityEpoch
	AuthorityHead    valueobject.AuthorityHead
	Signature        []byte
	CreatedAt        time.Time
	ExpiresAt        time.Time
}

func (s *Service) SubmitLeaveIntent(
	ctx context.Context,
	request LeaveIntentRequest,
) (repository.LeaveIntent, error) {
	if request.Version != leaveIntentVersion ||
		request.ID == "" || request.FederationID == "" ||
		request.ConversationID == "" ||
		request.Actor.Validate() != nil || request.HomeStation == "" ||
		request.AuthorityStation == "" || request.AuthorityEpoch == 0 ||
		request.SigningKeyID == "" || len(request.Signature) == 0 ||
		request.CreatedAt.IsZero() || request.ExpiresAt.IsZero() {
		return repository.LeaveIntent{}, invalid(
			"application.submit_leave_intent",
			"request",
			"complete signed leave intent is required",
		)
	}
	createdAt := request.CreatedAt.UTC()
	expiresAt := request.ExpiresAt.UTC()
	signingBytes, err := s.leaveEncoder.EncodeLeaveIntentSigningInput(
		ports.LeaveIntentSigningInput{
			Version:             request.Version,
			IntentID:            request.ID,
			FederationID:        request.FederationID,
			AuthorityStation:    request.AuthorityStation,
			AuthorityEpoch:      request.AuthorityEpoch,
			HomeStation:         request.HomeStation,
			ConversationID:      request.ConversationID,
			Actor:               request.Actor,
			SigningKeyID:        request.SigningKeyID,
			AuthorityHead:       request.AuthorityHead,
			CreatedAtUnixMillis: createdAt.UnixMilli(),
			ExpiresAtUnixMillis: expiresAt.UnixMilli(),
		},
	)
	if err != nil {
		return repository.LeaveIntent{}, err
	}
	candidate := repository.LeaveIntent{
		Version:          request.Version,
		ID:               request.ID,
		FederationID:     request.FederationID,
		ConversationID:   request.ConversationID,
		Actor:            request.Actor,
		SigningKeyID:     request.SigningKeyID,
		AuthorityEpoch:   request.AuthorityEpoch,
		AuthorityHead:    request.AuthorityHead,
		SigningBytes:     signingBytes,
		Signature:        append([]byte(nil), request.Signature...),
		State:            repository.LeaveIntentStatePending,
		CreatedAt:        createdAt,
		ExpiresAt:        expiresAt,
		HomeStation:      request.HomeStation,
		AuthorityStation: request.AuthorityStation,
	}
	var accepted repository.LeaveIntent
	err = s.unitOfWork.Execute(ctx, func(transaction ports.Transaction) error {
		existing, loadIntentErr := transaction.Repositories.LeaveIntents.LoadForUpdate(
			ctx,
			request.ID,
		)
		switch {
		case loadIntentErr == nil && existing.SameIdentity(candidate):
			accepted = existing
			return nil
		case loadIntentErr == nil:
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeCommandConflict,
				"application.submit_leave_intent",
				"intent_id",
				"already belongs to different signed leave intent bytes",
			)
		case !conversationdomain.IsCode(loadIntentErr, conversationdomain.ErrorCodeNotFound):
			return loadIntentErr
		}
		snapshot, err := transaction.Repositories.Authority.LoadForUpdate(
			ctx,
			request.ConversationID,
		)
		if err != nil {
			return err
		}
		conversation, err := aggregate.Rehydrate(snapshot)
		if err != nil {
			return err
		}
		if request.FederationID != snapshot.FederationID ||
			request.AuthorityStation != snapshot.AuthorityStation ||
			request.AuthorityEpoch != snapshot.AuthorityEpoch ||
			request.AuthorityHead != conversation.AuthorityHead() {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeStaleAuthorityHead,
				"application.submit_leave_intent",
				"authority_head",
				"does not match the current Conversation authority",
			)
		}
		if request.Actor.Actor == snapshot.Owner {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeOwnerProtected,
				"application.submit_leave_intent",
				"actor",
				"owner cannot leave without transferring ownership",
			)
		}
		if conversation.Kind() != valueobject.ConversationKindGroup {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeUnsupportedTransition,
				"application.submit_leave_intent",
				"conversation",
				"leave intent requires a group conversation",
			)
		}
		active, err := transaction.Identity.IsActive(ctx, request.Actor)
		if err != nil {
			return err
		}
		routes, err := transaction.Identity.ListActiveEndpoints(
			ctx,
			[]valueobject.PTID{request.Actor.Actor},
		)
		if err != nil {
			return err
		}
		if !active ||
			!routeSetContains(conversationMemberRoutes(conversation), request.Actor) ||
			!routeSetContainsAtStation(routes, request.Actor, request.HomeStation) {
			return unauthorized("application.submit_leave_intent", "actor device is not active")
		}
		now := s.clock.Now()
		if !expiresAt.After(now) ||
			createdAt.After(now.Add(time.Minute)) ||
			!expiresAt.After(createdAt) ||
			expiresAt.Sub(createdAt) > maxLeaveIntentTTL {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeAuthorityPlanExpired,
				"application.submit_leave_intent",
				"time_window",
				"leave intent time window is invalid",
			)
		}
		verification, err := transaction.Identity.VerifyDeviceSignature(
			ctx,
			request.Actor,
			request.SigningKeyID,
			signingBytes,
			request.Signature,
		)
		if err != nil {
			return err
		}
		if verification.KeyRevoked {
			return conversationdomain.NewError(
				conversationdomain.ErrorCodeActorKeyRevoked,
				"application.submit_leave_intent",
				"actor_signing_key",
				"is revoked",
			)
		}
		accepted, err = transaction.Repositories.LeaveIntents.Create(ctx, candidate)
		return err
	})
	return accepted, err
}

func (s *Service) ApplyFollowerEvent(
	ctx context.Context,
	event domainevent.Record,
) error {
	verified, err := domainevent.Verify(event, s.eventSealer)
	if err != nil {
		return err
	}
	if verified.HashScheme != domainevent.HashSchemeTransport {
		return conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.apply_follower_event",
			"hash_scheme",
			"follower events require the canonical transport hash scheme",
		)
	}
	event = verified
	var rejection error
	err = s.unitOfWork.ExecuteSerialized(
		ctx,
		conversationGenesisLockKey(event.ConversationID),
		func(transaction ports.Transaction) error {
			if _, authorityErr := transaction.Repositories.Authority.LoadForUpdate(
				ctx,
				event.ConversationID,
			); authorityErr == nil {
				return conversationdomain.NewError(
					conversationdomain.ErrorCodeCommandConflict,
					"application.apply_follower_event",
					"conversation_id",
					"already exists as a local authority",
				)
			} else if !conversationdomain.IsCode(
				authorityErr,
				conversationdomain.ErrorCodeNotFound,
			) {
				return authorityErr
			}
			current, loadErr := transaction.Repositories.Followers.Get(
				ctx,
				event.ConversationID,
			)
			if loadErr != nil &&
				!conversationdomain.IsCode(loadErr, conversationdomain.ErrorCodeNotFound) {
				return loadErr
			}
			exists := loadErr == nil
			status, statusErr := transaction.Repositories.Followers.Status(
				ctx,
				event.ConversationID,
			)
			if statusErr != nil &&
				!conversationdomain.IsCode(statusErr, conversationdomain.ErrorCodeNotFound) {
				return statusErr
			}
			if statusErr == nil && status == repository.FollowerStatusReadOnly {
				rejection = followerReadOnlyError()
				return nil
			}
			if exists && current.Conversation.AuthorityStation != event.AuthorityStation {
				if err := transaction.Repositories.Followers.SetStatus(
					ctx,
					event.ConversationID,
					repository.FollowerStatusReadOnly,
				); err != nil {
					return err
				}
				rejection = conversationdomain.NewError(
					conversationdomain.ErrorCodeHashChainInvalid,
					"application.apply_follower_event",
					"authority_station",
					"does not match the established follower authority",
				)
				return nil
			}
			if exists && event.Sequence <= current.Head.Sequence {
				applied, appliedErr := transaction.Repositories.Events.GetBySequence(
					ctx,
					event.ConversationID,
					event.Sequence,
				)
				if appliedErr == nil && sameFollowerEvent(applied, event) {
					return nil
				}
				if appliedErr != nil &&
					!conversationdomain.IsCode(
						appliedErr,
						conversationdomain.ErrorCodeNotFound,
					) {
					return appliedErr
				}
				if err := transaction.Repositories.Followers.SetStatus(
					ctx,
					event.ConversationID,
					repository.FollowerStatusReadOnly,
				); err != nil {
					return err
				}
				rejection = followerForkError()
				return nil
			}
			rejoinCheckpoint, checkpointErr := followerRejoinCheckpoint(
				current,
				exists,
				event,
				s.localStation,
			)
			if checkpointErr != nil {
				if err := transaction.Repositories.Followers.SetStatus(
					ctx,
					event.ConversationID,
					repository.FollowerStatusReadOnly,
				); err != nil {
					return err
				}
				rejection = checkpointErr
				return nil
			}
			if exists &&
				current.Status == repository.FollowerStatusRetired &&
				!rejoinCheckpoint {
				rejection = followerRetiredError()
				return nil
			}
			if (!exists && event.Sequence > 1) ||
				(exists &&
					event.Sequence > current.Head.Sequence.Next() &&
					!rejoinCheckpoint) {
				if err := transaction.Repositories.Followers.Buffer(ctx, event); err != nil {
					if conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
						rejection = err
						return nil
					}
					return err
				}
				if err := transaction.Repositories.Followers.SetStatus(
					ctx,
					event.ConversationID,
					repository.FollowerStatusResyncRequired,
				); err != nil {
					return err
				}
				rejection = followerGapError()
				return nil
			}
			buffered, bufferedErr := transaction.Repositories.Followers.GetBuffered(
				ctx,
				event.ConversationID,
				event.Sequence,
			)
			switch {
			case bufferedErr == nil && !sameFollowerEvent(buffered, event):
				if err := transaction.Repositories.Followers.SetStatus(
					ctx,
					event.ConversationID,
					repository.FollowerStatusReadOnly,
				); err != nil {
					return err
				}
				rejection = followerForkError()
				return nil
			case bufferedErr != nil &&
				conversationdomain.IsCode(
					bufferedErr,
					conversationdomain.ErrorCodeHashChainInvalid,
				):
				if err := transaction.Repositories.Followers.SetStatus(
					ctx,
					event.ConversationID,
					repository.FollowerStatusReadOnly,
				); err != nil {
					return err
				}
				rejection = bufferedErr
				return nil
			case bufferedErr != nil &&
				!conversationdomain.IsCode(
					bufferedErr,
					conversationdomain.ErrorCodeNotFound,
				):
				return bufferedErr
			}
			projection, deriveErr := deriveFollowerProjection(
				current,
				exists,
				event,
				rejoinCheckpoint,
			)
			if deriveErr != nil {
				if conversationdomain.IsCode(
					deriveErr,
					conversationdomain.ErrorCodeHashChainInvalid,
				) {
					if statusErr := transaction.Repositories.Followers.SetStatus(
						ctx,
						event.ConversationID,
						repository.FollowerStatusReadOnly,
					); statusErr != nil {
						return statusErr
					}
					rejection = deriveErr
					return nil
				}
				return deriveErr
			}
			projection.Status = followerProjectionStatus(
				current,
				exists,
				projection.Conversation,
				event,
				s.localStation,
				rejoinCheckpoint,
			)
			if rejoinCheckpoint {
				projection.Checkpoint = repository.FollowerCheckpointRejoin
			}
			applyErr := transaction.Repositories.Followers.Apply(ctx, projection, event)
			if conversationdomain.IsCode(applyErr, conversationdomain.ErrorCodeHashChainInvalid) ||
				conversationdomain.IsCode(applyErr, conversationdomain.ErrorCodeStaleAuthorityHead) {
				rejection = applyErr
				return nil
			}
			if applyErr != nil {
				return applyErr
			}
			if appendErr := transaction.Repositories.Events.Append(ctx, event); appendErr != nil {
				return appendErr
			}
			if deleteErr := transaction.Repositories.Followers.DeleteBuffered(
				ctx,
				event.ConversationID,
				event.Sequence,
			); deleteErr != nil {
				return deleteErr
			}
			return s.drainFollowerBuffer(ctx, transaction, projection, &rejection)
		},
	)
	if err != nil {
		return err
	}
	return rejection
}

func (s *Service) drainFollowerBuffer(
	ctx context.Context,
	transaction ports.Transaction,
	current repository.FollowerProjection,
	rejection *error,
) error {
	for {
		next, err := transaction.Repositories.Followers.NextBuffered(
			ctx,
			current.Conversation.ID,
			current.Head.Sequence,
		)
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeNotFound) {
			status := current.Status
			if status == repository.FollowerStatusResyncRequired {
				status = repository.FollowerStatusActive
			}
			return transaction.Repositories.Followers.SetStatus(
				ctx,
				current.Conversation.ID,
				status,
			)
		}
		if conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
			if statusErr := transaction.Repositories.Followers.SetStatus(
				ctx,
				current.Conversation.ID,
				repository.FollowerStatusReadOnly,
			); statusErr != nil {
				return statusErr
			}
			*rejection = err
			return nil
		}
		if err != nil {
			return err
		}
		if next.Sequence != current.Head.Sequence.Next() {
			if err := transaction.Repositories.Followers.SetStatus(
				ctx,
				current.Conversation.ID,
				repository.FollowerStatusResyncRequired,
			); err != nil {
				return err
			}
			*rejection = followerGapError()
			return nil
		}
		if current.Status == repository.FollowerStatusRetired {
			*rejection = followerRetiredError()
			return nil
		}
		projection, err := deriveFollowerProjection(current, true, next, false)
		if err != nil {
			if conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) {
				if statusErr := transaction.Repositories.Followers.SetStatus(
					ctx,
					current.Conversation.ID,
					repository.FollowerStatusReadOnly,
				); statusErr != nil {
					return statusErr
				}
				*rejection = err
				return nil
			}
			return err
		}
		projection.Status = followerProjectionStatus(
			current,
			true,
			projection.Conversation,
			next,
			s.localStation,
			false,
		)
		if err := transaction.Repositories.Followers.Apply(ctx, projection, next); err != nil {
			if conversationdomain.IsCode(err, conversationdomain.ErrorCodeHashChainInvalid) ||
				conversationdomain.IsCode(err, conversationdomain.ErrorCodeStaleAuthorityHead) {
				*rejection = err
				return nil
			}
			return err
		}
		if err := transaction.Repositories.Events.Append(ctx, next); err != nil {
			return err
		}
		if err := transaction.Repositories.Followers.DeleteBuffered(
			ctx,
			next.ConversationID,
			next.Sequence,
		); err != nil {
			return err
		}
		current = projection
	}
}

func followerGapError() error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeStaleAuthorityHead,
		"application.apply_follower_event",
		"sequence",
		"authority event gap is buffered and requires resynchronization",
	)
}

func followerForkError() error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"application.apply_follower_event",
		"event",
		"conflicts with the buffered authority event at the same sequence",
	)
}

func followerReadOnlyError() error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"application.apply_follower_event",
		"status",
		"follower is read-only until explicit resynchronization",
	)
}

func followerRetiredError() error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeUnauthorized,
		"application.apply_follower_event",
		"event",
		"retired follower accepts only a matching local rejoin checkpoint",
	)
}

func sameFollowerEvent(left domainevent.Record, right domainevent.Record) bool {
	return left.ID == right.ID &&
		left.ConversationID == right.ConversationID &&
		left.Sequence == right.Sequence &&
		left.HashScheme == right.HashScheme &&
		left.Hash == right.Hash &&
		bytes.Equal(left.Bytes(), right.Bytes())
}

func followerRejoinCheckpoint(
	current repository.FollowerProjection,
	exists bool,
	event domainevent.Record,
	localStation valueobject.StationID,
) (bool, error) {
	if !exists || current.Status != repository.FollowerStatusRetired ||
		event.Fact.Kind != domainevent.KindMembershipCommitted {
		return false, nil
	}
	if event.Fact.PostState == nil {
		return false, followerStateShapeError(
			"rejoin checkpoint requires a complete post-transition state",
		)
	}
	if followerSnapshotHasActiveHome(current.Conversation, localStation) {
		return false, followerStateShapeError(
			"retired follower still contains an active local member",
		)
	}
	for _, change := range event.Fact.MembershipChanges {
		if change.Action != entity.MembershipActionAddActor ||
			change.HomeStation != localStation ||
			change.Device == "" {
			continue
		}
		if !followerStateHasActiveMember(
			*event.Fact.PostState,
			change.Actor,
			localStation,
		) || !followerStateHasActiveEndpoint(
			*event.Fact.PostState,
			valueobject.Endpoint{Actor: change.Actor, Device: change.Device},
			localStation,
		) {
			return false, followerStateShapeError(
				"rejoin ADD and post-state do not bind the local actor endpoint",
			)
		}
		return true, nil
	}
	return false, nil
}

func followerProjectionStatus(
	current repository.FollowerProjection,
	exists bool,
	next aggregate.Snapshot,
	event domainevent.Record,
	localStation valueobject.StationID,
	rejoinCheckpoint bool,
) repository.FollowerStatus {
	if !exists {
		return repository.FollowerStatusActive
	}
	currentHasLocalMember := followerSnapshotHasActiveHome(
		current.Conversation,
		localStation,
	)
	nextHasLocalMember := followerSnapshotHasActiveHome(next, localStation)
	switch {
	case rejoinCheckpoint && nextHasLocalMember:
		return repository.FollowerStatusActive
	case event.Fact.Kind == domainevent.KindMembershipCommitted &&
		currentHasLocalMember &&
		!nextHasLocalMember:
		return repository.FollowerStatusRetired
	default:
		return current.Status
	}
}

func followerSnapshotHasActiveHome(
	snapshot aggregate.Snapshot,
	homeStation valueobject.StationID,
) bool {
	for _, member := range snapshot.Members {
		if member.Active() && member.HomeStation == homeStation {
			return true
		}
	}
	return false
}

func followerStateHasActiveMember(
	state domainevent.ConversationState,
	actor valueobject.PTID,
	homeStation valueobject.StationID,
) bool {
	for _, member := range state.ActiveMembers {
		if member.Actor == actor &&
			member.HomeStation == homeStation &&
			member.Active() {
			return true
		}
	}
	return false
}

func followerStateHasActiveEndpoint(
	state domainevent.ConversationState,
	endpoint valueobject.Endpoint,
	homeStation valueobject.StationID,
) bool {
	for _, device := range state.ActiveDevices {
		if device.Endpoint == endpoint &&
			device.HomeStation == homeStation &&
			device.Active {
			return true
		}
	}
	return false
}

func deriveFollowerProjection(
	current repository.FollowerProjection,
	exists bool,
	event domainevent.Record,
	rejoinCheckpoint bool,
) (repository.FollowerProjection, error) {
	eventHead := valueobject.AuthorityHead{
		Sequence:        event.Sequence,
		EventHash:       event.Hash,
		MembershipEpoch: event.MembershipEpoch,
		MLSEpoch:        event.MLSEpoch,
	}
	if event.Sequence == 1 {
		if exists {
			current.Head = eventHead
			current.Conversation.Head = eventHead
			return current, nil
		}
		if event.Fact.Kind != domainevent.KindConversationCreated ||
			event.Fact.PostState == nil {
			return repository.FollowerProjection{}, invalid(
				"application.apply_follower_event",
				"event",
				"first follower event must contain a complete creation post-state",
			)
		}
		if err := validateFollowerGenesisEpochs(event); err != nil {
			return repository.FollowerProjection{}, err
		}
		snapshot, err := snapshotFromEventState(
			event.ConversationID,
			event.AuthorityStation,
			eventHead,
			event.CommittedAt,
			event.CommittedAt,
			valueobject.ConversationStatusActive,
			*event.Fact.PostState,
		)
		if err != nil {
			return repository.FollowerProjection{}, err
		}
		if err := validateFollowerCreationProjection(event, snapshot); err != nil {
			return repository.FollowerProjection{}, err
		}
		return repository.FollowerProjection{
			Conversation: snapshot,
			Head:         eventHead,
			Status:       repository.FollowerStatusActive,
			UpdatedAt:    event.CommittedAt,
		}, nil
	}
	if !exists {
		return repository.FollowerProjection{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeStaleAuthorityHead,
			"application.apply_follower_event",
			"sequence",
			"follower state is missing before a non-genesis event",
		)
	}
	if current.Conversation.AuthorityStation != event.AuthorityStation {
		return repository.FollowerProjection{}, conversationdomain.NewError(
			conversationdomain.ErrorCodeHashChainInvalid,
			"application.apply_follower_event",
			"authority_station",
			"does not match the established follower authority",
		)
	}
	if err := validateFollowerEventStateShape(event); err != nil {
		return repository.FollowerProjection{}, err
	}
	if err := validateFollowerEpochTransition(current.Conversation, event); err != nil {
		return repository.FollowerProjection{}, err
	}

	snapshot := current.Conversation
	switch {
	case event.Fact.PostState != nil:
		if event.Fact.PostState.FederationID != current.Conversation.FederationID ||
			event.Fact.PostState.AuthorityEpoch != current.Conversation.AuthorityEpoch {
			return repository.FollowerProjection{}, conversationdomain.NewError(
				conversationdomain.ErrorCodeHashChainInvalid,
				"application.apply_follower_event",
				"authority_scope",
				"does not match the established follower authority scope",
			)
		}
		var err error
		snapshot, err = snapshotFromEventState(
			event.ConversationID,
			event.AuthorityStation,
			eventHead,
			current.Conversation.CreatedAt,
			event.CommittedAt,
			current.Conversation.Status,
			*event.Fact.PostState,
		)
		if err != nil {
			return repository.FollowerProjection{}, err
		}
		if event.Fact.Kind == domainevent.KindMembershipCommitted {
			reconciliationBase := current.Conversation
			if rejoinCheckpoint {
				reconciliationBase.Head.Sequence = event.Sequence - 1
				reconciliationBase.Head.EventHash = event.PreviousHash
			}
			snapshot, err = aggregate.ReconcileCommittedMembershipProjection(
				reconciliationBase,
				event.Fact.MembershipChanges,
				snapshot,
			)
			if err != nil {
				return repository.FollowerProjection{}, err
			}
		} else if event.Fact.Kind == domainevent.KindMemberAuthority {
			if event.Fact.MemberAuthority == nil {
				return repository.FollowerProjection{}, followerStateShapeError(
					"member authority event is missing its mutation",
				)
			}
			snapshot, err = aggregate.ReconcileCommittedMemberAuthorityProjection(
				current.Conversation,
				*event.Fact.MemberAuthority,
				snapshot,
			)
			if err != nil {
				return repository.FollowerProjection{}, err
			}
		}
	case event.Fact.Kind == domainevent.KindConversationSettings:
		snapshot.Settings = snapshot.Settings.Apply(event.Fact.SettingsPatch)
	case event.Fact.Kind == domainevent.KindConversationDissolved:
		snapshot.Status = valueobject.ConversationStatusDissolved
	}
	snapshot.Head = eventHead
	snapshot.UpdatedAt = event.CommittedAt
	if _, err := aggregate.Rehydrate(snapshot); err != nil {
		return repository.FollowerProjection{}, err
	}
	return repository.FollowerProjection{
		Conversation: snapshot,
		Head:         eventHead,
		Status:       current.Status,
		UpdatedAt:    event.CommittedAt,
	}, nil
}

func validateFollowerGenesisEpochs(event domainevent.Record) error {
	state := event.Fact.PostState
	if state == nil ||
		state.MembershipEpoch != event.MembershipEpoch ||
		state.MLSEpoch != event.MLSEpoch {
		return followerEpochError("creation post-state epochs disagree with the authority event")
	}
	switch state.Kind {
	case valueobject.ConversationKindDirect:
		if event.MembershipEpoch != 1 || event.MLSEpoch != 0 {
			return followerEpochError("direct creation must start at membership epoch one and MLS epoch zero")
		}
	case valueobject.ConversationKindGroup:
		if event.MembershipEpoch != 1 || event.MLSEpoch != 1 {
			return followerEpochError("group creation must start at membership and MLS epoch one")
		}
	default:
		return followerEpochError("creation event has an unsupported Conversation kind")
	}
	return nil
}

func validateFollowerCreationProjection(
	event domainevent.Record,
	snapshot aggregate.Snapshot,
) error {
	created := event.Fact.Created
	if created == nil ||
		created.Kind != snapshot.Kind ||
		created.Owner != snapshot.Owner ||
		created.Name != snapshot.Settings.Name ||
		len(created.Members) != len(snapshot.Members) {
		return followerStateShapeError(
			"creation fact does not match the committed Conversation post-state",
		)
	}
	members := make(map[valueobject.PTID]struct{}, len(created.Members))
	for _, actor := range created.Members {
		if actor == "" {
			return followerStateShapeError("creation fact contains an empty member")
		}
		members[actor] = struct{}{}
	}
	if len(members) != len(created.Members) {
		return followerStateShapeError("creation fact contains duplicate members")
	}
	for _, member := range snapshot.Members {
		if _, exists := members[member.Actor]; !exists {
			return followerStateShapeError(
				"creation fact members do not match the committed post-state",
			)
		}
	}
	return nil
}

func validateFollowerEventStateShape(event domainevent.Record) error {
	switch event.Fact.Kind {
	case domainevent.KindMembershipCommitted,
		domainevent.KindMemberAuthority:
		if event.Fact.PostState == nil {
			return followerStateShapeError(
				"membership authority event must contain the complete post-transition state",
			)
		}
	case domainevent.KindMessageCommitted,
		domainevent.KindMessageForwarded,
		domainevent.KindMessageEdited,
		domainevent.KindMessageRetracted,
		domainevent.KindMessageHiddenForActor,
		domainevent.KindMessageModerated,
		domainevent.KindReactionCommitted,
		domainevent.KindMessagePinCommitted,
		domainevent.KindConversationSettings,
		domainevent.KindConversationDissolved:
		if event.Fact.PostState != nil {
			return followerStateShapeError("ordinary event cannot replace Conversation state")
		}
	case domainevent.KindConversationCreated:
		return followerStateShapeError("creation event is valid only at sequence one")
	default:
		return followerStateShapeError("event kind is not supported by the follower projection")
	}
	return nil
}

func validateFollowerEpochTransition(
	current aggregate.Snapshot,
	event domainevent.Record,
) error {
	if event.Fact.PostState != nil &&
		(event.Fact.PostState.MembershipEpoch != event.MembershipEpoch ||
			event.Fact.PostState.MLSEpoch != event.MLSEpoch) {
		return followerEpochError("post-state epochs disagree with the authority event")
	}
	if current.Kind == valueobject.ConversationKindDirect {
		if event.Fact.Kind == domainevent.KindMembershipCommitted ||
			event.MembershipEpoch != current.Head.MembershipEpoch ||
			event.MLSEpoch != current.Head.MLSEpoch {
			return followerEpochError("direct events cannot change membership or MLS epochs")
		}
		return nil
	}
	if event.Fact.Kind == domainevent.KindMembershipCommitted {
		if event.MembershipEpoch != current.Head.MembershipEpoch.Next() ||
			event.MLSEpoch != current.Head.MLSEpoch.Next() {
			return followerEpochError(
				"membership events must advance both group epochs by exactly one",
			)
		}
		return nil
	}
	if event.Fact.Kind == domainevent.KindMemberAuthority {
		if event.MembershipEpoch != current.Head.MembershipEpoch.Next() ||
			event.MLSEpoch != current.Head.MLSEpoch {
			return followerEpochError(
				"member authority events must advance membership epoch only",
			)
		}
		return nil
	}
	if event.MembershipEpoch != current.Head.MembershipEpoch ||
		event.MLSEpoch != current.Head.MLSEpoch {
		return followerEpochError("ordinary events cannot change group epochs")
	}
	return nil
}

func followerEpochError(message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"application.apply_follower_event",
		"epochs",
		message,
	)
}

func followerStateShapeError(message string) error {
	return conversationdomain.NewError(
		conversationdomain.ErrorCodeHashChainInvalid,
		"application.apply_follower_event",
		"post_state",
		message,
	)
}

func snapshotFromEventState(
	conversationID valueobject.ConversationID,
	authorityStation valueobject.StationID,
	head valueobject.AuthorityHead,
	createdAt time.Time,
	updatedAt time.Time,
	status valueobject.ConversationStatus,
	state domainevent.ConversationState,
) (aggregate.Snapshot, error) {
	if state.FederationID == "" || state.AuthorityEpoch == 0 ||
		state.MembershipEpoch != head.MembershipEpoch ||
		state.MLSEpoch != head.MLSEpoch ||
		len(state.ActiveMembers) == 0 ||
		len(state.ActiveDevices) == 0 ||
		!valueobject.EqualEndpointSets(
			activeEndpoints(state.ActiveDevices),
			state.ActiveEndpoints,
		) {
		return aggregate.Snapshot{}, invalid(
			"application.apply_follower_event",
			"post_state",
			"must contain the complete active member and endpoint state",
		)
	}
	snapshot := aggregate.Snapshot{
		ID:               conversationID,
		Kind:             state.Kind,
		Status:           status,
		FederationID:     state.FederationID,
		AuthorityStation: authorityStation,
		AuthorityEpoch:   state.AuthorityEpoch,
		Owner:            state.Owner,
		Head:             head,
		Settings:         state.Settings,
		Members:          append([]entity.Member(nil), state.ActiveMembers...),
		Devices:          append([]entity.MemberDevice(nil), state.ActiveDevices...),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}
	if _, err := aggregate.Rehydrate(snapshot); err != nil {
		return aggregate.Snapshot{}, err
	}
	return snapshot, nil
}

func activeEndpoints(values []entity.MemberDevice) []valueobject.Endpoint {
	active := make([]valueobject.Endpoint, 0, len(values))
	for _, device := range values {
		if device.Active {
			active = append(active, device.Endpoint)
		}
	}
	return active
}

func conversationMemberRoutes(conversation *aggregate.Conversation) []ports.EndpointRoute {
	devices := conversation.MemberDevices()
	routes := make([]ports.EndpointRoute, 0, len(devices))
	for _, device := range devices {
		if !device.Active {
			continue
		}
		routes = append(routes, ports.EndpointRoute{
			Endpoint:    device.Endpoint,
			HomeStation: device.HomeStation,
		})
	}
	return routes
}

func activeMember(snapshot aggregate.Snapshot, actor valueobject.PTID) bool {
	for _, member := range snapshot.Members {
		if member.Actor == actor && member.Active() {
			return true
		}
	}
	return false
}
