package application

import (
	"bytes"
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	identity "github.com/peers-labs/peers-touch/station/app/subserver/actor_identity/domain"
	link "github.com/peers-labs/peers-touch/station/app/subserver/device_link/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/device_link/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	"github.com/peers-labs/peers-touch/station/frame/touch/accessgate"
	touchactor "github.com/peers-labs/peers-touch/station/frame/touch/actor"
	accesspb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	db "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/devicelink"
	peerpb "github.com/peers-labs/peers-touch/station/frame/touch/model/peer"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const OfferLifetime = 5 * time.Minute

type IdentityOwner interface {
	LockLinkedActor(*gorm.DB, string) (identity.ActorIdentity, error)
	LinkedApprover(*gorm.DB, string, string) (identity.Device, error)
	ValidateLinkedEnrollment(*gorm.DB, identity.Enrollment) error
	CommitLinkedEnrollment(*gorm.DB, identity.Enrollment, time.Time) (identity.Device, error)
}

type NetworkBundle = link.NetworkBundle

type NetworkOwner interface {
	Prepare(context.Context, time.Time, uint32) (*NetworkBundle, error)
	SignNetworkMaterial(context.Context, string, []byte) ([]byte, *peerpb.StationNodeAuthorization, error)
	Publish(context.Context, *peerpb.PublishBootstrapBlobRequest) error
}

type Service struct {
	Database func(context.Context) (*gorm.DB, error)
	Identity IdentityOwner
	Network  NetworkOwner
	Clock    func() time.Time
}

type scope struct {
	tx       *gorm.DB
	offer    *rows.Offer
	actor    *db.Actor
	identity identity.ActorIdentity
	approver identity.Device
	key      coreauth.StationAccessKey
	now      time.Time
}

func (s *Service) transaction(ctx context.Context, apply func(*gorm.DB, time.Time) error) error {
	database, err := s.Database(ctx)
	if err != nil {
		return err
	}
	bounded, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return database.WithContext(bounded).Transaction(func(tx *gorm.DB) error {
		return apply(tx, s.Clock().UTC())
	})
}

func (s *Service) lockActor(tx *gorm.DB, ptid string) (*scope, error) {
	actorIdentity, err := s.Identity.LockLinkedActor(tx, ptid)
	if err != nil {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_IDENTITY_CONFLICT)
	}
	var actor db.Actor
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("ptid = ?", ptid).First(&actor).Error; err != nil {
		return nil, err
	}
	return &scope{tx: tx, actor: &actor, identity: actorIdentity}, nil
}

func resolveKey(tx *gorm.DB, id string) (coreauth.StationAccessKey, error) {
	keyring, err := coreauth.StationAccessKeyringInTransaction(tx)
	if err != nil {
		return coreauth.StationAccessKey{}, err
	}
	if id == "" {
		return keyring.Current(tx.Statement.Context)
	}
	return keyring.Resolve(tx.Statement.Context, id)
}

// withOffer discovers only the lock key before entering the transaction; every
// binding is reread under Actor -> offer locks. Denials commit terminal cleanup.
func (s *Service) withOffer(ctx context.Context, id string, apply func(*scope) error) error {
	if !link.Identifier(id, 128) {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_INVALID_ARGUMENT)
	}
	database, err := s.Database(ctx)
	if err != nil {
		return err
	}
	var hint rows.Offer
	if err := database.WithContext(ctx).Select("id", "actor_ptid").Where("id = ?", id).First(&hint).Error; err != nil {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	var denial error
	err = s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		sc, err := s.lockActor(tx, hint.ActorPTID)
		if err != nil {
			return err
		}
		sc.now = now
		var offer rows.Offer
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND actor_ptid = ?", id, hint.ActorPTID).First(&offer).Error; err != nil {
			return err
		}
		sc.offer = &offer
		if !link.Terminal(offer.State) && !offer.ExpiresAt.After(now) {
			denial = link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_EXPIRED)
			return s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_EXPIRED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_EXPIRED)
		}
		if link.Terminal(offer.State) {
			return apply(sc)
		}
		sc.key, err = resolveKey(tx, offer.CapabilityKeyID)
		if err != nil {
			denial = link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
			return s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_REVOKED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
		}
		if err := apply(sc); err != nil {
			return ownerError(err, sc)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return denial
}

