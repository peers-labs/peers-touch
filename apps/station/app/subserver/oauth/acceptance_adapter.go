package oauth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/station/frame/core/facility/session"
	accessgatepb "github.com/peers-labs/peers-touch/station/frame/touch/model/accessgate"
	dbmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/db"
	oauthpb "github.com/peers-labs/peers-touch/station/frame/touch/model/oauth"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	MobileOAuthAcceptanceGateID    = "mobile-native-access-e2e"
	MobileOAuthAcceptanceFixtureID = "mobile-oauth-negative-fixture"

	AcceptanceOperationPrepareFollowingGate  = "prepare_following_gate"
	AcceptanceOperationExpireAwaitingAttempt = "expire_awaiting_attempt"
	AcceptanceOperationReadProofSnapshot     = "read_proof_snapshot"
	AcceptanceOperationCleanupRun            = "cleanup_run"

	acceptanceLeaseStateLeased      = "LEASED"
	acceptanceLeaseStatePrepared    = "PREPARED"
	acceptanceLeaseStateUsed        = "USED"
	acceptanceLeaseStateCleaning    = "CLEANING"
	acceptanceLeaseStateReleased    = "RELEASED"
	acceptanceLeaseStateQuarantined = "QUARANTINED"

	acceptanceJournalStateCommitted = "COMMITTED"
	acceptanceSchemaName            = "mobile_oauth_acceptance"
	acceptanceLeaseTableName        = "fixture_leases"
	acceptanceJournalTableName      = "operation_journal"
)

var (
	ErrAcceptanceUnauthorized      = errors.New("mobile OAuth Acceptance adapter authorization rejected")
	ErrAcceptanceConflict          = errors.New("mobile OAuth Acceptance operation conflict")
	ErrAcceptanceLeaseUnavailable  = errors.New("mobile OAuth Acceptance fixture lease unavailable")
	ErrAcceptanceStaleFence        = errors.New("mobile OAuth Acceptance fixture fence is stale")
	ErrAcceptancePrecondition      = errors.New("mobile OAuth Acceptance precondition failed")
	ErrAcceptanceCleanupConflict   = errors.New("mobile OAuth Acceptance cleanup conflict")
	ErrAcceptanceUnsupportedStore  = errors.New("mobile OAuth Acceptance adapter requires PostgreSQL")
	ErrAcceptanceInvariantViolated = errors.New("mobile OAuth Acceptance proof invariant violated")
)

var acceptanceAllowedOperations = []string{
	AcceptanceOperationPrepareFollowingGate,
	AcceptanceOperationExpireAwaitingAttempt,
	AcceptanceOperationReadProofSnapshot,
	AcceptanceOperationCleanupRun,
}

// AcceptanceArtifactRef is the E2-0 immutable Evidence Store reference shape.
// The adapter only transports deployment-produced references; it never writes
// the Evidence Store itself.
type AcceptanceArtifactRef struct {
	ArtifactKind string `json:"artifactKind"`
	WorkspaceID  string `json:"workspaceId"`
	GateID       string `json:"gateId"`
	RunID        string `json:"runId"`
	Path         string `json:"path"`
	SHA256       string `json:"sha256"`
	MediaType    string `json:"mediaType"`
}

// AcceptanceDeployment is supplied by the deployment owner, not by a public
// request path. It binds every adapter action to one attested disposable
// Station before the adapter touches its database.
type AcceptanceDeployment struct {
	ServiceID                string                `json:"serviceId"`
	StationPeerID            string                `json:"stationPeerId"`
	DeploymentEnvironment    string                `json:"deploymentEnvironment"`
	LiveCommit               string                `json:"liveCommit"`
	WorkspaceDigest          string                `json:"workspaceDigest"`
	ProtocolDigest           string                `json:"protocolDigest"`
	ServiceAttestation       AcceptanceArtifactRef `json:"serviceAttestation"`
	DeploymentLeaseMatched   bool                  `json:"deploymentLeaseMatched"`
	DisposableTargetVerified bool                  `json:"disposableTargetVerified"`
	DestructiveResetApproved bool                  `json:"destructiveResetApproved"`
}

type AcceptanceLeaseRequest struct {
	RunID       string    `json:"runId"`
	GateID      string    `json:"gateId"`
	ResourceKey string    `json:"resourceKey"`
	HeartbeatAt time.Time `json:"heartbeatAt"`
	RenewBefore time.Time `json:"renewBefore"`
	ExpiresAt   time.Time `json:"expiresAt"`
}

type AcceptanceLeaseIdentity struct {
	ResourceKey string `json:"resourceKey"`
	HolderRunID string `json:"holderRunId"`
	FenceToken  uint64 `json:"fenceToken"`
}

type MobileOAuthFixtureLease struct {
	ArtifactKind       string                `json:"artifactKind"`
	FixtureID          string                `json:"fixtureId"`
	ResourceKey        string                `json:"resourceKey"`
	HolderRunID        string                `json:"holderRunId"`
	FenceToken         uint64                `json:"fenceToken"`
	RunID              string                `json:"runId"`
	GateID             string                `json:"gateId"`
	ServiceID          string                `json:"serviceId"`
	StationPeerID      string                `json:"stationPeerId"`
	ServiceAttestation AcceptanceArtifactRef `json:"serviceAttestation"`
	Authorization      struct {
		DestructiveResetApproved bool `json:"destructiveResetApproved"`
		DeploymentLeaseMatched   bool `json:"deploymentLeaseMatched"`
		DisposableTargetVerified bool `json:"disposableTargetVerified"`
	} `json:"authorization"`
	AllowedOperations []string  `json:"allowedOperations"`
	State             string    `json:"state"`
	HeartbeatAt       time.Time `json:"heartbeatAt"`
	RenewBefore       time.Time `json:"renewBefore"`
	ExpiresAt         time.Time `json:"expiresAt"`
	QuarantineReason  string    `json:"quarantineReason"`
	CleanupRegistered bool      `json:"cleanupRegistered"`
}

type AcceptanceOperationTarget struct {
	ServiceID           string `json:"serviceId"`
	OAuthAttemptRef     string `json:"oauthAttemptRef"`
	AccessAttemptRef    string `json:"accessAttemptRef"`
	DeviceAlias         string `json:"deviceAlias"`
	LifecycleGeneration uint64 `json:"lifecycleGeneration"`
}

type AcceptanceOperationRequest struct {
	OperationID string                    `json:"operationId"`
	InputDigest string                    `json:"inputDigest"`
	Lease       AcceptanceLeaseIdentity   `json:"lease"`
	VariantID   string                    `json:"variantId"`
	Operation   string                    `json:"operation"`
	Target      AcceptanceOperationTarget `json:"target"`
	OAuthState  string                    `json:"oauthState"`
	InviteCode  string                    `json:"inviteCode,omitempty"`
}

type AcceptanceOperationReceipt struct {
	OperationID         string                    `json:"operationId"`
	InputDigest         string                    `json:"inputDigest"`
	ResourceKey         string                    `json:"resourceKey"`
	HolderRunID         string                    `json:"holderRunId"`
	FenceToken          uint64                    `json:"fenceToken"`
	RunID               string                    `json:"runId"`
	GateID              string                    `json:"gateId"`
	VariantID           string                    `json:"variantId"`
	Operation           string                    `json:"operation"`
	Target              AcceptanceOperationTarget `json:"target"`
	OAuthState          string                    `json:"oauthState"`
	JournalState        string                    `json:"journalState"`
	PreconditionMatched bool                      `json:"preconditionMatched"`
	AffectedRows        int64                     `json:"affectedRows"`
	Before              map[string]any            `json:"before"`
	After               map[string]any            `json:"after"`
}

type AcceptanceOperationArtifactRefs struct {
	Before      AcceptanceArtifactRef `json:"before"`
	After       AcceptanceArtifactRef `json:"after"`
	PostCleanup AcceptanceArtifactRef `json:"postCleanup"`
}

// MobileOAuthFixtureOperation is the frozen E2-0 durable artifact shape. The
// deployment adapter returns a receipt first; after Acceptance Core persists
// the three snapshots, this pure assembler binds their immutable references.
type MobileOAuthFixtureOperation struct {
	ArtifactKind string                    `json:"artifactKind"`
	OperationID  string                    `json:"operationId"`
	InputDigest  string                    `json:"inputDigest"`
	ResourceKey  string                    `json:"resourceKey"`
	HolderRunID  string                    `json:"holderRunId"`
	FenceToken   uint64                    `json:"fenceToken"`
	RunID        string                    `json:"runId"`
	GateID       string                    `json:"gateId"`
	VariantID    string                    `json:"variantId"`
	Operation    string                    `json:"operation"`
	Target       AcceptanceOperationTarget `json:"target"`
	Precondition struct {
		OAuthState string `json:"oauthState"`
		RunOwned   bool   `json:"runOwned"`
	} `json:"precondition"`
	Result struct {
		JournalState        string                `json:"journalState"`
		PreconditionMatched bool                  `json:"preconditionMatched"`
		AffectedRows        int64                 `json:"affectedRows"`
		Before              AcceptanceArtifactRef `json:"before"`
		After               AcceptanceArtifactRef `json:"after"`
		PostCleanup         AcceptanceArtifactRef `json:"postCleanup"`
	} `json:"result"`
}

type StationOAuthProofRequest struct {
	OperationID            string                    `json:"operationId"`
	Lease                  AcceptanceLeaseIdentity   `json:"lease"`
	VariantID              string                    `json:"variantId"`
	SnapshotPhase          string                    `json:"snapshotPhase"`
	Target                 AcceptanceOperationTarget `json:"target"`
	ExpectedProvider       string                    `json:"expectedProvider"`
	ProviderCorrelationKey []byte                    `json:"-"`
}

type StationOAuthProofSnapshot struct {
	ArtifactKind            string                           `json:"artifactKind"`
	RunID                   string                           `json:"runId"`
	GateID                  string                           `json:"gateId"`
	VariantID               string                           `json:"variantId"`
	FixtureID               string                           `json:"fixtureId"`
	SnapshotPhase           string                           `json:"snapshotPhase"`
	ObservedAt              time.Time                        `json:"observedAt"`
	Observation             StationOAuthProofObservation     `json:"observation"`
	Service                 StationOAuthProofService         `json:"service"`
	Binding                 StationOAuthProofBinding         `json:"binding"`
	Access                  StationOAuthProofAccess          `json:"access"`
	OAuth                   StationOAuthProofOAuth           `json:"oauth"`
	Candidate               StationOAuthProofCandidate       `json:"candidate"`
	CredentialEnvelopeCount int64                            `json:"credentialEnvelopeCount"`
	Session                 StationOAuthProofSession         `json:"session"`
	ProviderBinding         StationOAuthProofProviderBinding `json:"providerBinding"`
	Fixture                 StationOAuthProofFixture         `json:"fixture"`
	RunOwnedResidue         StationOAuthProofResidue         `json:"runOwnedResidue"`
	Invariants              StationOAuthProofInvariants      `json:"invariants"`
	Redaction               struct {
		Status string `json:"status"`
	} `json:"redaction"`
}

