package infrastructure

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	gormschema "gorm.io/gorm/schema"
)

const (
	resetManifestTable     = "social_secure_content_reset_manifests"
	resetJournalTable      = "social_secure_content_reset_journals"
	resetInvocationTable   = "social_secure_content_reset_invocations"
	resetTransitionTable   = "social_secure_content_reset_transitions"
	resetReplacementTable  = "social_secure_content_reset_replacements"
	resetObjectTargetTable = "social_secure_content_reset_object_targets"
	resetAttestationTable  = "social_secure_content_schema_attestations"
)

const (
	replacementProvenanceAdmission = "LOCKED_ADMISSION"
	replacementProvenanceMigration = "REVIEWED_MIGRATION"
)

var secureContentResetSQLiteLocks sync.Map

type secureContentResetManifestModel struct {
	ResetID               string    `gorm:"column:reset_id;primaryKey;size:128"`
	ManifestDigest        string    `gorm:"column:manifest_digest;size:64;not null;uniqueIndex"`
	ResetIntent           string    `gorm:"column:reset_intent;size:32;not null"`
	SourceCommit          string    `gorm:"column:source_commit;size:64;not null"`
	WorkspaceID           string    `gorm:"column:workspace_id;size:64;not null"`
	ProfileID             string    `gorm:"column:profile_id;size:32;not null"`
	DeploymentEnvironment string    `gorm:"column:deployment_environment;size:128;not null"`
	DestructiveScope      string    `gorm:"column:destructive_scope;size:128;not null"`
	ManifestJSON          []byte    `gorm:"column:manifest_json;not null"`
	CreatedAt             time.Time `gorm:"column:created_at;not null"`
}

func (secureContentResetManifestModel) TableName() string {
	return resetManifestTable
}

type secureContentResetJournalModel struct {
	ResetID               string     `gorm:"column:reset_id;primaryKey;size:128"`
	ManifestDigest        string     `gorm:"column:manifest_digest;size:64;not null;uniqueIndex"`
	DeploymentEnvironment string     `gorm:"column:deployment_environment;size:128;not null;index:idx_secure_content_reset_active,priority:1"`
	DestructiveScope      string     `gorm:"column:destructive_scope;size:128;not null;index:idx_secure_content_reset_active,priority:2"`
	CurrentState          string     `gorm:"column:current_state;size:32;not null;index:idx_secure_content_reset_active,priority:3"`
	PostAuditDeployment   []byte     `gorm:"column:post_audit_deployment"`
	PostAuditSchemaDigest string     `gorm:"column:post_audit_schema_digest;size:64"`
	FailureCode           string     `gorm:"column:failure_code;size:64"`
	FailureAt             *time.Time `gorm:"column:failure_at"`
	CreatedAt             time.Time  `gorm:"column:created_at;not null"`
	UpdatedAt             time.Time  `gorm:"column:updated_at;not null"`
}

func (secureContentResetJournalModel) TableName() string {
	return resetJournalTable
}

type secureContentResetInvocationModel struct {
	InvocationID     string    `gorm:"column:invocation_id;primaryKey;size:128"`
	InvocationDigest string    `gorm:"column:invocation_digest;size:64;not null"`
	ResetID          string    `gorm:"column:reset_id;size:128;not null;index"`
	AcceptedAt       time.Time `gorm:"column:accepted_at;not null"`
}

func (secureContentResetInvocationModel) TableName() string {
	return resetInvocationTable
}

type secureContentResetTransitionModel struct {
	ResetID      string    `gorm:"column:reset_id;primaryKey;size:128"`
	Ordinal      int64     `gorm:"column:ordinal;primaryKey"`
	FromState    string    `gorm:"column:from_state;size:32;not null"`
	ToState      string    `gorm:"column:to_state;size:32;not null"`
	TransitionAt time.Time `gorm:"column:transition_at;not null"`
}

func (secureContentResetTransitionModel) TableName() string {
	return resetTransitionTable
}

type secureContentResetReplacementModel struct {
	PredecessorResetID        string                          `gorm:"column:predecessor_reset_id;primaryKey;size:128"`
	InitialSuccessorResetID   string                          `gorm:"column:initial_successor_reset_id;size:128;not null;uniqueIndex"`
	PredecessorManifestDigest string                          `gorm:"column:predecessor_manifest_digest;size:64;not null"`
	SuccessorManifestDigest   string                          `gorm:"column:successor_manifest_digest;size:64;not null"`
	PredecessorJournalDigest  string                          `gorm:"column:predecessor_journal_digest;size:64;not null"`
	PredecessorState          string                          `gorm:"column:predecessor_state;size:32;not null"`
	PredecessorFailureCode    string                          `gorm:"column:predecessor_failure_code;size:64"`
	TerminalFailureCode       string                          `gorm:"column:terminal_failure_code;size:64"`
	ReplacementReason         string                          `gorm:"column:replacement_reason;size:64;not null"`
	DeploymentEnvironment     string                          `gorm:"column:deployment_environment;size:128;not null;index"`
	DestructiveScope          string                          `gorm:"column:destructive_scope;size:128;not null;index"`
	ProvenanceMode            string                          `gorm:"column:provenance_mode;size:32;not null"`
	ReplacedAt                time.Time                       `gorm:"column:replaced_at;not null"`
	PredecessorManifest       secureContentResetManifestModel `gorm:"foreignKey:PredecessorResetID;references:ResetID;constraint:OnUpdate:RESTRICT,OnDelete:RESTRICT"`
	InitialSuccessorManifest  secureContentResetManifestModel `gorm:"foreignKey:InitialSuccessorResetID;references:ResetID;constraint:OnUpdate:RESTRICT,OnDelete:RESTRICT"`
}

func (secureContentResetReplacementModel) TableName() string {
	return resetReplacementTable
}

type secureContentResetObjectTargetModel struct {
	ResetID                 string     `gorm:"column:reset_id;primaryKey;size:128"`
	OwnerDomain             string     `gorm:"column:owner_domain;primaryKey;size:32"`
	OwnerPTID               string     `gorm:"column:owner_ptid;primaryKey;size:255;not null"`
	StorageKeyDigest        string     `gorm:"column:storage_key_digest;primaryKey;size:64"`
	Backend                 string     `gorm:"column:backend;size:64;not null"`
	StorageKey              string     `gorm:"column:storage_key;size:1024;not null"`
	ExpectedMetadataDigest  string     `gorm:"column:expected_metadata_digest;size:64;not null"`
	ExpectedBlobDigest      string     `gorm:"column:expected_blob_digest;size:64;not null"`
	SourceRowDigest         string     `gorm:"column:source_row_digest;size:64;not null"`
	ReferenceClassification string     `gorm:"column:reference_classification;size:64;not null"`
	DeletedAt               *time.Time `gorm:"column:deleted_at"`
}

func (secureContentResetObjectTargetModel) TableName() string {
	return resetObjectTargetTable
}

type secureContentSchemaAttestationModel struct {
	ResetID           string    `gorm:"column:reset_id;primaryKey;size:128"`
	ManifestDigest    string    `gorm:"column:manifest_digest;size:64;not null;uniqueIndex"`
	AttestationDigest string    `gorm:"column:attestation_digest;size:64;not null;uniqueIndex"`
	AttestationJSON   []byte    `gorm:"column:attestation_json;not null"`
	CreatedAt         time.Time `gorm:"column:created_at;not null"`
}

func (secureContentSchemaAttestationModel) TableName() string {
	return resetAttestationTable
}

// PreparedSecureContentReset holds the immutable manifest and ephemeral keys.
type PreparedSecureContentReset struct {
	Manifest      SecureContentResetManifestV1
	ObjectTargets []ResolvedResetObjectTarget
}

// GORMSecureContentResetStore owns Social reset preflight and persistence.
type GORMSecureContentResetStore struct {
	db *gorm.DB
}

// NewGORMSecureContentResetStore creates the Station-owned reset store.
func NewGORMSecureContentResetStore(
	db *gorm.DB,
) (*GORMSecureContentResetStore, error) {
	if db == nil {
		return nil, resetError(ResetCodeInvalidInput, "reset database is required")
	}

	return &GORMSecureContentResetStore{db: db}, nil
}

// MigrateControlSchema creates only the reset manifest and journal tables.
func (s *GORMSecureContentResetStore) MigrateControlSchema(
	ctx context.Context,
) error {
	err := s.db.WithContext(ctx).AutoMigrate(
		&secureContentResetManifestModel{},
		&secureContentResetJournalModel{},
		&secureContentResetInvocationModel{},
		&secureContentResetTransitionModel{},
		&secureContentResetReplacementModel{},
		&secureContentResetObjectTargetModel{},
		&secureContentSchemaAttestationModel{},
	)
	if err != nil {
		return resetError(
			ResetCodePartialFailure,
			"migrate Secure Content reset control schema: %v",
			err,
		)
	}

	return nil
}

// WithAdvisoryLock holds the profile/scope lock for the complete command.
func (s *GORMSecureContentResetStore) WithAdvisoryLock(
	ctx context.Context,
	deploymentEnvironment string,
	destructiveScope string,
	fn func(*GORMSecureContentResetStore) error,
) error {
	if fn == nil {
		return resetError(ResetCodeInvalidInput, "reset lock callback is required")
	}
	lockName := deploymentEnvironment + "\x00" + destructiveScope
	if s.db.Dialector.Name() == "sqlite" {
		value, _ := secureContentResetSQLiteLocks.LoadOrStore(
			fmt.Sprintf("%p:%s", s.db, lockName),
			&sync.Mutex{},
		)
		lock := value.(*sync.Mutex)
		lock.Lock()
		defer lock.Unlock()

		return fn(s)
	}
	if s.db.Dialector.Name() != "postgres" {
		return resetError(
			ResetCodeInvalidInput,
			"reset advisory lock is unsupported for %s",
			s.db.Dialector.Name(),
		)
	}

	return s.db.WithContext(ctx).Connection(func(connection *gorm.DB) error {
		digest := sha256.Sum256([]byte(lockName))
		lockID := int64(binary.BigEndian.Uint64(digest[:8]))
		if err := connection.Exec("SELECT pg_advisory_lock(?)", lockID).Error; err != nil {
			return resetError(
				ResetCodePartialFailure,
				"acquire Secure Content reset advisory lock: %v",
				err,
			)
		}
		defer func() {
			_ = connection.Exec("SELECT pg_advisory_unlock(?)", lockID).Error
		}()

		return fn(&GORMSecureContentResetStore{db: connection})
	})
}

// PrepareManifest performs the complete non-mutating SC-D23 preflight.
func (s *GORMSecureContentResetStore) PrepareManifest(
	ctx context.Context,
	identity ResetScopeIdentity,
	socialObjects ResetObjectOwner,
	legacyObjects ResetObjectOwner,
) (PreparedSecureContentReset, error) {
	if err := validateScopeIdentity(identity); err != nil {
		return PreparedSecureContentReset{}, err
	}
	if socialObjects == nil || legacyObjects == nil {
		return PreparedSecureContentReset{}, resetError(
			ResetCodeInvalidInput,
			"both Social and OSS object owners are required",
		)
	}

	database := s.db.WithContext(ctx)
	tables, err := database.Migrator().GetTables()
	if err != nil {
		return PreparedSecureContentReset{}, resetError(
			ResetCodePartialFailure,
			"list database tables: %v",
			err,
		)
	}
	tables = canonicalStrings(tables)
	if err := requireResetTables(database, tables); err != nil {
		return PreparedSecureContentReset{}, err
	}
	if err := validatePrivatePostColumns(database); err != nil {
		return PreparedSecureContentReset{}, err
	}
	if err := validatePrivatePostIndexes(database, true); err != nil {
		return PreparedSecureContentReset{}, err
	}
	if err := rejectUnexpectedForeignKeys(database, tables); err != nil {
		return PreparedSecureContentReset{}, err
	}

	publicReferences, err := loadPostObjectReferences(
		database,
		"social_public_posts",
		false,
	)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	publicKeySet := make(map[string]struct{}, len(publicReferences))
	for _, reference := range publicReferences {
		publicKeySet[reference.StorageKey] = struct{}{}
	}

	canonicalReferences, err := loadCanonicalObjectReferences(database)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	legacyReferences, err := loadPostObjectReferences(
		database,
		"social_private_posts",
		true,
	)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	if err := rejectCrossDomainReferences(
		database,
		legacyReferences,
		publicKeySet,
	); err != nil {
		return PreparedSecureContentReset{}, err
	}

	canonicalTargets, canonicalResolved, err := inspectObjectReferences(
		ctx,
		identity.ResetID,
		canonicalReferences,
		socialObjects,
	)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	legacyTargets, legacyResolved, err := inspectObjectReferences(
		ctx,
		identity.ResetID,
		legacyReferences,
		legacyObjects,
	)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	publicSnapshot, err := capturePublicSnapshot(
		ctx,
		database,
		identity.ProfileID,
		publicReferences,
		legacyObjects,
	)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	databaseTargets, err := buildDatabaseTargets(database)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	databaseIdentityDigest, err := currentDatabaseIdentityDigest(database)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}
	recoveryPredecessor, err := s.recoveryPredecessor(
		ctx,
		identity,
		databaseIdentityDigest,
		publicSnapshot,
	)
	if err != nil {
		return PreparedSecureContentReset{}, err
	}

	outOfScope := make([]string, 0, len(tables))
	mutable := resetMutableTableSet()
	for _, table := range tables {
		if _, ok := mutable[table]; !ok {
			outOfScope = append(outOfScope, table)
		}
	}
	manifest := SecureContentResetManifestV1{
		SchemaVersion:                 SecureContentResetSchemaVersion,
		ResetID:                       identity.ResetID,
		ResetIntent:                   identity.ResetIntent,
		SourceCommit:                  identity.SourceCommit,
		WorkspaceID:                   identity.WorkspaceID,
		ProfileID:                     identity.ProfileID,
		DeploymentEnvironment:         identity.DeploymentEnvironment,
		DestructiveScope:              identity.DestructiveScope,
		DatabaseIdentityDigest:        databaseIdentityDigest,
		PublicSnapshotBefore:          publicSnapshot,
		DatabaseTargets:               databaseTargets,
		CanonicalPrivateObjectTargets: canonicalTargets,
		LegacyOSSObjectTargets:        legacyTargets,
		OutOfScopeTableNames:          outOfScope,
		RecoveryPredecessor:           recoveryPredecessor,
		CreatedAt:                     identity.CreatedAt.UTC(),
	}
	manifest.ManifestDigest, err = manifest.CalculatedDigest()
	if err != nil {
		return PreparedSecureContentReset{}, resetError(
			ResetCodePartialFailure,
			"calculate reset manifest digest: %v",
			err,
		)
	}

	return PreparedSecureContentReset{
		Manifest:      manifest,
		ObjectTargets: append(canonicalResolved, legacyResolved...),
	}, nil
}

func validateScopeIdentity(identity ResetScopeIdentity) error {
	if identity.SchemaVersion != SecureContentResetSchemaVersion ||
		!resetIdentifierPattern.MatchString(identity.ResetID) ||
		!isGitCommit(identity.SourceCommit) ||
		strings.TrimSpace(identity.WorkspaceID) == "" ||
		identity.CreatedAt.IsZero() {
		return resetError(ResetCodeInvalidInput, "reset manifest identity is incomplete")
	}
	expectedEnvironment, expectedScope, ok := expectedResetTarget(identity.ProfileID)
	if !ok ||
		identity.DeploymentEnvironment != expectedEnvironment ||
		identity.DestructiveScope != expectedScope {
		return resetError(ResetCodeUnauthorizedTarget, "reset manifest target is not allowlisted")
	}
	if identity.ResetIntent != ResetIntentSchemaActivation &&
		identity.ResetIntent != ResetIntentFinalCut {
		return resetError(ResetCodeUnauthorizedTarget, "reset intent is not allowlisted")
	}

	return nil
}

func validateRecoveryPredecessor(
	recovery *ResetRecoveryPredecessorV1,
) error {
	if recovery == nil {
		return nil
	}
	if !resetIdentifierPattern.MatchString(recovery.ResetID) ||
		!isSHA256(recovery.ResetManifestDigest) ||
		!isSHA256(recovery.JournalDigest) {
		return resetError(
			ResetCodeManifestConflict,
			"reset recovery predecessor is invalid",
		)
	}
	switch recovery.State {
	case ResetStateObjectsDeleted:
		if recovery.FailureCode != ResetCodeSourceSuperseded {
			return resetError(
				ResetCodeManifestConflict,
				"OBJECTS_DELETED recovery requires source-superseded reason",
			)
		}
	case ResetStateStationDeployed:
		if recovery.FailureCode != ResetCodeSchemaTargetUnreviewed &&
			recovery.FailureCode != ResetCodeSourceSuperseded {
			return resetError(
				ResetCodeManifestConflict,
				"STATION_DEPLOYED recovery requires an approved replacement reason",
			)
		}
	default:
		return resetError(
			ResetCodeManifestConflict,
			"reset recovery predecessor state is not replaceable",
		)
	}

	return nil
}