func (s *Service) checkApprover(sc *scope) error {
	device, err := s.Identity.LinkedApprover(sc.tx, sc.offer.ActorPTID, sc.offer.DesktopDeviceID)
	if err != nil || !device.Verified || !bytes.Equal(device.ActorIdentityFingerprint, sc.identity.Fingerprint) {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
	}
	if len(sc.offer.RedactedOffer) != 0 {
		offer := &pb.SignedDeviceLinkOffer{}
		statement := &pb.DeviceLinkOfferStatement{}
		if err := link.Decode(sc.offer.RedactedOffer, offer); err != nil {
			return err
		}
		if err := link.Decode(offer.StatementBytes, statement); err != nil {
			return err
		}
		if !bytes.Equal(statement.GetDesktopCertificate().GetDeviceSigningPublicKey(), device.DeviceSigningPublicKey) ||
			statement.GetDesktopCertificate().GetSigningKeyId() != device.SigningKeyID {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
		}
	}
	var original session.SessionRecord
	if err := sc.tx.Where("session_id = ?", sc.offer.DesktopSessionID).First(&original).Error; err != nil ||
		original.UserID != sc.actor.ID || original.DeviceType != session.DeviceTypeDesktop ||
		original.DeviceID != sc.offer.DesktopDeviceID || original.StationPeerID != sc.offer.StationPeerID ||
		original.Revoked || !original.ExpiresAt.After(sc.now) {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
	}
	sc.approver = device
	return nil
}

// The final original-session lock is taken after Access/device operations.
// Logout or deletion cannot pass this fence while an ack commits.
func lockOriginalSession(sc *scope) error {
	var original session.SessionRecord
	if err := sc.tx.Clauses(clause.Locking{Strength: "SHARE"}).
		Where("session_id = ?", sc.offer.DesktopSessionID).First(&original).Error; err != nil ||
		original.Revoked || !original.ExpiresAt.After(sc.now) || original.UserID != sc.actor.ID ||
		original.DeviceID != sc.offer.DesktopDeviceID || original.StationPeerID != sc.offer.StationPeerID ||
		original.DeviceType != session.DeviceTypeDesktop {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED)
	}
	return nil
}

func desktopSubject(ctx context.Context, offer *rows.Offer) error {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || subject.ID != offer.ActorPTID || subject.SessionID != offer.DesktopSessionID {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	return nil
}

func saveOffer(sc *scope) error {
	old := sc.offer.Revision
	sc.offer.Revision++
	result := sc.tx.Model(&rows.Offer{}).Where("id = ? AND revision = ?", sc.offer.ID, old).
		Select("*").Updates(sc.offer)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_REVISION_CONFLICT)
	}
	return nil
}

func requireRevision(sc *scope, revision uint64) error {
	if revision != sc.offer.Revision {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_REVISION_CONFLICT)
	}
	return nil
}

