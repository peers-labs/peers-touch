package application

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"sort"
	"time"

	messaging "github.com/peers-labs/peers-touch/station/app/subserver/conversation/engine/domain"
	chat "github.com/peers-labs/peers-touch/station/frame/touch/model/chat"
	"google.golang.org/protobuf/proto"
)

type FollowerProjectionPolicy struct {
	MaxPendingEvents int
	MaxPendingBytes  int
	PendingTTL       time.Duration
	ReplayPageLimit  uint32
}

type followerIngestOutcome int

const (
	followerIngestApplied followerIngestOutcome = iota + 1
	followerIngestDuplicate
	followerIngestBuffered
	followerIngestGap
	followerIngestFork
	followerIngestOverloaded
)

const followerHeadConflictRetryLimit = 3

type FollowerProjectionService struct {
	unitOfWork   messaging.FederationInboxUnitOfWork
	repository   messaging.FollowerRepository
	replayClient messaging.FollowerReplayClient
	peerTrust    messaging.FederationPeerTrustResolver
	localStation string
	policy       FollowerProjectionPolicy
	clock        func() time.Time
}

func NewFollowerProjectionService(
	unitOfWork messaging.FederationInboxUnitOfWork,
	repository messaging.FollowerRepository,
	replayClient messaging.FollowerReplayClient,
	peerTrust messaging.FederationPeerTrustResolver,
	localStation string,
	policy FollowerProjectionPolicy,
	clock func() time.Time,
) (*FollowerProjectionService, error) {
	if unitOfWork == nil ||
		repository == nil ||
		replayClient == nil ||
		peerTrust == nil ||
		localStation == "" ||
		policy.MaxPendingEvents != 128 ||
		policy.MaxPendingBytes != 4<<20 ||
		policy.PendingTTL != 10*time.Minute ||
		policy.ReplayPageLimit == 0 ||
		policy.ReplayPageLimit > 128 ||
		clock == nil {
		return nil, fmt.Errorf("messaging: follower projection service dependencies are invalid")
	}
	return &FollowerProjectionService{
		unitOfWork:   unitOfWork,
		repository:   repository,
		replayClient: replayClient,
		peerTrust:    peerTrust,
		localStation: localStation,
		policy:       policy,
		clock:        clock,
	}, nil
}

func (s *FollowerProjectionService) DeliverProjection(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	sourceStationPublicKey ed25519.PublicKey,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	projection := &chat.MessagingFollowerProjection{}
	if err := unmarshalDeterministic(frame.OpaquePayload, projection); err != nil {
		return nil, messaging.ErrFederationFrameInvalid
	}
	event := projection.ConversationEvent
	if projection.FormatVersion != MessagingFollowerProjectionFormatVersion ||
		projection.AuthorityStationId != frame.SourceStationId ||
		projection.TargetHomeStationId != frame.TargetStationId ||
		projection.TargetHomeStationId != s.localStation ||
		event == nil ||
		event.AuthorityStationId != frame.SourceStationId ||
		event.ConversationId != frame.ConversationId ||
		event.EventId != frame.EventId ||
		event.Sequence != frame.AuthoritySequence {
		return nil, messaging.ErrFederationFrameInvalid
	}
	if err := validateFollowerEvent(event); err != nil {
		return nil, err
	}
	if err := s.verifyAuthorityTrustIfInitial(
		ctx,
		event,
		frame.SourceStationId,
		frame.TargetStationId,
	); err != nil {
		return nil, err
	}

	var outcome followerIngestOutcome
	duplicate, acknowledged, err := s.ingestFederationFrameWithHeadRetry(
		ctx,
		frame,
		now.UTC(),
		func(repositories messaging.FederationInboxRepositories) (
			messaging.FederationInboxMutation,
			error,
		) {
			preserveGap, stateErr := followerRequiresReplayCompletion(
				ctx,
				repositories.Follower,
				event.ConversationId,
			)
			if stateErr != nil {
				return messaging.FederationInboxMutation{}, stateErr
			}
			var applyErr error
			outcome, applyErr = s.ingestEvent(
				ctx,
				repositories.Follower,
				event,
				frame.SourceStationId,
				frame.SigningKeyId,
				now,
				true,
			)
			if applyErr != nil {
				return messaging.FederationInboxMutation{}, applyErr
			}
			if preserveGap &&
				(outcome == followerIngestApplied ||
					outcome == followerIngestDuplicate) {
				if err := repositories.Follower.UpdateConversationState(
					ctx,
					event.ConversationId,
					messaging.FollowerConversationStateGapWaitingResync,
					now,
				); err != nil {
					return messaging.FederationInboxMutation{}, err
				}
			}
			acknowledge := outcome != followerIngestFork &&
				outcome != followerIngestOverloaded
			if outcome == followerIngestBuffered &&
				followerEventRemovesActorAtHomeStation(event, s.localStation) {
				acknowledge = false
			}
			return messaging.FederationInboxMutation{
				Acknowledge: acknowledge,
			}, nil
		},
	)
	if err != nil {
		return nil, err
	}
	if duplicate {
		return &chat.DeliverMessagingFederationFrameResponse{
			Accepted:  true,
			Duplicate: true,
		}, nil
	}
	switch outcome {
	case followerIngestFork:
		return nil, messaging.ErrFollowerFork
	case followerIngestOverloaded:
		return nil, messaging.ErrFollowerBufferOverloaded
	}
	if !acknowledged {
		return nil, messaging.ErrFollowerGap
	}
	return &chat.DeliverMessagingFederationFrameResponse{Accepted: true}, nil
}

