package application

import (
	"bytes"
	"context"
	"errors"

	"github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/federation/delivery"
	"github.com/peers-labs/peers-touch/station/frame/core/signedlog"
	"github.com/peers-labs/peers-touch/station/frame/touch/model"
	"github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *FeedLogService) ConfigurePollAuthority(signer PrivateContentStationSigner,
	verify func(context.Context, delivery.Transaction, string, string, []byte, []byte) error) error {
	if signer == nil || verify == nil || s.projector == nil {
		return domain.ErrFeedInvalid
	}
	s.pollSigner, s.verifyPollStation = signer, verify
	s.projector.SetPollAuthority(s.applyPollAuthority)
	return nil
}

// Only the author's Home decides admission, under the original parent lock.
func (s *FeedLogService) applyPollAuthority(ctx context.Context, tx *gorm.DB, receipt *model.FeedInteraction) error {
	payload := &model.FeedPayload{}
	if err := signedlog.Decode(receipt.Event.Payload, payload); err != nil {
		return err
	}
	ballot := payload.GetPollBallot()
	if ballot == nil {
		if receipt.PollAdmission != nil {
			return domain.ErrFeedInvalid
		}
		return nil
	}
	if err := attachRetainedPollAdmission(tx, receipt); err != nil {
		return err
	}
	home, _, err := domain.FeedTargetPost(ballot.TargetPostRef)
	if err != nil {
		return err
	}
	if receipt.PollAdmission != nil {
		return s.verifyPollAdmission(ctx, tx, receipt)
	}
	if home != s.localStation {
		return nil
	}
	transaction := infrastructure.FeedTransactionFromContext(ctx)
	if s.pollSigner == nil || transaction == nil {
		return domain.ErrFeedInvalid
	}
	definition, object, err := infrastructure.FeedPollDefinitionAt(ctx, tx, ballot.TargetPostRef)
	if err != nil {
		return err
	}
	if err := s.verifyPollDefinitionOwner(ctx, tx, object); err != nil {
		return err
	}
	var post db.SocialPublicPost
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", object.LocalID).Take(&post).Error; err != nil {
		return err
	}
	// An exact concurrent delivery reuses the original signed decision.
	if err := attachRetainedPollAdmission(tx, receipt); err != nil {
		return err
	}
	if receipt.PollAdmission != nil {
		return s.verifyPollAdmission(ctx, tx, receipt)
	}
	at := s.now().UnixMilli()
	result, err := domain.DecideFeedPollBallot(ballot, definition, at)
	if err != nil {
		return err
	}
	read, err := NewPublicReadPort(infrastructure.NewRepos(tx)).
		Read(ctx, receipt.Event.Statement.ActorPtid, []uint64{object.LocalID}, nil)
	if err != nil {
		return err
	}
	if post.DeletedAt != nil || read.Posts[object.LocalID] == nil {
		result = model.FeedPollAdmissionResult_FEED_POLL_ADMISSION_RESULT_TARGET_UNAVAILABLE
	}
	hash, err := domain.FeedEventHash(receipt.Event)
	if err != nil {
		return err
	}
	definitionHash, err := domain.FeedPollDefinitionHash(definition)
	if err != nil {
		return err
	}
	keyID, err := s.pollSigner.SigningKeyIDInTransaction(ctx, transaction)
	if err != nil {
		return err
	}
	admission := &model.FeedPollAdmission{Statement: &model.FeedPollAdmissionStatement{
		FormatVersion: 1, HomeStationPeerId: home, TargetPostRef: ballot.TargetPostRef,
		EventHash: hash, DefinitionHash: definitionHash, AcceptedAtUnixMs: at,
		Result: result, SigningKeyId: keyID,
	}}
	wire, err := domain.FeedPollAdmissionSigningBytes(admission.Statement)
	if err != nil {
		return err
	}
	admission.StationSignature, err = s.pollSigner.SignInTransaction(ctx, transaction, keyID, wire)
	if err != nil {
		return err
	}
	if err := domain.ValidateFeedPollAdmission(admission, receipt.Event, definition); err != nil {
		return err
	}
	receipt.PollAdmission = admission
	return nil
}

