package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/domain"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	capabilityManifestRetireCommand  = "retire"
	capabilityBindingUpsertCommand   = "upsert"
	capabilityBindingDeleteCommand   = "delete"
	maxCapabilityIdempotencyKeyBytes = 160
)

type CapabilityAuthorityService struct {
	db       *gorm.DB
	eventBus domain.EventBus
	now      func() time.Time
}

func NewCapabilityAuthorityService(db *gorm.DB) *CapabilityAuthorityService {
	return &CapabilityAuthorityService{
		db:  db,
		now: func() time.Time { return time.Now().UTC() },
	}
}

func (s *CapabilityAuthorityService) SetEventBus(eventBus domain.EventBus) {
	s.eventBus = eventBus
}

func (s *CapabilityAuthorityService) RegisterManifest(
	ctx context.Context,
	manifest *model.CapabilityManifest,
) (*model.CapabilityManifest, error) {
	var created *model.CapabilityManifest
	mutated := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		created, mutated, txErr = s.registerManifestTx(tx, manifest)
		return txErr
	})
	if err == nil && mutated {
		s.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRegistered,
			created,
		)
	}
	return created, err
}

func (s *CapabilityAuthorityService) registerManifestTx(
	tx *gorm.DB,
	manifest *model.CapabilityManifest,
) (*model.CapabilityManifest, bool, error) {
	if manifest == nil ||
		strings.TrimSpace(manifest.GetCapabilityId()) == "" ||
		strings.TrimSpace(manifest.GetVersion()) == "" {
		return nil, false, capabilityInvalid("capability_id and version are required")
	}
	if err := validateCapabilityManifest(manifest); err != nil {
		return nil, false, err
	}
	normalized := proto.Clone(manifest).(*model.CapabilityManifest)
	normalized.CapabilityId = strings.TrimSpace(normalized.GetCapabilityId())
	normalized.Version = strings.TrimSpace(normalized.GetVersion())
	normalized.RetiredAt = nil
	normalized.RetiredByPtid = ""
	normalized.RetirementReason = ""
	normalized.OwnerPtid = strings.TrimSpace(normalized.GetOwnerPtid())
	now := s.now()
	normalized.CreatedAt = timestamppb.New(now)
	payloadHash, err := capabilityManifestContentHash(normalized)
	if err != nil {
		return nil, false, capabilityInternal("failed to hash capability manifest", err)
	}
	record, err := capabilityManifestRecord(normalized, payloadHash, now)
	if err != nil {
		return nil, false, err
	}
	result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(record)
	if result.Error != nil {
		return nil, false, capabilityInternal("failed to register capability manifest", result.Error)
	}
	if result.RowsAffected == 1 {
		return capabilityManifestModel(record), true, nil
	}

	var existing persistence.CapabilityManifest
	if err := tx.
		Where("capability_id = ? AND version = ?", record.CapabilityID, record.Version).
		First(&existing).Error; err != nil {
		return nil, false, capabilityInternal("failed to load existing capability manifest", err)
	}
	if existing.PayloadHash != payloadHash {
		return nil, false, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"capability manifest version is immutable",
			nil,
		)
	}
	return capabilityManifestModel(&existing), false, nil
}

func (s *CapabilityAuthorityService) ListManifests(
	ctx context.Context,
	ptid string,
	sourceKinds []model.CapabilitySourceKind,
) ([]*model.CapabilityManifest, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return nil, capabilityInvalid("ptid is required")
	}
	query := s.db.WithContext(ctx).
		Model(&persistence.CapabilityManifest{}).
		Where("owner_ptid = ? OR owner_ptid = ?", "", ptid)
	if len(sourceKinds) > 0 {
		values := make([]int32, 0, len(sourceKinds))
		for _, kind := range sourceKinds {
			values = append(values, int32(kind))
		}
		query = query.Where("source_kind IN ?", values)
	}
	var records []persistence.CapabilityManifest
	if err := query.Order("capability_id, version").Find(&records).Error; err != nil {
		return nil, capabilityInternal("failed to list capability manifests", err)
	}
	result := make([]*model.CapabilityManifest, 0, len(records))
	for i := range records {
		result = append(result, capabilityManifestModel(&records[i]))
	}
	return result, nil
}