func (s *FollowerProjectionService) IngestDeviceEventFrame(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	event *chat.ConversationEvent,
	enqueue func(messaging.FederationInboxRepositories) error,
	now time.Time,
) (*chat.DeliverMessagingFederationFrameResponse, error) {
	if event == nil || enqueue == nil {
		return nil, messaging.ErrFederationFrameInvalid
	}
	if err := validateFollowerEvent(event); err != nil {
		return nil, err
	}
	if err := s.verifyAuthorityTrustIfInitial(
		ctx,
		event,
		frame.SourceStationId,
		frame.TargetStationId,
	); err != nil {
		return nil, err
	}
	var outcome followerIngestOutcome
	duplicate, acknowledged, err := s.ingestFederationFrameWithHeadRetry(
		ctx,
		frame,
		now.UTC(),
		func(repositories messaging.FederationInboxRepositories) (
			messaging.FederationInboxMutation,
			error,
		) {
			conversation, loadErr := repositories.Follower.GetConversation(
				ctx,
				event.ConversationId,
			)
			if errors.Is(loadErr, messaging.ErrNotFound) {
				outcome = followerIngestGap
				return messaging.FederationInboxMutation{Acknowledge: false}, nil
			}
			if loadErr != nil {
				return messaging.FederationInboxMutation{}, loadErr
			}
			if conversation.State ==
				messaging.FollowerConversationStateResyncUnavailableReadOnly {
				return messaging.FederationInboxMutation{},
					messaging.ErrFollowerReplayUnavailable
			}
			preserveGap := conversation.State ==
				messaging.FollowerConversationStateGapWaitingResync
			var applyErr error
			outcome, applyErr = s.ingestEvent(
				ctx,
				repositories.Follower,
				event,
				frame.SourceStationId,
				frame.SigningKeyId,
				now,
				false,
			)
			if applyErr != nil {
				return messaging.FederationInboxMutation{}, applyErr
			}
			switch outcome {
			case followerIngestApplied, followerIngestDuplicate:
			case followerIngestFork, followerIngestGap:
				return messaging.FederationInboxMutation{Acknowledge: false}, nil
			default:
				return messaging.FederationInboxMutation{},
					messaging.ErrFollowerProjectionConflict
			}
			if err := enqueue(repositories); err != nil {
				return messaging.FederationInboxMutation{}, err
			}
			if preserveGap {
				if err := repositories.Follower.UpdateConversationState(
					ctx,
					event.ConversationId,
					messaging.FollowerConversationStateGapWaitingResync,
					now,
				); err != nil {
					return messaging.FederationInboxMutation{}, err
				}
			}
			return messaging.FederationInboxMutation{Acknowledge: true}, nil
		},
	)
	if err != nil {
		return nil, err
	}
	if duplicate {
		return &chat.DeliverMessagingFederationFrameResponse{
			Accepted:  true,
			Duplicate: true,
		}, nil
	}
	if !acknowledged {
		switch outcome {
		case followerIngestFork:
			return nil, messaging.ErrFollowerFork
		default:
			return nil, messaging.ErrFollowerGap
		}
	}
	return &chat.DeliverMessagingFederationFrameResponse{Accepted: true}, nil
}

func (s *FollowerProjectionService) ingestFederationFrameWithHeadRetry(
	ctx context.Context,
	frame *chat.MessagingFederationFrame,
	receivedAt time.Time,
	fn func(messaging.FederationInboxRepositories) (
		messaging.FederationInboxMutation,
		error,
	),
) (bool, bool, error) {
	for attempt := 0; attempt < followerHeadConflictRetryLimit; attempt++ {
		duplicate, acknowledged, err := s.unitOfWork.IngestFederationFrame(
			ctx,
			frame,
			receivedAt,
			fn,
		)
		if !errors.Is(err, messaging.ErrFollowerHeadConflict) {
			return duplicate, acknowledged, err
		}
	}
	return false, false, fmt.Errorf(
		"%w: %v",
		messaging.ErrFollowerGap,
		messaging.ErrFollowerHeadConflict,
	)
}

func (s *FollowerProjectionService) ReconcilePending(ctx context.Context) error {
	conversations, err := s.repository.ListConversationsByState(
		ctx,
		messaging.FollowerConversationStateGapWaitingResync,
	)
	if err != nil {
		return err
	}
	var firstError error
	for _, conversation := range conversations {
		if err := s.ReconcileConversation(ctx, conversation.ConversationID); err != nil &&
			firstError == nil {
			firstError = err
		}
	}
	return firstError
}

