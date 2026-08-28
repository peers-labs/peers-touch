package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	capabilityOperationStartCommand  = "start"
	capabilityOperationCancelCommand = "cancel"
	defaultOperationLeaseTTL         = 45 * time.Second
	defaultOperationCleanupTTL       = 2 * time.Minute
)

type CapabilityOperationService struct {
	db              *gorm.DB
	now             func() time.Time
	capabilityProof *ClientCapabilityProofService
}

func (s *CapabilityOperationService) SetCapabilityProofService(
	proof *ClientCapabilityProofService,
) {
	s.capabilityProof = proof
}

func NewCapabilityOperationService(db *gorm.DB) *CapabilityOperationService {
	return &CapabilityOperationService{
		db:  db,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (s *CapabilityOperationService) Start(
	ctx context.Context,
	ptid string,
	req *model.StartCapabilityOperationRequest,
) (*model.CapabilityOperation, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetCapabilityId()) == "" ||
		strings.TrimSpace(req.GetCapabilityVersion()) == "" ||
		strings.TrimSpace(req.GetOperationKind()) == "" ||
		strings.TrimSpace(req.GetTargetDeviceId()) == "" ||
		strings.TrimSpace(req.GetCapabilitySessionId()) == "" ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		req.GetDeadline() == nil {
		return nil, capabilityInvalid(
			"ptid, capability identity, operation_kind, target device, session, idempotency_key and deadline are required",
		)
	}
	now := s.now()
	deadline := req.GetDeadline().AsTime()
	if !deadline.After(now) {
		return nil, capabilityInvalid("capability operation deadline must be in the future")
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, capabilityInternal("hash capability operation request", err)
	}
	var operation *model.CapabilityOperation
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayCapabilityOperationCommand(
			tx, ptid, capabilityOperationStartCommand, req.GetIdempotencyKey(), payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			operation = capabilityOperationModel(replayed)
			return nil
		}
		if err := validateOperationManifestTx(
			tx, req.GetCapabilityId(), req.GetCapabilityVersion(),
		); err != nil {
			return err
		}
		lease, err := loadOperationCapabilityLeaseTx(
			tx, ptid, req.GetTargetDeviceId(), req.GetCapabilitySessionId(), now,
		)
		if err != nil {
			return err
		}
		dispatchSequence, err := nextOperationDispatchSequenceTx(tx, lease)
		if err != nil {
			return err
		}
		operationID := generateID("capability-operation")
		executorLeaseID := generateID("operation-lease")
		leaseExpiry := minTime(deadline, now.Add(defaultOperationLeaseTTL))
		record := &persistence.CapabilityOperation{
			OperationID:         operationID,
			IdempotencyKey:      req.GetIdempotencyKey(),
			PayloadHash:         payloadHash,
			Ptid:                ptid,
			CapabilityID:        strings.TrimSpace(req.GetCapabilityId()),
			CapabilityVersion:   strings.TrimSpace(req.GetCapabilityVersion()),
			TargetDeviceID:      strings.TrimSpace(req.GetTargetDeviceId()),
			CapabilitySessionID: strings.TrimSpace(req.GetCapabilitySessionId()),
			ExecutorLeaseID:     executorLeaseID,
			OperationKind:       strings.TrimSpace(req.GetOperationKind()),
			Status:              int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED),
			Attempt:             1,
			AttemptEpoch:        1,
			FencingToken:        1,
			Revision:            1,
			Deadline:            deadline,
			BoundedArguments:    append([]byte{}, req.GetBoundedArguments()...),
			DispatchSequence:    dispatchSequence,
			CreatedAt:           now,
			UpdatedAt:           now,
		}
		if err := tx.Create(record).Error; err != nil {
			return capabilityInternal("create capability operation", err)
		}
		operationLease := &persistence.CapabilityOperationLease{
			LeaseID:      executorLeaseID,
			OperationID:  operationID,
			AttemptEpoch: 1,
			FencingToken: 1,
			Ptid:         ptid,
			DeviceID:     lease.DeviceID,
			SessionID:    lease.SessionID,
			ExpiresAt:    leaseExpiry,
			CreatedAt:    now,
		}
		if err := tx.Create(operationLease).Error; err != nil {
			return capabilityInternal("create capability operation lease", err)
		}
		envelope, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			capabilityOperationModel(record),
		)
		if err != nil {
			return capabilityInternal("encode capability operation outbox", err)
		}
		outbox := &persistence.CapabilityOperationOutbox{
			OutboxID:       generateID("capability-operation-outbox"),
			OperationID:    operationID,
			AttemptEpoch:   1,
			FencingToken:   1,
			TargetDeviceID: lease.DeviceID,
			SessionID:      lease.SessionID,
			Sequence:       dispatchSequence,
			PayloadHash:    payloadHash,
			Envelope:       envelope,
			CreatedAt:      now,
		}
		if err := tx.Create(outbox).Error; err != nil {
			return capabilityInternal("create capability operation outbox", err)
		}
		if err := recordCapabilityOperationCommand(
			tx, ptid, capabilityOperationStartCommand, req.GetIdempotencyKey(),
			payloadHash, operationID, record.Revision, now,
		); err != nil {
			return err
		}
		operation = capabilityOperationModel(record)
		return nil
	})
	return operation, err
}

func (s *CapabilityOperationService) Get(
	ctx context.Context,
	ptid string,
	operationID string,
) (*model.CapabilityOperation, error) {
	var record persistence.CapabilityOperation
	err := s.db.WithContext(ctx).Where(
		"operation_id = ? AND ptid = ?",
		strings.TrimSpace(operationID),
		strings.TrimSpace(ptid),
	).First(&record).Error
	if err != nil {
		return nil, capabilityRecordError("capability operation", err)
	}
	return capabilityOperationModel(&record), nil
}

