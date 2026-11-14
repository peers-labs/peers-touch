// Package application orchestrates claimant-first login approval transactions.
// It coordinates only its own state; Access, Session and Actor Identity remain
// behind ports implemented by their existing owners (wired in DLA-02).
package application

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	link "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/domain"
	rows "github.com/peers-labs/peers-touch/station/app/subserver/login_approval/infrastructure/persistence"
	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	pb "github.com/peers-labs/peers-touch/station/frame/touch/model/loginapproval"
	"gorm.io/gorm"
)

// AttemptBinding is the resolved result of a credential-passed Access attempt.
type AttemptBinding struct {
	UserID              uint64
	ActorPTID           string
	StationPeerID       string
	EnrolledDeviceCount int
}

// AttemptOwner verifies the no-session create request references an attempt
// that already passed credential verification. The real Access gate supplies
// the production implementation; tests use a deterministic fake.
type AttemptOwner interface {
	ResolveCredentialAttempt(ctx context.Context, tx *gorm.DB, attemptID string,
		revision uint64, claimantDeviceID string) (*AttemptBinding, error)
}

// ApproverOwner validates that the authenticated subject is an enrolled,
// active device of the transaction Actor and distinct from the claimant.
type ApproverOwner interface {
	RequireApprover(ctx context.Context, tx *gorm.DB, actorPTID, claimantDeviceID string) (string, error)
}

type Service struct {
	Database func(context.Context) (*gorm.DB, error)
	Attempts AttemptOwner
	Approver ApproverOwner
	Clock    func() time.Time
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

func rejectInvalid(ok bool) error {
	if ok {
		return nil
	}
	return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
}

func validateCreate(request *pb.CreateLoginApprovalRequest) error {
	if request == nil {
		return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	return rejectInvalid(
		link.Identifier(request.GetRequestId(), 128) &&
			link.Identifier(request.GetAccessAttemptId(), 128) &&
			link.Identifier(request.GetStationPeerId(), 255) &&
			link.Identifier(request.GetClaimantDeviceId(), 128) &&
			link.ValidPlatform(request.GetPlatform()) &&
			len(request.GetDeviceLabel()) <= 128 &&
			len(request.GetClaimantHpkePublicKey()) == 32 &&
			len(request.GetClaimantDeviceSigningPublicKey()) == 32)
}

// Create is callable without a session. It succeeds only when the referenced
// Access attempt has already passed credential verification.
func (s *Service) Create(ctx context.Context, request *pb.CreateLoginApprovalRequest) (*pb.CreateLoginApprovalResponse, error) {
	if err := validateCreate(request); err != nil {
		return nil, err
	}
	raw, err := link.Encode(request)
	if err != nil {
		return nil, err
	}
	var response *pb.CreateLoginApprovalResponse
	err = s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		binding, err := s.Attempts.ResolveCredentialAttempt(ctx, tx, request.GetAccessAttemptId(),
			request.GetAccessDecisionRevision(), request.GetClaimantDeviceId())
		if err != nil {
			return err
		}
		if binding.StationPeerID != request.GetStationPeerId() || binding.EnrolledDeviceCount == 0 {
			// No enrolled device means there is no approver; the caller must use
			// the first-device path instead of waiting forever.
			return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_NO_APPROVER_ELIGIBLE)
		}

		// Idempotent replay of the exact same command returns the original row.
		var existing rows.Transaction
		find := tx.Where("actor_ptid = ? AND request_id = ?", binding.ActorPTID, request.GetRequestId()).First(&existing).Error
		if find == nil {
			if !bytesEqual(existing.RequestDigest, link.Digest(raw)) {
				return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
			}
			return s.replayResponse(tx, &existing, &response)
		}
		if !errors.Is(find, gorm.ErrRecordNotFound) {
			return find
		}

		var pending int64
		if err := tx.Model(&rows.Transaction{}).
			Where("actor_ptid = ? AND state = ?", binding.ActorPTID, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING).
			Count(&pending).Error; err != nil {
			return err
		}
		if pending >= link.MaxPendingPerActor {
			return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPACITY_EXCEEDED)
		}

		approvalID := uuid.NewString()
		transcriptDigest := link.Digest(append([]byte(approvalID), raw...))
		capability, err := link.Random(32)
		if err != nil {
			return err
		}
		expires := now.Add(link.TTL)
		record := rows.Transaction{
			ID: approvalID, StationPeerID: binding.StationPeerID, UserID: binding.UserID,
			ActorPTID: binding.ActorPTID, AccessAttemptID: request.GetAccessAttemptId(),
			AccessRevision: request.GetAccessDecisionRevision(), RequestID: request.GetRequestId(),
			RequestDigest: link.Digest(raw), ClaimantDeviceID: request.GetClaimantDeviceId(),
			Platform: request.GetPlatform(), DeviceLabel: request.GetDeviceLabel(),
			ClaimantHPKEKey:    request.GetClaimantHpkePublicKey(),
			ClaimantSigningKey: request.GetClaimantDeviceSigningPublicKey(),
			ComparisonCode:     link.ComparisonCode(transcriptDigest), State: pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING,
			Revision: 1, TranscriptDigest: transcriptDigest, CreatedAt: now, ExpiresAt: expires,
		}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		if err := tx.Create(&rows.Capability{ApprovalID: approvalID,
			CapabilityHash: link.Digest(capability), CreatedAt: now}).Error; err != nil {
			return err
		}
		if err := audit(tx, approvalID, binding.ActorPTID, "", 1, "create", now); err != nil {
			return err
		}
		response = &pb.CreateLoginApprovalResponse{ApprovalId: approvalID, ClaimantCapability: capability,
			ComparisonCode: record.ComparisonCode, Revision: 1, ExpiresAtUnixMs: expires.UnixMilli()}
		return nil
	})
	return response, err
}