func (s *FollowerProjectionService) ReconcileConversation(
	ctx context.Context,
	conversationID string,
) error {
	headConflictRetries := 0
	for pageIndex := 0; pageIndex < s.policy.MaxPendingEvents; {
		conversation, err := s.repository.GetConversation(ctx, conversationID)
		if err != nil {
			return err
		}
		if conversation.State == messaging.FollowerConversationStateForkProtectedReadOnly {
			return messaging.ErrFollowerFork
		}
		if _, err := s.repository.DeleteExpiredPendingEvents(
			ctx,
			conversationID,
			s.clock().UTC(),
		); err != nil {
			return err
		}
		nonce := make([]byte, sha256.Size)
		if _, err := rand.Read(nonce); err != nil {
			return err
		}
		request := &chat.GetMessagingFollowerEventsRequest{
			FormatVersion:       MessagingFollowerReplayFormatVersion,
			ConversationId:      conversation.ConversationID,
			AuthorityStationId:  conversation.AuthorityStationID,
			TargetHomeStationId: s.localStation,
			AfterSequence:       conversation.CurrentSequence,
			AfterEventHash:      append([]byte(nil), conversation.CurrentEventHash...),
			RequestNonce:        nonce,
			PageLimit:           s.policy.ReplayPageLimit,
		}
		page, err := s.replayClient.FetchFollowerEvents(
			ctx,
			conversation.AuthorityStationID,
			conversation.AuthoritySigningKeyID,
			request,
		)
		if err != nil {
			return s.recordReplayFailure(ctx, conversationID, err)
		}
		if err := s.verifyAuthorityTrustIfInitialPage(
			ctx,
			conversation,
			page,
		); err != nil {
			return s.recordReplayFailure(ctx, conversationID, err)
		}
		applied, err := s.applyReplayPage(ctx, conversation, request, page)
		if err != nil {
			if errors.Is(err, messaging.ErrFollowerHeadConflict) {
				headConflictRetries++
				if headConflictRetries < followerHeadConflictRetryLimit {
					continue
				}
				return fmt.Errorf("%w: %v", messaging.ErrFollowerGap, err)
			}
			return s.recordReplayFailure(ctx, conversationID, err)
		}
		headConflictRetries = 0
		pageIndex++
		if !page.HasMore {
			reconciled, err := s.repository.GetConversation(ctx, conversationID)
			if err != nil {
				return err
			}
			if reconciled.State != messaging.FollowerConversationStateActive {
				return messaging.ErrFollowerGap
			}
			return nil
		}
		if applied == 0 {
			err := messaging.ErrFollowerReplayInvalid
			return s.recordReplayFailure(ctx, conversationID, err)
		}
	}
	return messaging.ErrFollowerReplayInvalid
}