func (s *CapabilityOperationService) Cancel(
	ctx context.Context,
	ptid string,
	req *model.CancelCapabilityOperationRequest,
) (*model.CapabilityOperation, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetOperationId()) == "" ||
		req.GetExpectedRevision() == 0 ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" {
		return nil, capabilityInvalid(
			"ptid, operation_id, expected_revision and idempotency_key are required",
		)
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, capabilityInternal("hash capability cancellation", err)
	}
	var operation *model.CapabilityOperation
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayCapabilityOperationCommand(
			tx, ptid, capabilityOperationCancelCommand, req.GetIdempotencyKey(), payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			operation = capabilityOperationModel(replayed)
			return nil
		}
		var record persistence.CapabilityOperation
		if err := tx.Where(
			"operation_id = ? AND ptid = ?", req.GetOperationId(), ptid,
		).First(&record).Error; err != nil {
			return capabilityRecordError("capability operation", err)
		}
		if record.Revision != req.GetExpectedRevision() ||
			!capabilityOperationCancellable(model.CapabilityOperationStatus(record.Status)) {
			return capabilityConflict("capability operation revision or state conflict")
		}
		now := s.now()
		nextRevision := record.Revision + 1
		cleanupLeaseID := generateID("capability-cleanup-lease")
		cleanupDeadline := now.Add(defaultOperationCleanupTTL)
		update := tx.Model(&persistence.CapabilityOperation{}).
			Where("operation_id = ? AND ptid = ? AND revision = ?",
				record.OperationID, ptid, record.Revision).
			Updates(map[string]interface{}{
				"status":                   int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP),
				"desired_terminal_outcome": int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED),
				"cancel_requested_at":      now,
				"cleanup_lease_id":         cleanupLeaseID,
				"cleanup_epoch":            1,
				"cleanup_fencing_token":    1,
				"cleanup_deadline":         cleanupDeadline,
				"revision":                 nextRevision,
				"updated_at":               now,
			})
		if update.Error != nil {
			return capabilityInternal("cancel capability operation", update.Error)
		}
		if update.RowsAffected != 1 {
			return capabilityConflict("capability operation changed during cancellation")
		}
		cleanupLease := &persistence.CapabilityCleanupLease{
			LeaseID:      cleanupLeaseID,
			OperationID:  record.OperationID,
			CleanupEpoch: 1,
			FencingToken: 1,
			Ptid:         ptid,
			DeviceID:     record.TargetDeviceID,
			SessionID:    record.CapabilitySessionID,
			ExpiresAt:    minTime(cleanupDeadline, now.Add(defaultOperationLeaseTTL)),
			CreatedAt:    now,
		}
		if err := tx.Create(cleanupLease).Error; err != nil {
			return capabilityInternal("create capability cleanup lease", err)
		}
		if err := tx.Model(&persistence.CapabilityOperationLease{}).
			Where("lease_id = ? AND released_at IS NULL", record.ExecutorLeaseID).
			Update("released_at", now).Error; err != nil {
			return capabilityInternal("release capability operation lease", err)
		}
		record.Status = int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP)
		record.DesiredTerminalOutcome = int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED)
		record.CancelRequestedAt = &now
		record.CleanupLeaseID = cleanupLeaseID
		record.CleanupEpoch = 1
		record.CleanupFencingToken = 1
		record.CleanupDeadline = &cleanupDeadline
		record.Revision = nextRevision
		record.UpdatedAt = now
		if err := recordCapabilityOperationCommand(
			tx, ptid, capabilityOperationCancelCommand, req.GetIdempotencyKey(),
			payloadHash, record.OperationID, record.Revision, now,
		); err != nil {
			return err
		}
		operation = capabilityOperationModel(&record)
		return nil
	})
	return operation, err
}

func (s *CapabilityOperationService) ReportEvent(
	ctx context.Context,
	ptid string,
	req *model.ReportCapabilityOperationEventRequest,
) (*model.CapabilityOperation, bool, error) {
	return s.reportEvent(ctx, ptid, req, nil)
}

func (s *CapabilityOperationService) ReportEventVerified(
	ctx context.Context,
	ptid string,
	deviceID string,
	req *model.ReportCapabilityOperationEventRequest,
) (*model.CapabilityOperation, bool, error) {
	if s.capabilityProof == nil {
		return nil, false, capabilityInternal(
			"verify capability operation event",
			errors.New("proof service is not configured"),
		)
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		ptid,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REPORT_OPERATION_EVENT,
		req,
		req.GetCommandProof(),
	)
	if err != nil {
		return nil, false, err
	}
	return s.reportEvent(ctx, ptid, req, verified)
}

func (s *CapabilityOperationService) reportEvent(
	ctx context.Context,
	ptid string,
	req *model.ReportCapabilityOperationEventRequest,
	verified *VerifiedCapabilityCommand,
) (*model.CapabilityOperation, bool, error) {
	ptid = strings.TrimSpace(ptid)
	event := req.GetEvent()
	if ptid == "" || event == nil ||
		strings.TrimSpace(event.GetOperationId()) == "" ||
		event.GetAttemptEpoch() == 0 || event.GetSequence() == 0 ||
		event.GetFencingToken() == 0 {
		return nil, false, capabilityInvalid(
			"ptid and a fenced operation event with sequence are required",
		)
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, false, capabilityInternal("hash capability operation event", err)
	}
	var operation *model.CapabilityOperation
	replayed := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if verified != nil {
			if _, _, err := bindCapabilityCommandTx(
				tx,
				ptid,
				model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_REPORT_OPERATION_EVENT,
				verified,
				s.now(),
			); err != nil {
				return err
			}
		}
		var record persistence.CapabilityOperation
		if err := tx.Where(
			"operation_id = ? AND ptid = ?", event.GetOperationId(), ptid,
		).First(&record).Error; err != nil {
			return capabilityRecordError("capability operation", err)
		}
		var existing persistence.CapabilityOperationEvent
		eventErr := tx.Where(
			"operation_id = ? AND attempt_epoch = ? AND sequence = ?",
			record.OperationID, event.GetAttemptEpoch(), event.GetSequence(),
		).First(&existing).Error
		if eventErr == nil {
			if existing.PayloadHash != payloadHash {
				return capabilityConflict("capability operation event payload conflict")
			}
			replayed = true
			operation = capabilityOperationModel(&record)
			return nil
		}
		if !errors.Is(eventErr, gorm.ErrRecordNotFound) {
			return capabilityInternal("read capability operation event", eventErr)
		}
		if event.GetSequence() != record.LastEventSequence+1 {
			return capabilityConflict("capability operation event sequence is not monotonic")
		}
		now := s.now()
		if model.CapabilityOperationStatus(record.Status) ==
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP {
			if err := settleCapabilityOperationCleanupTx(tx, &record, req, now); err != nil {
				return err
			}
		} else {
			if err := applyCapabilityOperationBusinessEventTx(
				tx, &record, req, now,
			); err != nil {
				return err
			}
		}
		if err := createCapabilityOperationEventTx(
			tx, event, payloadHash, true, "", now,
		); err != nil {
			return err
		}
		operation = capabilityOperationModel(&record)
		return nil
	})
	if err != nil {
		if auditErr := s.recordRejectedEvent(
			ctx, ptid, event, payloadHash, capabilityOperationRejectionCode(err),
		); auditErr != nil {
			return nil, false, auditErr
		}
	}
	return operation, replayed, err
}

