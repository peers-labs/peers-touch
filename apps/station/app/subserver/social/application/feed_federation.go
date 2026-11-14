package application

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strconv"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	authfed "github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	federation "github.com/peers-labs/peers-touch/station/frame/core/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type FeedPull func(context.Context, string, string, *model.ReadFeedRequest) (*model.ReadFeedResponse, error)

// Composition may observe the original authenticated hint and repair path.
// Ordinary builds never inject a fault-capable implementation.
type FeedFederationObservation interface {
	DropNotification(actor, source string, head uint64, frameSHA256 string, now time.Time) bool
	ObserveRepair(actor, source string, afterSequence, verifiedHead uint64,
		events, threads, responseBytes int, applied bool, now time.Time)
}

func (s *FeedLogService) SetFederationObservation(observer FeedFederationObservation) {
	s.federationObservation = observer
}

func (s *FeedLogService) ConfigureFederation(signer delivery.Signer, pull FeedPull) error {
	if signer == nil || pull == nil {
		return domain.ErrFeedInvalid
	}
	s.signer, s.pull = signer, pull
	return nil
}

func (s *FeedLogService) ChangeSubscription(ctx context.Context, tx delivery.Transaction,
	subscriber, author string, enabled bool) error {
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, subscriber)
	if err != nil {
		return err
	}
	if home != s.localStation {
		return domain.ErrFeedWriter
	}
	authorHome, err := s.actors.ResolveActorHomeStationPeerID(ctx, author)
	if err != nil {
		return err
	}
	row, duplicate, err := s.store.SetSubscriptionTx(ctx, tx.DB(), author, subscriber,
		authorHome, home, enabled, 0)
	if err != nil || duplicate || authorHome == home {
		return err
	}
	return s.enqueue(ctx, tx, authorHome, delivery.PayloadKindSocialPublicFeedSubscription,
		&model.FeedSubscription{AuthorPtid: author, ChainId: row.ChainID,
			SubscriberPtid: subscriber, Enabled: enabled, Revision: row.Revision})
}

func (s *FeedLogService) RegisterReceivers(registry *delivery.Registry) error {
	if err := delivery.RegisterProtoReceiver(registry, delivery.PayloadKindSocialPublicFeedNotification,
		func() *model.FeedNotification { return &model.FeedNotification{} }, s.receiveNotification); err != nil {
		return err
	}
	if err := delivery.RegisterProtoReceiver(registry, delivery.PayloadKindSocialPublicFeedSubscription,
		func() *model.FeedSubscription { return &model.FeedSubscription{} }, s.receiveSubscription); err != nil {
		return err
	}
	return delivery.RegisterProtoReceiver(registry, delivery.PayloadKindSocialPublicFeedInteraction,
		func() *model.FeedInteraction { return &model.FeedInteraction{} }, s.receiveInteraction)
}