func (s *CapabilityAuthorityService) RetireManifest(
	ctx context.Context,
	ptid string,
	req *model.RetireCapabilityManifestRequest,
) (*model.CapabilityManifest, error) {
	var result *model.CapabilityManifest
	mutated := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var txErr error
		result, mutated, txErr = s.retireManifestTx(tx, ptid, req)
		return txErr
	})
	if err == nil && mutated {
		s.publishManifestInvalidations(
			ctx,
			domain.AgentAuthorityInvalidationManifestRetired,
			result,
		)
	}
	return result, err
}

func (s *CapabilityAuthorityService) retireManifestTx(
	tx *gorm.DB,
	ptid string,
	req *model.RetireCapabilityManifestRequest,
) (*model.CapabilityManifest, bool, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetCapabilityId()) == "" ||
		strings.TrimSpace(req.GetVersion()) == "" ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxCapabilityIdempotencyKeyBytes ||
		strings.TrimSpace(req.GetReason()) == "" {
		return nil, false, capabilityInvalid(
			"ptid, capability_id, version, idempotency_key and reason are required",
		)
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, false, capabilityInternal("failed to hash manifest retirement command", err)
	}
	var result *model.CapabilityManifest
	mutated := false
	var command persistence.CapabilityManifestCommand
	commandErr := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		ptid, capabilityManifestRetireCommand, req.GetIdempotencyKey(),
	).First(&command).Error
	if commandErr == nil {
		if command.PayloadHash != payloadHash {
			return nil, false, errcode.New(
				errcode.AgentIdempotencyConflict,
				http.StatusConflict,
				"idempotency key payload mismatch",
				nil,
			)
		}
		var record persistence.CapabilityManifest
		if err := tx.Where(
			"capability_id = ? AND version = ?", command.CapabilityID, command.Version,
		).First(&record).Error; err != nil {
			return nil, false, capabilityInternal("failed to replay manifest retirement", err)
		}
		return capabilityManifestModel(&record), false, nil
	}
	if !errors.Is(commandErr, gorm.ErrRecordNotFound) {
		return nil, false, capabilityInternal(
			"failed to read manifest retirement command",
			commandErr,
		)
	}
	var record persistence.CapabilityManifest
	if err := tx.Where(
		"capability_id = ? AND version = ?",
		strings.TrimSpace(req.GetCapabilityId()), strings.TrimSpace(req.GetVersion()),
	).First(&record).Error; err != nil {
		return nil, false, capabilityRecordError("capability manifest", err)
	}
	if record.OwnerPtid != "" && record.OwnerPtid != ptid {
		return nil, false, capabilityRecordError("capability manifest", gorm.ErrRecordNotFound)
	}
	if record.RetiredAt != nil {
		return nil, false, capabilityConflict("capability manifest is already retired")
	}
	now := s.now()
	update := tx.Model(&persistence.CapabilityManifest{}).
		Where("capability_id = ? AND version = ? AND retired_at IS NULL",
			record.CapabilityID, record.Version).
		Updates(map[string]interface{}{
			"availability":      int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED),
			"retired_at":        now,
			"retired_by_ptid":   ptid,
			"retirement_reason": strings.TrimSpace(req.GetReason()),
		})
	if update.Error != nil {
		return nil, false, capabilityInternal("failed to retire capability manifest", update.Error)
	}
	if update.RowsAffected != 1 {
		return nil, false, capabilityConflict("capability manifest changed during retirement")
	}
	command = persistence.CapabilityManifestCommand{
		ID:             generateID("capability-manifest-command"),
		Ptid:           ptid,
		CommandKind:    capabilityManifestRetireCommand,
		IdempotencyKey: req.GetIdempotencyKey(),
		PayloadHash:    payloadHash,
		CapabilityID:   record.CapabilityID,
		Version:        record.Version,
		CreatedAt:      now,
	}
	if err := tx.Create(&command).Error; err != nil {
		return nil, false, capabilityInternal("failed to record manifest retirement", err)
	}
	record.Availability = int32(model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED)
	record.RetiredAt = &now
	record.RetiredByPtid = ptid
	record.RetirementReason = strings.TrimSpace(req.GetReason())
	result = capabilityManifestModel(&record)
	mutated = true
	return result, mutated, nil
}

