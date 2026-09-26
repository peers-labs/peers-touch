package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"path"
	"strings"
	"time"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/app/subserver/social/infrastructure"
	"github.com/peers-labs/peers-touch/station/frame/core/facility/storage"
	"gorm.io/gorm"
)

const resetLogicalOSSBackend = "oss"

// PrivateSocialResetOwner is the OSS-owned SC-D23 adapter for legacy private
// Social attachments. It removes only the addressed metadata claim and releases
// its blob reference. Physical bytes remain available while another live CAS
// claim references them and otherwise remain eligible for the normal BlobGC
// lifecycle.
type PrivateSocialResetOwner struct {
	database    *gorm.DB
	backend     storage.Backend
	backendName string
	clock       func() time.Time
}

// PrivateSocialResetOwnerConfig contains the already-initialized OSS
// persistence and storage dependencies used by the Station process.
type PrivateSocialResetOwnerConfig struct {
	Database    *gorm.DB
	Backend     storage.Backend
	BackendName string
	Clock       func() time.Time
}

// NewPrivateSocialResetOwner constructs the owner-mediated legacy object
// release adapter. The caller must pass the same OSS database and backend
// selected by Station configuration.
func NewPrivateSocialResetOwner(
	config PrivateSocialResetOwnerConfig,
) (*PrivateSocialResetOwner, error) {
	if config.Database == nil {
		return nil, newObjectResetError(
			infrastructure.ResetCodeInvalidInput,
			"OSS reset database is required",
		)
	}
	if config.Backend == nil {
		return nil, newObjectResetError(
			infrastructure.ResetCodeInvalidInput,
			"OSS reset backend is required",
		)
	}
	backendName := strings.ToLower(strings.TrimSpace(config.BackendName))
	if backendName == "" {
		return nil, newObjectResetError(
			infrastructure.ResetCodeInvalidInput,
			"OSS reset backend name is required",
		)
	}
	clock := config.Clock
	if clock == nil {
		clock = time.Now
	}

	return &PrivateSocialResetOwner{
		database:    config.Database,
		backend:     config.Backend,
		backendName: backendName,
		clock:       clock,
	}, nil
}

// InspectResetObject verifies the exact OSS metadata claim, physical bytes,
// reference count, and shared-CAS classification before the reset manifest is
// frozen.
func (o *PrivateSocialResetOwner) InspectResetObject(
	ctx context.Context,
	target infrastructure.ResolvedResetObjectTarget,
) (infrastructure.ResetObjectInspection, error) {
	if err := o.validateTarget(target, true); err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}

	metadata, err := o.loadMetadata(ctx, target.OwnerPTID, target.StorageKey)
	if err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}
	if metadata.DeletedAt != nil {
		return infrastructure.ResetObjectInspection{}, newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS metadata is already deleted",
		)
	}
	if err := o.validateMetadataIdentity(metadata, target); err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}

	metadataDigest, err := resetMetadataDigest(metadata)
	if err != nil {
		return infrastructure.ResetObjectInspection{}, newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"calculate legacy OSS metadata digest: %v",
			err,
		)
	}
	blobDigest, err := o.inspectBlobBytes(ctx, metadata)
	if err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}
	references, err := o.liveReferences(ctx, metadata.Backend, metadata.Key)
	if err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}
	blob, err := o.loadBlob(ctx, metadata.Backend, metadata.Key)
	if err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}
	if blob == nil ||
		blob.RefCount != int64(len(references)) ||
		!equalObjectDigest(blob.Sha256, blobDigest) ||
		blob.Size != metadata.Size {
		return infrastructure.ResetObjectInspection{}, newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS blob reference state does not match live metadata",
		)
	}

	classification, err := classifyResetReference(references, blobDigest)
	if err != nil {
		return infrastructure.ResetObjectInspection{}, err
	}
	if target.ExpectedBlobDigest != "" &&
		!equalObjectDigest(target.ExpectedBlobDigest, blobDigest) {
		return infrastructure.ResetObjectInspection{}, newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"legacy OSS blob digest does not match its source row",
		)
	}

	return infrastructure.ResetObjectInspection{
		Backend:                 metadata.Backend,
		MetadataDigest:          metadataDigest,
		BlobDigest:              blobDigest,
		ReferenceClassification: classification,
	}, nil
}

