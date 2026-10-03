package infrastructure

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	SecureContentResetSchemaVersion  = 1
	SecureContentResetPlanID         = "SECURE-CONTENT-HARD-CUT-20260913"
	CrossStationSocialResetPlanID    = "CROSS-STATION-SOCIAL-NATIVE-20261003"
	CrossStationSocialActivationTask = "CSS-08A-schema-activation"

	ResetIntentSchemaActivation ResetIntent = "SCHEMA_ACTIVATION"
	ResetIntentFinalCut         ResetIntent = "FINAL_CUT"

	ResetStatePrepared                ResetState = "PREPARED"
	ResetStateDatabaseSchemaCommitted ResetState = "DATABASE_SCHEMA_COMMITTED"
	ResetStateObjectsDeleted          ResetState = "OBJECTS_DELETED"
	ResetStateStationDeployed         ResetState = "STATION_DEPLOYED"
	ResetStatePostAuditPassed         ResetState = "POST_AUDIT_PASSED"
	ResetStateComplete                ResetState = "COMPLETE"
	ResetStateSuperseded              ResetState = "SUPERSEDED"
	ResetStateRecoveryReplaced        ResetState = "RECOVERY_REPLACED"

	ResetOperationClearTable                  ResetOperation = "CLEAR_TABLE"
	ResetOperationDeletePrivatePostClass      ResetOperation = "DELETE_WHERE_POST_CLASS_PRIVATE"
	ResetOperationDropRetiredTable            ResetOperation = "DROP_RETIRED_TABLE"
	ResetOperationRebuildCanonicalPrivatePost ResetOperation = "REBUILD_CANONICAL_PRIVATE_POST_TABLE"

	ResetObjectDomainSocial ResetObjectDomain = "social"
	ResetObjectDomainOSS    ResetObjectDomain = "oss"

	ResetReferenceCanonicalPrivate ResetReferenceClassification = "PRIVATE_EXCLUSIVE"
	ResetReferenceExclusiveLegacy  ResetReferenceClassification = "PRIVATE_EXCLUSIVE"
	ResetReferenceSharedCASSafe    ResetReferenceClassification = "SHARED_CAS_SAFE"

	ResetCodeInvalidInput             ResetCode = "RESET_INVALID_INPUT"
	ResetCodeUnauthorizedTarget       ResetCode = "RESET_TARGET_UNAUTHORIZED"
	ResetCodeInvocationExpired        ResetCode = "RESET_INVOCATION_EXPIRED"
	ResetCodeInvocationConflict       ResetCode = "RESET_INVOCATION_CONFLICT"
	ResetCodeManifestConflict         ResetCode = "RESET_MANIFEST_CONFLICT"
	ResetCodeSchemaTargetUnreviewed   ResetCode = "RESET_SCHEMA_TARGET_UNREVIEWED"
	ResetCodeForeignKeyUnreviewed     ResetCode = "RESET_FOREIGN_KEY_UNREVIEWED"
	ResetCodeObjectReferenceAmbiguous ResetCode = "RESET_OBJECT_REFERENCE_AMBIGUOUS"
	ResetCodeObjectDigestMismatch     ResetCode = "RESET_OBJECT_DIGEST_MISMATCH"
	ResetCodeJournalStateConflict     ResetCode = "RESET_JOURNAL_STATE_CONFLICT"
	ResetCodePublicSnapshotMismatch   ResetCode = "RESET_PUBLIC_SNAPSHOT_MISMATCH"
	ResetCodePartialFailure           ResetCode = "RESET_PARTIAL_FAILURE"
	ResetCodeSourceSuperseded         ResetCode = "RESET_SOURCE_SUPERSEDED"
)

const MaximumResetInvocationLifetime = time.Hour

var resetIdentifierPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)

// ResetIntent identifies one of the two SC-D24 reset purposes.
type ResetIntent string

// ResetState is the durable SC-D23 journal state.
type ResetState string

// ResetOperation is the closed SC-D23 database mutation vocabulary.
type ResetOperation string

// ResetObjectDomain identifies the domain that owns object deletion.
type ResetObjectDomain string

// ResetReferenceClassification describes why an object may be deleted.
type ResetReferenceClassification string

// ResetCode identifies a stable maintenance failure class.
type ResetCode string

// ResetError carries a stable failure code without weakening wrapped errors.
type ResetError struct {
	Code ResetCode
	Err  error
}

func (e *ResetError) Error() string {
	if e == nil || e.Err == nil {
		return string(e.Code)
	}

	return fmt.Sprintf("%s: %v", e.Code, e.Err)
}

func (e *ResetError) Unwrap() error {
	if e == nil {
		return nil
	}

	return e.Err
}

// ResetCodeOf returns the stable code for a reset error.
func ResetCodeOf(err error) ResetCode {
	var resetErr *ResetError
	if errors.As(err, &resetErr) {
		return resetErr.Code
	}

	return ResetCodePartialFailure
}

