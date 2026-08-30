package oss

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	ossdb "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// Stable HTTP-side reason codes for lifecycle audit rows. We pin
// these in one place so the dashboard can graph mutation patterns
// without having to chase free-form strings across handlers.
const (
	lifecycleReasonUser               = "user"
	lifecycleReasonUserIdempotent     = "user_idempotent"
	lifecycleReasonNotOwner           = "not_owner"
	lifecycleReasonAuthRequired       = "auth_required"
	lifecycleReasonNotFound           = "not_found"
	lifecycleReasonRestoreExpired     = "restore_window_expired"
	lifecycleReasonAlreadyLive        = "already_live"
	lifecycleReasonInternal           = "internal_error"
	lifecycleReasonBadRequest         = "bad_request"
	lifecycleReasonQuotaExceeded      = "quota_exceeded"
	lifecycleReasonInvalidVisibility  = "invalid_visibility"
	lifecycleReasonChatSessionMissing = "chat_session_required"
	lifecycleReasonBucketUnknown      = "bucket_unknown"
	lifecycleReasonBucketCrossActor   = "bucket_cross_actor"
	lifecycleReasonPatchEmpty         = "patch_empty"
	lifecycleReasonPatchOnDeleted     = "patch_on_deleted"
)

// handleFileDelete soft-deletes the (subject, key) row.
//
// Endpoint: `DELETE /sub-oss/file?key=...`
//
// Auth: JWT required; the subject id is the *only* trusted owner —
// an `owner` query parameter, if supplied, is rejected when it
// does not match. We deliberately do NOT support cross-actor
// deletes here; dashboard / admin force-delete is a separate
// endpoint with a separate audit reason (S10).
//
// Behaviour:
//   - 200 + JSON body on success
//   - 200 + `already_deleted: true` on idempotent re-DELETE
//   - 401 when no JWT subject is present
//   - 403 when the JWT subject does not match the owner query param
//   - 404 when no row exists for (subject, key)
//   - 500 on persistence failures
func (s *ossSubServer) handleFileDelete(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionDelete, "auth not configured")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionDelete, "auth required")
		return
	}

	q := r.URL.Query()
	key := strings.TrimSpace(q.Get("key"))
	if key == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionDelete, "key required")
		return
	}
	if requested := strings.TrimSpace(q.Get("owner")); requested != "" && requested != subject.ID {
		// Refuse the call rather than silently deleting the
		// wrong row; this mirrors the read path's owner check.
		s.writeLifecycleError(r.Context(), w, nil, http.StatusForbidden, lifecycleReasonNotOwner, ossdb.AuditActionDelete, "subject does not own owner query param")
		return
	}

	res, err := s.fileService.DeleteFile(r.Context(), subject.ID, key)
	if err != nil {
		s.mapLifecycleServiceError(r.Context(), w, ossdb.AuditActionDelete, key, err)
		return
	}

	reason := lifecycleReasonUser
	if res.AlreadyDeleted {
		reason = lifecycleReasonUserIdempotent
	}
	s.recordLifecycleAudit(r.Context(), res.Meta, subject.ID, ossdb.AuditActionDelete, ossdb.AuditOutcomeOK, reason)

	w.Header().Set("Content-Type", "application/json")
	resp := map[string]any{
		"key":             res.Meta.Key,
		"deleted_at":      res.Meta.DeletedAt,
		"already_deleted": res.AlreadyDeleted,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// patchRequestBody is the JSON envelope clients POST to PATCH.
// All fields are optional; pointers carry the "field present /
// absent" distinction. `ExpiresAt` uses *string so the client can
// send `null` (clear) vs an RFC3339 stamp; the absent key leaves
// the column alone.
type patchRequestBody struct {
	Visibility    *string `json:"visibility,omitempty"`
	ChatSessionID *string `json:"chat_session_id,omitempty"`
	Bucket        *string `json:"bucket,omitempty"`
	Filename      *string `json:"filename,omitempty"`
	// ExpiresAtSet is the explicit "did the client send the key?"
	// marker we set after JSON unmarshal — captured during a
	// second decode pass into a raw map. JSON itself cannot
	// distinguish "field omitted" from "field set to null" with
	// `*string` alone.
	ExpiresAt    *string `json:"expires_at,omitempty"`
	ExpiresAtSet bool    `json:"-"`
}

// decodePatchRequest combines a typed unmarshal with a raw map
// inspection so we can tell "field absent" from "field = null"
// for `expires_at`. The raw form is the JSON contract; the typed
// form drives the service call.
func decodePatchRequest(body []byte) (patchRequestBody, error) {
	var typed patchRequestBody
	if err := json.Unmarshal(body, &typed); err != nil {
		return typed, err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		return typed, err
	}
	if _, ok := raw["expires_at"]; ok {
		typed.ExpiresAtSet = true
	}
	return typed, nil
}

// handleFilePatch applies an owner-only PATCH to a (subject, key)
// row.
//
// Endpoint: `PATCH /sub-oss/file?key=...`
//
// Request body (all fields optional):
//
//	{
//	  "visibility":      "public" | "chat" | "private",
//	  "chat_session_id": "...",
//	  "bucket":          "<bucket name>",
//	  "filename":        "...",
//	  "expires_at":      "2026-05-01T00:00:00Z" | null
//	}
//
// Auth: JWT required; subject must own the row. `?owner=…` is
// rejected when it disagrees, mirroring DELETE/restore.
//
// Response body on success:
//
//	{
//	  "key": ..., "visibility": ..., "chat_session_id": ...,
//	  "bucket_id": ..., "filename": ..., "expires_at": ...,
//	  "updated_at": ...,
//	  "fields_changed": ["visibility", ...],
//	  "capability_version": "<ulid>" // present iff visibility tightened
//	}
func (s *ossSubServer) handleFilePatch(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionPatch, "auth not configured")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionPatch, "auth required")
		return
	}

	q := r.URL.Query()
	key := strings.TrimSpace(q.Get("key"))
	if key == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionPatch, "key required")
		return
	}
	if requested := strings.TrimSpace(q.Get("owner")); requested != "" && requested != subject.ID {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusForbidden, lifecycleReasonNotOwner, ossdb.AuditActionPatch, "subject does not own owner query param")
		return
	}

	rawBody, err := io.ReadAll(io.LimitReader(r.Body, 1<<16)) // 64 KiB cap
	if err != nil {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionPatch, "read body: "+err.Error())
		return
	}
	if len(rawBody) == 0 {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionPatch, "request body required")
		return
	}
	body, err := decodePatchRequest(rawBody)
	if err != nil {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionPatch, "decode body: "+err.Error())
		return
	}

	req := service.PatchRequest{
		Visibility:    body.Visibility,
		ChatSessionID: body.ChatSessionID,
		BucketName:    body.Bucket,
		Filename:      body.Filename,
		ExpiresAtSet:  body.ExpiresAtSet,
	}
	if body.ExpiresAtSet && body.ExpiresAt != nil {
		t, perr := time.Parse(time.RFC3339, *body.ExpiresAt)
		if perr != nil {
			s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionPatch, "expires_at: "+perr.Error())
			return
		}
		req.ExpiresAt = &t
	}

	res, err := s.fileService.PatchFile(r.Context(), subject.ID, key, req)
	if err != nil {
		s.mapLifecycleServiceError(r.Context(), w, ossdb.AuditActionPatch, key, err)
		return
	}

	// One audit row per changed field — the dashboard graphs by
	// reason so this gives accurate per-column mutation rates.
	for _, field := range res.FieldsChanged {
		s.recordLifecycleAudit(r.Context(), res.Meta, subject.ID, ossdb.AuditActionPatch, ossdb.AuditOutcomeOK, field)
	}

	if res.CapabilityVersion != "" {
		// Echo for clients that want to short-circuit a follow-up
		// `/capabilities` round-trip after a tightening PATCH.
		w.Header().Set("X-Capability-Version", res.CapabilityVersion)
	}
	w.Header().Set("Content-Type", "application/json")
	resp := map[string]any{
		"key":             res.Meta.Key,
		"visibility":      res.Meta.Visibility,
		"chat_session_id": res.Meta.ChatSessionID,
		"bucket_id":       res.Meta.BucketID,
		"filename":        res.Meta.Name,
		"expires_at":      res.Meta.ExpiresAt,
		"updated_at":      res.Meta.UpdatedAt,
		"fields_changed":  res.FieldsChanged,
	}
	if res.CapabilityVersion != "" {
		resp["capability_version"] = res.CapabilityVersion
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// handleListMyFiles serves `GET /sub-oss/my-files?…`.
//
// Auth: JWT required. The listing is owner-scoped to
// `subject.ID`; we deliberately do NOT honour an `?owner=` query
// param here because the read is always by-self and adding cross-
// actor reads would invite a permission-escalation footgun.
//
// Query parameters (all optional):
//
//	bucket           filter to a single bucket name
//	visibility       public | chat | private
//	mime             prefix match against `oss_files.mime`
//	include_deleted  "true" / "1" surfaces tombstones
//	page             1-indexed (default 1)
//	page_size        default 50, max 200
//
// Response:
//
//	{
//	  "files":     [...],         // post-filter rows
//	  "total":     <int64>,       // total rows across pages
//	  "page":      <int>,         // clamped page
//	  "page_size": <int>          // clamped page_size
//	}
//
// No audit row: reading own metadata is by definition allowed and
// the volume would dwarf actual access events.
func (s *ossSubServer) handleListMyFiles(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionGet, "auth not configured")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionGet, "auth required")
		return
	}

	q := r.URL.Query()
	req := service.ListMyFilesRequest{
		BucketName:     strings.TrimSpace(q.Get("bucket")),
		Visibility:     strings.TrimSpace(q.Get("visibility")),
		MimePrefix:     strings.TrimSpace(q.Get("mime")),
		IncludeDeleted: parseBoolQuery(q.Get("include_deleted")),
	}
	if v := strings.TrimSpace(q.Get("page")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			req.Page = n
		} else {
			s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionGet, "page: "+perr.Error())
			return
		}
	}
	if v := strings.TrimSpace(q.Get("page_size")); v != "" {
		if n, perr := strconv.Atoi(v); perr == nil {
			req.PageSize = n
		} else {
			s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionGet, "page_size: "+perr.Error())
			return
		}
	}

	res, err := s.fileService.ListMyFiles(r.Context(), subject.ID, req)
	if err != nil {
		s.mapLifecycleServiceError(r.Context(), w, ossdb.AuditActionGet, "", err)
		return
	}

	// Files come from gorm and may be nil when zero matches. Force
	// an empty slice so the JSON body is `"files": []` not `null`,
	// which is friendlier for client-side iteration.
	files := res.Files
	if files == nil {
		files = []ossdb.FileMeta{}
	}

	w.Header().Set("Content-Type", "application/json")
	resp := map[string]any{
		"files":     files,
		"total":     res.Total,
		"page":      res.Page,
		"page_size": res.PageSize,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// parseBoolQuery interprets the common "truthy" query-string
// idioms ("1", "true", "yes", "on" — case-insensitive) as true,
// and everything else (including the empty string) as false.
func parseBoolQuery(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// handleFileRestore reverses a soft delete within the configured
// grace window.
//
// Endpoint: `POST /sub-oss/file/restore?key=...`
//
// Auth: JWT required; subject must match the row's `OwnerPTID`.
// Outside the grace window the row stays deleted and the response
// is 410 Gone with reason `restore_window_expired`.
func (s *ossSubServer) handleFileRestore(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionRestore, "auth not configured")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, ossdb.AuditActionRestore, "auth required")
		return
	}

	q := r.URL.Query()
	key := strings.TrimSpace(q.Get("key"))
	if key == "" {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusBadRequest, lifecycleReasonBadRequest, ossdb.AuditActionRestore, "key required")
		return
	}
	if requested := strings.TrimSpace(q.Get("owner")); requested != "" && requested != subject.ID {
		s.writeLifecycleError(r.Context(), w, nil, http.StatusForbidden, lifecycleReasonNotOwner, ossdb.AuditActionRestore, "subject does not own owner query param")
		return
	}

	res, err := s.fileService.RestoreFile(r.Context(), subject.ID, key, s.softDeleteGrace)
	if err != nil {
		s.mapLifecycleServiceError(r.Context(), w, ossdb.AuditActionRestore, key, err)
		return
	}

	s.recordLifecycleAudit(r.Context(), res.Meta, subject.ID, ossdb.AuditActionRestore, ossdb.AuditOutcomeOK, lifecycleReasonUser)

	w.Header().Set("Content-Type", "application/json")
	resp := map[string]any{
		"key":        res.Meta.Key,
		"deleted_at": res.Meta.DeletedAt, // nil after restore
		"expires_at": res.Meta.ExpiresAt,
		"updated_at": res.Meta.UpdatedAt,
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// mapLifecycleServiceError translates service-layer errors from the
// delete / restore / patch paths into HTTP responses + audit rows.
// The audit `outcome=denied` for any non-2xx so the dashboard can
// chart failures alongside successes.
func (s *ossSubServer) mapLifecycleServiceError(ctx context.Context, w http.ResponseWriter, action, key string, err error) {
	switch {
	case errors.Is(err, service.ErrActorRequired):
		s.writeLifecycleError(ctx, w, nil, http.StatusUnauthorized, lifecycleReasonAuthRequired, action, err.Error())
	case errors.Is(err, service.ErrFileNotFound):
		// We pass a synthetic minimal meta so the audit row keeps
		// the file_key without holding a stale FileMeta from a
		// concurrent delete.
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusNotFound, lifecycleReasonNotFound, action, err.Error())
	case errors.Is(err, service.ErrRestoreWindowExpired):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusGone, lifecycleReasonRestoreExpired, action, err.Error())
	case errors.Is(err, service.ErrFileAlreadyLive):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusConflict, lifecycleReasonAlreadyLive, action, err.Error())
	case errors.Is(err, ossrepo.ErrQuotaExceeded):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusRequestEntityTooLarge, lifecycleReasonQuotaExceeded, action, err.Error())
	case errors.Is(err, service.ErrInvalidVisibility):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusBadRequest, lifecycleReasonInvalidVisibility, action, err.Error())
	case errors.Is(err, service.ErrChatSessionRequired):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusBadRequest, lifecycleReasonChatSessionMissing, action, err.Error())
	case errors.Is(err, service.ErrBucketUnknown):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusBadRequest, lifecycleReasonBucketUnknown, action, err.Error())
	case errors.Is(err, service.ErrCrossActorBucket):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusForbidden, lifecycleReasonBucketCrossActor, action, err.Error())
	case errors.Is(err, service.ErrEmptyPatch):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusBadRequest, lifecycleReasonPatchEmpty, action, err.Error())
	case errors.Is(err, service.ErrPatchOnDeleted):
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusGone, lifecycleReasonPatchOnDeleted, action, err.Error())
	default:
		logger.Errorf(ctx, "[oss] %s service error key=%s: %v", action, key, err)
		stub := &ossdb.FileMeta{Key: key}
		s.writeLifecycleError(ctx, w, stub, http.StatusInternalServerError, lifecycleReasonInternal, action, err.Error())
	}
}