func (s *CapabilityAuthorityService) ListBindings(
	ctx context.Context,
	ptid string,
	agentID string,
) ([]*model.AgentCapabilityBinding, error) {
	ptid = strings.TrimSpace(ptid)
	agentID = strings.TrimSpace(agentID)
	if ptid == "" || agentID == "" {
		return nil, capabilityInvalid("ptid and agent_id are required")
	}
	var agent persistence.Agent
	if err := s.db.WithContext(ctx).
		Where("id = ? AND owner_actor_id = ?", agentID, ptid).
		First(&agent).Error; err != nil {
		return nil, capabilityRecordError("owned agent", err)
	}
	var records []persistence.AgentCapabilityBinding
	if err := s.db.WithContext(ctx).
		Where("ptid = ? AND agent_id = ? AND tombstoned_at IS NULL", ptid, agentID).
		Order("binding_id").
		Find(&records).Error; err != nil {
		return nil, capabilityInternal("failed to list capability bindings", err)
	}
	result := make([]*model.AgentCapabilityBinding, 0, len(records))
	for i := range records {
		result = append(result, capabilityBindingModel(&records[i]))
	}
	return result, nil
}

func (s *CapabilityAuthorityService) StoreReadinessSnapshot(
	ctx context.Context,
	snapshot *model.CapabilityReadinessSnapshot,
) (*model.CapabilityReadinessSnapshot, error) {
	if snapshot == nil || strings.TrimSpace(snapshot.GetSnapshotId()) == "" ||
		strings.TrimSpace(snapshot.GetPtid()) == "" ||
		strings.TrimSpace(snapshot.GetAgentId()) == "" ||
		snapshot.GetCreatedAt() == nil || snapshot.GetExpiresAt() == nil {
		return nil, capabilityInvalid(
			"snapshot_id, ptid, agent_id, created_at and expires_at are required",
		)
	}
	canonical := proto.Clone(snapshot).(*model.CapabilityReadinessSnapshot)
	createdAt := snapshot.GetCreatedAt().AsTime().UTC().Truncate(time.Microsecond)
	expiresAt := snapshot.GetExpiresAt().AsTime().UTC().Truncate(time.Microsecond)
	canonical.CreatedAt = timestamppb.New(createdAt)
	canonical.ExpiresAt = timestamppb.New(expiresAt)
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(canonical)
	if err != nil {
		return nil, capabilityInternal("failed to encode readiness snapshot", err)
	}
	payloadHash := sha256.Sum256(payload)
	record := &persistence.CapabilityReadinessSnapshot{
		SnapshotID:  strings.TrimSpace(canonical.GetSnapshotId()),
		Ptid:        strings.TrimSpace(canonical.GetPtid()),
		AgentID:     strings.TrimSpace(canonical.GetAgentId()),
		Payload:     payload,
		PayloadHash: hex.EncodeToString(payloadHash[:]),
		CreatedAt:   createdAt,
		ExpiresAt:   expiresAt,
	}
	if err := s.db.WithContext(ctx).Create(record).Error; err == nil {
		return canonical, nil
	}
	var existing persistence.CapabilityReadinessSnapshot
	if err := s.db.WithContext(ctx).Where("snapshot_id = ?", record.SnapshotID).
		First(&existing).Error; err != nil {
		return nil, capabilityInternal("failed to store readiness snapshot", err)
	}
	if existing.Ptid != record.Ptid || existing.PayloadHash != record.PayloadHash {
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"readiness snapshot is immutable",
			nil,
		)
	}
	replayed := &model.CapabilityReadinessSnapshot{}
	if err := proto.Unmarshal(existing.Payload, replayed); err != nil {
		return nil, capabilityInternal("failed to decode readiness snapshot", err)
	}
	return replayed, nil
}