func (s *Service) signedOffer(sc *scope) (*pb.SignedDeviceLinkOffer, error) {
	offer := &pb.SignedDeviceLinkOffer{}
	if err := link.Decode(sc.offer.RedactedOffer, offer); err != nil {
		return nil, err
	}
	statement := &pb.DeviceLinkOfferStatement{}
	if err := link.Decode(offer.StatementBytes, statement); err != nil {
		return nil, err
	}
	statement.ScanCapability = link.Capability(sc.key.Material, "scan", sc.offer.ID)
	if !link.SameSecret(statement.ScanCapability, sc.offer.ScanCapabilityHash) {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	var err error
	offer.StatementBytes, err = link.Encode(statement)
	return offer, err
}

func claimProjection(claim *rows.Claim) *pb.DeviceLinkClaim {
	return &pb.DeviceLinkClaim{
		ClaimId: claim.ID, StatementBytes: claim.Statement, MobileDeviceSignature: claim.Signature,
		AccessAttemptId: claim.AccessAttemptID, AccessDecisionRevision: claim.AccessRevision,
		ProfileRevision: claim.ProfileRevision, State: claim.State,
	}
}

func (s *Service) Create(ctx context.Context, request *pb.CreateDeviceLinkRequest) (*pb.CreateDeviceLinkResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || subject.SessionID == "" || request == nil ||
		!link.Identifier(request.GetRequestId(), 128) || len(request.GetDesktopHpkePublicKey()) != 32 ||
		bytes.Equal(request.GetDesktopHpkePublicKey(), make([]byte, 32)) {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	var response *pb.CreateDeviceLinkResponse
	var publication *peerpb.PublishBootstrapBlobRequest
	var terminalReplay *pb.DeviceLinkStatus
	err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		sc, err := s.lockActor(tx, subject.ID)
		if err != nil {
			return err
		}
		sc.now = now
		var original session.SessionRecord
		if err := tx.Where("session_id = ?", subject.SessionID).First(&original).Error; err != nil ||
			original.UserID != sc.actor.ID || original.DeviceType != session.DeviceTypeDesktop ||
			original.Revoked || !original.ExpiresAt.After(now) {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
		}
		sc.offer = &rows.Offer{ActorPTID: subject.ID, DesktopSessionID: subject.SessionID,
			DesktopDeviceID: original.DeviceID, StationPeerID: original.StationPeerID}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		if err := link.OperationProof(request, func(message proto.Message) {
			message.(*pb.CreateDeviceLinkRequest).DeviceSignature = nil
		}, sc.approver.DeviceSigningPublicKey, request.GetDeviceSignature(), "create"); err != nil {
			return err
		}
		raw, err := link.Encode(request)
		if err != nil {
			return err
		}
		var existing rows.Offer
		find := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("actor_ptid = ? AND desktop_session_id = ? AND request_id = ?",
			subject.ID, subject.SessionID, request.GetRequestId()).First(&existing).Error
		if find == nil {
			if !bytes.Equal(existing.RequestDigest, link.Digest(raw)) {
				return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED)
			}
			sc.offer = &existing
			if !link.Terminal(existing.State) && !existing.ExpiresAt.After(now) {
				if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_EXPIRED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_EXPIRED); err != nil {
					return err
				}
			}
			if link.Terminal(sc.offer.State) {
				// Only an authenticated exact request receives terminal lookup
				// metadata. Digest conflicts receive no reconciliation identity.
				terminalReplay = &pb.DeviceLinkStatus{
					OfferId: sc.offer.ID, State: sc.offer.State, Revision: sc.offer.Revision,
					ExpiresAtUnixMs: sc.offer.ExpiresAt.UnixMilli(), Reason: sc.offer.Reason,
				}
				return nil
			}
			// Exact replay authenticates the retained command and current
			// approver, without requiring its old profile revision to be current.
			if err := s.checkApprover(sc); err != nil {
				return err
			}
			sc.key, err = resolveKey(tx, existing.CapabilityKeyID)
			if err != nil {
				return err
			}
			response, publication, err = s.createResponse(sc)
			return err
		}
		if !errors.Is(find, gorm.ErrRecordNotFound) {
			return find
		}
		if err := verifyDesktopCertificate(request, sc); err != nil {
			return err
		}
		var active rows.Offer
		if err := tx.Where("live_actor = ?", subject.ID).First(&active).Error; err == nil {
			sc.offer = &active
			originalActive, err := originalSessionActive(sc)
			if err != nil {
				return err
			}
			if !originalActive {
				// A new authenticated Session cannot inherit old authority.
				// It may release an offer whose original Session is already
				// invalid, without exposing that offer's recovery material.
				if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_REVOKED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_APPROVER_REVOKED); err != nil {
					return err
				}
			} else if active.ExpiresAt.After(now) {
				if active.DesktopSessionID != original.SessionID || active.DesktopDeviceID != original.DeviceID {
					return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED)
				}
				// A fresh authenticated command replaces only an uncommitted
				// offer of this original Session. This also reconciles a Desktop
				// restart after losing its process-local receiver key.
				if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_CANCELLED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED); err != nil {
					return err
				}
			} else {
				if err := s.finish(sc, pb.DeviceLinkState_DEVICE_LINK_STATE_EXPIRED, pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_EXPIRED); err != nil {
					return err
				}
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		// This shared allocation fence counts retained records and issuance,
		// independently of cancellation freeing the one-live-offer slot.
		if tx.Dialector.Name() == "postgres" {
			if err := tx.Exec("SELECT pg_advisory_xact_lock(1684632165)").Error; err != nil {
				return err
			}
		}
		var count int64
		if err := tx.Model(&rows.Offer{}).Where("live_actor IS NOT NULL").Count(&count).Error; err != nil {
			return err
		}
		if count >= 256 {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED)
		}
		for _, budget := range []struct {
			query string
			args  []any
			max   int64
		}{
			{"actor_ptid = ?", []any{subject.ID}, 64},
			{"actor_ptid = ? AND created_at >= ?", []any{subject.ID, now.Add(-time.Minute)}, 8},
			{"created_at >= ?", []any{now.Add(-time.Minute)}, 128},
			{"1 = 1", nil, 4096},
		} {
			if err := tx.Model(&rows.Offer{}).Where(budget.query, budget.args...).Count(&count).Error; err != nil {
				return err
			}
			if count >= budget.max {
				return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CAPACITY_EXCEEDED)
			}
		}
		key, err := resolveKey(tx, "")
		if err != nil {
			return err
		}
		sc.key = key
		bundle, err := s.Network.Prepare(tx.Statement.Context, now.Add(OfferLifetime), link.MaxClaims)
		if err != nil {
			return err
		}
		if bundle.StationPeerID != original.StationPeerID || len(bundle.Root) == 0 ||
			len(bundle.Connections) == 0 || len(bundle.Connections) > 4 {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_STATION_ROOT_MISMATCH)
		}
		sc.offer = &rows.Offer{ID: uuid.NewString(), ActorPTID: subject.ID, DesktopSessionID: subject.SessionID,
			DesktopDeviceID: original.DeviceID, StationPeerID: bundle.StationPeerID, RequestID: request.GetRequestId(),
			RequestDigest: link.Digest(raw), CapabilityKeyID: key.ID, State: pb.DeviceLinkState_DEVICE_LINK_STATE_OPEN,
			Revision: 1, CreatedAt: now, ExpiresAt: now.Add(OfferLifetime), LiveActor: &subject.ID}
		if err := s.buildOffer(sc, request, bundle); err != nil {
			return err
		}
		if err := tx.Create(sc.offer).Error; err != nil {
			return err
		}
		if err := lockOriginalSession(sc); err != nil {
			return err
		}
		response, publication, err = s.createResponse(sc)
		return err
	})
	if err == nil && terminalReplay != nil {
		return nil, &link.Error{Code: pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_OFFER_CANCELLED, Status: terminalReplay}
	}
	if err == nil && publication != nil {
		err = s.Network.Publish(ctx, publication)
	}
	return response, err
}