func attachRetainedPollAdmission(tx *gorm.DB, receipt *model.FeedInteraction) error {
	statement := receipt.Event.Statement
	var retained infrastructure.FeedInteractionRecord
	err := tx.Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
		statement.ActorPtid, statement.ChainId, statement.Sequence).Take(&retained).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	base, err := infrastructure.FeedInteractionCanonicalBytes(receipt)
	if err != nil || !bytes.Equal(base, retained.Interaction) {
		return domain.ErrFeedFork
	}
	if len(retained.PollAdmission) == 0 {
		return nil
	}
	known := &model.FeedPollAdmission{}
	if signedlog.Decode(retained.PollAdmission, known) != nil {
		return domain.ErrFeedInvalid
	}
	if receipt.PollAdmission != nil {
		wire, err := signedlog.Canonical(receipt.PollAdmission)
		if err != nil || !bytes.Equal(wire, retained.PollAdmission) {
			return domain.ErrFeedInvalid
		}
	}
	receipt.PollAdmission = known
	return nil
}

func (s *FeedLogService) verifyPollAdmission(ctx context.Context, tx *gorm.DB, receipt *model.FeedInteraction) error {
	admission := receipt.PollAdmission
	if admission == nil {
		return nil
	}
	if admission.Statement == nil {
		return domain.ErrFeedInvalid
	}
	definition, object, err := infrastructure.FeedPollDefinitionAt(ctx, tx, admission.Statement.TargetPostRef)
	if err != nil {
		return err
	}
	if err := s.verifyPollDefinitionOwner(ctx, tx, object); err != nil {
		return err
	}
	if err := domain.ValidateFeedPollAdmission(admission, receipt.Event, definition); err != nil {
		return err
	}
	wire, err := domain.FeedPollAdmissionSigningBytes(admission.Statement)
	if err != nil {
		return err
	}
	transaction := infrastructure.FeedTransactionFromContext(ctx)
	if transaction == nil || s.verifyPollStation == nil {
		return domain.ErrFeedSignature
	}
	if err := s.verifyPollStation(ctx, transaction, admission.Statement.HomeStationPeerId,
		admission.Statement.SigningKeyId, wire, admission.StationSignature); err != nil {
		return domain.ErrFeedSignature
	}
	return nil
}

// A derived creation index and device grant cannot establish the author's root.
func (s *FeedLogService) verifyPollDefinitionOwner(ctx context.Context, tx *gorm.DB, object *infrastructure.FeedObjectRecord) error {
	transaction := infrastructure.FeedTransactionFromContext(ctx)
	if transaction == nil || object == nil {
		return domain.ErrFeedInvalid
	}
	home, err := s.actors.ResolveActorHomeStationPeerID(ctx, object.ActorPTID)
	if err != nil {
		return err
	}
	if home != object.HomeStation {
		return domain.ErrFeedWriter
	}
	root, err := s.actors.ResolveRetainedActorIdentityPublicKey(ctx, transaction, object.ActorPTID)
	if err != nil {
		return err
	}
	response, err := s.store.Read(ctx, tx, &model.ReadFeedRequest{
		ActorPtid: object.ActorPTID, ChainId: domain.PublicFeedChainID, Limit: 1,
	})
	if err != nil {
		return err
	}
	return domain.VerifyFeedAuthorization(response.Bundle.Genesis, response.Bundle.WriterGrant, object.ActorPTID, root)
}