func (s *FeedLogService) receiveNotification(ctx context.Context, tx delivery.Transaction,
	message *model.FeedNotification, frame *delivery.Frame) (delivery.Result, error) {
	if message.Head == nil {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, message.Head.ActorPtid)
	if err != nil {
		return delivery.Result{}, err
	}
	if home != frame.SourceStationPeerId {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	if s.federationObservation != nil {
		frameHash, hashErr := delivery.CanonicalFrameSHA256(frame)
		if hashErr != nil {
			return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
		}
		if s.federationObservation.DropNotification(message.Head.ActorPtid, home,
			message.Head.Sequence, hex.EncodeToString(frameHash), s.now()) {
			return delivery.AcceptedResult(), nil
		}
	}
	if err := s.store.MarkFeedDirty(ctx, tx.DB(), message.Head, home, s.localStation); err != nil {
		return feedDeliveryError(err)
	}
	return delivery.AcceptedResult(), nil
}

func (s *FeedLogService) receiveSubscription(ctx context.Context, tx delivery.Transaction,
	message *model.FeedSubscription, frame *delivery.Frame) (delivery.Result, error) {
	if message.ChainId != domain.PublicFeedChainID || message.Revision == 0 {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	authorHome, err := s.actors.ResolveActorHomeStationPeerID(ctx, message.AuthorPtid)
	if err != nil {
		return delivery.Result{}, err
	}
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, message.SubscriberPtid)
	if err != nil {
		return delivery.Result{}, err
	}
	if authorHome != s.localStation || home != frame.SourceStationPeerId {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	_, duplicate, err := s.store.SetSubscriptionTx(ctx, tx.DB(), message.AuthorPtid,
		message.SubscriberPtid, authorHome, home, message.Enabled, message.Revision)
	if err != nil {
		return feedDeliveryError(err)
	}
	if duplicate {
		return delivery.DuplicateResult(), nil
	}
	return delivery.AcceptedResult(), nil
}

func (s *FeedLogService) receiveInteraction(ctx context.Context, tx delivery.Transaction,
	message *model.FeedInteraction, frame *delivery.Frame) (delivery.Result, error) {
	if message.Event == nil || message.Event.Statement == nil {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	actor := message.Event.Statement.ActorPtid
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, actor)
	if err != nil {
		return delivery.Result{}, err
	}
	bundle := &model.FeedBundle{Genesis: message.Genesis, WriterGrant: message.WriterGrant,
		Events: []*model.FeedEvent{message.Event}}
	if _, err := s.authenticate(ctx, tx, bundle, actor, home, false); err != nil {
		return feedDeliveryError(err)
	}
	if err := domain.VerifyFeedEvent(message.Event, message.WriterGrant); err != nil {
		return feedDeliveryError(err)
	}
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(message.Event.Payload, payload); err != nil {
		return feedDeliveryError(err)
	}
	target, err := domain.FeedInteractionTarget(payload)
	if err != nil {
		return feedDeliveryError(err)
	}
	targetHome, _, err := domain.FeedTargetPost(target)
	if err != nil || (frame.SourceStationPeerId != home && frame.SourceStationPeerId != targetHome) ||
		(frame.SourceStationPeerId == home && home != targetHome && targetHome != s.localStation) {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	if err := tx.DB().SavePoint("feed_received_interaction").Error; err != nil {
		return delivery.Result{}, err
	}
	duplicate, err := s.projector.
		StoreInteraction(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), message, home, true)
	if err != nil {
		if rollback := tx.DB().RollbackTo("feed_received_interaction").Error; rollback != nil {
			return delivery.Result{}, rollback
		}
		if errors.Is(err, domain.ErrFeedFork) {
			if quarantine := s.store.QuarantineInteraction(ctx, tx.DB(), actor, message.Event.Statement.ChainId); quarantine != nil {
				return delivery.Result{}, quarantine
			}
		}
		return feedDeliveryError(err)
	}
	if duplicate {
		return delivery.DuplicateResult(), nil
	}
	return delivery.AcceptedResult(), nil
}

func feedDeliveryError(err error) (delivery.Result, error) {
	if errors.Is(err, domain.ErrFeedFork) {
		return delivery.PayloadHashConflictResult(), nil
	}
	if errors.Is(err, domain.ErrFeedInvalid) || errors.Is(err, domain.ErrFeedSignature) ||
		errors.Is(err, domain.ErrFeedWriter) {
		return delivery.TerminalResult(delivery.FrameErrorInvalidFrame), nil
	}
	return delivery.Result{}, err
}

func (s *FeedLogService) enqueue(ctx context.Context, tx delivery.Transaction, target string,
	kind delivery.PayloadKind, message proto.Message) error {
	_, err := s.enqueueRevision(ctx, tx, target, kind, message, 0)
	return err
}

func (s *FeedLogService) enqueueRevision(ctx context.Context, tx delivery.Transaction, target string,
	kind delivery.PayloadKind, message proto.Message, revision uint64) (string, error) {
	if s.signer == nil {
		return "", domain.ErrFeedInvalid
	}
	wire, err := signedlog.Canonical(message)
	if err != nil {
		return "", err
	}
	// Include target and kind so one receipt can be independently delivered
	// to the target owner and to every subscribed Station.
	digest := sha256.Sum256(append([]byte(target+"\x00"+strconv.Itoa(int(kind))+"\x00"+strconv.FormatUint(revision, 10)+"\x00"), wire...))
	identity := hex.EncodeToString(digest[:])
	now := s.now().UTC()
	frame := &delivery.Frame{FormatVersion: 1, FrameId: "social-feed:" + identity,
		SourceStationPeerId: s.localStation, TargetStationPeerId: target,
		IdempotencyKey: "social-feed:" + identity, PayloadKind: kind, PayloadId: identity,
		OrderingKey: "social-feed:" + identity, OpaquePayload: wire,
		IssuedAt: timestamppb.New(now), ExpiresAt: timestamppb.New(now.Add(24 * time.Hour))}
	if err := delivery.SignFrame(ctx, frame, delivery.DefaultFramePolicy(target), s.signer); err != nil {
		return "", err
	}
	_, err = tx.Outbox().Enqueue(ctx, frame, now)
	return frame.FrameId, err
}

func (s *FeedLogService) ReadFederated(ctx context.Context, claims *authfed.VerifiedClaims,
	request *model.ReadFeedRequest, canonical []byte) (*model.ReadFeedResponse, error) {
	if claims == nil || request == nil || claims.Scope != federation.SocialPublicFeedReadScope ||
		claims.Issuer == "" || claims.Subject == "" || claims.Audience != s.localStation {
		return nil, domain.ErrFeedWriter
	}
	wire, err := signedlog.Canonical(request)
	if err != nil || !bytes.Equal(wire, canonical) {
		return nil, domain.ErrFeedInvalid
	}
	digest := sha256.Sum256(wire)
	expected := map[string]string{federation.ClaimSourceStationPeerID: s.localStation,
		federation.ClaimTargetStationPeerID: claims.Issuer, federation.ClaimActorPTID: claims.Subject,
		federation.ClaimFeedAuthorPTID: request.ActorPtid, federation.ClaimFeedChainID: request.ChainId,
		federation.ClaimCanonicalRequestSHA256: hex.EncodeToString(digest[:])}
	if len(claims.Custom) != len(expected) {
		return nil, domain.ErrFeedWriter
	}
	for key, value := range expected {
		if claims.Custom[key] != value {
			return nil, domain.ErrFeedWriter
		}
	}
	viewerHome, err := s.actors.ResolveActorHomeStationPeerID(ctx, claims.Subject)
	if err != nil {
		return nil, err
	}
	authorHome, err := s.actors.ResolveActorHomeStationPeerID(ctx, request.ActorPtid)
	if err != nil {
		return nil, err
	}
	if viewerHome != claims.Issuer || authorHome != s.localStation {
		return nil, domain.ErrFeedWriter
	}
	var response *model.ReadFeedResponse
	err = s.store.Execute(ctx, func(tx delivery.Transaction) error {
		if err := NewPublicReadPort(infrastructure.NewRepos(tx.DB())).
			AuthorizeFeed(ctx, claims.Subject, request.ActorPtid); err != nil {
			return err
		}
		if !request.ExplicitPublicRead {
			if err := s.store.AuthorizeSubscription(ctx, tx.DB(), request.ActorPtid, claims.Subject, claims.Issuer); err != nil {
				return err
			}
		}
		var err error
		response, err = s.store.Read(ctx, tx.DB(), request)
		if err != nil {
			return err
		}
		root, err := s.actors.ResolveRetainedActorIdentityPublicKey(ctx, tx, request.ActorPtid)
		if err != nil {
			return err
		}
		if err := domain.VerifyFeedAuthorization(response.Bundle.Genesis, response.Bundle.WriterGrant, request.ActorPtid, root); err != nil {
			return err
		}
		return s.verifyThreadResponse(ctx, tx, response)
	})
	return response, err
}

// ProcessFederation runs one bounded fanout page and at most 32 pull pages.
// Periodic pulls repair missed/expired notifications without trusting their
// advertised sequence as an authenticated chain head.
func (s *FeedLogService) ProcessFederation(ctx context.Context) error {
	if s.pull == nil {
		return domain.ErrFeedInvalid
	}
	var firstError error
	changes, err := s.store.PendingGraphChanges(ctx, s.localStation)
	if err != nil {
		firstError = err
	}
	for _, change := range changes {
		if err := s.store.Execute(ctx, func(tx delivery.Transaction) error {
			return s.store.ReconcileGraphChange(ctx, tx, change, func(enabled bool) error {
				return s.ChangeSubscription(ctx, tx, change.SubscriberPTID, change.AuthorPTID, enabled)
			})
		}); err != nil && firstError == nil {
			firstError = err
		}
	}
	if _, err := s.store.FanoutOne(ctx, s.localStation, func(ctx context.Context, tx delivery.Transaction,
		target string, notification *model.FeedNotification) error {
		return s.enqueue(ctx, tx, target, delivery.PayloadKindSocialPublicFeedNotification, notification)
	}); err != nil {
		firstError = err
	}
	sendInteraction := func(ctx context.Context, tx delivery.Transaction, target string, receipt *model.FeedInteraction) error {
		return s.enqueue(ctx, tx, target, delivery.PayloadKindSocialPublicFeedInteraction, receipt)
	}
	if err := s.store.ProcessInteractions(ctx, s.projector, s.verifyStoredInteraction, s.forwardInteraction, s.returnPollAdmission); err != nil {
		if firstError == nil {
			firstError = err
		}
	}
	if err := s.store.FanoutInteractionOne(ctx, s.localStation, s.verifyStoredInteraction, sendInteraction); err != nil {
		if firstError == nil {
			firstError = err
		}
	}
	rows, err := s.store.PendingSync(ctx, s.localStation, s.now())
	if err != nil {
		return err
	}
	for _, row := range rows {
		sequence, readErr := s.store.LocalSequence(ctx, row.AuthorPTID)
		var response *model.ReadFeedResponse
		if readErr == nil {
			pullContext, cancel := context.WithTimeout(ctx, 5*time.Second)
			response, readErr = s.pull(pullContext, row.AuthorStation, row.SubscriberPTID,
				&model.ReadFeedRequest{ActorPtid: row.AuthorPTID, ChainId: row.ChainID, AfterSequence: sequence, Limit: 32,
					IncludeThread: true, AfterThreadCursor: row.ThreadCursor})
			cancel()
		}
		if readErr == nil {
			if response == nil || response.Bundle == nil || response.Head == nil ||
				response.Head.ActorPtid != row.AuthorPTID || response.Head.ChainId != row.ChainID ||
				response.Head.Sequence < sequence || len(response.Head.EventHash) != 32 {
				readErr = domain.ErrFeedRollback
			} else if len(response.Bundle.Events) > 0 {
				readErr = s.Import(ctx, row.AuthorPTID, row.AuthorStation, response.Bundle)
			}
			if readErr == nil {
				readErr = s.verifyPulledHead(ctx, row.AuthorPTID, response)
			}
			if readErr == nil {
				readErr = s.importThread(ctx, row.AuthorPTID, row.AuthorStation, row.ThreadCursor, response,
					func(ctx context.Context, tx delivery.Transaction, cursor uint64) error {
						return s.store.AdvanceThreadCursor(ctx, tx.DB(), row, cursor)
					})
			}
		}
		if s.federationObservation != nil && response != nil {
			events := 0
			if response.Bundle != nil {
				events = len(response.Bundle.Events)
			}
			verifiedHead, verifyErr := s.store.LocalSequence(ctx, row.AuthorPTID)
			s.federationObservation.ObserveRepair(row.AuthorPTID, row.AuthorStation,
				sequence, verifiedHead, events, len(response.ThreadEntries), proto.Size(response),
				readErr == nil && verifyErr == nil, s.now())
		}
		more := response != nil && (response.HasMore || response.ThreadHasMore)
		if finishErr := s.store.FinishSync(ctx, row, readErr == nil, more); finishErr != nil && readErr == nil {
			readErr = finishErr
		}
		if readErr != nil && firstError == nil {
			firstError = readErr
		}
	}
	return firstError
}

func (s *FeedLogService) verifyStoredInteraction(ctx context.Context, tx delivery.Transaction,
	receipt *model.FeedInteraction, storedHome string) error {
	if receipt == nil || receipt.Event == nil || receipt.Event.Statement == nil {
		return domain.ErrFeedInvalid
	}
	actor := receipt.Event.Statement.ActorPtid
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, actor)
	if err != nil {
		return err
	}
	if home != storedHome {
		return domain.ErrFeedWriter
	}
	bundle := &model.FeedBundle{Genesis: receipt.Genesis, WriterGrant: receipt.WriterGrant,
		Events: []*model.FeedEvent{receipt.Event}}
	if _, err := s.authenticate(ctx, tx, bundle, actor, home, false); err != nil {
		return err
	}
	if err := domain.VerifyFeedEvent(receipt.Event, receipt.WriterGrant); err != nil {
		return err
	}
	return s.verifyPollAdmission(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), receipt)
}