// writeLifecycleError emits a JSON error body and stamps a
// matching audit row when a meta is available.
func (s *ossSubServer) writeLifecycleError(ctx context.Context, w http.ResponseWriter, meta *ossdb.FileMeta, status int, reason, action, msg string) {
	if meta != nil {
		// We only know the actor when the JWT layer succeeded;
		// passing "" is fine because audits use empty when the
		// caller is not yet identified.
		s.recordLifecycleAudit(ctx, meta, "", action, ossdb.AuditOutcomeDenied, reason)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":  reason,
		"error": msg,
	})
}

// recordLifecycleAudit writes a row matching the lifecycle action.
// Failures are logged but do not propagate — auditing is best-
// effort observability and must never block a user-facing mutate.
func (s *ossSubServer) recordLifecycleAudit(ctx context.Context, meta *ossdb.FileMeta, actorPTID, action, outcome, reason string) {
	if s.auditRepo == nil || meta == nil {
		return
	}
	evt := ossdb.Audit{
		Action:    action,
		FileKey:   meta.Key,
		FileID:    meta.ID,
		BucketID:  meta.BucketID,
		ActorPTID: actorPTID,
		SizeBytes: meta.Size,
		Outcome:   outcome,
		Reason:    reason,
		RequestID: RequestIDFromContext(ctx),
	}
	if err := s.auditRepo.Append(ctx, evt); err != nil {
		logger.Warnf(ctx, "[oss] %s audit append failed: %v", action, err)
	}
}