func (s *GORMSecureContentResetStore) recoveryPredecessor(
	ctx context.Context,
	identity ResetScopeIdentity,
	databaseIdentityDigest string,
	publicSnapshot PublicSocialSnapshotV1,
) (*ResetRecoveryPredecessorV1, error) {
	if identity.RecoveryPredecessor != nil {
		if err := s.validateRecoveryPredecessorReference(
			ctx,
			identity,
			databaseIdentityDigest,
			publicSnapshot,
		); err != nil {
			return nil, err
		}
		recovery := *identity.RecoveryPredecessor

		return &recovery, nil
	}
	var active []secureContentResetJournalModel
	err := s.db.WithContext(ctx).
		Where(
			"deployment_environment = ? AND destructive_scope = ? AND current_state NOT IN ?",
			identity.DeploymentEnvironment,
			identity.DestructiveScope,
			[]string{
				string(ResetStateComplete),
				string(ResetStateSuperseded),
				string(ResetStateRecoveryReplaced),
			},
		).
		Order("reset_id ASC").
		Find(&active).Error
	if err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"inspect active reset predecessor: %v",
			err,
		)
	}
	if len(active) == 0 {
		return nil, nil
	}
	if len(active) != 1 {
		return nil, resetError(
			ResetCodeManifestConflict,
			"multiple reset manifests are active for this deployment and scope",
		)
	}
	row := active[0]
	previous, err := loadManifestInTransaction(
		s.db.WithContext(ctx),
		row.ResetID,
	)
	if err != nil {
		return nil, err
	}
	if ResetState(row.CurrentState) == ResetStatePrepared {
		if previous.RecoveryPredecessor == nil {
			return nil, nil
		}
		resumeIdentity := identity
		resumeIdentity.RecoveryPredecessor = previous.RecoveryPredecessor
		if err := s.validateRecoveryPredecessorReference(
			ctx,
			resumeIdentity,
			databaseIdentityDigest,
			publicSnapshot,
		); err != nil {
			return nil, err
		}
		recovery := *previous.RecoveryPredecessor

		return &recovery, nil
	}
	replacement, eligible := recoveryReplacementDecision(previous, row)
	if !eligible {
		return nil, resetError(
			ResetCodeManifestConflict,
			"active post-commit reset is not eligible for source recovery",
		)
	}
	if previous.ResetID == identity.ResetID ||
		previous.SourceCommit == identity.SourceCommit ||
		previous.WorkspaceID != identity.WorkspaceID ||
		previous.ProfileID != identity.ProfileID ||
		previous.DeploymentEnvironment != identity.DeploymentEnvironment ||
		previous.DestructiveScope != identity.DestructiveScope ||
		previous.ResetIntent != identity.ResetIntent ||
		!equalDigest(previous.DatabaseIdentityDigest, databaseIdentityDigest) ||
		!reflect.DeepEqual(previous.PublicSnapshotBefore, publicSnapshot) {
		return nil, resetError(
			ResetCodeManifestConflict,
			"active post-commit reset does not match the recovery identity",
		)
	}
	journal, err := loadJournalProjection(s.db.WithContext(ctx), row)
	if err != nil {
		return nil, err
	}
	journalDigest, err := journal.CalculatedDigest()
	if err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"calculate recovery predecessor journal digest: %v",
			err,
		)
	}

	return &ResetRecoveryPredecessorV1{
		ResetID:             previous.ResetID,
		ResetManifestDigest: previous.ManifestDigest,
		JournalDigest:       journalDigest,
		State:               ResetState(row.CurrentState),
		FailureCode:         replacement.Reason,
	}, nil
}

type recoveryReplacement struct {
	OriginalFailureCode ResetCode
	Reason              ResetCode
}

func recoveryReplacementDecision(
	manifest SecureContentResetManifestV1,
	journal secureContentResetJournalModel,
) (recoveryReplacement, bool) {
	switch ResetState(journal.CurrentState) {
	case ResetStateObjectsDeleted:
		if journal.FailureCode == "" && journal.FailureAt == nil {
			return recoveryReplacement{
				Reason: ResetCodeSourceSuperseded,
			}, true
		}
		if ResetCode(journal.FailureCode) == ResetCodePartialFailure &&
			journal.FailureAt != nil {
			return recoveryReplacement{
				OriginalFailureCode: ResetCodePartialFailure,
				Reason:              ResetCodeSourceSuperseded,
			}, true
		}
	case ResetStateStationDeployed:
		failureCode := ResetCode(journal.FailureCode)
		if journal.FailureAt == nil {
			break
		}
		if failureCode == ResetCodeSchemaTargetUnreviewed {
			return recoveryReplacement{
				OriginalFailureCode: failureCode,
				Reason:              ResetCodeSchemaTargetUnreviewed,
			}, true
		}
		if failureCode == ResetCodeJournalStateConflict &&
			manifest.RecoveryPredecessor != nil {
			return recoveryReplacement{
				OriginalFailureCode: failureCode,
				Reason:              ResetCodeSourceSuperseded,
			}, true
		}
	}

	return recoveryReplacement{}, false
}

func (s *GORMSecureContentResetStore) validateRecoveryPredecessorReference(
	ctx context.Context,
	identity ResetScopeIdentity,
	databaseIdentityDigest string,
	publicSnapshot PublicSocialSnapshotV1,
) error {
	recovery := identity.RecoveryPredecessor
	if err := validateRecoveryPredecessor(recovery); err != nil {
		return err
	}
	previous, err := s.Manifest(ctx, recovery.ResetID)
	if err != nil {
		return err
	}
	journal, found, err := s.LoadJournal(ctx, recovery.ResetID)
	if err != nil || !found {
		return resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor journal is unavailable: %v",
			err,
		)
	}
	switch journal.CurrentState {
	case recovery.State:
		if !recoveryJournalBeforeReplacementMatches(
			previous,
			journal,
			recovery,
		) {
			return resetError(
				ResetCodeJournalStateConflict,
				"recovery predecessor failure state is invalid",
			)
		}
		journalDigest, err := journal.CalculatedDigest()
		if err != nil {
			return resetError(
				ResetCodePartialFailure,
				"calculate recovery predecessor journal digest: %v",
				err,
			)
		}
		if !equalDigest(recovery.JournalDigest, journalDigest) {
			return resetError(
				ResetCodeManifestConflict,
				"recovery predecessor journal digest changed",
			)
		}
	case ResetStateRecoveryReplaced:
		successor := SecureContentResetManifestV1{
			ResetID:                identity.ResetID,
			ResetIntent:            identity.ResetIntent,
			SourceCommit:           identity.SourceCommit,
			WorkspaceID:            identity.WorkspaceID,
			ProfileID:              identity.ProfileID,
			DeploymentEnvironment:  identity.DeploymentEnvironment,
			DestructiveScope:       identity.DestructiveScope,
			DatabaseIdentityDigest: databaseIdentityDigest,
			PublicSnapshotBefore:   publicSnapshot,
			RecoveryPredecessor:    recovery,
		}
		if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			_, err := validateRecoveryPredecessorTerminalInTransaction(
				tx,
				successor,
			)

			return err
		}); err != nil {
			return err
		}
	default:
		return resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor is not at the approved boundary",
		)
	}
	if recovery.ResetID != previous.ResetID ||
		!equalDigest(recovery.ResetManifestDigest, previous.ManifestDigest) ||
		previous.ResetID == identity.ResetID ||
		previous.SourceCommit == identity.SourceCommit ||
		previous.WorkspaceID != identity.WorkspaceID ||
		previous.ProfileID != identity.ProfileID ||
		previous.DeploymentEnvironment != identity.DeploymentEnvironment ||
		previous.DestructiveScope != identity.DestructiveScope ||
		previous.ResetIntent != identity.ResetIntent ||
		!equalDigest(previous.DatabaseIdentityDigest, databaseIdentityDigest) ||
		!reflect.DeepEqual(previous.PublicSnapshotBefore, publicSnapshot) {
		return resetError(
			ResetCodeManifestConflict,
			"recovery predecessor does not match the immutable successor identity",
		)
	}
	if previous.RecoveryPredecessor != nil {
		ancestors, err := s.validateRecoveryPredecessorChain(ctx, previous)
		if err != nil {
			return err
		}
		if len(ancestors)+1 > 32 {
			return resetError(
				ResetCodeManifestConflict,
				"recovery predecessor chain has reached the bounded depth",
			)
		}
	}

	return nil
}

func recoveryJournalBeforeReplacementMatches(
	manifest SecureContentResetManifestV1,
	journal ResetJournalV1,
	recovery *ResetRecoveryPredecessorV1,
) bool {
	if recovery == nil || journal.CurrentState != recovery.State {
		return false
	}
	switch recovery.State {
	case ResetStateObjectsDeleted:
		return recovery.FailureCode == ResetCodeSourceSuperseded &&
			(journal.Failure == nil ||
				journal.Failure.Code == ResetCodePartialFailure)
	case ResetStateStationDeployed:
		if journal.Failure == nil {
			return false
		}
		if recovery.FailureCode == ResetCodeSchemaTargetUnreviewed {
			return journal.Failure.Code == ResetCodeSchemaTargetUnreviewed
		}

		return recovery.FailureCode == ResetCodeSourceSuperseded &&
			journal.Failure.Code == ResetCodeJournalStateConflict &&
			manifest.RecoveryPredecessor != nil
	default:
		return false
	}
}

// LoadJournal returns the current durable journal projection.
func (s *GORMSecureContentResetStore) LoadJournal(
	ctx context.Context,
	resetID string,
) (ResetJournalV1, bool, error) {
	var journalModel secureContentResetJournalModel
	err := s.db.WithContext(ctx).
		Where("reset_id = ?", resetID).
		First(&journalModel).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ResetJournalV1{}, false, nil
	}
	if err != nil {
		return ResetJournalV1{}, false, resetError(
			ResetCodePartialFailure,
			"load reset journal: %v",
			err,
		)
	}
	journal, err := loadJournalProjection(
		s.db.WithContext(ctx),
		journalModel,
	)
	if err != nil {
		return ResetJournalV1{}, false, err
	}

	return journal, true, nil
}

// SaveAuditedManifest persists the immutable audit and opaque owner targets.
func (s *GORMSecureContentResetStore) SaveAuditedManifest(
	ctx context.Context,
	prepared PreparedSecureContentReset,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		return savePreparedManifest(tx, prepared)
	})
}

// AcceptInvocation creates PREPARED state or appends one immutable attempt.
func (s *GORMSecureContentResetStore) AcceptInvocation(
	ctx context.Context,
	invocation SecureContentResetInvocationV1,
	prepared *PreparedSecureContentReset,
	now time.Time,
) (ResetJournalV1, bool, error) {
	var journal ResetJournalV1
	exactReplay := false
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing secureContentResetInvocationModel
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("invocation_id = ?", invocation.InvocationID).
			First(&existing).Error
		if err == nil {
			if existing.ResetID != invocation.ResetID ||
				!equalDigest(existing.InvocationDigest, invocation.InvocationDigest) {
				return resetError(
					ResetCodeInvocationConflict,
					"invocation ID is already bound to another digest",
				)
			}
			current, found, loadErr := loadJournalInTransaction(tx, invocation.ResetID)
			if loadErr != nil {
				return loadErr
			}
			if !found {
				return resetError(
					ResetCodeJournalStateConflict,
					"accepted invocation has no reset journal",
				)
			}
			journal = current
			exactReplay = true

			return nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return resetError(
				ResetCodePartialFailure,
				"load accepted reset invocation: %v",
				err,
			)
		}

		current, found, err := loadJournalInTransaction(tx, invocation.ResetID)
		if err != nil {
			return err
		}
		if !found {
			if prepared == nil {
				return resetError(
					ResetCodeManifestConflict,
					"new reset requires a prepared manifest",
				)
			}
			if !equalDigest(
				prepared.Manifest.ManifestDigest,
				invocation.ResetManifestDigest,
			) {
				return resetError(
					ResetCodeManifestConflict,
					"prepared manifest digest does not match invocation",
				)
			}
			if err := savePreparedManifest(tx, *prepared); err != nil {
				return err
			}
			if err := replaceActiveResetConflicts(
				tx,
				prepared.Manifest,
				now,
			); err != nil {
				return err
			}
			if err := insertPreparedJournal(tx, prepared.Manifest, now); err != nil {
				return err
			}
			current, found, err = loadJournalInTransaction(tx, invocation.ResetID)
			if err != nil || !found {
				return resetError(
					ResetCodeJournalStateConflict,
					"load newly prepared reset journal: %v",
					err,
				)
			}
		} else if slices.Contains(
			[]ResetState{
				ResetStateSuperseded,
				ResetStateRecoveryReplaced,
			},
			ResetState(current.CurrentState),
		) {
			return resetError(
				ResetCodeJournalStateConflict,
				"terminal non-success reset journal cannot accept another invocation",
			)
		} else if !equalDigest(
			current.ResetManifestDigest,
			invocation.ResetManifestDigest,
		) {
			return resetError(
				ResetCodeManifestConflict,
				"active reset journal is bound to another manifest",
			)
		}
		manifest, err := loadManifestInTransaction(tx, invocation.ResetID)
		if err != nil {
			return err
		}
		if err := requireInvocationMatchesManifest(invocation, manifest); err != nil {
			return err
		}
		accepted := secureContentResetInvocationModel{
			InvocationID:     invocation.InvocationID,
			InvocationDigest: strings.ToLower(invocation.InvocationDigest),
			ResetID:          invocation.ResetID,
			AcceptedAt:       now.UTC(),
		}
		if err := tx.Create(&accepted).Error; err != nil {
			return resetError(
				ResetCodePartialFailure,
				"record accepted reset invocation: %v",
				err,
			)
		}
		journal, _, err = loadJournalInTransaction(tx, invocation.ResetID)

		return err
	})
	if err != nil {
		return ResetJournalV1{}, false, err
	}

	return journal, exactReplay, nil
}

func insertPreparedJournal(
	tx *gorm.DB,
	manifest SecureContentResetManifestV1,
	now time.Time,
) error {
	journal := secureContentResetJournalModel{
		ResetID:               manifest.ResetID,
		ManifestDigest:        manifest.ManifestDigest,
		DeploymentEnvironment: manifest.DeploymentEnvironment,
		DestructiveScope:      manifest.DestructiveScope,
		CurrentState:          string(ResetStatePrepared),
		CreatedAt:             now.UTC(),
		UpdatedAt:             now.UTC(),
	}
	if err := tx.Create(&journal).Error; err != nil {
		return resetError(
			ResetCodePartialFailure,
			"persist reset journal: %v",
			err,
		)
	}

	return nil
}

func savePreparedManifest(
	tx *gorm.DB,
	prepared PreparedSecureContentReset,
) error {
	if err := validateRecoveryPredecessor(
		prepared.Manifest.RecoveryPredecessor,
	); err != nil {
		return err
	}
	var existing secureContentResetManifestModel
	err := tx.Where("reset_id = ?", prepared.Manifest.ResetID).
		First(&existing).Error
	if err == nil {
		if !equalDigest(
			existing.ManifestDigest,
			prepared.Manifest.ManifestDigest,
		) {
			return resetError(
				ResetCodeManifestConflict,
				"reset ID is already bound to another manifest",
			)
		}

		return nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return resetError(
			ResetCodePartialFailure,
			"load audited reset manifest: %v",
			err,
		)
	}

	manifestBytes, err := json.Marshal(prepared.Manifest)
	if err != nil {
		return resetError(
			ResetCodePartialFailure,
			"encode prepared reset manifest: %v",
			err,
		)
	}
	manifest := secureContentResetManifestModel{
		ResetID:               prepared.Manifest.ResetID,
		ManifestDigest:        prepared.Manifest.ManifestDigest,
		ResetIntent:           string(prepared.Manifest.ResetIntent),
		SourceCommit:          prepared.Manifest.SourceCommit,
		WorkspaceID:           prepared.Manifest.WorkspaceID,
		ProfileID:             prepared.Manifest.ProfileID,
		DeploymentEnvironment: prepared.Manifest.DeploymentEnvironment,
		DestructiveScope:      prepared.Manifest.DestructiveScope,
		ManifestJSON:          manifestBytes,
		CreatedAt:             prepared.Manifest.CreatedAt.UTC(),
	}
	if err := tx.Create(&manifest).Error; err != nil {
		return resetError(
			ResetCodeManifestConflict,
			"persist reset manifest: %v",
			err,
		)
	}
	for _, target := range prepared.ObjectTargets {
		row := secureContentResetObjectTargetModel{
			ResetID:                 prepared.Manifest.ResetID,
			OwnerDomain:             string(target.OwnerDomain),
			StorageKeyDigest:        sha256Hex([]byte(target.StorageKey)),
			OwnerPTID:               target.OwnerPTID,
			Backend:                 target.Backend,
			StorageKey:              target.StorageKey,
			ExpectedMetadataDigest:  target.ExpectedMetadataDigest,
			ExpectedBlobDigest:      target.ExpectedBlobDigest,
			SourceRowDigest:         target.SourceRowDigest,
			ReferenceClassification: string(target.ReferenceClassification),
		}
		if err := tx.Create(&row).Error; err != nil {
			return resetError(
				ResetCodePartialFailure,
				"persist reset object target: %v",
				err,
			)
		}
	}

	return nil
}

func replaceActiveResetConflicts(
	tx *gorm.DB,
	manifest SecureContentResetManifestV1,
	now time.Time,
) error {
	var active []secureContentResetJournalModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where(
			"deployment_environment = ? AND destructive_scope = ? AND current_state NOT IN ?",
			manifest.DeploymentEnvironment,
			manifest.DestructiveScope,
			[]string{
				string(ResetStateComplete),
				string(ResetStateSuperseded),
				string(ResetStateRecoveryReplaced),
			},
		).
		Order("reset_id ASC").
		Find(&active).Error
	if err != nil {
		return resetError(
			ResetCodePartialFailure,
			"check active reset journal: %v",
			err,
		)
	}
	recoveryMatched := false
	for _, journal := range active {
		previous, err := loadManifestInTransaction(tx, journal.ResetID)
		if err != nil {
			return err
		}
		switch ResetState(journal.CurrentState) {
		case ResetStatePrepared:
			if !reflect.DeepEqual(
				previous.RecoveryPredecessor,
				manifest.RecoveryPredecessor,
			) ||
				previous.WorkspaceID != manifest.WorkspaceID ||
				previous.ProfileID != manifest.ProfileID ||
				previous.DeploymentEnvironment != manifest.DeploymentEnvironment ||
				previous.DestructiveScope != manifest.DestructiveScope ||
				previous.ResetIntent != manifest.ResetIntent ||
				previous.SourceCommit == manifest.SourceCommit {
				return resetError(
					ResetCodeManifestConflict,
					"another reset manifest is active for this deployment and scope",
				)
			}
			if err := supersedePreparedJournalInTransaction(
				tx,
				journal,
				now,
			); err != nil {
				return err
			}
			recoveryMatched = manifest.RecoveryPredecessor != nil
		case ResetStateObjectsDeleted, ResetStateStationDeployed:
			replacement, matches, err := matchesRecoveryPredecessor(
				tx,
				manifest,
				previous,
				journal,
			)
			if err != nil {
				return err
			}
			if recoveryMatched ||
				manifest.RecoveryPredecessor == nil ||
				!matches {
				return resetError(
					ResetCodeManifestConflict,
					"active post-deploy reset does not match the recovery predecessor",
				)
			}
			if err := replaceRecoveryJournalInTransaction(
				tx,
				manifest,
				previous,
				journal,
				replacement,
				now,
			); err != nil {
				return err
			}
			recoveryMatched = true
		default:
			return resetError(
				ResetCodeManifestConflict,
				"another reset manifest is active for this deployment and scope",
			)
		}
	}
	if manifest.RecoveryPredecessor != nil && !recoveryMatched {
		return resetError(
			ResetCodeManifestConflict,
			"recovery predecessor is no longer active",
		)
	}

	return nil
}