func resetError(code ResetCode, format string, arguments ...any) error {
	return &ResetError{
		Code: code,
		Err:  fmt.Errorf(format, arguments...),
	}
}

// ResetScopeIdentity binds a reset to one accepted profile and destructive scope.
type ResetScopeIdentity struct {
	SchemaVersion         int                         `json:"schema_version"`
	ResetID               string                      `json:"reset_id"`
	ResetIntent           ResetIntent                 `json:"reset_intent"`
	SourceCommit          string                      `json:"source_commit"`
	WorkspaceID           string                      `json:"workspace_id"`
	ProfileID             string                      `json:"profile_id"`
	DeploymentEnvironment string                      `json:"deployment_environment"`
	DestructiveScope      string                      `json:"destructive_scope"`
	RecoveryPredecessor   *ResetRecoveryPredecessorV1 `json:"-"`
	CreatedAt             time.Time                   `json:"created_at"`
}

// SecureContentResetAuditRequestV1 authenticates the read-only pre-audit.
type SecureContentResetAuditRequestV1 struct {
	SchemaVersion         int         `json:"schema_version"`
	RequestID             string      `json:"request_id"`
	ResetID               string      `json:"reset_id"`
	ResetIntent           ResetIntent `json:"reset_intent"`
	PlanID                string      `json:"plan_id"`
	TaskID                string      `json:"task_id"`
	DeclarationDigest     string      `json:"declaration_digest"`
	SourceCommit          string      `json:"source_commit"`
	WorkspaceID           string      `json:"workspace_id"`
	ProfileID             string      `json:"profile_id"`
	DeploymentEnvironment string      `json:"deployment_environment"`
	DestructiveScope      string      `json:"destructive_scope"`
	IssuedAt              time.Time   `json:"issued_at"`
	ExpiresAt             time.Time   `json:"expires_at"`
	RequestDigest         string      `json:"request_digest"`
	rawJSON               []byte
}

// UnmarshalJSON rejects aliases, duplicate keys, and missing fields.
func (r *SecureContentResetAuditRequestV1) UnmarshalJSON(data []byte) error {
	type wire SecureContentResetAuditRequestV1
	if err := requireExactJSONFields(data, []string{
		"schema_version",
		"request_id",
		"reset_id",
		"reset_intent",
		"plan_id",
		"task_id",
		"declaration_digest",
		"source_commit",
		"workspace_id",
		"profile_id",
		"deployment_environment",
		"destructive_scope",
		"issued_at",
		"expires_at",
		"request_digest",
	}); err != nil {
		return err
	}

	if err := json.Unmarshal(data, (*wire)(r)); err != nil {
		return err
	}
	r.rawJSON = append(r.rawJSON[:0], data...)

	return nil
}

// ScopeIdentity converts an authenticated audit request to manifest identity.
func (r SecureContentResetAuditRequestV1) ScopeIdentity() ResetScopeIdentity {
	return ResetScopeIdentity{
		SchemaVersion:         r.SchemaVersion,
		ResetID:               r.ResetID,
		ResetIntent:           r.ResetIntent,
		SourceCommit:          r.SourceCommit,
		WorkspaceID:           r.WorkspaceID,
		ProfileID:             r.ProfileID,
		DeploymentEnvironment: r.DeploymentEnvironment,
		DestructiveScope:      r.DestructiveScope,
		CreatedAt:             r.IssuedAt.UTC(),
	}
}

// CalculatedDigest returns the canonical SHA-256 for the audit request.
func (r SecureContentResetAuditRequestV1) CalculatedDigest() (string, error) {
	if len(r.rawJSON) > 0 {
		return canonicalSHA256WithoutFieldFromRaw(r.rawJSON, "request_digest")
	}
	return canonicalSHA256WithoutField(r, "request_digest")
}

// SecureContentResetInvocationV1 is the only destructive CLI input.
type SecureContentResetInvocationV1 struct {
	SchemaVersion         int         `json:"schema_version"`
	InvocationID          string      `json:"invocation_id"`
	ResetID               string      `json:"reset_id"`
	ResetIntent           ResetIntent `json:"reset_intent"`
	ResetManifestDigest   string      `json:"reset_manifest_digest"`
	PlanID                string      `json:"plan_id"`
	TaskID                string      `json:"task_id"`
	DeclarationDigest     string      `json:"declaration_digest"`
	SourceCommit          string      `json:"source_commit"`
	WorkspaceID           string      `json:"workspace_id"`
	ProfileID             string      `json:"profile_id"`
	DeploymentEnvironment string      `json:"deployment_environment"`
	DestructiveScope      string      `json:"destructive_scope"`
	IssuedAt              time.Time   `json:"issued_at"`
	ExpiresAt             time.Time   `json:"expires_at"`
	InvocationDigest      string      `json:"invocation_digest"`
	rawJSON               []byte
}

