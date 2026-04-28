// Package domain — OSS-specific DTOs surfaced through the dashboard
// `/dashboard/api/oss/*` family of endpoints.
//
// These are *projections* of the OSS subserver's internal models — the
// dashboard never imports oss/db/repo, it queries the shared GORM
// handle through its own infrastructure repo. The duplication is
// intentional: it forces every field that crosses the API boundary
// to be reviewed when the OSS schema changes.
package domain

import "time"

// ---------------------------------------------------------------------------
// Bucket DTOs
// ---------------------------------------------------------------------------

// OSSBucketSummary is one row in `GET /dashboard/api/oss/buckets`.
// Fields mirror oss_buckets but expose only what the operator needs;
// the underlying ULID `id` is preserved as the addressable key.
type OSSBucketSummary struct {
	ID                string    `json:"id"`
	Name              string    `json:"name"`
	OwnerActorID      string    `json:"owner_actor_id"`
	Kind              string    `json:"kind"`
	SystemKey         string    `json:"system_key,omitempty"`
	DefaultVisibility string    `json:"default_visibility"`
	QuotaBytes        int64     `json:"quota_bytes"`
	UsedBytes         int64     `json:"used_bytes"`
	FileCount         int64     `json:"file_count"`
	TTLDays           int32     `json:"ttl_days"`
	Description       string    `json:"description,omitempty"`
	CreatedAt         time.Time `json:"created_at"`
	UpdatedAt         time.Time `json:"updated_at"`
}

// OSSBucketListResponse is the envelope for `GET /buckets`. It is not
// paginated — the bucket count is operator-controlled (~handful per
// actor) and a flat list is friendlier for the dashboard sidebar.
type OSSBucketListResponse struct {
	Items []OSSBucketSummary `json:"items"`
	Total int                `json:"total"`
}

// OSSBucketCreateRequest is the JSON body of
// `POST /dashboard/api/oss/buckets`. The dashboard creates only
// `user`-kind buckets — `system` buckets are auto-provisioned by
// the OSS subserver on first use, and exposing a "kind" knob would
// let an operator stomp on the canonical system specs.
//
// All numeric fields default to zero ("unlimited" for QuotaBytes,
// "no TTL" for TTLDays); DefaultVisibility falls back to `private`
// at the service layer when omitted.
type OSSBucketCreateRequest struct {
	OwnerActorID      string `json:"owner_actor_id"`
	Name              string `json:"name"`
	DefaultVisibility string `json:"default_visibility"`
	QuotaBytes        int64  `json:"quota_bytes"`
	TTLDays           int32  `json:"ttl_days"`
	Description       string `json:"description"`
}

// OSSBucketUpdateRequest is the JSON body of
// `PATCH /dashboard/api/oss/buckets/:id`. Each pointer field is
// explicitly nil-vs-set so the dashboard can clear `description`
// (set to "") without having to re-send every other field. Name
// and OwnerActorID are *not* updatable — mutating either would
// break the unique (owner, name) index and is best handled by
// recreating the bucket.
type OSSBucketUpdateRequest struct {
	DefaultVisibility *string `json:"default_visibility,omitempty"`
	QuotaBytes        *int64  `json:"quota_bytes,omitempty"`
	TTLDays           *int32  `json:"ttl_days,omitempty"`
	Description       *string `json:"description,omitempty"`
}

// ---------------------------------------------------------------------------
// Object DTOs
// ---------------------------------------------------------------------------

// OSSObjectSummary is one file in the dashboard object table. We
// deliberately omit Sha256 (operators rarely need the digest in the
// list view; detail views can re-query) and Path (host-internal).
type OSSObjectSummary struct {
	ID            string    `json:"id"`
	Key           string    `json:"key"`
	Name          string    `json:"name"`
	Size          int64     `json:"size"`
	Mime          string    `json:"mime"`
	Backend       string    `json:"backend"`
	BucketID      string    `json:"bucket_id"`
	OwnerActorID  string    `json:"owner_actor_id"`
	Visibility    string    `json:"visibility"`
	ChatSessionID string    `json:"chat_session_id,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// OSSObjectListResponse is the paged response for `GET /objects` and
// `GET /buckets/:id/objects`.
type OSSObjectListResponse struct {
	Items []OSSObjectSummary `json:"items"`
	Total int64              `json:"total"`
	Page  int                `json:"page"`
}

// OSSObjectAdminDetail is the response for `GET /objects/:id` and
// the return shape of admin PATCH / DELETE. It surfaces the
// lifecycle columns (`expires_at`, `deleted_at`, `updated_at`)
// the list view omits — operators acting on a single object need
// the full state to make an informed decision.
type OSSObjectAdminDetail struct {
	ID            string     `json:"id"`
	Key           string     `json:"key"`
	Name          string     `json:"name"`
	Size          int64      `json:"size"`
	Mime          string     `json:"mime"`
	Backend       string     `json:"backend"`
	BucketID      string     `json:"bucket_id"`
	OwnerActorID  string     `json:"owner_actor_id"`
	Visibility    string     `json:"visibility"`
	ChatSessionID string     `json:"chat_session_id,omitempty"`
	Sha256        string     `json:"sha256,omitempty"`
	ExpiresAt     *time.Time `json:"expires_at,omitempty"`
	DeletedAt     *time.Time `json:"deleted_at,omitempty"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
}