type StationOAuthProofObservation struct {
	Isolation           string    `json:"isolation"`
	TransactionSnapshot string    `json:"transactionSnapshot"`
	StartedAt           time.Time `json:"startedAt"`
	CompletedAt         time.Time `json:"completedAt"`
	FreshnessSeconds    int64     `json:"freshnessSeconds"`
}

type StationOAuthProofService struct {
	ServiceID             string                `json:"serviceId"`
	StationPeerID         string                `json:"stationPeerId"`
	DeploymentEnvironment string                `json:"deploymentEnvironment"`
	LiveCommit            string                `json:"liveCommit"`
	WorkspaceDigest       string                `json:"workspaceDigest"`
	ProtocolDigest        string                `json:"protocolDigest"`
	Attestation           AcceptanceArtifactRef `json:"attestation"`
}

type StationOAuthProofBinding struct {
	AccessAttemptRef    string `json:"accessAttemptRef"`
	OAuthAttemptRef     string `json:"oauthAttemptRef"`
	ExpectedProvider    string `json:"expectedProvider"`
	GateID              string `json:"gateId"`
	DeviceAlias         string `json:"deviceAlias"`
	LifecycleGeneration uint64 `json:"lifecycleGeneration"`
}

type StationOAuthProofAccess struct {
	Status           string `json:"status"`
	CurrentGateID    string `json:"currentGateId"`
	DecisionRevision uint64 `json:"decisionRevision"`
}

type StationOAuthProofOAuth struct {
	State             string    `json:"state"`
	Result            string    `json:"result"`
	ErrorCode         string    `json:"errorCode"`
	UpdatedAt         time.Time `json:"updatedAt"`
	ExpiresRelation   string    `json:"expiresRelation"`
	ClaimedAtPresent  bool      `json:"claimedAtPresent"`
	ConsumedAtPresent bool      `json:"consumedAtPresent"`
}

type StationOAuthProofCandidate struct {
	Count             int64  `json:"count"`
	State             string `json:"state,omitempty"`
	ActorPTID         string `json:"actorPtid,omitempty"`
	SessionRefPresent bool   `json:"sessionRefPresent"`
}

type StationOAuthProofSession struct {
	Count            int64  `json:"count"`
	ActiveCount      int64  `json:"activeCount"`
	RevokedCount     int64  `json:"revokedCount"`
	AuthMethod       string `json:"authMethod"`
	DecisionRevision uint64 `json:"decisionRevision"`
}

type StationOAuthProofProviderBinding struct {
	Provider                    string `json:"provider"`
	CandidateCorrelationPresent bool   `json:"candidateCorrelationPresent"`
	ProviderSubjectFingerprint  string `json:"providerSubjectFingerprint,omitempty"`
	BindingCount                int64  `json:"bindingCount,omitempty"`
}

type StationOAuthProofFixture struct {
	OperationID          string `json:"operationId"`
	JournalState         string `json:"journalState"`
	PolicyBaselineDigest string `json:"policyBaselineDigest"`
	PolicyObservedDigest string `json:"policyObservedDigest"`
	PolicyRestored       bool   `json:"policyRestored"`
}

type StationOAuthProofResidue struct {
	AccessAttempts        int64 `json:"accessAttempts"`
	OAuthAttempts         int64 `json:"oauthAttempts"`
	Candidates            int64 `json:"candidates"`
	CredentialEnvelopes   int64 `json:"credentialEnvelopes"`
	Sessions              int64 `json:"sessions"`
	InviteCodes           int64 `json:"inviteCodes"`
	PolicyOverrides       int64 `json:"policyOverrides"`
	FixtureJournalEntries int64 `json:"fixtureJournalEntries"`
}

type StationOAuthProofInvariants struct {
	SingleConsume        bool `json:"singleConsume"`
	SingleCandidate      bool `json:"singleCandidate"`
	NoEarlyActiveSession bool `json:"noEarlyActiveSession"`
	NoUnexpectedEnvelope bool `json:"noUnexpectedEnvelope"`
}

type acceptanceLeaseRecord struct {
	ResourceKey           string    `gorm:"column:resource_key;primaryKey"`
	HolderRunID           string    `gorm:"column:holder_run_id;not null"`
	FenceToken            uint64    `gorm:"column:fence_token;not null"`
	GateID                string    `gorm:"column:gate_id;not null"`
	ServiceID             string    `gorm:"column:service_id;not null"`
	StationPeerID         string    `gorm:"column:station_peer_id;not null"`
	State                 string    `gorm:"column:state;not null"`
	HeartbeatAt           time.Time `gorm:"column:heartbeat_at;not null"`
	RenewBefore           time.Time `gorm:"column:renew_before;not null"`
	ExpiresAt             time.Time `gorm:"column:expires_at;not null"`
	QuarantineReason      string    `gorm:"column:quarantine_reason;not null"`
	PolicyBaselineJSON    []byte    `gorm:"column:policy_baseline_json;not null"`
	PolicyBaselineDigest  string    `gorm:"column:policy_baseline_digest;not null"`
	InstalledPolicyJSON   []byte    `gorm:"column:installed_policy_json;not null"`
	InstalledPolicyDigest string    `gorm:"column:installed_policy_digest;not null"`
	InviteCodeIDsJSON     []byte    `gorm:"column:invite_code_ids_json;not null"`
	CreatedAt             time.Time `gorm:"column:created_at;not null"`
	UpdatedAt             time.Time `gorm:"column:updated_at;not null"`
}

type acceptanceJournalRecord struct {
	OperationID string    `gorm:"column:operation_id;primaryKey"`
	InputDigest string    `gorm:"column:input_digest;not null"`
	ResourceKey string    `gorm:"column:resource_key;not null;index"`
	HolderRunID string    `gorm:"column:holder_run_id;not null;index"`
	FenceToken  uint64    `gorm:"column:fence_token;not null"`
	VariantID   string    `gorm:"column:variant_id;not null"`
	Operation   string    `gorm:"column:operation;not null"`
	TargetJSON  []byte    `gorm:"column:target_json;not null"`
	ResultJSON  []byte    `gorm:"column:result_json;not null"`
	State       string    `gorm:"column:state;not null"`
	Residue     bool      `gorm:"column:residue;not null"`
	CreatedAt   time.Time `gorm:"column:created_at;not null"`
	UpdatedAt   time.Time `gorm:"column:updated_at;not null"`
}