func (s *CapabilityAuthorityService) UpsertBinding(
	ctx context.Context,
	ptid string,
	req *model.UpsertAgentCapabilityBindingRequest,
) (*model.AgentCapabilityBinding, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || req.GetBinding() == nil ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxCapabilityIdempotencyKeyBytes {
		return nil, capabilityInvalid("ptid, binding and idempotency_key are required")
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, capabilityInternal("failed to hash binding command", err)
	}
	var result *model.AgentCapabilityBinding
	mutated := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		binding, changed, upsertErr := s.upsertBindingCommandTx(
			ctx,
			tx,
			ptid,
			req,
			payloadHash,
		)
		if upsertErr != nil {
			return upsertErr
		}
		result = binding
		mutated = changed
		return nil
	})
	if err != nil {
		if replayed, replayErr := replayBindingCommand(
			s.db.WithContext(ctx),
			ptid,
			capabilityBindingUpsertCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		); replayErr != nil {
			return nil, replayErr
		} else if replayed != nil {
			return replayed, nil
		}
		return nil, err
	}
	if mutated {
		s.publishBindingInvalidation(
			ctx,
			domain.AgentAuthorityInvalidationBindingUpsert,
			result,
		)
	}
	return result, err
}

func (s *CapabilityAuthorityService) upsertBindingCommandTx(
	ctx context.Context,
	tx *gorm.DB,
	ptid string,
	req *model.UpsertAgentCapabilityBindingRequest,
	payloadHash string,
) (*model.AgentCapabilityBinding, bool, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || req.GetBinding() == nil ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxCapabilityIdempotencyKeyBytes {
		return nil, false, capabilityInvalid(
			"ptid, binding and idempotency_key are required",
		)
	}
	if strings.TrimSpace(payloadHash) == "" {
		return nil, false, capabilityInvalid("binding payload hash is required")
	}
	tx = tx.WithContext(ctx)
	replayed, err := replayBindingCommand(
		tx,
		ptid,
		capabilityBindingUpsertCommand,
		req.GetIdempotencyKey(),
		payloadHash,
	)
	if err != nil || replayed != nil {
		return replayed, false, err
	}
	binding, err := s.upsertBinding(tx, ptid, req)
	if err != nil {
		return nil, false, err
	}
	if err := recordBindingCommand(
		tx,
		ptid,
		capabilityBindingUpsertCommand,
		req.GetIdempotencyKey(),
		payloadHash,
		binding,
		s.now(),
	); err != nil {
		return nil, false, err
	}
	return binding, true, nil
}

func (s *CapabilityAuthorityService) DeleteBinding(
	ctx context.Context,
	ptid string,
	req *model.DeleteAgentCapabilityBindingRequest,
) (*model.AgentCapabilityBinding, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil || strings.TrimSpace(req.GetBindingId()) == "" ||
		req.GetExpectedBindingRevision() == 0 ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxCapabilityIdempotencyKeyBytes {
		return nil, capabilityInvalid(
			"ptid, binding_id, expected_binding_revision and idempotency_key are required",
		)
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, capabilityInternal("failed to hash binding delete command", err)
	}
	var result *model.AgentCapabilityBinding
	mutated := false
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayBindingCommand(
			tx, ptid, capabilityBindingDeleteCommand, req.GetIdempotencyKey(), payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			result = replayed
			return nil
		}
		var record persistence.AgentCapabilityBinding
		if err := tx.Where("binding_id = ? AND ptid = ?", req.GetBindingId(), ptid).
			First(&record).Error; err != nil {
			return capabilityRecordError("capability binding", err)
		}
		if record.TombstonedAt != nil || record.Revision != req.GetExpectedBindingRevision() {
			return capabilityConflict("capability binding revision conflict")
		}
		now := s.now()
		nextRevision := record.Revision + 1
		update := tx.Model(&persistence.AgentCapabilityBinding{}).
			Where("binding_id = ? AND ptid = ? AND revision = ? AND tombstoned_at IS NULL",
				record.BindingID, ptid, record.Revision).
			Updates(map[string]interface{}{
				"revision":           nextRevision,
				"updated_at":         now,
				"tombstoned_at":      now,
				"tombstoned_by_ptid": ptid,
				"tombstone_reason":   strings.TrimSpace(req.GetReason()),
			})
		if update.Error != nil {
			return capabilityInternal("failed to tombstone capability binding", update.Error)
		}
		if update.RowsAffected != 1 {
			return capabilityConflict("capability binding changed during deletion")
		}
		record.Revision = nextRevision
		record.UpdatedAt = now
		record.TombstonedAt = &now
		record.TombstonedByPtid = ptid
		record.TombstoneReason = strings.TrimSpace(req.GetReason())
		if commandErr := recordBindingCommand(
			tx, ptid, capabilityBindingDeleteCommand, req.GetIdempotencyKey(),
			payloadHash, capabilityBindingModel(&record), now,
		); commandErr != nil {
			return commandErr
		}
		result = capabilityBindingModel(&record)
		mutated = true
		return nil
	})
	if err != nil {
		if replayed, replayErr := replayBindingCommand(
			s.db.WithContext(ctx),
			ptid,
			capabilityBindingDeleteCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		); replayErr != nil {
			return nil, replayErr
		} else if replayed != nil {
			return replayed, nil
		}
		return nil, err
	}
	if mutated {
		s.publishBindingInvalidation(
			ctx,
			domain.AgentAuthorityInvalidationBindingDelete,
			result,
		)
	}
	return result, err
}

