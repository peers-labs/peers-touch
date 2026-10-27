package application

import (
	"bytes"
	"context"

	"github.com/google/uuid"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	touchauth "github.com/peers-labs/peers-touch/station/frame/touch/auth"
	model "github.com/peers-labs/peers-touch/station/frame/touch/model"
	accesspb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
)

func (s *Service) pendingProof(sc *scope, claim *rows.Claim) error {
	request := &model.EnrollActorDeviceRequest{}
	if err := link.Decode(sc.offer.PendingEnrollment, request); err != nil {
		return err
	}
	proof, err := enrollment(sc, claim, request)
	if err != nil {
		return err
	}
	return s.Identity.ValidateLinkedEnrollment(sc.tx, proof)
}

func (s *Service) refreshAccess(sc *scope, claim *rows.Claim) (*accesspb.AccessDecision, error) {
	attempt, decision, err := accessgate.ReevaluateLinkedInTransaction(sc.tx, claim.AccessAttemptID, sc.now)
	if err != nil {
		return nil, err
	}
	changed := claim.AccessRevision != attempt.DecisionRevision
	claim.AccessRevision = attempt.DecisionRevision
	if err := s.pendingProof(sc, claim); err != nil {
		return nil, err
	}
	if len(sc.offer.CredentialEnvelope) != 0 && (sc.offer.CredentialRevision != attempt.DecisionRevision ||
		decision.GetState() != accesspb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED) {
		if err := s.clearPendingDelivery(sc, claim); err != nil {
			return nil, err
		}
		sc.offer.State = pb.DeviceLinkState_DEVICE_LINK_STATE_ACCESS_PENDING
		claim.State = sc.offer.State
		changed = true
	}
	if changed {
		if err := sc.tx.Save(claim).Error; err != nil {
			return nil, err
		}
		if err := saveOffer(sc); err != nil {
			return nil, err
		}
	}
	return decision, nil
}

func (s *Service) Material(ctx context.Context, request *pb.GetDeviceLinkMaterialRequest) (*pb.GetDeviceLinkMaterialResponse, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.GetDeviceLinkMaterialResponse
	err := s.withOffer(ctx, request.GetAuthorization().GetOfferId(), func(sc *scope) error {
		claim, err := authorizeClaim(sc, request.GetAuthorization(), request, "material")
		if err != nil {
			return err
		}
		if err := selected(sc, claim); err != nil {
			return err
		}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		var decision *accesspb.AccessDecision
		if len(sc.offer.PendingEnrollment) != 0 {
			decision, err = s.refreshAccess(sc, claim)
			if err != nil {
				return err
			}
			if decision.GetState() == accesspb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED &&
				len(sc.offer.CredentialEnvelope) == 0 {
				if err := s.prepareDelivery(sc, claim); err != nil {
					return err
				}
			}
		}
		status, err := s.statusProjection(sc, claim, decision)
		if err != nil {
			return err
		}
		response = &pb.GetDeviceLinkMaterialResponse{Status: status, DesktopTranscriptSignature: sc.offer.DesktopSignature}
		response.IdentityMaterial = &pb.DeviceLinkHpkeEnvelope{}
		if err := link.Decode(sc.offer.IdentityEnvelope, response.IdentityMaterial); err != nil {
			return err
		}
		if len(sc.offer.CredentialEnvelope) != 0 {
			response.CredentialMaterial = &pb.DeviceLinkHpkeEnvelope{}
			response.NodeAuthorization = &peerpb.StationNodeAuthorization{}
			if err := link.Decode(sc.offer.CredentialEnvelope, response.CredentialMaterial); err != nil {
				return err
			}
			if err := link.Decode(sc.offer.CredentialAuthority, response.NodeAuthorization); err != nil {
				return err
			}
			response.NodeCredentialSignature = sc.offer.CredentialSignature
		}
		return lockOriginalSession(sc)
	})
	return response, err
}

