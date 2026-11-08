package application

import (
	"bytes"
	"context"
	"errors"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
)

// FeedActorIdentity is implemented by the Actor Identity owner; Social never
// reads or writes identity-key tables.
type FeedActorIdentity interface {
	ResolveActorHomeStationPeerID(context.Context, string) (string, error)
	ResolveRetainedActorIdentityPublicKey(context.Context, delivery.Transaction, string) ([]byte, error)
	ResolveVerifiedActorDeviceSigningKey(context.Context, delivery.Transaction, string, string, string, string) (*model.VerifiedActorDeviceSigningKey, error)
}

type FeedLogService struct {
	store             *infrastructure.FeedLogStore
	actors            FeedActorIdentity
	localStation      string
	apply             infrastructure.FeedApply
	now               func() time.Time
	signer            delivery.Signer
	pull              FeedPull
	writePolicy       func(context.Context, delivery.Transaction, *model.FeedEvent) error
	projector         *infrastructure.FeedProjector
	pollSigner        PrivateContentStationSigner
	verifyPollStation func(context.Context, delivery.Transaction, string, string, []byte, []byte) error
}

func (s *FeedLogService) SetProjector(projector *infrastructure.FeedProjector) {
	if projector != nil {
		s.projector = projector
		s.apply = projector.Apply
	}
}
func (s *FeedLogService) SetWritePolicy(policy func(context.Context, delivery.Transaction, *model.FeedEvent) error) {
	s.writePolicy = policy
}

func NewFeedLogService(store *infrastructure.FeedLogStore, actors FeedActorIdentity,
	localStation string, apply infrastructure.FeedApply) (*FeedLogService, error) {
	if store == nil || actors == nil || localStation == "" || apply == nil {
		return nil, domain.ErrFeedInvalid
	}
	return &FeedLogService{store: store, actors: actors, localStation: localStation,
		apply: apply, now: time.Now, projector: infrastructure.NewFeedProjector(localStation)}, nil
}

// Submit authenticates the API actor and device before accepting exact signed
// bytes. A committed fork quarantine is returned as a rejection to the caller.
func (s *FeedLogService) Submit(ctx context.Context, actorPTID, deviceID string,
	request *model.SubmitFeedEventRequest) (*model.SubmitFeedEventResponse, error) {
	if request == nil || request.Bundle == nil || request.Bundle.WriterGrant == nil ||
		request.Bundle.WriterGrant.Statement == nil || actorPTID == "" ||
		deviceID != request.Bundle.WriterGrant.Statement.DeviceId {
		return nil, domain.ErrFeedWriter
	}
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, actorPTID)
	if err != nil {
		return nil, err
	}
	if home != s.localStation {
		return nil, domain.ErrFeedWriter
	}
	var response *model.SubmitFeedEventResponse
	var rejection error
	err = s.store.Execute(ctx, func(tx delivery.Transaction) error {
		root, err := s.authenticate(ctx, tx, request.Bundle, actorPTID, home, true)
		if err != nil {
			return err
		}
		// Validate signatures before policy reads. A signature authenticates
		// intent; the original Social read owner still governs its targets.
		for _, event := range request.Bundle.Events {
			if err := domain.VerifyFeedEvent(event, request.Bundle.WriterGrant); err != nil {
				return err
			}
			if s.writePolicy != nil {
				if err := s.writePolicy(ctx, tx, event); err != nil {
					return err
				}
			}
		}
		head, duplicate, err := s.store.AppendTx(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), request.Bundle,
			actorPTID, home, root, s.apply, true)
		if errors.Is(err, domain.ErrFeedFork) {
			rejection = err
			return nil
		}
		if err != nil {
			return err
		}
		admissions, err := s.pollAdmissionsFor(ctx, tx, request.Bundle)
		if err != nil {
			return err
		}
		response = &model.SubmitFeedEventResponse{Head: head, Duplicate: duplicate, PollAdmissions: admissions}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if rejection != nil {
		return nil, rejection
	}
	return response, nil
}