// DeleteResetObject atomically tombstones the exact metadata claim and releases
// one blob reference. A retry after the transaction committed observes the
// tombstone and verifies that the reference count already matches live claims.
func (o *PrivateSocialResetOwner) DeleteResetObject(
	ctx context.Context,
	target infrastructure.ResolvedResetObjectTarget,
) error {
	if err := o.validateTarget(target, false); err != nil {
		return err
	}
	if target.ReferenceClassification !=
		infrastructure.ResetReferenceExclusiveLegacy &&
		target.ReferenceClassification != infrastructure.ResetReferenceSharedCASSafe {
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS reset classification is not allowlisted",
		)
	}

	return o.database.WithContext(ctx).Transaction(func(transaction *gorm.DB) error {
		metadata, err := loadResetMetadata(
			transaction,
			target.OwnerPTID,
			target.StorageKey,
		)
		if err != nil {
			return err
		}
		if err := o.validateMetadataIdentity(metadata, target); err != nil {
			return err
		}
		metadataDigest, err := resetMetadataDigest(metadata)
		if err != nil {
			return newObjectResetError(
				infrastructure.ResetCodePartialFailure,
				"calculate legacy OSS metadata digest: %v",
				err,
			)
		}
		if !equalObjectDigest(metadataDigest, target.ExpectedMetadataDigest) {
			return newObjectResetError(
				infrastructure.ResetCodeObjectDigestMismatch,
				"legacy OSS metadata changed after reset audit",
			)
		}

		references, err := liveResetReferences(
			transaction,
			metadata.Backend,
			metadata.Key,
		)
		if err != nil {
			return err
		}
		blob, err := loadResetBlob(transaction, metadata.Backend, metadata.Key)
		if err != nil {
			return err
		}

		if metadata.DeletedAt != nil {
			return verifyReleasedReferenceState(
				metadata,
				blob,
				references,
				target,
			)
		}
		blobDigest, err := o.inspectBlobBytes(ctx, metadata)
		if err != nil {
			return err
		}
		if !equalObjectDigest(blobDigest, target.ExpectedBlobDigest) ||
			blob == nil ||
			!equalObjectDigest(blob.Sha256, blobDigest) {
			return newObjectResetError(
				infrastructure.ResetCodeObjectDigestMismatch,
				"legacy OSS blob bytes changed after reset audit",
			)
		}
		if blob == nil || blob.RefCount != int64(len(references)) {
			return newObjectResetError(
				infrastructure.ResetCodeObjectReferenceAmbiguous,
				"legacy OSS blob reference count changed after reset audit",
			)
		}
		classification, err := classifyResetReference(
			references,
			target.ExpectedBlobDigest,
		)
		if err != nil {
			return err
		}
		if classification != target.ReferenceClassification {
			return newObjectResetError(
				infrastructure.ResetCodeObjectReferenceAmbiguous,
				"legacy OSS sharing classification changed after reset audit",
			)
		}

		now := o.clock().UTC()
		update := transaction.Model(&ossmodel.FileMeta{}).
			Where("id = ? AND deleted_at IS NULL", metadata.ID).
			Updates(map[string]any{
				"deleted_at": now,
				"updated_at": now,
			})
		if update.Error != nil {
			return newObjectResetError(
				infrastructure.ResetCodePartialFailure,
				"delete legacy OSS metadata: %v",
				update.Error,
			)
		}
		if update.RowsAffected != 1 {
			return newObjectResetError(
				infrastructure.ResetCodePartialFailure,
				"delete legacy OSS metadata affected %d rows",
				update.RowsAffected,
			)
		}

		release := transaction.Model(&ossmodel.Blob{}).
			Where(
				"backend = ? AND key = ? AND ref_count = ? AND ref_count > 0",
				metadata.Backend,
				metadata.Key,
				blob.RefCount,
			).
			UpdateColumn("ref_count", gorm.Expr("ref_count - 1"))
		if release.Error != nil {
			return newObjectResetError(
				infrastructure.ResetCodePartialFailure,
				"release legacy OSS blob reference: %v",
				release.Error,
			)
		}
		if release.RowsAffected != 1 {
			return newObjectResetError(
				infrastructure.ResetCodeObjectReferenceAmbiguous,
				"legacy OSS blob reference changed during release",
			)
		}

		return nil
	})
}

