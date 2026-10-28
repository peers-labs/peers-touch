package httpinterface

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/peers-labs/peers-touch/x-config/internal/application/operatorauth"
)

const (
	loginAttemptCookie = "peers_xcfg_login_attempt"
	sessionCookie      = "peers_xcfg_session"
	csrfCookie         = "peers_xcfg_csrf"
)

type AuthHandler struct {
	Service operatorauth.Service
	// SecureCookies must reflect the operator console origin scheme. It is
	// true for HTTPS deployments and false for flag-gated private corp
	// deployments served over plain HTTP on IP literals, where browsers
	// reject Secure cookies outright.
	SecureCookies bool
}

func (h *AuthHandler) Start(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	result, err := h.Service.Start(r.Context())
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "operator_login_unavailable")
		return
	}
	logTiming(
		"operator-attempt-store",
		result.AttemptStoreDuration,
		"success",
	)
	w.Header().Set(
		"Server-Timing",
		timing("operator-attempt-store", result.AttemptStoreDuration),
	)
	http.SetCookie(w, &http.Cookie{
		Name:     loginAttemptCookie,
		Value:    result.AttemptID,
		Path:     "/api/admin/auth/callback",
		Expires:  result.ExpiresAt,
		MaxAge:   maxAge(result.ExpiresAt),
		HttpOnly: true,
		Secure:   h.SecureCookies,
		SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, result.AuthorizeURL, http.StatusFound)
}

func (h *AuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	attemptCookie, err := r.Cookie(loginAttemptCookie)
	if err != nil {
		log.Printf("x_config_auth event=callback outcome=rejected")
		writeError(w, http.StatusUnauthorized, "operator_login_rejected")
		return
	}
	result, err := h.Service.Complete(
		r.Context(),
		attemptCookie.Value,
		strings.TrimSpace(r.URL.Query().Get("login_attempt_id")),
		strings.TrimSpace(r.URL.Query().Get("code")),
	)
	if err != nil {
		h.clearCookie(w, loginAttemptCookie, "/api/admin/auth/callback", true)
		log.Printf("x_config_auth event=callback outcome=rejected")
		writeError(w, http.StatusUnauthorized, "operator_login_rejected")
		return
	}
	logTiming("operator-attempt-read", result.AttemptReadDuration, "success")
	logTiming("oauth-redeem", result.RedeemDuration, "success")
	logTiming(
		"operator-session-commit",
		result.SessionCommitDuration,
		"success",
	)
	w.Header().Set(
		"Server-Timing",
		strings.Join([]string{
			timing("operator-attempt-read", result.AttemptReadDuration),
			timing("oauth-redeem", result.RedeemDuration),
			timing("operator-session-commit", result.SessionCommitDuration),
		}, ", "),
	)
	h.clearCookie(w, loginAttemptCookie, "/api/admin/auth/callback", true)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookie,
		Value:    result.SessionToken,
		Path:     "/api/admin",
		Expires:  result.ExpiresAt,
		MaxAge:   maxAge(result.ExpiresAt),
		HttpOnly: true,
		Secure:   h.SecureCookies,
		SameSite: http.SameSiteStrictMode,
	})
	http.SetCookie(w, &http.Cookie{
		Name:     csrfCookie,
		Value:    result.CSRFToken,
		Path:     "/",
		Expires:  result.ExpiresAt,
		MaxAge:   maxAge(result.ExpiresAt),
		HttpOnly: false,
		Secure:   h.SecureCookies,
		SameSite: http.SameSiteStrictMode,
	})
	http.Redirect(w, r, result.RedirectURL, http.StatusSeeOther)
}

func (h *AuthHandler) Session(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())
	if r.Method != http.MethodGet {
		methodNotAllowed(w, http.MethodGet)
		return
	}
	cookie, err := r.Cookie(sessionCookie)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "operator_session_required")
		return
	}
	startedAt := time.Now()
	session, err := h.Service.Authenticate(
		r.Context(),
		cookie.Value,
		"",
		false,
	)
	sessionReadDuration := time.Since(startedAt)
	w.Header().Set(
		"Server-Timing",
		timing("operator-session-read", sessionReadDuration),
	)
	if err != nil {
		logTiming("operator-session-read", sessionReadDuration, "rejected")
		writeError(w, http.StatusUnauthorized, "operator_session_required")
		return
	}
	logTiming("operator-session-read", sessionReadDuration, "success")
	writeJSON(w, http.StatusOK, map[string]any{
		"authenticated":    true,
		"provider":         session.Provider,
		"provider_subject": session.ProviderSubject,
		"expires_at":       session.ExpiresAt.UTC().Format(time.RFC3339),
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	setSecurityHeaders(w.Header())
	if r.Method != http.MethodPost {
		methodNotAllowed(w, http.MethodPost)
		return
	}
	session, sessionErr := r.Cookie(sessionCookie)
	csrf, csrfErr := r.Cookie(csrfCookie)
	headerCSRF := r.Header.Get("X-CSRF-Token")
	if sessionErr != nil ||
		csrfErr != nil ||
		headerCSRF == "" ||
		len(headerCSRF) != len(csrf.Value) ||
		subtle.ConstantTimeCompare([]byte(headerCSRF), []byte(csrf.Value)) != 1 {
		log.Printf("x_config_auth event=csrf outcome=rejected")
		writeError(w, http.StatusForbidden, "operator_csrf_invalid")
		return
	}
	if err := h.Service.Revoke(
		r.Context(),
		session.Value,
		headerCSRF,
	); err != nil {
		log.Printf("x_config_auth event=logout outcome=rejected")
		writeError(w, http.StatusForbidden, "operator_logout_rejected")
		return
	}
	log.Printf("x_config_auth event=logout outcome=success")
	h.clearCookie(w, sessionCookie, "/api/admin", true)
	h.clearCookie(w, csrfCookie, "/", false)
	w.WriteHeader(http.StatusNoContent)
}

func setSecurityHeaders(header http.Header) {
	header.Set("Cache-Control", "no-store")
	header.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	header.Set("Referrer-Policy", "no-referrer")
	header.Set("X-Content-Type-Options", "nosniff")
}

func (h *AuthHandler) clearCookie(
	w http.ResponseWriter,
	name string,
	path string,
	httpOnly bool,
) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     path,
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: httpOnly,
		Secure:   h.SecureCookies,
		SameSite: http.SameSiteStrictMode,
	})
}

func maxAge(expiresAt time.Time) int {
	seconds := int(time.Until(expiresAt).Seconds())
	if seconds < 1 {
		return 1
	}
	return seconds
}

func timing(name string, duration time.Duration) string {
	return fmt.Sprintf("%s;dur=%.3f", name, float64(duration.Microseconds())/1000)
}

func logTiming(name string, duration time.Duration, outcome string) {
	log.Printf(
		"x_config_timing metric=%s duration_ms=%.3f outcome=%s",
		name,
		float64(duration.Microseconds())/1000,
		outcome,
	)
}

func methodNotAllowed(w http.ResponseWriter, method string) {
	w.Header().Set("Allow", method)
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
}

func writeError(w http.ResponseWriter, status int, code string) {
	writeJSON(w, status, map[string]string{"error": code})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