// UnmarshalJSON rejects aliases, duplicate keys, and missing fields.
func (i *SecureContentResetInvocationV1) UnmarshalJSON(data []byte) error {
	type wire SecureContentResetInvocationV1
	if err := requireExactJSONFields(data, []string{
		"schema_version",
		"invocation_id",
		"reset_id",
		"reset_intent",
		"reset_manifest_digest",
		"plan_id",
		"task_id",
		"declaration_digest",
		"source_commit",
		"workspace_id",
		"profile_id",
		"deployment_environment",
		"destructive_scope",
		"issued_at",
		"expires_at",
		"invocation_digest",
	}); err != nil {
		return err
	}

	if err := json.Unmarshal(data, (*wire)(i)); err != nil {
		return err
	}
	i.rawJSON = append(i.rawJSON[:0], data...)

	return nil
}

// ScopeIdentity converts an invocation to its immutable manifest identity.
func (i SecureContentResetInvocationV1) ScopeIdentity() ResetScopeIdentity {
	return ResetScopeIdentity{
		SchemaVersion:         i.SchemaVersion,
		ResetID:               i.ResetID,
		ResetIntent:           i.ResetIntent,
		SourceCommit:          i.SourceCommit,
		WorkspaceID:           i.WorkspaceID,
		ProfileID:             i.ProfileID,
		DeploymentEnvironment: i.DeploymentEnvironment,
		DestructiveScope:      i.DestructiveScope,
		CreatedAt:             i.IssuedAt.UTC(),
	}
}

// CalculatedDigest returns the canonical SHA-256 for the invocation.
func (i SecureContentResetInvocationV1) CalculatedDigest() (string, error) {
	if len(i.rawJSON) > 0 {
		return canonicalSHA256WithoutFieldFromRaw(
			i.rawJSON,
			"invocation_digest",
		)
	}
	return canonicalSHA256WithoutField(i, "invocation_digest")
}

// ResetInvocationBinding contains the OS-authenticated process expectations.
type ResetInvocationBinding struct {
	SourceCommit          string
	WorkspaceID           string
	ProfileID             string
	DeploymentEnvironment string
	DestructiveScope      string
	DeclarationDigest     string
}

// ValidateAuditRequest validates a pre-audit request. When rawRequest is
// non-nil, the digest is computed from the original wire bytes to avoid
// re-serialization format drift.
func ValidateAuditRequest(
	request SecureContentResetAuditRequestV1,
	binding ResetInvocationBinding,
	now time.Time,
	rawRequest []byte,
) error {
	if request.SchemaVersion != SecureContentResetSchemaVersion {
		return resetError(
			ResetCodeInvalidInput,
			"schema version %d is not supported",
			request.SchemaVersion,
		)
	}
	if err := validateResetIdentifiers(request.RequestID, request.ResetID); err != nil {
		return err
	}
	if err := validateControlBinding(
		request.ResetIntent,
		request.PlanID,
		request.TaskID,
		request.SourceCommit,
		request.WorkspaceID,
		request.ProfileID,
		request.DeploymentEnvironment,
		request.DestructiveScope,
		request.DeclarationDigest,
		binding,
	); err != nil {
		return err
	}
	if err := validateBoundedTimeWindow(request.IssuedAt, request.ExpiresAt, now); err != nil {
		return err
	}
	var calculated string
	var err error
	if len(rawRequest) > 0 {
		calculated, err = canonicalSHA256WithoutFieldFromRaw(rawRequest, "request_digest")
	} else {
		calculated, err = request.CalculatedDigest()
	}
	if err != nil {
		return resetError(ResetCodeInvalidInput, "calculate audit request digest: %v", err)
	}
	if !equalDigest(request.RequestDigest, calculated) {
		return resetError(
			ResetCodeInvalidInput,
			"audit request digest does not match: supplied=%s calculated=%s raw_len=%d",
			request.RequestDigest,
			calculated,
			len(rawRequest),
		)
	}

	return nil
}