func matchesRecoveryPredecessor(
	tx *gorm.DB,
	manifest SecureContentResetManifestV1,
	previous SecureContentResetManifestV1,
	journal secureContentResetJournalModel,
) (recoveryReplacement, bool, error) {
	recovery := manifest.RecoveryPredecessor
	if recovery == nil ||
		recovery.ResetID != previous.ResetID ||
		!equalDigest(recovery.ResetManifestDigest, previous.ManifestDigest) ||
		ResetState(journal.CurrentState) != recovery.State ||
		previous.ResetID == manifest.ResetID ||
		previous.SourceCommit == manifest.SourceCommit ||
		previous.WorkspaceID != manifest.WorkspaceID ||
		previous.ProfileID != manifest.ProfileID ||
		previous.DeploymentEnvironment != manifest.DeploymentEnvironment ||
		previous.DestructiveScope != manifest.DestructiveScope ||
		previous.ResetIntent != manifest.ResetIntent ||
		!equalDigest(
			previous.DatabaseIdentityDigest,
			manifest.DatabaseIdentityDigest,
		) ||
		!reflect.DeepEqual(
			previous.PublicSnapshotBefore,
			manifest.PublicSnapshotBefore,
		) {
		return recoveryReplacement{}, false, nil
	}
	replacement, eligible := recoveryReplacementDecision(previous, journal)
	if !eligible || recovery.FailureCode != replacement.Reason {
		return recoveryReplacement{}, false, nil
	}
	if replacement.OriginalFailureCode == ResetCodeJournalStateConflict {
		if _, err := validateRecoveryPredecessorChainInTransaction(
			tx,
			previous,
		); err != nil {
			return recoveryReplacement{}, false, err
		}
	}
	projection, err := loadJournalProjection(tx, journal)
	if err != nil {
		return recoveryReplacement{}, false, err
	}
	digest, err := projection.CalculatedDigest()
	if err != nil {
		return recoveryReplacement{}, false, resetError(
			ResetCodePartialFailure,
			"calculate recovery predecessor journal digest: %v",
			err,
		)
	}

	return replacement, equalDigest(digest, recovery.JournalDigest), nil
}

func requireInvocationMatchesManifest(
	invocation SecureContentResetInvocationV1,
	manifest SecureContentResetManifestV1,
) error {
	if invocation.ResetID != manifest.ResetID ||
		invocation.ResetIntent != manifest.ResetIntent ||
		invocation.SourceCommit != manifest.SourceCommit ||
		invocation.WorkspaceID != manifest.WorkspaceID ||
		invocation.ProfileID != manifest.ProfileID ||
		invocation.DeploymentEnvironment != manifest.DeploymentEnvironment ||
		invocation.DestructiveScope != manifest.DestructiveScope ||
		!equalDigest(invocation.ResetManifestDigest, manifest.ManifestDigest) {
		return resetError(
			ResetCodeManifestConflict,
			"invocation identity does not match the immutable reset manifest",
		)
	}

	return nil
}

// CommitDatabase executes the closed delete/rebuild order in one transaction.
func (s *GORMSecureContentResetStore) CommitDatabase(
	ctx context.Context,
	resetID string,
	now time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		journal, found, err := loadJournalModel(tx, resetID)
		if err != nil {
			return err
		}
		if !found || ResetState(journal.CurrentState) != ResetStatePrepared {
			return resetError(
				ResetCodeJournalStateConflict,
				"database reset requires PREPARED state",
			)
		}
		manifest, err := loadManifestInTransaction(tx, resetID)
		if err != nil {
			return err
		}
		databaseIdentityDigest, err := currentDatabaseIdentityDigest(tx)
		if err != nil {
			return err
		}
		if !equalDigest(
			databaseIdentityDigest,
			manifest.DatabaseIdentityDigest,
		) {
			return resetError(
				ResetCodeManifestConflict,
				"database identity changed after reset audit",
			)
		}
		currentTargets, err := buildDatabaseTargets(tx)
		if err != nil {
			return err
		}
		if !reflect.DeepEqual(currentTargets, manifest.DatabaseTargets) {
			return resetError(
				ResetCodeManifestConflict,
				"database targets changed after reset audit",
			)
		}
		tables, err := tx.Migrator().GetTables()
		if err != nil {
			return resetError(
				ResetCodePartialFailure,
				"list tables before reset transaction: %v",
				err,
			)
		}
		if err := validatePrivatePostColumns(tx); err != nil {
			return err
		}
		if err := validatePrivatePostIndexes(tx, true); err != nil {
			return err
		}
		if err := rejectUnexpectedForeignKeys(tx, canonicalStrings(tables)); err != nil {
			return err
		}
		for _, target := range CanonicalDatabaseResetTargets() {
			if err := executeDatabaseTarget(tx, target); err != nil {
				return err
			}
		}
		if err := validateCanonicalPrivatePostSchema(tx); err != nil {
			return err
		}

		return advanceJournalInTransaction(
			tx,
			journal,
			ResetStatePrepared,
			ResetStateDatabaseSchemaCommitted,
			now,
		)
	})
}

func executeDatabaseTarget(tx *gorm.DB, target DatabaseResetTarget) error {
	switch target.Operation {
	case ResetOperationClearTable:
		return executeExactDelete(tx, target.Table, "")
	case ResetOperationDeletePrivatePostClass:
		return executeExactDelete(tx, target.Table, "post_class = 'private'")
	case ResetOperationDropRetiredTable:
		if tx.Migrator().HasTable(target.Table) {
			if err := tx.Migrator().DropTable(target.Table); err != nil {
				return resetError(
					ResetCodePartialFailure,
					"drop reviewed retired table %s: %v",
					target.Table,
					err,
				)
			}
		}

		return nil
	case ResetOperationRebuildCanonicalPrivatePost:
		var remaining int64
		if err := tx.Model(&dbmodel.SocialPrivateContentPost{}).
			Count(&remaining).Error; err != nil {
			return resetError(
				ResetCodePartialFailure,
				"count private Posts before canonical rebuild: %v",
				err,
			)
		}
		if remaining != 0 {
			return resetError(
				ResetCodeJournalStateConflict,
				"canonical private Post rebuild requires an empty table",
			)
		}
		if err := tx.Migrator().DropTable(
			&dbmodel.SocialPrivateContentPost{},
		); err != nil {
			return resetError(
				ResetCodePartialFailure,
				"drop pre-activation private Post table: %v",
				err,
			)
		}
		if err := tx.AutoMigrate(&dbmodel.SocialPrivateContentPost{}); err != nil {
			return resetError(
				ResetCodePartialFailure,
				"rebuild canonical private Post schema: %v",
				err,
			)
		}

		return nil
	default:
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"database operation %q is not allowlisted",
			target.Operation,
		)
	}
}

func executeExactDelete(tx *gorm.DB, table string, predicate string) error {
	if _, ok := resetMutableTableSet()[table]; !ok {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"table %s is not mutable",
			table,
		)
	}
	statement := "DELETE FROM " + quoteIdentifier(table)
	if predicate != "" {
		if predicate != "post_class = 'private'" {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"predicate is not allowlisted",
			)
		}
		statement += " WHERE post_class = 'private'"
	}
	if err := tx.Exec(statement).Error; err != nil {
		return resetError(
			ResetCodePartialFailure,
			"execute reviewed delete on %s: %v",
			table,
			err,
		)
	}

	return nil
}

// PendingObjectTargets returns the not-yet-deleted owner operations.
func (s *GORMSecureContentResetStore) PendingObjectTargets(
	ctx context.Context,
	resetID string,
) ([]ResolvedResetObjectTarget, error) {
	var rows []secureContentResetObjectTargetModel
	err := s.db.WithContext(ctx).
		Where("reset_id = ? AND deleted_at IS NULL", resetID).
		Order("owner_domain ASC, owner_ptid ASC, storage_key_digest ASC").
		Find(&rows).Error
	if err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"load pending reset object targets: %v",
			err,
		)
	}
	targets := make([]ResolvedResetObjectTarget, 0, len(rows))
	for _, row := range rows {
		targets = append(targets, resolvedTargetFromModel(row))
	}

	return targets, nil
}

// AllObjectTargets returns every persisted owner operation for post-audit.
func (s *GORMSecureContentResetStore) AllObjectTargets(
	ctx context.Context,
	resetID string,
) ([]ResolvedResetObjectTarget, error) {
	var rows []secureContentResetObjectTargetModel
	err := s.db.WithContext(ctx).
		Where("reset_id = ?", resetID).
		Order("owner_domain ASC, owner_ptid ASC, storage_key_digest ASC").
		Find(&rows).Error
	if err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"load reset object targets: %v",
			err,
		)
	}
	targets := make([]ResolvedResetObjectTarget, 0, len(rows))
	for _, row := range rows {
		targets = append(targets, resolvedTargetFromModel(row))
	}

	return targets, nil
}

func resolvedTargetFromModel(
	row secureContentResetObjectTargetModel,
) ResolvedResetObjectTarget {
	return ResolvedResetObjectTarget{
		ResetID:                 row.ResetID,
		OwnerDomain:             ResetObjectDomain(row.OwnerDomain),
		OwnerPTID:               row.OwnerPTID,
		Backend:                 row.Backend,
		StorageKey:              row.StorageKey,
		StorageKeyDigest:        row.StorageKeyDigest,
		ExpectedMetadataDigest:  row.ExpectedMetadataDigest,
		ExpectedBlobDigest:      row.ExpectedBlobDigest,
		SourceRowDigest:         row.SourceRowDigest,
		ReferenceClassification: ResetReferenceClassification(row.ReferenceClassification),
	}
}

// MarkObjectDeleted records one idempotent owner operation completion.
func (s *GORMSecureContentResetStore) MarkObjectDeleted(
	ctx context.Context,
	target ResolvedResetObjectTarget,
	now time.Time,
) error {
	result := s.db.WithContext(ctx).
		Model(&secureContentResetObjectTargetModel{}).
		Where(
			"reset_id = ? AND owner_domain = ? AND owner_ptid = ? AND storage_key_digest = ?",
			target.ResetID,
			string(target.OwnerDomain),
			target.OwnerPTID,
			sha256Hex([]byte(target.StorageKey)),
		).
		Update("deleted_at", now.UTC())
	if result.Error != nil {
		return resetError(
			ResetCodePartialFailure,
			"record reset object deletion: %v",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return resetError(
			ResetCodeJournalStateConflict,
			"reset object target is not registered",
		)
	}

	return nil
}

// AdvanceJournal performs one exact monotonic transition.
func (s *GORMSecureContentResetStore) AdvanceJournal(
	ctx context.Context,
	resetID string,
	from ResetState,
	to ResetState,
	now time.Time,
) error {
	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		journal, found, err := loadJournalModel(tx, resetID)
		if err != nil {
			return err
		}
		if !found {
			return resetError(
				ResetCodeJournalStateConflict,
				"reset journal does not exist",
			)
		}

		return advanceJournalInTransaction(tx, journal, from, to, now)
	})
}

func advanceJournalInTransaction(
	tx *gorm.DB,
	journal secureContentResetJournalModel,
	from ResetState,
	to ResetState,
	now time.Time,
) error {
	return advanceJournalWithUpdatesInTransaction(
		tx,
		journal,
		from,
		to,
		now,
		nil,
	)
}

func advanceJournalWithUpdatesInTransaction(
	tx *gorm.DB,
	journal secureContentResetJournalModel,
	from ResetState,
	to ResetState,
	now time.Time,
	additionalUpdates map[string]any,
) error {
	if ResetState(journal.CurrentState) != from || nextResetState(from) != to {
		return resetError(
			ResetCodeJournalStateConflict,
			"journal transition %s -> %s is not currently legal",
			from,
			to,
		)
	}
	return appendJournalTransitionWithUpdates(
		tx,
		journal,
		from,
		to,
		now,
		additionalUpdates,
	)
}

func supersedePreparedJournalInTransaction(
	tx *gorm.DB,
	journal secureContentResetJournalModel,
	now time.Time,
) error {
	if ResetState(journal.CurrentState) != ResetStatePrepared {
		return resetError(
			ResetCodeJournalStateConflict,
			"only a PREPARED reset journal may be superseded",
		)
	}
	return appendJournalTransitionWithUpdates(
		tx,
		journal,
		ResetStatePrepared,
		ResetStateSuperseded,
		now,
		map[string]any{
			"failure_code": string(ResetCodeSourceSuperseded),
			"failure_at":   now.UTC(),
		},
	)
}

func replaceRecoveryJournalInTransaction(
	tx *gorm.DB,
	successor SecureContentResetManifestV1,
	predecessor SecureContentResetManifestV1,
	journal secureContentResetJournalModel,
	replacement recoveryReplacement,
	now time.Time,
) error {
	expected, eligible := recoveryReplacementDecision(predecessor, journal)
	if !eligible {
		return resetError(
			ResetCodeJournalStateConflict,
			"reset journal is not at a replaceable recovery boundary",
		)
	}
	if expected != replacement {
		return resetError(
			ResetCodeJournalStateConflict,
			"reset replacement decision changed before commit",
		)
	}
	recovery := successor.RecoveryPredecessor
	if recovery == nil {
		return resetError(
			ResetCodeManifestConflict,
			"reset recovery predecessor is required",
		)
	}
	receipt := secureContentResetReplacementModel{
		PredecessorResetID:        predecessor.ResetID,
		InitialSuccessorResetID:   successor.ResetID,
		PredecessorManifestDigest: predecessor.ManifestDigest,
		SuccessorManifestDigest:   successor.ManifestDigest,
		PredecessorJournalDigest:  recovery.JournalDigest,
		PredecessorState:          string(recovery.State),
		PredecessorFailureCode:    string(replacement.OriginalFailureCode),
		TerminalFailureCode:       journal.FailureCode,
		ReplacementReason:         string(replacement.Reason),
		DeploymentEnvironment:     predecessor.DeploymentEnvironment,
		DestructiveScope:          predecessor.DestructiveScope,
		ProvenanceMode:            replacementProvenanceAdmission,
		ReplacedAt:                now.UTC(),
	}
	if err := tx.Create(&receipt).Error; err != nil {
		return resetError(
			ResetCodeJournalStateConflict,
			"persist reset replacement receipt: %v",
			err,
		)
	}

	return appendJournalTransitionWithUpdates(
		tx,
		journal,
		ResetState(journal.CurrentState),
		ResetStateRecoveryReplaced,
		now,
		map[string]any{
			"failure_code": journal.FailureCode,
			"failure_at":   journal.FailureAt,
		},
	)
}

func appendJournalTransitionWithUpdates(
	tx *gorm.DB,
	journal secureContentResetJournalModel,
	from ResetState,
	to ResetState,
	now time.Time,
	additionalUpdates map[string]any,
) error {
	var count int64
	if err := tx.Model(&secureContentResetTransitionModel{}).
		Where("reset_id = ?", journal.ResetID).
		Count(&count).Error; err != nil {
		return resetError(
			ResetCodePartialFailure,
			"count reset journal transitions: %v",
			err,
		)
	}
	transition := secureContentResetTransitionModel{
		ResetID:      journal.ResetID,
		Ordinal:      count + 1,
		FromState:    string(from),
		ToState:      string(to),
		TransitionAt: now.UTC(),
	}
	if err := tx.Create(&transition).Error; err != nil {
		return resetError(
			ResetCodePartialFailure,
			"append reset journal transition: %v",
			err,
		)
	}
	updates := map[string]any{
		"current_state": string(to),
		"failure_code":  "",
		"failure_at":    nil,
		"updated_at":    now.UTC(),
	}
	for column, value := range additionalUpdates {
		updates[column] = value
	}
	result := tx.Model(&secureContentResetJournalModel{}).
		Where("reset_id = ? AND current_state = ?", journal.ResetID, string(from)).
		Updates(updates)
	if result.Error != nil {
		return resetError(
			ResetCodePartialFailure,
			"advance reset journal: %v",
			result.Error,
		)
	}
	if result.RowsAffected != 1 {
		return resetError(
			ResetCodeJournalStateConflict,
			"reset journal transition raced",
		)
	}

	return nil
}

// RecordPostAuditPassed atomically persists the proof needed to resume
// POST_AUDIT_PASSED and advances the journal to that durable state.
func (s *GORMSecureContentResetStore) RecordPostAuditPassed(
	ctx context.Context,
	manifest SecureContentResetManifestV1,
	deployment ResetDeploymentProof,
	canonicalSchemaDigest string,
	now time.Time,
) error {
	if err := validateStoredDeploymentProof(manifest, deployment); err != nil {
		return err
	}
	if !isSHA256(canonicalSchemaDigest) {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"canonical private schema digest is invalid",
		)
	}
	deploymentJSON, err := json.Marshal(deployment)
	if err != nil {
		return resetError(
			ResetCodePartialFailure,
			"encode post-audit deployment proof: %v",
			err,
		)
	}

	return s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		journal, found, err := loadJournalModel(tx, manifest.ResetID)
		if err != nil {
			return err
		}
		if !found ||
			ResetState(journal.CurrentState) != ResetStateStationDeployed ||
			!equalDigest(journal.ManifestDigest, manifest.ManifestDigest) {
			return resetError(
				ResetCodeJournalStateConflict,
				"post-audit persistence requires the matching STATION_DEPLOYED journal",
			)
		}
		var objectsDeleted secureContentResetTransitionModel
		if err := tx.Where(
			"reset_id = ? AND to_state = ?",
			manifest.ResetID,
			string(ResetStateObjectsDeleted),
		).Order("ordinal DESC").First(&objectsDeleted).Error; err != nil {
			return resetError(
				ResetCodeJournalStateConflict,
				"load OBJECTS_DELETED transition: %v",
				err,
			)
		}
		if !deployment.CapturedAt.After(objectsDeleted.TransitionAt) {
			return resetError(
				ResetCodePartialFailure,
				"Station deployment proof does not postdate object deletion",
			)
		}

		return advanceJournalWithUpdatesInTransaction(
			tx,
			journal,
			ResetStateStationDeployed,
			ResetStatePostAuditPassed,
			now,
			map[string]any{
				"post_audit_deployment":    deploymentJSON,
				"post_audit_schema_digest": strings.ToLower(canonicalSchemaDigest),
			},
		)
	})
}

