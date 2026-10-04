package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/peers-labs/peers-touch/station/app/subserver/agent/errcode"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/infrastructure/persistence"
	"github.com/peers-labs/peers-touch/station/app/subserver/agent/model"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"
)

const (
	knowledgeDescriptorCreateCommand    = "create"
	knowledgeDescriptorUpdateCommand    = "update"
	knowledgeDescriptorTombstoneCommand = "tombstone"
	knowledgeDescriptorDefaultPageSize  = 50
	knowledgeDescriptorMaxPageSize      = 100
	maxKnowledgeStationContentBytes     = 48 * 1024
	maxKnowledgeIdempotencyKeyBytes     = 160
	maxKnowledgeIntegrityHashBytes      = 128
)

type KnowledgeResourceService struct {
	db        *gorm.DB
	authority *CapabilityAuthorityService
	now       func() time.Time
}

type knowledgeDescriptorMutation struct {
	descriptor *model.KnowledgeResourceDescriptor
	manifest   *model.CapabilityManifest
}

func NewKnowledgeResourceService(
	db *gorm.DB,
	authority *CapabilityAuthorityService,
) *KnowledgeResourceService {
	if authority == nil {
		authority = NewCapabilityAuthorityService(db)
	}
	return &KnowledgeResourceService{
		db:        db,
		authority: authority,
		now:       func() time.Time { return time.Now().UTC() },
	}
}

func (s *KnowledgeResourceService) Create(
	ctx context.Context,
	ptid string,
	req *model.CreateKnowledgeResourceDescriptorRequest,
) (*model.KnowledgeResourceDescriptor, *model.CapabilityManifest, error) {
	ptid = strings.TrimSpace(ptid)
	if err := validateKnowledgeCreate(ptid, req); err != nil {
		return nil, nil, err
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, nil, capabilityInternal("failed to hash knowledge create command", err)
	}
	var mutation knowledgeDescriptorMutation
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result, createErr := s.createTx(ctx, tx, ptid, req, payloadHash)
		if createErr != nil {
			return createErr
		}
		mutation = *result
		return nil
	})
	if err != nil {
		if replayed, replayErr := s.recoverKnowledgeDescriptorReplay(
			ctx,
			ptid,
			knowledgeDescriptorCreateCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		); replayErr != nil {
			return nil, nil, replayErr
		} else if replayed != nil {
			return replayed.descriptor, replayed.manifest, nil
		}
		return nil, nil, err
	}
	return mutation.descriptor, mutation.manifest, nil
}