// ValidateResetInvocation validates one destructive invocation. When
// rawInvocation is non-nil, the digest is computed from the original wire bytes.
func ValidateResetInvocation(
	invocation SecureContentResetInvocationV1,
	binding ResetInvocationBinding,
	now time.Time,
	rawInvocation []byte,
) error {
	if invocation.SchemaVersion != SecureContentResetSchemaVersion {
		return resetError(
			ResetCodeInvalidInput,
			"schema version %d is not supported",
			invocation.SchemaVersion,
		)
	}
	if err := validateResetIdentifiers(invocation.InvocationID, invocation.ResetID); err != nil {
		return err
	}
	if !isSHA256(invocation.ResetManifestDigest) {
		return resetError(ResetCodeInvalidInput, "reset manifest digest is invalid")
	}
	if err := validateControlBinding(
		invocation.ResetIntent,
		invocation.PlanID,
		invocation.TaskID,
		invocation.SourceCommit,
		invocation.WorkspaceID,
		invocation.ProfileID,
		invocation.DeploymentEnvironment,
		invocation.DestructiveScope,
		invocation.DeclarationDigest,
		binding,
	); err != nil {
		return err
	}
	if err := validateBoundedTimeWindow(
		invocation.IssuedAt,
		invocation.ExpiresAt,
		now,
	); err != nil {
		return err
	}
	var calculated string
	var err error
	if len(rawInvocation) > 0 {
		calculated, err = canonicalSHA256WithoutFieldFromRaw(rawInvocation, "invocation_digest")
	} else {
		calculated, err = invocation.CalculatedDigest()
	}
	if err != nil {
		return resetError(ResetCodeInvalidInput, "calculate invocation digest: %v", err)
	}
	if !equalDigest(invocation.InvocationDigest, calculated) {
		var canonicalPreview string
		if len(rawInvocation) > 0 {
			var content map[string]json.RawMessage
			if uerr := json.Unmarshal(rawInvocation, &content); uerr != nil {
				rawPrefix := rawInvocation
				if len(rawPrefix) > 200 {
					rawPrefix = rawPrefix[:200]
				}
				canonicalPreview = fmt.Sprintf("unmarshal_error=%v raw_len=%d raw_prefix=%s", uerr, len(rawInvocation), string(rawPrefix))
			} else {
				delete(content, "invocation_digest")
				if canonical, cerr := canonicalizeRawMap(content); cerr != nil {
					canonicalPreview = fmt.Sprintf("canonicalize_error=%v", cerr)
				} else {
					preview := string(canonical)
					if len(preview) > 800 {
						preview = preview[:800] + "..."
					}
					canonicalPreview = preview
				}
			}
		} else {
			canonicalPreview = "rawInvocation_empty"
		}
		return resetError(
			ResetCodeInvalidInput,
			"invocation digest does not match: supplied=%s calculated=%s canonical_preview=%s",
			invocation.InvocationDigest,
			calculated,
			canonicalPreview,
		)
	}

	return nil
}

func validateResetIdentifiers(values ...string) error {
	for _, value := range values {
		if !resetIdentifierPattern.MatchString(value) || strings.TrimSpace(value) != value {
			return resetError(
				ResetCodeInvalidInput,
				"reset identifier is empty, non-canonical, or too long",
			)
		}
	}

	return nil
}

func validateControlBinding(
	intent ResetIntent,
	planID string,
	taskID string,
	sourceCommit string,
	workspaceID string,
	profileID string,
	deploymentEnvironment string,
	destructiveScope string,
	declarationDigest string,
	binding ResetInvocationBinding,
) error {
	expectedTask, allowed := expectedResetTask(planID, intent, profileID)
	if !allowed || taskID != expectedTask {
		return resetError(
			ResetCodeUnauthorizedTarget,
			"reset intent, profile, and task are not an accepted combination",
		)
	}
	expectedEnvironment, expectedScope, allowed := expectedResetTarget(profileID)
	if !allowed ||
		deploymentEnvironment != expectedEnvironment ||
		destructiveScope != expectedScope {
		return resetError(
			ResetCodeUnauthorizedTarget,
			"profile, deployment environment, and destructive scope are not allowlisted",
		)
	}
	if !isGitCommit(sourceCommit) ||
		!isSHA256(declarationDigest) ||
		strings.TrimSpace(workspaceID) == "" {
		return resetError(ResetCodeInvalidInput, "control identity is incomplete")
	}
	if sourceCommit != binding.SourceCommit ||
		workspaceID != binding.WorkspaceID ||
		profileID != binding.ProfileID ||
		deploymentEnvironment != binding.DeploymentEnvironment ||
		destructiveScope != binding.DestructiveScope ||
		declarationDigest != binding.DeclarationDigest {
		return resetError(
			ResetCodeUnauthorizedTarget,
			"invocation does not match the authenticated process binding",
		)
	}

	return nil
}

func validateBoundedTimeWindow(issuedAt time.Time, expiresAt time.Time, now time.Time) error {
	if issuedAt.IsZero() || expiresAt.IsZero() || !expiresAt.After(issuedAt) {
		return resetError(ResetCodeInvalidInput, "invocation time window is invalid")
	}
	if expiresAt.Sub(issuedAt) > MaximumResetInvocationLifetime {
		return resetError(ResetCodeInvalidInput, "invocation lifetime exceeds the bound")
	}
	if now.Before(issuedAt.Add(-time.Minute)) {
		return resetError(ResetCodeInvalidInput, "invocation was issued in the future")
	}
	if !now.Before(expiresAt) {
		return resetError(ResetCodeInvocationExpired, "invocation has expired")
	}

	return nil
}

func expectedResetTask(
	planID string,
	intent ResetIntent,
	profileID string,
) (string, bool) {
	if profileID != "four" && profileID != "fiveArm" {
		return "", false
	}
	switch planID {
	case SecureContentResetPlanID:
		switch intent {
		case ResetIntentSchemaActivation:
			return "W12D", true
		case ResetIntentFinalCut:
			return "W12", true
		}
	case CrossStationSocialResetPlanID:
		if intent == ResetIntentSchemaActivation {
			return CrossStationSocialActivationTask, true
		}
	}

	return "", false
}