func (s *FollowerProjectionService) ingestEvent(
	ctx context.Context,
	repository messaging.FollowerRepository,
	event *chat.ConversationEvent,
	authorityStationID string,
	authoritySigningKeyID string,
	now time.Time,
	allowBuffer bool,
) (followerIngestOutcome, error) {
	conversation, err := repository.GetConversation(ctx, event.ConversationId)
	if err != nil && !errors.Is(err, messaging.ErrNotFound) {
		return 0, err
	}
	if errors.Is(err, messaging.ErrNotFound) {
		conversation = nil
	}
	if conversation != nil &&
		(conversation.AuthorityStationID != authorityStationID ||
			conversation.AuthoritySigningKeyID != authoritySigningKeyID) {
		if err := repository.UpdateConversationState(
			ctx,
			event.ConversationId,
			messaging.FollowerConversationStateForkProtectedReadOnly,
			now,
		); err != nil {
			return 0, err
		}
		return followerIngestFork, nil
	}
	if conversation != nil &&
		conversation.State == messaging.FollowerConversationStateForkProtectedReadOnly {
		return followerIngestFork, nil
	}

	duplicate, conflict, err := followerEventIdentity(
		ctx,
		repository,
		event,
	)
	if err != nil {
		return 0, err
	}
	if conflict {
		if conversation != nil {
			if err := repository.UpdateConversationState(
				ctx,
				event.ConversationId,
				messaging.FollowerConversationStateForkProtectedReadOnly,
				now,
			); err != nil {
				return 0, err
			}
		}
		return followerIngestFork, nil
	}
	if duplicate {
		return followerIngestDuplicate, nil
	}

	initial := isValidInitialCheckpoint(event, s.localStation)
	if conversation == nil || conversation.CurrentSequence == 0 {
		if initial {
			if conversation == nil {
				conversation = followerPlaceholder(
					event.ConversationId,
					authorityStationID,
					authoritySigningKeyID,
					now,
				)
				if _, err := repository.CreateConversation(ctx, conversation); err != nil {
					return 0, err
				}
			}
			if err := applyFollowerEvent(
				ctx,
				repository,
				conversation,
				event,
				s.localStation,
				now,
			); err != nil {
				return 0, err
			}
			if err := drainFollowerPending(
				ctx,
				repository,
				event.ConversationId,
				s.localStation,
				now,
			); err != nil {
				return 0, err
			}
			return followerIngestApplied, nil
		}
		if !allowBuffer {
			return followerIngestGap, nil
		}
		if conversation == nil {
			conversation = followerPlaceholder(
				event.ConversationId,
				authorityStationID,
				authoritySigningKeyID,
				now,
			)
			if _, err := repository.CreateConversation(ctx, conversation); err != nil {
				return 0, err
			}
		}
		return s.bufferFollowerEvent(ctx, repository, conversation, event, now)
	}

	if event.Sequence <= conversation.CurrentSequence {
		if err := repository.UpdateConversationState(
			ctx,
			event.ConversationId,
			messaging.FollowerConversationStateForkProtectedReadOnly,
			now,
		); err != nil {
			return 0, err
		}
		return followerIngestFork, nil
	}
	if event.Sequence != conversation.CurrentSequence+1 {
		if !allowBuffer {
			if err := repository.UpdateConversationState(
				ctx,
				event.ConversationId,
				messaging.FollowerConversationStateGapWaitingResync,
				now,
			); err != nil {
				return 0, err
			}
			return followerIngestGap, nil
		}
		return s.bufferFollowerEvent(ctx, repository, conversation, event, now)
	}
	if !bytes.Equal(event.PreviousHash, conversation.CurrentEventHash) {
		if err := repository.UpdateConversationState(
			ctx,
			event.ConversationId,
			messaging.FollowerConversationStateForkProtectedReadOnly,
			now,
		); err != nil {
			return 0, err
		}
		return followerIngestFork, nil
	}
	if err := applyFollowerEvent(
		ctx,
		repository,
		conversation,
		event,
		s.localStation,
		now,
	); err != nil {
		return 0, err
	}
	if err := drainFollowerPending(
		ctx,
		repository,
		event.ConversationId,
		s.localStation,
		now,
	); err != nil {
		return 0, err
	}
	return followerIngestApplied, nil
}

func (s *FollowerProjectionService) bufferFollowerEvent(
	ctx context.Context,
	repository messaging.FollowerRepository,
	conversation *messaging.FollowerConversation,
	event *chat.ConversationEvent,
	now time.Time,
) (followerIngestOutcome, error) {
	if _, err := repository.DeleteExpiredPendingEvents(
		ctx,
		event.ConversationId,
		now,
	); err != nil {
		return 0, err
	}
	eventBytes, err := proto.MarshalOptions{Deterministic: true}.Marshal(event)
	if err != nil {
		return 0, err
	}
	pending, err := repository.ListPendingEvents(ctx, event.ConversationId)
	if err != nil {
		return 0, err
	}
	totalBytes := 0
	for _, existing := range pending {
		totalBytes += len(existing.PublicEventBytes)
		if existing.Sequence == event.Sequence || existing.EventID == event.EventId {
			if existing.Sequence == event.Sequence &&
				existing.EventID == event.EventId &&
				bytes.Equal(existing.EventHash, event.EventHash) &&
				bytes.Equal(existing.PublicEventBytes, eventBytes) {
				return followerIngestBuffered, nil
			}
			if err := repository.UpdateConversationState(
				ctx,
				event.ConversationId,
				messaging.FollowerConversationStateForkProtectedReadOnly,
				now,
			); err != nil {
				return 0, err
			}
			return followerIngestFork, nil
		}
	}
	if len(pending) >= s.policy.MaxPendingEvents ||
		len(eventBytes) > s.policy.MaxPendingBytes ||
		totalBytes > s.policy.MaxPendingBytes-len(eventBytes) {
		if err := repository.UpdateConversationState(
			ctx,
			event.ConversationId,
			messaging.FollowerConversationStateGapWaitingResync,
			now,
		); err != nil {
			return 0, err
		}
		return followerIngestOverloaded, nil
	}
	if err := repository.StorePendingEvent(ctx, &messaging.FollowerPendingEvent{
		ConversationID:   event.ConversationId,
		Sequence:         event.Sequence,
		EventID:          event.EventId,
		EventHash:        append([]byte(nil), event.EventHash...),
		PreviousHash:     append([]byte(nil), event.PreviousHash...),
		PublicEventBytes: eventBytes,
		ExpiresAt:        now.Add(s.policy.PendingTTL),
	}); err != nil {
		return 0, err
	}
	if err := repository.UpdateConversationState(
		ctx,
		conversation.ConversationID,
		messaging.FollowerConversationStateGapWaitingResync,
		now,
	); err != nil {
		return 0, err
	}
	return followerIngestBuffered, nil
}

