package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"html/template"
	"net/http"
	"strconv"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/entity"
)

const (
	minimumPBKDF2Iterations = 100_000
	maximumPBKDF2Iterations = 10_000_000
)

type AdminStore interface {
	AdminSnapshot(ctx context.Context, limit int) (entity.AdminSnapshot, error)
}

type BasicAuthenticator struct {
	usernameHash [sha256.Size]byte
	iterations   int
	salt         []byte
	passwordHash []byte
	requireHTTPS bool
}

func NewBasicAuthenticator(username, encodedHash string, requireHTTPS bool) (*BasicAuthenticator, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, errors.New("admin_username_required")
	}
	parts := strings.Split(strings.TrimSpace(encodedHash), "$")
	if len(parts) != 4 || parts[0] != "pbkdf2-sha256" {
		return nil, errors.New("invalid_admin_password_hash")
	}
	iterations, err := strconv.Atoi(parts[1])
	if err != nil ||
		iterations < minimumPBKDF2Iterations ||
		iterations > maximumPBKDF2Iterations {
		return nil, errors.New("invalid_admin_password_hash")
	}
	salt, err := decodeBase64(parts[2])
	if err != nil || len(salt) < 16 {
		return nil, errors.New("invalid_admin_password_hash")
	}
	passwordHash, err := decodeBase64(parts[3])
	if err != nil || len(passwordHash) != sha256.Size {
		return nil, errors.New("invalid_admin_password_hash")
	}
	return &BasicAuthenticator{
		usernameHash: sha256.Sum256([]byte(username)),
		iterations:   iterations,
		salt:         append([]byte(nil), salt...),
		passwordHash: append([]byte(nil), passwordHash...),
		requireHTTPS: requireHTTPS,
	}, nil
}

func (a *BasicAuthenticator) Authorized(r *http.Request) bool {
	if a == nil || (a.requireHTTPS && !requestIsHTTPS(r)) {
		return false
	}
	username, password, ok := r.BasicAuth()
	actualUsernameHash := sha256.Sum256([]byte(username))
	actualPasswordHash := pbkdf2SHA256(
		[]byte(password),
		a.salt,
		a.iterations,
		len(a.passwordHash),
	)
	usernameMatches := subtle.ConstantTimeCompare(
		actualUsernameHash[:],
		a.usernameHash[:],
	)
	passwordMatches := subtle.ConstantTimeCompare(
		actualPasswordHash,
		a.passwordHash,
	)
	return ok && usernameMatches == 1 && passwordMatches == 1
}

type AdminHandler struct {
	Store AdminStore
	Auth  *BasicAuthenticator
}