func expectedResetTarget(profileID string) (string, string, bool) {
	switch profileID {
	case "four":
		return "station-four", "station-four-social-private", true
	case "fiveArm":
		return "station-five-arm", "station-five-arm-social-private", true
	default:
		return "", "", false
	}
}

func isGitCommit(value string) bool {
	if len(value) != 40 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)

	return err == nil
}

func isSHA256(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)

	return err == nil
}

func equalDigest(left string, right string) bool {
	return strings.EqualFold(left, right)
}

// DatabaseResetTarget records one exact allowlisted database operation.
type DatabaseResetTarget struct {
	Table                      string         `json:"table"`
	Operation                  ResetOperation `json:"operation"`
	Predicate                  string         `json:"predicate,omitempty"`
	ExpectedSchemaBeforeDigest string         `json:"expected_schema_before_digest"`
	ExpectedRowCount           int64          `json:"expected_row_count"`
}

// ObjectResetTarget contains only digests suitable for durable artifacts.
type ObjectResetTarget struct {
	OwnerDomain             ResetObjectDomain            `json:"owner_domain"`
	OwnerIdentityDigest     string                       `json:"owner_identity_digest"`
	Backend                 string                       `json:"backend"`
	StorageKeyDigest        string                       `json:"storage_key_digest"`
	MetadataDigest          string                       `json:"metadata_digest"`
	BlobDigest              string                       `json:"blob_digest"`
	SourceRowDigest         string                       `json:"source_row_digest"`
	ReferenceClassification ResetReferenceClassification `json:"reference_classification"`
}

// PublicSocialSnapshotCounts records the public snapshot cardinalities.
type PublicSocialSnapshotCounts struct {
	Posts       int64 `json:"posts"`
	Comments    int64 `json:"comments"`
	Reactions   int64 `json:"reactions"`
	ObjectMetas int64 `json:"object_metas"`
	ObjectBlobs int64 `json:"object_blobs"`
}

// PublicSocialSnapshotV1 protects public Social state across the reset.
type PublicSocialSnapshotV1 struct {
	SchemaVersion              int                        `json:"schema_version"`
	ProfileID                  string                     `json:"profile_id"`
	PublicPostSchemaDigest     string                     `json:"public_post_schema_digest"`
	PublicPostRowsDigest       string                     `json:"public_post_rows_digest"`
	PublicCommentRowsDigest    string                     `json:"public_comment_rows_digest"`
	PublicReactionRowsDigest   string                     `json:"public_reaction_rows_digest"`
	PublicObjectMetadataDigest string                     `json:"public_object_metadata_digest"`
	PublicObjectBytesDigest    string                     `json:"public_object_bytes_digest"`
	Counts                     PublicSocialSnapshotCounts `json:"counts"`
	SnapshotDigest             string                     `json:"snapshot_digest"`
}

// CalculatedDigest returns the canonical SHA-256 for the public snapshot.
func (s PublicSocialSnapshotV1) CalculatedDigest() (string, error) {
	return canonicalSHA256WithoutField(s, "snapshot_digest")
}

// ResetRecoveryPredecessorV1 binds a fresh reset to the exact failed
// post-deploy journal that it is authorized to replace.
type ResetRecoveryPredecessorV1 struct {
	ResetID             string     `json:"reset_id"`
	ResetManifestDigest string     `json:"reset_manifest_digest"`
	JournalDigest       string     `json:"journal_digest"`
	State               ResetState `json:"state"`
	FailureCode         ResetCode  `json:"failure_code"`
}

// SecureContentResetManifestV1 is the immutable SC-D23 reset manifest.
type SecureContentResetManifestV1 struct {
	SchemaVersion                 int                         `json:"schema_version"`
	ResetID                       string                      `json:"reset_id"`
	ResetIntent                   ResetIntent                 `json:"reset_intent"`
	SourceCommit                  string                      `json:"source_commit"`
	WorkspaceID                   string                      `json:"workspace_id"`
	ProfileID                     string                      `json:"profile_id"`
	DeploymentEnvironment         string                      `json:"deployment_environment"`
	DestructiveScope              string                      `json:"destructive_scope"`
	DatabaseIdentityDigest        string                      `json:"database_identity_digest"`
	PublicSnapshotBefore          PublicSocialSnapshotV1      `json:"public_snapshot_before"`
	DatabaseTargets               []DatabaseResetTarget       `json:"database_targets"`
	CanonicalPrivateObjectTargets []ObjectResetTarget         `json:"canonical_private_object_targets"`
	LegacyOSSObjectTargets        []ObjectResetTarget         `json:"legacy_oss_object_targets"`
	OutOfScopeTableNames          []string                    `json:"out_of_scope_table_names"`
	RecoveryPredecessor           *ResetRecoveryPredecessorV1 `json:"recovery_predecessor,omitempty"`
	CreatedAt                     time.Time                   `json:"created_at"`
	ManifestDigest                string                      `json:"manifest_digest"`
}