// ValidatePostAuditEvidence verifies that resume observes the exact deployment
// and schema evidence persisted with the matching POST_AUDIT_PASSED journal.
func (s *GORMSecureContentResetStore) ValidatePostAuditEvidence(
	ctx context.Context,
	manifest SecureContentResetManifestV1,
	deployment ResetDeploymentProof,
	canonicalSchemaDigest string,
) error {
	var journal secureContentResetJournalModel
	err := s.db.WithContext(ctx).
		Where("reset_id = ?", manifest.ResetID).
		First(&journal).Error
	if err != nil {
		return resetError(
			ResetCodeJournalStateConflict,
			"load POST_AUDIT_PASSED journal: %v",
			err,
		)
	}
	if ResetState(journal.CurrentState) != ResetStatePostAuditPassed ||
		!equalDigest(journal.ManifestDigest, manifest.ManifestDigest) {
		return resetError(
			ResetCodeJournalStateConflict,
			"post-audit evidence requires the matching POST_AUDIT_PASSED journal",
		)
	}
	persistedDeployment, persistedSchemaDigest, err := loadPostAuditEvidence(
		journal,
		manifest,
	)
	if err != nil {
		return err
	}
	persistedDeploymentDigest, err := canonicalSHA256(persistedDeployment)
	if err != nil {
		return resetError(
			ResetCodeJournalStateConflict,
			"calculate persisted post-audit deployment digest: %v",
			err,
		)
	}
	deploymentDigest, err := canonicalSHA256(deployment)
	if err != nil {
		return resetError(
			ResetCodeJournalStateConflict,
			"calculate supplied post-audit deployment digest: %v",
			err,
		)
	}
	if !equalDigest(persistedDeploymentDigest, deploymentDigest) ||
		persistedSchemaDigest != canonicalSchemaDigest {
		return resetError(
			ResetCodeJournalStateConflict,
			"post-audit evidence does not match the persisted journal evidence",
		)
	}

	return nil
}

func nextResetState(state ResetState) ResetState {
	switch state {
	case ResetStatePrepared:
		return ResetStateDatabaseSchemaCommitted
	case ResetStateDatabaseSchemaCommitted:
		return ResetStateObjectsDeleted
	case ResetStateObjectsDeleted:
		return ResetStateStationDeployed
	case ResetStateStationDeployed:
		return ResetStatePostAuditPassed
	case ResetStatePostAuditPassed:
		return ResetStateComplete
	default:
		return ""
	}
}

// RecordFailure stores only a typed failure code and preserves current state.
func (s *GORMSecureContentResetStore) RecordFailure(
	ctx context.Context,
	resetID string,
	code ResetCode,
	now time.Time,
) error {
	result := s.db.WithContext(ctx).
		Model(&secureContentResetJournalModel{}).
		Where(
			"reset_id = ? AND current_state NOT IN ?",
			resetID,
			[]string{
				string(ResetStateComplete),
				string(ResetStateSuperseded),
				string(ResetStateRecoveryReplaced),
			},
		).
		Updates(map[string]any{
			"failure_code": string(code),
			"failure_at":   now.UTC(),
			"updated_at":   now.UTC(),
		})
	if result.Error != nil {
		return resetError(
			ResetCodePartialFailure,
			"record reset journal failure: %v",
			result.Error,
		)
	}

	return nil
}

// Manifest loads the immutable manifest for one reset.
func (s *GORMSecureContentResetStore) Manifest(
	ctx context.Context,
	resetID string,
) (SecureContentResetManifestV1, error) {
	return loadManifestInTransaction(s.db.WithContext(ctx), resetID)
}

// FindManifest returns the immutable manifest when the reset was previously
// prepared. Absence is distinct from corruption so callers never regenerate a
// conflicting manifest over an existing reset.
func (s *GORMSecureContentResetStore) FindManifest(
	ctx context.Context,
	resetID string,
) (SecureContentResetManifestV1, bool, error) {
	var row secureContentResetManifestModel
	err := s.db.WithContext(ctx).
		Where("reset_id = ?", resetID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return SecureContentResetManifestV1{}, false, nil
	}
	if err != nil {
		return SecureContentResetManifestV1{}, false, resetError(
			ResetCodeManifestConflict,
			"load reset manifest: %v",
			err,
		)
	}
	manifest, err := decodeManifestModel(row)
	if err != nil {
		return SecureContentResetManifestV1{}, false, err
	}

	return manifest, true, nil
}

// ExistingResetState reads reset progress without creating control tables.
func (s *GORMSecureContentResetStore) ExistingResetState(
	ctx context.Context,
	resetID string,
) (ResetState, bool, error) {
	database := s.db.WithContext(ctx)
	hasManifest := database.Migrator().HasTable(
		&secureContentResetManifestModel{},
	)
	hasJournal := database.Migrator().HasTable(
		&secureContentResetJournalModel{},
	)
	if !hasManifest && !hasJournal {
		return "", false, nil
	}
	if !hasManifest || !hasJournal {
		return "", false, resetError(
			ResetCodeJournalStateConflict,
			"Secure Content reset control schema is incomplete",
		)
	}
	_, found, err := s.FindManifest(ctx, resetID)
	if err != nil || !found {
		return "", found, err
	}
	journal, found, err := s.LoadJournal(ctx, resetID)
	if err != nil {
		return "", false, err
	}
	if !found {
		return "", false, resetError(
			ResetCodeJournalStateConflict,
			"existing reset manifest has no journal",
		)
	}

	return journal.CurrentState, true, nil
}

// ValidateTerminalInvocation rejects invocation-ID reuse before returning a
// sealed COMPLETE result without appending to the immutable journal.
func (s *GORMSecureContentResetStore) ValidateTerminalInvocation(
	ctx context.Context,
	invocation SecureContentResetInvocationV1,
) error {
	var existing secureContentResetInvocationModel
	err := s.db.WithContext(ctx).
		Where("invocation_id = ?", invocation.InvocationID).
		First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return resetError(
			ResetCodePartialFailure,
			"load terminal reset invocation: %v",
			err,
		)
	}
	if existing.ResetID != invocation.ResetID ||
		!equalDigest(existing.InvocationDigest, invocation.InvocationDigest) {
		return resetError(
			ResetCodeInvocationConflict,
			"reset invocation ID is already bound to another request",
		)
	}

	return nil
}

// PostAudit verifies public preservation and complete private removal.
func (s *GORMSecureContentResetStore) PostAudit(
	ctx context.Context,
	manifest SecureContentResetManifestV1,
	socialObjects ResetObjectOwner,
	legacyObjects ResetObjectOwner,
) (string, error) {
	database := s.db.WithContext(ctx)
	if err := validateCanonicalPrivatePostSchema(database); err != nil {
		return "", err
	}
	if database.Migrator().HasTable("social_private_audience_grants") {
		return "", resetError(
			ResetCodeSchemaTargetUnreviewed,
			"retired private audience grants table remains",
		)
	}
	for _, target := range CanonicalDatabaseResetTargets() {
		switch target.Operation {
		case ResetOperationClearTable:
			count, err := countRows(database, target.Table, "")
			if err != nil {
				return "", err
			}
			if count != 0 {
				return "", resetError(
					ResetCodePartialFailure,
					"reset target table %s is not empty",
					target.Table,
				)
			}
		case ResetOperationDeletePrivatePostClass:
			count, err := countRows(
				database,
				target.Table,
				"post_class = 'private'",
			)
			if err != nil {
				return "", err
			}
			if count != 0 {
				return "", resetError(
					ResetCodePartialFailure,
					"private legacy rows remain in %s",
					target.Table,
				)
			}
		}
	}
	publicReferences, err := loadPostObjectReferences(
		database,
		"social_public_posts",
		false,
	)
	if err != nil {
		return "", err
	}
	after, err := capturePublicSnapshot(
		ctx,
		database,
		manifest.ProfileID,
		publicReferences,
		legacyObjects,
	)
	if err != nil {
		return "", err
	}
	if !equalDigest(
		after.SnapshotDigest,
		manifest.PublicSnapshotBefore.SnapshotDigest,
	) {
		return "", resetError(
			ResetCodePublicSnapshotMismatch,
			"public Social snapshot changed during reset",
		)
	}
	if err := s.verifyManifestObjectTargetsDeleted(
		ctx,
		manifest,
		socialObjects,
		legacyObjects,
	); err != nil {
		return "", err
	}
	if manifest.RecoveryPredecessor != nil {
		predecessors, err := s.validateRecoveryPredecessorChain(ctx, manifest)
		if err != nil {
			return "", err
		}
		for _, previous := range predecessors {
			if err := s.verifyManifestObjectTargetsDeleted(
				ctx,
				previous,
				socialObjects,
				legacyObjects,
			); err != nil {
				return "", err
			}
		}
	}

	return canonicalPrivateSchemaDigest(database)
}

func (s *GORMSecureContentResetStore) verifyManifestObjectTargetsDeleted(
	ctx context.Context,
	manifest SecureContentResetManifestV1,
	socialObjects ResetObjectOwner,
	legacyObjects ResetObjectOwner,
) error {
	targets, err := s.AllObjectTargets(ctx, manifest.ResetID)
	if err != nil {
		return err
	}
	expected := make(map[string]ObjectResetTarget)
	for _, target := range append(
		append(
			[]ObjectResetTarget(nil),
			manifest.CanonicalPrivateObjectTargets...,
		),
		manifest.LegacyOSSObjectTargets...,
	) {
		key := resetObjectTargetIdentity(target)
		if _, exists := expected[key]; exists {
			return resetError(
				ResetCodeObjectDigestMismatch,
				"reset manifest contains duplicate object target identity",
			)
		}
		expected[key] = target
	}
	if len(targets) != len(expected) {
		return resetError(
			ResetCodeObjectDigestMismatch,
			"persisted reset object target count differs from the immutable manifest",
		)
	}
	for _, target := range targets {
		if target.ResetID != manifest.ResetID {
			return resetError(
				ResetCodeObjectDigestMismatch,
				"persisted reset object target belongs to another reset",
			)
		}
		projected := ObjectResetTarget{
			OwnerDomain:             target.OwnerDomain,
			OwnerIdentityDigest:     sha256Hex([]byte(target.OwnerPTID)),
			Backend:                 target.Backend,
			StorageKeyDigest:        target.StorageKeyDigest,
			MetadataDigest:          target.ExpectedMetadataDigest,
			BlobDigest:              target.ExpectedBlobDigest,
			SourceRowDigest:         target.SourceRowDigest,
			ReferenceClassification: target.ReferenceClassification,
		}
		if !equalDigest(
			target.StorageKeyDigest,
			sha256Hex([]byte(target.StorageKey)),
		) {
			return resetError(
				ResetCodeObjectDigestMismatch,
				"persisted reset object storage-key digest is invalid",
			)
		}
		key := resetObjectTargetIdentity(projected)
		wanted, ok := expected[key]
		if !ok || !reflect.DeepEqual(wanted, projected) {
			return resetError(
				ResetCodeObjectDigestMismatch,
				"persisted reset object target differs from the immutable manifest",
			)
		}
		delete(expected, key)

		owner := socialObjects
		if target.OwnerDomain == ResetObjectDomainOSS {
			owner = legacyObjects
		}
		if err := owner.VerifyResetObjectDeleted(ctx, target); err != nil {
			return err
		}
	}
	if len(expected) != 0 {
		return resetError(
			ResetCodeObjectDigestMismatch,
			"immutable reset manifest contains an unpersisted object target",
		)
	}

	return nil
}

func resetObjectTargetIdentity(target ObjectResetTarget) string {
	return strings.Join(
		[]string{
			string(target.OwnerDomain),
			strings.ToLower(target.OwnerIdentityDigest),
			strings.ToLower(target.StorageKeyDigest),
		},
		"\x00",
	)
}

func (s *GORMSecureContentResetStore) validateRecoveryPredecessorChain(
	ctx context.Context,
	manifest SecureContentResetManifestV1,
) ([]SecureContentResetManifestV1, error) {
	var result []SecureContentResetManifestV1
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = validateRecoveryPredecessorChainInTransaction(
			tx,
			manifest,
		)

		return err
	})

	return result, err
}

func validateRecoveryPredecessorChainInTransaction(
	tx *gorm.DB,
	manifest SecureContentResetManifestV1,
) ([]SecureContentResetManifestV1, error) {
	const maximumRecoveryDepth = 32

	result := make([]SecureContentResetManifestV1, 0, 1)
	seen := map[string]struct{}{manifest.ResetID: {}}
	successor := manifest
	for successor.RecoveryPredecessor != nil {
		if len(result) >= maximumRecoveryDepth {
			return nil, resetError(
				ResetCodeManifestConflict,
				"recovery predecessor chain exceeds the bounded depth",
			)
		}
		recovery := successor.RecoveryPredecessor
		if _, exists := seen[recovery.ResetID]; exists {
			return nil, resetError(
				ResetCodeManifestConflict,
				"recovery predecessor chain contains a cycle",
			)
		}
		seen[recovery.ResetID] = struct{}{}

		previous, err := validateRecoveryPredecessorTerminalInTransaction(
			tx,
			successor,
		)
		if err != nil {
			return nil, err
		}
		result = append(result, previous)
		successor = previous
	}

	return result, nil
}

func validateRecoveryPredecessorTerminalInTransaction(
	tx *gorm.DB,
	successor SecureContentResetManifestV1,
) (SecureContentResetManifestV1, error) {
	recovery := successor.RecoveryPredecessor
	if recovery == nil {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeManifestConflict,
			"recovery predecessor is required",
		)
	}
	previous, err := loadManifestInTransaction(tx, recovery.ResetID)
	if err != nil {
		return SecureContentResetManifestV1{}, err
	}
	journalModel, found, err := loadJournalModel(tx, recovery.ResetID)
	if err != nil || !found {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor journal is unavailable: %v",
			err,
		)
	}
	journal, err := loadJournalProjection(tx, journalModel)
	if err != nil {
		return SecureContentResetManifestV1{}, err
	}
	if !equalDigest(previous.ManifestDigest, recovery.ResetManifestDigest) ||
		journal.CurrentState != ResetStateRecoveryReplaced ||
		len(journal.Transitions) == 0 {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor terminal state is invalid",
		)
	}
	last := journal.Transitions[len(journal.Transitions)-1]
	if last.FromState != recovery.State ||
		last.ToState != ResetStateRecoveryReplaced {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor transition is invalid",
		)
	}
	var receipt secureContentResetReplacementModel
	if err := tx.Where(
		"predecessor_reset_id = ?",
		recovery.ResetID,
	).First(&receipt).Error; err != nil {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor replacement receipt is unavailable: %v",
			err,
		)
	}
	initialSuccessor, err := loadManifestInTransaction(
		tx,
		receipt.InitialSuccessorResetID,
	)
	if err != nil {
		return SecureContentResetManifestV1{}, err
	}
	terminalFailureCode := ""
	if journal.Failure != nil {
		terminalFailureCode = string(journal.Failure.Code)
	}
	if receipt.PredecessorResetID != previous.ResetID ||
		!equalDigest(
			receipt.PredecessorManifestDigest,
			previous.ManifestDigest,
		) ||
		!equalDigest(
			receipt.PredecessorJournalDigest,
			recovery.JournalDigest,
		) ||
		receipt.PredecessorState != string(recovery.State) ||
		receipt.ReplacementReason != string(recovery.FailureCode) ||
		receipt.TerminalFailureCode != terminalFailureCode ||
		receipt.DeploymentEnvironment != previous.DeploymentEnvironment ||
		receipt.DestructiveScope != previous.DestructiveScope ||
		!last.TransitionAt.Equal(receipt.ReplacedAt) ||
		!equalDigest(
			receipt.SuccessorManifestDigest,
			initialSuccessor.ManifestDigest,
		) ||
		!reflect.DeepEqual(
			initialSuccessor.RecoveryPredecessor,
			recovery,
		) ||
		initialSuccessor.ResetID == previous.ResetID ||
		initialSuccessor.SourceCommit == previous.SourceCommit ||
		initialSuccessor.WorkspaceID != previous.WorkspaceID ||
		initialSuccessor.ProfileID != previous.ProfileID ||
		initialSuccessor.DeploymentEnvironment !=
			previous.DeploymentEnvironment ||
		initialSuccessor.DestructiveScope != previous.DestructiveScope ||
		initialSuccessor.ResetIntent != previous.ResetIntent ||
		!equalDigest(
			initialSuccessor.DatabaseIdentityDigest,
			previous.DatabaseIdentityDigest,
		) ||
		!reflect.DeepEqual(
			initialSuccessor.PublicSnapshotBefore,
			previous.PublicSnapshotBefore,
		) ||
		(receipt.ProvenanceMode != replacementProvenanceAdmission &&
			receipt.ProvenanceMode != replacementProvenanceMigration) {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor replacement receipt is invalid",
		)
	}
	if !validRecoveryReplacementTuple(
		previous,
		ResetState(receipt.PredecessorState),
		ResetCode(receipt.PredecessorFailureCode),
		ResetCode(receipt.ReplacementReason),
	) {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor replacement tuple is invalid",
		)
	}
	if receipt.ProvenanceMode == replacementProvenanceAdmission &&
		receipt.TerminalFailureCode != receipt.PredecessorFailureCode {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"recovery predecessor failure was not preserved",
		)
	}
	if receipt.ProvenanceMode == replacementProvenanceMigration &&
		receipt.TerminalFailureCode != receipt.ReplacementReason {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeJournalStateConflict,
			"legacy recovery predecessor terminal reason is invalid",
		)
	}
	if previous.ResetID == successor.ResetID ||
		previous.SourceCommit == successor.SourceCommit ||
		previous.WorkspaceID != successor.WorkspaceID ||
		previous.ProfileID != successor.ProfileID ||
		previous.DeploymentEnvironment != successor.DeploymentEnvironment ||
		previous.DestructiveScope != successor.DestructiveScope ||
		previous.ResetIntent != successor.ResetIntent ||
		!equalDigest(
			previous.DatabaseIdentityDigest,
			successor.DatabaseIdentityDigest,
		) ||
		!reflect.DeepEqual(
			previous.PublicSnapshotBefore,
			successor.PublicSnapshotBefore,
		) {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeManifestConflict,
			"recovery predecessor identity no longer matches the successor",
		)
	}

	return previous, nil
}