func (s *FollowerProjectionService) applyReplayPage(
	ctx context.Context,
	expected *messaging.FollowerConversation,
	request *chat.GetMessagingFollowerEventsRequest,
	page *chat.MessagingFollowerEventsPage,
) (int, error) {
	applied := 0
	err := s.unitOfWork.ExecuteFollower(
		ctx,
		func(repository messaging.FollowerRepository) error {
			current, err := repository.GetConversation(ctx, expected.ConversationID)
			if err != nil {
				return err
			}
			if current.AuthorityStationID != expected.AuthorityStationID ||
				current.AuthoritySigningKeyID != expected.AuthoritySigningKeyID ||
				current.CurrentSequence != request.AfterSequence ||
				!bytes.Equal(current.CurrentEventHash, request.AfterEventHash) {
				return messaging.ErrFollowerHeadConflict
			}
			for index, event := range page.ConversationEvents {
				grant := page.EventProjectionGrants[index]
				if grant.TargetHomeStationId != s.localStation ||
					grant.EventId != event.EventId {
					return messaging.ErrFollowerReplayNotGranted
				}
				if err := validateFollowerEvent(event); err != nil {
					return err
				}
				initial := current.CurrentSequence == 0 &&
					isValidInitialCheckpoint(event, s.localStation)
				if !initial &&
					(event.Sequence != current.CurrentSequence+1 ||
						!bytes.Equal(event.PreviousHash, current.CurrentEventHash)) {
					return messaging.ErrFollowerReplayInvalid
				}
				if err := applyFollowerEvent(
					ctx,
					repository,
					current,
					event,
					s.localStation,
					s.clock().UTC(),
				); err != nil {
					return err
				}
				current, err = repository.GetConversation(ctx, expected.ConversationID)
				if err != nil {
					return err
				}
				if err := repository.DeletePendingEvent(
					ctx,
					event.ConversationId,
					event.Sequence,
				); err != nil {
					return err
				}
				applied++
			}
			if err := drainFollowerPending(
				ctx,
				repository,
				expected.ConversationID,
				s.localStation,
				s.clock().UTC(),
			); err != nil {
				return err
			}
			if page.HasMore {
				return repository.UpdateConversationState(
					ctx,
					expected.ConversationID,
					messaging.FollowerConversationStateGapWaitingResync,
					s.clock().UTC(),
				)
			}
			return nil
		},
	)
	return applied, err
}

func (s *FollowerProjectionService) verifyAuthorityTrustIfInitial(
	ctx context.Context,
	event *chat.ConversationEvent,
	authorityStationID string,
	targetHomeStationID string,
) error {
	existing, err := s.repository.GetConversation(ctx, event.ConversationId)
	if err == nil && existing.CurrentSequence > 0 {
		return nil
	}
	if err != nil && !errors.Is(err, messaging.ErrNotFound) {
		return err
	}
	if !isValidInitialCheckpoint(event, targetHomeStationID) {
		return nil
	}
	ownerPTID, ownerHomeStationID, err := followerOwnerBinding(event)
	if err != nil ||
		ownerHomeStationID != authorityStationID ||
		event.AuthorityStationId != authorityStationID {
		return messaging.ErrFollowerReplayInvalid
	}
	return s.peerTrust.EnsurePeerTrust(ctx, authorityStationID, ownerPTID)
}

func (s *FollowerProjectionService) verifyAuthorityTrustIfInitialPage(
	ctx context.Context,
	conversation *messaging.FollowerConversation,
	page *chat.MessagingFollowerEventsPage,
) error {
	if conversation.CurrentSequence != 0 || len(page.ConversationEvents) == 0 {
		return nil
	}
	first := page.ConversationEvents[0]
	if !isValidInitialCheckpoint(first, s.localStation) {
		return messaging.ErrFollowerReplayInvalid
	}
	ownerPTID, ownerHomeStationID, err := followerOwnerBinding(first)
	if err != nil || ownerHomeStationID != conversation.AuthorityStationID {
		return messaging.ErrFollowerReplayInvalid
	}
	return s.peerTrust.EnsurePeerTrust(
		ctx,
		conversation.AuthorityStationID,
		ownerPTID,
	)
}

func (s *FollowerProjectionService) recordReplayFailure(
	ctx context.Context,
	conversationID string,
	replayErr error,
) error {
	state := messaging.FollowerConversationStateGapWaitingResync
	switch {
	case errors.Is(replayErr, messaging.ErrFollowerReplayUnavailable):
		state = messaging.FollowerConversationStateResyncUnavailableReadOnly
	case errors.Is(replayErr, messaging.ErrFollowerReplayInvalid),
		errors.Is(replayErr, messaging.ErrFollowerReplayNotGranted):
		state = messaging.FollowerConversationStateForkProtectedReadOnly
	default:
		return replayErr
	}
	if err := s.unitOfWork.ExecuteFollower(
		ctx,
		func(repository messaging.FollowerRepository) error {
			return repository.UpdateConversationState(
				ctx,
				conversationID,
				state,
				s.clock().UTC(),
			)
		},
	); err != nil {
		return errors.Join(
			replayErr,
			fmt.Errorf("messaging: persist follower replay failure state: %w", err),
		)
	}
	return replayErr
}