// CalculatedDigest returns the canonical SHA-256 for the reset manifest.
func (m SecureContentResetManifestV1) CalculatedDigest() (string, error) {
	return canonicalSHA256WithoutField(m, "manifest_digest")
}

// ResetInvocationAcceptance records one immutable accepted attempt.
type ResetInvocationAcceptance struct {
	InvocationID     string    `json:"invocation_id"`
	InvocationDigest string    `json:"invocation_digest"`
	AcceptedAt       time.Time `json:"accepted_at"`
}

// ResetJournalTransition records one monotonic durable transition.
type ResetJournalTransition struct {
	Ordinal          int64      `json:"-"`
	FromState        ResetState `json:"from_state"`
	ToState          ResetState `json:"to_state"`
	TransitionAt     time.Time  `json:"transitioned_at"`
	TransitionDigest string     `json:"transition_digest"`
}

// MarshalJSON emits the canonical transition projection, deriving its digest
// when the durable store has only the transition facts.
func (t ResetJournalTransition) MarshalJSON() ([]byte, error) {
	content := map[string]any{
		"from_state":      t.FromState,
		"to_state":        t.ToState,
		"transitioned_at": t.TransitionAt,
	}
	digest := t.TransitionDigest
	if digest == "" {
		var err error
		digest, err = canonicalSHA256(content)
		if err != nil {
			return nil, err
		}
	}
	content["transition_digest"] = digest

	return canonicalJSON(content)
}

// ResetJournalFailure records the last typed partial failure.
type ResetJournalFailure struct {
	Code       ResetCode `json:"code"`
	RecordedAt time.Time `json:"recorded_at"`
}

// ResetJournalV1 is the durable projection of reset progress.
type ResetJournalV1 struct {
	SchemaVersion       int                         `json:"schema_version"`
	ResetID             string                      `json:"-"`
	ResetManifestDigest string                      `json:"reset_manifest_digest"`
	CurrentState        ResetState                  `json:"current_state"`
	AcceptedInvocations []ResetInvocationAcceptance `json:"accepted_invocations"`
	Transitions         []ResetJournalTransition    `json:"transitions"`
	Failure             *ResetJournalFailure        `json:"failure"`
}

// CalculatedDigest returns the canonical SHA-256 for the journal projection.
func (j ResetJournalV1) CalculatedDigest() (string, error) {
	return canonicalSHA256(j)
}

// ResetDeploymentProof is the Station-owned post-deployment identity.
type ResetDeploymentProof struct {
	SourceCommit             string    `json:"source_commit"`
	StationServiceID         string    `json:"station_service_id"`
	StationPeerID            string    `json:"station_peer_id"`
	StationRuntimeIdentity   string    `json:"station_runtime_identity"`
	ServiceAttestationDigest string    `json:"service_attestation_digest"`
	CapturedAt               time.Time `json:"captured_at"`
}

// CanonicalPrivateSchemaAttestationV1 admits private Social runtime use.
type CanonicalPrivateSchemaAttestationV1 struct {
	SchemaVersion            int         `json:"schema_version"`
	SourceCommit             string      `json:"source_commit"`
	WorkspaceID              string      `json:"workspace_id"`
	ProfileID                string      `json:"profile_id"`
	DeploymentEnvironment    string      `json:"deployment_environment"`
	DestructiveScope         string      `json:"destructive_scope"`
	StationServiceID         string      `json:"station_service_id"`
	StationPeerID            string      `json:"station_peer_id"`
	StationRuntimeIdentity   string      `json:"station_runtime_identity"`
	ServiceAttestationDigest string      `json:"service_attestation_digest"`
	ResetIntent              ResetIntent `json:"reset_intent"`
	ResetManifestDigest      string      `json:"reset_manifest_digest"`
	CompletedJournalDigest   string      `json:"completed_journal_digest"`
	CanonicalSchemaDigest    string      `json:"canonical_private_schema_digest"`
	RetiredColumnsAbsent     bool        `json:"retired_columns_absent"`
	PublicSnapshotDigest     string      `json:"public_snapshot_digest"`
	CreatedAt                time.Time   `json:"created_at"`
	AttestationDigest        string      `json:"attestation_digest"`
}

// CalculatedDigest returns the canonical SHA-256 for the schema attestation.
func (a CanonicalPrivateSchemaAttestationV1) CalculatedDigest() (string, error) {
	return canonicalSHA256WithoutField(a, "attestation_digest")
}

// ResetExecutionResult is the safe JSON response returned by the maintenance CLI.
type ResetExecutionResult struct {
	SchemaVersion   int                                  `json:"schema_version"`
	ResetID         string                               `json:"reset_id"`
	State           ResetState                           `json:"state"`
	ExactReplay     bool                                 `json:"exact_replay"`
	NeedsDeployment bool                                 `json:"needs_deployment"`
	Journal         ResetJournalV1                       `json:"journal"`
	JournalDigest   string                               `json:"journal_digest"`
	Attestation     *CanonicalPrivateSchemaAttestationV1 `json:"attestation,omitempty"`
}