func (s *KnowledgeResourceService) createTx(
	ctx context.Context,
	tx *gorm.DB,
	ptid string,
	req *model.CreateKnowledgeResourceDescriptorRequest,
	payloadHash string,
) (*knowledgeDescriptorMutation, error) {
	ptid = strings.TrimSpace(ptid)
	if err := validateKnowledgeCreate(ptid, req); err != nil {
		return nil, err
	}
	if strings.TrimSpace(payloadHash) == "" {
		return nil, capabilityInvalid("knowledge create payload hash is required")
	}
	tx = tx.WithContext(ctx)
	replayed, err := replayKnowledgeDescriptorCommand(
		tx,
		ptid,
		knowledgeDescriptorCreateCommand,
		req.GetIdempotencyKey(),
		payloadHash,
	)
	if err != nil || replayed != nil {
		return replayed, err
	}

	resourceID := generateID("knowledge-resource")
	now := s.now()
	revision, content, err := buildKnowledgeRevision(
		resourceID,
		ptid,
		1,
		req.GetTitle(),
		req.GetResourceKind(),
		req.GetStationContent(),
		req.GetClientResourceRef(),
		now,
	)
	if err != nil {
		return nil, err
	}
	registered, _, err := s.authority.registerManifestTx(
		tx,
		knowledgeManifest(revision),
	)
	if err != nil {
		return nil, err
	}
	if content != nil {
		if err := tx.Create(content).Error; err != nil {
			return nil, capabilityInternal("failed to store knowledge content revision", err)
		}
	}
	if err := tx.Create(revision).Error; err != nil {
		return nil, capabilityInternal("failed to create knowledge descriptor revision", err)
	}
	head := &persistence.KnowledgeResourceHead{
		ResourceID:      resourceID,
		Ptid:            ptid,
		CurrentRevision: revision.Revision,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	if err := tx.Create(head).Error; err != nil {
		return nil, capabilityInternal("failed to create knowledge descriptor head", err)
	}
	if err := recordKnowledgeDescriptorCommand(
		tx,
		ptid,
		knowledgeDescriptorCreateCommand,
		req.GetIdempotencyKey(),
		payloadHash,
		revision,
		registered,
		now,
	); err != nil {
		return nil, err
	}
	mutation := &knowledgeDescriptorMutation{
		descriptor: knowledgeDescriptorModel(revision),
		manifest:   registered,
	}
	return mutation, nil
}

func (s *KnowledgeResourceService) Update(
	ctx context.Context,
	ptid string,
	req *model.UpdateKnowledgeResourceDescriptorRequest,
) (*model.KnowledgeResourceDescriptor, *model.CapabilityManifest, error) {
	ptid = strings.TrimSpace(ptid)
	if err := validateKnowledgeUpdate(ptid, req); err != nil {
		return nil, nil, err
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, nil, capabilityInternal("failed to hash knowledge update command", err)
	}
	var mutation knowledgeDescriptorMutation
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayKnowledgeDescriptorCommand(
			tx,
			ptid,
			knowledgeDescriptorUpdateCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			mutation = *replayed
			return nil
		}

		var head persistence.KnowledgeResourceHead
		if err := tx.Where(
			"resource_id = ? AND ptid = ?",
			strings.TrimSpace(req.GetResourceId()),
			ptid,
		).First(&head).Error; err != nil {
			return capabilityRecordError("knowledge descriptor", err)
		}
		if head.TombstonedAt != nil || head.CurrentRevision != req.GetExpectedRevision() {
			return capabilityConflict("knowledge descriptor revision conflict")
		}
		now := s.now()
		revision, content, buildErr := buildKnowledgeRevision(
			head.ResourceID,
			ptid,
			head.CurrentRevision+1,
			req.GetTitle(),
			req.GetResourceKind(),
			req.GetStationContent(),
			req.GetClientResourceRef(),
			now,
		)
		if buildErr != nil {
			return buildErr
		}
		manifest := knowledgeManifest(revision)
		registered, _, registerErr := s.authority.registerManifestTx(tx, manifest)
		if registerErr != nil {
			return registerErr
		}
		if content != nil {
			if err := tx.Create(content).Error; err != nil {
				return capabilityInternal("failed to store knowledge content revision", err)
			}
		}
		if err := tx.Create(revision).Error; err != nil {
			return capabilityInternal("failed to create knowledge descriptor revision", err)
		}
		update := tx.Model(&persistence.KnowledgeResourceHead{}).
			Where(
				"resource_id = ? AND ptid = ? AND current_revision = ? AND tombstoned_at IS NULL",
				head.ResourceID,
				ptid,
				head.CurrentRevision,
			).
			Updates(map[string]interface{}{
				"current_revision": revision.Revision,
				"updated_at":       now,
			})
		if update.Error != nil {
			return capabilityInternal("failed to advance knowledge descriptor head", update.Error)
		}
		if update.RowsAffected != 1 {
			return capabilityConflict("knowledge descriptor changed during update")
		}
		if err := recordKnowledgeDescriptorCommand(
			tx,
			ptid,
			knowledgeDescriptorUpdateCommand,
			req.GetIdempotencyKey(),
			payloadHash,
			revision,
			registered,
			now,
		); err != nil {
			return err
		}
		mutation = knowledgeDescriptorMutation{
			descriptor: knowledgeDescriptorModel(revision),
			manifest:   registered,
		}
		return nil
	})
	if err != nil {
		if replayed, replayErr := s.recoverKnowledgeDescriptorReplay(
			ctx,
			ptid,
			knowledgeDescriptorUpdateCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		); replayErr != nil {
			return nil, nil, replayErr
		} else if replayed != nil {
			return replayed.descriptor, replayed.manifest, nil
		}
		return nil, nil, err
	}
	return mutation.descriptor, mutation.manifest, nil
}