func (s *FeedLogService) pollAdmissionsFor(ctx context.Context, tx delivery.Transaction, bundle *model.FeedBundle) ([]*model.FeedPollAdmission, error) {
	var admissions []*model.FeedPollAdmission
	for _, event := range bundle.Events {
		if event == nil || event.Statement == nil {
			return nil, domain.ErrFeedInvalid
		}
		if event.Statement.Kind != model.FeedEventKind_FEED_EVENT_KIND_POLL_BALLOT_SET {
			continue
		}
		var row infrastructure.FeedInteractionRecord
		if err := tx.DB().Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
			event.Statement.ActorPtid, event.Statement.ChainId, event.Statement.Sequence).Take(&row).Error; err != nil {
			return nil, err
		}
		expected := &model.FeedInteraction{Genesis: bundle.Genesis, WriterGrant: bundle.WriterGrant, Event: event}
		wire, err := infrastructure.FeedInteractionCanonicalBytes(expected)
		if err != nil || !bytes.Equal(wire, row.Interaction) {
			return nil, domain.ErrFeedInvalid
		}
		if len(row.PollAdmission) == 0 {
			continue
		}
		expected.PollAdmission = &model.FeedPollAdmission{}
		if err := signedlog.Decode(row.PollAdmission, expected.PollAdmission); err != nil {
			return nil, err
		}
		if err := s.verifyPollAdmission(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), expected); err != nil {
			return nil, err
		}
		admissions = append(admissions, expected.PollAdmission)
	}
	return admissions, nil
}

// Return ACK/expiry remains independent after forwarding and projection finish.
func (s *FeedLogService) returnPollAdmission(ctx context.Context, tx delivery.Transaction, target string, receipt *model.FeedInteraction) error {
	if receipt == nil || receipt.Event == nil || receipt.Event.Statement == nil ||
		receipt.PollAdmission == nil {
		return domain.ErrFeedInvalid
	}
	statement := receipt.Event.Statement
	var row infrastructure.FeedInteractionRecord
	if err := tx.DB().Where("actor_ptid = ? AND chain_id = ? AND sequence = ?",
		statement.ActorPtid, statement.ChainId, statement.Sequence).Take(&row).Error; err != nil {
		return err
	}
	if row.TargetStation != s.localStation || row.HomeStation != target ||
		target == s.localStation || !row.AdmissionReturnRequired {
		return domain.ErrFeedWriter
	}
	base, err := infrastructure.FeedInteractionCanonicalBytes(receipt)
	if err != nil || !bytes.Equal(base, row.Interaction) {
		return domain.ErrFeedInvalid
	}
	supplement, err := signedlog.Canonical(receipt.PollAdmission)
	if err != nil || !bytes.Equal(supplement, row.PollAdmission) {
		return domain.ErrFeedInvalid
	}
	if err := s.verifyPollAdmission(infrastructure.FeedTransactionContext(ctx, tx), tx.DB(), receipt); err != nil {
		return err
	}
	if row.AdmissionReturned {
		return nil
	}
	if row.AdmissionFrameID != "" {
		reader, err := delivery.NewGORMRepository(tx.DB(), delivery.SystemClock{})
		if err != nil {
			return err
		}
		statuses, err := reader.ReadOutboxStatuses(ctx, []string{row.AdmissionFrameID}, s.now())
		if err != nil {
			return err
		}
		if len(statuses) != 1 {
			return domain.ErrFeedInvalid
		}
		switch statuses[0].State {
		case delivery.OutboxStateDelivered:
			return tx.DB().Model(&row).Update("admission_returned", true).Error
		case delivery.OutboxStateExpired:
			// Renew transport identity, never the admission time/signature.
		case delivery.OutboxStatePending, delivery.OutboxStateLeased, delivery.OutboxStateRetryWait:
			return nil
		default:
			return domain.ErrFeedInvalid
		}
	}
	if row.AdmissionDeliveryRevision == ^uint64(0) {
		return domain.ErrFeedInvalid
	}
	row.AdmissionDeliveryRevision++
	frameID, err := s.enqueueRevision(ctx, tx, target, delivery.PayloadKindSocialPublicFeedInteraction,
		receipt, row.AdmissionDeliveryRevision)
	if err != nil {
		return err
	}
	return tx.DB().Model(&row).Updates(map[string]interface{}{
		"admission_frame_id": frameID, "admission_delivery_revision": row.AdmissionDeliveryRevision,
	}).Error
}
