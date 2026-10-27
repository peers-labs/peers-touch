package application

import (
	"bytes"
	"context"

	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	"google.golang.org/protobuf/proto"
)

func authorizeClaim(sc *scope, authorization *pb.DeviceLinkClaimAuthorization, request proto.Message, operation string) (*rows.Claim, error) {
	if authorization == nil || authorization.GetOfferId() != sc.offer.ID {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	claim, err := loadClaim(sc, authorization.GetClaimId())
	if err != nil || !link.SameSecret(authorization.GetClaimCapability(), claim.CapabilityHash) {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	statement := &pb.DeviceLinkClaimStatement{}
	if err := link.Decode(claim.Statement, statement); err != nil {
		return nil, err
	}
	err = link.OperationProof(request, func(message proto.Message) {
		switch typed := message.(type) {
		case *pb.GetDeviceLinkStatusRequest:
			typed.ClaimAuthorization.DeviceSignature = nil
		case *pb.GetDeviceLinkMaterialRequest:
			typed.Authorization.DeviceSignature = nil
		case *pb.ProveDeviceLinkDeviceRequest:
			typed.Authorization.DeviceSignature = nil
		case *pb.SubmitDeviceLinkAccessActionRequest:
			typed.Authorization.DeviceSignature = nil
		case *pb.AcknowledgeDeviceLinkRequest:
			typed.Authorization.DeviceSignature = nil
		case *pb.CancelDeviceLinkRequest:
			typed.ClaimAuthorization.DeviceSignature = nil
		}
	}, statement.GetMobileDeviceSigningPublicKey(), authorization.GetDeviceSignature(), operation)
	return claim, err
}

func selected(sc *scope, claim *rows.Claim) error {
	if sc.offer.SelectedClaimID != claim.ID || link.Terminal(sc.offer.State) {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_NOT_SELECTED)
	}
	return nil
}

func enrollment(sc *scope, claim *rows.Claim, request *model.EnrollActorDeviceRequest) (identity.Enrollment, error) {
	certificate := request.GetCertificate()
	statement := &pb.DeviceLinkClaimStatement{}
	if err := link.Decode(claim.Statement, statement); err != nil {
		return identity.Enrollment{}, err
	}
	if certificate == nil || certificate.GetDevice().GetDeviceId() != claim.DeviceID ||
		!proto.Equal(certificate.GetDevice().GetActor(), touchactor.ProtoActorRef(sc.actor)) ||
		!bytes.Equal(certificate.GetDeviceSigningPublicKey(), statement.GetMobileDeviceSigningPublicKey()) {
		return identity.Enrollment{}, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_IDENTITY_CONFLICT)
	}
	raw, err := link.Encode(certificate)
	if err != nil {
		return identity.Enrollment{}, err
	}
	actor := certificate.GetDevice().GetActor()
	return identity.Enrollment{
		FormatVersion: certificate.GetFormatVersion(), PTID: actor.GetPtid(), ActorAccount: actor.GetAcct(),
		ActorKind: int32(actor.GetKind()), DeviceID: claim.DeviceID, Label: request.GetLabel(),
		HomeStationPeerID: sc.offer.StationPeerID, ActorIdentityPublicKey: certificate.GetActorIdentityPublicKey(),
		ActorIdentityFingerprint: certificate.GetActorIdentityKeyFingerprint(), DeviceSigningPublicKey: certificate.GetDeviceSigningPublicKey(),
		SigningKeyID: certificate.GetSigningKeyId(), ProfileVersion: certificate.GetObservedProfileVersion(),
		CanonicalCertificateBytes: raw, ActorCrossSignature: request.GetActorCrossSignature(),
	}, nil
}