func followerPlaceholder(
	conversationID string,
	authorityStationID string,
	authoritySigningKeyID string,
	now time.Time,
) *messaging.FollowerConversation {
	return &messaging.FollowerConversation{
		ConversationID:        conversationID,
		AuthorityStationID:    authorityStationID,
		AuthoritySigningKeyID: authoritySigningKeyID,
		State:                 messaging.FollowerConversationStateGapWaitingResync,
		UpdatedAt:             now.UTC(),
	}
}

func followerEventIdentity(
	ctx context.Context,
	repository messaging.FollowerRepository,
	event *chat.ConversationEvent,
) (duplicate bool, conflict bool, err error) {
	bySequence, sequenceErr := repository.GetEventReceipt(
		ctx,
		event.ConversationId,
		event.Sequence,
	)
	if sequenceErr != nil && !errors.Is(sequenceErr, messaging.ErrNotFound) {
		return false, false, sequenceErr
	}
	byEventID, eventIDErr := repository.GetEventReceiptByEventID(
		ctx,
		event.ConversationId,
		event.EventId,
	)
	if eventIDErr != nil && !errors.Is(eventIDErr, messaging.ErrNotFound) {
		return false, false, eventIDErr
	}
	if bySequence == nil && byEventID == nil {
		return false, false, nil
	}
	if bySequence != nil &&
		byEventID != nil &&
		bySequence.Sequence == event.Sequence &&
		bySequence.EventID == event.EventId &&
		bytes.Equal(bySequence.EventHash, event.EventHash) &&
		bytes.Equal(byEventID.EventHash, event.EventHash) {
		return true, false, nil
	}
	return false, true, nil
}

func applyFollowerEvent(
	ctx context.Context,
	repository messaging.FollowerRepository,
	current *messaging.FollowerConversation,
	event *chat.ConversationEvent,
	localStationID string,
	now time.Time,
) error {
	if current == nil {
		return messaging.ErrFollowerReplayInvalid
	}
	next := *current
	next.CurrentSequence = event.Sequence
	next.CurrentEventHash = append([]byte(nil), event.EventHash...)
	next.MembershipEpoch = event.MembershipEpoch
	next.MlsEpoch = event.MlsEpoch
	next.State = messaging.FollowerConversationStateActive
	next.UpdatedAt = now.UTC()

	switch payload := event.Payload.(type) {
	case *chat.ConversationEvent_ConversationCreated:
		if current.CurrentSequence != 0 ||
			event.Sequence != 1 ||
			len(event.PreviousHash) != 0 {
			return messaging.ErrFollowerReplayInvalid
		}
		fact := payload.ConversationCreated
		if fact == nil {
			return messaging.ErrFollowerReplayInvalid
		}
		next.Kind = authorityConversationKind(fact.Kind)
		next.Name = fact.Name
		next.OwnerPTID = fact.OwnerPtid
		if err := replaceFollowerMembers(
			ctx,
			repository,
			event.ConversationId,
			fact.Members,
			event.Sequence,
		); err != nil {
			return err
		}
	case *chat.ConversationEvent_MembershipTransitionCommitted:
		transition := payload.MembershipTransitionCommitted
		if transition == nil ||
			transition.PostState == nil ||
			transition.PostState.MembershipEpoch != event.MembershipEpoch ||
			transition.PostState.MlsEpoch != event.MlsEpoch {
			return messaging.ErrFollowerReplayInvalid
		}
		snapshot := transition.PostState
		if current.CurrentSequence > 0 &&
			(current.Kind != authorityConversationKind(snapshot.Kind) ||
				current.OwnerPTID != snapshot.OwnerPtid) {
			return messaging.ErrFollowerReplayInvalid
		}
		next.Kind = authorityConversationKind(snapshot.Kind)
		next.Name = snapshot.Name
		next.OwnerPTID = snapshot.OwnerPtid
		if err := replaceFollowerMembers(
			ctx,
			repository,
			event.ConversationId,
			snapshot.ActiveMembers,
			event.Sequence,
		); err != nil {
			return err
		}
	default:
		if current.CurrentSequence == 0 {
			return messaging.ErrFollowerGap
		}
	}
	if next.Kind == messaging.AuthorityConversationKindUnspecified ||
		next.OwnerPTID == "" {
		return messaging.ErrFollowerReplayInvalid
	}
	if err := repository.AdvanceConversationHead(
		ctx,
		current.CurrentSequence,
		current.CurrentEventHash,
		&next,
	); err != nil {
		return err
	}
	if err := repository.AppendEventReceipt(ctx, &messaging.FollowerEventReceipt{
		ConversationID: event.ConversationId,
		Sequence:       event.Sequence,
		EventID:        event.EventId,
		EventHash:      append([]byte(nil), event.EventHash...),
		PreviousHash:   append([]byte(nil), event.PreviousHash...),
		EventKind:      followerEventKind(event),
		AppliedAt:      now.UTC(),
	}); err != nil {
		return err
	}
	return repository.DeletePendingEvent(ctx, event.ConversationId, event.Sequence)
}