func (s *CapabilityAuthorityService) upsertBinding(
	tx *gorm.DB,
	ptid string,
	req *model.UpsertAgentCapabilityBindingRequest,
) (*model.AgentCapabilityBinding, error) {
	input := req.GetBinding()
	agentID := strings.TrimSpace(input.GetAgentId())
	capabilityID := strings.TrimSpace(input.GetCapabilityId())
	capabilityVersion := strings.TrimSpace(input.GetCapabilityVersion())
	if agentID == "" || capabilityID == "" || capabilityVersion == "" ||
		input.GetExpectedAgentVersion() == 0 {
		return nil, capabilityInvalid(
			"agent_id, capability_id, capability_version and expected_agent_version are required",
		)
	}
	if input.GetApprovalPolicy() ==
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_UNSPECIFIED {
		return nil, capabilityInvalid("approval_policy is required")
	}
	var agent persistence.Agent
	if err := tx.Where("id = ? AND owner_actor_id = ?", agentID, ptid).First(&agent).Error; err != nil {
		return nil, capabilityRecordError("owned agent", err)
	}
	if uint64(agent.Version) != input.GetExpectedAgentVersion() {
		return nil, capabilityConflict("agent version conflict")
	}
	var manifest persistence.CapabilityManifest
	if err := tx.Where(
		"capability_id = ? AND version = ? AND retired_at IS NULL",
		capabilityID, capabilityVersion,
	).First(&manifest).Error; err != nil {
		return nil, capabilityRecordError("active capability manifest", err)
	}
	if manifest.OwnerPtid != "" && manifest.OwnerPtid != ptid {
		return nil, capabilityRecordError("active capability manifest", gorm.ErrRecordNotFound)
	}
	now := s.now()
	bindingID := strings.TrimSpace(input.GetBindingId())
	if bindingID == "" {
		if req.GetExpectedBindingRevision() != 0 {
			return nil, capabilityConflict("new capability binding cannot have an expected revision")
		}
		record := &persistence.AgentCapabilityBinding{
			BindingID:         generateID("capability-binding"),
			Ptid:              ptid,
			AgentID:           agentID,
			CapabilityID:      capabilityID,
			CapabilityVersion: capabilityVersion,
			Enabled:           input.GetEnabled(),
			ApprovalPolicy:    int32(input.GetApprovalPolicy()),
			AgentVersion:      input.GetExpectedAgentVersion(),
			Revision:          1,
			UpdatedAt:         now,
		}
		if err := tx.Create(record).Error; err != nil {
			return nil, capabilityInternal("failed to create capability binding", err)
		}
		return capabilityBindingModel(record), nil
	}
	if req.GetExpectedBindingRevision() == 0 {
		return nil, capabilityInvalid("expected_binding_revision is required for update")
	}
	var record persistence.AgentCapabilityBinding
	if err := tx.Where("binding_id = ? AND ptid = ? AND tombstoned_at IS NULL", bindingID, ptid).
		First(&record).Error; err != nil {
		return nil, capabilityRecordError("capability binding", err)
	}
	if record.AgentID != agentID || record.Revision != req.GetExpectedBindingRevision() {
		return nil, capabilityConflict("capability binding revision or agent mismatch")
	}
	nextRevision := record.Revision + 1
	update := tx.Model(&persistence.AgentCapabilityBinding{}).
		Where("binding_id = ? AND ptid = ? AND revision = ? AND tombstoned_at IS NULL",
			bindingID, ptid, record.Revision).
		Updates(map[string]interface{}{
			"capability_id":      capabilityID,
			"capability_version": capabilityVersion,
			"enabled":            input.GetEnabled(),
			"approval_policy":    int32(input.GetApprovalPolicy()),
			"agent_version":      input.GetExpectedAgentVersion(),
			"revision":           nextRevision,
			"updated_at":         now,
		})
	if update.Error != nil {
		return nil, capabilityInternal("failed to update capability binding", update.Error)
	}
	if update.RowsAffected != 1 {
		return nil, capabilityConflict("capability binding changed during update")
	}
	record.CapabilityID = capabilityID
	record.CapabilityVersion = capabilityVersion
	record.Enabled = input.GetEnabled()
	record.ApprovalPolicy = int32(input.GetApprovalPolicy())
	record.AgentVersion = input.GetExpectedAgentVersion()
	record.Revision = nextRevision
	record.UpdatedAt = now
	return capabilityBindingModel(&record), nil
}