func (s *Service) replayResponse(tx *gorm.DB, record *rows.Transaction, response **pb.CreateLoginApprovalResponse) error {
	var capability rows.Capability
	if err := tx.Where("approval_id = ?", record.ID).First(&capability).Error; err != nil {
		return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVAL_NOT_FOUND)
	}
	// The possession secret cannot be reconstructed from its hash; an exact
	// replay after a lost response must cancel and re-create. Surface a typed
	// terminal signal rather than pretending the secret is recoverable.
	return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPABILITY_INVALID)
}

func (s *Service) loadOwned(tx *gorm.DB, approvalID string, now time.Time) (*rows.Transaction, error) {
	if !link.Identifier(approvalID, 128) {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	var record rows.Transaction
	if err := tx.Clauses(gormForUpdate()).Where("id = ?", approvalID).First(&record).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVAL_NOT_FOUND)
		}
		return nil, err
	}
	if !link.Terminal(record.State) && !record.ExpiresAt.After(now) {
		record.State = pb.LoginApprovalState_LOGIN_APPROVAL_STATE_EXPIRED
		record.Reason = pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVAL_EXPIRED
		if err := save(tx, &record); err != nil {
			return nil, err
		}
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVAL_EXPIRED)
	}
	return &record, nil
}

func (s *Service) requireCapability(tx *gorm.DB, approvalID string, secret []byte) error {
	var capability rows.Capability
	if err := tx.Where("approval_id = ?", approvalID).First(&capability).Error; err != nil {
		return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPABILITY_INVALID)
	}
	if !link.SameSecret(secret, capability.CapabilityHash) {
		return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPABILITY_INVALID)
	}
	return nil
}

// Status is the claimant's polling read, authorized by the possession secret.
func (s *Service) Status(ctx context.Context, request *pb.LoginApprovalStatusRequest) (*pb.LoginApprovalStatusResponse, error) {
	if request == nil || !link.Identifier(request.GetApprovalId(), 128) || len(request.GetClaimantCapability()) != 32 {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	var projection *pb.LoginApprovalProjection
	err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		record, err := s.loadOwned(tx, request.GetApprovalId(), now)
		if err != nil {
			return err
		}
		if err := s.requireCapability(tx, record.ID, request.GetClaimantCapability()); err != nil {
			return err
		}
		if request.GetObservedRevision() != 0 && request.GetObservedRevision() > record.Revision {
			return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT)
		}
		projection = project(record)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &pb.LoginApprovalStatusResponse{Status: projection}, nil
}

// Cancel lets the claimant abandon a still-pending request.
func (s *Service) Cancel(ctx context.Context, request *pb.CancelLoginApprovalRequest) (*pb.CancelLoginApprovalResponse, error) {
	if request == nil || !link.Identifier(request.GetApprovalId(), 128) || len(request.GetClaimantCapability()) != 32 {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	var projection *pb.LoginApprovalProjection
	err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		record, err := s.loadOwned(tx, request.GetApprovalId(), now)
		if err != nil {
			return err
		}
		if err := s.requireCapability(tx, record.ID, request.GetClaimantCapability()); err != nil {
			return err
		}
		if record.State != pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING {
			return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT)
		}
		record.State = pb.LoginApprovalState_LOGIN_APPROVAL_STATE_CANCELLED
		if err := cas(tx, record, request.GetObservedRevision()); err != nil {
			return err
		}
		if err := audit(tx, record.ID, record.ActorPTID, "", record.Revision, "cancel", now); err != nil {
			return err
		}
		projection = project(record)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &pb.CancelLoginApprovalResponse{Status: projection}, nil
}

