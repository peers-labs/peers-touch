package oss

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	ossdb "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	ossrepo "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/repo"
	"github.com/peers-labs/peers-touch/station/app/subserver/oss/service"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	authhttp "github.com/peers-labs/peers-touch/station/frame/core/auth/adapter/http"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
	serverwrapper "github.com/peers-labs/peers-touch/station/frame/core/plugin/native/server/wrapper"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
	ossmodel "github.com/peers-labs/peers-touch/station/frame/touch/model/oss"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// capabilitiesVersion is bumped on every breaking change to the
// `/sub-oss/capabilities` response shape. Clients should refuse to
// run when the value drops below their minimum supported version.
//
//	v1: initial public shape (host, backend, key_strategy, …).
//	v2: presigned upload — `presigned_upload`, `presigned_threshold`,
//	    `presigned_endpoints`. Older clients keep working because
//	    they ignore unknown fields.
const capabilitiesVersion = 2

type ossURL struct{ name, path string }

func (u ossURL) SubPath() string { return u.path }
func (u ossURL) Name() string    { return u.name }

func (s *ossSubServer) Handlers() []server.Handler {
	base := strings.TrimRight(s.pathBase, "/")

	// Create upload handler with optional auth wrapper
	var uploadWrappers []server.Wrapper
	if s.authProvider != nil {
		uploadWrappers = []server.Wrapper{server.HTTPWrapperAdapter(authhttp.RequireJWT(s.authProvider))}
	}

	return []server.Handler{
		server.NewHTTPHandler("oss-upload", base+"/upload", server.POST, server.HTTPHandlerFunc(s.handleUpload), uploadWrappers...),
		server.NewHTTPHandler("oss-presign-upload", base+"/presign-upload", server.POST, server.HTTPHandlerFunc(s.handlePresignUpload), uploadWrappers...),
		server.NewHTTPHandler("oss-upload-complete", base+"/upload-complete", server.POST, server.HTTPHandlerFunc(s.handleUploadComplete), uploadWrappers...),
		server.NewHTTPHandler("oss-file-get", base+"/file", server.GET, server.HTTPHandlerFunc(s.handleFileGet)),
		server.NewHTTPHandler("oss-capabilities", base+"/capabilities", server.GET, server.HTTPHandlerFunc(s.handleCapabilities)),
		server.NewTypedHandler("oss-meta", base+"/meta", server.POST, s.handleMetaGet, serverwrapper.LogID()),
	}
}

// resolveOrigin returns the externally-reachable origin advertised by this
// OSS subserver. It is the source of truth for both `cid` URIs returned by
// `/upload` and the `host` field surfaced via `/capabilities`.
//
// Resolution order:
//  1. `Options.HostOverride` — operator-supplied authoritative origin.
//  2. The request's `X-Forwarded-Proto` + `Host` (or `r.Host`) headers —
//     reflects whatever the client used to reach the station, which is
//     correct for home deployments where the station has a single URL.
//  3. `"self"` — last-resort sentinel; clients treat this as "same origin
//     as the station they are talking to".
func (s *ossSubServer) resolveOrigin(r *http.Request) string {
	if s.hostOverride != "" {
		return s.hostOverride
	}
	if r != nil && r.Host != "" {
		scheme := "http"
		if r.TLS != nil {
			scheme = "https"
		}
		if proto := r.Header.Get("X-Forwarded-Proto"); proto != "" {
			scheme = proto
		}
		return scheme + "://" + r.Host
	}
	return "self"
}

// buildCID assembles the federated content identifier returned to the
// client. Format: `oss://{origin}/{key}` — origin is the result of
// `resolveOrigin`. Receivers parse the URI to know which station to
// pull the bytes from, enabling small-scale federation without a global
// CDN. See `docs/architecture/oss/file-storage.md`.
func (s *ossSubServer) buildCID(r *http.Request, key string) string {
	origin := s.resolveOrigin(r)
	return "oss://" + origin + "/" + key
}

func (s *ossSubServer) verifySignature(q urlQuery) bool {
	if s.signSecret == "" {
		return true
	}
	expStr := q.Get("exp")
	sig := q.Get("sig")
	if expStr == "" || sig == "" {
		return false
	}
	var exp int64
	_, _ = fmt.Sscan(expStr, &exp)
	if time.Now().Unix() > exp {
		return false
	}
	data := q.Get("key") + "|" + expStr
	return hmacHex(s.signSecret, data) == sig
}

