// OssMediaResolver implements `domain.MediaResolver` against the OSS
// subserver's `oss_files` table. The OSS subserver is wired into the
// SAME station process as social (see `apps/station/app/main.go`) and
// stores its `FileMeta` rows in the SAME `*gorm.DB` handle, so
// validation is a single SELECT — we do NOT loop back through
// `/sub-oss/meta` HTTP. This keeps Moments write latency at one extra
// query and side-steps the JWT round-trip the OSS HTTP path requires.
//
// Design constraints:
//
//   - Foreign-origin CIDs (`oss://attacker.example/...`) are rejected
//     by simply NOT FINDING the key in the local table. We do not
//     parse / compare hosts because the OSS subserver's reachable
//     origin is itself dynamic (it can be the request's `Host` header
//     during dev; see `oss/handler.go::resolveOrigin`). The "key
//     exists locally" invariant is the strong, host-independent
//     signal: if the key is in our table, this station owns the
//     bytes, regardless of which `oss://...` envelope the client
//     used.
//
//   - Bare keys (no `oss://` prefix) are also accepted — older
//     Station deployments returned `key`/`url` only, and the chat
//     attachment payload still falls back to bare keys when
//     `host` is missing. We treat the bare-key form the same as
//     `oss://*/key` for purposes of "does the key exist locally?".
//
//   - Empty CID slice is a no-op — text / link / poll posts share
//     the same write path and we don't want to penalise them.
//
// When peers-oss lands its richer `Object` model (per-actor
// uploader / bucket / lifecycle), this resolver will additionally
// enforce `uploader_did == author_did` so callers cannot reference
// somebody else's locally-uploaded file. Tracked under D6 in
// `.dev-workflow/20260429-094000/plan.md`.

package infrastructure

import (
	"context"
	"fmt"
	"strings"

	domain "github.com/peers-labs/peers-touch/station/app/subserver/social/domain"
	ossmodel "github.com/peers-labs/peers-touch/station/app/subserver/oss/db/model"
	"gorm.io/gorm"
)

// OssMediaResolver is the production-time `domain.MediaResolver`
// backed by the local OSS subserver's `oss_files` table.
type OssMediaResolver struct {
	db *gorm.DB
}

// NewOssMediaResolver returns a resolver that validates CIDs against
// `oss_files`. The same `*gorm.DB` powering the OSS subserver MUST be
// passed; see `subserver.go` for wiring.
func NewOssMediaResolver(db *gorm.DB) domain.MediaResolver {
	return &OssMediaResolver{db: db}
}

// ValidateCIDs implements `domain.MediaResolver`.
func (r *OssMediaResolver) ValidateCIDs(ctx context.Context, cids []string) error {
	if len(cids) == 0 {
		return nil
	}

	// Extract distinct keys + map back to the originating CID so we
	// can name the FIRST offending one in the error.
	keyToCID := make(map[string]string, len(cids))
	for _, cid := range cids {
		key, err := extractOssKey(cid)
		if err != nil {
			return fmt.Errorf("invalid cid %q: %w", cid, err)
		}
		// First CID wins for de-dupe — duplicate refs in one post
		// are tolerated; we only need to validate each key once.
		if _, ok := keyToCID[key]; !ok {
			keyToCID[key] = cid
		}
	}

	keys := make([]string, 0, len(keyToCID))
	for k := range keyToCID {
		keys = append(keys, k)
	}

	var found []string
	if err := r.db.WithContext(ctx).
		Model(&ossmodel.FileMeta{}).
		Where("key IN ?", keys).
		Pluck("key", &found).Error; err != nil {
		return fmt.Errorf("oss key lookup: %w", err)
	}

	foundSet := make(map[string]struct{}, len(found))
	for _, k := range found {
		foundSet[k] = struct{}{}
	}

	for _, key := range keys {
		if _, ok := foundSet[key]; !ok {
			return fmt.Errorf(
				"cid %q references unknown object key %q on this station "+
					"(foreign-origin or deleted)", keyToCID[key], key)
		}
	}
	return nil
}

// extractOssKey accepts either `oss://{origin}/{key}` (the canonical
// federated form) or a bare `{key}` (legacy chat upload responses) and
// returns the bare key. It rejects malformed inputs so the caller can
// produce a precise InvalidArgument.
//
// The function is deliberately liberal about origins — see the
// package docstring for why we treat origin as a routing hint
// rather than a security boundary. The strong validation lives in
// "is this key in our local oss_files table?".
func extractOssKey(cid string) (string, error) {
	cid = strings.TrimSpace(cid)
	if cid == "" {
		return "", fmt.Errorf("empty")
	}

	const scheme = "oss://"
	if strings.HasPrefix(cid, scheme) {
		// Strip scheme, then split origin from key on the first '/'.
		rest := cid[len(scheme):]
		slash := strings.IndexByte(rest, '/')
		if slash < 0 || slash == len(rest)-1 {
			return "", fmt.Errorf("missing key segment")
		}
		key := rest[slash+1:]
		if strings.TrimSpace(key) == "" {
			return "", fmt.Errorf("empty key segment")
		}
		return key, nil
	}

	// Bare-key form (legacy). Reject anything obviously not a key —
	// scheme-less HTTP URLs, paths starting with whitespace, etc.
	if strings.ContainsAny(cid, " \t\n") {
		return "", fmt.Errorf("whitespace in key")
	}
	if strings.Contains(cid, "://") {
		return "", fmt.Errorf("non-oss scheme")
	}
	return cid, nil
}