func (s *KnowledgeResourceService) List(
	ctx context.Context,
	ptid string,
	req *model.ListKnowledgeResourceDescriptorsRequest,
) ([]*model.KnowledgeResourceDescriptor, string, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" {
		return nil, "", capabilityInvalid("ptid is required")
	}
	if req == nil {
		req = &model.ListKnowledgeResourceDescriptorsRequest{}
	}
	pageSize := int(req.GetPageSize())
	if pageSize <= 0 {
		pageSize = knowledgeDescriptorDefaultPageSize
	}
	if pageSize > knowledgeDescriptorMaxPageSize {
		pageSize = knowledgeDescriptorMaxPageSize
	}
	query := s.db.WithContext(ctx).
		Model(&persistence.KnowledgeResourceHead{}).
		Where("ptid = ?", ptid)
	if !req.GetIncludeTombstoned() {
		query = query.Where("tombstoned_at IS NULL")
	}
	afterResourceID, err := decodeKnowledgeCursor(req.GetCursor())
	if err != nil {
		return nil, "", err
	}
	if afterResourceID != "" {
		query = query.Where("resource_id > ?", afterResourceID)
	}
	var heads []persistence.KnowledgeResourceHead
	if err := query.Order("resource_id").Limit(pageSize + 1).Find(&heads).Error; err != nil {
		return nil, "", capabilityInternal("failed to list knowledge descriptor heads", err)
	}
	nextCursor := ""
	if len(heads) > pageSize {
		nextCursor = encodeKnowledgeCursor(heads[pageSize-1].ResourceID)
		heads = heads[:pageSize]
	}
	descriptors := make([]*model.KnowledgeResourceDescriptor, 0, len(heads))
	for i := range heads {
		var revision persistence.KnowledgeResourceRevision
		if err := s.db.WithContext(ctx).Where(
			"resource_id = ? AND revision = ? AND ptid = ?",
			heads[i].ResourceID,
			heads[i].CurrentRevision,
			ptid,
		).First(&revision).Error; err != nil {
			return nil, "", capabilityInternal("failed to load knowledge descriptor revision", err)
		}
		descriptors = append(
			descriptors,
			knowledgeDescriptorModelWithHead(&revision, &heads[i]),
		)
	}
	return descriptors, nextCursor, nil
}

