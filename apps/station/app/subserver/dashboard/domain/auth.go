// Package domain — pure domain logic for authentication and security.
// No database or framework dependencies — only standard library and crypto.
//
// Change History:
//   - 2026-04-10: Initial implementation — password hashing, JWT claims,
//     local network detection, session ID generation.
//   - 2026-04-10: Refactored from flat auth.go to DDD domain layer.
package domain

import (
	"crypto/rand"
	"encoding/hex"
	"net"
)

// ---------------------------------------------------------------------------
// JWT claims
// ---------------------------------------------------------------------------

// DashboardClaims is the typed projection of a verified
// dashboard JWT, returned by AuthService.ValidateToken and
// stashed into the request context by the dashboard middleware.
//
// Since the auth-unification refactor it no longer doubles as a
// jwt.Claims implementation: the framework's `coreauth.Provider`
// signs + parses the wire format with its own claim shape, and
// this struct is purely a typed view for downstream handlers.
type DashboardClaims struct {
	AdminID   uint64 `json:"admin_id"`
	Username  string `json:"username"`
	Role      string `json:"role"`
	SessionID string `json:"session_id"`
}

// ---------------------------------------------------------------------------
// Session helpers
// ---------------------------------------------------------------------------

// GenerateSessionID creates a cryptographically-random 64-char hex session ID.
func GenerateSessionID() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

// IsLocalRequest returns true when the remote address belongs to a local /
// private network (loopback, RFC-1918, link-local, ULA).
func IsLocalRequest(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}

	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}

	if ip.IsLoopback() {
		return true
	}

	privateRanges := []string{
		"10.0.0.0/8",
		"172.16.0.0/12",
		"192.168.0.0/16",
		"fc00::/7",
		"fe80::/10",
	}
	for _, cidr := range privateRanges {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			continue
		}
		if network.Contains(ip) {
			return true
		}
	}

	return false
}