func validRecoveryReplacementTuple(
	manifest SecureContentResetManifestV1,
	state ResetState,
	originalFailure ResetCode,
	reason ResetCode,
) bool {
	switch state {
	case ResetStateObjectsDeleted:
		return (originalFailure == "" ||
			originalFailure == ResetCodePartialFailure) &&
			reason == ResetCodeSourceSuperseded
	case ResetStateStationDeployed:
		return originalFailure == ResetCodeSchemaTargetUnreviewed &&
			reason == ResetCodeSchemaTargetUnreviewed ||
			originalFailure == ResetCodeJournalStateConflict &&
				reason == ResetCodeSourceSuperseded &&
				manifest.RecoveryPredecessor != nil
	default:
		return false
	}
}

// ValidateCanonicalPrivateSchema verifies only the schema invariant that must
// remain true after product traffic repopulates canonical private state.
func (s *GORMSecureContentResetStore) ValidateCanonicalPrivateSchema(
	ctx context.Context,
	expectedDigest string,
) error {
	database := s.db.WithContext(ctx)
	if err := validateCanonicalPrivatePostSchema(database); err != nil {
		return err
	}
	if database.Migrator().HasTable("social_private_audience_grants") {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"retired private audience grants table remains",
		)
	}
	digest, err := canonicalPrivateSchemaDigest(database)
	if err != nil {
		return err
	}
	if !equalDigest(digest, expectedDigest) {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"live canonical private schema digest has drifted",
		)
	}

	return nil
}

// Complete stores the immutable attestation and closes the journal atomically.
func (s *GORMSecureContentResetStore) Complete(
	ctx context.Context,
	manifest SecureContentResetManifestV1,
	now time.Time,
) (CanonicalPrivateSchemaAttestationV1, ResetJournalV1, error) {
	var attestation CanonicalPrivateSchemaAttestationV1
	var projection ResetJournalV1
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		journal, found, err := loadJournalModel(tx, manifest.ResetID)
		if err != nil {
			return err
		}
		if !found || ResetState(journal.CurrentState) != ResetStatePostAuditPassed {
			return resetError(
				ResetCodeJournalStateConflict,
				"reset completion requires POST_AUDIT_PASSED state",
			)
		}
		if !equalDigest(journal.ManifestDigest, manifest.ManifestDigest) {
			return resetError(
				ResetCodeManifestConflict,
				"post-audit journal does not match the reset manifest",
			)
		}
		deployment, canonicalSchemaDigest, err := loadPostAuditEvidence(
			journal,
			manifest,
		)
		if err != nil {
			return err
		}
		currentProjection, _, err := loadJournalInTransaction(tx, manifest.ResetID)
		if err != nil {
			return err
		}
		completedAt := now.UTC().Truncate(time.Microsecond)
		completedProjection := currentProjection
		completedProjection.CurrentState = ResetStateComplete
		completedProjection.Failure = nil
		completedProjection.Transitions = append(
			append(
				[]ResetJournalTransition(nil),
				currentProjection.Transitions...,
			),
			ResetJournalTransition{
				Ordinal:      int64(len(currentProjection.Transitions) + 1),
				FromState:    ResetStatePostAuditPassed,
				ToState:      ResetStateComplete,
				TransitionAt: completedAt,
			},
		)
		journalDigest, err := canonicalSHA256(completedProjection)
		if err != nil {
			return resetError(
				ResetCodePartialFailure,
				"calculate completed journal digest: %v",
				err,
			)
		}
		attestation = CanonicalPrivateSchemaAttestationV1{
			SchemaVersion:            SecureContentResetSchemaVersion,
			SourceCommit:             manifest.SourceCommit,
			WorkspaceID:              manifest.WorkspaceID,
			ProfileID:                manifest.ProfileID,
			DeploymentEnvironment:    manifest.DeploymentEnvironment,
			DestructiveScope:         manifest.DestructiveScope,
			StationServiceID:         deployment.StationServiceID,
			StationPeerID:            deployment.StationPeerID,
			StationRuntimeIdentity:   deployment.StationRuntimeIdentity,
			ServiceAttestationDigest: deployment.ServiceAttestationDigest,
			ResetIntent:              manifest.ResetIntent,
			ResetManifestDigest:      manifest.ManifestDigest,
			CompletedJournalDigest:   journalDigest,
			CanonicalSchemaDigest:    canonicalSchemaDigest,
			RetiredColumnsAbsent:     true,
			PublicSnapshotDigest:     manifest.PublicSnapshotBefore.SnapshotDigest,
			CreatedAt:                completedAt,
		}
		attestation.AttestationDigest, err = attestation.CalculatedDigest()
		if err != nil {
			return resetError(
				ResetCodePartialFailure,
				"calculate schema attestation digest: %v",
				err,
			)
		}
		attestationBytes, err := json.Marshal(attestation)
		if err != nil {
			return resetError(
				ResetCodePartialFailure,
				"encode schema attestation: %v",
				err,
			)
		}
		row := secureContentSchemaAttestationModel{
			ResetID:           manifest.ResetID,
			ManifestDigest:    manifest.ManifestDigest,
			AttestationDigest: attestation.AttestationDigest,
			AttestationJSON:   attestationBytes,
			CreatedAt:         completedAt,
		}
		if err := tx.Create(&row).Error; err != nil {
			return resetError(
				ResetCodePartialFailure,
				"persist schema attestation: %v",
				err,
			)
		}
		if err := advanceJournalInTransaction(
			tx,
			journal,
			ResetStatePostAuditPassed,
			ResetStateComplete,
			completedAt,
		); err != nil {
			return err
		}
		projection, _, err = loadJournalInTransaction(tx, manifest.ResetID)

		return err
	})
	if err != nil {
		return CanonicalPrivateSchemaAttestationV1{}, ResetJournalV1{}, err
	}

	return attestation, projection, nil
}

// CompletedAttestation reads and verifies the immutable attestation for a
// reset whose journal already reached COMPLETE.
func (s *GORMSecureContentResetStore) CompletedAttestation(
	ctx context.Context,
	resetID string,
) (CanonicalPrivateSchemaAttestationV1, error) {
	var row secureContentSchemaAttestationModel
	if err := s.db.WithContext(ctx).
		Where("reset_id = ?", resetID).
		First(&row).Error; err != nil {
		return CanonicalPrivateSchemaAttestationV1{}, resetError(
			ResetCodeJournalStateConflict,
			"load completed schema attestation: %v",
			err,
		)
	}
	return decodeSchemaAttestationModel(row)
}

// ResolveCompletedAttestation resolves and verifies the immutable reset
// artifacts bound to a supplied completed schema attestation.
func (s *GORMSecureContentResetStore) ResolveCompletedAttestation(
	ctx context.Context,
	supplied CanonicalPrivateSchemaAttestationV1,
) (
	SecureContentResetManifestV1,
	ResetJournalV1,
	CanonicalPrivateSchemaAttestationV1,
	error,
) {
	var manifest SecureContentResetManifestV1
	var journal ResetJournalV1
	var persisted CanonicalPrivateSchemaAttestationV1
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if !isSHA256(supplied.AttestationDigest) {
			return resetError(
				ResetCodeJournalStateConflict,
				"supplied schema attestation digest is invalid",
			)
		}

		var row secureContentSchemaAttestationModel
		if err := tx.Where(
			"attestation_digest = ?",
			supplied.AttestationDigest,
		).First(&row).Error; err != nil {
			return resetError(
				ResetCodeJournalStateConflict,
				"resolve completed schema attestation: %v",
				err,
			)
		}
		var err error
		persisted, err = decodeSchemaAttestationModel(row)
		if err != nil {
			return err
		}
		suppliedCalculated, err := supplied.CalculatedDigest()
		if err != nil || !equalDigest(
			suppliedCalculated,
			supplied.AttestationDigest,
		) {
			return resetError(
				ResetCodeJournalStateConflict,
				"supplied schema attestation digest is invalid",
			)
		}
		suppliedCanonical, err := canonicalJSON(supplied)
		if err != nil {
			return resetError(
				ResetCodeJournalStateConflict,
				"canonicalize supplied schema attestation: %v",
				err,
			)
		}
		persistedCanonical, err := canonicalJSON(persisted)
		if err != nil {
			return resetError(
				ResetCodeJournalStateConflict,
				"canonicalize persisted schema attestation: %v",
				err,
			)
		}
		if string(suppliedCanonical) != string(persistedCanonical) {
			return resetError(
				ResetCodeJournalStateConflict,
				"supplied schema attestation does not match persisted canonical content",
			)
		}

		manifest, err = loadManifestInTransaction(tx, row.ResetID)
		if err != nil {
			return err
		}
		var journalModel secureContentResetJournalModel
		if err := tx.Where(
			"reset_id = ?",
			row.ResetID,
		).First(&journalModel).Error; err != nil {
			return resetError(
				ResetCodeJournalStateConflict,
				"load completed reset journal: %v",
				err,
			)
		}
		if ResetState(journalModel.CurrentState) != ResetStateComplete {
			return resetError(
				ResetCodeJournalStateConflict,
				"schema attestation requires a COMPLETE reset journal",
			)
		}
		journal, err = loadJournalProjection(tx, journalModel)
		if err != nil {
			return err
		}
		deployment, schemaDigest, err := loadPostAuditEvidence(
			journalModel,
			manifest,
		)
		if err != nil {
			return err
		}
		journalDigest, err := journal.CalculatedDigest()
		if err != nil {
			return resetError(
				ResetCodeJournalStateConflict,
				"calculate completed reset journal digest: %v",
				err,
			)
		}
		if !equalDigest(journalDigest, persisted.CompletedJournalDigest) ||
			!equalDigest(row.ManifestDigest, manifest.ManifestDigest) ||
			!equalDigest(journal.ResetManifestDigest, manifest.ManifestDigest) ||
			!equalDigest(persisted.ResetManifestDigest, manifest.ManifestDigest) ||
			persisted.SourceCommit != manifest.SourceCommit ||
			persisted.WorkspaceID != manifest.WorkspaceID ||
			persisted.ProfileID != manifest.ProfileID ||
			persisted.DeploymentEnvironment != manifest.DeploymentEnvironment ||
			persisted.DestructiveScope != manifest.DestructiveScope ||
			persisted.ResetIntent != manifest.ResetIntent ||
			persisted.StationServiceID != deployment.StationServiceID ||
			persisted.StationPeerID != deployment.StationPeerID ||
			persisted.StationRuntimeIdentity != deployment.StationRuntimeIdentity ||
			!equalDigest(
				persisted.ServiceAttestationDigest,
				deployment.ServiceAttestationDigest,
			) ||
			!equalDigest(persisted.CanonicalSchemaDigest, schemaDigest) ||
			!persisted.RetiredColumnsAbsent ||
			!equalDigest(
				persisted.PublicSnapshotDigest,
				manifest.PublicSnapshotBefore.SnapshotDigest,
			) {
			return resetError(
				ResetCodeJournalStateConflict,
				"completed schema attestation artifacts do not share one reset identity",
			)
		}

		return nil
	})
	if err != nil {
		return SecureContentResetManifestV1{},
			ResetJournalV1{},
			CanonicalPrivateSchemaAttestationV1{},
			err
	}

	return manifest, journal, persisted, nil
}

func decodeSchemaAttestationModel(
	row secureContentSchemaAttestationModel,
) (CanonicalPrivateSchemaAttestationV1, error) {
	var attestation CanonicalPrivateSchemaAttestationV1
	if err := json.Unmarshal(row.AttestationJSON, &attestation); err != nil {
		return CanonicalPrivateSchemaAttestationV1{}, resetError(
			ResetCodeJournalStateConflict,
			"decode completed schema attestation: %v",
			err,
		)
	}
	calculated, err := attestation.CalculatedDigest()
	if err != nil ||
		!equalDigest(calculated, row.AttestationDigest) ||
		!equalDigest(calculated, attestation.AttestationDigest) ||
		attestation.ResetManifestDigest != row.ManifestDigest {
		return CanonicalPrivateSchemaAttestationV1{}, resetError(
			ResetCodeJournalStateConflict,
			"completed schema attestation digest is invalid",
		)
	}

	return attestation, nil
}

func loadPostAuditEvidence(
	journal secureContentResetJournalModel,
	manifest SecureContentResetManifestV1,
) (ResetDeploymentProof, string, error) {
	if len(journal.PostAuditDeployment) == 0 ||
		!isSHA256(journal.PostAuditSchemaDigest) {
		return ResetDeploymentProof{}, "", resetError(
			ResetCodeJournalStateConflict,
			"POST_AUDIT_PASSED journal is missing durable completion evidence",
		)
	}
	var deployment ResetDeploymentProof
	if err := json.Unmarshal(journal.PostAuditDeployment, &deployment); err != nil {
		return ResetDeploymentProof{}, "", resetError(
			ResetCodeJournalStateConflict,
			"decode durable post-audit deployment proof: %v",
			err,
		)
	}
	if err := validateStoredDeploymentProof(manifest, deployment); err != nil {
		return ResetDeploymentProof{}, "", err
	}

	return deployment, strings.ToLower(journal.PostAuditSchemaDigest), nil
}

func validateStoredDeploymentProof(
	manifest SecureContentResetManifestV1,
	deployment ResetDeploymentProof,
) error {
	if deployment.SourceCommit != manifest.SourceCommit ||
		strings.TrimSpace(deployment.StationServiceID) == "" ||
		strings.TrimSpace(deployment.StationPeerID) == "" ||
		strings.TrimSpace(deployment.StationRuntimeIdentity) == "" ||
		deployment.CapturedAt.IsZero() ||
		!isSHA256(deployment.ServiceAttestationDigest) {
		return resetError(
			ResetCodePartialFailure,
			"Station deployment proof does not match the reset manifest",
		)
	}

	return nil
}

func loadJournalModel(
	tx *gorm.DB,
	resetID string,
) (secureContentResetJournalModel, bool, error) {
	var row secureContentResetJournalModel
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("reset_id = ?", resetID).
		First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return row, false, nil
	}
	if err != nil {
		return row, false, resetError(
			ResetCodePartialFailure,
			"load reset journal row: %v",
			err,
		)
	}

	return row, true, nil
}

func loadJournalInTransaction(
	tx *gorm.DB,
	resetID string,
) (ResetJournalV1, bool, error) {
	row, found, err := loadJournalModel(tx, resetID)
	if err != nil || !found {
		return ResetJournalV1{}, found, err
	}

	projection, err := loadJournalProjection(tx, row)

	return projection, true, err
}

func loadJournalProjection(
	tx *gorm.DB,
	row secureContentResetJournalModel,
) (ResetJournalV1, error) {
	var invocations []secureContentResetInvocationModel
	if err := tx.Where("reset_id = ?", row.ResetID).
		Order("accepted_at ASC, invocation_id ASC").
		Find(&invocations).Error; err != nil {
		return ResetJournalV1{}, resetError(
			ResetCodePartialFailure,
			"load reset journal invocations: %v",
			err,
		)
	}
	var transitions []secureContentResetTransitionModel
	if err := tx.Where("reset_id = ?", row.ResetID).
		Order("ordinal ASC").
		Find(&transitions).Error; err != nil {
		return ResetJournalV1{}, resetError(
			ResetCodePartialFailure,
			"load reset journal transitions: %v",
			err,
		)
	}
	projection := ResetJournalV1{
		SchemaVersion:       SecureContentResetSchemaVersion,
		ResetID:             row.ResetID,
		ResetManifestDigest: row.ManifestDigest,
		CurrentState:        ResetState(row.CurrentState),
		AcceptedInvocations: make([]ResetInvocationAcceptance, 0, len(invocations)),
		Transitions:         make([]ResetJournalTransition, 0, len(transitions)),
	}
	for _, invocation := range invocations {
		projection.AcceptedInvocations = append(
			projection.AcceptedInvocations,
			ResetInvocationAcceptance{
				InvocationID:     invocation.InvocationID,
				InvocationDigest: invocation.InvocationDigest,
				AcceptedAt:       invocation.AcceptedAt,
			},
		)
	}
	for _, transition := range transitions {
		projection.Transitions = append(
			projection.Transitions,
			ResetJournalTransition{
				Ordinal:      transition.Ordinal,
				FromState:    ResetState(transition.FromState),
				ToState:      ResetState(transition.ToState),
				TransitionAt: transition.TransitionAt,
			},
		)
	}
	if row.FailureCode != "" && row.FailureAt != nil {
		projection.Failure = &ResetJournalFailure{
			Code:       ResetCode(row.FailureCode),
			RecordedAt: row.FailureAt.UTC(),
		}
	}

	return projection, nil
}

func loadManifestInTransaction(
	tx *gorm.DB,
	resetID string,
) (SecureContentResetManifestV1, error) {
	var row secureContentResetManifestModel
	if err := tx.Where("reset_id = ?", resetID).First(&row).Error; err != nil {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeManifestConflict,
			"load reset manifest: %v",
			err,
		)
	}
	return decodeManifestModel(row)
}