// CanonicalDatabaseResetTargets returns the immutable SC-D23 operation order.
func CanonicalDatabaseResetTargets() []DatabaseResetTarget {
	targets := []DatabaseResetTarget{
		{Table: "social_reactions", Operation: ResetOperationDeletePrivatePostClass, Predicate: "post_class = 'private'"},
		{Table: "social_comments", Operation: ResetOperationDeletePrivatePostClass, Predicate: "post_class = 'private'"},
		{Table: "social_moment_deliveries", Operation: ResetOperationClearTable},
		{Table: "social_private_object_grants", Operation: ResetOperationClearTable},
		{Table: "social_private_objects", Operation: ResetOperationClearTable},
		{Table: "social_private_object_parts", Operation: ResetOperationClearTable},
		{Table: "social_private_object_uploads", Operation: ResetOperationClearTable},
		{Table: "social_private_delivery_intents", Operation: ResetOperationClearTable},
		{Table: "social_private_content_envelopes", Operation: ResetOperationClearTable},
		{Table: "social_private_recipient_grants", Operation: ResetOperationClearTable},
		{Table: "social_private_comments", Operation: ResetOperationClearTable},
		{Table: "social_private_audience_snapshots", Operation: ResetOperationClearTable},
		{Table: "social_private_commit_proofs", Operation: ResetOperationClearTable},
		{Table: "social_private_command_receipts", Operation: ResetOperationClearTable},
		{Table: "social_private_content_plan_slots", Operation: ResetOperationClearTable},
		{Table: "social_private_content_plans", Operation: ResetOperationClearTable},
		{Table: "social_private_audience_grants", Operation: ResetOperationDropRetiredTable},
		{Table: "social_private_posts", Operation: ResetOperationClearTable},
		{Table: "social_private_posts", Operation: ResetOperationRebuildCanonicalPrivatePost},
	}

	return targets
}

// CanonicalPrivatePostColumns returns the exact accepted encrypted Post columns.
func CanonicalPrivatePostColumns() []string {
	return []string{
		"post_id",
		"content_id",
		"author_ptid",
		"generation",
		"audience_snapshot_id",
		"kind",
		"encrypted_payload_bytes",
		"encrypted_payload_sha256",
		"object_descriptor_set_sha256",
		"mention_routing_bytes",
		"mention_routing_sha256",
		"subtype_authority_sha256",
		"lifecycle_state",
		"comments_count",
		"reactions_count",
		"created_at",
		"updated_at",
		"deleted_at",
	}
}

// RetiredPrivatePostColumns returns the only columns the rebuild may remove.
func RetiredPrivatePostColumns() []string {
	return []string{
		"id",
		"author_id",
		"type",
		"audience_kind",
		"audience_target_id",
		"audience_base_kind",
		"audience_key_envelopes_json",
		"text_body",
		"attachments_json",
		"mentions_json",
		"link_preview_json",
		"reactions_count_json",
		"repost_of_ref",
		"views_count",
		"edited_at",
	}
}

// ValidateDatabaseTargetOrder rejects reordered, widened, or altered targets.
func ValidateDatabaseTargetOrder(targets []DatabaseResetTarget) error {
	expected := CanonicalDatabaseResetTargets()
	if len(targets) != len(expected) {
		return resetError(
			ResetCodeSchemaTargetUnreviewed,
			"database target count is %d, want %d",
			len(targets),
			len(expected),
		)
	}
	for index := range expected {
		if targets[index].Table != expected[index].Table ||
			targets[index].Operation != expected[index].Operation ||
			targets[index].Predicate != expected[index].Predicate {
			return resetError(
				ResetCodeSchemaTargetUnreviewed,
				"database target %d is not the reviewed operation",
				index,
			)
		}
	}

	return nil
}

func canonicalSHA256(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}

	return canonicalSHA256FromBytes(encoded)
}

// canonicalSHA256FromBytes produces the canonical SHA-256 of JSON bytes by
// parsing into map[string]json.RawMessage and reconstructing with sorted keys.
// For non-object values, it falls back to hashing the encoded bytes directly.
func canonicalSHA256FromBytes(encoded []byte) (string, error) {
	trimmed := bytes.TrimSpace(encoded)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var content map[string]json.RawMessage
		if err := json.Unmarshal(trimmed, &content); err != nil {
			return "", err
		}

		return rawMapDigest(content)
	}
	digest := sha256.Sum256(trimmed)

	return hex.EncodeToString(digest[:]), nil
}