func (s *CapabilityOperationService) Pull(
	ctx context.Context,
	ptid string,
	deviceID string,
	req *model.PullCapabilityOperationsRequest,
) (*model.PullCapabilityOperationsResponse, error) {
	ptid = strings.TrimSpace(ptid)
	deviceID = strings.TrimSpace(deviceID)
	if ptid == "" || deviceID == "" || req == nil ||
		strings.TrimSpace(req.GetCapabilitySessionId()) == "" {
		return nil, capabilityInvalid("ptid, device_id and capability_session_id are required")
	}
	if req.GetDeviceId() != deviceID {
		return nil, errcode.New(
			errcode.AgentSecurityViolation,
			http.StatusForbidden,
			"operation pull device mismatch",
			nil,
		)
	}
	if s.capabilityProof == nil {
		return nil, capabilityInternal(
			"verify capability operation pull",
			errors.New("proof service is not configured"),
		)
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		ptid,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_OPERATIONS,
		req,
		req.GetCommandProof(),
	)
	if err != nil {
		return nil, err
	}
	limit := int(req.GetLimit())
	if limit <= 0 || limit > maxCapabilityPullLimit {
		limit = maxCapabilityPullLimit
	}
	response := &model.PullCapabilityOperationsResponse{}
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if _, _, err := bindCapabilityCommandTx(
			tx,
			ptid,
			model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_PULL_OPERATIONS,
			verified,
			s.now(),
		); err != nil {
			return err
		}
		lease, err := loadOperationCapabilityLeaseTx(
			tx, ptid, deviceID, req.GetCapabilitySessionId(), s.now(),
		)
		if err != nil {
			return err
		}
		var rows []persistence.CapabilityOperationOutbox
		if err := tx.Where(
			"target_device_id = ? AND session_id = ? AND sequence > ?",
			lease.DeviceID,
			lease.SessionID,
			req.GetAfterSequence(),
		).Order("sequence ASC").Limit(limit).Find(&rows).Error; err != nil {
			return capabilityInternal("pull capability operation outbox", err)
		}
		for _, row := range rows {
			var operation model.CapabilityOperation
			if err := proto.Unmarshal(row.Envelope, &operation); err != nil {
				return capabilityInternal("decode capability operation outbox", err)
			}
			response.Operations = append(response.Operations, &operation)
			if row.Sequence > response.LastSequence {
				response.LastSequence = row.Sequence
			}
		}
		if response.LastSequence < req.GetAfterSequence() {
			response.LastSequence = req.GetAfterSequence()
		}
		return nil
	})
	return response, err
}

func (s *CapabilityOperationService) Reconcile(
	ctx context.Context,
	ptid string,
	req *model.ReconcileCapabilityOperationRequest,
) (*model.ReconcileCapabilityOperationResponse, error) {
	if strings.TrimSpace(ptid) == "" || req == nil ||
		strings.TrimSpace(req.GetOperationId()) == "" {
		return nil, capabilityInvalid("ptid and operation_id are required")
	}
	operation, err := s.Get(ctx, ptid, req.GetOperationId())
	if err != nil {
		return nil, err
	}
	var rows []persistence.CapabilityOperationEvent
	if err := s.db.WithContext(ctx).
		Where("operation_id = ? AND sequence > ?", operation.GetOperationId(), req.GetAfterSequence()).
		Order("sequence ASC").
		Find(&rows).Error; err != nil {
		return nil, capabilityInternal("reconcile capability operation events", err)
	}
	events := make([]*model.CapabilityOperationEvent, 0, len(rows))
	for i := range rows {
		events = append(events, capabilityOperationEventModel(&rows[i]))
	}
	return &model.ReconcileCapabilityOperationResponse{
		Operation: operation,
		Events:    events,
	}, nil
}

func (s *CapabilityOperationService) TakeOver(
	ctx context.Context,
	ptid string,
	req *model.TakeOverCapabilityOperationRequest,
) (*model.CapabilityOperation, error) {
	return s.takeOver(ctx, ptid, req, nil)
}

func (s *CapabilityOperationService) TakeOverVerified(
	ctx context.Context,
	ptid string,
	deviceID string,
	req *model.TakeOverCapabilityOperationRequest,
) (*model.CapabilityOperation, error) {
	if s.capabilityProof == nil {
		return nil, capabilityInternal(
			"verify capability operation takeover",
			errors.New("proof service is not configured"),
		)
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		ptid,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_TAKE_OVER_OPERATION,
		req,
		req.GetCommandProof(),
	)
	if err != nil {
		return nil, err
	}
	return s.takeOver(ctx, ptid, req, verified)
}