// VerifyResetObjectDeleted proves that the target metadata is no longer live
// and that the blob reference count equals the remaining live metadata claims.
func (o *PrivateSocialResetOwner) VerifyResetObjectDeleted(
	ctx context.Context,
	target infrastructure.ResolvedResetObjectTarget,
) error {
	if err := o.validateTarget(target, false); err != nil {
		return err
	}
	metadata, err := o.loadMetadata(ctx, target.OwnerPTID, target.StorageKey)
	if err != nil {
		return err
	}
	if err := o.validateMetadataIdentity(metadata, target); err != nil {
		return err
	}
	metadataDigest, err := resetMetadataDigest(metadata)
	if err != nil {
		return newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"calculate legacy OSS metadata digest: %v",
			err,
		)
	}
	if !equalObjectDigest(metadataDigest, target.ExpectedMetadataDigest) {
		return newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"legacy OSS metadata changed after reset audit",
		)
	}
	if metadata.DeletedAt == nil {
		return newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"legacy OSS metadata remains live after release",
		)
	}

	references, err := o.liveReferences(ctx, metadata.Backend, metadata.Key)
	if err != nil {
		return err
	}
	blob, err := o.loadBlob(ctx, metadata.Backend, metadata.Key)
	if err != nil {
		return err
	}
	if err := verifyReleasedReferenceState(
		metadata,
		blob,
		references,
		target,
	); err != nil {
		return err
	}
	if blob == nil {
		if _, err := o.backend.Stat(ctx, metadata.Key); err == nil {
			return newObjectResetError(
				infrastructure.ResetCodePartialFailure,
				"legacy OSS bytes remain without a tracked blob reference",
			)
		}

		return nil
	}
	if len(references) == 0 {
		return nil
	}
	if _, err := o.inspectBlobBytes(ctx, metadata); err != nil {
		return err
	}

	return nil
}

func (o *PrivateSocialResetOwner) validateTarget(
	target infrastructure.ResolvedResetObjectTarget,
	allowLogicalBackend bool,
) error {
	if target.OwnerDomain != infrastructure.ResetObjectDomainOSS ||
		strings.TrimSpace(target.OwnerPTID) == "" ||
		strings.TrimSpace(target.StorageKey) == "" {
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS object identity is invalid",
		)
	}
	backend := strings.ToLower(strings.TrimSpace(target.Backend))
	if backend == "" {
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS backend identity is missing",
		)
	}
	if allowLogicalBackend && backend == resetLogicalOSSBackend {
		return nil
	}
	if backend != o.backendName {
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS backend %q does not match configured backend %q",
			backend,
			o.backendName,
		)
	}

	return nil
}

func (o *PrivateSocialResetOwner) validateMetadataIdentity(
	metadata *ossmodel.FileMeta,
	target infrastructure.ResolvedResetObjectTarget,
) error {
	if metadata == nil ||
		metadata.OwnerPTID != target.OwnerPTID ||
		metadata.Key != target.StorageKey ||
		strings.ToLower(strings.TrimSpace(metadata.Backend)) != o.backendName {
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS metadata does not match the reset target",
		)
	}

	return nil
}