func (s *KnowledgeResourceService) Tombstone(
	ctx context.Context,
	ptid string,
	req *model.TombstoneKnowledgeResourceDescriptorRequest,
) (*model.KnowledgeResourceDescriptor, *model.CapabilityManifest, error) {
	ptid = strings.TrimSpace(ptid)
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetResourceId()) == "" ||
		req.GetExpectedRevision() == 0 ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxKnowledgeIdempotencyKeyBytes ||
		strings.TrimSpace(req.GetReason()) == "" {
		return nil, nil, capabilityInvalid(
			"ptid, resource_id, expected_revision, idempotency_key and reason are required",
		)
	}
	payloadHash, err := capabilityProtoHash(req)
	if err != nil {
		return nil, nil, capabilityInternal("failed to hash knowledge tombstone command", err)
	}
	var mutation knowledgeDescriptorMutation
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		replayed, replayErr := replayKnowledgeDescriptorCommand(
			tx,
			ptid,
			knowledgeDescriptorTombstoneCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		)
		if replayErr != nil {
			return replayErr
		}
		if replayed != nil {
			mutation = *replayed
			return nil
		}

		var head persistence.KnowledgeResourceHead
		if err := tx.Where(
			"resource_id = ? AND ptid = ?",
			strings.TrimSpace(req.GetResourceId()),
			ptid,
		).First(&head).Error; err != nil {
			return capabilityRecordError("knowledge descriptor", err)
		}
		if head.TombstonedAt != nil || head.CurrentRevision != req.GetExpectedRevision() {
			return capabilityConflict("knowledge descriptor revision conflict")
		}
		var revision persistence.KnowledgeResourceRevision
		if err := tx.Where(
			"resource_id = ? AND revision = ? AND ptid = ?",
			head.ResourceID,
			head.CurrentRevision,
			ptid,
		).First(&revision).Error; err != nil {
			return capabilityRecordError("knowledge descriptor revision", err)
		}
		now := s.now()
		reason := strings.TrimSpace(req.GetReason())
		headUpdate := tx.Model(&persistence.KnowledgeResourceHead{}).
			Where(
				"resource_id = ? AND ptid = ? AND current_revision = ? AND tombstoned_at IS NULL",
				head.ResourceID,
				ptid,
				head.CurrentRevision,
			).
			Updates(map[string]interface{}{
				"updated_at":         now,
				"tombstoned_at":      now,
				"tombstoned_by_ptid": ptid,
				"tombstone_reason":   reason,
			})
		if headUpdate.Error != nil {
			return capabilityInternal("failed to tombstone knowledge descriptor head", headUpdate.Error)
		}
		if headUpdate.RowsAffected != 1 {
			return capabilityConflict("knowledge descriptor changed during tombstone")
		}
		retired, _, retireErr := s.retireKnowledgeManifestsTx(
			tx, ptid, &revision, req.GetIdempotencyKey(), reason,
		)
		if retireErr != nil {
			return retireErr
		}
		head.UpdatedAt = now
		head.TombstonedAt = &now
		head.TombstonedByPtid = ptid
		head.TombstoneReason = reason
		if err := recordKnowledgeDescriptorCommand(
			tx,
			ptid,
			knowledgeDescriptorTombstoneCommand,
			req.GetIdempotencyKey(),
			payloadHash,
			&revision,
			retired,
			now,
		); err != nil {
			return err
		}
		mutation = knowledgeDescriptorMutation{
			descriptor: knowledgeDescriptorModelWithHead(&revision, &head),
			manifest:   retired,
		}
		return nil
	})
	if err != nil {
		if replayed, replayErr := s.recoverKnowledgeDescriptorReplay(
			ctx,
			ptid,
			knowledgeDescriptorTombstoneCommand,
			req.GetIdempotencyKey(),
			payloadHash,
		); replayErr != nil {
			return nil, nil, replayErr
		} else if replayed != nil {
			return replayed.descriptor, replayed.manifest, nil
		}
		return nil, nil, err
	}
	return mutation.descriptor, mutation.manifest, nil
}

func (s *KnowledgeResourceService) retireKnowledgeManifestsTx(
	tx *gorm.DB,
	ptid string,
	revision *persistence.KnowledgeResourceRevision,
	idempotencyKey string,
	reason string,
) (*model.CapabilityManifest, []*model.CapabilityManifest, error) {
	capabilityID := knowledgeCapabilityID(revision.ResourceID)
	var records []persistence.CapabilityManifest
	if err := tx.Where(
		"capability_id = ? AND owner_ptid = ?",
		capabilityID,
		ptid,
	).Order("created_at, version").Find(&records).Error; err != nil {
		return nil, nil, capabilityInternal("failed to load knowledge manifests", err)
	}
	if len(records) == 0 {
		return nil, nil, capabilityRecordError("knowledge manifest", gorm.ErrRecordNotFound)
	}

	currentVersion := strconv.FormatUint(revision.Revision, 10)
	var current *model.CapabilityManifest
	retiredManifests := make([]*model.CapabilityManifest, 0, len(records))
	for i := range records {
		record := &records[i]
		if record.RetiredAt != nil {
			if record.Version == currentVersion {
				current = capabilityManifestModel(record)
			}
			continue
		}
		sum := sha256.Sum256([]byte(idempotencyKey + "\x00" + record.Version))
		retired, mutated, err := s.authority.retireManifestTx(
			tx,
			ptid,
			&model.RetireCapabilityManifestRequest{
				CapabilityId: capabilityID,
				Version:      record.Version,
				IdempotencyKey: "knowledge-retire:" +
					hex.EncodeToString(sum[:]),
				Reason: reason,
			},
		)
		if err != nil {
			return nil, nil, err
		}
		if mutated {
			retiredManifests = append(retiredManifests, retired)
		}
		if record.Version == currentVersion {
			current = retired
		}
	}
	if current == nil {
		return nil, nil, capabilityRecordError("current knowledge manifest", gorm.ErrRecordNotFound)
	}
	return current, retiredManifests, nil
}