// OSSObjectAdminPatchRequest is the JSON body of
// `PATCH /dashboard/api/oss/objects/:id`.
//
// Field semantics (the dashboard goes through the TypedHandler
// codec, which cannot distinguish "field omitted" from "field =
// null", so we use the following conventions):
//
//   - Visibility: nil = leave alone; set = update. Whitelist
//     enforced at the service layer.
//   - ChatSessionID: nil = leave alone; "" = clear; non-empty =
//     set. Empty-string-as-clear is unambiguous because chat
//     session IDs cannot legitimately be empty.
//   - ExpiresAt: nil = leave alone; set = update.
//   - ClearExpiresAt: when true, force the column to NULL
//     regardless of ExpiresAt. Used because *time.Time has no
//     natural "cleared" sentinel that survives JSON round-trips.
type OSSObjectAdminPatchRequest struct {
	Visibility     *string    `json:"visibility,omitempty"`
	ChatSessionID  *string    `json:"chat_session_id,omitempty"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
	ClearExpiresAt bool       `json:"clear_expires_at,omitempty"`
}

// ---------------------------------------------------------------------------
// Audit DTOs
// ---------------------------------------------------------------------------

// OSSAuditEvent mirrors oss_audit. Reason is exposed verbatim so the
// dashboard can group denials by stable code.
type OSSAuditEvent struct {
	ID            uint64    `json:"id"`
	TS            time.Time `json:"ts"`
	Action        string    `json:"action"`
	FileKey       string    `json:"file_key"`
	BucketID      string    `json:"bucket_id"`
	ActorID       string    `json:"actor_id"`
	PeerStationID string    `json:"peer_station_id,omitempty"`
	SizeBytes     int64     `json:"size_bytes"`
	Outcome       string    `json:"outcome"`
	Reason        string    `json:"reason,omitempty"`
}

// OSSAuditListResponse is the paged audit response.
type OSSAuditListResponse struct {
	Items []OSSAuditEvent `json:"items"`
	Total int64           `json:"total"`
	Page  int             `json:"page"`
}

// ---------------------------------------------------------------------------
// Usage DTOs
// ---------------------------------------------------------------------------

// OSSUsageSummary is the headline numbers for `GET /usage` — one
// payload feeds the OSS overview card on the dashboard home.
type OSSUsageSummary struct {
	TotalBytes      int64                `json:"total_bytes"`
	TotalFiles      int64                `json:"total_files"`
	BucketCount     int                  `json:"bucket_count"`
	TopOwners       []OSSOwnerUsage      `json:"top_owners,omitempty"`
	VisibilityMix   []OSSVisibilityCount `json:"visibility_mix,omitempty"`
}

// OSSOwnerUsage is one row in TopOwners — descending by Bytes.
type OSSOwnerUsage struct {
	OwnerActorID string `json:"owner_actor_id"`
	Bytes        int64  `json:"bytes"`
	Files        int64  `json:"files"`
}

// OSSVisibilityCount is one row in VisibilityMix — used for the
// public/chat/private pie chart.
type OSSVisibilityCount struct {
	Visibility string `json:"visibility"`
	Files      int64  `json:"files"`
	Bytes      int64  `json:"bytes"`
}

// ---------------------------------------------------------------------------
// Federation DTOs
// ---------------------------------------------------------------------------

// OSSFederationLocalKey is the response for `GET /federation/me`.
// PublicKeyPEM is safe to expose; PrivateKeyPEM is *never* surfaced —
// reading the private key from the dashboard would defeat the
// reason it lives in oss_meta in the first place.
type OSSFederationLocalKey struct {
	KID          string `json:"kid"`
	PublicKeyPEM string `json:"public_key_pem"`
	Generated    bool   `json:"generated"`
}

// OSSFederationPeer is one row in `GET /federation/peers`.
type OSSFederationPeer struct {
	PeerStationID string    `json:"peer_station_id"`
	KID           string    `json:"kid"`
	PublicKeyPEM  string    `json:"public_key_pem"`
	FirstSeenAt   time.Time `json:"first_seen_at"`
	LastSeenAt    time.Time `json:"last_seen_at"`
	Pinned        bool      `json:"pinned"`
}

// OSSFederationPeersResponse wraps the peer list.
type OSSFederationPeersResponse struct {
	Items []OSSFederationPeer `json:"items"`
}

// OSSFederationRotateResponse is the body of a successful
// `POST /dashboard/api/oss/federation/rotate-local-key`.
//
// `NewKID` is the freshly generated identifier; `PreviousKID`
// echoes back the kid we just demoted to the `_prev` slot so the
// operator can sanity-check the rotation in the audit log.
// `RotatedAt` is the timestamp the worker uses when deciding when
// to clear the `_prev` slot, and `CapabilityVersion` is the new
// `oss_meta.capability_version` that peers will observe on their
// next `/sub-oss/capabilities` refresh.
type OSSFederationRotateResponse struct {
	NewKID            string    `json:"new_kid"`
	PreviousKID       string    `json:"previous_kid,omitempty"`
	RotatedAt         time.Time `json:"rotated_at"`
	CapabilityVersion string    `json:"capability_version,omitempty"`
}
