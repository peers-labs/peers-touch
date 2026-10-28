package application

import (
	"context"

	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	accesspb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
)

func (s *Service) statusProjection(sc *scope, mobile *rows.Claim, decision *accesspb.AccessDecision) (*pb.DeviceLinkStatus, error) {
	if sc.offer.State == pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED {
		decision = nil
	}
	status := &pb.DeviceLinkStatus{
		OfferId: sc.offer.ID, State: sc.offer.State, Revision: sc.offer.Revision, ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(),
		SelectedClaimId: sc.offer.SelectedClaimID, Reason: sc.offer.Reason, AccessDecision: decision,
		DeliveryId: sc.offer.DeliveryID, CredentialDigest: sc.offer.CredentialDigest,
		CurrentProfileRevision: sc.identity.ProfileVersion,
	}
	if mobile != nil {
		var err error
		mobile, err = loadClaim(sc, mobile.ID)
		if err != nil {
			return nil, err
		}
		status.Claims = []*pb.DeviceLinkClaim{claimProjection(mobile)}
		status.State = mobile.State
		if mobile.ID != sc.offer.SelectedClaimID {
			status.SelectedClaimId = ""
			switch mobile.State {
			case pb.DeviceLinkState_DEVICE_LINK_STATE_DENIED:
				status.Reason = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_NOT_SELECTED
			case pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED:
				status.Reason = pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED
			}
			status.DeliveryId = ""
			status.CredentialDigest = nil
			status.AccessDecision = nil
		}
		return status, nil
	}
	var claims []rows.Claim
	if err := sc.tx.Where("offer_id = ?", sc.offer.ID).Order("created_at, id").Limit(link.MaxClaims).Find(&claims).Error; err != nil {
		return nil, err
	}
	for i := range claims {
		status.Claims = append(status.Claims, claimProjection(&claims[i]))
	}
	return status, nil
}

func refreshPendingProfiles(sc *scope) error {
	if sc.offer.SelectedClaimID != "" || link.Terminal(sc.offer.State) {
		return nil
	}
	result := sc.tx.Model(&rows.Claim{}).
		Where("offer_id = ? AND state = ? AND profile_revision < ?", sc.offer.ID,
			pb.DeviceLinkState_DEVICE_LINK_STATE_CLAIMS_PENDING, sc.identity.ProfileVersion).
		Update("profile_revision", sc.identity.ProfileVersion)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 0 {
		return saveOffer(sc)
	}
	return nil
}

func (s *Service) Status(ctx context.Context, request *pb.GetDeviceLinkStatusRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	var denial error
	err := s.withOffer(ctx, request.GetOfferId(), func(sc *scope) error {
		var mobile *rows.Claim
		var err error
		if request.GetClaimAuthorization() != nil {
			mobile, err = authorizeClaim(sc, request.GetClaimAuthorization(), request, "status")
		} else {
			err = desktopSubject(ctx, sc.offer)
		}
		if err != nil {
			return err
		}
		if !link.Terminal(sc.offer.State) {
			if err := s.checkApprover(sc); err != nil {
				denial = err
				if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_REVOKED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED); err != nil {
					return err
				}
			}
		}
		if err := refreshPendingProfiles(sc); err != nil {
			return err
		}
		var decision *accesspb.AccessDecision
		if !link.Terminal(sc.offer.State) && len(sc.offer.PendingEnrollment) != 0 {
			claim, err := loadClaim(sc, sc.offer.SelectedClaimID)
			if err != nil {
				return err
			}
			decision, err = s.refreshAccess(sc, claim)
			if err != nil {
				return err
			}
			if mobile != nil && mobile.ID == claim.ID {
				mobile = claim
			}
		}
		response, err = s.statusProjection(sc, mobile, decision)
		return err
	})
	if err == nil {
		err = denial
	}
	return response, err
}