func capabilityProtoHash(value proto.Message) (string, error) {
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:]), nil
}

func capabilityManifestContentHash(manifest *model.CapabilityManifest) (string, error) {
	canonical := proto.Clone(manifest).(*model.CapabilityManifest)
	canonical.CreatedAt = nil
	canonical.RetiredAt = nil
	canonical.RetiredByPtid = ""
	canonical.RetirementReason = ""
	return capabilityProtoHash(canonical)
}

func validateCapabilityManifest(manifest *model.CapabilityManifest) error {
	if manifest.GetSourceKind() ==
		model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_UNSPECIFIED {
		return capabilityInvalid("source_kind is required")
	}
	if manifest.GetExecutionOwner() ==
		model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_UNSPECIFIED {
		return capabilityInvalid("execution_owner is required")
	}
	if manifest.GetDefaultApprovalPolicy() ==
		model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_UNSPECIFIED {
		return capabilityInvalid("default_approval_policy is required")
	}
	if manifest.GetAvailability() ==
		model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNSPECIFIED {
		return capabilityInvalid("availability is required")
	}
	return nil
}

func capabilityManifestRecord(
	manifest *model.CapabilityManifest,
	payloadHash string,
	now time.Time,
) (*persistence.CapabilityManifest, error) {
	displayMetadata, err := json.Marshal(manifest.GetDisplayMetadata())
	if err != nil {
		return nil, capabilityInternal("failed to encode manifest display metadata", err)
	}
	requiredCapabilities, err := json.Marshal(manifest.GetRequiredRuntimeCapabilities())
	if err != nil {
		return nil, capabilityInternal("failed to encode required runtime capabilities", err)
	}
	return &persistence.CapabilityManifest{
		CapabilityID:             manifest.GetCapabilityId(),
		Version:                  manifest.GetVersion(),
		SourceKind:               int32(manifest.GetSourceKind()),
		SourceInstanceID:         strings.TrimSpace(manifest.GetSourceInstanceId()),
		DisplayMetadataJSON:      string(displayMetadata),
		InputSchemaRef:           strings.TrimSpace(manifest.GetInputSchemaRef()),
		OutputSchemaRef:          strings.TrimSpace(manifest.GetOutputSchemaRef()),
		ExecutionOwner:           int32(manifest.GetExecutionOwner()),
		RequiredCapabilitiesJSON: string(requiredCapabilities),
		RiskClass:                strings.TrimSpace(manifest.GetRiskClass()),
		DefaultApprovalPolicy:    int32(manifest.GetDefaultApprovalPolicy()),
		SecretBoundary:           strings.TrimSpace(manifest.GetSecretBoundary()),
		Availability:             int32(manifest.GetAvailability()),
		PayloadHash:              payloadHash,
		CreatedAt:                now,
		OwnerPtid:                manifest.GetOwnerPtid(),
	}, nil
}

