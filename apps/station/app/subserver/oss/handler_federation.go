package oss

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	ossdb "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/auth/federation"
	"github.com/peers-labs/peers-touch/station/frame/core/logger"
)

// Stable reason codes for the `federation_mint` action. Pinned in
// one place so dashboards and clients can switch on the value
// without parsing English error strings.
const (
	federationReasonAuthRequired      = "auth_required"
	federationReasonBadRequest        = "bad_request"
	federationReasonNotFound          = "not_found"
	federationReasonForbidden         = "forbidden"
	federationReasonInternal          = "internal_error"
	federationReasonUnsupported       = "federation_unsupported"
	federationReasonUserOK            = "ok"
	federationReasonUnknownVisibility = "unknown_visibility"
	federationReasonNotInSession      = "not_in_session"
	federationReasonSessionMissing    = "session_missing"
	federationReasonResolverError     = "resolver_error"
	federationReasonResolverMissing   = "resolver_missing"
	federationReasonNotOwner          = "not_owner"
	federationReasonNoSubject         = "subject_required"
)

// federationMintRequest is the JSON body of `POST /sub-oss/federation/token`.
//
// `target_origin` is the externally-reachable URL prefix of the peer
// station (e.g. "https://bob.example/sub-oss"). We hash it into the
// JWT `aud` claim so a leaked token cannot be replayed against an
// unrelated station; the hash is one-way so we do not surface the
// raw origin in audit rows either.
//
// `oss_key` binds the token to a single object; mint of a "session"
// token covering all of the actor's files is intentionally not
// supported (would defeat per-object blast-radius).
//
// `ttl_seconds` is optional and clamped to ≤60s by the underlying
// `MintPeerToken` helper; clients omitting it get the policy max.
type federationMintRequest struct {
	TargetOrigin string `json:"target_origin"`
	OSSKey       string `json:"oss_key"`
	TTLSeconds   int    `json:"ttl_seconds,omitempty"`
}

// federationMintResponse is the success-path JSON. We echo the
// hashed peer station id back so clients have a stable handle they
// can correlate with future revoke / pin events on the dashboard
// without leaking the original `target_origin`.
type federationMintResponse struct {
	Token         string `json:"token"`
	ExpiresAt     int64  `json:"expires_at"`
	KID           string `json:"kid"`
	PeerStationID string `json:"peer_station_id"`
}

// handleFederationToken mints a short-lived peer JWT authorising
// the bearer to fetch ONE specific OSS object from ONE specific
// peer station on behalf of the JWT subject.
//
// Endpoint: `POST /sub-oss/federation/token`
//
// Request: federationMintRequest (JSON body).
//
// Auth: JWT required. The subject's read permission on the file
// is re-evaluated with the same `checkRead` rules that govern
// direct GETs — there is no "if I can prepare, I can mint" loophole.
//
// Audit: every call (allow or deny) writes one
// `action=federation_mint` row. `outcome=ok` on success;
// `outcome=denied` with the matching `reason` on rejection.
func (s *ossSubServer) handleFederationToken(w http.ResponseWriter, r *http.Request) {
	if s.authProvider == nil {
		s.writeFederationMintError(r, w, nil, http.StatusUnauthorized, federationReasonAuthRequired, "auth not configured")
		return
	}
	subject := auth.GetSubject(r.Context())
	if subject == nil || subject.ID == "" {
		s.writeFederationMintError(r, w, nil, http.StatusUnauthorized, federationReasonAuthRequired, "auth required")
		return
	}
	if s.fedCache == nil || s.localStationID == "" {
		// No federation key cache or no station identity →
		// minting is structurally disabled (typically a
		// unit-test wiring; production always wires both). 501
		// lets desktop clients fall back to non-federated
		// rendering without alarming users.
		s.writeFederationMintError(r, w, nil, http.StatusNotImplemented, federationReasonUnsupported, "federation disabled")
		return
	}

	rawBody, err := io.ReadAll(io.LimitReader(r.Body, 1<<14)) // 16 KiB
	if err != nil {
		s.writeFederationMintError(r, w, nil, http.StatusBadRequest, federationReasonBadRequest, "read body: "+err.Error())
		return
	}
	if len(rawBody) == 0 {
		s.writeFederationMintError(r, w, nil, http.StatusBadRequest, federationReasonBadRequest, "request body required")
		return
	}
	var req federationMintRequest
	if err := json.Unmarshal(rawBody, &req); err != nil {
		s.writeFederationMintError(r, w, nil, http.StatusBadRequest, federationReasonBadRequest, "decode body: "+err.Error())
		return
	}

	target := strings.TrimSpace(req.TargetOrigin)
	key := strings.TrimSpace(req.OSSKey)
	if target == "" || key == "" {
		s.writeFederationMintError(r, w, nil, http.StatusBadRequest, federationReasonBadRequest, "target_origin and oss_key required")
		return
	}
	if !validTargetOrigin(target) {
		s.writeFederationMintError(r, w, nil, http.StatusBadRequest, federationReasonBadRequest, "target_origin must be a valid http/https URL")
		return
	}

	// Resolve the FileMeta. We deliberately check both:
	//   - the row owned by the subject (by far the common case);
	//   - and, when missing, fall back to the oldest row keyed by
	//     `key` only. The latter only succeeds for `public`
	//     visibility — `checkRead` denies otherwise — and matches
	//     the read path's `lookupFileMeta` resolution order.
	meta, err := s.lookupFileMeta(r.Context(), key, subject.ID, "")
	if err != nil || meta == nil {
		stub := &ossdb.FileMeta{Key: key}
		s.writeFederationMintError(r, w, stub, http.StatusNotFound, federationReasonNotFound, "file not found for subject")
		return
	}

	// Re-run the same visibility decision the GET path would.
	// `peerSubjectID = ""` because *this* handler runs inside the
	// minter — the caller is a local user JWT, not a peer JWT.
	decision := checkRead(r.Context(), s.chatResolver, meta, subject.ID, "")
	if !decision.Allow {
		s.writeFederationMintError(r, w, meta, http.StatusForbidden, mapPermissionReason(decision.Reason), "denied by visibility policy")
		return
	}

	// Hash the origin into a stable peer-station id we use as the
	// JWT `aud`. The receiving station independently hashes its
	// own origin and rejects mismatches, so a leaked token cannot
	// authenticate against a station it was not minted for.
	peerStationID := hashOrigin(target)

	ttl := time.Duration(req.TTLSeconds) * time.Second
	token, err := federation.Mint(r.Context(), s.fedCache, federation.MintRequest{
		Scope:    FederationScopeName,
		Issuer:   s.localStationID,
		Audience: peerStationID,
		Subject:  subject.ID,
		TTL:      ttl,
		Custom:   map[string]string{FederationOSSKeyClaim: key},
	})
	if err != nil {
		logger.Errorf(r.Context(), "[oss] federation mint failed key=%s: %v", key, err)
		stub := &ossdb.FileMeta{Key: key, ID: meta.ID, BucketID: meta.BucketID, Size: meta.Size}
		s.writeFederationMintError(r, w, stub, http.StatusInternalServerError, federationReasonInternal, err.Error())
		return
	}

	keyMaterial, _ := s.fedCache.Get(r.Context())
	kid := ""
	if keyMaterial != nil {
		kid = keyMaterial.Kid
	}
	expClamped := ttl
	if expClamped <= 0 || expClamped > federationMaxTTL {
		expClamped = federationMaxTTL
	}
	expiresAt := time.Now().Add(expClamped).Unix()

	s.recordFederationAudit(r, meta, subject.ID, peerStationID, ossdb.AuditOutcomeOK, federationReasonUserOK)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(federationMintResponse{
		Token:         token,
		ExpiresAt:     expiresAt,
		KID:           kid,
		PeerStationID: peerStationID,
	})
}