func (s *ossSubServer) handleUpload(w http.ResponseWriter, r *http.Request) {
	// Auth middleware (RequireJWT) is applied in Handlers() if
	// authProvider is set. We additionally require a subject — the
	// JWT must resolve to a known actor — because every upload
	// debits a per-actor bucket and writes an `OwnerActorID` row.
	if s.authProvider == nil {
		writeUploadAuthError(w, "auth_required")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		writeUploadAuthError(w, "auth_required")
		return
	}

	// 2026-04-26: Honor `Options.MaxFileSize` for both the multipart parse
	// budget and a hard pre-save check. We trust `hdr.Size` because it
	// comes from the parsed multipart frame, not the raw client claim.
	maxSize := s.maxFileSize
	if maxSize <= 0 {
		maxSize = defaultMaxFileSize
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSize+(1<<20))
	if err := r.ParseMultipartForm(maxSize); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_multipart"})
		return
	}
	file, hdr, err := r.FormFile("file")
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "file_required"})
		return
	}
	defer file.Close()
	if hdr.Size > maxSize {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":    "file_too_large",
			"max_size": maxSize,
		})
		return
	}

	attr := service.UploadAttribution{
		ActorID:       subject.ID,
		BucketName:    strings.TrimSpace(r.FormValue("bucket")),
		Visibility:    strings.TrimSpace(r.FormValue("visibility")),
		ChatSessionID: strings.TrimSpace(r.FormValue("chat_session_id")),
	}

	meta, err := s.fileService.SaveFile(r.Context(), attr, file, hdr)
	if err != nil {
		writeUploadServiceError(r.Context(), w, "handleUpload", err)
		return
	}

	cid := s.buildCID(r, meta.Key)
	// `url` is a *relative* path: callers that mount the OSS
	// subserver under a non-default prefix (avatar / header upload
	// today, more tomorrow) compose the absolute URL themselves.
	// `cid` is the federated URI chat clients should embed in
	// `MessageAttachment.cid`. `sha256` is non-empty only when the
	// CAS strategy is active — clients use it to verify integrity
	// on download.
	resp := map[string]any{
		"key":      meta.Key,
		"cid":      cid,
		"url":      s.pathBase + "/file?key=" + meta.Key,
		"size":     meta.Size,
		"mime":     meta.Mime,
		"filename": meta.Name,
		"backend":  meta.Backend,
		"host":     s.resolveOrigin(r),
	}
	if meta.Sha256 != "" {
		resp["sha256"] = meta.Sha256
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// presignUploadRequest is the wire shape of `POST /sub-oss/presign-upload`.
// All fields are caller-supplied claims; the server validates them against
// the active key strategy and the eventual `HeadObject` in
// `handleUploadComplete`.
type presignUploadRequest struct {
	Filename      string `json:"filename"`
	Mime          string `json:"mime"`
	Size          int64  `json:"size"`
	Sha256        string `json:"sha256,omitempty"`
	Bucket        string `json:"bucket,omitempty"`
	Visibility    string `json:"visibility,omitempty"`
	ChatSessionID string `json:"chat_session_id,omitempty"`
}

// writeUploadAuthError emits a 401 with a stable JSON shape so the
// desktop client can match on `code` rather than parsing English.
func writeUploadAuthError(w http.ResponseWriter, code string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": code, "error": "authentication required"})
}

// writeUploadServiceError translates service-layer errors into HTTP
// responses. The pattern is: errors.Is against typed sentinels for
// 4xx mapping, fall through to 500 for everything else.
func writeUploadServiceError(ctx context.Context, w http.ResponseWriter, where string, err error) {
	w.Header().Set("Content-Type", "application/json")
	switch {
	case errors.Is(err, service.ErrActorRequired):
		writeUploadAuthError(w, "auth_required")
	case errors.Is(err, service.ErrBucketUnknown):
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "bucket_unknown", "error": err.Error()})
	case errors.Is(err, service.ErrInvalidVisibility):
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "invalid_visibility", "error": err.Error()})
	case errors.Is(err, service.ErrChatSessionRequired):
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "chat_session_required", "error": err.Error()})
	case errors.Is(err, ossrepo.ErrQuotaExceeded):
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "quota_exceeded", "error": err.Error()})
	case errors.Is(err, service.ErrPresignUnsupported):
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "presigned_upload_disabled", "error": err.Error()})
	default:
		logger.Errorf(ctx, "[%s] service error: %v", where, err)
		w.WriteHeader(http.StatusInternalServerError)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": fmt.Sprintf("save_failed: %v", err)})
	}
}