func decodeManifestModel(
	row secureContentResetManifestModel,
) (SecureContentResetManifestV1, error) {
	var manifest SecureContentResetManifestV1
	if err := json.Unmarshal(row.ManifestJSON, &manifest); err != nil {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeManifestConflict,
			"decode reset manifest: %v",
			err,
		)
	}
	calculated, err := manifest.CalculatedDigest()
	if err != nil ||
		!equalDigest(calculated, row.ManifestDigest) ||
		!equalDigest(calculated, manifest.ManifestDigest) {
		return SecureContentResetManifestV1{}, resetError(
			ResetCodeManifestConflict,
			"persisted reset manifest digest is invalid",
		)
	}
	if err := validateRecoveryPredecessor(
		manifest.RecoveryPredecessor,
	); err != nil {
		return SecureContentResetManifestV1{}, err
	}

	return manifest, nil
}

func requireResetTables(database *gorm.DB, tables []string) error {
	actual := make(map[string]struct{}, len(tables))
	for _, table := range tables {
		actual[table] = struct{}{}
	}
	required := map[string]struct{}{
		"social_public_posts":      {},
		"social_comments":          {},
		"social_reactions":         {},
		"social_moment_deliveries": {},
		"touch_actor":              {},
		"oss_files":                {},
	}
	for _, target := range CanonicalDatabaseResetTargets() {
		if target.Operation != ResetOperationDropRetiredTable {
			required[target.Table] = struct{}{}
		}
	}
	for table := range required {
		if _, ok := actual[table]; !ok {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"required reset table %s is missing",
				table,
			)
		}
	}

	return nil
}

func validatePrivatePostColumns(database *gorm.DB) error {
	hasRetiredColumns, err := hasRetiredPrivatePostColumns(database)
	if err != nil {
		return err
	}
	if hasRetiredColumns {
		return validateLegacyPrivatePostColumns(database)
	}

	return validateCanonicalModelColumns(
		database,
		&dbmodel.SocialPrivateContentPost{},
		stringSet(RetiredPrivatePostColumns()),
	)
}

func hasRetiredPrivatePostColumns(database *gorm.DB) (bool, error) {
	columns, err := database.Migrator().ColumnTypes(
		&dbmodel.SocialPrivateContentPost{},
	)
	if err != nil {
		return false, resetError(
			ResetCodeSchemaTargetUnreviewed,
			"inspect pre-activation private Post columns: %v",
			err,
		)
	}
	retired := stringSet(RetiredPrivatePostColumns())
	for _, column := range columns {
		if _, ok := retired[strings.ToLower(column.Name())]; ok {
			return true, nil
		}
	}

	return false, nil
}

func validateLegacyPrivatePostColumns(database *gorm.DB) error {
	statement, expected, err := canonicalColumnExpectations(
		database,
		&dbmodel.SocialPrivateContentPost{},
	)
	if err != nil {
		return err
	}
	retired := stringSet(RetiredPrivatePostColumns())
	columns, err := database.Migrator().ColumnTypes(
		&dbmodel.SocialPrivateContentPost{},
	)
	if err != nil {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"inspect pre-activation private Post columns: %v",
			err,
		)
	}
	seen := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		name := strings.ToLower(column.Name())
		wanted, canonical := expected[name]
		if !canonical {
			if _, allowed := retired[name]; allowed {
				continue
			}

			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column %s.%s is not an approved pre-activation column",
				statement.Schema.Table,
				name,
			)
		}
		seen[name] = struct{}{}
		actualType, typeKnown := column.ColumnType()
		if !typeKnown ||
			normalizeDatabaseColumnType(actualType) != wanted.ColumnType {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column type for %s.%s does not match the canonical model",
				statement.Schema.Table,
				name,
			)
		}
		actualDefault, hasActualDefault := column.DefaultValue()
		actualDefault = normalizeColumnDefault(actualDefault)
		if hasActualDefault &&
			(!wanted.HasDefault || actualDefault != wanted.Default) {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column default for %s.%s is not an approved pre-activation default",
				statement.Schema.Table,
				name,
			)
		}
	}
	for name := range expected {
		if _, ok := seen[name]; !ok {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"canonical column %s.%s is missing before activation",
				statement.Schema.Table,
				name,
			)
		}
	}
	primaryKey, err := primaryKeyColumns(database, statement.Schema.Table)
	if err != nil {
		return err
	}
	if !slices.Equal(primaryKey, []string{"id"}) &&
		!slices.Equal(primaryKey, []string{"post_id"}) {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"primary key for %s is not an approved pre-activation shape",
			statement.Schema.Table,
		)
	}

	return nil
}

func validateCanonicalPrivatePostSchema(database *gorm.DB) error {
	if err := validateCanonicalModelColumns(
		database,
		&dbmodel.SocialPrivateContentPost{},
		nil,
	); err != nil {
		return err
	}

	return validateCanonicalModelIndexes(
		database,
		&dbmodel.SocialPrivateContentPost{},
		nil,
		nil,
		true,
	)
}

func validatePrivatePostIndexes(database *gorm.DB, allowRetired bool) error {
	var allowedExtraColumns map[string]struct{}
	var allowedExtraIndexes map[string]canonicalIndexExpectation
	requireAll := true
	if allowRetired {
		allowedExtraColumns = stringSet(RetiredPrivatePostColumns())
		hasRetiredColumns, err := hasRetiredPrivatePostColumns(database)
		if err != nil {
			return err
		}
		requireAll = !hasRetiredColumns
		if hasRetiredColumns {
			allowedExtraIndexes = map[string]canonicalIndexExpectation{
				"idx_spri_created": {
					Columns: []string{"created_at"},
					Unique:  false,
				},
			}
		}
	}

	return validateCanonicalModelIndexes(
		database,
		&dbmodel.SocialPrivateContentPost{},
		allowedExtraColumns,
		allowedExtraIndexes,
		requireAll,
	)
}

type canonicalColumnExpectation struct {
	Name       string
	ColumnType string
	Nullable   bool
	Default    string
	HasDefault bool
	PrimaryKey bool
}

type canonicalIndexExpectation struct {
	Columns []string
	Unique  bool
}

func validateCanonicalPrivateContentSchema(database *gorm.DB) error {
	for _, model := range dbmodel.SocialPrivateContentModels() {
		if err := validateCanonicalModelColumns(database, model, nil); err != nil {
			return err
		}
		if err := validateCanonicalModelIndexes(
			database,
			model,
			nil,
			nil,
			true,
		); err != nil {
			return err
		}
	}

	return nil
}

func validateCanonicalModelColumns(
	database *gorm.DB,
	model any,
	allowedExtraColumns map[string]struct{},
) error {
	statement, expected, err := canonicalColumnExpectations(database, model)
	if err != nil {
		return err
	}
	columns, err := database.Migrator().ColumnTypes(model)
	if err != nil {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"inspect canonical columns for %s: %v",
			statement.Schema.Table,
			err,
		)
	}
	seen := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		name := strings.ToLower(column.Name())
		wanted, ok := expected[name]
		if !ok {
			if _, allowed := allowedExtraColumns[name]; allowed {
				continue
			}

			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column %s.%s is not canonical",
				statement.Schema.Table,
				name,
			)
		}
		seen[name] = struct{}{}
		actualType, typeKnown := column.ColumnType()
		if !typeKnown {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column type for %s.%s is unknown",
				statement.Schema.Table,
				name,
			)
		}
		if normalizeDatabaseColumnType(actualType) != wanted.ColumnType {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column type for %s.%s is %q, want %q",
				statement.Schema.Table,
				name,
				normalizeDatabaseColumnType(actualType),
				wanted.ColumnType,
			)
		}
		nullable, nullableKnown := column.Nullable()
		if !nullableKnown || nullable != wanted.Nullable {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column nullability for %s.%s does not match the canonical model",
				statement.Schema.Table,
				name,
			)
		}
		actualDefault, hasActualDefault := column.DefaultValue()
		actualDefault = normalizeColumnDefault(actualDefault)
		if hasActualDefault != wanted.HasDefault ||
			(hasActualDefault && actualDefault != wanted.Default) {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column default for %s.%s does not match the canonical model",
				statement.Schema.Table,
				name,
			)
		}
		primaryKey, primaryKeyKnown := column.PrimaryKey()
		if !primaryKeyKnown || primaryKey != wanted.PrimaryKey {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"column primary-key membership for %s.%s does not match the canonical model",
				statement.Schema.Table,
				name,
			)
		}
	}
	for name := range expected {
		if _, ok := seen[name]; !ok {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"canonical column %s.%s is missing",
				statement.Schema.Table,
				name,
			)
		}
	}
	actualPrimaryKey, err := primaryKeyColumns(database, statement.Schema.Table)
	if err != nil {
		return err
	}
	expectedPrimaryKey := make([]string, 0)
	for _, field := range statement.Schema.Fields {
		if field.DBName != "" && field.PrimaryKey {
			expectedPrimaryKey = append(expectedPrimaryKey, field.DBName)
		}
	}
	if !slices.Equal(actualPrimaryKey, expectedPrimaryKey) {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"primary key for %s does not match the canonical model",
			statement.Schema.Table,
		)
	}

	return nil
}

func canonicalColumnExpectations(
	database *gorm.DB,
	model any,
) (*gorm.Statement, map[string]canonicalColumnExpectation, error) {
	statement := &gorm.Statement{DB: database}
	if err := statement.Parse(model); err != nil {
		return nil, nil, resetError(
			ResetCodeSchemaTargetUnreviewed,
			"parse canonical model: %v",
			err,
		)
	}
	expected := make(map[string]canonicalColumnExpectation)
	for _, field := range statement.Schema.Fields {
		if field.DBName == "" || field.IgnoreMigration {
			continue
		}
		fullType := database.Migrator().FullDataTypeOf(field).SQL
		defaultValue, hasDefault := canonicalFieldDefault(field)
		nullable := !field.NotNull
		if field.PrimaryKey && database.Dialector.Name() == "postgres" {
			nullable = false
		}
		expected[field.DBName] = canonicalColumnExpectation{
			Name:       field.DBName,
			ColumnType: normalizeDatabaseColumnType(stripColumnConstraints(fullType)),
			Nullable:   nullable,
			Default:    defaultValue,
			HasDefault: hasDefault,
			PrimaryKey: field.PrimaryKey,
		}
	}

	return statement, expected, nil
}

func canonicalFieldDefault(field *gormschema.Field) (string, bool) {
	hasDefault := field.HasDefaultValue &&
		(field.DefaultValueInterface != nil ||
			!strings.EqualFold(field.DefaultValue, "NULL"))
	if !hasDefault {
		return "", false
	}

	return normalizeColumnDefault(field.DefaultValue), true
}

var columnConstraintPattern = regexp.MustCompile(
	`(?i)\s+(NOT\s+NULL|NULL|DEFAULT|PRIMARY\s+KEY|UNIQUE|CHECK|COLLATE)\b.*$`,
)

func stripColumnConstraints(value string) string {
	return columnConstraintPattern.ReplaceAllString(strings.TrimSpace(value), "")
}

func normalizeDatabaseColumnType(value string) string {
	normalized := strings.ToLower(strings.Join(strings.Fields(value), " "))
	normalized = strings.ReplaceAll(normalized, "character varying", "varchar")
	normalized = strings.ReplaceAll(normalized, "timestamp with time zone", "timestamptz")
	normalized = strings.ReplaceAll(normalized, "timestamp without time zone", "timestamp")
	normalized = strings.ReplaceAll(normalized, "double precision", "float8")
	normalized = strings.ReplaceAll(normalized, " (", "(")
	normalized = strings.ReplaceAll(normalized, "( ", "(")
	normalized = strings.ReplaceAll(normalized, " )", ")")
	normalized = strings.ReplaceAll(normalized, ", ", ",")

	return normalized
}

func normalizeColumnDefault(value string) string {
	normalized := strings.TrimSpace(value)
	for strings.HasPrefix(normalized, "(") &&
		strings.HasSuffix(normalized, ")") {
		normalized = strings.TrimSpace(normalized[1 : len(normalized)-1])
	}
	if cast := strings.Index(normalized, "::"); cast >= 0 {
		normalized = normalized[:cast]
	}

	return strings.Trim(strings.TrimSpace(normalized), `'"`)
}

func validateCanonicalModelIndexes(
	database *gorm.DB,
	model any,
	allowedExtraColumns map[string]struct{},
	allowedExtraIndexes map[string]canonicalIndexExpectation,
	requireAll bool,
) error {
	statement := &gorm.Statement{DB: database}
	if err := statement.Parse(model); err != nil {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"parse canonical model indexes: %v",
			err,
		)
	}
	expected := make(map[string]canonicalIndexExpectation)
	for _, index := range statement.Schema.ParseIndexes() {
		columns := make([]string, 0, len(index.Fields))
		for _, field := range index.Fields {
			if field.Expression != "" || field.Field == nil ||
				field.Field.DBName == "" {
				return resetError(
					ResetCodeSchemaTargetUnreviewed,
					"canonical index %s uses an unsupported expression",
					index.Name,
				)
			}
			columns = append(columns, field.Field.DBName)
		}
		expected[index.Name] = canonicalIndexExpectation{
			Columns: columns,
			Unique:  strings.EqualFold(index.Class, "UNIQUE"),
		}
	}

	indexes, err := database.Migrator().GetIndexes(model)
	if err != nil {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"inspect canonical indexes for %s: %v",
			statement.Schema.Table,
			err,
		)
	}
	seen := make(map[string]struct{}, len(indexes))
	for _, index := range indexes {
		primary, primaryKnown := index.PrimaryKey()
		if !primaryKnown {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"primary-key status for index %s.%s is unknown",
				statement.Schema.Table,
				index.Name(),
			)
		}
		if primary {
			continue
		}
		columns := lowerStrings(index.Columns())
		unique, uniqueKnown := index.Unique()
		if !uniqueKnown {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"unique status for index %s.%s is unknown",
				statement.Schema.Table,
				index.Name(),
			)
		}
		wanted, ok := expected[index.Name()]
		if !ok {
			if allowed, found := allowedExtraIndexes[index.Name()]; found &&
				unique == allowed.Unique &&
				slices.Equal(columns, allowed.Columns) {
				continue
			}
			if allowedExtraColumns != nil &&
				indexTouchesRetiredColumn(columns, allowedExtraColumns) {
				continue
			}

			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"index %s.%s is not canonical",
				statement.Schema.Table,
				index.Name(),
			)
		}
		if unique != wanted.Unique ||
			!slices.Equal(columns, wanted.Columns) {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"index %s.%s shape or uniqueness does not match the canonical model",
				statement.Schema.Table,
				index.Name(),
			)
		}
		seen[index.Name()] = struct{}{}
	}
	if requireAll {
		for name := range expected {
			if _, ok := seen[name]; !ok {
				return resetError(
					ResetCodeSchemaTargetUnreviewed,
					"canonical index %s.%s is missing",
					statement.Schema.Table,
					name,
				)
			}
		}
	}

	return nil
}

func primaryKeyColumns(
	database *gorm.DB,
	table string,
) ([]string, error) {
	switch database.Dialector.Name() {
	case "sqlite":
		type sqliteColumn struct {
			Name              string `gorm:"column:name"`
			PrimaryKeyOrdinal int    `gorm:"column:pk"`
		}
		var columns []sqliteColumn
		if err := database.Raw(
			"PRAGMA table_info(" + quoteIdentifier(table) + ")",
		).Scan(&columns).Error; err != nil {
			return nil, resetError(
				ResetCodeSchemaTargetUnreviewed,
				"inspect primary key for %s: %v",
				table,
				err,
			)
		}
		slices.SortFunc(columns, func(left, right sqliteColumn) int {
			return left.PrimaryKeyOrdinal - right.PrimaryKeyOrdinal
		})
		result := make([]string, 0)
		for _, column := range columns {
			if column.PrimaryKeyOrdinal > 0 {
				result = append(result, strings.ToLower(column.Name))
			}
		}

		return result, nil
	case "postgres":
		var columns []string
		err := database.Raw(`
SELECT key_column.column_name
FROM information_schema.table_constraints AS table_constraint
JOIN information_schema.key_column_usage AS key_column
  ON key_column.constraint_catalog = table_constraint.constraint_catalog
 AND key_column.constraint_schema = table_constraint.constraint_schema
 AND key_column.constraint_name = table_constraint.constraint_name
WHERE table_constraint.constraint_type = 'PRIMARY KEY'
  AND table_constraint.table_schema = current_schema()
  AND table_constraint.table_name = ?
ORDER BY key_column.ordinal_position`, table).Scan(&columns).Error
		if err != nil {
			return nil, resetError(
				ResetCodeSchemaTargetUnreviewed,
				"inspect primary key for %s: %v",
				table,
				err,
			)
		}

		return lowerStrings(columns), nil
	default:
		return nil, resetError(
			ResetCodeSchemaTargetUnreviewed,
			"primary-key inspection is unsupported for %s",
			database.Dialector.Name(),
		)
	}
}

func stringSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[strings.ToLower(value)] = struct{}{}
	}

	return result
}

func lowerStrings(values []string) []string {
	result := make([]string, len(values))
	for index, value := range values {
		result[index] = strings.ToLower(value)
	}

	return result
}

func indexTouchesRetiredColumn(
	columns []string,
	retired map[string]struct{},
) bool {
	for _, column := range columns {
		if _, ok := retired[column]; ok {
			return true
		}
	}

	return false
}

func rejectUnexpectedForeignKeys(database *gorm.DB, tables []string) error {
	switch database.Dialector.Name() {
	case "sqlite":
		return rejectSQLiteForeignKeys(database, tables)
	case "postgres":
		return rejectPostgresForeignKeys(database)
	default:
		return resetError(
			ResetCodeForeignKeyUnreviewed,
			"foreign-key inspection is unsupported for %s",
			database.Dialector.Name(),
		)
	}
}