type policySnapshot struct {
	Present           bool      `json:"present"`
	ID                uint64    `json:"id"`
	Mode              string    `json:"mode"`
	AllowedEmails     string    `json:"allowedEmails"`
	AllowedUsernames  string    `json:"allowedUsernames"`
	AllowedActorPTIDs string    `json:"allowedActorPtids"`
	EnabledGates      string    `json:"enabledGates"`
	SelfServiceInvite bool      `json:"selfServiceInvite"`
	UpdatedBy         string    `json:"updatedBy"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

type acceptanceAdapterHooks struct {
	afterBusinessMutation func() error
	snapshotIdentifier    func(*gorm.DB) (string, error)
}

// AcceptanceAdapter is a deployment-owned, non-serving adapter. Construction
// is intentionally explicit so importing the OAuth subserver cannot register
// routes, migrations, or background work.
type AcceptanceAdapter struct {
	db               *gorm.DB
	deployment       AcceptanceDeployment
	leaseTable       string
	journalTable     string
	allowTestDialect bool
	now              func() time.Time
	hooks            acceptanceAdapterHooks
}

func NewAcceptanceAdapter(database *gorm.DB, deployment AcceptanceDeployment) (*AcceptanceAdapter, error) {
	return newAcceptanceAdapter(database, deployment, false)
}

func newAcceptanceAdapter(
	database *gorm.DB,
	deployment AcceptanceDeployment,
	allowTestDialect bool,
) (*AcceptanceAdapter, error) {
	if database == nil {
		return nil, fmt.Errorf("construct mobile OAuth Acceptance adapter: database is required")
	}
	if err := validateAcceptanceDeployment(deployment); err != nil {
		return nil, err
	}
	dialect := database.Dialector.Name()
	if dialect != "postgres" && !allowTestDialect {
		return nil, ErrAcceptanceUnsupportedStore
	}
	leaseTable := acceptanceSchemaName + "." + acceptanceLeaseTableName
	journalTable := acceptanceSchemaName + "." + acceptanceJournalTableName
	if dialect != "postgres" {
		leaseTable = acceptanceSchemaName + "_" + acceptanceLeaseTableName
		journalTable = acceptanceSchemaName + "_" + acceptanceJournalTableName
	}
	return &AcceptanceAdapter{
		db:               database,
		deployment:       deployment,
		leaseTable:       leaseTable,
		journalTable:     journalTable,
		allowTestDialect: allowTestDialect,
		now:              func() time.Time { return time.Now().UTC() },
	}, nil
}

// Bootstrap creates only the disposable adapter-owned schema. It is never
// registered with Station's production AutoMigrate hooks.
func (a *AcceptanceAdapter) Bootstrap(ctx context.Context) error {
	if err := a.validateDeployment(); err != nil {
		return err
	}
	if a.db.Dialector.Name() == "postgres" {
		if err := a.db.WithContext(ctx).Exec(
			`CREATE SCHEMA IF NOT EXISTS ` + acceptanceSchemaName,
		).Error; err != nil {
			return fmt.Errorf("create mobile OAuth Acceptance schema: %w", err)
		}
	}
	if err := a.db.WithContext(ctx).Table(a.leaseTable).AutoMigrate(&acceptanceLeaseRecord{}); err != nil {
		return fmt.Errorf("create mobile OAuth Acceptance lease storage: %w", err)
	}
	if err := a.db.WithContext(ctx).Table(a.journalTable).AutoMigrate(&acceptanceJournalRecord{}); err != nil {
		return fmt.Errorf("create mobile OAuth Acceptance journal storage: %w", err)
	}
	return nil
}

// Teardown removes adapter-owned disposable storage after proving that no
// active/quarantined lease or mutable journal residue remains.
func (a *AcceptanceAdapter) Teardown(ctx context.Context) error {
	if err := a.validateDeployment(); err != nil {
		return err
	}
	var unsafeLeases int64
	if err := a.db.WithContext(ctx).Table(a.leaseTable).
		Where("state <> ?", acceptanceLeaseStateReleased).
		Count(&unsafeLeases).Error; err != nil {
		return fmt.Errorf("inspect mobile OAuth Acceptance leases before teardown: %w", err)
	}
	var residue int64
	if err := a.db.WithContext(ctx).Table(a.journalTable).
		Where("residue = ?", true).
		Count(&residue).Error; err != nil {
		return fmt.Errorf("inspect mobile OAuth Acceptance journal before teardown: %w", err)
	}
	if unsafeLeases != 0 || residue != 0 {
		return fmt.Errorf(
			"%w: teardown blocked by leases=%d mutable_journal_entries=%d",
			ErrAcceptanceCleanupConflict,
			unsafeLeases,
			residue,
		)
	}
	if a.db.Dialector.Name() == "postgres" {
		if err := a.db.WithContext(ctx).Exec(
			`DROP SCHEMA ` + acceptanceSchemaName + ` CASCADE`,
		).Error; err != nil {
			return fmt.Errorf("drop mobile OAuth Acceptance schema: %w", err)
		}
		return nil
	}
	if err := a.db.WithContext(ctx).Migrator().DropTable(a.journalTable, a.leaseTable); err != nil {
		return fmt.Errorf("drop mobile OAuth Acceptance test tables: %w", err)
	}
	return nil
}

func (a *AcceptanceAdapter) AcquireLease(
	ctx context.Context,
	request AcceptanceLeaseRequest,
) (*MobileOAuthFixtureLease, error) {
	if err := a.validateDeployment(); err != nil {
		return nil, err
	}
	if err := validateLeaseRequest(a.deployment, request); err != nil {
		return nil, err
	}
	var (
		record  acceptanceLeaseRecord
		expired bool
	)
	err := a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		err := tx.Table(a.leaseTable).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("resource_key = ?", request.ResourceKey).
			First(&record).Error
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			baseline, digest, baselineErr := loadPolicySnapshot(tx, false)
			if baselineErr != nil {
				return baselineErr
			}
			now := a.now()
			record = acceptanceLeaseRecord{
				ResourceKey:           request.ResourceKey,
				HolderRunID:           request.RunID,
				FenceToken:            1,
				GateID:                request.GateID,
				ServiceID:             a.deployment.ServiceID,
				StationPeerID:         a.deployment.StationPeerID,
				State:                 acceptanceLeaseStateLeased,
				HeartbeatAt:           request.HeartbeatAt.UTC(),
				RenewBefore:           request.RenewBefore.UTC(),
				ExpiresAt:             request.ExpiresAt.UTC(),
				PolicyBaselineJSON:    baseline,
				PolicyBaselineDigest:  digest,
				InstalledPolicyJSON:   []byte(`{}`),
				InstalledPolicyDigest: digestJSON([]byte(`{}`)),
				InviteCodeIDsJSON:     []byte(`[]`),
				CreatedAt:             now,
				UpdatedAt:             now,
			}
			return tx.Table(a.leaseTable).Create(&record).Error
		case err != nil:
			return err
		}

		now := a.now()
		if record.State == acceptanceLeaseStateQuarantined {
			return fmt.Errorf("%w: resource is quarantined", ErrAcceptanceLeaseUnavailable)
		}
		if record.State != acceptanceLeaseStateReleased {
			if !record.ExpiresAt.After(now) {
				reason := "lease heartbeat expired before verified cleanup"
				if err := tx.Table(a.leaseTable).
					Where("resource_key = ? AND fence_token = ?", record.ResourceKey, record.FenceToken).
					Updates(map[string]any{
						"state":             acceptanceLeaseStateQuarantined,
						"quarantine_reason": reason,
						"updated_at":        now,
					}).Error; err != nil {
					return err
				}
				expired = true
				return nil
			}
			if record.HolderRunID != request.RunID {
				return fmt.Errorf("%w: resource is held by another run", ErrAcceptanceLeaseUnavailable)
			}
			return nil
		}

		baseline, digest, err := loadPolicySnapshot(tx, false)
		if err != nil {
			return err
		}
		record.HolderRunID = request.RunID
		record.FenceToken++
		record.State = acceptanceLeaseStateLeased
		record.HeartbeatAt = request.HeartbeatAt.UTC()
		record.RenewBefore = request.RenewBefore.UTC()
		record.ExpiresAt = request.ExpiresAt.UTC()
		record.QuarantineReason = ""
		record.PolicyBaselineJSON = baseline
		record.PolicyBaselineDigest = digest
		record.InstalledPolicyJSON = []byte(`{}`)
		record.InstalledPolicyDigest = digestJSON([]byte(`{}`))
		record.InviteCodeIDsJSON = []byte(`[]`)
		record.CreatedAt = now
		record.UpdatedAt = now
		return tx.Table(a.leaseTable).
			Where("resource_key = ? AND fence_token = ?", record.ResourceKey, record.FenceToken-1).
			Updates(record).Error
	})
	if err != nil {
		return nil, fmt.Errorf("acquire mobile OAuth Acceptance fixture lease: %w", err)
	}
	if expired {
		return nil, fmt.Errorf(
			"acquire mobile OAuth Acceptance fixture lease: %w: lease heartbeat expired before verified cleanup",
			ErrAcceptanceLeaseUnavailable,
		)
	}
	return a.leasePayload(record), nil
}

func (a *AcceptanceAdapter) HeartbeatLease(
	ctx context.Context,
	identity AcceptanceLeaseIdentity,
	heartbeatAt, renewBefore, expiresAt time.Time,
) (*MobileOAuthFixtureLease, error) {
	if err := a.validateDeployment(); err != nil {
		return nil, err
	}
	if heartbeatAt.IsZero() || !renewBefore.After(heartbeatAt) || !expiresAt.After(renewBefore) {
		return nil, fmt.Errorf("%w: invalid heartbeat window", ErrAcceptancePrecondition)
	}
	if err := a.quarantineExpiredLease(ctx, identity, false); err != nil {
		return nil, err
	}
	var record acceptanceLeaseRecord
	err := a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		locked, err := a.lockLease(tx, identity, false)
		if err != nil {
			return err
		}
		result := tx.Table(a.leaseTable).
			Where(
				"resource_key = ? AND holder_run_id = ? AND fence_token = ?",
				identity.ResourceKey,
				identity.HolderRunID,
				identity.FenceToken,
			).
			Updates(map[string]any{
				"heartbeat_at": heartbeatAt.UTC(),
				"renew_before": renewBefore.UTC(),
				"expires_at":   expiresAt.UTC(),
				"updated_at":   a.now(),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrAcceptanceStaleFence
		}
		record = *locked
		record.HeartbeatAt = heartbeatAt.UTC()
		record.RenewBefore = renewBefore.UTC()
		record.ExpiresAt = expiresAt.UTC()
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("heartbeat mobile OAuth Acceptance fixture lease: %w", err)
	}
	return a.leasePayload(record), nil
}

func (a *AcceptanceAdapter) Execute(
	ctx context.Context,
	request AcceptanceOperationRequest,
) (*AcceptanceOperationReceipt, error) {
	if err := a.validateDeployment(); err != nil {
		return nil, err
	}
	if request.Operation != AcceptanceOperationPrepareFollowingGate &&
		request.Operation != AcceptanceOperationExpireAwaitingAttempt &&
		request.Operation != AcceptanceOperationCleanupRun {
		return nil, fmt.Errorf("%w: operation %q is not mutation-allowlisted", ErrAcceptanceUnauthorized, request.Operation)
	}
	digest, err := operationInputDigest(request)
	if err != nil {
		return nil, err
	}
	if request.InputDigest != digest {
		return nil, fmt.Errorf("%w: inputDigest mismatch", ErrAcceptanceConflict)
	}

	allowReleased := request.Operation == AcceptanceOperationCleanupRun
	if err := a.quarantineExpiredLease(ctx, request.Lease, allowReleased); err != nil {
		return nil, err
	}

	var receipt *AcceptanceOperationReceipt
	err = a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		lease, err := a.lockLease(tx, request.Lease, allowReleased)
		if err != nil {
			return err
		}
		if err := validateOperationRequest(a.deployment, request, lease); err != nil {
			return err
		}
		if recovered, recoverErr := a.recoverOperationWithDB(tx, request, digest); recovered != nil || recoverErr != nil {
			receipt = recovered
			return recoverErr
		}
		if lease.State == acceptanceLeaseStateReleased {
			return ErrAcceptanceStaleFence
		}

		switch request.Operation {
		case AcceptanceOperationPrepareFollowingGate:
			receipt, err = a.prepareFollowingGate(tx, request, lease)
		case AcceptanceOperationExpireAwaitingAttempt:
			receipt, err = a.expireAwaitingAttempt(tx, request, lease)
		case AcceptanceOperationCleanupRun:
			receipt, err = a.cleanupRun(tx, request, lease)
		}
		if err != nil {
			return err
		}
		if a.hooks.afterBusinessMutation != nil {
			if err := a.hooks.afterBusinessMutation(); err != nil {
				return fmt.Errorf("mobile OAuth Acceptance post-mutation check: %w", err)
			}
		}
		return a.persistJournal(tx, request, receipt, request.Operation != AcceptanceOperationCleanupRun)
	})
	if err != nil {
		return nil, fmt.Errorf("execute mobile OAuth Acceptance operation %s: %w", request.Operation, err)
	}
	return receipt, nil
}

func (a *AcceptanceAdapter) ReadProofSnapshot(
	ctx context.Context,
	request StationOAuthProofRequest,
) (*StationOAuthProofSnapshot, error) {
	if err := a.validateDeployment(); err != nil {
		return nil, err
	}
	if err := validateSnapshotRequest(a.deployment, request); err != nil {
		return nil, err
	}
	if err := a.quarantineExpiredLease(
		ctx,
		request.Lease,
		request.SnapshotPhase == "post_cleanup",
	); err != nil {
		return nil, err
	}

	startedAt := a.now()
	var snapshot *StationOAuthProofSnapshot
	err := a.db.WithContext(ctx).Transaction(
		func(tx *gorm.DB) error {
			lease, err := a.readLease(tx, request.Lease, request.SnapshotPhase == "post_cleanup")
			if err != nil {
				return err
			}
			snapshot, err = a.readSnapshot(tx, request, lease, startedAt)
			return err
		},
		&sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true},
	)
	if err != nil {
		return nil, fmt.Errorf("read mobile OAuth Station proof snapshot: %w", err)
	}
	return snapshot, nil
}

func FinalizeAcceptanceOperation(
	receipt *AcceptanceOperationReceipt,
	refs AcceptanceOperationArtifactRefs,
) (*MobileOAuthFixtureOperation, error) {
	if receipt == nil {
		return nil, fmt.Errorf("%w: operation receipt is required", ErrAcceptancePrecondition)
	}
	for name, ref := range map[string]AcceptanceArtifactRef{
		"before":      refs.Before,
		"after":       refs.After,
		"postCleanup": refs.PostCleanup,
	} {
		if err := validateOperationArtifactRef(ref, receipt.RunID, receipt.GateID); err != nil {
			return nil, fmt.Errorf("%w: %s snapshot reference: %v", ErrAcceptancePrecondition, name, err)
		}
	}
	artifact := &MobileOAuthFixtureOperation{
		ArtifactKind: "mobile-oauth-fixture-operation",
		OperationID:  receipt.OperationID,
		InputDigest:  receipt.InputDigest,
		ResourceKey:  receipt.ResourceKey,
		HolderRunID:  receipt.HolderRunID,
		FenceToken:   receipt.FenceToken,
		RunID:        receipt.RunID,
		GateID:       receipt.GateID,
		VariantID:    receipt.VariantID,
		Operation:    receipt.Operation,
		Target:       receipt.Target,
	}
	artifact.Precondition.OAuthState = receipt.OAuthState
	artifact.Precondition.RunOwned = true
	artifact.Result.JournalState = receipt.JournalState
	artifact.Result.PreconditionMatched = receipt.PreconditionMatched
	artifact.Result.AffectedRows = receipt.AffectedRows
	artifact.Result.Before = refs.Before
	artifact.Result.After = refs.After
	artifact.Result.PostCleanup = refs.PostCleanup
	return artifact, nil
}

func (a *AcceptanceAdapter) prepareFollowingGate(
	tx *gorm.DB,
	request AcceptanceOperationRequest,
	lease *acceptanceLeaseRecord,
) (*AcceptanceOperationReceipt, error) {
	if strings.TrimSpace(request.InviteCode) == "" {
		return nil, fmt.Errorf("%w: invite code is required", ErrAcceptancePrecondition)
	}
	attempt, access, err := lockAndValidateTarget(tx, request, lease)
	if err != nil {
		return nil, err
	}
	before := operationState(access, attempt)

	var current dbmodel.AccessPolicy
	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current).Error
	if err != nil {
		return nil, fmt.Errorf("%w: current Access policy is unavailable: %v", ErrAcceptancePrecondition, err)
	}
	_, currentDigest, err := encodePolicySnapshot(&current)
	if err != nil {
		return nil, err
	}
	if currentDigest != lease.PolicyBaselineDigest {
		return nil, fmt.Errorf("%w: Access policy changed after lease acquisition", ErrAcceptanceConflict)
	}

	marker := "mobile-oauth-acceptance:" + lease.HolderRunID
	update := map[string]any{
		"mode":                "invite_only",
		"enabled_gates":       followingGateOrder(),
		"self_service_invite": true,
		"updated_by":          marker,
		"updated_at":          a.now(),
	}
	result := tx.Model(&dbmodel.AccessPolicy{}).
		Where("id = ? AND updated_at = ?", current.ID, current.UpdatedAt).
		Updates(update)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, fmt.Errorf("%w: Access policy revision changed during prepare", ErrAcceptanceConflict)
	}

	inviteID := "mobile-oauth-acceptance-" + request.OperationID
	invite := dbmodel.AccessInviteCode{
		ID:        inviteID,
		Code:      strings.TrimSpace(request.InviteCode),
		Note:      "mobile OAuth physical Acceptance",
		MaxUses:   1,
		CreatedBy: marker,
	}
	if err := tx.Create(&invite).Error; err != nil {
		return nil, fmt.Errorf("create run-owned invite code: %w", err)
	}

	var installed dbmodel.AccessPolicy
	if err := tx.First(&installed, current.ID).Error; err != nil {
		return nil, fmt.Errorf("read installed Access policy: %w", err)
	}
	installedJSON, installedDigest, err := encodePolicySnapshot(&installed)
	if err != nil {
		return nil, err
	}
	inviteIDs, err := appendJSONUniqueString(lease.InviteCodeIDsJSON, inviteID)
	if err != nil {
		return nil, err
	}
	if err := tx.Table(a.leaseTable).
		Where("resource_key = ? AND holder_run_id = ? AND fence_token = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken).
		Updates(map[string]any{
			"state":                   acceptanceLeaseStatePrepared,
			"installed_policy_json":   installedJSON,
			"installed_policy_digest": installedDigest,
			"invite_code_ids_json":    inviteIDs,
			"updated_at":              a.now(),
		}).Error; err != nil {
		return nil, err
	}
	lease.State = acceptanceLeaseStatePrepared
	lease.InstalledPolicyJSON = installedJSON
	lease.InstalledPolicyDigest = installedDigest
	lease.InviteCodeIDsJSON = inviteIDs

	return newOperationReceipt(request, before, map[string]any{
		"accessStatus":          access.Status,
		"oauthState":            oauthpb.OAuthAttemptState(attempt.State).String(),
		"policyBaselineDigest":  digestWithPrefix(currentDigest),
		"policyInstalledDigest": digestWithPrefix(installedDigest),
		"inviteCodeCreated":     true,
	}), nil
}

func (a *AcceptanceAdapter) expireAwaitingAttempt(
	tx *gorm.DB,
	request AcceptanceOperationRequest,
	lease *acceptanceLeaseRecord,
) (*AcceptanceOperationReceipt, error) {
	attempt, access, err := lockAndValidateTarget(tx, request, lease)
	if err != nil {
		return nil, err
	}
	if oauthpb.OAuthAttemptState(attempt.State) != oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER {
		return nil, fmt.Errorf("%w: OAuth attempt is not awaiting provider", ErrAcceptancePrecondition)
	}
	before := operationState(access, attempt)
	expiredAt := a.now().Add(-time.Second)
	windowStart, windowEnd, err := acceptanceTargetCreationWindow(lease)
	if err != nil {
		return nil, err
	}
	result := tx.Model(&dbmodel.OAuthAttempt{}).
		Where(
			"id = ? AND access_attempt_id = ? AND station_peer_id = ? AND device_id = ? AND lifecycle_generation = ? AND state = ? AND created_at >= ? AND created_at <= ?",
			request.Target.OAuthAttemptRef,
			request.Target.AccessAttemptRef,
			a.deployment.StationPeerID,
			request.Target.DeviceAlias,
			request.Target.LifecycleGeneration,
			oauthpb.OAuthAttemptState_OAUTH_ATTEMPT_STATE_AWAITING_PROVIDER,
			windowStart,
			windowEnd,
		).
		Update("expires_at", expiredAt)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, fmt.Errorf("%w: exact awaiting OAuth attempt was not updated", ErrAcceptancePrecondition)
	}
	attempt.ExpiresAt = expiredAt
	if err := tx.Table(a.leaseTable).
		Where("resource_key = ? AND holder_run_id = ? AND fence_token = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken).
		Updates(map[string]any{"state": acceptanceLeaseStateUsed, "updated_at": a.now()}).Error; err != nil {
		return nil, err
	}
	lease.State = acceptanceLeaseStateUsed
	return newOperationReceipt(request, before, operationState(access, attempt)), nil
}

func (a *AcceptanceAdapter) cleanupRun(
	tx *gorm.DB,
	request AcceptanceOperationRequest,
	lease *acceptanceLeaseRecord,
) (*AcceptanceOperationReceipt, error) {
	if err := tx.Table(a.leaseTable).
		Where("resource_key = ? AND holder_run_id = ? AND fence_token = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken).
		Updates(map[string]any{"state": acceptanceLeaseStateCleaning, "updated_at": a.now()}).Error; err != nil {
		return nil, err
	}

	targets, err := a.journalTargets(tx, lease)
	if err != nil {
		return nil, err
	}
	targets = uniqueTargets(targets)
	if len(targets) > 0 && !containsTarget(targets, request.Target) {
		return nil, fmt.Errorf("%w: cleanup target was not journaled by this lease", ErrAcceptanceCleanupConflict)
	}
	before := map[string]any{"trackedTargets": len(targets), "policyInstalled": len(lease.InstalledPolicyJSON) > 2}

	for _, target := range targets {
		if err := a.deleteExactTarget(tx, lease, target); err != nil {
			return nil, err
		}
	}
	if err := a.restorePolicy(tx, lease); err != nil {
		return nil, err
	}
	var inviteIDs []string
	if err := json.Unmarshal(lease.InviteCodeIDsJSON, &inviteIDs); err != nil {
		return nil, fmt.Errorf("decode run-owned invite IDs: %w", err)
	}
	if len(inviteIDs) > 0 {
		result := tx.Where(
			"id IN ? AND created_by = ?",
			inviteIDs,
			"mobile-oauth-acceptance:"+lease.HolderRunID,
		).Delete(&dbmodel.AccessInviteCode{})
		if result.Error != nil {
			return nil, result.Error
		}
		if result.RowsAffected != int64(len(inviteIDs)) {
			return nil, fmt.Errorf("%w: not every run-owned invite code was removed", ErrAcceptanceCleanupConflict)
		}
	}

	if err := tx.Table(a.journalTable).
		Where("resource_key = ? AND holder_run_id = ? AND fence_token = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken).
		Update("residue", false).Error; err != nil {
		return nil, err
	}
	result := tx.Table(a.leaseTable).
		Where("resource_key = ? AND holder_run_id = ? AND fence_token = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken).
		Updates(map[string]any{
			"state":                acceptanceLeaseStateReleased,
			"quarantine_reason":    "",
			"invite_code_ids_json": []byte(`[]`),
			"updated_at":           a.now(),
		})
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected != 1 {
		return nil, ErrAcceptanceStaleFence
	}
	lease.State = acceptanceLeaseStateReleased
	return newOperationReceipt(request, before, map[string]any{
		"trackedTargets":        0,
		"policyRestored":        true,
		"runOwnedInviteCodes":   0,
		"mutableJournalEntries": 0,
	}), nil
}

func (a *AcceptanceAdapter) deleteExactTarget(
	tx *gorm.DB,
	lease *acceptanceLeaseRecord,
	target AcceptanceOperationTarget,
) error {
	var attempt dbmodel.OAuthAttempt
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", target.OAuthAttemptRef).
		First(&attempt).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		var accessCount int64
		if err := tx.Model(&dbmodel.AccessAttempt{}).Where("id = ?", target.AccessAttemptRef).Count(&accessCount).Error; err != nil {
			return err
		}
		if accessCount == 0 {
			return nil
		}
		return fmt.Errorf("%w: access attempt remains without its tracked OAuth attempt", ErrAcceptanceCleanupConflict)
	}
	if err != nil {
		return err
	}
	if err := validateTargetBinding(&attempt, target, lease); err != nil {
		return err
	}

	var access dbmodel.AccessAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", target.AccessAttemptRef).
		First(&access).Error; err != nil {
		return fmt.Errorf("%w: cleanup Access attempt unavailable: %v", ErrAcceptanceCleanupConflict, err)
	}
	if access.StationPeerID != lease.StationPeerID || access.DeviceID != target.DeviceAlias {
		return fmt.Errorf("%w: cleanup Access attempt binding mismatch", ErrAcceptanceCleanupConflict)
	}
	if err := validateTargetCreationTime("Access attempt", access.CreatedAt, lease); err != nil {
		return err
	}

	var candidates []dbmodel.OAuthSessionCandidate
	if err := tx.Where(&dbmodel.OAuthSessionCandidate{OAuthAttemptID: attempt.ID}).
		Find(&candidates).Error; err != nil {
		return err
	}
	candidateIDs := make([]string, 0, len(candidates))
	for i := range candidates {
		candidate := &candidates[i]
		if candidate.AccessAttemptID != target.AccessAttemptRef ||
			candidate.StationPeerID != lease.StationPeerID ||
			candidate.DeviceID != target.DeviceAlias ||
			candidate.LifecycleGeneration != target.LifecycleGeneration {
			return fmt.Errorf("%w: candidate binding differs from cleanup target", ErrAcceptanceCleanupConflict)
		}
		candidateIDs = append(candidateIDs, candidate.ID)
	}
	if len(candidateIDs) > 0 {
		if err := tx.Where("candidate_id IN ?", candidateIDs).Delete(&dbmodel.OAuthCredentialEnvelope{}).Error; err != nil {
			return err
		}
		if err := tx.Where("oauth_candidate_id IN ?", candidateIDs).Delete(&session.SessionRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("id IN ?", candidateIDs).Delete(&dbmodel.OAuthSessionCandidate{}).Error; err != nil {
			return err
		}
	}
	windowStart, windowEnd, err := acceptanceTargetCreationWindow(lease)
	if err != nil {
		return err
	}
	oauthDelete := tx.Where(
		"id = ? AND created_at >= ? AND created_at <= ?",
		attempt.ID,
		windowStart,
		windowEnd,
	).Delete(&dbmodel.OAuthAttempt{})
	if oauthDelete.Error != nil {
		return oauthDelete.Error
	}
	if oauthDelete.RowsAffected != 1 {
		return fmt.Errorf("%w: run-owned OAuth attempt was not removed", ErrAcceptanceCleanupConflict)
	}
	accessDelete := tx.Where(
		"id = ? AND station_peer_id = ? AND device_id = ? AND created_at >= ? AND created_at <= ?",
		target.AccessAttemptRef,
		lease.StationPeerID,
		target.DeviceAlias,
		windowStart,
		windowEnd,
	).Delete(&dbmodel.AccessAttempt{})
	if accessDelete.Error != nil {
		return accessDelete.Error
	}
	if accessDelete.RowsAffected != 1 {
		return fmt.Errorf("%w: run-owned Access attempt was not removed", ErrAcceptanceCleanupConflict)
	}
	return nil
}

func (a *AcceptanceAdapter) restorePolicy(tx *gorm.DB, lease *acceptanceLeaseRecord) error {
	if len(lease.InstalledPolicyJSON) <= 2 {
		return nil
	}
	var installed policySnapshot
	if err := json.Unmarshal(lease.InstalledPolicyJSON, &installed); err != nil {
		return fmt.Errorf("decode installed Access policy snapshot: %w", err)
	}
	var current dbmodel.AccessPolicy
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, installed.ID).Error; err != nil {
		return fmt.Errorf("%w: installed Access policy is unavailable: %v", ErrAcceptanceCleanupConflict, err)
	}
	currentJSON, currentDigest, err := encodePolicySnapshot(&current)
	if err != nil {
		return err
	}
	if currentDigest != lease.InstalledPolicyDigest || !hmac.Equal(currentJSON, lease.InstalledPolicyJSON) {
		return fmt.Errorf("%w: Access policy revision changed after fixture prepare", ErrAcceptanceCleanupConflict)
	}

	var baseline policySnapshot
	if err := json.Unmarshal(lease.PolicyBaselineJSON, &baseline); err != nil {
		return fmt.Errorf("decode baseline Access policy snapshot: %w", err)
	}
	if !baseline.Present {
		return tx.Delete(&dbmodel.AccessPolicy{}, installed.ID).Error
	}
	updates := map[string]any{
		"mode":                baseline.Mode,
		"allowed_emails":      baseline.AllowedEmails,
		"allowed_usernames":   baseline.AllowedUsernames,
		"allowed_actor_ptids": baseline.AllowedActorPTIDs,
		"enabled_gates":       baseline.EnabledGates,
		"self_service_invite": baseline.SelfServiceInvite,
		"updated_by":          baseline.UpdatedBy,
		"created_at":          baseline.CreatedAt,
		"updated_at":          baseline.UpdatedAt,
	}
	result := tx.Model(&dbmodel.AccessPolicy{}).
		Where("id = ? AND updated_at = ?", installed.ID, installed.UpdatedAt).
		UpdateColumns(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return fmt.Errorf("%w: Access policy revision changed during restore", ErrAcceptanceCleanupConflict)
	}
	return nil
}

func (a *AcceptanceAdapter) readSnapshot(
	tx *gorm.DB,
	request StationOAuthProofRequest,
	lease *acceptanceLeaseRecord,
	startedAt time.Time,
) (*StationOAuthProofSnapshot, error) {
	snapshotID, err := a.transactionSnapshot(tx)
	if err != nil {
		return nil, err
	}
	now := a.now()
	snapshot := &StationOAuthProofSnapshot{
		ArtifactKind:  "station-oauth-proof-snapshot",
		RunID:         request.Lease.HolderRunID,
		GateID:        MobileOAuthAcceptanceGateID,
		VariantID:     request.VariantID,
		FixtureID:     MobileOAuthAcceptanceFixtureID,
		SnapshotPhase: request.SnapshotPhase,
		ObservedAt:    now,
		Observation: StationOAuthProofObservation{
			Isolation:           "postgresql-repeatable-read-read-only",
			TransactionSnapshot: snapshotID,
			StartedAt:           startedAt,
			CompletedAt:         now,
			FreshnessSeconds:    int64(now.Sub(startedAt).Seconds()),
		},
		Service: StationOAuthProofService{
			ServiceID:             a.deployment.ServiceID,
			StationPeerID:         a.deployment.StationPeerID,
			DeploymentEnvironment: a.deployment.DeploymentEnvironment,
			LiveCommit:            a.deployment.LiveCommit,
			WorkspaceDigest:       a.deployment.WorkspaceDigest,
			ProtocolDigest:        a.deployment.ProtocolDigest,
			Attestation:           a.deployment.ServiceAttestation,
		},
		Binding: StationOAuthProofBinding{
			AccessAttemptRef:    request.Target.AccessAttemptRef,
			OAuthAttemptRef:     request.Target.OAuthAttemptRef,
			ExpectedProvider:    request.ExpectedProvider,
			GateID:              "auth.login",
			DeviceAlias:         request.Target.DeviceAlias,
			LifecycleGeneration: request.Target.LifecycleGeneration,
		},
		Access: StationOAuthProofAccess{Status: "absent", CurrentGateID: "none"},
		OAuth: StationOAuthProofOAuth{
			State:           "ABSENT",
			Result:          "ABSENT",
			UpdatedAt:       now,
			ExpiresRelation: "past",
		},
		Candidate: StationOAuthProofCandidate{},
		ProviderBinding: StationOAuthProofProviderBinding{
			Provider: request.ExpectedProvider,
		},
		Fixture: StationOAuthProofFixture{
			OperationID:          request.OperationID,
			JournalState:         acceptanceJournalStateCommitted,
			PolicyBaselineDigest: digestWithPrefix(lease.PolicyBaselineDigest),
			PolicyObservedDigest: digestWithPrefix(lease.PolicyBaselineDigest),
		},
	}
	snapshot.Redaction.Status = "passed"

	var access dbmodel.AccessAttempt
	accessErr := tx.Where("id = ?", request.Target.AccessAttemptRef).First(&access).Error
	if accessErr == nil {
		if access.StationPeerID != a.deployment.StationPeerID || access.DeviceID != request.Target.DeviceAlias {
			return nil, fmt.Errorf("%w: Access attempt proof binding mismatch", ErrAcceptancePrecondition)
		}
		if err := validateTargetCreationTime("Access attempt", access.CreatedAt, lease); err != nil {
			return nil, err
		}
		snapshot.Access = StationOAuthProofAccess{
			Status:           access.Status,
			CurrentGateID:    valueOrNone(access.CurrentGateID),
			DecisionRevision: access.DecisionRevision,
		}
		snapshot.RunOwnedResidue.AccessAttempts = 1
	} else if !errors.Is(accessErr, gorm.ErrRecordNotFound) {
		return nil, accessErr
	}

	var attempt dbmodel.OAuthAttempt
	oauthErr := tx.Where("id = ?", request.Target.OAuthAttemptRef).First(&attempt).Error
	if oauthErr == nil {
		if err := validateTargetBinding(&attempt, request.Target, lease); err != nil {
			return nil, err
		}
		if attempt.Provider != request.ExpectedProvider {
			return nil, fmt.Errorf("%w: expected provider does not match OAuth attempt", ErrAcceptancePrecondition)
		}
		snapshot.OAuth = StationOAuthProofOAuth{
			State:             oauthpb.OAuthAttemptState(attempt.State).String(),
			Result:            oauthpb.OAuthAttemptResult(attempt.Result).String(),
			ErrorCode:         attempt.ErrorCode,
			UpdatedAt:         attempt.UpdatedAt,
			ExpiresRelation:   expiryRelation(attempt.ExpiresAt, now),
			ClaimedAtPresent:  attempt.ClaimedAt != nil,
			ConsumedAtPresent: attempt.ConsumedAt != nil,
		}
		snapshot.RunOwnedResidue.OAuthAttempts = 1
	} else if !errors.Is(oauthErr, gorm.ErrRecordNotFound) {
		return nil, oauthErr
	}

	var candidates []dbmodel.OAuthSessionCandidate
	if err := tx.Where(&dbmodel.OAuthSessionCandidate{OAuthAttemptID: request.Target.OAuthAttemptRef}).
		Find(&candidates).Error; err != nil {
		return nil, err
	}
	snapshot.Candidate.Count = int64(len(candidates))
	snapshot.RunOwnedResidue.Candidates = int64(len(candidates))
	candidateIDs := make([]string, 0, len(candidates))
	if len(candidates) == 1 {
		candidate := candidates[0]
		snapshot.Candidate.State = candidate.State
		snapshot.Candidate.ActorPTID = candidate.ActorPTID
		snapshot.Candidate.SessionRefPresent = candidate.SessionID != ""
		candidateIDs = append(candidateIDs, candidate.ID)

		var bindings []dbmodel.OAuth2IdentityBinding
		if err := tx.Where("actor_id = ? AND provider_id = ?", candidate.ActorID, request.ExpectedProvider).
			Find(&bindings).Error; err != nil {
			return nil, err
		}
		snapshot.ProviderBinding.BindingCount = int64(len(bindings))
		if len(bindings) == 1 {
			snapshot.ProviderBinding.CandidateCorrelationPresent = true
			snapshot.ProviderBinding.ProviderSubjectFingerprint = providerFingerprint(
				request.ProviderCorrelationKey,
				request.ExpectedProvider,
				bindings[0].ProviderUserID,
			)
		}
	}

	if len(candidateIDs) > 0 {
		if err := tx.Model(&dbmodel.OAuthCredentialEnvelope{}).
			Where("candidate_id IN ?", candidateIDs).
			Count(&snapshot.CredentialEnvelopeCount).Error; err != nil {
			return nil, err
		}
		var sessions []session.SessionRecord
		if err := tx.Where("oauth_candidate_id IN ?", candidateIDs).Find(&sessions).Error; err != nil {
			return nil, err
		}
		snapshot.Session.Count = int64(len(sessions))
		for i := range sessions {
			record := sessions[i]
			if record.Revoked {
				snapshot.Session.RevokedCount++
			} else if record.ExpiresAt.After(now) {
				snapshot.Session.ActiveCount++
			}
			if snapshot.Session.AuthMethod == "" {
				snapshot.Session.AuthMethod = record.AuthMethod
				snapshot.Session.DecisionRevision = record.AccessDecisionRevision
			}
		}
	}
	snapshot.RunOwnedResidue.CredentialEnvelopes = snapshot.CredentialEnvelopeCount
	snapshot.RunOwnedResidue.Sessions = snapshot.Session.Count

	var inviteIDs []string
	if err := json.Unmarshal(lease.InviteCodeIDsJSON, &inviteIDs); err != nil {
		return nil, err
	}
	if len(inviteIDs) > 0 {
		if err := tx.Model(&dbmodel.AccessInviteCode{}).
			Where("id IN ? AND created_by = ?", inviteIDs, "mobile-oauth-acceptance:"+lease.HolderRunID).
			Count(&snapshot.RunOwnedResidue.InviteCodes).Error; err != nil {
			return nil, err
		}
	}
	var mutableJournal int64
	if err := tx.Table(a.journalTable).
		Where("resource_key = ? AND holder_run_id = ? AND fence_token = ? AND residue = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken, true).
		Count(&mutableJournal).Error; err != nil {
		return nil, err
	}
	snapshot.RunOwnedResidue.FixtureJournalEntries = mutableJournal

	_, observedDigest, err := loadPolicySnapshot(tx, false)
	if err != nil {
		return nil, err
	}
	snapshot.Fixture.PolicyObservedDigest = digestWithPrefix(observedDigest)
	snapshot.Fixture.PolicyRestored = request.SnapshotPhase == "post_cleanup" &&
		observedDigest == lease.PolicyBaselineDigest
	if len(lease.InstalledPolicyJSON) > 2 && observedDigest == lease.InstalledPolicyDigest {
		snapshot.RunOwnedResidue.PolicyOverrides = 1
	}

	snapshot.Invariants = StationOAuthProofInvariants{
		SingleConsume:        snapshot.OAuth.ClaimedAtPresent == snapshot.OAuth.ConsumedAtPresent,
		SingleCandidate:      snapshot.Candidate.Count <= 1,
		NoEarlyActiveSession: snapshot.Session.ActiveCount == 0 || snapshot.Access.Status == "granted",
		NoUnexpectedEnvelope: snapshot.CredentialEnvelopeCount <= 1 &&
			(snapshot.Candidate.Count == 1 || snapshot.CredentialEnvelopeCount == 0),
	}
	if !snapshot.Invariants.SingleConsume ||
		!snapshot.Invariants.SingleCandidate ||
		!snapshot.Invariants.NoEarlyActiveSession ||
		!snapshot.Invariants.NoUnexpectedEnvelope {
		return nil, ErrAcceptanceInvariantViolated
	}
	if snapshot.Observation.FreshnessSeconds > 30 {
		return nil, fmt.Errorf("%w: Station snapshot exceeded 30-second budget", ErrAcceptancePrecondition)
	}
	if request.SnapshotPhase == "post_cleanup" {
		residue := snapshot.RunOwnedResidue
		if residue.AccessAttempts != 0 ||
			residue.OAuthAttempts != 0 ||
			residue.Candidates != 0 ||
			residue.CredentialEnvelopes != 0 ||
			residue.Sessions != 0 ||
			residue.InviteCodes != 0 ||
			residue.PolicyOverrides != 0 ||
			residue.FixtureJournalEntries != 0 ||
			!snapshot.Fixture.PolicyRestored {
			return nil, fmt.Errorf("%w: post-cleanup Station residue remains", ErrAcceptanceCleanupConflict)
		}
	}
	return snapshot, nil
}

func (a *AcceptanceAdapter) transactionSnapshot(tx *gorm.DB) (string, error) {
	if a.hooks.snapshotIdentifier != nil {
		return a.hooks.snapshotIdentifier(tx)
	}
	if tx.Dialector.Name() != "postgres" {
		return "", ErrAcceptanceUnsupportedStore
	}
	var snapshot string
	if err := tx.Raw("SELECT pg_current_snapshot()::text").Scan(&snapshot).Error; err != nil {
		return "", fmt.Errorf("read PostgreSQL transaction snapshot: %w", err)
	}
	if strings.TrimSpace(snapshot) == "" {
		return "", fmt.Errorf("read PostgreSQL transaction snapshot: empty snapshot identifier")
	}
	return snapshot, nil
}

func (a *AcceptanceAdapter) lockLease(
	tx *gorm.DB,
	identity AcceptanceLeaseIdentity,
	allowReleased bool,
) (*acceptanceLeaseRecord, error) {
	var lease acceptanceLeaseRecord
	if err := tx.Table(a.leaseTable).
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("resource_key = ?", identity.ResourceKey).
		First(&lease).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAcceptanceLeaseUnavailable
		}
		return nil, err
	}
	if lease.HolderRunID != identity.HolderRunID || lease.FenceToken != identity.FenceToken {
		return nil, ErrAcceptanceStaleFence
	}
	if lease.ServiceID != a.deployment.ServiceID || lease.StationPeerID != a.deployment.StationPeerID {
		return nil, ErrAcceptanceUnauthorized
	}
	if lease.State == acceptanceLeaseStateQuarantined {
		return nil, ErrAcceptanceLeaseUnavailable
	}
	if lease.State == acceptanceLeaseStateReleased {
		if allowReleased {
			return &lease, nil
		}
		return nil, ErrAcceptanceStaleFence
	}
	if !lease.ExpiresAt.After(a.now()) {
		return nil, ErrAcceptanceLeaseUnavailable
	}
	return &lease, nil
}

func (a *AcceptanceAdapter) readLease(
	tx *gorm.DB,
	identity AcceptanceLeaseIdentity,
	allowReleased bool,
) (*acceptanceLeaseRecord, error) {
	var lease acceptanceLeaseRecord
	if err := tx.Table(a.leaseTable).
		Where("resource_key = ?", identity.ResourceKey).
		First(&lease).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrAcceptanceLeaseUnavailable
		}
		return nil, err
	}
	if lease.HolderRunID != identity.HolderRunID || lease.FenceToken != identity.FenceToken {
		return nil, ErrAcceptanceStaleFence
	}
	if lease.ServiceID != a.deployment.ServiceID || lease.StationPeerID != a.deployment.StationPeerID {
		return nil, ErrAcceptanceUnauthorized
	}
	if lease.State == acceptanceLeaseStateQuarantined {
		return nil, ErrAcceptanceLeaseUnavailable
	}
	if lease.State == acceptanceLeaseStateReleased {
		if allowReleased {
			return &lease, nil
		}
		return nil, ErrAcceptanceStaleFence
	}
	if !lease.ExpiresAt.After(a.now()) {
		return nil, ErrAcceptanceLeaseUnavailable
	}
	return &lease, nil
}

func (a *AcceptanceAdapter) quarantineExpiredLease(
	ctx context.Context,
	identity AcceptanceLeaseIdentity,
	allowReleased bool,
) error {
	var (
		expired     bool
		unavailable bool
	)
	err := a.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lease acceptanceLeaseRecord
		if err := tx.Table(a.leaseTable).
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("resource_key = ?", identity.ResourceKey).
			First(&lease).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				unavailable = true
				return nil
			}
			return err
		}
		if lease.HolderRunID != identity.HolderRunID || lease.FenceToken != identity.FenceToken {
			return ErrAcceptanceStaleFence
		}
		if lease.State == acceptanceLeaseStateReleased {
			if allowReleased {
				return nil
			}
			return ErrAcceptanceStaleFence
		}
		if lease.State == acceptanceLeaseStateQuarantined {
			unavailable = true
			return nil
		}
		if lease.ExpiresAt.After(a.now()) {
			return nil
		}
		expired = true
		return tx.Table(a.leaseTable).
			Where("resource_key = ? AND holder_run_id = ? AND fence_token = ?", lease.ResourceKey, lease.HolderRunID, lease.FenceToken).
			Updates(map[string]any{
				"state":             acceptanceLeaseStateQuarantined,
				"quarantine_reason": "lease expired before verified cleanup",
				"updated_at":        a.now(),
			}).Error
	})
	if err != nil {
		return err
	}
	if expired || unavailable {
		return ErrAcceptanceLeaseUnavailable
	}
	return nil
}

func (a *AcceptanceAdapter) recoverOperationWithDB(
	database *gorm.DB,
	request AcceptanceOperationRequest,
	digest string,
) (*AcceptanceOperationReceipt, error) {
	if strings.TrimSpace(request.OperationID) == "" {
		return nil, fmt.Errorf("%w: operationId is required", ErrAcceptancePrecondition)
	}
	var journal acceptanceJournalRecord
	err := database.Table(a.journalTable).
		Where(
			"operation_id = ? AND resource_key = ? AND holder_run_id = ? AND fence_token = ? AND input_digest = ? AND state = ?",
			request.OperationID,
			request.Lease.ResourceKey,
			request.Lease.HolderRunID,
			request.Lease.FenceToken,
			digest,
			acceptanceJournalStateCommitted,
		).
		First(&journal).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		var operationIDCount int64
		if countErr := database.Table(a.journalTable).
			Where("operation_id = ?", request.OperationID).
			Count(&operationIDCount).Error; countErr != nil {
			return nil, countErr
		}
		if operationIDCount != 0 {
			return nil, fmt.Errorf("%w: operationId was already committed with different lease identity or input", ErrAcceptanceConflict)
		}
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var receipt AcceptanceOperationReceipt
	if err := json.Unmarshal(journal.ResultJSON, &receipt); err != nil {
		return nil, fmt.Errorf("decode committed mobile OAuth Acceptance result: %w", err)
	}
	if receipt.OperationID != request.OperationID ||
		receipt.InputDigest != digest ||
		receipt.ResourceKey != request.Lease.ResourceKey ||
		receipt.HolderRunID != request.Lease.HolderRunID ||
		receipt.FenceToken != request.Lease.FenceToken ||
		receipt.RunID != request.Lease.HolderRunID ||
		receipt.GateID != MobileOAuthAcceptanceGateID ||
		receipt.VariantID != request.VariantID ||
		receipt.Operation != request.Operation ||
		receipt.Target != request.Target ||
		receipt.OAuthState != request.OAuthState ||
		receipt.JournalState != acceptanceJournalStateCommitted {
		return nil, fmt.Errorf("%w: committed result identity does not match its journal", ErrAcceptanceConflict)
	}
	return &receipt, nil
}

func (a *AcceptanceAdapter) persistJournal(
	tx *gorm.DB,
	request AcceptanceOperationRequest,
	receipt *AcceptanceOperationReceipt,
	residue bool,
) error {
	targetJSON, err := json.Marshal(request.Target)
	if err != nil {
		return fmt.Errorf("encode mobile OAuth Acceptance operation target: %w", err)
	}
	resultJSON, err := json.Marshal(receipt)
	if err != nil {
		return fmt.Errorf("encode mobile OAuth Acceptance operation result: %w", err)
	}
	now := a.now()
	journal := acceptanceJournalRecord{
		OperationID: request.OperationID,
		InputDigest: request.InputDigest,
		ResourceKey: request.Lease.ResourceKey,
		HolderRunID: request.Lease.HolderRunID,
		FenceToken:  request.Lease.FenceToken,
		VariantID:   request.VariantID,
		Operation:   request.Operation,
		TargetJSON:  targetJSON,
		ResultJSON:  resultJSON,
		State:       acceptanceJournalStateCommitted,
		Residue:     residue,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if err := tx.Table(a.journalTable).Create(&journal).Error; err != nil {
		return fmt.Errorf("commit mobile OAuth Acceptance operation journal: %w", err)
	}
	return nil
}

func (a *AcceptanceAdapter) journalTargets(
	tx *gorm.DB,
	lease *acceptanceLeaseRecord,
) ([]AcceptanceOperationTarget, error) {
	var rows []acceptanceJournalRecord
	if err := tx.Table(a.journalTable).
		Where(
			"resource_key = ? AND holder_run_id = ? AND fence_token = ? AND residue = ?",
			lease.ResourceKey,
			lease.HolderRunID,
			lease.FenceToken,
			true,
		).
		Find(&rows).Error; err != nil {
		return nil, err
	}
	targets := make([]AcceptanceOperationTarget, 0, len(rows))
	for i := range rows {
		var target AcceptanceOperationTarget
		if err := json.Unmarshal(rows[i].TargetJSON, &target); err != nil {
			return nil, fmt.Errorf("decode journal target operation_id=%s: %w", rows[i].OperationID, err)
		}
		targets = append(targets, target)
	}
	return targets, nil
}

func (a *AcceptanceAdapter) leasePayload(record acceptanceLeaseRecord) *MobileOAuthFixtureLease {
	payload := &MobileOAuthFixtureLease{
		ArtifactKind:       "mobile-oauth-fixture-lease",
		FixtureID:          MobileOAuthAcceptanceFixtureID,
		ResourceKey:        record.ResourceKey,
		HolderRunID:        record.HolderRunID,
		FenceToken:         record.FenceToken,
		RunID:              record.HolderRunID,
		GateID:             record.GateID,
		ServiceID:          record.ServiceID,
		StationPeerID:      record.StationPeerID,
		ServiceAttestation: a.deployment.ServiceAttestation,
		AllowedOperations:  append([]string(nil), acceptanceAllowedOperations...),
		State:              record.State,
		HeartbeatAt:        record.HeartbeatAt,
		RenewBefore:        record.RenewBefore,
		ExpiresAt:          record.ExpiresAt,
		QuarantineReason:   record.QuarantineReason,
		CleanupRegistered:  true,
	}
	payload.Authorization.DestructiveResetApproved = a.deployment.DestructiveResetApproved
	payload.Authorization.DeploymentLeaseMatched = a.deployment.DeploymentLeaseMatched
	payload.Authorization.DisposableTargetVerified = a.deployment.DisposableTargetVerified
	return payload
}

func (a *AcceptanceAdapter) validateDeployment() error {
	return validateAcceptanceDeployment(a.deployment)
}

func validateAcceptanceDeployment(deployment AcceptanceDeployment) error {
	if deployment.ServiceID != "station-primary" && deployment.ServiceID != "station-secondary" {
		return fmt.Errorf("%w: serviceId is not an approved Mobile Station role", ErrAcceptanceUnauthorized)
	}
	if strings.TrimSpace(deployment.StationPeerID) == "" ||
		strings.TrimSpace(deployment.DeploymentEnvironment) == "" ||
		strings.TrimSpace(deployment.LiveCommit) == "" ||
		strings.TrimSpace(deployment.WorkspaceDigest) == "" ||
		strings.TrimSpace(deployment.ProtocolDigest) == "" {
		return fmt.Errorf("%w: deployment identity is incomplete", ErrAcceptanceUnauthorized)
	}
	if !deployment.DeploymentLeaseMatched ||
		!deployment.DisposableTargetVerified ||
		!deployment.DestructiveResetApproved {
		return fmt.Errorf("%w: deployment authorization is incomplete", ErrAcceptanceUnauthorized)
	}
	ref := deployment.ServiceAttestation
	if ref.ArtifactKind != "acceptance-artifact-ref" ||
		ref.GateID != MobileOAuthAcceptanceGateID ||
		strings.TrimSpace(ref.RunID) == "" ||
		strings.TrimSpace(ref.WorkspaceID) == "" ||
		strings.TrimSpace(ref.Path) == "" ||
		strings.TrimSpace(ref.SHA256) == "" {
		return fmt.Errorf("%w: service attestation reference is invalid", ErrAcceptanceUnauthorized)
	}
	return nil
}

func validateLeaseRequest(deployment AcceptanceDeployment, request AcceptanceLeaseRequest) error {
	expectedResource := "station/" + deployment.ServiceID + "/mobile-oauth-fixture"
	if request.GateID != MobileOAuthAcceptanceGateID ||
		strings.TrimSpace(request.RunID) == "" ||
		request.ResourceKey != expectedResource ||
		deployment.ServiceAttestation.RunID != request.RunID {
		return fmt.Errorf("%w: fixture lease identity does not match deployment", ErrAcceptanceUnauthorized)
	}
	if request.HeartbeatAt.IsZero() ||
		!request.RenewBefore.After(request.HeartbeatAt) ||
		!request.ExpiresAt.After(request.RenewBefore) {
		return fmt.Errorf("%w: invalid fixture lease time window", ErrAcceptancePrecondition)
	}
	runStartedAt, err := acceptanceRunStartedAt(request.RunID)
	if err != nil {
		return err
	}
	if request.HeartbeatAt.Before(runStartedAt) || !request.ExpiresAt.After(runStartedAt) {
		return fmt.Errorf("%w: fixture lease window does not contain its run", ErrAcceptancePrecondition)
	}
	return nil
}

func validateOperationRequest(
	deployment AcceptanceDeployment,
	request AcceptanceOperationRequest,
	lease *acceptanceLeaseRecord,
) error {
	if strings.TrimSpace(request.OperationID) == "" ||
		strings.TrimSpace(request.VariantID) == "" ||
		strings.TrimSpace(request.OAuthState) == "" {
		return fmt.Errorf("%w: operation identity/precondition is incomplete", ErrAcceptancePrecondition)
	}
	if request.Target.ServiceID != deployment.ServiceID ||
		request.Lease.ResourceKey != "station/"+deployment.ServiceID+"/mobile-oauth-fixture" ||
		request.Target.OAuthAttemptRef == "" ||
		request.Target.AccessAttemptRef == "" ||
		request.Target.DeviceAlias == "" ||
		request.Target.LifecycleGeneration == 0 {
		return fmt.Errorf("%w: operation target does not match deployment", ErrAcceptanceUnauthorized)
	}
	if lease.GateID != MobileOAuthAcceptanceGateID {
		return fmt.Errorf("%w: fixture lease Gate is invalid", ErrAcceptanceUnauthorized)
	}
	return nil
}

func validateSnapshotRequest(
	deployment AcceptanceDeployment,
	request StationOAuthProofRequest,
) error {
	if request.OperationID == "" ||
		request.VariantID == "" ||
		(request.SnapshotPhase != "before" &&
			request.SnapshotPhase != "post_action" &&
			request.SnapshotPhase != "post_cleanup") {
		return fmt.Errorf("%w: Station snapshot identity is invalid", ErrAcceptancePrecondition)
	}
	if request.Target.ServiceID != deployment.ServiceID ||
		request.Lease.ResourceKey != "station/"+deployment.ServiceID+"/mobile-oauth-fixture" ||
		request.Target.OAuthAttemptRef == "" ||
		request.Target.AccessAttemptRef == "" ||
		request.Target.DeviceAlias == "" ||
		request.Target.LifecycleGeneration == 0 {
		return fmt.Errorf("%w: Station snapshot target does not match deployment", ErrAcceptanceUnauthorized)
	}
	if request.ExpectedProvider != "github" && request.ExpectedProvider != "google" {
		return fmt.Errorf("%w: Station snapshot provider is invalid", ErrAcceptancePrecondition)
	}
	if request.SnapshotPhase != "post_cleanup" && len(request.ProviderCorrelationKey) < 32 {
		return fmt.Errorf("%w: provider correlation key is unavailable", ErrAcceptanceUnauthorized)
	}
	return nil
}

func lockAndValidateTarget(
	tx *gorm.DB,
	request AcceptanceOperationRequest,
	lease *acceptanceLeaseRecord,
) (*dbmodel.OAuthAttempt, *dbmodel.AccessAttempt, error) {
	var attempt dbmodel.OAuthAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", request.Target.OAuthAttemptRef).
		First(&attempt).Error; err != nil {
		return nil, nil, fmt.Errorf("%w: OAuth attempt unavailable: %v", ErrAcceptancePrecondition, err)
	}
	if err := validateTargetBinding(&attempt, request.Target, lease); err != nil {
		return nil, nil, err
	}
	if oauthpb.OAuthAttemptState(attempt.State).String() != request.OAuthState {
		return nil, nil, fmt.Errorf("%w: OAuth state does not match declared precondition", ErrAcceptancePrecondition)
	}
	var access dbmodel.AccessAttempt
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("id = ?", request.Target.AccessAttemptRef).
		First(&access).Error; err != nil {
		return nil, nil, fmt.Errorf("%w: Access attempt unavailable: %v", ErrAcceptancePrecondition, err)
	}
	if access.StationPeerID != lease.StationPeerID || access.DeviceID != request.Target.DeviceAlias {
		return nil, nil, fmt.Errorf("%w: Access attempt binding mismatch", ErrAcceptancePrecondition)
	}
	if err := validateTargetCreationTime("Access attempt", access.CreatedAt, lease); err != nil {
		return nil, nil, err
	}
	return &attempt, &access, nil
}

func validateTargetBinding(
	attempt *dbmodel.OAuthAttempt,
	target AcceptanceOperationTarget,
	lease *acceptanceLeaseRecord,
) error {
	if attempt.AccessAttemptID != target.AccessAttemptRef ||
		attempt.StationPeerID != lease.StationPeerID ||
		attempt.DeviceID != target.DeviceAlias ||
		attempt.LifecycleGeneration != target.LifecycleGeneration {
		return fmt.Errorf("%w: OAuth attempt binding mismatch", ErrAcceptancePrecondition)
	}
	return validateTargetCreationTime("OAuth attempt", attempt.CreatedAt, lease)
}

func validateTargetCreationTime(
	targetName string,
	createdAt time.Time,
	lease *acceptanceLeaseRecord,
) error {
	windowStart, windowEnd, err := acceptanceTargetCreationWindow(lease)
	if err != nil {
		return err
	}
	createdAt = createdAt.UTC()
	if createdAt.IsZero() ||
		createdAt.Before(windowStart) ||
		createdAt.After(windowEnd) {
		return fmt.Errorf(
			"%w: %s creation time is outside the accepted run lease window",
			ErrAcceptancePrecondition,
			targetName,
		)
	}
	return nil
}

func acceptanceTargetCreationWindow(lease *acceptanceLeaseRecord) (time.Time, time.Time, error) {
	runStartedAt, err := acceptanceRunStartedAt(lease.HolderRunID)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	windowStart := lease.CreatedAt.UTC()
	if runStartedAt.After(windowStart) {
		windowStart = runStartedAt
	}
	windowEnd := lease.ExpiresAt.UTC()
	if windowStart.IsZero() || windowEnd.IsZero() || windowEnd.Before(windowStart) {
		return time.Time{}, time.Time{}, fmt.Errorf(
			"%w: accepted run lease window is invalid",
			ErrAcceptancePrecondition,
		)
	}
	return windowStart, windowEnd, nil
}

func acceptanceRunStartedAt(runID string) (time.Time, error) {
	const (
		runTimestampLength = len("20060102T150405000000Z")
		runTimestampLayout = "20060102T150405000000Z"
		runRandomLength    = 32
	)
	if len(runID) != runTimestampLength+1+runRandomLength ||
		runID[runTimestampLength] != '-' {
		return time.Time{}, fmt.Errorf("%w: holder run ID has no accepted timestamp", ErrAcceptancePrecondition)
	}
	randomSuffix := runID[runTimestampLength+1:]
	if strings.ToLower(randomSuffix) != randomSuffix {
		return time.Time{}, fmt.Errorf("%w: holder run ID random suffix is invalid", ErrAcceptancePrecondition)
	}
	if _, err := hex.DecodeString(randomSuffix); err != nil {
		return time.Time{}, fmt.Errorf("%w: holder run ID random suffix is invalid", ErrAcceptancePrecondition)
	}
	startedAt, err := time.Parse(runTimestampLayout, runID[:runTimestampLength])
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: holder run ID timestamp is invalid", ErrAcceptancePrecondition)
	}
	return startedAt.UTC(), nil
}

func operationInputDigest(request AcceptanceOperationRequest) (string, error) {
	inviteDigest := ""
	if request.InviteCode != "" {
		sum := sha256.Sum256([]byte(request.InviteCode))
		inviteDigest = hex.EncodeToString(sum[:])
	}
	input := struct {
		ResourceKey  string                    `json:"resourceKey"`
		HolderRunID  string                    `json:"holderRunId"`
		FenceToken   uint64                    `json:"fenceToken"`
		VariantID    string                    `json:"variantId"`
		Operation    string                    `json:"operation"`
		Target       AcceptanceOperationTarget `json:"target"`
		OAuthState   string                    `json:"oauthState"`
		InviteDigest string                    `json:"inviteDigest"`
	}{
		ResourceKey:  request.Lease.ResourceKey,
		HolderRunID:  request.Lease.HolderRunID,
		FenceToken:   request.Lease.FenceToken,
		VariantID:    request.VariantID,
		Operation:    request.Operation,
		Target:       request.Target,
		OAuthState:   request.OAuthState,
		InviteDigest: inviteDigest,
	}
	raw, err := json.Marshal(input)
	if err != nil {
		return "", fmt.Errorf("encode canonical mobile OAuth Acceptance operation input: %w", err)
	}
	sum := sha256.Sum256(raw)
	return "sha256:" + hex.EncodeToString(sum[:]), nil
}

func newOperationReceipt(
	request AcceptanceOperationRequest,
	before, after map[string]any,
) *AcceptanceOperationReceipt {
	return &AcceptanceOperationReceipt{
		OperationID:         request.OperationID,
		InputDigest:         request.InputDigest,
		ResourceKey:         request.Lease.ResourceKey,
		HolderRunID:         request.Lease.HolderRunID,
		FenceToken:          request.Lease.FenceToken,
		RunID:               request.Lease.HolderRunID,
		GateID:              MobileOAuthAcceptanceGateID,
		VariantID:           request.VariantID,
		Operation:           request.Operation,
		Target:              request.Target,
		OAuthState:          request.OAuthState,
		JournalState:        acceptanceJournalStateCommitted,
		PreconditionMatched: true,
		AffectedRows:        1,
		Before:              before,
		After:               after,
	}
}

func validateOperationArtifactRef(
	ref AcceptanceArtifactRef,
	runID, gateID string,
) error {
	if ref.ArtifactKind != "acceptance-artifact-ref" ||
		ref.RunID != runID ||
		ref.GateID != gateID ||
		strings.TrimSpace(ref.WorkspaceID) == "" ||
		strings.TrimSpace(ref.Path) == "" ||
		len(ref.SHA256) != sha256.Size*2 ||
		strings.TrimSpace(ref.MediaType) == "" {
		return errors.New("ArtifactRef identity is invalid")
	}
	if _, err := hex.DecodeString(ref.SHA256); err != nil {
		return errors.New("ArtifactRef SHA-256 is invalid")
	}
	return nil
}

func operationState(access *dbmodel.AccessAttempt, attempt *dbmodel.OAuthAttempt) map[string]any {
	return map[string]any{
		"accessStatus":     access.Status,
		"currentGateId":    access.CurrentGateID,
		"decisionRevision": access.DecisionRevision,
		"oauthState":       oauthpb.OAuthAttemptState(attempt.State).String(),
		"oauthResult":      oauthpb.OAuthAttemptResult(attempt.Result).String(),
		"expiresAt":        attempt.ExpiresAt.UTC(),
	}
}

func loadPolicySnapshot(tx *gorm.DB, lock bool) ([]byte, string, error) {
	query := tx
	if lock {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var policy dbmodel.AccessPolicy
	err := query.First(&policy).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		raw, marshalErr := json.Marshal(policySnapshot{Present: false})
		if marshalErr != nil {
			return nil, "", marshalErr
		}
		return raw, digestJSON(raw), nil
	}
	if err != nil {
		return nil, "", err
	}
	raw, digest, err := encodePolicySnapshot(&policy)
	return raw, digest, err
}

func encodePolicySnapshot(policy *dbmodel.AccessPolicy) ([]byte, string, error) {
	snapshot := policySnapshot{
		Present:           true,
		ID:                policy.ID,
		Mode:              policy.Mode,
		AllowedEmails:     policy.AllowedEmails,
		AllowedUsernames:  policy.AllowedUsernames,
		AllowedActorPTIDs: policy.AllowedActorPTIDs,
		EnabledGates:      policy.EnabledGates,
		SelfServiceInvite: policy.SelfServiceInvite,
		UpdatedBy:         policy.UpdatedBy,
		CreatedAt:         policy.CreatedAt.UTC(),
		UpdatedAt:         policy.UpdatedAt.UTC(),
	}
	raw, err := json.Marshal(snapshot)
	if err != nil {
		return nil, "", fmt.Errorf("encode Access policy snapshot: %w", err)
	}
	return raw, digestJSON(raw), nil
}

func digestJSON(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func digestWithPrefix(value string) string {
	if strings.HasPrefix(value, "sha256:") {
		return value
	}
	return "sha256:" + value
}

func appendJSONUniqueString(raw []byte, value string) ([]byte, error) {
	var values []string
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &values); err != nil {
			return nil, fmt.Errorf("decode string set: %w", err)
		}
	}
	for _, current := range values {
		if current == value {
			return raw, nil
		}
	}
	values = append(values, value)
	sort.Strings(values)
	return json.Marshal(values)
}

func uniqueTargets(values []AcceptanceOperationTarget) []AcceptanceOperationTarget {
	seen := make(map[string]AcceptanceOperationTarget)
	for _, value := range values {
		key := value.ServiceID + "\x00" + value.OAuthAttemptRef + "\x00" + value.AccessAttemptRef
		seen[key] = value
	}
	keys := make([]string, 0, len(seen))
	for key := range seen {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]AcceptanceOperationTarget, 0, len(keys))
	for _, key := range keys {
		out = append(out, seen[key])
	}
	return out
}

func containsTarget(values []AcceptanceOperationTarget, target AcceptanceOperationTarget) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func followingGateOrder() string {
	return fmt.Sprintf(
		"%d,%d,%d",
		accessgatepb.AccessGateType_ACCESS_GATE_TYPE_STATION_CAPABILITY,
		accessgatepb.AccessGateType_ACCESS_GATE_TYPE_AUTH_LOGIN,
		accessgatepb.AccessGateType_ACCESS_GATE_TYPE_INVITE_CODE,
	)
}

func providerFingerprint(key []byte, provider, providerUserID string) string {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(provider))
	_, _ = mac.Write([]byte{0})
	_, _ = mac.Write([]byte(providerUserID))
	return "sha256:" + hex.EncodeToString(mac.Sum(nil))
}

func expiryRelation(expiresAt, observedAt time.Time) string {
	if expiresAt.After(observedAt) {
		return "future"
	}
	return "past"
}

func valueOrNone(value string) string {
	if strings.TrimSpace(value) == "" {
		return "none"
	}
	return value
}