func (o *PrivateSocialResetOwner) inspectBlobBytes(
	ctx context.Context,
	metadata *ossmodel.FileMeta,
) (string, error) {
	reader, size, _, err := o.backend.Open(ctx, metadata.Key, nil)
	if err != nil {
		return "", newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"open legacy OSS blob: %v",
			err,
		)
	}
	defer func() {
		_ = reader.Close()
	}()

	hasher := sha256.New()
	written, err := io.Copy(hasher, reader)
	if err != nil {
		return "", newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"hash legacy OSS blob: %v",
			err,
		)
	}
	if size != metadata.Size || written != metadata.Size {
		return "", newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"legacy OSS blob size does not match metadata",
		)
	}
	digest := hex.EncodeToString(hasher.Sum(nil))
	if metadata.Sha256 != "" && !equalObjectDigest(metadata.Sha256, digest) {
		return "", newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"legacy OSS blob digest does not match metadata",
		)
	}

	return digest, nil
}

func (o *PrivateSocialResetOwner) loadMetadata(
	ctx context.Context,
	ownerPTID string,
	key string,
) (*ossmodel.FileMeta, error) {
	return loadResetMetadata(o.database.WithContext(ctx), ownerPTID, key)
}

func loadResetMetadata(
	database *gorm.DB,
	ownerPTID string,
	key string,
) (*ossmodel.FileMeta, error) {
	var metadata ossmodel.FileMeta
	err := database.
		Where("owner_ptid = ? AND key = ?", ownerPTID, key).
		First(&metadata).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS metadata is missing",
		)
	}
	if err != nil {
		return nil, newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"load legacy OSS metadata: %v",
			err,
		)
	}

	return &metadata, nil
}

func (o *PrivateSocialResetOwner) liveReferences(
	ctx context.Context,
	backend string,
	key string,
) ([]ossmodel.FileMeta, error) {
	return liveResetReferences(o.database.WithContext(ctx), backend, key)
}

func liveResetReferences(
	database *gorm.DB,
	backend string,
	key string,
) ([]ossmodel.FileMeta, error) {
	var references []ossmodel.FileMeta
	if err := database.
		Where("backend = ? AND key = ? AND deleted_at IS NULL", backend, key).
		Order("owner_ptid ASC, id ASC").
		Find(&references).Error; err != nil {
		return nil, newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"load live OSS blob references: %v",
			err,
		)
	}

	return references, nil
}

func (o *PrivateSocialResetOwner) loadBlob(
	ctx context.Context,
	backend string,
	key string,
) (*ossmodel.Blob, error) {
	return loadResetBlob(o.database.WithContext(ctx), backend, key)
}

func loadResetBlob(
	database *gorm.DB,
	backend string,
	key string,
) (*ossmodel.Blob, error) {
	var blob ossmodel.Blob
	err := database.
		Where("backend = ? AND key = ?", backend, key).
		First(&blob).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"load OSS blob reference: %v",
			err,
		)
	}

	return &blob, nil
}

func classifyResetReference(
	references []ossmodel.FileMeta,
	blobDigest string,
) (infrastructure.ResetReferenceClassification, error) {
	switch len(references) {
	case 0:
		return "", newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"legacy OSS reset target has no live metadata reference",
		)
	case 1:
		return infrastructure.ResetReferenceExclusiveLegacy, nil
	default:
		for index := range references {
			if !isCASReference(references[index], blobDigest) {
				return "", newObjectResetError(
					infrastructure.ResetCodeObjectReferenceAmbiguous,
					"shared legacy OSS key is not a verified CAS object",
				)
			}
		}

		return infrastructure.ResetReferenceSharedCASSafe, nil
	}
}