// handlePresignUpload opens a presigned upload session. The client
// uses the response to PUT bytes directly to the storage backend,
// then calls `/upload-complete` to register the FileMeta row.
//
// CAS short-circuit: when the strategy is `cas` and the supplied
// SHA-256 already maps to a `FileMeta`, we return the existing row
// with `already_uploaded: true` and the client skips the PUT.
func (s *ossSubServer) handlePresignUpload(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		writeUploadAuthError(w, "auth_required")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		writeUploadAuthError(w, "auth_required")
		return
	}
	pb := s.presignedBackend()
	if pb == nil {
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "presigned_upload_disabled"})
		return
	}

	var req presignUploadRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_json"})
		return
	}
	if req.Size <= 0 {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "size_required"})
		return
	}
	if req.Size > s.maxFileSize {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "file_too_large", "max_size": s.maxFileSize})
		return
	}

	attr := service.UploadAttribution{
		ActorID:       subject.ID,
		BucketName:    strings.TrimSpace(req.Bucket),
		Visibility:    strings.TrimSpace(req.Visibility),
		ChatSessionID: strings.TrimSpace(req.ChatSessionID),
	}
	res, err := s.fileService.PrepareUpload(r.Context(), pb, attr, service.PrepareUploadRequest{
		Filename:    req.Filename,
		ContentType: req.Mime,
		Size:        req.Size,
		Sha256:      strings.ToLower(strings.TrimSpace(req.Sha256)),
	}, s.presignedUploadTTL)
	if err != nil {
		writeUploadServiceError(r.Context(), w, "handlePresignUpload", err)
		return
	}

	resp := map[string]any{
		"key":              res.Meta.Key,
		"backend":          s.backendType,
		"already_uploaded": res.AlreadyUploaded,
	}
	if res.AlreadyUploaded {
		resp["cid"] = s.buildCID(r, res.Meta.Key)
		resp["filename"] = res.Meta.Name
		resp["size"] = res.Meta.Size
		resp["mime"] = res.Meta.Mime
		if res.Meta.Sha256 != "" {
			resp["sha256"] = res.Meta.Sha256
		}
	} else {
		resp["method"] = res.Method
		resp["url"] = res.URL
		resp["headers"] = res.Headers
		resp["expires_at"] = res.ExpiresAt.Unix()
		resp["max_bytes"] = res.MaxBytes
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// uploadCompleteRequest is the wire shape of `POST /sub-oss/upload-complete`.
type uploadCompleteRequest struct {
	Key           string `json:"key"`
	Filename      string `json:"filename"`
	Mime          string `json:"mime"`
	Size          int64  `json:"size"`
	Sha256        string `json:"sha256,omitempty"`
	Bucket        string `json:"bucket,omitempty"`
	Visibility    string `json:"visibility,omitempty"`
	ChatSessionID string `json:"chat_session_id,omitempty"`
}

// handleUploadComplete registers a successfully PUT object as a
// FileMeta row. The server independently HEADs the bucket to confirm
// the bytes landed and the size is honest before persisting.
func (s *ossSubServer) handleUploadComplete(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		writeUploadAuthError(w, "auth_required")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		writeUploadAuthError(w, "auth_required")
		return
	}
	pb := s.presignedBackend()
	if pb == nil {
		w.WriteHeader(http.StatusNotImplemented)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "presigned_upload_disabled"})
		return
	}

	var req uploadCompleteRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_json"})
		return
	}

	attr := service.UploadAttribution{
		ActorID:       subject.ID,
		BucketName:    strings.TrimSpace(req.Bucket),
		Visibility:    strings.TrimSpace(req.Visibility),
		ChatSessionID: strings.TrimSpace(req.ChatSessionID),
	}
	meta, err := s.fileService.CompleteUpload(r.Context(), pb, attr, service.CompleteUploadRequest{
		Key:         req.Key,
		Filename:    req.Filename,
		ContentType: req.Mime,
		Size:        req.Size,
		Sha256:      strings.ToLower(strings.TrimSpace(req.Sha256)),
	})
	if err != nil {
		writeUploadServiceError(r.Context(), w, "handleUploadComplete", err)
		return
	}

	resp := map[string]any{
		"key":      meta.Key,
		"cid":      s.buildCID(r, meta.Key),
		"size":     meta.Size,
		"mime":     meta.Mime,
		"filename": meta.Name,
		"backend":  meta.Backend,
		"host":     s.resolveOrigin(r),
	}
	if meta.Sha256 != "" {
		resp["sha256"] = meta.Sha256
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(resp)
}