func capabilityManifestModel(record *persistence.CapabilityManifest) *model.CapabilityManifest {
	var displayMetadata model.CapabilityDisplayMetadata
	_ = json.Unmarshal([]byte(record.DisplayMetadataJSON), &displayMetadata)
	var requiredCapabilities []string
	_ = json.Unmarshal([]byte(record.RequiredCapabilitiesJSON), &requiredCapabilities)
	result := &model.CapabilityManifest{
		CapabilityId:                record.CapabilityID,
		Version:                     record.Version,
		SourceKind:                  model.CapabilitySourceKind(record.SourceKind),
		SourceInstanceId:            record.SourceInstanceID,
		DisplayMetadata:             &displayMetadata,
		InputSchemaRef:              record.InputSchemaRef,
		OutputSchemaRef:             record.OutputSchemaRef,
		ExecutionOwner:              model.ToolExecutionOwner(record.ExecutionOwner),
		RequiredRuntimeCapabilities: requiredCapabilities,
		RiskClass:                   record.RiskClass,
		DefaultApprovalPolicy:       model.CapabilityApprovalPolicy(record.DefaultApprovalPolicy),
		SecretBoundary:              record.SecretBoundary,
		Availability:                model.CapabilityAvailability(record.Availability),
		CreatedAt:                   timestamppb.New(record.CreatedAt),
		RetiredByPtid:               record.RetiredByPtid,
		RetirementReason:            record.RetirementReason,
		OwnerPtid:                   record.OwnerPtid,
	}
	if record.RetiredAt != nil {
		result.RetiredAt = timestamppb.New(*record.RetiredAt)
	}
	return result
}

func capabilityBindingModel(record *persistence.AgentCapabilityBinding) *model.AgentCapabilityBinding {
	result := &model.AgentCapabilityBinding{
		BindingId:            record.BindingID,
		Ptid:                 record.Ptid,
		AgentId:              record.AgentID,
		CapabilityId:         record.CapabilityID,
		CapabilityVersion:    record.CapabilityVersion,
		Enabled:              record.Enabled,
		ApprovalPolicy:       model.CapabilityApprovalPolicy(record.ApprovalPolicy),
		ExpectedAgentVersion: record.AgentVersion,
		Revision:             record.Revision,
		UpdatedAt:            timestamppb.New(record.UpdatedAt),
		TombstonedByPtid:     record.TombstonedByPtid,
		TombstoneReason:      record.TombstoneReason,
	}
	if record.TombstonedAt != nil {
		result.TombstonedAt = timestamppb.New(*record.TombstonedAt)
	}
	return result
}

func replayBindingCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
) (*model.AgentCapabilityBinding, error) {
	var command persistence.CapabilityBindingCommand
	err := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		ptid, commandKind, idempotencyKey,
	).First(&command).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, capabilityInternal("failed to read binding command", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			http.StatusConflict,
			"idempotency key payload mismatch",
			nil,
		)
	}
	if len(command.ResultPayload) > 0 {
		result := &model.AgentCapabilityBinding{}
		if err := proto.Unmarshal(command.ResultPayload, result); err != nil {
			return nil, capabilityInternal("failed to decode capability binding command", err)
		}
		return result, nil
	}
	var binding persistence.AgentCapabilityBinding
	if err := tx.Where("binding_id = ? AND ptid = ?", command.BindingID, ptid).
		First(&binding).Error; err != nil {
		return nil, capabilityInternal("failed to replay capability binding", err)
	}
	return capabilityBindingModel(&binding), nil
}

func recordBindingCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
	binding *model.AgentCapabilityBinding,
	now time.Time,
) error {
	resultPayload, err := proto.MarshalOptions{Deterministic: true}.Marshal(binding)
	if err != nil {
		return capabilityInternal("failed to encode capability binding command", err)
	}
	record := &persistence.CapabilityBindingCommand{
		ID:             generateID("capability-command"),
		Ptid:           ptid,
		CommandKind:    commandKind,
		IdempotencyKey: idempotencyKey,
		PayloadHash:    payloadHash,
		BindingID:      binding.GetBindingId(),
		Revision:       binding.GetRevision(),
		ResultPayload:  resultPayload,
		CreatedAt:      now,
	}
	if err := tx.Create(record).Error; err != nil {
		return capabilityInternal("failed to record binding command", err)
	}
	return nil
}