func rejectSQLiteForeignKeys(database *gorm.DB, tables []string) error {
	mutable := resetMutableTableSet()
	for _, child := range tables {
		if !safeIdentifier(child) {
			return resetError(
				ResetCodeForeignKeyUnreviewed,
				"table name is not safe for foreign-key inspection",
			)
		}
		rows, err := database.Raw(
			"PRAGMA foreign_key_list(" + quoteIdentifier(child) + ")",
		).Rows()
		if err != nil {
			return resetError(
				ResetCodeForeignKeyUnreviewed,
				"inspect foreign keys for %s: %v",
				child,
				err,
			)
		}
		for rows.Next() {
			var (
				id       int
				sequence int
				parent   string
				from     string
				to       string
				onUpdate string
				onDelete string
				match    string
			)
			if err := rows.Scan(
				&id,
				&sequence,
				&parent,
				&from,
				&to,
				&onUpdate,
				&onDelete,
				&match,
			); err != nil {
				_ = rows.Close()

				return resetError(
					ResetCodeForeignKeyUnreviewed,
					"scan foreign key for %s: %v",
					child,
					err,
				)
			}
			if _, childMutable := mutable[child]; childMutable {
				_ = rows.Close()

				return resetError(
					ResetCodeForeignKeyUnreviewed,
					"foreign key from reset table %s to %s is not reviewed",
					child,
					parent,
				)
			}
			if _, parentMutable := mutable[parent]; parentMutable {
				_ = rows.Close()

				return resetError(
					ResetCodeForeignKeyUnreviewed,
					"foreign key from %s to reset table %s is not reviewed",
					child,
					parent,
				)
			}
		}
		if err := rows.Close(); err != nil {
			return resetError(
				ResetCodeForeignKeyUnreviewed,
				"close foreign-key rows for %s: %v",
				child,
				err,
			)
		}
	}

	return nil
}

func rejectPostgresForeignKeys(database *gorm.DB) error {
	type foreignKey struct {
		Child  string `gorm:"column:child_table"`
		Parent string `gorm:"column:parent_table"`
		Name   string `gorm:"column:constraint_name"`
	}
	var rows []foreignKey
	err := database.Raw(`
SELECT child.relname AS child_table,
       parent.relname AS parent_table,
       constraint_row.conname AS constraint_name
FROM pg_constraint AS constraint_row
JOIN pg_class AS child ON child.oid = constraint_row.conrelid
JOIN pg_class AS parent ON parent.oid = constraint_row.confrelid
JOIN pg_namespace AS child_namespace ON child_namespace.oid = child.relnamespace
WHERE constraint_row.contype = 'f'
  AND child_namespace.nspname = current_schema()
ORDER BY child.relname, parent.relname, constraint_row.conname`).Scan(&rows).Error
	if err != nil {
		return resetError(
			ResetCodeForeignKeyUnreviewed,
			"inspect PostgreSQL foreign keys: %v",
			err,
		)
	}
	mutable := resetMutableTableSet()
	for _, row := range rows {
		_, childMutable := mutable[row.Child]
		_, parentMutable := mutable[row.Parent]
		if childMutable || parentMutable {
			return resetError(
				ResetCodeForeignKeyUnreviewed,
				"foreign key %s between %s and %s is not reviewed",
				row.Name,
				row.Child,
				row.Parent,
			)
		}
	}

	return nil
}

func resetMutableTableSet() map[string]struct{} {
	result := make(map[string]struct{})
	for _, target := range CanonicalDatabaseResetTargets() {
		result[target.Table] = struct{}{}
	}

	return result
}

func buildDatabaseTargets(database *gorm.DB) ([]DatabaseResetTarget, error) {
	targets := CanonicalDatabaseResetTargets()
	for index := range targets {
		target := &targets[index]
		if target.Operation == ResetOperationDropRetiredTable &&
			!database.Migrator().HasTable(target.Table) {
			target.ExpectedSchemaBeforeDigest = sha256Hex(nil)
			target.ExpectedRowCount = 0
			continue
		}
		schemaDigest, err := tableSchemaDigest(database, target.Table)
		if err != nil {
			return nil, err
		}
		count, err := countRows(
			database,
			target.Table,
			target.Predicate,
		)
		if err != nil {
			return nil, err
		}
		target.ExpectedSchemaBeforeDigest = schemaDigest
		target.ExpectedRowCount = count
	}
	if err := ValidateDatabaseTargetOrder(targets); err != nil {
		return nil, err
	}

	return targets, nil
}

type rawObjectReference struct {
	OwnerDomain        ResetObjectDomain
	OwnerPTID          string
	Backend            string
	StorageKey         string
	ExpectedBlobDigest string
	ExpectedAbsent     bool
	SourceRows         []string
}

func loadCanonicalObjectReferences(
	database *gorm.DB,
) ([]rawObjectReference, error) {
	references := make(map[string]*rawObjectReference)
	type partRow struct {
		StorageKey         string     `gorm:"column:storage_key"`
		UploadID           string     `gorm:"column:upload_id"`
		Generation         uint64     `gorm:"column:generation"`
		ChunkIndex         uint32     `gorm:"column:chunk_index"`
		UploaderPTID       string     `gorm:"column:uploader_ptid"`
		CiphertextSHA256   []byte     `gorm:"column:ciphertext_sha256"`
		UploadState        string     `gorm:"column:upload_state"`
		UploadTombstonedAt *time.Time `gorm:"column:upload_tombstoned_at"`
	}
	var parts []partRow
	err := database.Table("social_private_object_parts AS part").
		Select(
			"part.storage_key, part.upload_id, part.generation, part.chunk_index, " +
				"upload.uploader_ptid, part.ciphertext_sha256, " +
				"upload.state AS upload_state, " +
				"upload.tombstoned_at AS upload_tombstoned_at",
		).
		Joins(
			"JOIN social_private_object_uploads AS upload " +
				"ON upload.upload_id = part.upload_id AND upload.generation = part.generation",
		).
		Scan(&parts).Error
	if err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"inventory Social private object parts: %v",
			err,
		)
	}
	for _, row := range parts {
		source, _ := canonicalSHA256(struct {
			Table      string `json:"table"`
			UploadID   string `json:"uploadId"`
			Generation uint64 `json:"generation"`
			ChunkIndex uint32 `json:"chunkIndex"`
		}{
			Table:      "social_private_object_parts",
			UploadID:   row.UploadID,
			Generation: row.Generation,
			ChunkIndex: row.ChunkIndex,
		})
		if err := addRawObjectReference(
			references,
			rawObjectReference{
				OwnerDomain:        ResetObjectDomainSocial,
				Backend:            "social-private",
				StorageKey:         row.StorageKey,
				ExpectedBlobDigest: hexBytes(row.CiphertextSHA256),
				ExpectedAbsent: row.UploadState ==
					dbmodel.SocialPrivateObjectGarbageCollected &&
					row.UploadTombstonedAt != nil,
				SourceRows: []string{source},
			},
		); err != nil {
			return nil, err
		}
	}

	type uploadRow struct {
		StorageKey   string     `gorm:"column:final_storage_key"`
		UploadID     string     `gorm:"column:upload_id"`
		Generation   uint64     `gorm:"column:generation"`
		UploaderPTID string     `gorm:"column:uploader_ptid"`
		State        string     `gorm:"column:state"`
		TombstonedAt *time.Time `gorm:"column:tombstoned_at"`
	}
	var uploads []uploadRow
	if err := database.Table("social_private_object_uploads").
		Select(
			"final_storage_key, upload_id, generation, uploader_ptid, " +
				"state, tombstoned_at",
		).
		Where("final_storage_key <> ''").
		Scan(&uploads).Error; err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"inventory Social private object uploads: %v",
			err,
		)
	}
	for _, row := range uploads {
		source, _ := canonicalSHA256(struct {
			Table      string `json:"table"`
			UploadID   string `json:"uploadId"`
			Generation uint64 `json:"generation"`
		}{
			Table:      "social_private_object_uploads",
			UploadID:   row.UploadID,
			Generation: row.Generation,
		})
		if err := addRawObjectReference(
			references,
			rawObjectReference{
				OwnerDomain: ResetObjectDomainSocial,
				Backend:     "social-private",
				StorageKey:  row.StorageKey,
				ExpectedAbsent: row.State ==
					dbmodel.SocialPrivateObjectGarbageCollected &&
					row.TombstonedAt != nil,
				SourceRows: []string{source},
			},
		); err != nil {
			return nil, err
		}
	}

	type objectRow struct {
		StorageKey       string     `gorm:"column:storage_key"`
		ObjectID         string     `gorm:"column:object_id"`
		UploaderPTID     string     `gorm:"column:uploader_ptid"`
		CiphertextSHA256 []byte     `gorm:"column:ciphertext_sha256"`
		State            string     `gorm:"column:state"`
		TombstonedAt     *time.Time `gorm:"column:tombstoned_at"`
	}
	var objects []objectRow
	if err := database.Table("social_private_objects").
		Select(
			"storage_key, object_id, uploader_ptid, ciphertext_sha256, " +
				"state, tombstoned_at",
		).
		Scan(&objects).Error; err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"inventory Social private objects: %v",
			err,
		)
	}
	for _, row := range objects {
		source, _ := canonicalSHA256(struct {
			Table    string `json:"table"`
			ObjectID string `json:"objectId"`
		}{
			Table:    "social_private_objects",
			ObjectID: row.ObjectID,
		})
		if err := addRawObjectReference(
			references,
			rawObjectReference{
				OwnerDomain:        ResetObjectDomainSocial,
				Backend:            "social-private",
				StorageKey:         row.StorageKey,
				ExpectedBlobDigest: hexBytes(row.CiphertextSHA256),
				ExpectedAbsent: row.State ==
					dbmodel.SocialPrivateObjectGarbageCollected &&
					row.TombstonedAt != nil,
				SourceRows: []string{source},
			},
		); err != nil {
			return nil, err
		}
	}

	return flattenRawObjectReferences(references)
}

func addRawObjectReference(
	references map[string]*rawObjectReference,
	candidate rawObjectReference,
) error {
	if candidate.StorageKey == "" {
		return nil
	}
	identity := rawObjectReferenceIdentity(candidate)
	existing, ok := references[identity]
	if !ok {
		copy := candidate
		references[identity] = &copy

		return nil
	}
	if existing.ExpectedBlobDigest != "" &&
		candidate.ExpectedBlobDigest != "" &&
		!equalDigest(existing.ExpectedBlobDigest, candidate.ExpectedBlobDigest) {
		return resetError(
			ResetCodeObjectDigestMismatch,
			"object owner and key have conflicting source digests",
		)
	}
	existing.SourceRows = append(existing.SourceRows, candidate.SourceRows...)
	existing.ExpectedAbsent = existing.ExpectedAbsent &&
		candidate.ExpectedAbsent
	if existing.ExpectedBlobDigest == "" {
		existing.ExpectedBlobDigest = candidate.ExpectedBlobDigest
	}

	return nil
}

func rawObjectReferenceIdentity(reference rawObjectReference) string {
	return string(reference.OwnerDomain) + "\x00" +
		reference.OwnerPTID + "\x00" +
		reference.StorageKey
}

func flattenRawObjectReferences(
	references map[string]*rawObjectReference,
) ([]rawObjectReference, error) {
	keys := make([]string, 0, len(references))
	for key := range references {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	result := make([]rawObjectReference, 0, len(keys))
	for _, key := range keys {
		reference := *references[key]
		reference.SourceRows = canonicalStrings(reference.SourceRows)
		if reference.ExpectedBlobDigest != "" &&
			!isSHA256(reference.ExpectedBlobDigest) {
			return nil, resetError(
				ResetCodeObjectDigestMismatch,
				"object source digest is invalid",
			)
		}
		result = append(result, reference)
	}

	return result, nil
}

func loadPostObjectReferences(
	database *gorm.DB,
	table string,
	legacyPrivate bool,
) ([]rawObjectReference, error) {
	if !safeIdentifier(table) {
		return nil, resetError(ResetCodeInvalidInput, "post table is invalid")
	}
	columns, err := tableColumnSet(database, table)
	if err != nil {
		return nil, err
	}
	required := []string{"id", "author_id", "type", "attachments_json"}
	for _, column := range required {
		if _, ok := columns[column]; !ok {
			if legacyPrivate {
				return []rawObjectReference{}, nil
			}
			return nil, resetError(
				ResetCodeSchemaTargetUnreviewed,
				"public Post column %s is missing",
				column,
			)
		}
	}

	query := "SELECT id, author_id, type, attachments_json FROM " +
		quoteIdentifier(table) +
		" WHERE attachments_json IS NOT NULL AND attachments_json <> ''"
	type postObjectReferenceRow struct {
		rowID       any
		authorID    any
		postType    any
		attachments any
	}
	unresolved, err := func() ([]postObjectReferenceRow, error) {
		rows, err := database.Raw(query).Rows()
		if err != nil {
			return nil, resetError(
				ResetCodePartialFailure,
				"inventory %s attachments: %v",
				table,
				err,
			)
		}
		defer func() {
			_ = rows.Close()
		}()

		result := make([]postObjectReferenceRow, 0)
		for rows.Next() {
			var row postObjectReferenceRow
			if err := rows.Scan(
				&row.rowID,
				&row.authorID,
				&row.postType,
				&row.attachments,
			); err != nil {
				return nil, resetError(
					ResetCodePartialFailure,
					"scan %s attachment row: %v",
					table,
					err,
				)
			}
			result = append(result, row)
		}
		if err := rows.Err(); err != nil {
			return nil, resetError(
				ResetCodePartialFailure,
				"iterate %s attachment rows: %v",
				table,
				err,
			)
		}

		return result, nil
	}()
	if err != nil {
		return nil, err
	}

	references := make(map[string]*rawObjectReference)
	for _, row := range unresolved {
		raw := valueString(row.attachments)
		keys, err := extractLegacyAttachmentKeys(
			valueString(row.postType),
			raw,
		)
		if err != nil {
			return nil, resetError(
				ResetCodeObjectReferenceAmbiguous,
				"%s attachment shape is not reviewed: %v",
				table,
				err,
			)
		}
		if len(keys) == 0 {
			continue
		}
		ownerPTID, err := resolveActorPTID(
			database,
			valueString(row.authorID),
		)
		if err != nil {
			return nil, err
		}
		for _, key := range keys {
			source, _ := canonicalSHA256(struct {
				Table string `json:"table"`
				RowID string `json:"rowId"`
				Key   string `json:"key"`
			}{
				Table: table,
				RowID: valueString(row.rowID),
				Key:   key,
			})
			if err := addRawObjectReference(
				references,
				rawObjectReference{
					OwnerDomain: ResetObjectDomainOSS,
					OwnerPTID:   ownerPTID,
					Backend:     "oss",
					StorageKey:  key,
					SourceRows:  []string{source},
				},
			); err != nil {
				return nil, err
			}
		}
	}

	return flattenRawObjectReferences(references)
}

func extractLegacyAttachmentKeys(postType string, raw string) ([]string, error) {
	if strings.TrimSpace(raw) == "" {
		return []string{}, nil
	}
	switch strings.ToUpper(strings.TrimSpace(postType)) {
	case "IMAGE":
		var identifiers []string
		if err := decodeStrictJSON([]byte(raw), &identifiers); err == nil {
			return normalizeObjectKeys(identifiers)
		}
		var attachments []struct {
			ID              string          `json:"id"`
			URL             string          `json:"url"`
			ThumbnailURL    string          `json:"thumbnail_url"`
			SizeBytes       int64           `json:"size_bytes"`
			Width           int32           `json:"width"`
			Height          int32           `json:"height"`
			Blurhash        string          `json:"blurhash"`
			AltText         string          `json:"alt_text"`
			MediaEncryption json.RawMessage `json:"media_encryption"`
		}
		if err := decodeStrictJSON([]byte(raw), &attachments); err != nil {
			return nil, err
		}
		for _, attachment := range attachments {
			identifier := attachment.ID
			if identifier == "" {
				identifier = attachment.URL
			}
			if attachment.ID != "" &&
				attachment.URL != "" &&
				attachment.ID != attachment.URL {
				return nil, errors.New("image ID and URL identify different objects")
			}
			identifiers = append(identifiers, identifier)
		}

		return normalizeObjectKeys(identifiers)
	case "VIDEO":
		var payload struct {
			VideoID string `json:"video_id"`
		}
		if err := decodeStrictJSON([]byte(raw), &payload); err != nil {
			return nil, err
		}

		return normalizeObjectKeys([]string{payload.VideoID})
	case "LOCATION":
		var payload struct {
			Location json.RawMessage `json:"location"`
			ImageIDs []string        `json:"image_ids"`
		}
		if err := decodeStrictJSON([]byte(raw), &payload); err != nil {
			return nil, err
		}

		return normalizeObjectKeys(payload.ImageIDs)
	case "POLL":
		var payload struct {
			Text           string   `json:"text"`
			Question       string   `json:"question"`
			Options        []string `json:"options"`
			DurationHours  int32    `json:"duration_hours"`
			MultipleChoice bool     `json:"multiple_choice"`
		}
		if err := decodeStrictJSON([]byte(raw), &payload); err != nil {
			return nil, err
		}

		return []string{}, nil
	default:
		return nil, fmt.Errorf("post type %q cannot carry attachment JSON", postType)
	}
}

func normalizeObjectKeys(values []string) ([]string, error) {
	keys := make([]string, 0, len(values))
	for _, value := range values {
		key, err := extractOssKey(value)
		if err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}

	return canonicalStrings(keys), nil
}

func decodeStrictJSON(raw []byte, destination any) error {
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("multiple JSON values")
		}

		return err
	}

	return nil
}

func resolveActorPTID(database *gorm.DB, actorID string) (string, error) {
	if strings.TrimSpace(actorID) == "" {
		return "", resetError(
			ResetCodeObjectReferenceAmbiguous,
			"legacy attachment owner is missing",
		)
	}
	var ownerPTID string
	err := database.Table("touch_actor").
		Select("ptid").
		Where("id = ?", actorID).
		Scan(&ownerPTID).Error
	if err != nil || strings.TrimSpace(ownerPTID) == "" {
		return "", resetError(
			ResetCodeObjectReferenceAmbiguous,
			"resolve legacy attachment owner: %v",
			err,
		)
	}

	return ownerPTID, nil
}

func rejectCrossDomainReferences(
	database *gorm.DB,
	legacy []rawObjectReference,
	publicKeys map[string]struct{},
) error {
	for _, reference := range legacy {
		if _, public := publicKeys[reference.StorageKey]; public {
			return resetError(
				ResetCodeObjectReferenceAmbiguous,
				"legacy private object is referenced by public Social",
			)
		}
		referenced, err := conversationReferencesKey(database, reference.StorageKey)
		if err != nil {
			return err
		}
		if referenced {
			return resetError(
				ResetCodeObjectReferenceAmbiguous,
				"legacy private object is referenced by Conversation",
			)
		}
	}

	return nil
}