func drainFollowerPending(
	ctx context.Context,
	repository messaging.FollowerRepository,
	conversationID string,
	localStationID string,
	now time.Time,
) error {
	for {
		conversation, err := repository.GetConversation(ctx, conversationID)
		if err != nil {
			return err
		}
		pending, err := repository.ListPendingEvents(ctx, conversationID)
		if err != nil {
			return err
		}
		if len(pending) == 0 {
			return repository.UpdateConversationState(
				ctx,
				conversationID,
				messaging.FollowerConversationStateActive,
				now,
			)
		}
		next := pending[0]
		if next.Sequence != conversation.CurrentSequence+1 {
			return repository.UpdateConversationState(
				ctx,
				conversationID,
				messaging.FollowerConversationStateGapWaitingResync,
				now,
			)
		}
		event := &chat.ConversationEvent{}
		if err := unmarshalDeterministic(next.PublicEventBytes, event); err != nil {
			return messaging.ErrFollowerProjectionConflict
		}
		if err := validateFollowerEvent(event); err != nil {
			return err
		}
		if event.AuthorityStationId != conversation.AuthorityStationID ||
			!bytes.Equal(event.PreviousHash, conversation.CurrentEventHash) {
			if err := repository.UpdateConversationState(
				ctx,
				conversationID,
				messaging.FollowerConversationStateForkProtectedReadOnly,
				now,
			); err != nil {
				return err
			}
			return messaging.ErrFollowerFork
		}
		if err := applyFollowerEvent(
			ctx,
			repository,
			conversation,
			event,
			localStationID,
			now,
		); err != nil {
			return err
		}
	}
}

func replaceFollowerMembers(
	ctx context.Context,
	repository messaging.FollowerRepository,
	conversationID string,
	members []*chat.ConversationAuthorityMember,
	sequence int64,
) error {
	desired := make(map[string]*chat.ConversationAuthorityMember, len(members))
	for _, member := range members {
		if member == nil ||
			member.Ptid == "" ||
			member.HomeStationId == "" ||
			member.Role == "" ||
			desired[member.Ptid] != nil {
			return messaging.ErrFollowerReplayInvalid
		}
		desired[member.Ptid] = member
	}
	if len(desired) == 0 {
		return messaging.ErrFollowerReplayInvalid
	}
	existing, err := repository.ListMembers(ctx, conversationID)
	if err != nil {
		return err
	}
	existingByPTID := make(map[string]messaging.FollowerMember, len(existing))
	for _, member := range existing {
		existingByPTID[member.PTID] = member
		if desired[member.PTID] != nil {
			continue
		}
		member.Active = false
		if member.LeftSequence == 0 {
			member.LeftSequence = sequence
		}
		if err := repository.UpsertMember(ctx, &member); err != nil {
			return err
		}
	}
	ptids := make([]string, 0, len(desired))
	for ptid := range desired {
		ptids = append(ptids, ptid)
	}
	sort.Strings(ptids)
	for _, ptid := range ptids {
		member := desired[ptid]
		joinedSequence := sequence
		if persisted, ok := existingByPTID[ptid]; ok && persisted.Active {
			joinedSequence = persisted.JoinedSequence
		}
		if err := repository.UpsertMember(ctx, &messaging.FollowerMember{
			ConversationID: conversationID,
			PTID:           member.Ptid,
			HomeStationID:  member.HomeStationId,
			Role:           member.Role,
			Active:         true,
			JoinedSequence: joinedSequence,
		}); err != nil {
			return err
		}
	}
	return nil
}

func validateFollowerEvent(event *chat.ConversationEvent) error {
	if event == nil ||
		event.EventId == "" ||
		event.ConversationId == "" ||
		event.Sequence <= 0 ||
		event.CommandId == "" ||
		event.Actor == nil ||
		event.Actor.Ptid == "" ||
		event.Actor.DeviceId == "" ||
		len(event.EventHash) != sha256.Size ||
		(event.Sequence == 1 && len(event.PreviousHash) != 0) ||
		(event.Sequence > 1 && len(event.PreviousHash) != sha256.Size) ||
		event.CommittedAt == nil ||
		event.AuthorityStationId == "" ||
		event.Payload == nil {
		return messaging.ErrFollowerReplayInvalid
	}
	for index, commitment := range event.DeliveryCommitments {
		if len(commitment) != sha256.Size ||
			(index > 0 && bytes.Compare(
				event.DeliveryCommitments[index-1],
				commitment,
			) >= 0) {
			return messaging.ErrFollowerReplayInvalid
		}
	}
	hash, err := hashAuthorityEvent(event)
	if err != nil {
		return err
	}
	if !bytes.Equal(hash, event.EventHash) {
		return messaging.ErrFollowerReplayInvalid
	}
	return nil
}