// ListPending returns the authenticated Actor's own pending approvals. It never
// exposes accounts or devices of other Actors.
func (s *Service) ListPending(ctx context.Context, request *pb.ListPendingLoginApprovalsRequest) (*pb.ListPendingLoginApprovalsResponse, error) {
	subject := coreauth.GetSubject(ctx)
	if subject == nil || subject.ID == "" {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_CAPABILITY_INVALID)
	}
	var approvals []*pb.PendingLoginApproval
	err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		var records []rows.Transaction
		if err := tx.Where("actor_ptid = ? AND state = ? AND expires_at > ?",
			subject.ID, pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING, now).
			Order("created_at DESC").Limit(link.MaxPendingList).Find(&records).Error; err != nil {
			return err
		}
		for _, record := range records {
			approvals = append(approvals, &pb.PendingLoginApproval{
				ApprovalId: record.ID, Actor: subjectActor(subject), ClaimantDeviceId: record.ClaimantDeviceID,
				Platform: record.Platform, DeviceLabel: record.DeviceLabel, ComparisonCode: record.ComparisonCode,
				ExpiresAtUnixMs: record.ExpiresAt.UnixMilli(), Revision: record.Revision,
				ClaimantHpkePublicKey:          record.ClaimantHPKEKey,
				ClaimantDeviceSigningPublicKey: record.ClaimantSigningKey,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &pb.ListPendingLoginApprovalsResponse{Approvals: approvals}, nil
}

// Approve moves a pending transaction to APPROVED and stores the HPKE identity
// envelope bound to the approval transcript. The downstream Access re-evaluation
// and Session activation stay with their owners in DLA-02.
func (s *Service) Approve(ctx context.Context, request *pb.ApproveLoginApprovalRequest) (*pb.ApproveLoginApprovalResponse, error) {
	if request == nil || !link.Identifier(request.GetApprovalId(), 128) ||
		request.GetIdentityMaterial() == nil || len(request.GetApproverTranscriptSignature()) == 0 {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	var projection *pb.LoginApprovalProjection
	err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		record, err := s.loadOwned(tx, request.GetApprovalId(), now)
		if err != nil {
			return err
		}
		deviceID, err := s.Approver.RequireApprover(ctx, tx, record.ActorPTID, record.ClaimantDeviceID)
		if err != nil {
			return err
		}
		if record.State != pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING {
			return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT)
		}
		envelope, err := link.Encode(request.GetIdentityMaterial())
		if err != nil {
			return err
		}
		record.State = pb.LoginApprovalState_LOGIN_APPROVAL_STATE_APPROVED
		record.ApproverDeviceID = deviceID
		record.IdentityEnvelope = envelope
		record.ApproverSignature = request.GetApproverTranscriptSignature()
		if err := cas(tx, record, request.GetObservedRevision()); err != nil {
			return err
		}
		if err := audit(tx, record.ID, record.ActorPTID, deviceID, record.Revision, "approve", now); err != nil {
			return err
		}
		projection = project(record)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &pb.ApproveLoginApprovalResponse{Status: projection}, nil
}

// Deny terminates a pending request with an explicit actor decision.
func (s *Service) Deny(ctx context.Context, request *pb.DenyLoginApprovalRequest) (*pb.DenyLoginApprovalResponse, error) {
	if request == nil || !link.Identifier(request.GetApprovalId(), 128) {
		return nil, link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_INVALID_ARGUMENT)
	}
	var projection *pb.LoginApprovalProjection
	err := s.transaction(ctx, func(tx *gorm.DB, now time.Time) error {
		record, err := s.loadOwned(tx, request.GetApprovalId(), now)
		if err != nil {
			return err
		}
		deviceID, err := s.Approver.RequireApprover(ctx, tx, record.ActorPTID, record.ClaimantDeviceID)
		if err != nil {
			return err
		}
		if record.State != pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING {
			return link.Reject(pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_REVISION_CONFLICT)
		}
		record.State = pb.LoginApprovalState_LOGIN_APPROVAL_STATE_DENIED
		record.Reason = pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_UNSPECIFIED
		if err := cas(tx, record, request.GetObservedRevision()); err != nil {
			return err
		}
		if err := audit(tx, record.ID, record.ActorPTID, deviceID, record.Revision, "deny", now); err != nil {
			return err
		}
		projection = project(record)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &pb.DenyLoginApprovalResponse{Status: projection}, nil
}

// Sweep expires uncommitted transactions past their TTL.
func (s *Service) Sweep(ctx context.Context) (int64, error) {
	database, err := s.Database(ctx)
	if err != nil {
		return 0, err
	}
	now := s.Clock().UTC()
	var swept int64
	err = database.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var due []rows.Transaction
		if err := tx.Where("state IN ? AND expires_at <= ?",
			[]pb.LoginApprovalState{
				pb.LoginApprovalState_LOGIN_APPROVAL_STATE_PENDING,
				pb.LoginApprovalState_LOGIN_APPROVAL_STATE_APPROVED,
			}, now).Find(&due).Error; err != nil {
			return err
		}
		for _, record := range due {
			record.State = pb.LoginApprovalState_LOGIN_APPROVAL_STATE_EXPIRED
			record.Reason = pb.LoginApprovalErrorCode_LOGIN_APPROVAL_ERROR_CODE_APPROVAL_EXPIRED
			record.Revision++
			if err := tx.Model(&rows.Transaction{}).Where("id = ? AND revision = ?", record.ID, record.Revision-1).
				Select("*").Updates(&record).Error; err != nil {
				return err
			}
			if err := audit(tx, record.ID, record.ActorPTID, "", record.Revision, "expire", now); err != nil {
				return err
			}
			swept++
		}
		return nil
	})
	return swept, err
}