// handleCapabilities advertises this OSS endpoint's runtime parameters so
// that clients (and peer stations, in federated deployments) can:
//
//   - Pre-validate uploads against `max_file_size` / `max_files_per_message`.
//   - Discover the externally-reachable `host` to use when resolving
//     `oss://{host}/{key}` URIs back to bytes.
//   - Decide which features to enable based on `backend` (local vs s3 vs
//     proxy) and `signed_url` flag.
//   - Route per-file through the presigned upload path when the active
//     backend supports it (`presigned_upload`, `presigned_threshold`,
//     `presigned_endpoints`).
//
// Public on purpose — the response carries no secrets, and clients need to
// be able to query it before they have a JWT (e.g. on first login).
func (s *ossSubServer) handleCapabilities(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	resp := map[string]any{
		"version":               capabilitiesVersion,
		"host":                  s.resolveOrigin(r),
		"path_base":             s.pathBase,
		"backend":               s.backendType,
		"key_strategy":          s.keyStrategy,
		"max_file_size":         s.maxFileSize,
		"max_files_per_message": s.maxFilesPerMessage,
		"signed_url":            s.signSecret != "",
		"upload_endpoint":       s.pathBase + "/upload",
		"file_endpoint":         s.pathBase + "/file",
		"meta_endpoint":         s.pathBase + "/meta",
		"presigned_upload":      s.presignedUploadEnabled(),
	}
	if s.presignedUploadEnabled() {
		resp["presigned_threshold"] = s.presignedThreshold
		resp["presigned_endpoints"] = map[string]string{
			"presign":  s.pathBase + "/presign-upload",
			"complete": s.pathBase + "/upload-complete",
		}
	}
	_ = json.NewEncoder(w).Encode(resp)
}

