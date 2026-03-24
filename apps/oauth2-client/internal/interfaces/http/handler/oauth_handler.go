package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/peers-labs/peers-touch/oauth2-client/internal/application/oauth/usecase"
	"github.com/peers-labs/peers-touch/oauth2-client/internal/domain/oauth/valueobject"
)

type OAuthHandler struct {
	StartAuth      usecase.StartAuthUseCase
	HandleCallback usecase.HandleCallbackUseCase
	Sites          usecase.SiteRegistry
}

func (h *OAuthHandler) Start(w http.ResponseWriter, r *http.Request) {
	provider, ok := valueobject.ParseProvider(r.URL.Query().Get("provider"))
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_provider"})
		return
	}
	siteID := strings.TrimSpace(r.URL.Query().Get("site_id"))
	if siteID == "" {
		siteID = "default"
	}
	redirectURL, err := h.StartAuth.Execute(r.Context(), usecase.StartAuthInput{
		SiteID:   siteID,
		Provider: provider,
		ReturnTo: r.URL.Query().Get("return_to"),
	})
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (h *OAuthHandler) Callback(w http.ResponseWriter, r *http.Request) {
	provider, ok := valueobject.ParseProvider(r.URL.Query().Get("provider"))
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_provider"})
		return
	}
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	if state == "" || code == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing_code_or_state"})
		return
	}
	out, err := h.HandleCallback.Execute(r.Context(), usecase.HandleCallbackInput{
		Provider: provider,
		State:    state,
		Code:     code,
	})
	if err != nil {
		redirect, ok := h.buildErrorRedirect(r.URL.Query().Get("site_id"), state, err.Error())
		if ok {
			http.Redirect(w, r, redirect, http.StatusFound)
			return
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error(), "state": state})
		return
	}
	http.Redirect(w, r, out.RedirectURL, http.StatusFound)
}

func (h *OAuthHandler) Healthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *OAuthHandler) buildErrorRedirect(siteID, state, message string) (string, bool) {
	if siteID == "" {
		siteID = "default"
	}
	site, ok := h.Sites.Get(siteID)
	if !ok || strings.TrimSpace(site.ErrorURL) == "" {
		return "", false
	}
	u, err := url.Parse(site.ErrorURL)
	if err != nil {
		return "", false
	}
	if state != "" {
		q := u.Query()
		q.Set("state", state)
		u.RawQuery = q.Encode()
	}
	if message != "" {
		q := u.Query()
		q.Set("error", message)
		u.RawQuery = q.Encode()
	}
	return u.String(), true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