func originalSessionActive(sc *scope) (bool, error) {
	var original session.SessionRecord
	err := sc.tx.Where("session_id = ?", sc.offer.DesktopSessionID).First(&original).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return !original.Revoked && original.ExpiresAt.After(sc.now) &&
		original.UserID == sc.actor.ID && original.DeviceType == session.DeviceTypeDesktop &&
		original.DeviceID == sc.offer.DesktopDeviceID && original.StationPeerID == sc.offer.StationPeerID, nil
}

func (s *Service) Claim(ctx context.Context, request *pb.ClaimDeviceLinkRequest) (*pb.ClaimDeviceLinkResponse, error) {
	statement, err := link.VerifyClaim(request)
	if err != nil {
		return nil, err
	}
	var response *pb.ClaimDeviceLinkResponse
	err = s.withOffer(ctx, request.GetOfferId(), func(sc *scope) error {
		if !link.SameSecret(request.GetScanCapability(), sc.offer.ScanCapabilityHash) ||
			statement.GetStationPeerId() != sc.offer.StationPeerID {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
		}
		if err := s.checkApprover(sc); err != nil {
			return err
		}
		var claim rows.Claim
		find := sc.tx.Where("offer_id = ? AND request_id = ? AND key_digest = ?", sc.offer.ID,
			statement.GetRequestId(), link.Digest(statement.GetMobileDeviceSigningPublicKey())).First(&claim).Error
		if find == nil {
			if !bytes.Equal(claim.Statement, request.GetStatementBytes()) || !bytes.Equal(claim.Signature, request.GetDeviceSignature()) {
				return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
			}
			if len(sc.key.Material) == 0 {
				sc.key, err = resolveKey(sc.tx, sc.offer.CapabilityKeyID)
				if err != nil {
					return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
				}
			}
			response, err = claimResponse(sc, &claim)
			return err
		}
		if !errors.Is(find, gorm.ErrRecordNotFound) {
			return find
		}
		if sc.offer.State != pb.DeviceLinkState_DEVICE_LINK_STATE_OPEN && sc.offer.State != pb.DeviceLinkState_DEVICE_LINK_STATE_CLAIMS_PENDING {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_NOT_SELECTED)
		}
		var count int64
		if err := sc.tx.Model(&rows.Claim{}).Where("offer_id = ?", sc.offer.ID).Count(&count).Error; err != nil {
			return err
		}
		if count >= link.MaxClaims {
			return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_CLAIM_LIMIT)
		}
		attempt, _, err := accessgate.CreateLinkedAttemptInTransaction(sc.tx, &accesspb.StartAccessAttemptRequest{
			StationPeerId: sc.offer.StationPeerID, Client: &accesspb.AccessGateClientInfo{
				DeviceId: statement.GetMobileDeviceId(), Platform: statement.GetPlatform(), AppVersion: statement.GetAppVersion(),
				LifecycleGeneration: statement.GetLifecycleGeneration(),
			},
		}, sc.offer.ExpiresAt)
		if err != nil {
			return err
		}
		claim = rows.Claim{ID: uuid.NewString(), OfferID: sc.offer.ID, RequestID: statement.GetRequestId(),
			DeviceID: statement.GetMobileDeviceId(), KeyDigest: link.Digest(statement.GetMobileDeviceSigningPublicKey()),
			Statement: request.GetStatementBytes(), Signature: request.GetDeviceSignature(), AccessAttemptID: attempt.ID,
			AccessRevision: attempt.DecisionRevision, ProfileRevision: sc.identity.ProfileVersion,
			State: pb.DeviceLinkState_DEVICE_LINK_STATE_CLAIMS_PENDING, CreatedAt: sc.now}
		claim.CapabilityHash = link.Digest(link.Capability(sc.key.Material, "claim", claim.ID))
		if err := sc.tx.Create(&claim).Error; err != nil {
			return err
		}
		sc.offer.State = pb.DeviceLinkState_DEVICE_LINK_STATE_CLAIMS_PENDING
		if err := saveOffer(sc); err != nil {
			return err
		}
		response, err = claimResponse(sc, &claim)
		return err
	})
	return response, err
}