// handleFileGet enforces the visibility policy attached to the
// resolved FileMeta row before serving (or redirecting to) the
// underlying bytes. The flow is:
//
//  1. Validate the optional HMAC `sign-secret` short URL — operators
//     who configure one expect *all* GETs (public included) to
//     present a fresh signature.
//  2. Resolve a FileMeta. The lookup honours an explicit `&owner=`
//     query param (federation case) and otherwise prefers the row
//     owned by the JWT subject; absent that, falls back to the
//     oldest row for the key (only useful for `public` reads).
//  3. Run `checkRead` against the meta's Visibility and the caller's
//     subject DID. Denials are recorded in `oss_audit` with a
//     stable `Reason` so the dashboard can graph patterns.
//  4. On allow, the existing presigned-redirect / stream pipeline
//     takes over.
//
// Architectural notes:
//   - We extract the JWT subject inline rather than wrapping the
//     handler in `RequireJWT`: GETs to public files must work
//     without a token, so the wrapper would refuse us.
//   - There is no "best effort" silent-allow fallback. Unknown
//     visibilities (which the schema forbids but we defend against
//     anyway) deny.
func (s *ossSubServer) handleFileGet(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if !s.verifySignature(q) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	key := q.Get("key")
	if key == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	// Authentication splits two ways:
	//   - peer JWT (typ=peer+jwt, EdDSA): produces peerSubjectID,
	//     which checkRead trusts over any local cookie. This is
	//     the federation hot path — a friend on station B fetching
	//     a chat attachment hosted on station A.
	//   - local user JWT (HS256): the station's normal session
	//     cookie. Drives the owner / chat-membership checks.
	// Both are optional; absent both, the request is anonymous and
	// only `public` files succeed.
	peerSubjectID, peerStationID := s.tryPeerToken(r, key)
	subjectID := s.optionalSubjectID(r)
	requestedOwner := strings.TrimSpace(q.Get("owner"))
	meta, err := s.lookupFileMeta(r.Context(), key, subjectID, requestedOwner)
	if err != nil || meta == nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	decision := checkRead(r.Context(), s.chatResolver, meta, subjectID, peerSubjectID)
	if !decision.Allow {
		s.recordAudit(r.Context(), meta, subjectID, peerStationID, decision.Reason)
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"code": "forbidden"})
		return
	}

	// When the active backend can issue presigned GET URLs, redirect
	// the client straight to the underlying store. This is the
	// bandwidth-offload story that justifies running an S3-protocol
	// backend at all — bytes never traverse the Station.
	if pb := s.presignedBackend(); pb != nil {
		pr, err := pb.PresignGet(r.Context(), key, s.presignedDownloadTTL)
		if err == nil {
			http.Redirect(w, r, pr.URL, http.StatusFound)
			return
		}
		// Presign failure is unusual (driver-level, not user-level).
		// Fall through to streaming; we'd rather burn Station
		// bandwidth than 5xx the renderer.
		logger.Warnf(r.Context(), "[handleFileGet] presign get failed, streaming: %v", err)
	}

	rc, size, mt, err := s.backend.Open(r.Context(), key)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	defer rc.Close()

	if mt == "" {
		mt = getMimeTypeByExtension(key)
	}
	if mt != "" {
		w.Header().Set("Content-Type", mt)
	}
	w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
	_, _ = io.Copy(w, rc)
}

// optionalSubjectID validates the optional Bearer JWT and returns
// the subject DID, or an empty string when no token is present /
// the token is malformed / the token is a federation peer JWT
// rather than a local user JWT. It deliberately does NOT 401 —
// public files must be served without authentication.
//
// Federation tokens are filtered out *before* we hand the bearer
// to the local HS256 verifier because the verifiers are tuned to
// different algorithms; running an EdDSA token through the HS256
// path would log a misleading "key is invalid type" error.
func (s *ossSubServer) optionalSubjectID(r *http.Request) string {
	if s.authProvider == nil {
		return ""
	}
	bearer := bearerFromRequest(r)
	if bearer == "" {
		return ""
	}
	if isFederationToken(bearer) {
		return ""
	}
	subject, err := s.authProvider.Validate(r.Context(), bearer)
	if err != nil || subject == nil {
		return ""
	}
	return subject.ID
}

// tryPeerToken extracts and verifies an inbound federation JWT, if
// present. Returns (actorDID, peerStationID) on success and ("", "")
// otherwise — verify failures are intentionally silent because
// a malformed peer token must not deny a public file fetch.
//
// expectedKey binds the verification to the file the caller is
// asking for: a token minted for object X cannot authorise a GET
// of object Y.
func (s *ossSubServer) tryPeerToken(r *http.Request, expectedKey string) (string, string) {
	if s.peerKeyRepo == nil {
		return "", ""
	}
	bearer := bearerFromRequest(r)
	if bearer == "" || !isFederationToken(bearer) {
		return "", ""
	}
	res, err := s.VerifyPeerToken(r.Context(), bearer, expectedKey, s.localStationID)
	if err != nil {
		// Log at debug only — a federated client frequently retries
		// with a stale token and we do not want to flood the logs.
		logger.Debugf(r.Context(), "[handleFileGet] peer token verify failed: %v", err)
		return "", ""
	}
	return res.ActorDID, res.PeerStationID
}

// bearerFromRequest extracts the value of `Authorization: Bearer …`,
// returning "" when the header is missing or malformed.
func bearerFromRequest(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if len(h) < 7 || !strings.EqualFold(h[:7], "bearer ") {
		return ""
	}
	return h[7:]
}

