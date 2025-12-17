package http

import (
	"encoding/json"
	"net/http"
	"strings"

	coreauth "github.com/peers-labs/peers-touch/station/frame/core/auth"
	"github.com/peers-labs/peers-touch/station/frame/core/server"
)

func RequireJWT(p coreauth.Provider) server.Wrapper {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := r.Header.Get("Authorization")
			if !strings.HasPrefix(h, "Bearer ") {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "Valid JWT token required"})
				return
			}
			token := strings.TrimPrefix(h, "Bearer ")
			_, err := p.Validate(r.Context(), token)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "Invalid or expired token"})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