func claimResponse(sc *scope, claim *rows.Claim) (*pb.ClaimDeviceLinkResponse, error) {
	capability := link.Capability(sc.key.Material, "claim", claim.ID)
	if len(sc.key.Material) < 32 || !link.SameSecret(capability, claim.CapabilityHash) {
		return nil, link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_UNAUTHORIZED)
	}
	return &pb.ClaimDeviceLinkResponse{Claim: claimProjection(claim),
		ClaimCapability: capability, Revision: sc.offer.Revision}, nil
}

func verifyDesktopCertificate(request *pb.CreateDeviceLinkRequest, sc *scope) error {
	certificate := request.GetDesktopCertificate()
	if certificate == nil || certificate.GetDevice().GetDeviceId() != sc.offer.DesktopDeviceID ||
		!proto.Equal(certificate.GetDevice().GetActor(), touchactor.ProtoActorRef(sc.actor)) ||
		!bytes.Equal(certificate.GetActorIdentityPublicKey(), sc.identity.PublicKey) ||
		!bytes.Equal(certificate.GetActorIdentityKeyFingerprint(), sc.identity.Fingerprint) ||
		!bytes.Equal(certificate.GetDeviceSigningPublicKey(), sc.approver.DeviceSigningPublicKey) ||
		certificate.GetSigningKeyId() != sc.approver.SigningKeyID ||
		certificate.GetFormatVersion() != 1 || certificate.GetObservedProfileVersion() != sc.identity.ProfileVersion {
		return link.Reject(pb.DeviceLinkErrorCode_DEVICE_LINK_ERROR_CODE_PROFILE_STALE)
	}
	raw, err := link.Encode(certificate)
	if err != nil {
		return err
	}
	return link.VerifySignature(sc.identity.PublicKey, "", raw, request.GetDesktopActorCrossSignature())
}