func isValidInitialCheckpoint(
	event *chat.ConversationEvent,
	targetHomeStationID string,
) bool {
	if event == nil || targetHomeStationID == "" {
		return false
	}
	if created := event.GetConversationCreated(); created != nil {
		if event.Sequence != 1 || len(event.PreviousHash) != 0 {
			return false
		}
		return membersContainHomeStation(created.Members, targetHomeStationID)
	}
	transition := event.GetMembershipTransitionCommitted()
	if transition == nil || transition.PostState == nil {
		return false
	}
	addedAtTarget := false
	for _, change := range transition.Changes {
		if change != nil &&
			change.HomeStationId == targetHomeStationID &&
			(change.Action == chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_ACTOR ||
				change.Action == chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_ADD_DEVICE) {
			addedAtTarget = true
			break
		}
	}
	return addedAtTarget &&
		membersContainHomeStation(
			transition.PostState.ActiveMembers,
			targetHomeStationID,
		)
}

func followerOwnerBinding(
	event *chat.ConversationEvent,
) (string, string, error) {
	var ownerPTID string
	var members []*chat.ConversationAuthorityMember
	if created := event.GetConversationCreated(); created != nil {
		ownerPTID = created.OwnerPtid
		members = created.Members
	} else if transition := event.GetMembershipTransitionCommitted(); transition != nil &&
		transition.PostState != nil {
		ownerPTID = transition.PostState.OwnerPtid
		members = transition.PostState.ActiveMembers
	}
	if ownerPTID == "" {
		return "", "", messaging.ErrFollowerReplayInvalid
	}
	for _, member := range members {
		if member != nil &&
			member.Ptid == ownerPTID &&
			member.Role == "owner" &&
			member.HomeStationId != "" {
			return ownerPTID, member.HomeStationId, nil
		}
	}
	return "", "", messaging.ErrFollowerReplayInvalid
}

func membersContainHomeStation(
	members []*chat.ConversationAuthorityMember,
	homeStationID string,
) bool {
	for _, member := range members {
		if member != nil && member.HomeStationId == homeStationID {
			return true
		}
	}
	return false
}

func followerRequiresReplayCompletion(
	ctx context.Context,
	repository messaging.FollowerRepository,
	conversationID string,
) (bool, error) {
	conversation, err := repository.GetConversation(ctx, conversationID)
	if errors.Is(err, messaging.ErrNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return conversation.State ==
		messaging.FollowerConversationStateGapWaitingResync, nil
}

func followerEventRemovesActorAtHomeStation(
	event *chat.ConversationEvent,
	homeStationID string,
) bool {
	transition := event.GetMembershipTransitionCommitted()
	if transition == nil {
		return false
	}
	for _, change := range transition.Changes {
		if change != nil &&
			change.Action ==
				chat.MessagingMembershipAction_MESSAGING_MEMBERSHIP_ACTION_REMOVE_ACTOR &&
			change.HomeStationId == homeStationID {
			return true
		}
	}
	return false
}

func authorityConversationKind(kind chat.ConversationKind) messaging.AuthorityConversationKind {
	switch kind {
	case chat.ConversationKind_CONVERSATION_KIND_DIRECT:
		return messaging.AuthorityConversationKindDirect
	case chat.ConversationKind_CONVERSATION_KIND_GROUP:
		return messaging.AuthorityConversationKindGroup
	default:
		return messaging.AuthorityConversationKindUnspecified
	}
}

func followerEventKind(event *chat.ConversationEvent) string {
	switch event.Payload.(type) {
	case *chat.ConversationEvent_ConversationCreated:
		return "conversation_created"
	case *chat.ConversationEvent_MembershipTransitionCommitted:
		return "membership_transition_committed"
	case *chat.ConversationEvent_MessageCommitted:
		return "message_committed"
	case *chat.ConversationEvent_MessageEdited:
		return "message_edited"
	case *chat.ConversationEvent_MessageRetracted:
		return "message_retracted"
	case *chat.ConversationEvent_ReactionCommitted:
		return "reaction_committed"
	case *chat.ConversationEvent_MessagePinCommitted:
		return "message_pin_committed"
	case *chat.ConversationEvent_ConversationUpdated:
		return "conversation_updated"
	default:
		return "unknown"
	}
}

func unmarshalDeterministic(data []byte, message proto.Message) error {
	if len(data) == 0 || message == nil {
		return messaging.ErrFollowerReplayInvalid
	}
	if err := (proto.UnmarshalOptions{DiscardUnknown: false}).Unmarshal(data, message); err != nil {
		return err
	}
	canonical, err := proto.MarshalOptions{Deterministic: true}.Marshal(message)
	if err != nil {
		return err
	}
	if !bytes.Equal(canonical, data) {
		return messaging.ErrFollowerReplayInvalid
	}
	return nil
}