func requireExactJSONFields(data []byte, required []string) error {
	expected := make(map[string]struct{}, len(required))
	for _, field := range required {
		expected[field] = struct{}{}
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	token, err := decoder.Token()
	if err != nil {
		return err
	}
	if delimiter, ok := token.(json.Delim); !ok || delimiter != '{' {
		return fmt.Errorf("canonical reset payload must be a JSON object")
	}
	seen := make(map[string]struct{}, len(required))
	for decoder.More() {
		token, err = decoder.Token()
		if err != nil {
			return err
		}
		field, ok := token.(string)
		if !ok {
			return fmt.Errorf("canonical reset payload field is not a string")
		}
		if _, ok := expected[field]; !ok {
			return fmt.Errorf("canonical reset payload contains unknown field %q", field)
		}
		if _, ok := seen[field]; ok {
			return fmt.Errorf("canonical reset payload repeats field %q", field)
		}
		seen[field] = struct{}{}
		var discarded json.RawMessage
		if err := decoder.Decode(&discarded); err != nil {
			return err
		}
	}
	if _, err := decoder.Token(); err != nil {
		return err
	}
	for _, field := range required {
		if _, ok := seen[field]; !ok {
			return fmt.Errorf("canonical reset payload is missing field %q", field)
		}
	}

	return nil
}

func canonicalSHA256WithoutField(value any, field string) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	var content map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &content); err != nil {
		return "", err
	}
	delete(content, field)

	return rawMapDigest(content)
}

// canonicalSHA256WithoutFieldFromRaw computes the canonical SHA-256 digest of a
// JSON object with one field removed, preserving original value representations.
// It decodes values as json.RawMessage to retain exact wire formatting, then
// reconstructs canonical JSON with sorted keys and compact separators.
func canonicalSHA256WithoutFieldFromRaw(raw []byte, field string) (string, error) {
	var content map[string]json.RawMessage
	if err := json.Unmarshal(raw, &content); err != nil {
		return "", err
	}
	delete(content, field)

	return rawMapDigest(content)
}

// rawMapDigest produces the SHA-256 of canonical JSON from a
// map[string]json.RawMessage. Keys are sorted; separators are compact; nested
// objects are recursively canonicalized. This avoids any dependence on Go's
// json.Encoder output format across versions.
func rawMapDigest(content map[string]json.RawMessage) (string, error) {
	canonical, err := canonicalizeRawMap(content)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(canonical)

	return hex.EncodeToString(digest[:]), nil
}

func canonicalizeRawMap(content map[string]json.RawMessage) ([]byte, error) {
	keys := make([]string, 0, len(content))
	for k := range content {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, k := range keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		keyBytes, err := json.Marshal(k)
		if err != nil {
			return nil, err
		}
		escaped, err := escapeNonASCII(keyBytes)
		if err != nil {
			return nil, err
		}
		buf.Write(escaped)
		buf.WriteByte(':')
		canonical, err := canonicalizeRawValue(content[k])
		if err != nil {
			return nil, err
		}
		buf.Write(canonical)
	}
	buf.WriteByte('}')

	return buf.Bytes(), nil
}

func canonicalizeRawValue(raw json.RawMessage) ([]byte, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return trimmed, nil
	}
	switch trimmed[0] {
	case '{':
		var nested map[string]json.RawMessage
		if err := json.Unmarshal(trimmed, &nested); err != nil {
			return nil, err
		}

		return canonicalizeRawMap(nested)
	case '[':
		var items []json.RawMessage
		if err := json.Unmarshal(trimmed, &items); err != nil {
			return nil, err
		}
		var buf bytes.Buffer
		buf.WriteByte('[')
		for i, item := range items {
			if i > 0 {
				buf.WriteByte(',')
			}
			canonical, err := canonicalizeRawValue(item)
			if err != nil {
				return nil, err
			}
			buf.Write(canonical)
		}
		buf.WriteByte(']')

		return buf.Bytes(), nil
	case '"':
		return escapeNonASCII(trimmed)
	default:
		return trimmed, nil
	}
}

func canonicalJSON(value any) ([]byte, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var normalized any
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.UseNumber()
	if err := decoder.Decode(&normalized); err != nil {
		return nil, err
	}

	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(normalized); err != nil {
		return nil, err
	}

	return escapeNonASCII(bytes.TrimSuffix(buffer.Bytes(), []byte{'\n'}))
}

func escapeNonASCII(value []byte) ([]byte, error) {
	var result bytes.Buffer
	for len(value) > 0 {
		if value[0] < utf8.RuneSelf {
			result.WriteByte(value[0])
			value = value[1:]
			continue
		}
		runeValue, size := utf8.DecodeRune(value)
		if runeValue == utf8.RuneError && size == 1 {
			return nil, fmt.Errorf("canonical JSON contains invalid UTF-8")
		}
		if runeValue <= 0xffff {
			_, _ = fmt.Fprintf(&result, `\u%04x`, runeValue)
		} else {
			scalar := runeValue - 0x10000
			_, _ = fmt.Fprintf(
				&result,
				`\u%04x\u%04x`,
				0xd800+(scalar>>10),
				0xdc00+(scalar&0x3ff),
			)
		}
		value = value[size:]
	}

	return result.Bytes(), nil
}

func sha256Hex(value []byte) string {
	digest := sha256.Sum256(value)

	return hex.EncodeToString(digest[:])
}

func canonicalStrings(values []string) []string {
	result := append([]string(nil), values...)
	slices.Sort(result)
	result = slices.Compact(result)

	return result
}