func (s *CapabilityOperationService) takeOver(
	ctx context.Context,
	ptid string,
	req *model.TakeOverCapabilityOperationRequest,
	verified *VerifiedCapabilityCommand,
) (*model.CapabilityOperation, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetOperationId()) == "" ||
		req.GetExpectedRevision() == 0 ||
		strings.TrimSpace(req.GetTargetDeviceId()) == "" ||
		strings.TrimSpace(req.GetCapabilitySessionId()) == "" {
		return nil, capabilityInvalid(
			"ptid, operation_id, expected_revision, target device and session are required",
		)
	}
	var operation *model.CapabilityOperation
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if verified != nil {
			_, replayed, err := bindCapabilityCommandTx(
				tx,
				ptid,
				model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_TAKE_OVER_OPERATION,
				verified,
				s.now(),
			)
			if err != nil {
				return err
			}
			if replayed {
				var record persistence.CapabilityOperation
				if err := tx.Where(
					"operation_id = ? AND ptid = ?", req.GetOperationId(), ptid,
				).First(&record).Error; err != nil {
					return capabilityRecordError("capability operation", err)
				}
				operation = capabilityOperationModel(&record)
				return nil
			}
		}
		var record persistence.CapabilityOperation
		if err := tx.Where(
			"operation_id = ? AND ptid = ?", req.GetOperationId(), ptid,
		).First(&record).Error; err != nil {
			return capabilityRecordError("capability operation", err)
		}
		if record.Revision != req.GetExpectedRevision() ||
			!capabilityOperationTakeoverEligible(
				model.CapabilityOperationStatus(record.Status),
			) {
			return capabilityConflict("capability operation is not takeover eligible")
		}
		now := s.now()
		var previousLease persistence.CapabilityOperationLease
		if err := tx.Where(
			"lease_id = ? AND operation_id = ?",
			record.ExecutorLeaseID, record.OperationID,
		).First(&previousLease).Error; err != nil {
			return capabilityRecordError("capability operation lease", err)
		}
		if previousLease.ExpiresAt.After(now) && previousLease.ReleasedAt == nil {
			return capabilityConflict("capability operation lease has not expired")
		}
		if !record.Deadline.After(now) {
			return capabilityConflict("capability operation execution deadline has expired")
		}
		lease, err := loadOperationCapabilityLeaseTx(
			tx, ptid, req.GetTargetDeviceId(), req.GetCapabilitySessionId(), now,
		)
		if err != nil {
			return err
		}
		dispatchSequence, err := nextOperationDispatchSequenceTx(tx, lease)
		if err != nil {
			return err
		}
		if record.SideEffectStartedAt != nil &&
			strings.TrimSpace(req.GetExternalIdempotencyKey()) == "" {
			if err := transitionOperationToUnknownCleanupTx(tx, &record, lease, now); err != nil {
				return err
			}
			operation = capabilityOperationModel(&record)
			return nil
		}
		if req.GetCleanupOnly() {
			if err := transitionOperationToUnknownCleanupTx(tx, &record, lease, now); err != nil {
				return err
			}
			operation = capabilityOperationModel(&record)
			return nil
		}
		nextEpoch := record.AttemptEpoch + 1
		nextFence := record.FencingToken + 1
		nextRevision := record.Revision + 1
		newLeaseID := generateID("operation-lease")
		leaseExpiry := minTime(record.Deadline, now.Add(defaultOperationLeaseTTL))
		update := tx.Model(&persistence.CapabilityOperation{}).
			Where("operation_id = ? AND ptid = ? AND revision = ?",
				record.OperationID, ptid, record.Revision).
			Updates(map[string]interface{}{
				"target_device_id":         lease.DeviceID,
				"capability_session_id":    lease.SessionID,
				"executor_lease_id":        newLeaseID,
				"status":                   int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED),
				"attempt":                  record.Attempt + 1,
				"attempt_epoch":            nextEpoch,
				"fencing_token":            nextFence,
				"revision":                 nextRevision,
				"external_idempotency_key": strings.TrimSpace(req.GetExternalIdempotencyKey()),
				"dispatch_sequence":        dispatchSequence,
				"updated_at":               now,
			})
		if update.Error != nil {
			return capabilityInternal("take over capability operation", update.Error)
		}
		if update.RowsAffected != 1 {
			return capabilityConflict("capability operation changed during takeover")
		}
		if err := tx.Create(&persistence.CapabilityOperationLease{
			LeaseID: newLeaseID, OperationID: record.OperationID,
			AttemptEpoch: nextEpoch, FencingToken: nextFence, Ptid: ptid,
			DeviceID: lease.DeviceID, SessionID: lease.SessionID,
			ExpiresAt: leaseExpiry, CreatedAt: now,
		}).Error; err != nil {
			return capabilityInternal("create takeover operation lease", err)
		}
		if err := tx.Model(&persistence.CapabilityOperationLease{}).
			Where("lease_id = ? AND released_at IS NULL", previousLease.LeaseID).
			Update("released_at", now).Error; err != nil {
			return capabilityInternal("release prior operation lease", err)
		}
		record.TargetDeviceID = lease.DeviceID
		record.CapabilitySessionID = lease.SessionID
		record.ExecutorLeaseID = newLeaseID
		record.Status = int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED)
		record.Attempt++
		record.AttemptEpoch = nextEpoch
		record.FencingToken = nextFence
		record.Revision = nextRevision
		record.ExternalIdempotencyKey = strings.TrimSpace(req.GetExternalIdempotencyKey())
		record.DispatchSequence = dispatchSequence
		record.UpdatedAt = now
		envelope, err := proto.MarshalOptions{Deterministic: true}.Marshal(
			capabilityOperationModel(&record),
		)
		if err != nil {
			return capabilityInternal("encode takeover operation outbox", err)
		}
		if err := tx.Create(&persistence.CapabilityOperationOutbox{
			OutboxID:    generateID("capability-operation-outbox"),
			OperationID: record.OperationID, AttemptEpoch: nextEpoch,
			FencingToken: nextFence, TargetDeviceID: lease.DeviceID,
			SessionID: lease.SessionID, Sequence: dispatchSequence,
			PayloadHash: record.PayloadHash, Envelope: envelope, CreatedAt: now,
		}).Error; err != nil {
			return capabilityInternal("create takeover operation outbox", err)
		}
		operation = capabilityOperationModel(&record)
		return nil
	})
	return operation, err
}

func (s *CapabilityOperationService) TakeOverCleanup(
	ctx context.Context,
	ptid string,
	req *model.TakeOverCapabilityCleanupRequest,
) (*model.CapabilityOperation, error) {
	return s.takeOverCleanup(ctx, ptid, req, nil)
}

func (s *CapabilityOperationService) TakeOverCleanupVerified(
	ctx context.Context,
	ptid string,
	deviceID string,
	req *model.TakeOverCapabilityCleanupRequest,
) (*model.CapabilityOperation, error) {
	if s.capabilityProof == nil {
		return nil, capabilityInternal(
			"verify capability cleanup takeover",
			errors.New("proof service is not configured"),
		)
	}
	verified, err := s.capabilityProof.Verify(
		ctx,
		ptid,
		deviceID,
		model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_TAKE_OVER_CLEANUP,
		req,
		req.GetCommandProof(),
	)
	if err != nil {
		return nil, err
	}
	return s.takeOverCleanup(ctx, ptid, req, verified)
}

func (s *CapabilityOperationService) takeOverCleanup(
	ctx context.Context,
	ptid string,
	req *model.TakeOverCapabilityCleanupRequest,
	verified *VerifiedCapabilityCommand,
) (*model.CapabilityOperation, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetOperationId()) == "" ||
		req.GetExpectedCleanupEpoch() == 0 ||
		strings.TrimSpace(req.GetTargetDeviceId()) == "" ||
		strings.TrimSpace(req.GetCapabilitySessionId()) == "" {
		return nil, capabilityInvalid(
			"ptid, operation_id, expected cleanup epoch, target device and session are required",
		)
	}
	var operation *model.CapabilityOperation
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if verified != nil {
			_, replayed, err := bindCapabilityCommandTx(
				tx,
				ptid,
				model.ClientCapabilityCommandDomain_CLIENT_CAPABILITY_COMMAND_DOMAIN_TAKE_OVER_CLEANUP,
				verified,
				s.now(),
			)
			if err != nil {
				return err
			}
			if replayed {
				var record persistence.CapabilityOperation
				if err := tx.Where(
					"operation_id = ? AND ptid = ?", req.GetOperationId(), ptid,
				).First(&record).Error; err != nil {
					return capabilityRecordError("capability operation", err)
				}
				operation = capabilityOperationModel(&record)
				return nil
			}
		}
		var record persistence.CapabilityOperation
		if err := tx.Where(
			"operation_id = ? AND ptid = ?", req.GetOperationId(), ptid,
		).First(&record).Error; err != nil {
			return capabilityRecordError("capability operation", err)
		}
		if model.CapabilityOperationStatus(record.Status) !=
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP ||
			record.CleanupEpoch != req.GetExpectedCleanupEpoch() ||
			record.TargetDeviceID != strings.TrimSpace(req.GetTargetDeviceId()) {
			return capabilityConflict("capability cleanup epoch or state conflict")
		}
		now := s.now()
		if record.CleanupDeadline == nil || !record.CleanupDeadline.After(now) {
			return capabilityConflict("capability cleanup deadline has expired")
		}
		var prior persistence.CapabilityCleanupLease
		if err := tx.Where(
			"lease_id = ? AND operation_id = ?", record.CleanupLeaseID, record.OperationID,
		).First(&prior).Error; err != nil {
			return capabilityRecordError("capability cleanup lease", err)
		}
		if prior.ExpiresAt.After(now) && prior.ReleasedAt == nil {
			return capabilityConflict("capability cleanup lease has not expired")
		}
		lease, err := loadOperationCapabilityLeaseTx(
			tx, ptid, req.GetTargetDeviceId(), req.GetCapabilitySessionId(), now,
		)
		if err != nil {
			return err
		}
		nextEpoch := record.CleanupEpoch + 1
		nextFence := record.CleanupFencingToken + 1
		nextRevision := record.Revision + 1
		newLeaseID := generateID("capability-cleanup-lease")
		update := tx.Model(&persistence.CapabilityOperation{}).
			Where("operation_id = ? AND ptid = ? AND revision = ?",
				record.OperationID, ptid, record.Revision).
			Updates(map[string]interface{}{
				"cleanup_lease_id":      newLeaseID,
				"cleanup_epoch":         nextEpoch,
				"cleanup_fencing_token": nextFence,
				"revision":              nextRevision,
				"updated_at":            now,
			})
		if update.Error != nil {
			return capabilityInternal("take over capability cleanup", update.Error)
		}
		if update.RowsAffected != 1 {
			return capabilityConflict("capability operation changed during cleanup takeover")
		}
		if err := tx.Model(&persistence.CapabilityCleanupLease{}).
			Where("lease_id = ? AND released_at IS NULL", prior.LeaseID).
			Update("released_at", now).Error; err != nil {
			return capabilityInternal("release prior capability cleanup lease", err)
		}
		if err := tx.Create(&persistence.CapabilityCleanupLease{
			LeaseID: newLeaseID, OperationID: record.OperationID,
			CleanupEpoch: nextEpoch, FencingToken: nextFence, Ptid: ptid,
			DeviceID: lease.DeviceID, SessionID: lease.SessionID,
			ExpiresAt: minTime(*record.CleanupDeadline, now.Add(defaultOperationLeaseTTL)),
			CreatedAt: now,
		}).Error; err != nil {
			return capabilityInternal("create takeover cleanup lease", err)
		}
		record.CleanupLeaseID = newLeaseID
		record.CleanupEpoch = nextEpoch
		record.CleanupFencingToken = nextFence
		record.Revision = nextRevision
		record.UpdatedAt = now
		operation = capabilityOperationModel(&record)
		return nil
	})
	return operation, err
}

