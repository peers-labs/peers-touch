package application

import (
	"context"
	"errors"
	"time"

	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (s *Service) clearPendingDelivery(sc *scope, claim *rows.Claim) error {
	if sc.offer.SessionID != "" {
		if err := session.DeletePendingDeviceSession(sc.tx, sc.offer.SessionID, claim.AccessAttemptID); err != nil {
			return err
		}
	}
	sc.offer.SessionID = ""
	sc.offer.DeliveryID = ""
	sc.offer.CredentialEnvelope = nil
	sc.offer.CredentialSignature = nil
	sc.offer.CredentialAuthority = nil
	sc.offer.CredentialDigest = nil
	sc.offer.CredentialRevision = 0
	return nil
}

func (s *Service) finish(sc *scope, state pb.DeviceLinkState, reason pb.DeviceLinkErrorCode) error {
	if link.Terminal(sc.offer.State) {
		return nil
	}
	var claims []rows.Claim
	if err := sc.tx.Where("offer_id = ?", sc.offer.ID).Order("access_attempt_id").Find(&claims).Error; err != nil {
		return err
	}
	for i := range claims {
		if err := accessgate.CancelLinkedAttemptInTransaction(sc.tx, claims[i].AccessAttemptID); err != nil {
			return err
		}
	}
	for i := range claims {
		if claims[i].ID == sc.offer.SelectedClaimID {
			if err := s.clearPendingDelivery(sc, &claims[i]); err != nil {
				return err
			}
		}
	}
	if err := sc.tx.Model(&rows.Claim{}).Where("offer_id = ?", sc.offer.ID).Update("state", state).Error; err != nil {
		return err
	}
	sc.offer.State = state
	sc.offer.Reason = reason
	sc.offer.LiveActor = nil
	sc.offer.IdentityEnvelope = nil
	sc.offer.PendingEnrollment = nil
	sc.offer.BootstrapPublication = nil
	return saveOffer(sc)
}

func (s *Service) Cancel(ctx context.Context, request *pb.CancelDeviceLinkRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	err := s.withOffer(ctx, request.GetOfferId(), func(sc *scope) error {
		var mobile *rows.Claim
		if request.GetClaimAuthorization() != nil {
			claim, err := authorizeClaim(sc, request.GetClaimAuthorization(), request, "cancel")
			if err != nil {
				return err
			}
			mobile = claim
		} else {
			if err := desktopSubject(ctx, sc.offer); err != nil {
				return err
			}
			if err := s.checkApprover(sc); err != nil {
				return err
			}
			if err := link.OperationProof(request, func(message proto.Message) {
				message.(*pb.CancelDeviceLinkRequest).DesktopDeviceSignature = nil
			}, sc.approver.DeviceSigningPublicKey, request.GetDesktopDeviceSignature(), "cancel"); err != nil {
				return err
			}
		}
		if link.Terminal(sc.offer.State) {
			var err error
			response, err = s.statusProjection(sc, mobile, nil)
			return err
		}
		if mobile != nil && mobile.State == pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED {
			var err error
			response, err = s.statusProjection(sc, mobile, nil)
			return err
		}
		if err := requireRevision(sc, request.GetObservedRevision()); err != nil {
			return err
		}
		if mobile != nil && mobile.ID != sc.offer.SelectedClaimID {
			if err := accessgate.CancelLinkedAttemptInTransaction(sc.tx, mobile.AccessAttemptID); err != nil {
				return err
			}
			mobile.State = pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED
			if err := sc.tx.Save(mobile).Error; err != nil {
				return err
			}
			if err := saveOffer(sc); err != nil {
				return err
			}
		} else {
			if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED); err != nil {
				return err
			}
			if mobile != nil {
				mobile.State = sc.offer.State
			}
		}
		var err error
		response, err = s.statusProjection(sc, mobile, nil)
		return err
	})
	return response, err
}

// Sweep bounds each pass and takes each Actor before its offer. It never holds
// all offer locks before trying to acquire an Actor, unlike a bulk expiry scan.
func (s *Service) Sweep(ctx context.Context) (int, error) {
	database, err := s.Database(ctx)
	if err != nil {
		return 0, err
	}
	var hints []rows.Offer
	if err := database.WithContext(ctx).Select("id", "actor_ptid").Where("live_actor IS NOT NULL AND expires_at <= ?", s.Clock()).
		Order("actor_ptid, id").Limit(256).Find(&hints).Error; err != nil {
		return 0, err
	}
	count := 0
	for _, hint := range hints {
		err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
			sc, err := s.lockActor(tx, hint.ActorPTID)
			if err != nil {
				return err
			}
			sc.now = now
			if err := tx.Where("id = ?", hint.ID).First(&sc.offer).Error; err != nil {
				return err
			}
			if link.Terminal(sc.offer.State) || sc.offer.ExpiresAt.After(now) {
				return nil
			}
			if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_EXPIRED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_EXPIRED); err != nil {
				return err
			}
			count++
			return nil
		})
		if err != nil {
			return count, err
		}
	}
	// Retain a bounded retry window after terminal outcomes; no live aggregate
	// or committed Actor/Session data is removed by this owner.
	var retired []rows.Offer
	cutoff := s.Clock().Add(-24 * time.Hour)
	if err := database.WithContext(ctx).Select("id", "actor_ptid").
		Where("live_actor IS NULL AND expires_at < ?", cutoff).
		Order("actor_ptid, id").Limit(256).Find(&retired).Error; err != nil {
		return count, err
	}
	for _, hint := range retired {
		err = s.transaction(ctx, func(tx *gorm.DB, _ time.Time) error {
			if _, err := s.lockActor(tx, hint.ActorPTID); err != nil {
				return err
			}
			var offer rows.Offer
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ?", hint.ID).First(&offer).Error
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			if offer.LiveActor != nil || !offer.ExpiresAt.Before(cutoff) {
				return nil
			}
			var claims []rows.Claim
			if err := tx.Where("offer_id = ?", offer.ID).Order("access_attempt_id").Find(&claims).Error; err != nil {
				return err
			}
			for _, claim := range claims {
				if err := accessgate.RetireLinkedAttemptInTransaction(tx, claim.AccessAttemptID, cutoff); err != nil {
					return err
				}
			}
			if err := tx.Where("offer_id = ?", offer.ID).Delete(&rows.Claim{}).Error; err != nil {
				return err
			}
			return tx.Where("id = ? AND live_actor IS NULL", offer.ID).Delete(&rows.Offer{}).Error
		})
		if err != nil {
			return count, err
		}
	}
	return count, err
}