func (h *AdminHandler) Page(w http.ResponseWriter, r *http.Request) {
	if !h.admit(w, r) {
		return
	}
	snapshot, err := h.Store.AdminSnapshot(r.Context(), 100)
	if err != nil {
		writeAdminError(w)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if err := adminPageTemplate.Execute(w, snapshot); err != nil {
		return
	}
}

func (h *AdminHandler) Data(w http.ResponseWriter, r *http.Request) {
	if !h.admit(w, r) {
		return
	}
	snapshot, err := h.Store.AdminSnapshot(r.Context(), 100)
	if err != nil {
		writeAdminError(w)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(snapshot)
}

func (h *AdminHandler) admit(w http.ResponseWriter, r *http.Request) bool {
	setAdminSecurityHeaders(w.Header())
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		http.Error(w, "method_not_allowed", http.StatusMethodNotAllowed)
		return false
	}
	if h.Auth != nil && h.Auth.requireHTTPS && !requestIsHTTPS(r) {
		http.Error(w, "https_required", http.StatusBadRequest)
		return false
	}
	if h.Store == nil || h.Auth == nil || !h.Auth.Authorized(r) {
		w.Header().Set("WWW-Authenticate", `Basic realm="OAuth Login Broker", charset="UTF-8"`)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func setAdminSecurityHeaders(header http.Header) {
	header.Set("Cache-Control", "no-store")
	header.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
	header.Set("X-Frame-Options", "DENY")
	header.Set("X-Robots-Tag", "noindex, nofollow")
}

func WriteAdminUnavailable(w http.ResponseWriter) {
	setAdminSecurityHeaders(w.Header())
	writeAdminError(w)
}

func writeAdminError(w http.ResponseWriter) {
	http.Error(w, "admin_data_unavailable", http.StatusServiceUnavailable)
}

func requestIsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	forwarded := strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")
	return len(forwarded) > 0 &&
		strings.EqualFold(strings.TrimSpace(forwarded[0]), "https")
}

func decodeBase64(value string) ([]byte, error) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	if err == nil {
		return decoded, nil
	}
	return base64.RawStdEncoding.DecodeString(value)
}

func pbkdf2SHA256(password, salt []byte, iterations, keyLength int) []byte {
	result := make([]byte, 0, keyLength)
	var blockIndex uint32 = 1
	for len(result) < keyLength {
		mac := hmac.New(sha256.New, password)
		_, _ = mac.Write(salt)
		var index [4]byte
		binary.BigEndian.PutUint32(index[:], blockIndex)
		_, _ = mac.Write(index[:])
		sum := mac.Sum(nil)
		block := append([]byte(nil), sum...)
		for round := 1; round < iterations; round++ {
			mac = hmac.New(sha256.New, password)
			_, _ = mac.Write(sum)
			sum = mac.Sum(nil)
			for i := range block {
				block[i] ^= sum[i]
			}
		}
		result = append(result, block...)
		blockIndex++
	}
	return result[:keyLength]
}

var adminPageTemplate = template.Must(template.New("admin").Parse(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OAuth Login Broker</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; background: #f5f7fa; color: #17202a; }
    main { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }
    h1 { margin: 0 0 24px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 28px 0 10px; font-size: 18px; letter-spacing: 0; }
    .meta { color: #566573; font-size: 13px; }
    .table-wrap { overflow-x: auto; border: 1px solid #d5dbe3; border-radius: 6px; background: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 12px; border-bottom: 1px solid #e7ebf0; text-align: left; white-space: nowrap; }
    th { background: #eef2f6; color: #34495e; font-weight: 600; }
    tr:last-child td { border-bottom: 0; }
    .yes { color: #16794b; font-weight: 600; }
    .no { color: #8a3341; }
    @media (prefers-color-scheme: dark) {
      body { background: #15181c; color: #edf1f5; }
      .meta { color: #aab4bf; }
      .table-wrap { border-color: #39414a; background: #20252b; }
      th { background: #2b323a; color: #dce3ea; }
      th, td { border-bottom-color: #343c45; }
      .yes { color: #65d39b; }
      .no { color: #ef8d9b; }
    }
  </style>
</head>
<body>
<main>
  <h1>OAuth Login Broker</h1>
  <p class="meta">Snapshot generated {{.GeneratedAt}}</p>
  <h2>Identities</h2>
  <div class="table-wrap">
    <table id="identities">
      <thead><tr><th>Provider</th><th>User</th><th>Email</th><th>Last login</th><th>Logins</th><th>Access</th><th>Refresh</th></tr></thead>
      <tbody>
      {{range .Identities}}<tr><td>{{.Provider}}</td><td>{{.DisplayName}}</td><td>{{.Email}}</td><td>{{.LastLoginAt}}</td><td>{{.LoginCount}}</td><td class="{{if .HasAccessToken}}yes{{else}}no{{end}}">{{if .HasAccessToken}}Present{{else}}Absent{{end}}</td><td class="{{if .HasRefreshToken}}yes{{else}}no{{end}}">{{if .HasRefreshToken}}Present{{else}}Absent{{end}}</td></tr>{{else}}<tr><td colspan="7">No identities</td></tr>{{end}}
      </tbody>
    </table>
  </div>
  <h2>Recent Events</h2>
  <div class="table-wrap">
    <table id="events">
      <thead><tr><th>Time</th><th>Event</th><th>Provider</th><th>Site</th><th>Result</th><th>Error</th></tr></thead>
      <tbody>
      {{range .Events}}<tr><td>{{.OccurredAt}}</td><td>{{.EventType}}</td><td>{{.Provider}}</td><td>{{.SiteID}}</td><td>{{.Result}}</td><td>{{.ErrorCode}}</td></tr>{{else}}<tr><td colspan="6">No events</td></tr>{{end}}
      </tbody>
    </table>
  </div>
</main>
</body>
</html>`))