// Import appends an authorized bounded pull. Authentication of the peer and
// subscription belongs to the delivery/pull adapter, outside this transaction.
func (s *FeedLogService) Import(ctx context.Context, actorPTID, sourceStation string,
	bundle *model.FeedBundle) error {
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, actorPTID)
	if err != nil {
		return err
	}
	if home != sourceStation || home == s.localStation {
		return domain.ErrFeedWriter
	}
	var rejection error
	err = s.store.Execute(ctx, func(tx delivery.Transaction) error {
		root, err := s.authenticate(ctx, tx, bundle, actorPTID, home, false)
		if err != nil {
			return err
		}
		_, _, err = s.store.AppendTx(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), bundle, actorPTID, home, root, s.apply, false)
		if errors.Is(err, domain.ErrFeedFork) {
			rejection = err
			return nil
		}
		return err
	})
	if err != nil {
		return err
	}
	return rejection
}

func (s *FeedLogService) Read(ctx context.Context, request *model.ReadFeedRequest) (*model.ReadFeedResponse, error) {
	return s.read(ctx, request, "")
}

func (s *FeedLogService) read(ctx context.Context, request *model.ReadFeedRequest, viewer string) (*model.ReadFeedResponse, error) {
	if request == nil {
		return nil, domain.ErrFeedInvalid
	}
	var response *model.ReadFeedResponse
	err := s.store.Execute(ctx, func(tx delivery.Transaction) error {
		if viewer != "" {
			if err := NewPublicReadPort(infrastructure.NewRepos(tx.DB())).
				AuthorizeFeed(ctx, viewer, request.ActorPtid); err != nil {
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
		if err := domain.VerifyFeedAuthorization(response.Bundle.Genesis,
			response.Bundle.WriterGrant, request.ActorPtid, root); err != nil {
			return err
		}
		return s.verifyThreadResponse(ctx, tx, response)
	})
	if err != nil {
		return nil, err
	}
	return response, nil
}

func (s *FeedLogService) authenticate(ctx context.Context, tx delivery.Transaction,
	bundle *model.FeedBundle, actorPTID, home string, newLocalWrite bool) ([]byte, error) {
	if bundle == nil || bundle.WriterGrant == nil || bundle.WriterGrant.Statement == nil ||
		len(bundle.Events) == 0 || len(bundle.Events) > 64 {
		return nil, domain.ErrFeedInvalid
	}
	grant := bundle.WriterGrant.Statement
	key, err := s.actors.ResolveVerifiedActorDeviceSigningKey(ctx, tx, actorPTID,
		home, grant.DeviceId, grant.SigningKeyId)
	if err != nil {
		return nil, err
	}
	if key == nil || key.ActorPtid != actorPTID || key.ActorDeviceId != grant.DeviceId ||
		key.HomeStationPeerId != home || key.SigningKeyId != grant.SigningKeyId ||
		!bytes.Equal(key.Ed25519PublicKey, grant.DevicePublicKey) ||
		key.VerificationSource == model.ActorSigningKeyVerificationSource_ACTOR_SIGNING_KEY_VERIFICATION_SOURCE_UNSPECIFIED ||
		(newLocalWrite && key.RevokedAtUnixMs != 0) {
		return nil, domain.ErrFeedWriter
	}
	now := s.now().UnixMilli()
	for _, event := range bundle.Events {
		if event == nil || event.Statement == nil {
			return nil, domain.ErrFeedInvalid
		}
		created := event.Statement.CreatedAtUnixMs
		if created < key.ValidFromUnixMs ||
			(key.RevokedAtUnixMs != 0 && created >= key.RevokedAtUnixMs) ||
			(newLocalWrite && created > now+30_000) {
			return nil, domain.ErrFeedWriter
		}
	}
	root, err := s.actors.ResolveRetainedActorIdentityPublicKey(ctx, tx, actorPTID)
	if err != nil {
		return nil, err
	}
	if err := domain.VerifyFeedAuthorization(bundle.Genesis, bundle.WriterGrant, actorPTID, root); err != nil {
		return nil, err
	}
	return root, nil
}