func (s *CapabilityOperationService) SweepCleanupDeadlines(
	ctx context.Context,
) (int64, error) {
	now := s.now()
	result := s.db.WithContext(ctx).Model(&persistence.CapabilityOperation{}).
		Where(
			"status = ? AND cleanup_deadline IS NOT NULL AND cleanup_deadline <= ?",
			int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP),
			now,
		).
		Updates(map[string]interface{}{
			"status":          int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CLEANUP_FAILED),
			"error_code":      int32(model.CapabilityOperationErrorCode_CAPABILITY_OPERATION_ERROR_CODE_CLEANUP_FAILED),
			"cleanup_outcome": "deadline_expired",
			"terminal_at":     now,
			"updated_at":      now,
			"revision":        gorm.Expr("revision + 1"),
		})
	if result.Error != nil {
		return 0, capabilityInternal("sweep capability cleanup deadlines", result.Error)
	}
	return result.RowsAffected, nil
}

func (s *CapabilityOperationService) SweepExecutionDeadlines(
	ctx context.Context,
) (int64, error) {
	now := s.now()
	activeStatuses := []int32{
		int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_PENDING),
		int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED),
		int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING),
		int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED),
		int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RECONNECTING),
		int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLING),
	}
	var operationIDs []string
	if err := s.db.WithContext(ctx).Model(&persistence.CapabilityOperation{}).
		Where("status IN ? AND deadline <= ?", activeStatuses, now).
		Order("operation_id").
		Pluck("operation_id", &operationIDs).Error; err != nil {
		return 0, capabilityInternal("list expired capability operations", err)
	}
	var transitioned int64
	for _, operationID := range operationIDs {
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var record persistence.CapabilityOperation
			if err := tx.Where("operation_id = ?", operationID).First(&record).Error; err != nil {
				return capabilityRecordError("capability operation", err)
			}
			if !capabilityOperationCancellable(
				model.CapabilityOperationStatus(record.Status),
			) || record.Deadline.After(now) {
				return nil
			}
			cleanupLeaseID := generateID("capability-cleanup-lease")
			cleanupDeadline := now.Add(defaultOperationCleanupTTL)
			nextRevision := record.Revision + 1
			update := tx.Model(&persistence.CapabilityOperation{}).
				Where("operation_id = ? AND revision = ?", record.OperationID, record.Revision).
				Updates(map[string]interface{}{
					"status": int32(
						model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP,
					),
					"desired_terminal_outcome": int32(
						model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_TIMED_OUT,
					),
					"cleanup_lease_id":      cleanupLeaseID,
					"cleanup_epoch":         uint64(1),
					"cleanup_fencing_token": uint64(1),
					"cleanup_deadline":      cleanupDeadline,
					"revision":              nextRevision,
					"updated_at":            now,
				})
			if update.Error != nil {
				return capabilityInternal("timeout capability operation", update.Error)
			}
			if update.RowsAffected != 1 {
				return nil
			}
			if err := tx.Create(&persistence.CapabilityCleanupLease{
				LeaseID: cleanupLeaseID, OperationID: record.OperationID,
				CleanupEpoch: 1, FencingToken: 1, Ptid: record.Ptid,
				DeviceID: record.TargetDeviceID, SessionID: record.CapabilitySessionID,
				ExpiresAt: minTime(cleanupDeadline, now.Add(defaultOperationLeaseTTL)),
				CreatedAt: now,
			}).Error; err != nil {
				return capabilityInternal("create timeout cleanup lease", err)
			}
			if err := tx.Model(&persistence.CapabilityOperationLease{}).
				Where("lease_id = ? AND released_at IS NULL", record.ExecutorLeaseID).
				Update("released_at", now).Error; err != nil {
				return capabilityInternal("release timed out operation lease", err)
			}
			transitioned++
			return nil
		})
		if err != nil {
			return transitioned, err
		}
	}
	return transitioned, nil
}