// isFederationToken peeks at the JOSE header without verifying the
// signature, returning true iff `typ` matches the federation
// marker. Inexpensive — we only base64-decode the header segment.
func isFederationToken(bearer string) bool {
	parts := strings.SplitN(bearer, ".", 3)
	if len(parts) != 3 {
		return false
	}
	hdr, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		// JWS spec mandates RawURL but some libraries pad — fall
		// back to padded URL once before giving up.
		if hdr2, err2 := base64.URLEncoding.DecodeString(parts[0]); err2 == nil {
			hdr = hdr2
		} else {
			return false
		}
	}
	// We only look for the typ string verbatim — proper JSON
	// decode is unnecessary at this point and slower.
	return strings.Contains(string(hdr), `"typ":"`+federationTokenType+`"`)
}

// lookupFileMeta resolves the FileMeta row that should govern this
// GET. Resolution order:
//
//  1. `?owner=` query param (federation case — peer station passes
//     the originating actor DID alongside the file key);
//  2. JWT subject (the most common case — actor reads their own row);
//  3. fall through to FindByKey (oldest row), which only succeeds
//     for `public` visibility because the audience check rejects
//     the rest.
func (s *ossSubServer) lookupFileMeta(ctx context.Context, key, subjectID, requestedOwner string) (*ossdb.FileMeta, error) {
	if s.fileRepo == nil {
		return nil, errors.New("oss: file repo not initialised")
	}
	if requestedOwner != "" {
		if m, err := s.fileRepo.FindByOwnerKey(ctx, requestedOwner, key); err == nil && m != nil && m.Key == key {
			return m, nil
		}
	}
	if subjectID != "" {
		if m, err := s.fileRepo.FindByOwnerKey(ctx, subjectID, key); err == nil && m != nil && m.Key == key {
			return m, nil
		}
	}
	m, err := s.fileRepo.FindByKey(ctx, key)
	if err != nil || m == nil || m.Key != key {
		return nil, err
	}
	return m, nil
}

// recordAudit writes an oss_audit row for a denied read. We only
// audit denials by default — auditing every successful public read
// would saturate the table without adding signal. Operators who
// want a complete access log can enable it via a future
// `audit-mode: all` knob (out of scope here).
//
// Action is fixed to `get`; the deny signal lives in `Outcome`. The
// dashboard groups by (action, outcome, reason) so the schema
// change to add new "denied actions" would only obscure the
// underlying GET vs PUT distinction.
func (s *ossSubServer) recordAudit(ctx context.Context, meta *ossdb.FileMeta, actorID, peerStationID, reason string) {
	if s.auditRepo == nil {
		return
	}
	evt := ossdb.Audit{
		Action:        ossdb.AuditActionGet,
		FileKey:       meta.Key,
		BucketID:      meta.BucketID,
		ActorID:       actorID,
		PeerStationID: peerStationID,
		SizeBytes:     meta.Size,
		Outcome:       ossdb.AuditOutcomeDenied,
		Reason:        reason,
	}
	if err := s.auditRepo.Append(ctx, evt); err != nil {
		// Audit failures must not turn a good response into a bad
		// one. Log and move on — the denial itself was already
		// applied by the caller.
		logger.Warnf(ctx, "[handleFileGet] audit append failed: %v", err)
	}
}

// getMimeTypeByExtension returns MIME type based on file extension
func getMimeTypeByExtension(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".bmp":
		return "image/bmp"
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".pdf":
		return "application/pdf"
	case ".json":
		return "application/json"
	case ".xml":
		return "application/xml"
	case ".txt":
		return "text/plain"
	case ".html", ".htm":
		return "text/html"
	case ".css":
		return "text/css"
	case ".js":
		return "application/javascript"
	default:
		return "application/octet-stream"
	}
}

func (s *ossSubServer) handleMetaGet(ctx context.Context, req *ossmodel.GetFileMetaRequest) (*ossmodel.GetFileMetaResponse, error) {
	if req.Key == "" {
		return nil, server.BadRequest("key is required")
	}

	meta, err := s.fileService.GetFileMeta(ctx, req.Key)
	if err != nil {
		return nil, server.NotFound("file not found")
	}

	return &ossmodel.GetFileMetaResponse{
		Meta: &ossmodel.FileMeta{
			Key:         meta.Key,
			Filename:    meta.Name,
			MimeType:    meta.Mime,
			Size:        meta.Size,
			UploaderDid: "",
			UploadedAt:  timestamppb.New(meta.CreatedAt),
		},
	}, nil
}
