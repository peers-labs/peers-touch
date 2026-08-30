package oss

import (
	"context"
	"errors"

	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/store"
	"gorm.io/gorm"
)

// ChatSessionResolver answers the question "is `actorPTID` part of the
// audience of `sessionID`?". The OSS subserver consults this on every
// `chat`-visibility GET.
//
// We expose it as an interface — rather than reaching directly into
// the friend_chat schema — so that:
//
//   - tests can stub a deterministic answer without spinning up the
//     friend_chat plugin;
//   - a future federation deployment can replace the local-DB lookup
//     with a remote query against the peer station that owns the
//     session.
type ChatSessionResolver interface {
	IsParticipant(ctx context.Context, sessionID, actorPTID string) (bool, error)
}

// sqlChatSessionResolver is the default ChatSessionResolver. It looks
// up the `friend_chat_sessions` table directly via the same shared
// `store` package the friend_chat subserver uses, which keeps the
// query path identical to friend_chat's own membership checks.
//
// We do NOT import the friend_chat package here — that would create
// a circular dependency once friend_chat starts caring about OSS
// access for its own attachments. The table name is the contract.
type sqlChatSessionResolver struct {
	dbName string
}

// NewSQLChatSessionResolver returns the default resolver bound to a
// named GORM datasource. The datasource name must match what the
// friend_chat subserver writes to (typically the same `default` db).
func NewSQLChatSessionResolver(dbName string) ChatSessionResolver {
	return &sqlChatSessionResolver{dbName: dbName}
}

// IsParticipant returns true when `actorPTID` matches either
// participant column of `friend_chat_sessions(ulid = sessionID)`. A
// missing session row returns (false, nil) — *not* an error, because
// the OSS audience check should fail-closed without surfacing
// schema-mismatch noise.
func (r *sqlChatSessionResolver) IsParticipant(ctx context.Context, sessionID, actorPTID string) (bool, error) {
	if sessionID == "" || actorPTID == "" {
		return false, nil
	}
	if r.dbName == "" {
		return false, errors.New("oss: chat resolver: dbName not configured")
	}
	db, err := store.GetRDS(ctx, store.WithRDSDBName(r.dbName))
	if err != nil {
		return false, err
	}
	var n int64
	err = db.Table("friend_chat_sessions").
		Where("ulid = ? AND (participant_a_ptid = ? OR participant_b_ptid = ?)",
			sessionID, actorPTID, actorPTID).
		Count(&n).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return n > 0, nil
}

// permissionDecision is the value returned by checkRead. Reason is a
// short stable identifier suitable for audit logs and metrics; it is
// *not* shown to clients (we return a generic 403 body).
type permissionDecision struct {
	Allow  bool
	Reason string
}

// Stable reason codes — keep these short and string-stable, the
// dashboard groups audit rows by them.
const (
	reasonOK              = "ok"
	reasonNoSubject       = "subject_required"
	reasonNotOwner        = "not_owner"
	reasonNotInSession    = "not_in_session"
	reasonNoSession       = "session_missing"
	reasonResolverError   = "resolver_error"
	reasonUnknownVis      = "unknown_visibility"
	reasonResolverMissing = "resolver_missing"
)

// checkRead applies the visibility policy carried on `meta` to a
// caller identified by `subjectID` (empty when unauthenticated). It
// returns a `permissionDecision` rather than `(bool, error)` because
// the caller wants to audit the *reason*, not just the outcome —
// audit rows with reason="not_owner" tell a different story from
// rows with reason="subject_required".
//
// `peerSubjectID` is reserved for the upcoming federation path
// (peer-station-signed JWT). Currently it is treated identically to
// `subjectID` — when both are present, the federation-token PTID
// takes precedence so a peer station's audience claim cannot be
// undermined by a stale local cookie.
func checkRead(ctx context.Context, resolver ChatSessionResolver, meta *ossmodel.FileMeta, subjectID, peerSubjectID string) permissionDecision {
	caller := peerSubjectID
	if caller == "" {
		caller = subjectID
	}

	switch meta.Visibility {
	case ossmodel.VisibilityPublic:
		return permissionDecision{Allow: true, Reason: reasonOK}

	case ossmodel.VisibilityPrivate:
		if caller == "" {
			return permissionDecision{Allow: false, Reason: reasonNoSubject}
		}
		if caller != meta.OwnerPTID {
			return permissionDecision{Allow: false, Reason: reasonNotOwner}
		}
		return permissionDecision{Allow: true, Reason: reasonOK}

	case ossmodel.VisibilityChat:
		if caller == "" {
			return permissionDecision{Allow: false, Reason: reasonNoSubject}
		}
		// The owner can always read their own chat-visibility files
		// regardless of the resolver's view of the session — owners
		// are by definition participants, and this short-circuit
		// keeps owner reads working when the resolver is misconfigured
		// in a development environment.
		if caller == meta.OwnerPTID {
			return permissionDecision{Allow: true, Reason: reasonOK}
		}
		if meta.ChatSessionID == "" {
			return permissionDecision{Allow: false, Reason: reasonNoSession}
		}
		if resolver == nil {
			return permissionDecision{Allow: false, Reason: reasonResolverMissing}
		}
		ok, err := resolver.IsParticipant(ctx, meta.ChatSessionID, caller)
		if err != nil {
			return permissionDecision{Allow: false, Reason: reasonResolverError}
		}
		if !ok {
			return permissionDecision{Allow: false, Reason: reasonNotInSession}
		}
		return permissionDecision{Allow: true, Reason: reasonOK}
	}

	// Unknown / empty visibility cannot be allowed. The schema marks
	// the column NOT NULL and the upload path validates against
	// IsKnownVisibility, so reaching this branch implies a row that
	// bypassed validation — refuse to serve and surface the policy
	// gap in the audit trail.
	return permissionDecision{Allow: false, Reason: reasonUnknownVis}
}