func conversationReferencesKey(database *gorm.DB, key string) (bool, error) {
	checks := []struct {
		table  string
		column string
	}{
		{table: "conversation_attachment_uploads", column: "verification_storage_key"},
		{table: "conversation_attachment_upload_parts", column: "storage_key"},
		{table: "conversation_attachment_objects", column: "storage_key"},
	}
	for _, check := range checks {
		if !database.Migrator().HasTable(check.table) {
			continue
		}
		var count int64
		err := database.Table(check.table).
			Where(quoteIdentifier(check.column)+" = ?", key).
			Count(&count).Error
		if err != nil {
			return false, resetError(
				ResetCodePartialFailure,
				"inspect Conversation object references: %v",
				err,
			)
		}
		if count != 0 {
			return true, nil
		}
	}
	if database.Migrator().HasTable("touch_attachment") {
		var cids []string
		if err := database.Table("touch_attachment").Pluck("cid", &cids).Error; err != nil {
			return false, resetError(
				ResetCodePartialFailure,
				"inspect legacy Conversation attachment references: %v",
				err,
			)
		}
		for _, cid := range cids {
			resolved, err := extractOssKey(cid)
			if err == nil && resolved == key {
				return true, nil
			}
		}
	}

	return false, nil
}

func inspectObjectReferences(
	ctx context.Context,
	resetID string,
	references []rawObjectReference,
	owner ResetObjectOwner,
) ([]ObjectResetTarget, []ResolvedResetObjectTarget, error) {
	targets := make([]ObjectResetTarget, 0, len(references))
	resolved := make([]ResolvedResetObjectTarget, 0, len(references))
	for _, reference := range references {
		sourceDigest, err := canonicalSHA256(reference.SourceRows)
		if err != nil {
			return nil, nil, resetError(
				ResetCodePartialFailure,
				"calculate reset source-row digest: %v",
				err,
			)
		}
		metadataDigest, err := canonicalSHA256(struct {
			OwnerDomain ResetObjectDomain `json:"ownerDomain"`
			OwnerPTID   string            `json:"ownerPtid,omitempty"`
			Backend     string            `json:"backend"`
			StorageKey  string            `json:"storageKey"`
			SourceRows  []string          `json:"sourceRows"`
		}{
			OwnerDomain: reference.OwnerDomain,
			OwnerPTID:   reference.OwnerPTID,
			Backend:     reference.Backend,
			StorageKey:  reference.StorageKey,
			SourceRows:  reference.SourceRows,
		})
		if err != nil {
			return nil, nil, resetError(
				ResetCodePartialFailure,
				"calculate reset object metadata digest: %v",
				err,
			)
		}
		candidate := ResolvedResetObjectTarget{
			ResetID:                resetID,
			OwnerDomain:            reference.OwnerDomain,
			OwnerPTID:              reference.OwnerPTID,
			Backend:                reference.Backend,
			StorageKey:             reference.StorageKey,
			ExpectedMetadataDigest: metadataDigest,
			ExpectedBlobDigest:     reference.ExpectedBlobDigest,
			SourceRowDigest:        sourceDigest,
		}
		var inspection ResetObjectInspection
		if reference.ExpectedAbsent {
			// GC tombstones retain immutable storage identity after byte deletion.
			if reference.OwnerDomain != ResetObjectDomainSocial ||
				!isSHA256(reference.ExpectedBlobDigest) {
				return nil, nil, resetError(
					ResetCodeObjectDigestMismatch,
					"garbage-collected Social object is missing its source digest",
				)
			}
			if err := owner.VerifyResetObjectDeleted(ctx, candidate); err != nil {
				return nil, nil, err
			}
			inspection = ResetObjectInspection{
				Backend:                 reference.Backend,
				MetadataDigest:          metadataDigest,
				BlobDigest:              reference.ExpectedBlobDigest,
				ReferenceClassification: ResetReferenceCanonicalPrivate,
			}
		} else {
			inspection, err = owner.InspectResetObject(ctx, candidate)
			if err != nil {
				return nil, nil, err
			}
		}
		if inspection.Backend == "" ||
			!isSHA256(inspection.MetadataDigest) ||
			!isSHA256(inspection.BlobDigest) {
			return nil, nil, resetError(
				ResetCodeObjectDigestMismatch,
				"object owner returned incomplete digest evidence",
			)
		}
		if reference.ExpectedBlobDigest != "" &&
			!equalDigest(reference.ExpectedBlobDigest, inspection.BlobDigest) {
			return nil, nil, resetError(
				ResetCodeObjectDigestMismatch,
				"object bytes do not match the source-row digest",
			)
		}
		candidate.Backend = inspection.Backend
		candidate.ExpectedMetadataDigest = inspection.MetadataDigest
		candidate.ExpectedBlobDigest = inspection.BlobDigest
		candidate.ReferenceClassification = inspection.ReferenceClassification
		resolved = append(resolved, candidate)
		targets = append(targets, ObjectResetTarget{
			OwnerDomain:             candidate.OwnerDomain,
			OwnerIdentityDigest:     sha256Hex([]byte(candidate.OwnerPTID)),
			Backend:                 candidate.Backend,
			StorageKeyDigest:        sha256Hex([]byte(candidate.StorageKey)),
			MetadataDigest:          candidate.ExpectedMetadataDigest,
			BlobDigest:              candidate.ExpectedBlobDigest,
			SourceRowDigest:         candidate.SourceRowDigest,
			ReferenceClassification: candidate.ReferenceClassification,
		})
	}

	return targets, resolved, nil
}

func capturePublicSnapshot(
	ctx context.Context,
	database *gorm.DB,
	profileID string,
	publicReferences []rawObjectReference,
	legacyObjects ResetObjectOwner,
) (PublicSocialSnapshotV1, error) {
	postSchemaDigest, err := tableSchemaDigest(database, "social_public_posts")
	if err != nil {
		return PublicSocialSnapshotV1{}, err
	}
	postRowsDigest, postCount, err := tableRowsDigest(
		database,
		"social_public_posts",
		"",
	)
	if err != nil {
		return PublicSocialSnapshotV1{}, err
	}
	commentRowsDigest, commentCount, err := tableRowsDigest(
		database,
		"social_comments",
		"post_class = 'public'",
	)
	if err != nil {
		return PublicSocialSnapshotV1{}, err
	}
	reactionRowsDigest, reactionCount, err := tableRowsDigest(
		database,
		"social_reactions",
		"post_class = 'public'",
	)
	if err != nil {
		return PublicSocialSnapshotV1{}, err
	}

	metadataDigests := make([]string, 0, len(publicReferences))
	blobDigests := make([]string, 0, len(publicReferences))
	for _, reference := range publicReferences {
		inspection, err := legacyObjects.InspectResetObject(
			ctx,
			ResolvedResetObjectTarget{
				OwnerDomain: ResetObjectDomainOSS,
				OwnerPTID:   reference.OwnerPTID,
				Backend:     reference.Backend,
				StorageKey:  reference.StorageKey,
			},
		)
		if err != nil {
			return PublicSocialSnapshotV1{}, resetError(
				ResetCodePublicSnapshotMismatch,
				"inspect public Social object: %v",
				err,
			)
		}
		metadataDigests = append(metadataDigests, inspection.MetadataDigest)
		blobDigests = append(blobDigests, inspection.BlobDigest)
	}
	slices.Sort(metadataDigests)
	slices.Sort(blobDigests)
	metadataDigest, err := canonicalSHA256(metadataDigests)
	if err != nil {
		return PublicSocialSnapshotV1{}, err
	}
	blobDigest, err := canonicalSHA256(blobDigests)
	if err != nil {
		return PublicSocialSnapshotV1{}, err
	}
	snapshot := PublicSocialSnapshotV1{
		SchemaVersion:              SecureContentResetSchemaVersion,
		ProfileID:                  profileID,
		PublicPostSchemaDigest:     postSchemaDigest,
		PublicPostRowsDigest:       postRowsDigest,
		PublicCommentRowsDigest:    commentRowsDigest,
		PublicReactionRowsDigest:   reactionRowsDigest,
		PublicObjectMetadataDigest: metadataDigest,
		PublicObjectBytesDigest:    blobDigest,
		Counts: PublicSocialSnapshotCounts{
			Posts:       postCount,
			Comments:    commentCount,
			Reactions:   reactionCount,
			ObjectMetas: int64(len(metadataDigests)),
			ObjectBlobs: int64(len(blobDigests)),
		},
	}
	snapshot.SnapshotDigest, err = snapshot.CalculatedDigest()
	if err != nil {
		return PublicSocialSnapshotV1{}, resetError(
			ResetCodePartialFailure,
			"calculate public Social snapshot digest: %v",
			err,
		)
	}

	return snapshot, nil
}

func tableSchemaDigest(database *gorm.DB, table string) (string, error) {
	columns, err := database.Migrator().ColumnTypes(table)
	if err != nil {
		return "", resetError(
			ResetCodePartialFailure,
			"inspect schema for %s: %v",
			table,
			err,
		)
	}
	type columnProjection struct {
		Name         string `json:"name"`
		DatabaseType string `json:"databaseType"`
		ColumnType   string `json:"columnType"`
		ColumnTypeOK bool   `json:"columnTypeKnown"`
		Nullable     bool   `json:"nullable"`
		NullableOK   bool   `json:"nullableKnown"`
		Default      string `json:"default"`
		DefaultOK    bool   `json:"defaultKnown"`
		Primary      bool   `json:"primary"`
		PrimaryOK    bool   `json:"primaryKnown"`
		Unique       bool   `json:"unique"`
		UniqueOK     bool   `json:"uniqueKnown"`
	}
	projection := make([]columnProjection, 0, len(columns))
	for _, column := range columns {
		columnType, columnTypeOK := column.ColumnType()
		nullable, nullableOK := column.Nullable()
		defaultValue, defaultOK := column.DefaultValue()
		primary, primaryOK := column.PrimaryKey()
		unique, uniqueOK := column.Unique()
		projection = append(projection, columnProjection{
			Name:         strings.ToLower(column.Name()),
			DatabaseType: normalizeDatabaseColumnType(column.DatabaseTypeName()),
			ColumnType:   normalizeDatabaseColumnType(columnType),
			ColumnTypeOK: columnTypeOK,
			Nullable:     nullable,
			NullableOK:   nullableOK,
			Default:      normalizeColumnDefault(defaultValue),
			DefaultOK:    defaultOK,
			Primary:      primary,
			PrimaryOK:    primaryOK,
			Unique:       unique,
			UniqueOK:     uniqueOK,
		})
	}
	slices.SortFunc(projection, func(left, right columnProjection) int {
		return strings.Compare(left.Name, right.Name)
	})
	indexes, err := database.Migrator().GetIndexes(table)
	if err != nil {
		return "", resetError(
			ResetCodePartialFailure,
			"inspect indexes for %s: %v",
			table,
			err,
		)
	}
	type indexProjection struct {
		Name      string   `json:"name"`
		Columns   []string `json:"columns"`
		Unique    bool     `json:"unique"`
		UniqueOK  bool     `json:"uniqueKnown"`
		Primary   bool     `json:"primary"`
		PrimaryOK bool     `json:"primaryKnown"`
	}
	indexProjectionRows := make([]indexProjection, 0, len(indexes))
	for _, index := range indexes {
		unique, uniqueOK := index.Unique()
		primary, primaryOK := index.PrimaryKey()
		indexProjectionRows = append(indexProjectionRows, indexProjection{
			Name:      index.Name(),
			Columns:   lowerStrings(index.Columns()),
			Unique:    unique,
			UniqueOK:  uniqueOK,
			Primary:   primary,
			PrimaryOK: primaryOK,
		})
	}
	slices.SortFunc(indexProjectionRows, func(left, right indexProjection) int {
		return strings.Compare(left.Name, right.Name)
	})

	return canonicalSHA256(struct {
		Table   string             `json:"table"`
		Columns []columnProjection `json:"columns"`
		Indexes []indexProjection  `json:"indexes"`
	}{
		Table:   table,
		Columns: projection,
		Indexes: indexProjectionRows,
	})
}

func tableRowsDigest(
	database *gorm.DB,
	table string,
	predicate string,
) (string, int64, error) {
	if !safeIdentifier(table) {
		return "", 0, resetError(ResetCodeInvalidInput, "table name is invalid")
	}
	query := "SELECT * FROM " + quoteIdentifier(table)
	if predicate != "" {
		if predicate != "post_class = 'public'" &&
			predicate != "post_class = 'private'" {
			return "", 0, resetError(
				ResetCodeInvalidInput,
				"snapshot predicate is not allowlisted",
			)
		}
		query += " WHERE " + predicate
	}
	rows, err := database.Raw(query).Rows()
	if err != nil {
		return "", 0, resetError(
			ResetCodePartialFailure,
			"snapshot rows for %s: %v",
			table,
			err,
		)
	}
	defer func() {
		_ = rows.Close()
	}()
	columns, err := rows.Columns()
	if err != nil {
		return "", 0, resetError(
			ResetCodePartialFailure,
			"read snapshot columns for %s: %v",
			table,
			err,
		)
	}
	records := make([]string, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		destinations := make([]any, len(columns))
		for index := range values {
			destinations[index] = &values[index]
		}
		if err := rows.Scan(destinations...); err != nil {
			return "", 0, resetError(
				ResetCodePartialFailure,
				"scan snapshot row for %s: %v",
				table,
				err,
			)
		}
		record := make([]string, 0, len(columns)*2)
		for index, column := range columns {
			record = append(record, column, canonicalSQLValue(values[index]))
		}
		encoded, err := json.Marshal(record)
		if err != nil {
			return "", 0, err
		}
		records = append(records, string(encoded))
	}
	if err := rows.Err(); err != nil {
		return "", 0, resetError(
			ResetCodePartialFailure,
			"iterate snapshot rows for %s: %v",
			table,
			err,
		)
	}
	slices.Sort(records)
	digest, err := canonicalSHA256(records)

	return digest, int64(len(records)), err
}

func canonicalSQLValue(value any) string {
	if value == nil {
		return "null"
	}
	switch typed := value.(type) {
	case []byte:
		return "bytes:" + base64.StdEncoding.EncodeToString(typed)
	case time.Time:
		return "time:" + typed.UTC().Format(time.RFC3339Nano)
	default:
		return reflect.TypeOf(value).String() + ":" + fmt.Sprint(value)
	}
}

func countRows(database *gorm.DB, table string, predicate string) (int64, error) {
	if !safeIdentifier(table) {
		return 0, resetError(ResetCodeInvalidInput, "table name is invalid")
	}
	query := "SELECT COUNT(*) FROM " + quoteIdentifier(table)
	if predicate != "" {
		if predicate != "post_class = 'private'" {
			return 0, resetError(
				ResetCodeSchemaTargetUnreviewed,
				"row-count predicate is not allowlisted",
			)
		}
		query += " WHERE " + predicate
	}
	var count int64
	if err := database.Raw(query).Scan(&count).Error; err != nil {
		return 0, resetError(
			ResetCodePartialFailure,
			"count reset rows in %s: %v",
			table,
			err,
		)
	}

	return count, nil
}

func currentDatabaseIdentityDigest(database *gorm.DB) (string, error) {
	identity := database.Dialector.Name()
	switch database.Dialector.Name() {
	case "postgres":
		var current string
		if err := database.Raw("SELECT current_database()").Scan(&current).Error; err != nil {
			return "", resetError(
				ResetCodePartialFailure,
				"read PostgreSQL database identity: %v",
				err,
			)
		}
		identity += "\x00" + current
	case "sqlite":
		type databaseRow struct {
			Sequence int    `gorm:"column:seq"`
			Name     string `gorm:"column:name"`
			File     string `gorm:"column:file"`
		}
		var rows []databaseRow
		if err := database.Raw("PRAGMA database_list").Scan(&rows).Error; err != nil {
			return "", resetError(
				ResetCodePartialFailure,
				"read SQLite database identity: %v",
				err,
			)
		}
		for _, row := range rows {
			if row.Name == "main" {
				identity += "\x00" + row.File
			}
		}
	default:
		return "", resetError(
			ResetCodeInvalidInput,
			"database identity is unsupported for %s",
			database.Dialector.Name(),
		)
	}

	return sha256Hex([]byte(identity)), nil
}

func canonicalPrivateSchemaDigest(database *gorm.DB) (string, error) {
	if err := validateCanonicalPrivateContentSchema(database); err != nil {
		return "", err
	}
	tables := make([]string, 0, len(dbmodel.SocialPrivateContentModels()))
	for _, model := range dbmodel.SocialPrivateContentModels() {
		statement := &gorm.Statement{DB: database}
		if err := statement.Parse(model); err != nil {
			return "", resetError(
				ResetCodePartialFailure,
				"parse canonical private model: %v",
				err,
			)
		}
		tables = append(tables, statement.Schema.Table)
	}
	tables = canonicalStrings(tables)
	digests := make([]string, 0, len(tables))
	for _, table := range tables {
		digest, err := tableSchemaDigest(database, table)
		if err != nil {
			return "", err
		}
		digests = append(digests, table+":"+digest)
	}

	return canonicalSHA256(digests)
}

func tableColumnSet(database *gorm.DB, table string) (map[string]struct{}, error) {
	columns, err := database.Migrator().ColumnTypes(table)
	if err != nil {
		return nil, resetError(
			ResetCodePartialFailure,
			"inspect table %s columns: %v",
			table,
			err,
		)
	}
	result := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		result[strings.ToLower(column.Name())] = struct{}{}
	}

	return result, nil
}

func safeIdentifier(value string) bool {
	if value == "" {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') &&
			(character < '0' || character > '9') &&
			character != '_' {
			return false
		}
	}

	return true
}

func quoteIdentifier(value string) string {
	return `"` + value + `"`
}

func valueString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case []byte:
		return string(typed)
	default:
		return fmt.Sprint(typed)
	}
}

func hexBytes(value []byte) string {
	if len(value) == 0 {
		return ""
	}

	return fmt.Sprintf("%x", value)
}