// writeFederationMintError emits a JSON error body and stamps a
// matching audit row. `meta` may be nil for pre-resolution
// failures; in that case we write only the error response.
func (s *ossSubServer) writeFederationMintError(r *http.Request, w http.ResponseWriter, meta *ossdb.FileMeta, status int, reason, msg string) {
	if meta != nil {
		s.recordFederationAudit(r, meta, "", "", ossdb.AuditOutcomeDenied, reason)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"code":  reason,
		"error": msg,
	})
}

// recordFederationAudit writes one `oss_audit` row for a
// federation mint attempt. Failures are logged-not-returned —
// auditing must never fail a successful mint or convert a
// 403 into a 500.
func (s *ossSubServer) recordFederationAudit(r *http.Request, meta *ossdb.FileMeta, actorID, peerStationID, outcome, reason string) {
	if s.auditRepo == nil || meta == nil {
		return
	}
	evt := ossdb.Audit{
		Action:        ossdb.AuditActionFederationMint,
		FileKey:       meta.Key,
		FileID:        meta.ID,
		BucketID:      meta.BucketID,
		ActorID:       actorID,
		PeerStationID: peerStationID,
		SizeBytes:     meta.Size,
		Outcome:       outcome,
		Reason:        reason,
		RequestID:     RequestIDFromContext(r.Context()),
	}
	if err := s.auditRepo.Append(r.Context(), evt); err != nil {
		logger.Warnf(r.Context(), "[oss] federation_mint audit append failed: %v", err)
	}
}

// hashOrigin returns the stable peer-station identifier we embed
// in the JWT `aud` claim. SHA-256 hex of the trimmed origin —
// idempotent under trailing-slash variation so
// "https://bob.example/" and "https://bob.example" mint the same
// token target.
func hashOrigin(origin string) string {
	clean := strings.TrimRight(strings.TrimSpace(origin), "/")
	sum := sha256.Sum256([]byte(clean))
	return hex.EncodeToString(sum[:])
}

// validTargetOrigin gates the input parameter — we only accept
// http(s) origins because the receiver eventually issues an HTTP
// GET against them. Bare hostnames and arbitrary URI schemes are
// rejected up-front so a malformed value is a 400 instead of a
// 500-deep-in-the-fetch.
func validTargetOrigin(s string) bool {
	u, err := url.Parse(s)
	if err != nil || u.Host == "" {
		return false
	}
	switch strings.ToLower(u.Scheme) {
	case "http", "https":
		return true
	}
	return false
}

// mapPermissionReason translates the broad `permissionDecision`
// reason set into the federation-mint reason set so audit and
// HTTP responses use the federation namespace consistently. We
// fold "ok" into the federation OK reason and reuse the deny
// reasons verbatim where they line up.
func mapPermissionReason(r string) string {
	switch r {
	case reasonOK:
		return federationReasonUserOK
	case reasonNoSubject:
		return federationReasonNoSubject
	case reasonNotOwner:
		return federationReasonNotOwner
	case reasonNotInSession:
		return federationReasonNotInSession
	case reasonNoSession:
		return federationReasonSessionMissing
	case reasonResolverError:
		return federationReasonResolverError
	case reasonResolverMissing:
		return federationReasonResolverMissing
	case reasonUnknownVis:
		return federationReasonUnknownVisibility
	default:
		return federationReasonForbidden
	}
}