func (s *FeedLogService) verifyPulledHead(ctx context.Context, actor string, response *model.ReadFeedResponse) error {
	return s.store.Execute(ctx, func(tx delivery.Transaction) error {
		root, err := s.actors.ResolveRetainedActorIdentityPublicKey(ctx, tx, actor)
		if err != nil {
			return err
		}
		if err := domain.VerifyFeedAuthorization(response.Bundle.Genesis, response.Bundle.WriterGrant, actor, root); err != nil {
			return err
		}
		local, err := s.store.Read(ctx, tx.DB(), &model.ReadFeedRequest{ActorPtid: actor, ChainId: domain.PublicFeedChainID, Limit: 1})
		if err != nil {
			return err
		}
		if !proto.Equal(local.Bundle.Genesis, response.Bundle.Genesis) ||
			!proto.Equal(local.Bundle.WriterGrant, response.Bundle.WriterGrant) {
			return domain.ErrFeedWriter
		}
		if response.Head.Sequence < local.Head.Sequence {
			return domain.ErrFeedRollback
		}
		if response.HasMore {
			if len(response.Bundle.Events) == 0 || response.Head.Sequence <= local.Head.Sequence {
				return domain.ErrFeedInvalid
			}
			return nil
		}
		if response.Head.Sequence != local.Head.Sequence {
			return domain.ErrFeedGap
		}
		if !bytes.Equal(response.Head.EventHash, local.Head.EventHash) {
			return domain.ErrFeedFork
		}
		return nil
	})
}