func applyCapabilityOperationBusinessEventTx(
	tx *gorm.DB,
	record *persistence.CapabilityOperation,
	req *model.ReportCapabilityOperationEventRequest,
	now time.Time,
) error {
	event := req.GetEvent()
	if strings.TrimSpace(req.GetTargetDeviceId()) != record.TargetDeviceID ||
		strings.TrimSpace(req.GetCapabilitySessionId()) != record.CapabilitySessionID ||
		strings.TrimSpace(req.GetExecutorLeaseId()) != record.ExecutorLeaseID ||
		event.GetAttemptEpoch() != record.AttemptEpoch ||
		event.GetFencingToken() != record.FencingToken {
		return capabilityConflict("capability operation event fence mismatch")
	}
	var lease persistence.CapabilityOperationLease
	if err := tx.Where(
		"lease_id = ? AND operation_id = ? AND attempt_epoch = ? AND fencing_token = ?",
		record.ExecutorLeaseID,
		record.OperationID,
		record.AttemptEpoch,
		record.FencingToken,
	).First(&lease).Error; err != nil {
		return capabilityRecordError("capability operation lease", err)
	}
	if lease.ReleasedAt != nil || !lease.ExpiresAt.After(now) {
		return capabilityConflict("capability operation lease is expired")
	}
	if !record.Deadline.After(now) {
		return capabilityConflict("capability operation execution deadline has expired")
	}
	nextStatus := event.GetStatus()
	if !capabilityOperationTransitionAllowed(
		model.CapabilityOperationStatus(record.Status), nextStatus,
	) {
		return capabilityConflict("invalid capability operation transition")
	}
	nextRevision := record.Revision + 1
	updates := map[string]interface{}{
		"status":              int32(nextStatus),
		"last_event_sequence": event.GetSequence(),
		"progress_percent":    event.GetProgressPercent(),
		"result_ref":          strings.TrimSpace(event.GetResultRef()),
		"revision":            nextRevision,
		"updated_at":          now,
	}
	if event.GetError() != nil {
		updates["error_code"] = int32(event.GetError().GetCode())
		updates["error_retryable"] = event.GetError().GetRetryable()
		updates["error_recovery_action"] = event.GetError().GetRecoveryAction()
	}
	if nextStatus == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING &&
		record.SideEffectStartedAt == nil {
		updates["side_effect_started_at"] = now
		record.SideEffectStartedAt = &now
	}
	if capabilityOperationOutcome(nextStatus) {
		cleanupLeaseID := generateID("capability-cleanup-lease")
		cleanupDeadline := now.Add(defaultOperationCleanupTTL)
		updates["status"] = int32(
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP,
		)
		updates["desired_terminal_outcome"] = int32(nextStatus)
		updates["cleanup_lease_id"] = cleanupLeaseID
		updates["cleanup_epoch"] = uint64(1)
		updates["cleanup_fencing_token"] = uint64(1)
		updates["cleanup_deadline"] = cleanupDeadline
		if err := tx.Create(&persistence.CapabilityCleanupLease{
			LeaseID: cleanupLeaseID, OperationID: record.OperationID,
			CleanupEpoch: 1, FencingToken: 1, Ptid: record.Ptid,
			DeviceID: record.TargetDeviceID, SessionID: record.CapabilitySessionID,
			ExpiresAt: minTime(cleanupDeadline, now.Add(defaultOperationLeaseTTL)),
			CreatedAt: now,
		}).Error; err != nil {
			return capabilityInternal("create terminal cleanup lease", err)
		}
		if err := tx.Model(&persistence.CapabilityOperationLease{}).
			Where("lease_id = ? AND released_at IS NULL", record.ExecutorLeaseID).
			Update("released_at", now).Error; err != nil {
			return capabilityInternal("release terminal business lease", err)
		}
		record.Status = int32(
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP,
		)
		record.DesiredTerminalOutcome = int32(nextStatus)
		record.CleanupLeaseID = cleanupLeaseID
		record.CleanupEpoch = 1
		record.CleanupFencingToken = 1
		record.CleanupDeadline = &cleanupDeadline
	} else {
		record.Status = int32(nextStatus)
	}
	update := tx.Model(&persistence.CapabilityOperation{}).
		Where("operation_id = ? AND revision = ?", record.OperationID, record.Revision).
		Updates(updates)
	if update.Error != nil {
		return capabilityInternal("apply capability operation event", update.Error)
	}
	if update.RowsAffected != 1 {
		return capabilityConflict("capability operation changed during event")
	}
	record.LastEventSequence = event.GetSequence()
	record.ProgressPercent = event.GetProgressPercent()
	record.ResultRef = strings.TrimSpace(event.GetResultRef())
	record.Revision = nextRevision
	record.UpdatedAt = now
	if event.GetError() != nil {
		record.ErrorCode = int32(event.GetError().GetCode())
		record.ErrorRetryable = event.GetError().GetRetryable()
		record.ErrorRecoveryAction = event.GetError().GetRecoveryAction()
	}
	return nil
}

func settleCapabilityOperationCleanupTx(
	tx *gorm.DB,
	record *persistence.CapabilityOperation,
	req *model.ReportCapabilityOperationEventRequest,
	now time.Time,
) error {
	event := req.GetEvent()
	if strings.TrimSpace(req.GetCleanupLeaseId()) != record.CleanupLeaseID ||
		req.GetCleanupEpoch() != record.CleanupEpoch ||
		req.GetCleanupFencingToken() != record.CleanupFencingToken {
		return capabilityConflict("capability cleanup event fence mismatch")
	}
	if strings.TrimSpace(req.GetCleanupOutcome()) == "" {
		return capabilityInvalid("cleanup_outcome is required for cleanup settlement")
	}
	var lease persistence.CapabilityCleanupLease
	if err := tx.Where(
		"lease_id = ? AND operation_id = ? AND cleanup_epoch = ? AND fencing_token = ?",
		record.CleanupLeaseID,
		record.OperationID,
		record.CleanupEpoch,
		record.CleanupFencingToken,
	).First(&lease).Error; err != nil {
		return capabilityRecordError("capability cleanup lease", err)
	}
	if strings.TrimSpace(req.GetTargetDeviceId()) != lease.DeviceID ||
		strings.TrimSpace(req.GetCapabilitySessionId()) != lease.SessionID ||
		event.GetAttemptEpoch() != record.AttemptEpoch ||
		event.GetFencingToken() != record.FencingToken {
		return capabilityConflict("capability cleanup executor scope mismatch")
	}
	if lease.ReleasedAt != nil || !lease.ExpiresAt.After(now) ||
		record.CleanupDeadline == nil || !record.CleanupDeadline.After(now) {
		return capabilityConflict("capability cleanup lease or deadline expired")
	}
	terminalStatus := model.CapabilityOperationStatus(record.DesiredTerminalOutcome)
	if strings.EqualFold(strings.TrimSpace(req.GetCleanupOutcome()), "failed") {
		terminalStatus =
			model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CLEANUP_FAILED
	}
	if event.GetStatus() != terminalStatus {
		return capabilityConflict("cleanup event terminal outcome mismatch")
	}
	nextRevision := record.Revision + 1
	update := tx.Model(&persistence.CapabilityOperation{}).
		Where("operation_id = ? AND revision = ? AND status = ?",
			record.OperationID,
			record.Revision,
			int32(model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP),
		).
		Updates(map[string]interface{}{
			"status":              int32(terminalStatus),
			"last_event_sequence": event.GetSequence(),
			"cleanup_outcome":     strings.TrimSpace(req.GetCleanupOutcome()),
			"cancel_ack_at":       now,
			"terminal_at":         now,
			"revision":            nextRevision,
			"updated_at":          now,
		})
	if update.Error != nil {
		return capabilityInternal("settle capability operation cleanup", update.Error)
	}
	if update.RowsAffected != 1 {
		return capabilityConflict("capability operation changed during cleanup settlement")
	}
	if err := tx.Model(&persistence.CapabilityCleanupLease{}).
		Where("lease_id = ? AND released_at IS NULL", record.CleanupLeaseID).
		Update("released_at", now).Error; err != nil {
		return capabilityInternal("release capability cleanup lease", err)
	}
	record.Status = int32(terminalStatus)
	record.LastEventSequence = event.GetSequence()
	record.CleanupOutcome = strings.TrimSpace(req.GetCleanupOutcome())
	record.CancelAckAt = &now
	record.TerminalAt = &now
	record.Revision = nextRevision
	record.UpdatedAt = now
	return nil
}