func (s *Service) Prove(ctx context.Context, request *pb.ProveDeviceLinkDeviceRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	err := s.withOffer(ctx, request.GetAuthorization().GetOfferId(), func(sc *scope) error {
		claim, err := authorizeClaim(sc, request.GetAuthorization(), request, "prove")
		if err != nil {
			return err
		}
		if err := selected(sc, claim); err != nil {
			return err
		}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		proof, err := enrollment(sc, claim, request.GetEnrollment())
		if err != nil {
			return err
		}
		raw, err := link.Encode(request.GetEnrollment())
		if err != nil {
			return err
		}
		replacing := len(sc.offer.PendingEnrollment) != 0 && !bytes.Equal(raw, sc.offer.PendingEnrollment)
		if replacing {
			oldRequest := &model.EnrollActorDeviceRequest{}
			if err := link.Decode(sc.offer.PendingEnrollment, oldRequest); err != nil {
				return err
			}
			old := oldRequest.GetCertificate()
			if old.GetObservedProfileVersion() >= proof.ProfileVersion ||
				!bytes.Equal(old.GetActorIdentityPublicKey(), proof.ActorIdentityPublicKey) ||
				!bytes.Equal(old.GetDeviceSigningPublicKey(), proof.DeviceSigningPublicKey) {
				return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_IDENTITY_CONFLICT)
			}
			if err := requireRevision(sc, request.GetObservedRevision()); err != nil {
				return err
			}
		}
		if len(sc.offer.PendingEnrollment) == 0 {
			if err := requireRevision(sc, request.GetObservedRevision()); err != nil {
				return err
			}
			if sc.offer.State != pb.DeviceLinkState_DEVICE_LINK_STATE_IDENTITY_DELIVERY {
				return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_DELIVERY_PENDING)
			}
		}
		// Access is locked before device validation to preserve the shared order.
		attempt, decision, err := accessgate.BindLinkedCandidateInTransaction(sc.tx, claim.AccessAttemptID, sc.actor, sc.now)
		if err != nil {
			return err
		}
		if err := s.Identity.ValidateLinkedEnrollment(sc.tx, proof); err != nil {
			return err
		}
		if replacing {
			if err := s.clearPendingDelivery(sc, claim); err != nil {
				return err
			}
		}
		if len(sc.offer.PendingEnrollment) == 0 || replacing {
			sc.offer.PendingEnrollment = raw
			sc.offer.State = pb.DeviceLinkState_DEVICE_LINK_STATE_ACCESS_PENDING
			claim.State = sc.offer.State
			claim.AccessRevision = attempt.DecisionRevision
			if err := sc.tx.Save(claim).Error; err != nil {
				return err
			}
			if err := saveOffer(sc); err != nil {
				return err
			}
		}
		response, err = s.statusProjection(sc, claim, decision)
		return err
	})
	return response, err
}

func (s *Service) Submit(ctx context.Context, request *pb.SubmitDeviceLinkAccessActionRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	err := s.withOffer(ctx, request.GetAuthorization().GetOfferId(), func(sc *scope) error {
		claim, err := authorizeClaim(sc, request.GetAuthorization(), request, "access")
		if err != nil {
			return err
		}
		if err := selected(sc, claim); err != nil {
			return err
		}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		if request.GetSubmission().GetAttemptId() != claim.AccessAttemptID || len(sc.offer.PendingEnrollment) == 0 {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_ACCESS_BLOCKED)
		}
		raw, err := link.Encode(request)
		if err != nil {
			return err
		}
		retry := bytes.Equal(link.Digest(raw), sc.offer.LastAccessRequestDigest)
		if !retry {
			if err := requireRevision(sc, request.GetObservedRevision()); err != nil {
				return err
			}
		}
		attempt, decision, err := accessgate.SubmitLinkedActionInTransaction(sc.tx, request.GetSubmission(), sc.now)
		if err != nil {
			return err
		}
		claim.AccessRevision = attempt.DecisionRevision
		if err := sc.tx.Save(claim).Error; err != nil {
			return err
		}
		if !retry {
			sc.offer.LastAccessRequestDigest = link.Digest(raw)
			if err := saveOffer(sc); err != nil {
				return err
			}
		}
		response, err = s.statusProjection(sc, claim, decision)
		return err
	})
	return response, err
}
