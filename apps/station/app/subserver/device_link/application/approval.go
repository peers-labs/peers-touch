package application

import (
	"bytes"
	"context"

	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"google.golang.org/protobuf/proto"
)

func loadClaim(sc *scope, id string) (*rows.Claim, error) {
	var claim rows.Claim
	if err := sc.tx.Where("id = ? AND offer_id = ?", id, sc.offer.ID).First(&claim).Error; err != nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	return &claim, nil
}

func (s *Service) Approve(ctx context.Context, request *pb.ApproveDeviceLinkRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	err := s.withOffer(ctx, request.GetOfferId(), func(sc *scope) error {
		if err := desktopSubject(ctx, sc.offer); err != nil {
			return err
		}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		claim, err := loadClaim(sc, request.GetClaimId())
		if err != nil {
			return err
		}
		requestBytes, err := link.Encode(request)
		if err != nil {
			return err
		}
		// An accepted approval is immutable even when the live profile fence
		// advances. Exact retries authenticate against the persisted command.
		if sc.offer.SelectedClaimID != "" {
			if sc.offer.SelectedClaimID != claim.ID ||
				!bytes.Equal(sc.offer.ApprovalRequestDigest, link.Digest(requestBytes)) {
				return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_REVISION_CONFLICT)
			}
			response, err = s.statusProjection(sc, nil, nil)
			return err
		}
		if claim.ProfileRevision != sc.identity.ProfileVersion {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_PROFILE_STALE)
		}
		offer, err := s.signedOffer(sc)
		if err != nil {
			return err
		}
		revision := request.GetObservedRevision() + 1
		transcript, err := link.Approval(offer, claimProjection(claim), revision)
		if err != nil {
			return err
		}
		raw, err := link.Encode(transcript)
		if err != nil {
			return err
		}
		envelope := request.GetIdentityMaterial()
		if envelope == nil || envelope.GetProtocolVersion() != 1 || len(envelope.GetEncapsulatedKey()) != 32 ||
			len(envelope.GetCiphertext()) < 16 || len(envelope.GetCiphertext()) > 4096+16 ||
			!bytes.Equal(envelope.GetTranscriptBytes(), raw) {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
		}
		if err := link.VerifySignature(sc.approver.DeviceSigningPublicKey, link.ApprovalDomain, raw, request.GetDesktopTranscriptSignature()); err != nil {
			return err
		}
		encodedEnvelope, err := link.Encode(envelope)
		if err != nil {
			return err
		}
		if link.Terminal(sc.offer.State) || claim.State != pb.DeviceLinkState_DEVICE_LINK_STATE_CLAIMS_PENDING {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_NOT_SELECTED)
		}
		if err := requireRevision(sc, request.GetObservedRevision()); err != nil {
			return err
		}
		var others []rows.Claim
		if err := sc.tx.Where("offer_id = ? AND id <> ?", sc.offer.ID, claim.ID).Order("access_attempt_id").Find(&others).Error; err != nil {
			return err
		}
		for _, other := range others {
			if err := accessgate.CancelLinkedAttemptInTransaction(sc.tx, other.AccessAttemptID); err != nil {
				return err
			}
		}
		if err := sc.tx.Model(&rows.Claim{}).Where("offer_id = ? AND id <> ?", sc.offer.ID, claim.ID).
			Update("state", pb.DeviceLinkState_DEVICE_LINK_STATE_DENIED).Error; err != nil {
			return err
		}
		sc.offer.SelectedClaimID = claim.ID
		sc.offer.ApprovalRevision = revision
		sc.offer.ApprovalTranscript = raw
		sc.offer.ApprovalRequestDigest = link.Digest(requestBytes)
		sc.offer.IdentityEnvelope = encodedEnvelope
		sc.offer.DesktopSignature = request.GetDesktopTranscriptSignature()
		sc.offer.State = pb.DeviceLinkState_DEVICE_LINK_STATE_IDENTITY_DELIVERY
		claim.State = sc.offer.State
		if err := sc.tx.Save(claim).Error; err != nil {
			return err
		}
		if err := saveOffer(sc); err != nil {
			return err
		}
		if err := lockOriginalSession(sc); err != nil {
			return err
		}
		response, err = s.statusProjection(sc, nil, nil)
		return err
	})
	return response, err
}

func (s *Service) Deny(ctx context.Context, request *pb.DenyDeviceLinkRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	err := s.withOffer(ctx, request.GetOfferId(), func(sc *scope) error {
		if err := desktopSubject(ctx, sc.offer); err != nil {
			return err
		}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		if err := link.OperationProof(request, func(message proto.Message) {
			message.(*pb.DenyDeviceLinkRequest).DeviceSignature = nil
		}, sc.approver.DeviceSigningPublicKey, request.GetDeviceSignature(), "deny"); err != nil {
			return err
		}
		claim, err := loadClaim(sc, request.GetClaimId())
		if err != nil {
			return err
		}
		if claim.State == pb.DeviceLinkState_DEVICE_LINK_STATE_DENIED {
			response, err = s.statusProjection(sc, nil, nil)
			return err
		}
		if err := requireRevision(sc, request.GetObservedRevision()); err != nil {
			return err
		}
		if claim.State != pb.DeviceLinkState_DEVICE_LINK_STATE_CLAIMS_PENDING || sc.offer.SelectedClaimID != "" {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_NOT_SELECTED)
		}
		if err := accessgate.CancelLinkedAttemptInTransaction(sc.tx, claim.AccessAttemptID); err != nil {
			return err
		}
		claim.State = pb.DeviceLinkState_DEVICE_LINK_STATE_DENIED
		if err := sc.tx.Save(claim).Error; err != nil {
			return err
		}
		if err := saveOffer(sc); err != nil {
			return err
		}
		response, err = s.statusProjection(sc, nil, nil)
		return err
	})
	return response, err
}