func verifyReleasedReferenceState(
	metadata *ossmodel.FileMeta,
	blob *ossmodel.Blob,
	references []ossmodel.FileMeta,
	target infrastructure.ResolvedResetObjectTarget,
) error {
	if metadata.DeletedAt == nil {
		return newObjectResetError(
			infrastructure.ResetCodePartialFailure,
			"legacy OSS metadata remains live after release",
		)
	}
	if blob == nil {
		if len(references) == 0 &&
			target.ReferenceClassification ==
				infrastructure.ResetReferenceExclusiveLegacy {
			return nil
		}

		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"shared legacy OSS blob reference is missing",
		)
	}
	if blob.RefCount != int64(len(references)) {
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"released OSS blob count does not match live metadata",
		)
	}
	if target.ExpectedBlobDigest != "" &&
		!equalObjectDigest(blob.Sha256, target.ExpectedBlobDigest) {
		return newObjectResetError(
			infrastructure.ResetCodeObjectDigestMismatch,
			"released OSS blob digest changed after reset audit",
		)
	}
	switch target.ReferenceClassification {
	case infrastructure.ResetReferenceExclusiveLegacy:
		if len(references) != 0 {
			return newObjectResetError(
				infrastructure.ResetCodeObjectReferenceAmbiguous,
				"exclusive legacy OSS blob gained another live reference",
			)
		}
	case infrastructure.ResetReferenceSharedCASSafe:
		if len(references) == 0 {
			return newObjectResetError(
				infrastructure.ResetCodeObjectReferenceAmbiguous,
				"shared CAS OSS blob lost every retaining reference",
			)
		}
		for index := range references {
			if !isCASReference(references[index], target.ExpectedBlobDigest) {
				return newObjectResetError(
					infrastructure.ResetCodeObjectReferenceAmbiguous,
					"retaining OSS metadata is not a verified CAS reference",
				)
			}
		}
	default:
		return newObjectResetError(
			infrastructure.ResetCodeObjectReferenceAmbiguous,
			"released OSS reference classification is not allowlisted",
		)
	}

	return nil
}

func isCASReference(metadata ossmodel.FileMeta, blobDigest string) bool {
	digest := strings.ToLower(strings.TrimSpace(metadata.Sha256))
	if len(digest) != sha256.Size*2 || !equalObjectDigest(digest, blobDigest) {
		return false
	}
	if _, err := hex.DecodeString(digest); err != nil {
		return false
	}
	cleanKey := path.Clean(metadata.Key)
	if cleanKey != metadata.Key || strings.HasPrefix(cleanKey, "../") {
		return false
	}
	prefix := "cas/" + digest[:2] + "/" + digest
	if cleanKey == prefix {
		return true
	}

	return strings.HasPrefix(cleanKey, prefix+".")
}

func resetMetadataDigest(metadata *ossmodel.FileMeta) (string, error) {
	type metadataProjection struct {
		ID            string     `json:"id"`
		Key           string     `json:"key"`
		Name          string     `json:"name"`
		Size          int64      `json:"size"`
		Mime          string     `json:"mime"`
		Backend       string     `json:"backend"`
		Path          string     `json:"path"`
		SHA256        string     `json:"sha256"`
		BucketID      string     `json:"bucketId"`
		OwnerPTID     string     `json:"ownerPtid"`
		Visibility    string     `json:"visibility"`
		ChatSessionID string     `json:"chatSessionId"`
		ExpiresAt     *time.Time `json:"expiresAt,omitempty"`
		CreatedAt     time.Time  `json:"createdAt"`
	}
	projection := metadataProjection{
		ID:            metadata.ID,
		Key:           metadata.Key,
		Name:          metadata.Name,
		Size:          metadata.Size,
		Mime:          metadata.Mime,
		Backend:       metadata.Backend,
		Path:          metadata.Path,
		SHA256:        metadata.Sha256,
		BucketID:      metadata.BucketID,
		OwnerPTID:     metadata.OwnerPTID,
		Visibility:    metadata.Visibility,
		ChatSessionID: metadata.ChatSessionID,
		ExpiresAt:     utcTimePointer(metadata.ExpiresAt),
		CreatedAt:     metadata.CreatedAt.UTC(),
	}
	canonical, err := json.Marshal(projection)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(canonical)

	return hex.EncodeToString(digest[:]), nil
}

func utcTimePointer(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	normalized := value.UTC()

	return &normalized
}

func equalObjectDigest(left string, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func newObjectResetError(
	code infrastructure.ResetCode,
	format string,
	arguments ...any,
) error {
	return &infrastructure.ResetError{
		Code: code,
		Err:  fmt.Errorf(format, arguments...),
	}
}

var _ infrastructure.ResetObjectOwner = (*PrivateSocialResetOwner)(nil)
