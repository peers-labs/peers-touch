package model

import "time"

// Audit actions emitted to oss_audit. The string set is closed —
// callers should not invent new actions; if a new event type is
// needed, add a constant here so dashboard filter UIs stay in sync.
//
// The set is grouped by lifecycle stage so reviewers can scan it for
// a missing event without needing the full v3 doc open.
const (
	// User-driven object lifecycle.
	AuditActionUpload            = "upload"
	AuditActionGet               = "get"
	AuditActionPatch             = "patch"
	AuditActionDelete            = "delete"
	AuditActionRestore           = "restore"
	AuditActionPresignPut        = "presign_put"
	AuditActionPresignGet        = "presign_get"
	AuditActionMultipartInit     = "multipart_init"
	AuditActionMultipartPart     = "multipart_part"
	AuditActionMultipartComplete = "multipart_complete"

	// Operator / dashboard-driven mutations. We keep a separate
	// `admin_*` prefix so the dashboard can filter for "what did
	// the operator do this week" without joining on the actor table.
	AuditActionAdminDelete             = "admin_delete"
	AuditActionAdminVisibilityOverride = "admin_visibility_override"
	AuditActionBucketCreate            = "bucket_create"
	AuditActionBucketUpdate            = "bucket_update"
	AuditActionBucketDelete            = "bucket_delete"

	// Federation. `mint` is outbound (this station signs a peer JWT
	// for one of its users); `verify` is inbound (a remote station
	// presented a peer JWT we validated against our oss_peer_keys
	// cache). `key_rotate` covers both `_prev` slot writes and the
	// finalize sweep that clears them.
	AuditActionFederationMint   = "federation_mint"
	AuditActionFederationVerify = "federation_verify"
	AuditActionKeyRotate        = "key_rotate"
	AuditActionPeerPin          = "peer_pin"
	AuditActionPeerUnpin        = "peer_unpin"
	AuditActionPeerForget       = "peer_forget"

	// Internal: lifecycle workers and probes. We persist these so
	// "did the worker run?" is answerable from the audit log alone,
	// independent of the metrics endpoint.
	AuditActionBlobGC       = "blob_gc"
	AuditActionWorkerRun    = "worker_run"
	AuditActionHealthzCheck = "healthz_check"
)

// Audit outcomes. `denied` rows are how operators detect misconfigured
// permissions; `error` rows expose backend / IO failures.
const (
	AuditOutcomeOK       = "ok"
	AuditOutcomeDenied   = "denied"
	AuditOutcomeNotFound = "not_found"
	AuditOutcomeError    = "error"
)

// Audit is a rolling log of OSS access events. Retention is
// time-based — the `AuditTrim` worker deletes rows older than the
// configured `audit-retention-days` window.
//
// We deliberately store FileKey / BucketID / ActorID by value rather
// than as foreign keys: audit rows must survive bucket / object
// deletion. They are append-only — there is no UPDATE path through
// the audit_repo.
type Audit struct {
	ID            uint64    `json:"id"               gorm:"primaryKey;autoIncrement"`
	TS            time.Time `json:"ts"               gorm:"index;not null"`
	Action        string    `json:"action"           gorm:"type:varchar(32);index"`
	FileKey       string    `json:"file_key"         gorm:"type:varchar(255);index"`
	BucketID      string    `json:"bucket_id"        gorm:"type:varchar(64);index"`
	ActorID       string    `json:"actor_id"         gorm:"type:varchar(255);index"`
	PeerStationID string    `json:"peer_station_id"  gorm:"type:varchar(255);index"`
	SizeBytes     int64     `json:"size_bytes"       gorm:"type:bigint"`
	Outcome       string    `json:"outcome"          gorm:"type:varchar(16);index"`
	Reason        string    `json:"reason,omitempty" gorm:"type:varchar(120)"`

	// FileID denormalises `oss_files.ID` so the dashboard can render
	// "audit row → file detail" without a fragile join on FileKey
	// (CAS keys are stable but FileMeta IDs are the canonical handle
	// for /dashboard/api/oss/objects/:id). Empty when the action
	// does not concern a specific file (e.g. bucket_create).
	FileID string `json:"file_id,omitempty" gorm:"type:varchar(64);index"`

	// DashboardActorID is the operator (admin) who triggered an
	// `admin_*` action via the dashboard. Distinct from ActorID
	// (the file's owner / target user) — a row may carry both,
	// e.g. `admin_visibility_override` records both the operator
	// who pushed the button and the owner of the affected file.
	DashboardActorID string `json:"dashboard_actor_id,omitempty" gorm:"type:varchar(255);index"`

	// RequestID is the per-request correlation token stamped by the
	// requestID middleware. Lets operators stitch together the full
	// lifecycle of a single HTTP request when multiple audit rows
	// fire (e.g. denied permission check followed by an admin
	// override on the same request).
	RequestID string `json:"request_id,omitempty" gorm:"type:varchar(64);index"`
}

// TableName pins the Audit struct to `oss_audit`.
func (Audit) TableName() string { return "oss_audit" }
