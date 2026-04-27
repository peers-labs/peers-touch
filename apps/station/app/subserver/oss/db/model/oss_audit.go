package model

import "time"

// Audit actions emitted to oss_audit. The string set is closed —
// callers should not invent new actions; if a new event type is
// needed, add a constant here so dashboard filter UIs stay in sync.
const (
	AuditActionUpload      = "upload"
	AuditActionGet         = "get"
	AuditActionDelete      = "delete"
	AuditActionPresignPut  = "presign_put"
	AuditActionPresignGet  = "presign_get"
	AuditActionAdminDelete = "admin_delete"
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
// time-based (default 7 days, see ossSubServer.auditRetention).
//
// We deliberately store FileKey / BucketID / ActorID by value rather
// than as foreign keys: audit rows must survive bucket / object
// deletion. They are append-only — there is no UPDATE path through
// the audit_repo.
type Audit struct {
	ID            uint64    `json:"id"               gorm:"primaryKey;autoIncrement"`
	TS            time.Time `json:"ts"               gorm:"index;not null"`
	Action        string    `json:"action"           gorm:"type:varchar(16);index"`
	FileKey       string    `json:"file_key"         gorm:"type:varchar(255);index"`
	BucketID      string    `json:"bucket_id"        gorm:"type:varchar(64);index"`
	ActorID       string    `json:"actor_id"         gorm:"type:varchar(255);index"`
	PeerStationID string    `json:"peer_station_id"  gorm:"type:varchar(255)"`
	SizeBytes     int64     `json:"size_bytes"       gorm:"type:bigint"`
	Outcome       string    `json:"outcome"          gorm:"type:varchar(16);index"`
	Reason        string    `json:"reason,omitempty" gorm:"type:varchar(120)"`
}

// TableName pins the Audit struct to `oss_audit`.
func (Audit) TableName() string { return "oss_audit" }