func validateKnowledgeCreate(
	ptid string,
	req *model.CreateKnowledgeResourceDescriptorRequest,
) error {
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetTitle()) == "" ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxKnowledgeIdempotencyKeyBytes {
		return capabilityInvalid("ptid, title and idempotency_key are required")
	}
	return validateKnowledgeSource(
		req.GetResourceKind(),
		req.GetStationContent(),
		req.GetClientResourceRef(),
	)
}

func validateKnowledgeUpdate(
	ptid string,
	req *model.UpdateKnowledgeResourceDescriptorRequest,
) error {
	if ptid == "" || req == nil ||
		strings.TrimSpace(req.GetResourceId()) == "" ||
		req.GetExpectedRevision() == 0 ||
		strings.TrimSpace(req.GetTitle()) == "" ||
		strings.TrimSpace(req.GetIdempotencyKey()) == "" ||
		len(req.GetIdempotencyKey()) > maxKnowledgeIdempotencyKeyBytes {
		return capabilityInvalid(
			"ptid, resource_id, expected_revision, title and idempotency_key are required",
		)
	}
	return validateKnowledgeSource(
		req.GetResourceKind(),
		req.GetStationContent(),
		req.GetClientResourceRef(),
	)
}

func validateKnowledgeSource(
	resourceKind model.KnowledgeResourceKind,
	stationContent []byte,
	clientRef *model.KnowledgeClientResourceRef,
) error {
	if resourceKind == model.KnowledgeResourceKind_KNOWLEDGE_RESOURCE_KIND_UNSPECIFIED {
		return capabilityInvalid("resource_kind is required")
	}
	if len(stationContent) > 0 && clientRef != nil {
		return capabilityInvalid("knowledge descriptor requires exactly one source")
	}
	if len(stationContent) > maxKnowledgeStationContentBytes {
		return capabilityInvalid("station_content exceeds the 48 KiB limit")
	}
	if len(stationContent) == 0 && clientRef == nil {
		return capabilityInvalid("knowledge descriptor source is required")
	}
	if clientRef == nil {
		return nil
	}
	opaqueRef := strings.TrimSpace(clientRef.GetOpaqueResourceRef())
	if opaqueRef == "" ||
		len(opaqueRef) > 512 ||
		!utf8.ValidString(opaqueRef) ||
		strings.TrimSpace(clientRef.GetRequiredCapabilityId()) == "" ||
		strings.TrimSpace(clientRef.GetRequiredCapabilityVersion()) == "" ||
		strings.TrimSpace(clientRef.GetDeviceId()) == "" ||
		strings.TrimSpace(clientRef.GetIntegrityHash()) == "" ||
		len(clientRef.GetIntegrityHash()) > maxKnowledgeIntegrityHashBytes {
		return capabilityInvalid(
			"client resource ref, capability, version, device and integrity hash are required",
		)
	}
	parsed, parseErr := url.Parse(opaqueRef)
	if parseErr != nil || parsed.IsAbs() ||
		strings.Contains(opaqueRef, "..") ||
		strings.ContainsAny(opaqueRef, `/\`) ||
		strings.HasPrefix(opaqueRef, "~") ||
		strings.ContainsAny(opaqueRef, "?#") ||
		strings.IndexFunc(opaqueRef, unicode.IsSpace) >= 0 ||
		strings.IndexFunc(opaqueRef, unicode.IsControl) >= 0 {
		return capabilityInvalid("client opaque resource ref must not contain a path or URL")
	}
	return nil
}

func buildKnowledgeRevision(
	resourceID string,
	ptid string,
	revision uint64,
	title string,
	resourceKind model.KnowledgeResourceKind,
	stationContent []byte,
	clientRef *model.KnowledgeClientResourceRef,
	now time.Time,
) (*persistence.KnowledgeResourceRevision, *persistence.KnowledgeContentRevision, error) {
	record := &persistence.KnowledgeResourceRevision{
		ResourceID:   resourceID,
		Revision:     revision,
		Ptid:         ptid,
		Title:        strings.TrimSpace(title),
		ResourceKind: int32(resourceKind),
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	var content *persistence.KnowledgeContentRevision
	if clientRef == nil {
		contentHash := sha256.Sum256(stationContent)
		record.ContentHash = hex.EncodeToString(contentHash[:])
		record.IndexRevision = knowledgeIndexRevision(resourceID, revision, record.ContentHash)
		record.StationContentRef = fmt.Sprintf(
			"knowledge-content:%s:%d:%s",
			resourceID,
			revision,
			record.ContentHash,
		)
		record.LocatorKind = "station"
		record.Availability = int32(
			model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY,
		)
		content = &persistence.KnowledgeContentRevision{
			ContentRef:    record.StationContentRef,
			ResourceID:    resourceID,
			Revision:      revision,
			Ptid:          ptid,
			Content:       append([]byte(nil), stationContent...),
			ContentHash:   record.ContentHash,
			IndexRevision: record.IndexRevision,
			CreatedAt:     now,
		}
		return record, content, nil
	}
	normalized := proto.Clone(clientRef).(*model.KnowledgeClientResourceRef)
	normalized.OpaqueResourceRef = strings.TrimSpace(normalized.GetOpaqueResourceRef())
	normalized.RequiredCapabilityId = strings.TrimSpace(normalized.GetRequiredCapabilityId())
	normalized.RequiredCapabilityVersion = strings.TrimSpace(
		normalized.GetRequiredCapabilityVersion(),
	)
	normalized.DeviceId = strings.TrimSpace(normalized.GetDeviceId())
	normalized.IntegrityHash = strings.TrimSpace(normalized.GetIntegrityHash())
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(normalized)
	if err != nil {
		return nil, nil, capabilityInternal("failed to encode client knowledge ref", err)
	}
	sum := sha256.Sum256(encoded)
	record.ContentHash = hex.EncodeToString(sum[:])
	record.IndexRevision = knowledgeIndexRevision(resourceID, revision, record.ContentHash)
	record.LocatorKind = "client"
	record.ClientOpaqueResourceRef = normalized.GetOpaqueResourceRef()
	record.RequiredCapabilityID = normalized.GetRequiredCapabilityId()
	record.RequiredCapabilityVersion = normalized.GetRequiredCapabilityVersion()
	record.DeviceID = normalized.GetDeviceId()
	record.IntegrityHash = normalized.GetIntegrityHash()
	record.Availability = int32(
		model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_UNAVAILABLE,
	)
	record.ReasonCode = "client_capability_session_required"
	return record, nil, nil
}

func knowledgeIndexRevision(resourceID string, revision uint64, contentHash string) string {
	sum := sha256.Sum256([]byte(
		resourceID + "\x00" + strconv.FormatUint(revision, 10) + "\x00" + contentHash,
	))
	return hex.EncodeToString(sum[:])
}

func knowledgeCapabilityID(resourceID string) string {
	return "knowledge.resource." + resourceID
}

func knowledgeManifest(
	revision *persistence.KnowledgeResourceRevision,
) *model.CapabilityManifest {
	executionOwner := model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_STATION
	secretBoundary := "station"
	requiredCapabilities := []string(nil)
	if revision.LocatorKind == "client" {
		executionOwner = model.ToolExecutionOwner_TOOL_EXECUTION_OWNER_CLIENT_CAPABILITY
		secretBoundary = "client"
		requiredCapabilities = []string{
			revision.RequiredCapabilityID + "@" + revision.RequiredCapabilityVersion,
		}
	}
	return &model.CapabilityManifest{
		CapabilityId:     knowledgeCapabilityID(revision.ResourceID),
		Version:          strconv.FormatUint(revision.Revision, 10),
		SourceKind:       model.CapabilitySourceKind_CAPABILITY_SOURCE_KIND_KNOWLEDGE,
		SourceInstanceId: revision.ResourceID,
		DisplayMetadata: &model.CapabilityDisplayMetadata{
			Name: revision.Title,
		},
		OutputSchemaRef:             "peers_touch.model.agent.v1.KnowledgeResourceDescriptor",
		ExecutionOwner:              executionOwner,
		RequiredRuntimeCapabilities: requiredCapabilities,
		RiskClass:                   "read",
		DefaultApprovalPolicy:       model.CapabilityApprovalPolicy_CAPABILITY_APPROVAL_POLICY_AUTO,
		SecretBoundary:              secretBoundary,
		Availability:                knowledgeManifestAvailability(revision.Availability),
		OwnerPtid:                   revision.Ptid,
	}
}

func knowledgeManifestAvailability(value int32) model.CapabilityAvailability {
	switch model.KnowledgeResourceAvailability(value) {
	case model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_READY:
		return model.CapabilityAvailability_CAPABILITY_AVAILABILITY_AVAILABLE
	case model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_INDEXING:
		return model.CapabilityAvailability_CAPABILITY_AVAILABILITY_DEGRADED
	case model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_TOMBSTONED:
		return model.CapabilityAvailability_CAPABILITY_AVAILABILITY_BLOCKED
	default:
		return model.CapabilityAvailability_CAPABILITY_AVAILABILITY_UNAVAILABLE
	}
}

func (s *KnowledgeResourceService) recoverKnowledgeDescriptorReplay(
	ctx context.Context,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
) (*knowledgeDescriptorMutation, error) {
	return replayKnowledgeDescriptorCommand(
		s.db.WithContext(ctx),
		ptid,
		commandKind,
		idempotencyKey,
		payloadHash,
	)
}

func replayKnowledgeDescriptorCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
) (*knowledgeDescriptorMutation, error) {
	var command persistence.KnowledgeDescriptorCommand
	err := tx.Where(
		"ptid = ? AND command_kind = ? AND idempotency_key = ?",
		ptid,
		commandKind,
		strings.TrimSpace(idempotencyKey),
	).First(&command).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, capabilityInternal("failed to read knowledge descriptor command", err)
	}
	if command.PayloadHash != payloadHash {
		return nil, errcode.New(
			errcode.AgentIdempotencyConflict,
			409,
			"idempotency key payload mismatch",
			nil,
		)
	}
	var revision persistence.KnowledgeResourceRevision
	if err := tx.Where(
		"resource_id = ? AND revision = ? AND ptid = ?",
		command.ResourceID,
		command.Revision,
		ptid,
	).First(&revision).Error; err != nil {
		return nil, capabilityInternal("failed to replay knowledge descriptor", err)
	}
	var head persistence.KnowledgeResourceHead
	if err := tx.Where(
		"resource_id = ? AND ptid = ?",
		command.ResourceID,
		ptid,
	).First(&head).Error; err != nil {
		return nil, capabilityInternal("failed to replay knowledge descriptor head", err)
	}
	var manifest persistence.CapabilityManifest
	if err := tx.Where(
		"capability_id = ? AND version = ?",
		command.CapabilityID,
		command.CapabilityVersion,
	).First(&manifest).Error; err != nil {
		return nil, capabilityInternal("failed to replay knowledge manifest", err)
	}
	descriptor := knowledgeDescriptorModel(&revision)
	manifestModel := capabilityManifestModel(&manifest)
	if commandKind == knowledgeDescriptorTombstoneCommand {
		descriptor = knowledgeDescriptorModelWithHead(&revision, &head)
	} else {
		manifestModel.Availability = knowledgeManifestAvailability(revision.Availability)
		manifestModel.RetiredAt = nil
		manifestModel.RetiredByPtid = ""
		manifestModel.RetirementReason = ""
	}
	return &knowledgeDescriptorMutation{
		descriptor: descriptor,
		manifest:   manifestModel,
	}, nil
}

func encodeKnowledgeCursor(resourceID string) string {
	return base64.RawURLEncoding.EncodeToString([]byte(resourceID))
}

func decodeKnowledgeCursor(cursor string) (string, error) {
	cursor = strings.TrimSpace(cursor)
	if cursor == "" {
		return "", nil
	}
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil || len(decoded) == 0 || strings.TrimSpace(string(decoded)) != string(decoded) {
		return "", capabilityInvalid("knowledge descriptor cursor is invalid")
	}
	return string(decoded), nil
}

func recordKnowledgeDescriptorCommand(
	tx *gorm.DB,
	ptid string,
	commandKind string,
	idempotencyKey string,
	payloadHash string,
	revision *persistence.KnowledgeResourceRevision,
	manifest *model.CapabilityManifest,
	now time.Time,
) error {
	command := &persistence.KnowledgeDescriptorCommand{
		ID:                generateID("knowledge-descriptor-command"),
		Ptid:              ptid,
		CommandKind:       commandKind,
		IdempotencyKey:    strings.TrimSpace(idempotencyKey),
		PayloadHash:       payloadHash,
		ResourceID:        revision.ResourceID,
		Revision:          revision.Revision,
		CapabilityID:      manifest.GetCapabilityId(),
		CapabilityVersion: manifest.GetVersion(),
		CreatedAt:         now,
	}
	if err := tx.Create(command).Error; err != nil {
		return capabilityInternal("failed to record knowledge descriptor command", err)
	}
	return nil
}

func knowledgeDescriptorModel(
	record *persistence.KnowledgeResourceRevision,
) *model.KnowledgeResourceDescriptor {
	result := &model.KnowledgeResourceDescriptor{
		ResourceId:       record.ResourceID,
		Ptid:             record.Ptid,
		Revision:         record.Revision,
		ResourceKind:     model.KnowledgeResourceKind(record.ResourceKind),
		ContentHash:      record.ContentHash,
		IndexRevision:    record.IndexRevision,
		Availability:     model.KnowledgeResourceAvailability(record.Availability),
		ReasonCode:       record.ReasonCode,
		CreatedAt:        timestamppb.New(record.CreatedAt),
		UpdatedAt:        timestamppb.New(record.UpdatedAt),
		Title:            record.Title,
		TombstonedByPtid: record.TombstonedByPtid,
		TombstoneReason:  record.TombstoneReason,
	}
	if record.LocatorKind == "station" {
		result.Locator = &model.KnowledgeResourceDescriptor_StationContentRef{
			StationContentRef: &model.KnowledgeStationContentRef{
				ContentRef: record.StationContentRef,
			},
		}
	} else {
		result.Locator = &model.KnowledgeResourceDescriptor_ClientResourceRef{
			ClientResourceRef: &model.KnowledgeClientResourceRef{
				OpaqueResourceRef:         record.ClientOpaqueResourceRef,
				RequiredCapabilityId:      record.RequiredCapabilityID,
				RequiredCapabilityVersion: record.RequiredCapabilityVersion,
				DeviceId:                  record.DeviceID,
				IntegrityHash:             record.IntegrityHash,
			},
		}
	}
	if record.TombstonedAt != nil {
		result.TombstonedAt = timestamppb.New(*record.TombstonedAt)
	}
	return result
}

func knowledgeDescriptorModelWithHead(
	record *persistence.KnowledgeResourceRevision,
	head *persistence.KnowledgeResourceHead,
) *model.KnowledgeResourceDescriptor {
	result := knowledgeDescriptorModel(record)
	if head == nil || head.TombstonedAt == nil {
		return result
	}
	result.Availability =
		model.KnowledgeResourceAvailability_KNOWLEDGE_RESOURCE_AVAILABILITY_TOMBSTONED
	result.ReasonCode = "resource_tombstoned"
	result.UpdatedAt = timestamppb.New(head.UpdatedAt)
	result.TombstonedAt = timestamppb.New(*head.TombstonedAt)
	result.TombstonedByPtid = head.TombstonedByPtid
	result.TombstoneReason = head.TombstoneReason
	return result
}