func createCapabilityOperationEventTx(
	tx *gorm.DB,
	event *model.CapabilityOperationEvent,
	payloadHash string,
	accepted bool,
	rejectionCode string,
	now time.Time,
) error {
	occurredAt := now
	if event.GetOccurredAt() != nil {
		occurredAt = event.GetOccurredAt().AsTime()
	}
	record := &persistence.CapabilityOperationEvent{
		ID:          generateID("capability-operation-event"),
		OperationID: event.GetOperationId(), AttemptEpoch: event.GetAttemptEpoch(),
		Sequence: event.GetSequence(), Status: int32(event.GetStatus()),
		FencingToken: event.GetFencingToken(), ProgressPercent: event.GetProgressPercent(),
		ResultRef: strings.TrimSpace(event.GetResultRef()), PayloadHash: payloadHash,
		Accepted: accepted, RejectionCode: rejectionCode,
		OccurredAt: occurredAt, CreatedAt: now,
	}
	if event.GetError() != nil {
		record.ErrorCode = int32(event.GetError().GetCode())
		record.ErrorRetryable = event.GetError().GetRetryable()
		record.RecoveryAction = event.GetError().GetRecoveryAction()
	}
	if err := tx.Create(record).Error; err != nil {
		return capabilityInternal("persist capability operation event", err)
	}
	return nil
}

func (s *CapabilityOperationService) recordRejectedEvent(
	ctx context.Context,
	ptid string,
	event *model.CapabilityOperationEvent,
	payloadHash string,
	reasonCode string,
) error {
	record := &persistence.CapabilityOperationEventRejection{
		ID:           generateID("capability-operation-event-rejection"),
		OperationID:  event.GetOperationId(),
		Ptid:         ptid,
		AttemptEpoch: event.GetAttemptEpoch(),
		Sequence:     event.GetSequence(),
		FencingToken: event.GetFencingToken(),
		PayloadHash:  payloadHash,
		ReasonCode:   reasonCode,
		CreatedAt:    s.now(),
	}
	if err := s.db.WithContext(ctx).Create(record).Error; err != nil {
		return capabilityInternal("persist rejected capability operation event", err)
	}
	return nil
}

func capabilityOperationRejectionCode(err error) string {
	var bizErr *errcode.BizError
	if errors.As(err, &bizErr) {
		return string(bizErr.Code)
	}
	return string(errcode.AgentInternal)
}

func transitionOperationToUnknownCleanupTx(
	tx *gorm.DB,
	record *persistence.CapabilityOperation,
	lease *persistence.ClientCapabilityLease,
	now time.Time,
) error {
	cleanupLeaseID := generateID("capability-cleanup-lease")
	cleanupDeadline := now.Add(defaultOperationCleanupTTL)
	nextRevision := record.Revision + 1
	update := tx.Model(&persistence.CapabilityOperation{}).
		Where("operation_id = ? AND revision = ?", record.OperationID, record.Revision).
		Updates(map[string]interface{}{
			"status": int32(
				model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP,
			),
			"desired_terminal_outcome": int32(
				model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_UNKNOWN_SIDE_EFFECT,
			),
			"cleanup_lease_id":      cleanupLeaseID,
			"cleanup_epoch":         uint64(1),
			"cleanup_fencing_token": uint64(1),
			"cleanup_deadline":      cleanupDeadline,
			"revision":              nextRevision,
			"updated_at":            now,
		})
	if update.Error != nil {
		return capabilityInternal("fence ambiguous capability operation", update.Error)
	}
	if update.RowsAffected != 1 {
		return capabilityConflict("capability operation changed during ambiguity fencing")
	}
	if err := tx.Create(&persistence.CapabilityCleanupLease{
		LeaseID: cleanupLeaseID, OperationID: record.OperationID,
		CleanupEpoch: 1, FencingToken: 1, Ptid: record.Ptid,
		DeviceID: lease.DeviceID, SessionID: lease.SessionID,
		ExpiresAt: minTime(cleanupDeadline, now.Add(defaultOperationLeaseTTL)),
		CreatedAt: now,
	}).Error; err != nil {
		return capabilityInternal("create ambiguous cleanup lease", err)
	}
	if err := tx.Model(&persistence.CapabilityOperationLease{}).
		Where("lease_id = ? AND released_at IS NULL", record.ExecutorLeaseID).
		Update("released_at", now).Error; err != nil {
		return capabilityInternal("release ambiguous business lease", err)
	}
	record.Status = int32(
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SETTLING_CLEANUP,
	)
	record.DesiredTerminalOutcome = int32(
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_UNKNOWN_SIDE_EFFECT,
	)
	record.CleanupLeaseID = cleanupLeaseID
	record.CleanupEpoch = 1
	record.CleanupFencingToken = 1
	record.CleanupDeadline = &cleanupDeadline
	record.Revision = nextRevision
	record.UpdatedAt = now
	return nil
}

func validateOperationManifestTx(
	tx *gorm.DB,
	capabilityID string,
	version string,
) error {
	var manifest persistence.CapabilityManifest
	err := tx.Where(
		"capability_id = ? AND version = ? AND retired_at IS NULL",
		strings.TrimSpace(capabilityID),
		strings.TrimSpace(version),
	).First(&manifest).Error
	if err != nil {
		return capabilityRecordError("active capability manifest", err)
	}
	if model.CapabilityAvailability(manifest.Availability) ==
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED {
		return errcode.New(
			errcode.AgentInvalidSourceState,
			http.StatusConflict,
			"capability manifest is blocked",
			nil,
		)
	}
	return nil
}

func loadOperationCapabilityLeaseTx(
	tx *gorm.DB,
	ptid string,
	deviceID string,
	sessionID string,
	now time.Time,
) (*persistence.ClientCapabilityLease, error) {
	var lease persistence.ClientCapabilityLease
	err := tx.Where(
		"actor_id = ? AND device_id = ? AND session_id = ? AND revoked_at IS NULL AND expires_at > ?",
		ptid,
		strings.TrimSpace(deviceID),
		strings.TrimSpace(sessionID),
		now,
	).First(&lease).Error
	if err != nil {
		return nil, capabilityRecordError("active client capability lease", err)
	}
	return &lease, nil
}

func nextOperationDispatchSequenceTx(
	tx *gorm.DB,
	lease *persistence.ClientCapabilityLease,
) (uint64, error) {
	next := lease.DispatchSequence + 1
	result := tx.Model(&persistence.ClientCapabilityLease{}).
		Where(
			"session_id = ? AND lease_revision = ? AND dispatch_sequence = ? AND revoked_at IS NULL",
			lease.SessionID,
			lease.LeaseRevision,
			lease.DispatchSequence,
		).
		Update("dispatch_sequence", next)
	if result.Error != nil {
		return 0, capabilityInternal("allocate capability operation sequence", result.Error)
	}
	if result.RowsAffected != 1 {
		return 0, capabilityConflict("capability session sequence changed")
	}
	lease.DispatchSequence = next
	return next, nil
}

func replayCapabilityOperationCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
) (*persistence.CapabilityOperation, error) {
	var command persistence.CapabilityOperationCommand
	err := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		ptid, commandKind, idempotencyKey,
	).First(&command).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, capabilityInternal("read capability operation command", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"capability operation idempotency payload mismatch",
			nil,
		)
	}
	var operation persistence.CapabilityOperation
	if err := tx.Where(
		"operation_id = ? AND ptid = ?", command.OperationID, ptid,
	).First(&operation).Error; err != nil {
		return nil, capabilityInternal("replay capability operation", err)
	}
	return &operation, nil
}

func recordCapabilityOperationCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
	operationID string,
	revision uint64,
	now time.Time,
) error {
	command := &persistence.CapabilityOperationCommand{
		CommandID:      generateID("capability-operation-command"),
		Ptid:           ptid,
		CommandKind:    commandKind,
		IdempotencyKey: idempotencyKey,
		PayloadHash:    payloadHash,
		OperationID:    operationID,
		Revision:       revision,
		CreatedAt:      now,
	}
	if err := tx.Create(command).Error; err != nil {
		return capabilityInternal("record capability operation command", err)
	}
	return nil
}

func capabilityOperationModel(
	record *persistence.CapabilityOperation,
) *model.CapabilityOperation {
	result := &model.CapabilityOperation{
		OperationId:            record.OperationID,
		IdempotencyKey:         record.IdempotencyKey,
		PayloadHash:            record.PayloadHash,
		Ptid:                   record.Ptid,
		CapabilityId:           record.CapabilityID,
		CapabilityVersion:      record.CapabilityVersion,
		TargetDeviceId:         record.TargetDeviceID,
		CapabilitySessionId:    record.CapabilitySessionID,
		ExecutorLeaseId:        record.ExecutorLeaseID,
		OperationKind:          record.OperationKind,
		Status:                 model.CapabilityOperationStatus(record.Status),
		Attempt:                record.Attempt,
		AttemptEpoch:           record.AttemptEpoch,
		FencingToken:           record.FencingToken,
		Revision:               record.Revision,
		Deadline:               timestamppb.New(record.Deadline),
		LastEventSequence:      record.LastEventSequence,
		DesiredTerminalOutcome: model.CapabilityOperationStatus(record.DesiredTerminalOutcome),
		CleanupLeaseId:         record.CleanupLeaseID,
		CleanupEpoch:           record.CleanupEpoch,
		CleanupFencingToken:    record.CleanupFencingToken,
		ProgressPercent:        record.ProgressPercent,
		ProgressMessage:        record.ProgressMessage,
		ResultRef:              record.ResultRef,
		CleanupOutcome:         record.CleanupOutcome,
		BoundedArguments:       append([]byte{}, record.BoundedArguments...),
		ExternalIdempotencyKey: record.ExternalIdempotencyKey,
		DispatchSequence:        record.DispatchSequence,
		CreatedAt:              timestamppb.New(record.CreatedAt),
		UpdatedAt:              timestamppb.New(record.UpdatedAt),
	}
	if record.CancelRequestedAt != nil {
		result.CancelRequestedAt = timestamppb.New(*record.CancelRequestedAt)
	}
	if record.CancelAckAt != nil {
		result.CancelAckAt = timestamppb.New(*record.CancelAckAt)
	}
	if record.CleanupDeadline != nil {
		result.CleanupDeadline = timestamppb.New(*record.CleanupDeadline)
	}
	if record.SideEffectStartedAt != nil {
		result.SideEffectStartedAt = timestamppb.New(*record.SideEffectStartedAt)
	}
	if record.TerminalAt != nil {
		result.TerminalAt = timestamppb.New(*record.TerminalAt)
	}
	if record.ErrorCode != 0 || record.ErrorRecoveryAction != "" {
		result.Error = &model.CapabilityOperationError{
			Code:           model.CapabilityOperationErrorCode(record.ErrorCode),
			Retryable:      record.ErrorRetryable,
			RecoveryAction: record.ErrorRecoveryAction,
		}
	}
	return result
}

func capabilityOperationTerminal(status model.CapabilityOperationStatus) bool {
	switch status {
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_TIMED_OUT,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_FAILED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CLEANUP_FAILED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_UNKNOWN_SIDE_EFFECT:
		return true
	default:
		return false
	}
}

func capabilityOperationOutcome(status model.CapabilityOperationStatus) bool {
	switch status {
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_SUCCEEDED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_TIMED_OUT,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_FAILED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_UNKNOWN_SIDE_EFFECT:
		return true
	default:
		return false
	}
}

func capabilityOperationCancellable(status model.CapabilityOperationStatus) bool {
	switch status {
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_PENDING,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RECONNECTING,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_CANCELLING:
		return true
	default:
		return false
	}
}

func capabilityOperationTakeoverEligible(status model.CapabilityOperationStatus) bool {
	switch status {
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED,
		model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RECONNECTING:
		return true
	default:
		return false
	}
}

func capabilityOperationTransitionAllowed(
	from model.CapabilityOperationStatus,
	to model.CapabilityOperationStatus,
) bool {
	switch from {
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED:
		return to == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING ||
			to == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED ||
			capabilityOperationOutcome(to)
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING:
		return to == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED ||
			capabilityOperationOutcome(to)
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISCONNECTED:
		return to == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RECONNECTING ||
			capabilityOperationOutcome(to)
	case model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RECONNECTING:
		return to == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_DISPATCHED ||
			to == model.CapabilityOperationStatus_CAPABILITY_OPERATION_STATUS_RUNNING ||
			capabilityOperationOutcome(to)
	default:
		return false
	}
}

func capabilityOperationEventModel(
	record *persistence.CapabilityOperationEvent,
) *model.CapabilityOperationEvent {
	result := &model.CapabilityOperationEvent{
		OperationId:     record.OperationID,
		AttemptEpoch:    record.AttemptEpoch,
		Sequence:        record.Sequence,
		Status:          model.CapabilityOperationStatus(record.Status),
		FencingToken:    record.FencingToken,
		ProgressPercent: record.ProgressPercent,
		ResultRef:       record.ResultRef,
		OccurredAt:      timestamppb.New(record.OccurredAt),
	}
	if record.ErrorCode != 0 || record.RecoveryAction != "" {
		result.Error = &model.CapabilityOperationError{
			Code:           model.CapabilityOperationErrorCode(record.ErrorCode),
			Retryable:      record.ErrorRetryable,
			RecoveryAction: record.RecoveryAction,
		}
	}
	return result
}

func minTime(left, right time.Time) time.Time {
	if left.Before(right) {
		return left
	}
	return right
}