func (s *CapabilityAuthorityService) publishBindingInvalidation(
	ctx context.Context,
	reason domain.AgentAuthorityInvalidationReason,
	binding *model.AgentCapabilityBinding,
) {
	if s.eventBus == nil || binding == nil {
		return
	}
	payload := domain.AgentAuthorityInvalidation{
		Reason:          reason,
		AgentID:         binding.GetAgentId(),
		AgentVersion:    binding.GetExpectedAgentVersion(),
		BindingID:       binding.GetBindingId(),
		BindingRevision: binding.GetRevision(),
	}
	if err := s.eventBus.Publish(ctx, domain.DomainEvent{
		EventID:    generateID("event"),
		EventType:  string(domain.EventTypeAgentAuthorityInvalidated),
		OccurredAt: s.now(),
		ActorPTID:  binding.GetPtid(),
		Payload:    payload,
		Metadata: map[string]string{
			"agent_id":   binding.GetAgentId(),
			"binding_id": binding.GetBindingId(),
		},
	}); err != nil {
		logger.Errorf(ctx, "failed to publish capability binding invalidation: actor_id=%s agent_id=%s binding_id=%s err=%v",
			binding.GetPtid(), binding.GetAgentId(), binding.GetBindingId(), err)
	}
}

func (s *CapabilityAuthorityService) publishManifestInvalidations(
	ctx context.Context,
	reason domain.AgentAuthorityInvalidationReason,
	manifest *model.CapabilityManifest,
) {
	if s.eventBus == nil || manifest == nil {
		return
	}
	var agents []persistence.Agent
	query := s.db.WithContext(ctx).
		Select("id", "owner_actor_id", "version").
		Model(&persistence.Agent{})
	if ownerPtid := strings.TrimSpace(manifest.GetOwnerPtid()); ownerPtid != "" {
		query = query.Where("owner_actor_id = ?", ownerPtid)
	}
	if err := query.Find(&agents).Error; err != nil {
		logger.Errorf(
			ctx,
			"failed to load agents for capability catalog invalidation: capability_id=%s capability_version=%s err=%v",
			manifest.GetCapabilityId(),
			manifest.GetVersion(),
			err,
		)
		return
	}
	for i := range agents {
		payload := domain.AgentAuthorityInvalidation{
			Reason:            reason,
			AgentID:           agents[i].ID,
			AgentVersion:      uint64(agents[i].Version),
			CapabilityID:      manifest.GetCapabilityId(),
			CapabilityVersion: manifest.GetVersion(),
		}
		if err := s.eventBus.Publish(ctx, domain.DomainEvent{
			EventID:    generateID("event"),
			EventType:  string(domain.EventTypeAgentAuthorityInvalidated),
			OccurredAt: s.now(),
			ActorPTID:  agents[i].OwnerActorPTID,
			Payload:    payload,
			Metadata: map[string]string{
				"agent_id":           agents[i].ID,
				"capability_id":      manifest.GetCapabilityId(),
				"capability_version": manifest.GetVersion(),
			},
		}); err != nil {
			logger.Errorf(
				ctx,
				"failed to publish capability catalog invalidation: actor_id=%s agent_id=%s capability_id=%s capability_version=%s err=%v",
					agents[i].OwnerActorPTID,
				agents[i].ID,
				manifest.GetCapabilityId(),
				manifest.GetVersion(),
				err,
			)
		}
	}
}

func capabilityConflict(message string) error {
	return errcode.New(errcode.AgentVersionConflict, http.StatusConflict, message, nil)
}

func capabilityInvalid(message string) error {
	return errcode.New(errcode.AgentInvalidRequest, http.StatusBadRequest, message, nil)
}

func capabilityInternal(message string, cause error) error {
	return errcode.New(errcode.AgentInternal, http.StatusInternalServerError, message, cause)
}

func capabilityRecordError(entity string, err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return errcode.New(errcode.AgentNotFound, http.StatusNotFound, entity+" not found", err)
	}
	return capabilityInternal("failed to load "+entity, err)
}