func (s *Service) prepareDelivery(sc *scope, claim *rows.Claim) error {
	statement := &pb.DeviceLinkClaimStatement{}
	if err := link.Decode(claim.Statement, statement); err != nil {
		return err
	}
	keyring, err := coreauth.StationAccessKeyringInTransaction(sc.tx)
	if err != nil {
		return err
	}
	record, login, err := touchauth.PreparePendingSession(sc.tx.Statement.Context, sc.actor, touchauth.PendingSessionBinding{
		AccessGateSessionBinding: touchauth.AccessGateSessionBinding{
			AccessAttemptID: claim.AccessAttemptID, StationPeerID: sc.offer.StationPeerID,
			AccessDecisionRevision: claim.AccessRevision, DeviceType: session.DeviceTypeMobile,
			DeviceID: claim.DeviceID, LifecycleGeneration: statement.GetLifecycleGeneration(),
		},
		AuthMethod: "device_link",
	}, sc.now, coreauth.WithStationAccessKeyring(keyring))
	if err != nil {
		return err
	}
	bundle, err := s.Network.Prepare(sc.tx.Statement.Context, sc.offer.ExpiresAt, 1)
	if err != nil {
		return err
	}
	if bundle.StationPeerID != sc.offer.StationPeerID || len(bundle.Connections) == 0 || len(bundle.Connections) > 4 {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_STATION_ROOT_MISMATCH)
	}
	offer, err := s.signedOffer(sc)
	if err != nil {
		return err
	}
	offerStatement := &pb.DeviceLinkOfferStatement{}
	if err := link.Decode(offer.StatementBytes, offerStatement); err != nil {
		return err
	}
	if !bytes.Equal(bundle.Root, offerStatement.StationRootPublicKey) {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_STATION_ROOT_MISMATCH)
	}
	transcript := &pb.DeviceLinkCredentialTranscript{
		ProtocolVersion: 1, ApprovalTranscriptDigest: link.Digest(sc.offer.ApprovalTranscript), DeliveryId: uuid.NewString(),
		SessionId: record.SessionID, MobileDeviceId: claim.DeviceID, AccessAttemptId: claim.AccessAttemptID,
		AccessDecisionRevision: claim.AccessRevision, ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(),
	}
	plaintext, err := link.Encode(&pb.DeviceLinkCredentialMaterial{Login: login, Transcript: transcript, Connections: bundle.Connections})
	if err != nil {
		return err
	}
	defer clear(plaintext)
	defer func() {
		login.Tokens.Token = ""
		login.Tokens.AccessToken = ""
		login.Tokens.RefreshToken = ""
	}()
	transcriptBytes, err := link.Encode(transcript)
	if err != nil {
		return err
	}
	envelope, err := infrastructure.SealCredential(statement.GetMobileHpkePublicKey(), transcriptBytes, plaintext)
	if err != nil {
		return err
	}
	raw, err := link.Encode(envelope)
	if err != nil {
		return err
	}
	signature, authority, err := s.Network.SignNetworkMaterial(sc.tx.Statement.Context, link.CredentialDomain, raw)
	if err != nil {
		return err
	}
	authorityBytes, err := link.Encode(authority)
	if err != nil {
		return err
	}
	if err := sc.tx.Create(record).Error; err != nil {
		return err
	}
	sc.offer.CredentialEnvelope = raw
	sc.offer.CredentialSignature = signature
	sc.offer.CredentialAuthority = authorityBytes
	sc.offer.CredentialDigest = link.Digest(raw)
	sc.offer.CredentialRevision = claim.AccessRevision
	sc.offer.DeliveryID = transcript.DeliveryId
	sc.offer.SessionID = record.SessionID
	sc.offer.State = pb.DeviceLinkState_DEVICE_LINK_STATE_CREDENTIAL_DELIVERY
	claim.State = sc.offer.State
	if err := sc.tx.Save(claim).Error; err != nil {
		return err
	}
	return saveOffer(sc)
}

func (s *Service) Acknowledge(ctx context.Context, request *pb.AcknowledgeDeviceLinkRequest) (*pb.DeviceLinkStatus, error) {
	if request == nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	var response *pb.DeviceLinkStatus
	var denial error
	err := s.withOffer(ctx, request.GetAuthorization().GetOfferId(), func(sc *scope) error {
		claim, err := authorizeClaim(sc, request.GetAuthorization(), request, "ack")
		if err != nil {
			return err
		}
		if sc.offer.SelectedClaimID != claim.ID || request.GetDeliveryId() != sc.offer.DeliveryID ||
			!bytes.Equal(request.GetCredentialDigest(), sc.offer.CredentialDigest) {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
		}
		if sc.offer.State == pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED {
			response, err = s.statusProjection(sc, claim, nil)
			return err
		}
		if err := selected(sc, claim); err != nil {
			return err
		}
		if err := s.checkApprover(sc); err != nil {
			denial = err
			return s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_REVOKED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
		}
		decision, err := s.refreshAccess(sc, claim)
		if err != nil {
			return err
		}
		if decision.GetState() != accesspb.AccessDecisionState_ACCESS_DECISION_STATE_GRANTED ||
			sc.offer.State != pb.DeviceLinkState_DEVICE_LINK_STATE_CREDENTIAL_DELIVERY ||
			sc.offer.CredentialRevision != claim.AccessRevision || request.GetDeliveryId() != sc.offer.DeliveryID {
			denial = link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_ACCESS_BLOCKED)
			return nil
		}
		enrollRequest := &model.EnrollActorDeviceRequest{}
		if err := link.Decode(sc.offer.PendingEnrollment, enrollRequest); err != nil {
			return err
		}
		proof, err := enrollment(sc, claim, enrollRequest)
		if err != nil {
			return err
		}
		if _, err := s.Identity.CommitLinkedEnrollment(sc.tx, proof, sc.now); err != nil {
			return err
		}
		statement := &pb.DeviceLinkClaimStatement{}
		if err := link.Decode(claim.Statement, statement); err != nil {
			return err
		}
		expected := &session.SessionRecord{SessionID: sc.offer.SessionID, UserID: sc.actor.ID,
			DeviceID: claim.DeviceID, DeviceType: session.DeviceTypeMobile, StationPeerID: sc.offer.StationPeerID,
			AccessAttemptID: claim.AccessAttemptID, AccessDecisionRevision: claim.AccessRevision,
			LifecycleGeneration: statement.GetLifecycleGeneration(), AuthMethod: "device_link"}
		if err := session.ActivatePendingDeviceSession(sc.tx, expected, sc.now); err != nil {
			return err
		}
		if err := accessgate.CommitLinkedSessionInTransaction(sc.tx, claim.AccessAttemptID, sc.offer.SessionID, claim.AccessRevision, sc.now); err != nil {
			return err
		}
		if err := lockOriginalSession(sc); err != nil {
			return err
		}
		sc.offer.State = pb.DeviceLinkState_DEVICE_LINK_STATE_COMMITTED
		sc.offer.LiveActor = nil
		sc.offer.IdentityEnvelope = nil
		sc.offer.CredentialEnvelope = nil
		sc.offer.PendingEnrollment = nil
		sc.offer.BootstrapPublication = nil
		claim.State = sc.offer.State
		if err := sc.tx.Save(claim).Error; err != nil {
			return err
		}
		if err := saveOffer(sc); err != nil {
			return err
		}
		response, err = s.statusProjection(sc, claim, decision)
		return err
	})
	if err == nil {
		err = denial
	}
	return response, err
}
